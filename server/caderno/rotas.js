// Caderno (o antigo Ayo Sketchbook): páginas em /caderno e dados em /api/caderno, só com login.
// Montado depois da porta de login do index.js; cada pessoa só enxerga o próprio cofre.
import path from 'node:path';
import express from 'express';
import { ErroHttp } from '../cofres.js';
import { lerAjuste, gravarAjuste } from '../db.js';
import * as cofre from './cofre.js';
import { indiceDe, invalidar, backlinks, tags, buscar, grafo, resolver } from './indice.js';
import { renderizar, hashLinha, RE_TAREFA, urlCaminho } from './markdown.js';
import { paginaCaderno } from '../paginas.js';

const chavePrefs = (u) => `caderno:${u.id}`;
export const lerPreferencias = (u) => lerAjuste(chavePrefs(u), {}) || {};
const exigirTexto = (v, nome) => { if (typeof v !== 'string' || !v) throw new ErroHttp(400, `Informe ${nome}.`); return v; };
const relDe = (req) => (Array.isArray(req.params.caminho) ? req.params.caminho.join('/') : String(req.params.caminho || ''));

// comum(req): dados do menu lateral (index.js). trilhaDoArquivo(u, abs): a trilha e a nota de um arquivo do cofre,
// se ele estiver dentro de uma trilha que a pessoa vê (para o botão "Ver na trilha").
export function rotasDoCaderno({ comum, trilhaDoArquivo }) {
  const r = express.Router();

  // Corpos grandes só aqui (e só depois do login): anexos, desenhos e notas.
  r.use('/api/caderno/anexo', express.raw({ type: ['image/*', 'application/pdf'], limit: '15mb' }));
  r.use('/api/caderno/desenho', express.json({ limit: '12mb' }));
  r.use('/api/caderno', express.json({ limit: '5mb' }));

  // ---------- páginas ----------
  const casca = async (req, res) => res.send(paginaCaderno({ ...(await comum(req)), prefs: lerPreferencias(req.usuario) }));
  r.get('/caderno', casca);
  r.get('/caderno/n/*caminho', casca);
  r.get('/caderno/d/*caminho', casca);
  r.get('/caderno/grafo', casca);

  // Abre uma nota nova já com título/pasta/tags (botões "Anotar"). Aceita também o formato do caderno antigo (?assunto=&trilha=).
  r.get('/caderno/nova', async (req, res) => {
    const u = req.usuario;
    const bruto = String(req.query.titulo || req.query.assunto || '');
    const titulo = bruto.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || `Nota ${new Date().toLocaleDateString('sv-SE')}`;
    const pasta = String(req.query.pasta || '').split('/').map((p) => p.replace(/[\\:*?"<>|]/g, '').trim()).filter((p) => p && !p.startsWith('.')).join('/').slice(0, 150);
    const tagsQ = String(req.query.tags || req.query.trilha || '').split(',').map((t) => t.trim().replace(/[^\p{L}\p{N}_/-]/gu, '')).filter(Boolean).slice(0, 8);
    const fm = tagsQ.length ? `---\ntags: [${tagsQ.join(', ')}]\ndata: ${new Date().toLocaleDateString('sv-SE')}\n---\n` : '';
    const rel = await cofre.criarArquivo(u, `${pasta ? `${pasta}/` : ''}${titulo}.md`, `${fm}# ${titulo}\n\n`);
    invalidar(u);
    res.redirect(303, `/caderno/n/${urlCaminho(rel)}?editar=1`);
  });

  r.get('/caderno/arquivo/*caminho', async (req, res) => {
    const rel = relDe(req);
    const tipo = cofre.tipoDe(rel);
    if (tipo !== 'imagem' && tipo !== 'pdf') throw new ErroHttp(404, 'Arquivo não encontrado.');
    const abs = await cofre.caminhoSeguro(req.usuario, rel);
    if (tipo === 'pdf') res.removeHeader('Content-Security-Policy'); // o leitor de PDF do navegador precisa rodar
    else res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.set('Cache-Control', 'private, no-cache');
    res.sendFile(abs, { dotfiles: 'deny', headers: { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}` } });
  });

  // Endereços do caderno antigo (/caderno/<número>): as anotações de lá foram migradas para o cofre.
  r.get('/caderno/:id', (req, res, next) => (/^\d{1,12}$/.test(req.params.id) ? res.redirect(302, '/caderno') : next()));
  r.get('/caderno/:id/exportar.md', (req, res, next) => (/^\d{1,12}$/.test(req.params.id) ? res.redirect(302, '/caderno') : next()));

  // ---------- API do cofre ----------
  r.get('/api/caderno/arvore', async (req, res) => res.json({ arvore: await cofre.arvore(req.usuario) }));

  r.get('/api/caderno/indice', async (req, res) => {
    const ind = await indiceDe(req.usuario);
    const notas = [];
    const arquivos = [];
    for (const e of ind.values()) (e.tipo === 'nota' ? notas : arquivos).push({ rel: e.rel, nome: e.nome, tipo: e.tipo, titulos: e.titulos?.map((t) => t.texto) || [] });
    res.json({ notas, arquivos, tags: tags(ind) });
  });

  r.get('/api/caderno/nota', async (req, res) => {
    const u = req.usuario;
    const rel = exigirTexto(req.query.c, 'a nota');
    if (cofre.tipoDe(rel) !== 'nota') throw new ErroHttp(400, 'Isto não é uma nota.');
    const { texto, hash, mtime, abs } = await cofre.lerTexto(u, rel);
    res.json({ texto, hash, mtime, trilha: await trilhaDoArquivo(u, abs) });
  });

  r.post('/api/caderno/nota', async (req, res) => {
    const { c, texto, hash } = req.body ?? {};
    if (cofre.tipoDe(exigirTexto(c, 'a nota')) !== 'nota') throw new ErroHttp(400, 'Isto não é uma nota.');
    const novo = await cofre.gravarTexto(req.usuario, c, texto, typeof hash === 'string' ? hash : undefined);
    res.json({ ok: true, hash: novo });
  });

  r.post('/api/caderno/render', async (req, res) => {
    const { c, texto } = req.body ?? {};
    if (typeof texto !== 'string') throw new ErroHttp(400, 'Texto ausente.');
    res.json(renderizar(texto, { indice: await indiceDe(req.usuario), origem: typeof c === 'string' ? c : '' }));
  });

  r.post('/api/caderno/criar', async (req, res) => {
    const u = req.usuario;
    const { c, tipo, conteudo } = req.body ?? {};
    exigirTexto(c, 'o nome');
    let rel = c;
    if (tipo === 'pasta') await cofre.criarPasta(u, c);
    else if (tipo === 'desenho') rel = await cofre.criarArquivo(u, c.toLowerCase().endsWith('.sketch.json') ? c : `${c}.sketch.json`, JSON.stringify({ v: 1, fundo: 'pautado', altura: 1400, tracos: [] }));
    else rel = await cofre.criarArquivo(u, c.toLowerCase().endsWith('.md') ? c : `${c}.md`, typeof conteudo === 'string' ? conteudo.slice(0, 100_000) : '');
    invalidar(u);
    res.json({ ok: true, c: rel });
  });

  r.post('/api/caderno/mover', async (req, res) => {
    const { de, para } = req.body ?? {};
    const resultado = await cofre.mover(req.usuario, exigirTexto(de, 'a origem'), exigirTexto(para, 'o destino'));
    invalidar(req.usuario);
    res.json({ ok: true, ...resultado });
  });

  r.post('/api/caderno/apagar', async (req, res) => {
    await cofre.apagar(req.usuario, exigirTexto(req.body?.c, 'o arquivo'));
    invalidar(req.usuario);
    res.json({ ok: true });
  });

  r.get('/api/caderno/busca', async (req, res) => res.json({ resultados: buscar(await indiceDe(req.usuario), String(req.query.q || '').slice(0, 200)) }));
  r.get('/api/caderno/backlinks', async (req, res) => res.json({ backlinks: backlinks(await indiceDe(req.usuario), String(req.query.c || '')) }));
  r.get('/api/caderno/grafo', async (req, res) => res.json(grafo(await indiceDe(req.usuario))));
  r.get('/api/caderno/resolver', async (req, res) => res.json({ rel: resolver(await indiceDe(req.usuario), String(req.query.alvo || ''), String(req.query.origem || '')) }));

  // Marca/desmarca tarefa direto no modo leitura (confere a linha pelo hash).
  r.post('/api/caderno/tarefa', async (req, res) => {
    const u = req.usuario;
    const { c, linha, hash, marcado } = req.body ?? {};
    const { texto, hash: hashArquivo } = await cofre.lerTexto(u, exigirTexto(c, 'a nota'));
    const linhas = texto.split('\n');
    const n = Number(linha);
    if (!Number.isInteger(n) || n < 0 || n >= linhas.length || hashLinha(linhas[n]) !== hash || !RE_TAREFA.test(linhas[n].replace(/\r$/, ''))) {
      throw new ErroHttp(409, 'A nota mudou depois que a página abriu.');
    }
    linhas[n] = linhas[n].replace(RE_TAREFA, (_, a, _b, d) => a + (marcado ? 'x' : ' ') + d);
    const novo = await cofre.gravarTexto(u, c, linhas.join('\n'), hashArquivo);
    res.json({ ok: true, hash: novo, hashLinha: hashLinha(linhas[n]) });
  });

  // Nota do dia: Diário/AAAA-MM-DD.md, a partir de Modelos/Diária.md se existir.
  r.post('/api/caderno/diaria', async (req, res) => {
    const u = req.usuario;
    const hoje = new Date().toLocaleDateString('sv-SE');
    const rel = `Diário/${hoje}.md`;
    if (!(await cofre.existe(u, rel))) {
      let modelo = `# ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}\n\n## Hoje\n\n- [ ] \n\n## Anotações\n\n`;
      try { modelo = (await cofre.lerTexto(u, 'Modelos/Diária.md')).texto.replaceAll('{{data}}', hoje); } catch {}
      await cofre.criarArquivo(u, rel, modelo);
      invalidar(u);
    }
    res.json({ ok: true, c: rel });
  });

  // Anexo colado/arrastado: vai para Anexos/ com nome único; devolve o caminho para o ![[embed]].
  r.post('/api/caderno/anexo', async (req, res) => {
    const u = req.usuario;
    const tipos = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'application/pdf': '.pdf' };
    const ext = tipos[String(req.headers['content-type']).split(';')[0]];
    if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) throw new ErroHttp(400, 'Envie uma imagem (PNG, JPG, GIF, WEBP) ou PDF.');
    const base = String(req.query.nome || '').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
      || `Colado ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`;
    const rel = await cofre.nomeLivre(u, `Anexos/${base}${ext}`);
    await cofre.gravarBinario(u, rel, req.body);
    invalidar(u);
    res.json({ ok: true, c: rel });
  });

  // ---------- desenhos (.sketch.json + prévia .sketch.png) ----------
  r.get('/api/caderno/desenho', async (req, res) => {
    const rel = exigirTexto(req.query.c, 'o desenho');
    if (!cofre.ehDesenho(rel)) throw new ErroHttp(400, 'Isto não é um desenho.');
    const { texto, hash } = await cofre.lerTexto(req.usuario, rel);
    let desenho;
    try { desenho = JSON.parse(texto); } catch { throw new ErroHttp(422, 'O arquivo do desenho está corrompido.'); }
    res.json({ desenho, hash });
  });

  r.post('/api/caderno/desenho', async (req, res) => {
    const u = req.usuario;
    const { c, desenho, png, hash } = req.body ?? {};
    if (!cofre.ehDesenho(exigirTexto(c, 'o desenho'))) throw new ErroHttp(400, 'Isto não é um desenho.');
    const json = JSON.stringify(validarDesenho(desenho));
    const novo = await cofre.gravarTexto(u, c, json, typeof hash === 'string' ? hash : undefined);
    if (typeof png === 'string' && png.startsWith('data:image/png;base64,')) {
      const buf = Buffer.from(png.slice(22), 'base64');
      if (buf.length < 10 * 1024 * 1024) await cofre.gravarBinario(u, c.replace(/\.sketch\.json$/i, '.sketch.png'), buf);
    }
    invalidar(u);
    res.json({ ok: true, hash: novo });
  });

  // ---------- preferências (painéis abertos, última nota, modo) ----------
  r.get('/api/caderno/preferencias', (req, res) => res.json(lerPreferencias(req.usuario)));
  r.post('/api/caderno/preferencias', (req, res) => {
    const p = req.body ?? {};
    const limpo = {
      ultima: typeof p.ultima === 'string' ? p.ultima.slice(0, 400) : undefined,
      modo: ['editar', 'ler', 'dividir'].includes(p.modo) ? p.modo : undefined,
      esquerda: typeof p.esquerda === 'boolean' ? p.esquerda : undefined,
      direita: typeof p.direita === 'boolean' ? p.direita : undefined,
      abertas: Array.isArray(p.abertas) ? p.abertas.filter((x) => typeof x === 'string').slice(0, 200) : undefined,
    };
    gravarAjuste(chavePrefs(req.usuario), { ...lerPreferencias(req.usuario), ...Object.fromEntries(Object.entries(limpo).filter(([, v]) => v !== undefined)) });
    res.json({ ok: true });
  });

  return r;
}

function validarDesenho(d) {
  if (!d || !Array.isArray(d.tracos) || d.tracos.length > 8000) throw new ErroHttp(400, 'Desenho inválido.');
  const fundo = ['pautado', 'quadriculado', 'pontilhado', 'liso'].includes(d.fundo) ? d.fundo : 'pautado';
  const altura = Math.min(1400 * 30, Math.max(1400, Math.round(Number(d.altura) || 1400)));
  const imagens = (Array.isArray(d.imagens) ? d.imagens : []).slice(0, 20).map((im) => {
    if (typeof im?.c !== 'string' || cofre.tipoDe(im.c) !== 'imagem') throw new ErroHttp(400, 'Imagem do desenho inválida.');
    return { c: im.c, x: Number(im.x) || 0, y: Number(im.y) || 0, w: Math.max(10, Number(im.w) || 500), h: Math.max(10, Number(im.h) || 500) };
  });
  const tracos = d.tracos.map((t) => {
    if (!t || !['caneta', 'marca', 'lapis'].includes(t.f) || !/^#[0-9a-f]{6}$/i.test(t.c) || !Array.isArray(t.p) || t.p.length % 3 || t.p.length > 30000) throw new ErroHttp(400, 'Desenho inválido.');
    return {
      f: t.f, c: t.c.toLowerCase(), w: Math.min(60, Math.max(0.5, Number(t.w) || 3)),
      p: t.p.map((n) => { const v = Number(n); if (!Number.isFinite(v)) throw new ErroHttp(400, 'Desenho inválido.'); return Math.round(v * 100) / 100; }),
    };
  });
  return { v: 1, fundo, altura, imagens, tracos };
}
