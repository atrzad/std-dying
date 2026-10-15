// Cronograma da semana. Três camadas:
//  1. a semana-modelo de cada pessoa (blocos por dia da semana, guardados no banco);
//  2. o conteúdo de cada semana, lido ao vivo das tabelas de rotação dos cronogramas nos cofres
//     (primeira coluna "Semana", linhas S1, S2…), ou a próxima tarefa não feita da trilha;
//  3. eventos com data escritos nos cronogramas (simulados, checkpoints, véspera, prova) e as revisões do dia.
// As notas continuam sendo a fonte da verdade: mudou o cronograma no Obsidian, mudou a semana no site.
import { db } from './db.js';
import { ErroHttp, RE_TAREFA, RE_CERCA } from './cofres.js';
import { hojeISO, somarDias, diaUTC, diasEntre } from './resumo.js';

export const DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
export const DIAS_CURTOS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
export const FONTES = {
  rotacao: 'Rotação do cronograma',
  proxima: 'Próxima tarefa da trilha',
  fixo: 'Assunto fixo',
  revisoes: 'Revisões do dia',
};
export const TODAS = '*'; // bloco de revisões que vale para todas as trilhas

export const diaDaSemana = (iso) => (new Date(diaUTC(iso)).getUTCDay() + 6) % 7; // 0 = segunda
export const segundaDe = (iso) => somarDias(iso, -diaDaSemana(iso));

// ---------- leitura das notas ----------

const limpar = (s) => String(s || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/~~[^~]*~~/g, '')
  .replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();

function linhasUteis(nota) {
  // linhas fora de blocos de código, já sem \r
  let cerca = false;
  return nota.linhas.map((bruta) => {
    const l = bruta.replace(/\r$/, '');
    if (RE_CERCA.test(l)) { cerca = !cerca; return ''; }
    return cerca ? '' : l;
  });
}

function celulas(linha) {
  const s = linha.trim();
  if (!s.startsWith('|')) return null;
  return s.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
}
const SEPARADOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

function tabelas(linhas) {
  const saida = [];
  for (let i = 0; i < linhas.length - 1; i++) {
    const cab = celulas(linhas[i]);
    if (!cab || !SEPARADOR.test(linhas[i + 1].trim())) continue;
    const corpo = [];
    let j = i + 2;
    for (; j < linhas.length; j++) {
      const c = celulas(linhas[j]);
      if (!c) break;
      corpo.push(c);
    }
    saida.push({ cabecalho: cab, corpo });
    i = j - 1;
  }
  return saida;
}

// "A (2h × 4)" → "A"; "C — legislação + complemento (4h)" → "C"; "Matemática (1h30 × 5)" → "Matemática".
const chaveColuna = (rotulo) => limpar(rotulo).replace(/\([^)]*\)/g, ' ').split(/\s+[—–-]\s+/)[0].replace(/\s+/g, ' ').trim();

export const ehCronograma = (rel) => /cronograma/i.test(rel);

// Colunas das tabelas de rotação de uma nota: [{ chave, semanas: Map(n → texto) }].
// Tabelas com as mesmas colunas (Fase 1 e Fase 2) se juntam.
export function rotacoesDaNota(nota) {
  const colunas = new Map();
  for (const tab of tabelas(linhasUteis(nota))) {
    if (chaveColuna(tab.cabecalho[0]).toLowerCase() !== 'semana') continue;
    const chaves = tab.cabecalho.map(chaveColuna);
    for (const linha of tab.corpo) {
      const m = /^S(\d{1,2})\b/i.exec(limpar(linha[0]));
      if (!m) continue;
      for (let k = 1; k < chaves.length; k++) {
        const texto = limpar(linha[k]);
        if (!chaves[k] || !texto) continue;
        if (!colunas.has(chaves[k])) colunas.set(chaves[k], { chave: chaves[k], semanas: new Map() });
        colunas.get(chaves[k]).semanas.set(Number(m[1]), texto);
      }
    }
  }
  return [...colunas.values()];
}

// Ano mais provável de um "dd/mm" (o mais perto de hoje).
function dataDe(dd, mm, aa) {
  const d = Number(dd), m = Number(mm);
  if (d < 1 || d > 31 || m < 1 || m > 12) return null;
  const doisDig = (n) => String(n).padStart(2, '0');
  if (aa) {
    const ano = Number(aa) < 100 ? 2000 + Number(aa) : Number(aa);
    return `${ano}-${doisDig(m)}-${doisDig(d)}`;
  }
  const hoje = hojeISO();
  const ano = Number(hoje.slice(0, 4));
  const opcoes = [ano - 1, ano, ano + 1].map((a) => `${a}-${doisDig(m)}-${doisDig(d)}`);
  return opcoes.sort((x, y) => Math.abs(diasEntre(hoje, x)) - Math.abs(diasEntre(hoje, y)))[0];
}

const RE_EVENTO = /^(?:(?:seg|ter|qua|qui|sex|s[áa]b|dom)[a-zç]*\.?\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d/])\s*(.*)$/i;
const RE_ITEM = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;

// Eventos com data: itens de lista que começam por "dd/mm" (com ou sem dia da semana) e linhas de
// tabelas cuja primeira coluna se chama "Data". Riscados (~~) ficam de fora.
export function eventosDaNota(nota) {
  const eventos = [];
  const linhas = linhasUteis(nota);
  for (const l of linhas) {
    const item = RE_ITEM.exec(l);
    if (!item || l.includes('~~')) continue;
    const m = RE_EVENTO.exec(limpar(item[2]));
    if (!m) continue;
    const data = dataDe(m[1], m[2], m[3]);
    // "(tarde) — Checkpoint 1" → "Checkpoint 1 (tarde)"
    const texto = m[4].replace(/^[—–:\-\s]+/, '').replace(/^(\([^)]{1,30}\))\s*[—–:-]\s*(.+)$/, '$2 $1').trim();
    if (data && texto) eventos.push({ data, texto, feito: !!item[1] && item[1] !== ' ' });
  }
  for (const tab of tabelas(linhas)) {
    if (!/^data$/i.test(chaveColuna(tab.cabecalho[0]))) continue;
    for (const linha of tab.corpo) {
      const m = RE_EVENTO.exec(limpar(linha[0]));
      if (!m || linha[0].includes('~~')) continue;
      const data = dataDe(m[1], m[2], m[3]);
      const texto = linha.slice(1).map(limpar).filter(Boolean).join(' · ');
      if (data && texto) eventos.push({ data, texto, feito: false });
    }
  }
  return eventos;
}

// Primeira tarefa ainda não feita, na ordem das notas (pula guias, inventários, cronogramas e metas).
const ignorarNaProxima = (n) => n.meta?.tipo || /inventario|cronograma|metas|vagas/i.test(n.rel);
export function proximaTarefa(notas, feita) {
  for (const n of notas) {
    if (!n.total || n.feitas >= n.total || ignorarNaProxima(n)) continue;
    const linhas = linhasUteis(n);
    let h2 = '';
    let h3 = '';
    for (let i = 0; i < linhas.length; i++) {
      const h = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(linhas[i]);
      if (h) {
        if (h[1] === '##') { h2 = limpar(h[2]); h3 = ''; } else h3 = limpar(h[2]);
        continue;
      }
      if (!n.chavePorLinha.has(i) || feita(n, i)) continue;
      const m = RE_TAREFA.exec(linhas[i]);
      if (!m) continue;
      return { nota: n, linha: i, secao: h3 || h2, texto: limpar(linhas[i].slice(m[0].length)) };
    }
  }
  return null;
}

// ---------- semana-modelo (banco) ----------

const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export function blocosDe(usuarioId) {
  return db.prepare('SELECT * FROM cronograma_blocos WHERE usuario_id = ? ORDER BY dia, ordem, id').all(usuarioId);
}

function obterBloco(usuarioId, id) {
  const b = db.prepare('SELECT * FROM cronograma_blocos WHERE id = ? AND usuario_id = ?').get(Number(id), usuarioId);
  if (!b) throw new ErroHttp(404, 'Bloco não encontrado.');
  return b;
}

// colunasValidas: Map(slug → Set de "arquivo#chave") das rotações que a pessoa pode ver.
function validarBloco(dados, slugsValidos, colunasValidas) {
  const fonte = String(dados.fonte || '');
  if (!Object.hasOwn(FONTES, fonte)) throw new ErroHttp(400, 'Escolha de onde vem o assunto do bloco.');
  let trilha = String(dados.trilha || '');
  if (fonte === 'revisoes' && (!trilha || trilha === TODAS)) trilha = TODAS;
  else if (!slugsValidos.includes(trilha)) throw new ErroHttp(400, 'Escolha uma das suas trilhas.');
  const minutos = Number(dados.minutos);
  if (!Number.isInteger(minutos) || minutos < 5 || minutos > 720) throw new ErroHttp(400, 'A duração deve ser de 5 a 720 minutos.');
  const inicio = String(dados.inicio || '').trim();
  if (inicio && !RE_HORA.test(inicio)) throw new ErroHttp(400, 'Horário de início inválido (use HH:MM).');
  const rotulo = limpar(dados.rotulo).slice(0, 60);
  const assunto = limpar(dados.assunto).slice(0, 160);
  let coluna = null;
  if (fonte === 'rotacao') {
    coluna = String(dados.coluna || '');
    if (!colunasValidas.get(trilha)?.has(coluna)) throw new ErroHttp(400, 'Escolha uma coluna do cronograma desta trilha.');
  }
  if (fonte === 'fixo' && !assunto) throw new ErroHttp(400, 'Escreva o assunto do bloco.');
  return { fonte, trilha, minutos, inicio: inicio || null, rotulo, assunto: fonte === 'fixo' ? assunto : '', coluna };
}

export function criarBlocos(usuarioId, dados, slugsValidos, colunasValidas) {
  const dias = [...new Set((Array.isArray(dados.dias) ? dados.dias : [dados.dia]).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (!dias.length) throw new ErroHttp(400, 'Marque pelo menos um dia da semana.');
  const b = validarBloco(dados, slugsValidos, colunasValidas);
  if (blocosDe(usuarioId).length + dias.length > 150) throw new ErroHttp(429, 'Limite de 150 blocos na semana-modelo.');
  const ultimaOrdem = db.prepare('SELECT coalesce(max(ordem), -1) AS o FROM cronograma_blocos WHERE usuario_id = ? AND dia = ?');
  const inserir = db.prepare(`INSERT INTO cronograma_blocos (usuario_id, dia, ordem, inicio, minutos, trilha, rotulo, fonte, coluna, assunto, criado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const dia of dias) {
    inserir.run(usuarioId, dia, ultimaOrdem.get(usuarioId, dia).o + 1, b.inicio, b.minutos, b.trilha, b.rotulo, b.fonte, b.coluna, b.assunto, Date.now());
  }
  return dias.length;
}

export function editarBloco(usuarioId, id, dados, slugsValidos, colunasValidas) {
  const atual = obterBloco(usuarioId, id);
  const b = validarBloco(dados, slugsValidos, colunasValidas);
  const dia = dados.dia == null || dados.dia === '' ? atual.dia : Number(dados.dia);
  if (!Number.isInteger(dia) || dia < 0 || dia > 6) throw new ErroHttp(400, 'Dia da semana inválido.');
  const ordem = dia === atual.dia ? atual.ordem
    : db.prepare('SELECT coalesce(max(ordem), -1) + 1 AS o FROM cronograma_blocos WHERE usuario_id = ? AND dia = ?').get(usuarioId, dia).o;
  db.prepare(`UPDATE cronograma_blocos SET dia = ?, ordem = ?, inicio = ?, minutos = ?, trilha = ?, rotulo = ?, fonte = ?, coluna = ?, assunto = ?
    WHERE id = ? AND usuario_id = ?`).run(dia, ordem, b.inicio, b.minutos, b.trilha, b.rotulo, b.fonte, b.coluna, b.assunto, atual.id, usuarioId);
}

export function removerBloco(usuarioId, id) {
  const b = obterBloco(usuarioId, id);
  db.prepare('DELETE FROM cronograma_blocos WHERE id = ?').run(b.id);
}

// Sobe ou desce o bloco dentro do dia (troca de lugar com o vizinho).
export function moverBloco(usuarioId, id, direcao) {
  const b = obterBloco(usuarioId, id);
  const dia = blocosDe(usuarioId).filter((x) => x.dia === b.dia);
  const i = dia.findIndex((x) => x.id === b.id);
  const j = i + (Number(direcao) < 0 ? -1 : 1);
  if (j < 0 || j >= dia.length) return;
  [dia[i], dia[j]] = [dia[j], dia[i]];
  const mudar = db.prepare('UPDATE cronograma_blocos SET ordem = ? WHERE id = ?');
  dia.forEach((x, k) => mudar.run(k, x.id));
}

export function marcarFeito(usuarioId, blocoId, data, feito) {
  const b = obterBloco(usuarioId, blocoId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data)) || diaDaSemana(data) !== b.dia) throw new ErroHttp(400, 'Data inválida para este bloco.');
  if (feito) {
    db.prepare('INSERT OR IGNORE INTO cronograma_feitos (usuario_id, bloco_id, data, quando) VALUES (?, ?, ?, ?)').run(usuarioId, b.id, data, Date.now());
  } else {
    db.prepare('DELETE FROM cronograma_feitos WHERE usuario_id = ? AND bloco_id = ? AND data = ?').run(usuarioId, b.id, data);
  }
}

// ---------- montar a semana ----------

const local = (ms) => new Date(ms).toLocaleDateString('sv-SE');

function focoPorDia(usuarioId, de, ate) {
  const ini = new Date(`${de}T00:00:00`).getTime();
  const fim = new Date(`${ate}T00:00:00`).getTime() + 864e5;
  const mapa = new Map(); // "data|trilha" → minutos
  for (const p of db.prepare(`SELECT trilha, inicio, foco_s FROM pomodoros WHERE usuario_id = ? AND estado = 'concluido' AND tipo = 'foco'
      AND inicio >= ? AND inicio < ?`).all(usuarioId, ini, fim)) {
    const k = `${local(p.inicio)}|${p.trilha}`;
    mapa.set(k, (mapa.get(k) || 0) + Math.round((p.foco_s || 0) / 60));
  }
  return mapa;
}

// contexto: { trilhas: [{ t, estudos, rotacoes: Map("arquivo#chave" → coluna), eventos, proxima }], revisoesPorDia, revisoesFeitasHoje }
export function montarSemana(usuarioId, segunda, contexto) {
  const hoje = hojeISO();
  const ate = somarDias(segunda, 6);
  const blocos = blocosDe(usuarioId);
  const feitos = new Set(db.prepare('SELECT bloco_id, data FROM cronograma_feitos WHERE usuario_id = ? AND data BETWEEN ? AND ?')
    .all(usuarioId, segunda, ate).map((f) => `${f.bloco_id}|${f.data}`));
  const foco = focoPorDia(usuarioId, segunda, ate);
  const porSlug = new Map(contexto.trilhas.map((c) => [c.t.slug, c]));
  // Se a semana-modelo usa um cronograma da trilha, só os eventos dele aparecem (o outro cargo não polui).
  const usados = new Map();
  for (const b of blocos) {
    if (b.fonte !== 'rotacao' || !b.coluna) continue;
    if (!usados.has(b.trilha)) usados.set(b.trilha, new Set());
    usados.get(b.trilha).add(b.coluna.slice(0, b.coluna.lastIndexOf('#')));
  }
  const dias = [];
  for (let d = 0; d < 7; d++) {
    const data = somarDias(segunda, d);
    const revisoes = contexto.revisoesPorDia.get(data) || [];
    const restante = new Map(); // minutos de foco do dia ainda não distribuídos, por trilha
    const resolvidos = blocos.filter((b) => b.dia === d).map((b) => {
      const c = porSlug.get(b.trilha);
      let assunto = b.assunto;
      let detalhe = '';
      let semana = null;
      if (b.fonte === 'rotacao') {
        const col = c?.rotacoes.get(b.coluna);
        semana = c?.estudos?.inicio ? Math.floor(diasEntre(c.estudos.inicio, data) / 7) + 1 : null;
        assunto = (col && semana != null && col.semanas.get(semana)) || '';
        detalhe = col ? `${col.chave} · S${semana ?? '?'}` : 'coluna não encontrada no cronograma';
        if (col && !assunto) detalhe += ' (sem conteúdo nesta semana)';
      } else if (b.fonte === 'proxima') {
        const p = c?.proxima;
        assunto = p ? p.texto : '';
        detalhe = p ? `${p.nota.tituloCurto}${p.secao ? ` › ${p.secao}` : ''}` : 'tudo feito nesta trilha';
      } else if (b.fonte === 'revisoes') {
        assunto = revisoes.length ? `${revisoes.length} ${revisoes.length === 1 ? 'revisão' : 'revisões'}` : 'nenhuma revisão pendente';
      }
      // progresso: minutos de pomodoro do dia na trilha, distribuídos pelos blocos dela na ordem
      let feitosMin = 0;
      if (b.fonte !== 'revisoes') {
        const k = `${data}|${b.trilha}`;
        const disponivel = restante.has(k) ? restante.get(k) : (foco.get(k) || 0);
        feitosMin = Math.min(disponivel, b.minutos);
        restante.set(k, disponivel - feitosMin);
      }
      const manual = feitos.has(`${b.id}|${data}`);
      const auto = b.fonte === 'revisoes'
        ? data === hoje && contexto.revisoesFeitasHoje > 0 && !revisoes.length
        : feitosMin >= b.minutos;
      return { ...b, data, assunto, detalhe, semana, feitosMin, feito: manual || auto, manual };
    });
    const planejado = resolvidos.reduce((s, b) => s + b.minutos, 0);
    let focoDia = 0;
    for (const [k, v] of foco) if (k.startsWith(`${data}|`)) focoDia += v;
    const eventos = [];
    for (const c of contexto.trilhas) {
      for (const e of c.eventos) {
        if (e.data !== data || (usados.has(c.t.slug) && !usados.get(c.t.slug).has(e.rel))) continue;
        eventos.push({ ...e, trilha: c.t.slug });
      }
      if (c.estudos?.prova === data && !eventos.some((e) => e.trilha === c.t.slug && /prova/i.test(e.texto))) {
        eventos.unshift({ data, texto: `Dia de prova: ${c.estudos.concurso || c.t.nome}`, trilha: c.t.slug, prova: true });
      }
    }
    // o mesmo evento escrito em dois cronogramas (ex.: a agenda do ENEM repete o simulado da Manaus Prev) aparece uma vez só
    const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const unicos = eventos.filter((e, i) => !eventos.some((o, j) => j !== i && norm(o.texto).includes(norm(e.texto)) && (norm(o.texto) !== norm(e.texto) || j < i)));
    dias.push({ data, indice: d, nome: DIAS[d], curto: DIAS_CURTOS[d], hoje: data === hoje, passado: data < hoje, blocos: resolvidos, eventos: unicos, revisoes, planejado, focoDia });
  }
  return { segunda, ate, dias, semanas: contexto.trilhas.filter((c) => c.estudos?.inicio).map((c) => ({ t: c.t, s: Math.floor(diasEntre(c.estudos.inicio, segunda) / 7) + 1 })) };
}
