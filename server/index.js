import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import {
  db, lerAjuste, gravarAjuste, registrarEvento, eventosRecentes, podarEventos, backupDoBanco, feitasNoBanco, marcarNoBanco,
  registrarConsentimento,
} from './db.js';
import {
  autenticar, criarSessao, encerrarSessao, carregarSessao, criarUsuario, existeUsuario, usuarioExiste, listarUsuarios,
  renomearUsuario, conferirSenhaDoUsuario, trocarSenhaPorId, redefinirSenha, removerUsuario,
  validarUsuario, validarSenha, esperaBloqueio, registrarFalha, limparFalhas, limparSessoesExpiradas,
  validarArroba, arrobaExiste, validarEmail, emailExiste, validarNome, criarConta, criarTokenEmail, consumirTokenEmail,
  emailPendenteDe, confirmarManualmente, dadosDaConta, definirPerfilPublico, definirTema, limparConvitePendente, permitir,
} from './auth.js';
import {
  ErroHttp, carregarTrilhas, listarTrilhas, acharTrilha, listarNotas, listarArquivos, lerNota, caminhoSeguro,
  alternarTarefa, lerEstudos, lerRegistros, temRegistro, validarRegistro, adicionarRegistro, removerRegistro, EXT_SERVIDAS, RE_TAREFA,
} from './cofres.js';
import {
  carregarPerfis, nomesPerfis, temaDe, temaIdDe, gravaNasNotas, podeVerTrilha, podeVerArquivo, cargosPermitidos, PERFIL_CONTA_NOVA,
} from './perfis.js';
import * as grupo from './grupo.js';
import { temaExiste } from './temas.js';
import * as espaco from './espaco.js';
import { enviarConfirmacao, emailConfigurado, urlPublica } from './email.js';
import * as foco from './foco.js';
import * as caderno from './caderno.js';
import * as revisoes from './revisoes.js';
import * as cronograma from './cronograma.js';
import * as ia from './ia.js';
import { renderizarNota, renderizarTexto, renderizarEspacoNota } from './markdown.js';
import { resumir, hojeISO, diasEntre, dataBR, somarDias, nomeCargo, metaPctNa } from './resumo.js';
import {
  paginaEntrar, paginaInicio, paginaTrilha, paginaNota, paginaErro, paginaFoco, paginaConfiguracoes, paginaCaderno, paginaCadernoEditor,
  paginaMensagem, paginaConvite, paginaConviteManual, paginaCriarConta, paginaGrupo, paginaMembro, paginaPrivacidade,
  paginaEspacos, paginaEspaco, paginaEspacoNota, paginaEspacoNotaEditar,
  paginaCronograma, paginaCronogramaModelo, paginaRevisoes, paginaIA, paginaIAResultado, htmlQuestoes,
} from './paginas.js';

process.umask(0o077);
carregarTrilhas();
carregarPerfis();
ia.carregarIA();

// ---------- manutenção ----------
function manutencao() {
  try {
    limparSessoesExpiradas();
    podarEventos();
    backupDoBanco();
  } catch (e) {
    console.error('[manutencao]', e);
  }
}
manutencao();
setInterval(manutencao, 6 * 60 * 60 * 1000).unref();

// ---------- o que cada pessoa vê ----------

const MESES = ['jan.', 'fev.', 'mar.', 'abr.', 'maio', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
const mesAno = (iso) => `${MESES[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;

const trilhasDe = (u) => listarTrilhas().filter((t) => podeVerTrilha(u, t.slug));
// Trilhas para escolher no pomodoro/caderno: cofres permitidos + trilhas do próprio espaço.
const trilhasTodas = (u) => [
  ...trilhasDe(u),
  ...espaco.listarEspacos(u.id).map((e) => ({
    slug: espaco.slugEspaco(e.id), nome: e.nome, curto: e.nome.length > 14 ? `${e.nome.slice(0, 13)}…` : e.nome, espaco: true, cor: e.cor,
  })),
];
const slugsDe = (u) => trilhasTodas(u).map((t) => t.slug);
const nomeDaTrilha = (u) => { const m = new Map(trilhasTodas(u).map((t) => [t.slug, t.nome])); return (slug) => m.get(slug) || 'Outra trilha'; };
// No mural, o nome da trilha é o que o dono da sessão escolheu compartilhar (cofre ou trilha do espaço dele).
function nomeTrilhaCompartilhada(slug) {
  const t = acharTrilha(slug);
  if (t) return t.nome;
  const id = espaco.idDoSlug(slug);
  return (id && db.prepare('SELECT nome FROM espacos WHERE id = ?').get(id)?.nome) || 'Trilha';
}

function exigirTrilha(req) {
  const t = acharTrilha(req.params.slug);
  if (!t || !podeVerTrilha(req.usuario, t.slug)) throw new ErroHttp(404, 'Trilha não encontrada.');
  return t;
}

// Notas visíveis; para quem não grava nas notas, "feitas" vem do progresso próprio no banco.
async function notasDe(u, t) {
  const notas = (await listarNotas(t)).filter((n) => podeVerArquivo(u, t.slug, n.rel));
  if (gravaNasNotas(u)) return notas;
  return notas.map((n) => {
    const feitasSet = feitasNoBanco(u.id, t.slug, n.rel);
    return { ...n, feitas: n.chaves.filter((c) => feitasSet.has(c)).length };
  });
}

const arquivosDe = async (u, t) => (await listarArquivos(t)).filter((a) => podeVerArquivo(u, t.slug, a.rel));

function estudosDe(u, t, estudos) {
  const cs = cargosPermitidos(u, t.slug);
  if (!estudos || !cs) return estudos;
  return { ...estudos, cargos: Object.fromEntries(Object.entries(estudos.cargos || {}).filter(([c]) => cs.includes(c))) };
}

async function registrosDe(u, t) {
  const rs = await lerRegistros(t);
  const cs = cargosPermitidos(u, t.slug);
  return rs && cs ? rs.filter((r) => cs.includes(r.cargo)) : rs;
}

function projecao(t, notas) {
  const comHoras = notas.filter((n) => Number(n.meta.horas) > 0);
  if (!comHoras.length) return null;
  const ajuste = lerAjuste(`projecao:${t.slug}`, {});
  const ritmo = [5, 8, 10, 15, 20, 25, 30, 40].includes(ajuste.ritmo) ? ajuste.ritmo : 15;
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(ajuste.inicio || '') ? ajuste.inicio : (t.inicioPadrao || hojeISO());
  const hoje = hojeISO();
  const partida = inicio > hoje ? inicio : hoje;
  let acumulado = 0;
  let total = 0;
  const porNota = new Map();
  for (const n of comHoras) {
    const h = Number(n.meta.horas);
    total += h;
    const resta = n.total ? h * (1 - n.feitas / n.total) : h;
    acumulado += resta;
    porNota.set(n.rel, resta < 0.5 ? 'concluída' : `até ${mesAno(somarDias(partida, Math.ceil((acumulado / ritmo) * 7)))}`);
  }
  const semanas = acumulado / ritmo;
  return { ritmo, inicio, total, restantes: acumulado, semanas, fim: somarDias(partida, Math.ceil(semanas * 7)), porNota };
}

async function infoTrilha(u, t) {
  const notas = await notasDe(u, t);
  let feitas = 0;
  let total = 0;
  for (const n of notas) { feitas += n.feitas; total += n.total; }
  const proj = gravaNasNotas(u) ? projecao(t, notas) : null;
  const pct = proj ? (100 * (proj.total - proj.restantes)) / proj.total : total ? (100 * feitas) / total : 0;
  const estudos = estudosDe(u, t, await lerEstudos(t));
  const hoje = hojeISO();
  const pixel = temaDe(u) === 'pixel';
  let chamado = '';
  let linhaPrazo = '';
  if (estudos?.prova) {
    const dias = diasEntre(hoje, estudos.prova);
    if (estudos.inicio && hoje < estudos.inicio && t.antesDoInicio) {
      const diasInicio = diasEntre(hoje, estudos.inicio);
      chamado = pixel
        ? t.antesDoInicio.replace('{dias}', diasInicio).replace('{data}', dataBR(estudos.inicio))
        : `O plano começa em ${dataBR(estudos.inicio)} (faltam ${diasInicio} dias). Prova prevista para ${dataBR(estudos.prova)}.`;
      linhaPrazo = `Plano começa em ${dataBR(estudos.inicio)} · prova em ${dataBR(estudos.prova)}`;
    } else if (dias >= 0) {
      chamado = pixel ? (t.chamado || 'Faltam {dias} dias para a prova.').replace('{dias}', dias)
        : `Prova em ${dataBR(estudos.prova)}: faltam ${dias} ${dias === 1 ? 'dia' : 'dias'}.`;
      linhaPrazo = `Prova em ${dataBR(estudos.prova)} · ${dias === 0 ? 'é hoje' : `${dias} ${dias === 1 ? 'dia' : 'dias'}`}`;
    } else {
      chamado = `A prova foi em ${dataBR(estudos.prova)}.`;
      linhaPrazo = chamado;
    }
  } else if (proj) {
    chamado = proj.restantes < 0.5 ? 'Chefe final derrotado.' : `Chefe final previsto para ${mesAno(proj.fim)}, a ${proj.ritmo} h por semana.`;
    linhaPrazo = proj.restantes < 0.5 ? 'Trilha concluída' : `Fim previsto: ${mesAno(proj.fim)} a ${proj.ritmo} h/semana`;
  }
  return { notas, feitas, total, pct, proj, estudos, chamado, linhaPrazo };
}

async function contarAlmas(u) {
  let n = 0;
  for (const t of trilhasDe(u)) for (const nota of await notasDe(u, t)) n += nota.feitas;
  return n;
}

const GENERICOS = /^(tronco de software|hardware e sistemas|regras|fases|selos|encaixe|bancada|t[óo]picos|projeto|recursos|como |metas|datas|arquivos|fontes)/i;
async function assuntosDe(u, t) {
  const notas = await notasDe(u, t);
  const regs = (await registrosDe(u, t)) || [];
  const lista = [...foco.assuntosUsados(u.id, t.slug), ...regs.map((r) => r.materia).reverse(), ...notas.flatMap((n) => n.secoes)];
  return [...new Set(lista.map((s) => s.trim()).filter((s) => s && s.length <= 100 && !GENERICOS.test(s)))].slice(0, 200);
}

// Dados de toda página logada. Cada cofre leva o progresso e a lista de notas para a barra lateral
// (o cache por arquivo de cofres.js evita reler notas que não mudaram).
async function comum(req) {
  const u = req.usuario;
  const cofres = [];
  let almas = 0;
  for (const t of trilhasDe(u)) {
    const notas = await notasDe(u, t);
    let feitas = 0;
    let total = 0;
    for (const n of notas) { feitas += n.feitas; total += n.total; }
    almas += feitas;
    const proj = gravaNasNotas(u) ? projecao(t, notas) : null;
    const pct = proj ? (100 * (proj.total - proj.restantes)) / proj.total : total ? (100 * feitas) / total : 0;
    cofres.push({ ...t, pct, notas: notas.map((n) => ({ rel: n.rel, titulo: n.tituloCurto, feitas: n.feitas, total: n.total })) });
  }
  const espacos = trilhasTodas(u).filter((t) => t.espaco);
  u.revisoesPendentes = revisoes.contarPendentes(u.id, slugsDe(u));
  return { usuario: u, trilhas: [...cofres, ...espacos], almas: temaDe(u) === 'pixel' ? almas : null, foco: foco.sessaoAtiva(u.id) };
}

// ---------- cronograma: rotação, eventos e próxima tarefa de cada trilha ----------

async function contextoCronograma(u) {
  const saida = [];
  for (const t of trilhasDe(u)) {
    const notas = await notasDe(u, t);
    const estudos = await lerEstudos(t);
    const rotacoes = new Map();
    const eventos = [];
    for (const n of notas.filter((x) => cronograma.ehCronograma(x.rel))) {
      for (const col of cronograma.rotacoesDaNota(n)) rotacoes.set(`${n.rel}#${col.chave}`, { ...col, nota: n });
      eventos.push(...cronograma.eventosDaNota(n).map((e) => ({ ...e, rel: n.rel })));
    }
    let feita;
    if (gravaNasNotas(u)) {
      feita = (n, i) => { const m = RE_TAREFA.exec(n.linhas[i].replace(/\r$/, '')); return !!m && m[2] !== ' '; };
    } else {
      const sets = new Map();
      feita = (n, i) => {
        if (!sets.has(n.rel)) sets.set(n.rel, feitasNoBanco(u.id, t.slug, n.rel));
        return sets.get(n.rel).has(n.chavePorLinha.get(i));
      };
    }
    saida.push({ t, estudos, rotacoes, eventos, proxima: cronograma.proximaTarefa(notas, feita) });
  }
  for (const e of espaco.listarEspacos(u.id)) {
    const notas = espaco.notasDoEspaco(u.id, e.id).map((n) => ({ ...n, rel: `nota-${n.id}`, tituloCurto: n.titulo, meta: {} }));
    const feita = (n, i) => { const m = RE_TAREFA.exec(n.linhas[i]); return !!m && m[2] !== ' '; };
    saida.push({ t: { slug: espaco.slugEspaco(e.id), nome: e.nome, curto: e.nome }, estudos: null, rotacoes: new Map(), eventos: [], proxima: cronograma.proximaTarefa(notas, feita) });
  }
  return saida;
}

async function semanaDe(u, segunda) {
  const ctx = await contextoCronograma(u);
  return cronograma.montarSemana(u.id, segunda, {
    trilhas: ctx,
    revisoesPorDia: revisoes.porDia(u.id, slugsDe(u), segunda, somarDias(segunda, 6)),
    revisoesFeitasHoje: revisoes.feitasNoDia(u.id, hojeISO()),
  });
}

// Colunas de rotação que a pessoa pode ligar a um bloco (com o assunto desta semana como exemplo).
async function opcoesDoModelo(u) {
  const ctx = await contextoCronograma(u);
  const colunas = [];
  const validas = new Map();
  for (const c of ctx) {
    for (const [valor, col] of c.rotacoes) {
      const s = c.estudos?.inicio ? Math.floor(diasEntre(c.estudos.inicio, hojeISO()) / 7) + 1 : null;
      const exemplo = s != null ? col.semanas.get(s) : '';
      const nota = col.nota.tituloCurto.length > 48 ? `${col.nota.tituloCurto.slice(0, 47)}…` : col.nota.tituloCurto;
      colunas.push({ trilha: c.t.slug, valor, rotulo: `${c.t.curto} › ${nota} › ${col.chave}${exemplo ? ` (S${s}: ${exemplo.length > 50 ? `${exemplo.slice(0, 49)}…` : exemplo})` : ''}` });
      if (!validas.has(c.t.slug)) validas.set(c.t.slug, new Set());
      validas.get(c.t.slug).add(valor);
    }
  }
  return { escolhas: trilhasTodas(u), colunas, validas };
}

const textoEvento = (e) => ({ ...e, texto: e.detalhe });

// ---------- app ----------

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

const ehLocal = (req) => {
  const ip = req.socket.remoteAddress || '';
  const host = (req.hostname || '').toLowerCase();
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)
    && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)
    && !req.headers['x-forwarded-for'] && !req.headers['tailscale-user-login'];
};

// Host desconhecido = possível DNS rebinding; nem chega às rotas.
app.use((req, res, next) => {
  const bruto = String(req.headers.host || '').toLowerCase();
  const host = bruto.startsWith('[') ? bruto.slice(0, bruto.indexOf(']') + 1) : bruto.split(':')[0];
  if (!config.hosts.has(host)) return res.status(421).type('text').send('Host não permitido.');
  next();
});

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; " +
      "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  });
  // Pela internet (Tailscale Funnel) só existe HTTPS: o navegador passa a recusar HTTP para este endereço.
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

app.get('/saude', (req, res) => res.json({ ok: true }));

app.use('/fonts', express.static(path.join(config.publicDir, 'fonts'), { immutable: true, maxAge: '365d', index: false }));
app.use(express.static(config.publicDir, { index: false, cacheControl: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

app.use(carregarSessao);
app.use((req, res, next) => {
  if (req.usuario) {
    req.usuario.tema = temaDe(req.usuario);
    req.usuario.temaId = temaIdDe(req.usuario);
  }
  next();
});

// CSRF: além do cookie SameSite=Strict, toda escrita precisa vir da mesma origem e com um cabeçalho próprio.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origem = req.headers.origin;
  if (origem) {
    let host = null;
    try { host = new URL(origem).host; } catch {}
    if (host !== req.headers.host) return res.status(403).json({ erro: 'Origem não permitida.' });
  }
  if (req.headers['x-ayo'] !== '1') return res.status(403).json({ erro: 'Requisição inválida.' });
  next();
});
// O caderno manda desenhos inteiros (traços da caneta); o resto da API aceita pouco.
app.use('/api/caderno', express.json({ limit: '5mb' }));
app.use('/api', express.json({ limit: '20kb' }));

// ---------- entrada ----------

app.get('/entrar', (req, res) => {
  if (req.usuario) return res.redirect(303, '/');
  if (!existeUsuario()) return res.redirect(303, '/configurar');
  // depois do login, só volta para páginas de convite ou do grupo (nada de redirecionar para fora)
  const voltar = /^\/(convite\/[A-Za-z0-9]{1,16}|grupo)$/.test(String(req.query.voltar || '')) ? String(req.query.voltar) : '';
  res.send(paginaEntrar({ voltar }));
});

app.get('/configurar', (req, res) => {
  if (existeUsuario()) return res.redirect(303, req.usuario ? '/' : '/entrar');
  res.send(paginaEntrar({ primeira: true, local: ehLocal(req) }));
});

app.post('/api/configurar', async (req, res) => {
  if (existeUsuario()) return res.status(409).json({ erro: 'O usuário já foi criado. Entre pela tela de login.' });
  if (!ehLocal(req)) return res.status(403).json({ erro: 'A primeira configuração só pode ser feita nesta máquina.' });
  const { usuario, senha, confirmacao } = req.body ?? {};
  const erro = validarUsuario(String(usuario || '').trim()) || validarSenha(senha) || (senha !== confirmacao ? 'As senhas não são iguais.' : null);
  if (erro) return res.status(400).json({ erro });
  const id = await criarUsuario(usuario.trim(), senha, { dono: true });
  criarSessao(req, res, id);
  registrarEvento({ usuarioId: id, tipo: 'conta', detalhe: 'Acendeu a primeira fogueira' });
  res.json({ ok: true });
});

app.post('/api/entrar', async (req, res) => {
  const espera = esperaBloqueio(req.ip);
  if (espera) {
    res.set('Retry-After', String(espera));
    return res.status(429).json({ erro: `Muitas tentativas. Tente de novo em ${Math.ceil(espera / 60)} min.` });
  }
  const { usuario, senha } = req.body ?? {};
  if (typeof usuario !== 'string' || typeof senha !== 'string' || !usuario.trim() || !senha) {
    return res.status(400).json({ erro: 'Informe usuário e senha.' });
  }
  const u = await autenticar(usuario.trim(), senha.slice(0, 200));
  if (!u) {
    registrarFalha(req.ip);
    return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
  }
  limparFalhas(req.ip);
  if (u.pendente) return res.status(403).json({ erro: 'Confirme seu e-mail antes de entrar. Procure o link na sua caixa de entrada (e no spam).', pendente: true });
  criarSessao(req, res, u.id);
  res.json({ ok: true });
});

app.post('/api/sair', (req, res) => {
  encerrarSessao(req, res);
  res.json({ ok: true });
});


// ---------- públicas: privacidade, cookies, convites, cadastro e confirmação de e-mail ----------

app.get('/privacidade', (req, res) => res.send(paginaPrivacidade({ usuario: req.usuario || null })));

app.post('/api/cookies', (req, res) => {
  if (req.usuario) registrarConsentimento(req.usuario.id, 'cookies', 'essenciais');
  res.json({ ok: true });
});

app.get('/convite', (req, res) => res.send(paginaConviteManual({ usuario: req.usuario || null })));

app.post('/api/convite/validar', (req, res) => {
  if (!permitir(`convite:${req.ip}`, 10, 15 * 60_000)) throw new ErroHttp(429, 'Muitas tentativas. Espere 15 minutos.');
  const c = grupo.conviteValido(req.body?.codigo);
  if (!c) throw new ErroHttp(404, 'Código inválido, expirado ou já usado.');
  res.json({ ok: true, codigo: c.codigo });
});

app.get('/convite/:codigo', (req, res) => {
  const c = grupo.conviteValido(req.params.codigo);
  const m = req.usuario ? grupo.membroDe(req.usuario.id) : null;
  if (c && m?.grupo_id === c.grupo_id) return res.redirect(303, '/grupo');
  res.send(paginaConvite({ usuario: req.usuario || null, convite: c, codigo: grupo.normalizarCodigo(req.params.codigo), grupoAtual: m?.grupo_nome || null }));
});

app.get('/criar-conta', (req, res) => {
  if (req.usuario) return res.redirect(303, '/');
  const codigo = grupo.normalizarCodigo(req.query.convite);
  res.send(paginaCriarConta({ convite: codigo ? grupo.conviteValido(codigo) : null, codigo, emailAtivo: emailConfigurado() }));
});

app.post('/api/criar-conta', async (req, res) => {
  if (!permitir(`cadastro:${req.ip}`, 5, 60 * 60_000)) throw new ErroHttp(429, 'Muitos cadastros deste endereço. Tente de novo em 1 hora.');
  const b = req.body ?? {};
  const c = grupo.conviteValido(b.convite);
  if (!c) throw new ErroHttp(400, 'O convite é inválido, expirou ou já foi usado. Peça um novo.');
  const nome = String(b.nome || '').trim();
  const arroba = String(b.arroba || '').trim().toLowerCase().replace(/^@/, '');
  const email = String(b.email || '').trim().toLowerCase();
  const erro = validarNome(nome) || validarArroba(arroba) || validarEmail(email) || validarSenha(b.senha)
    || (b.senha !== b.confirmacao ? 'As senhas não são iguais.' : null)
    || (b.aceite !== true ? 'Para criar a conta, aceite os termos e a política de privacidade.' : null);
  if (erro) throw new ErroHttp(400, erro);
  if (arrobaExiste(arroba)) throw new ErroHttp(409, 'Esse @ já está em uso. Escolha outro.');
  if (emailExiste(email)) throw new ErroHttp(409, 'Já existe uma conta com esse e-mail.');
  const id = await criarConta({ nome, arroba, senha: b.senha, perfil: PERFIL_CONTA_NOVA, convite: c.codigo });
  if (!grupo.usarConvite(c.codigo)) {
    db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
    throw new ErroHttp(409, 'O convite acabou de ser usado por outra pessoa. Peça um novo.');
  }
  registrarConsentimento(id, 'termos-privacidade', 'aceitou no cadastro');
  if (b.cookies === true) registrarConsentimento(id, 'cookies', 'essenciais');
  const enviado = await enviarConfirmacao({ para: email, nome, token: criarTokenEmail(id, email), motivo: 'conta' });
  res.json({ ok: true, enviado, email });
});

app.post('/api/reenviar-confirmacao', async (req, res) => {
  const login = String(req.body?.login || '').trim().toLowerCase().replace(/^@/, '').slice(0, 200);
  // resposta sempre igual: não revela se a conta existe
  if (login && permitir(`reenvio:${req.ip}`, 5, 60 * 60_000) && permitir(`reenvio:${login}`, 3, 60 * 60_000)) {
    const u = db.prepare('SELECT id, nome FROM usuarios WHERE (arroba = ? OR usuario = ? COLLATE NOCASE) AND confirmacao_pendente = 1').get(login, login);
    const email = u && emailPendenteDe(u.id);
    if (email) await enviarConfirmacao({ para: email, nome: u.nome, token: criarTokenEmail(u.id, email), motivo: 'conta' });
  }
  res.json({ ok: true });
});

app.get('/confirmar-email/:token', (req, res) => {
  const r = consumirTokenEmail(req.params.token);
  if (!r) return res.status(400).send(paginaMensagem({ titulo: 'Link inválido ou expirado', texto: 'Este link de confirmação não vale mais. Na tela de entrada, use “Reenviar e-mail de confirmação” para receber outro.', links: [['/entrar', 'Ir para a entrada']] }));
  if (r.erro) return res.status(409).send(paginaMensagem({ titulo: 'Não deu para confirmar', texto: r.erro, links: [['/entrar', 'Ir para a entrada']] }));
  if (r.convite_pendente) {
    const g = grupo.grupoDoCodigo(r.convite_pendente);
    try { if (g) grupo.entrarNoGrupo(r.id, g); } catch {}
    limparConvitePendente(r.id);
  }
  if (!req.usuario || req.usuario.id !== r.id) criarSessao(req, res, r.id);
  registrarEvento({ usuarioId: r.id, tipo: 'conta', detalhe: 'Confirmou o e-mail' });
  res.send(paginaMensagem({ titulo: 'E-mail confirmado', texto: 'Tudo certo. Sua conta está ativa.', links: [['/grupo', 'Ver o grupo de estudos'], ['/', 'Ir para o início']] }));
});

// ---------- daqui para baixo, só com login ----------

app.use((req, res, next) => {
  if (req.usuario) return next();
  if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ erro: 'Sua sessão terminou. Entre de novo.' });
  res.redirect(303, existeUsuario() ? '/entrar' : '/configurar');
});

// Senha provisória: só a página da conta abre até a pessoa criar a própria senha.
app.use((req, res, next) => {
  if (!req.usuario.trocarSenha) return next();
  if (['/conta', '/configuracoes', '/api/conta/senha', '/api/sair', '/privacidade', '/api/cookies'].includes(req.path)) return next();
  if (req.originalUrl.startsWith('/api/')) return res.status(403).json({ erro: 'Crie a sua senha na página Conta antes de continuar.' });
  res.redirect(303, '/configuracoes');
});

const relDaRota = (req) => (Array.isArray(req.params.caminho) ? req.params.caminho.join('/') : String(req.params.caminho || ''));

app.get('/', async (req, res) => {
  const u = req.usuario;
  const totais = foco.totais(u.id);
  const cards = [];
  for (const t of trilhasDe(u)) {
    const info = await infoTrilha(u, t);
    let semana = '';
    if (info.estudos) {
      const resumo = resumir(info.estudos, await registrosDe(u, t));
      const c = resumo?.cargos?.[0];
      if (resumo && resumo.semanaAtual >= 1 && c) {
        semana = `S${resumo.semanaAtual}: ${c.atual?.q || 0}${c.atual?.metaQ ? ` de ${c.atual.metaQ}` : ''} questões · ${c.nome}`;
      }
    }
    const f = totais.porTrilha[t.slug];
    cards.push({
      slug: t.slug, nome: t.nome, mundo: t.mundo || t.nome, prova: info.estudos?.prova || null,
      provaNome: t.provaNome || t.nome, linhaPrazo: info.linhaPrazo, pct: info.pct, feitas: info.feitas, total: info.total, semana,
      focoSemana: f ? foco.formatarDuracao(f.semanaS) : null,
    });
  }
  for (const e of espaco.listarEspacos(u.id)) {
    const pr = espaco.progressoDoEspaco(u.id, e.id);
    const f = totais.porTrilha[espaco.slugEspaco(e.id)];
    cards.push({
      slug: espaco.slugEspaco(e.id), href: `/espaco/${e.id}`, cor: e.cor, espaco: true, nome: e.nome, mundo: e.nome,
      linhaPrazo: e.descricao || 'Trilha do seu espaço', pct: pr.pct, feitas: pr.feitas, total: pr.total, semana: '',
      focoSemana: f ? foco.formatarDuracao(f.semanaS) : null,
    });
  }
  const eventos = eventosRecentes(u.id, 10).map(textoEvento);
  const m = grupo.membroDe(u.id);
  const diaHoje = (await semanaDe(u, cronograma.segundaDe(hojeISO()))).dias.find((d) => d.hoje) || null;
  res.send(paginaInicio({ ...(await comum(req)), cards, eventos, totais, streak: grupo.streakDe(u.id), grupoNome: m?.grupo_nome || null, diaHoje }));
});

app.get('/t/:slug', async (req, res) => {
  const u = req.usuario;
  const t = exigirTrilha(req);
  const info = await infoTrilha(u, t);
  const arquivos = await arquivosDe(u, t);
  const registros = info.estudos ? await registrosDe(u, t) : null;
  const resumo = info.estudos ? resumir(info.estudos, registros) : null;
  const tot = foco.totais(u.id).porTrilha[t.slug] || null;
  res.send(paginaTrilha({
    ...(await comum(req)), t, info, notas: info.notas, arquivos, estudos: info.estudos, resumo, registros,
    proj: info.proj, eventos: eventosRecentes(u.id, 8, t.slug).map(textoEvento), temCSV: await temRegistro(t), focoTrilha: tot,
  }));
});

app.get('/t/:slug/n/*caminho', async (req, res) => {
  const u = req.usuario;
  const t = exigirTrilha(req);
  const rel = relDaRota(req);
  if (!podeVerArquivo(u, t.slug, rel)) throw new ErroHttp(404, 'Nota não encontrada.');
  const notaBruta = await lerNota(t, rel);
  const feitasBanco = gravaNasNotas(u) ? null : feitasNoBanco(u.id, t.slug, rel);
  const nota = feitasBanco ? { ...notaBruta, feitas: notaBruta.chaves.filter((c) => feitasBanco.has(c)).length } : notaBruta;
  const [arquivos, notas] = await Promise.all([arquivosDe(u, t), notasDe(u, t)]);
  const { html, toc } = renderizarNota(nota, {
    slug: t.slug, arquivos, notas, trilhas: trilhasDe(u), feitasBanco, podeVer: (slug, r) => podeVerArquivo(u, slug, r),
  });
  res.send(paginaNota({ ...(await comum(req)), t, nota, html, toc }));
});

app.get('/t/:slug/arquivo/*caminho', async (req, res) => {
  const t = exigirTrilha(req);
  const rel = relDaRota(req);
  if (!podeVerArquivo(req.usuario, t.slug, rel)) throw new ErroHttp(404, 'Arquivo não encontrado.');
  const abs = await caminhoSeguro(t, rel);
  const ext = path.extname(abs).toLowerCase();
  if (!EXT_SERVIDAS.has(ext)) throw new ErroHttp(403, 'Esse tipo de arquivo não é aberto pelo site.');
  const texto = ['.md', '.csv', '.txt', '.json'].includes(ext);
  if (ext === '.pdf') res.removeHeader('Content-Security-Policy'); // o leitor de PDF do navegador precisa rodar
  else res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.set('Cache-Control', 'no-cache');
  res.sendFile(abs, {
    dotfiles: 'deny',
    headers: {
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`,
      ...(texto ? { 'Content-Type': 'text/plain; charset=utf-8' } : {}),
    },
  });
});

async function assuntosPorTrilha(u) {
  const assuntos = {};
  for (const t of trilhasDe(u)) assuntos[t.slug] = await assuntosDe(u, t);
  for (const e of espaco.listarEspacos(u.id)) {
    const slug = espaco.slugEspaco(e.id);
    assuntos[slug] = [...new Set([...foco.assuntosUsados(u.id, slug), ...espaco.assuntosDoEspaco(u.id, e.id)])].slice(0, 200);
  }
  return assuntos;
}

app.get('/foco', async (req, res) => {
  const u = req.usuario;
  const trilhas = trilhasTodas(u);
  const assuntos = await assuntosPorTrilha(u);
  const pedida = String(req.query.trilha || '');
  const trilhaInicial = trilhas.find((t) => t.slug === pedida)?.slug || foco.ultimaTrilha(u.id) || trilhas[0]?.slug || '';
  res.send(paginaFoco({
    ...(await comum(req)), totais: foco.totais(u.id), recentes: foco.recentes(u.id, 20), assuntos,
    trilhaInicial: trilhas.some((t) => t.slug === trilhaInicial) ? trilhaInicial : trilhas[0]?.slug || '',
    assuntoInicial: String(req.query.assunto || '').slice(0, 100),
  }));
});

app.get('/foco/exportar.csv', (req, res) => {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sessoes-de-foco-${hojeISO()}.csv"` });
  res.send(foco.exportarCSV(req.usuario.id));
});

// ---------- caderno ----------

// O caderno saiu daqui: tudo leva ao Ayo Sketchbook (as anotações antigas foram migradas para o cofre de cada um).
const SKETCHBOOK = (process.env.SKETCHBOOK_URL || 'http://localhost:3400').replace(/\/$/, '');
app.get('/caderno', (req, res) => res.redirect(302, SKETCHBOOK));
app.get('/caderno/nova', (req, res) => {
  const titulo = String(req.query.assunto || '').slice(0, 100);
  const tag = /^[a-z0-9-]{1,30}$/.test(String(req.query.trilha || '')) ? String(req.query.trilha) : '';
  res.redirect(302, `${SKETCHBOOK}/nova?titulo=${encodeURIComponent(titulo)}${tag ? `&tags=${tag}` : ''}`);
});
app.get('/caderno/:id', (req, res) => res.redirect(302, SKETCHBOOK));
app.get('/caderno/:id/exportar.md', (req, res) => res.redirect(302, SKETCHBOOK));

app.post('/api/caderno/previa', (req, res) => {
  const texto = String(req.body?.texto ?? '');
  if (texto.length > 200_000) throw new ErroHttp(413, 'Texto grande demais.');
  res.json({ html: renderizarTexto(texto) });
});
app.post('/api/caderno', (req, res) => res.json(caderno.criar(req.usuario.id, req.body ?? {}, slugsDe(req.usuario))));
app.post('/api/caderno/:id/remover', (req, res) => { caderno.remover(req.usuario.id, idDaRota(req)); res.json({ ok: true }); });
app.post('/api/caderno/:id', (req, res) => res.json(caderno.atualizar(req.usuario.id, idDaRota(req), req.body ?? {}, slugsDe(req.usuario))));


// ---------- grupo de estudos ----------

app.get('/grupo', async (req, res) => {
  const u = req.usuario;
  const m = grupo.membroDe(u.id);
  let dados = {};
  if (m?.consentiu) {
    dados = {
      membros: grupo.membrosVisiveis(u.id),
      mural: grupo.mural(u.id, { nomeTrilha: nomeTrilhaCompartilhada }),
      convites: grupo.convitesDoGrupo(u.id),
    };
  }
  res.send(paginaGrupo({ ...(await comum(req)), membro: m, ...dados, base: urlPublica(), streak: grupo.streakDe(u.id) }));
});

app.get('/grupo/:arroba', async (req, res) => {
  const u = req.usuario;
  const alvo = grupo.membroVisivel(u.id, req.params.arroba);
  if (!alvo) throw new ErroHttp(404, 'Pessoa não encontrada no seu grupo.');
  const mural = alvo.compartilhaTempo ? grupo.mural(u.id, { soDe: alvo.id, limite: 100, nomeTrilha: nomeTrilhaCompartilhada }) : [];
  res.send(paginaMembro({ ...(await comum(req)), alvo, mural }));
});

app.post('/api/grupo/criar', (req, res) => { grupo.criarGrupo(req.usuario.id, req.body?.nome); res.json({ ok: true }); });
app.post('/api/grupo/compartilhamento', (req, res) => {
  const b = req.body ?? {};
  grupo.definirCompartilhamento(req.usuario.id, { tempo: b.tempo === true, trilha: b.trilha === true, assunto: b.assunto === true });
  res.json({ ok: true });
});
app.post('/api/grupo/sair', (req, res) => { grupo.sairDoGrupo(req.usuario.id); res.json({ ok: true }); });
app.post('/api/grupo/remover', (req, res) => { grupo.removerMembro(req.usuario.id, Number(req.body?.id)); res.json({ ok: true }); });
app.post('/api/grupo/convite', (req, res) => {
  const codigo = grupo.criarConvite(req.usuario.id, { horas: req.body?.horas, usos: req.body?.usos });
  res.json({ ok: true, codigo, link: `${urlPublica()}/convite/${codigo}` });
});
app.post('/api/grupo/convite/revogar', (req, res) => { grupo.revogarConvite(req.usuario.id, req.body?.codigo); res.json({ ok: true }); });
app.post('/api/convite/aceitar', (req, res) => {
  const c = grupo.conviteValido(req.body?.codigo);
  if (!c) throw new ErroHttp(404, 'Convite inválido, expirado ou já usado.');
  grupo.entrarNoGrupo(req.usuario.id, c.grupo_id);
  grupo.usarConvite(c.codigo);
  res.json({ ok: true });
});

// ---------- meu espaço ----------

const idDaRota = (req) => {
  if (!/^\d{1,12}$/.test(req.params.id)) throw new ErroHttp(404, 'Trilha não encontrada.');
  return Number(req.params.id);
};

app.get('/espaco', async (req, res) => {
  const u = req.usuario;
  const espacos = espaco.listarEspacos(u.id).map((e) => ({ ...e, ...espaco.progressoDoEspaco(u.id, e.id) }));
  res.send(paginaEspacos({ ...(await comum(req)), espacos, cores: espaco.CORES }));
});
app.get('/espaco/:id', async (req, res) => {
  const u = req.usuario;
  const e = espaco.obterEspaco(u.id, idDaRota(req));
  res.send(paginaEspaco({ ...(await comum(req)), e, notas: espaco.notasDoEspaco(u.id, e.id), cores: espaco.CORES, progresso: espaco.progressoDoEspaco(u.id, e.id) }));
});
const notaDaRota = (req) => {
  if (!/^\d{1,12}$/.test(req.params.nid)) throw new ErroHttp(404, 'Nota não encontrada.');
  return Number(req.params.nid);
};
app.get('/espaco/:id/nota/:nid', async (req, res) => {
  const u = req.usuario;
  const e = espaco.obterEspaco(u.id, idDaRota(req));
  const n = espaco.obterNota(u.id, e.id, notaDaRota(req));
  const { html, toc } = renderizarEspacoNota(n);
  res.send(paginaEspacoNota({ ...(await comum(req)), e, n, html, toc }));
});
app.get('/espaco/:id/nota/:nid/editar', async (req, res) => {
  const u = req.usuario;
  const e = espaco.obterEspaco(u.id, idDaRota(req));
  res.send(paginaEspacoNotaEditar({ ...(await comum(req)), e, n: espaco.obterNota(u.id, e.id, notaDaRota(req)) }));
});
app.post('/api/espaco', (req, res) => res.json({ ok: true, id: espaco.criarEspaco(req.usuario.id, req.body ?? {}) }));
app.post('/api/espaco/:id', (req, res) => { espaco.editarEspaco(req.usuario.id, idDaRota(req), req.body ?? {}); res.json({ ok: true }); });
app.post('/api/espaco/:id/remover', (req, res) => { espaco.removerEspaco(req.usuario.id, idDaRota(req)); res.json({ ok: true }); });
app.post('/api/espaco/:id/nota', (req, res) => {
  const id = idDaRota(req);
  res.json({ ok: true, id, nota: espaco.criarNota(req.usuario.id, id, req.body ?? {}) });
});
app.post('/api/espaco/:id/nota/:nid', (req, res) => {
  espaco.salvarNota(req.usuario.id, idDaRota(req), notaDaRota(req), req.body ?? {});
  res.json({ ok: true });
});
app.post('/api/espaco/:id/nota/:nid/remover', (req, res) => { espaco.removerNota(req.usuario.id, idDaRota(req), notaDaRota(req)); res.json({ ok: true }); });
app.post('/api/espaco/:id/nota/:nid/tarefa', (req, res) => {
  const { linha, hash, marcado } = req.body ?? {};
  if (typeof hash !== 'string' || typeof marcado !== 'boolean') throw new ErroHttp(400, 'Pedido incompleto.');
  const r = espaco.alternarTarefaEspaco(req.usuario.id, idDaRota(req), notaDaRota(req), Number(linha), hash, marcado);
  agendarPelaTarefa(req.usuario, espaco.slugEspaco(idDaRota(req)), r.texto, `nota-${notaDaRota(req)}`, marcado);
  res.json({ ok: true, hash: r.hash, feitas: r.feitas, total: r.total, almas: null });
});

// ---------- cronograma da semana ----------

const numeroDaRota = (req, mensagem) => {
  if (!/^\d{1,12}$/.test(req.params.id)) throw new ErroHttp(404, mensagem);
  return Number(req.params.id);
};

app.get('/cronograma', async (req, res) => {
  const u = req.usuario;
  const pedida = String(req.query.semana || '');
  const base = /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(pedida) ? pedida : hojeISO();
  const segunda = cronograma.segundaDe(base);
  res.send(paginaCronograma({
    ...(await comum(req)), semana: await semanaDe(u, segunda), temModelo: cronograma.blocosDe(u.id).length > 0,
    anterior: somarDias(segunda, -7), proxima: somarDias(segunda, 7), ehAtual: segunda === cronograma.segundaDe(hojeISO()),
  }));
});

app.get('/cronograma/modelo', async (req, res) => {
  const u = req.usuario;
  const { escolhas, colunas } = await opcoesDoModelo(u);
  res.send(paginaCronogramaModelo({ ...(await comum(req)), blocos: cronograma.blocosDe(u.id), escolhas, colunas }));
});

app.post('/api/cronograma/blocos', async (req, res) => {
  const u = req.usuario;
  const { validas } = await opcoesDoModelo(u);
  res.json({ ok: true, criados: cronograma.criarBlocos(u.id, req.body ?? {}, slugsDe(u), validas) });
});
app.post('/api/cronograma/blocos/:id', async (req, res) => {
  const u = req.usuario;
  const { validas } = await opcoesDoModelo(u);
  cronograma.editarBloco(u.id, numeroDaRota(req, 'Bloco não encontrado.'), req.body ?? {}, slugsDe(u), validas);
  res.json({ ok: true });
});
app.post('/api/cronograma/blocos/:id/remover', (req, res) => {
  cronograma.removerBloco(req.usuario.id, numeroDaRota(req, 'Bloco não encontrado.'));
  res.json({ ok: true });
});
app.post('/api/cronograma/blocos/:id/mover', (req, res) => {
  cronograma.moverBloco(req.usuario.id, numeroDaRota(req, 'Bloco não encontrado.'), req.body?.direcao);
  res.json({ ok: true });
});
app.post('/api/cronograma/feito', (req, res) => {
  const b = req.body ?? {};
  cronograma.marcarFeito(req.usuario.id, Number(b.bloco), String(b.data || ''), b.feito === true);
  res.json({ ok: true });
});

// ---------- revisões espaçadas ----------

app.get('/revisoes', async (req, res) => {
  const u = req.usuario;
  const escolhas = trilhasTodas(u);
  const slugs = escolhas.map((t) => t.slug);
  const filtro = slugs.includes(String(req.query.trilha || '')) ? String(req.query.trilha) : '';
  res.send(paginaRevisoes({
    ...(await comum(req)), lista: revisoes.listar(u.id, slugs), arquivadas: revisoes.listar(u.id, slugs, { arquivadas: true }),
    ajustes: revisoes.ajustesDe(u.id), escolhas, filtro, feitasHoje: revisoes.feitasNoDia(u.id, hojeISO()),
  }));
});

app.post('/api/revisoes', (req, res) => {
  const r = revisoes.adicionarManual(req.usuario.id, req.body ?? {}, slugsDe(req.usuario));
  res.json({ ok: true, proxima: r.proxima });
});
app.post('/api/revisoes/ajustes', (req, res) => { revisoes.salvarAjustes(req.usuario.id, req.body ?? {}); res.json({ ok: true }); });
app.post('/api/revisoes/:id/resultado', (req, res) => {
  const r = revisoes.revisar(req.usuario.id, numeroDaRota(req, 'Revisão não encontrada.'), String(req.body?.resultado || ''));
  res.json({ ok: true, proxima: r.proxima, etapa: r.etapa });
});
app.post('/api/revisoes/:id/adiar', (req, res) => res.json({ ok: true, ...revisoes.adiar(req.usuario.id, numeroDaRota(req, 'Revisão não encontrada.'), req.body?.dias) }));
app.post('/api/revisoes/:id/arquivar', (req, res) => { revisoes.arquivar(req.usuario.id, numeroDaRota(req, 'Revisão não encontrada.'), true); res.json({ ok: true }); });
app.post('/api/revisoes/:id/restaurar', (req, res) => { revisoes.arquivar(req.usuario.id, numeroDaRota(req, 'Revisão não encontrada.'), false); res.json({ ok: true }); });
app.post('/api/revisoes/:id/remover', (req, res) => { revisoes.remover(req.usuario.id, numeroDaRota(req, 'Revisão não encontrada.')); res.json({ ok: true }); });

// ---------- IA ----------

// Material de referência: nota de um cofre visível ou nota do próprio Meu espaço.
async function lerMaterial(u, slug, valor) {
  const m = /^(nota|espaco):(.{1,400})$/.exec(valor);
  if (!m) throw new ErroHttp(400, 'Material inválido.');
  if (m[1] === 'nota') {
    const t = acharTrilha(slug);
    if (!t || !podeVerTrilha(u, t.slug) || !podeVerArquivo(u, t.slug, m[2])) throw new ErroHttp(404, 'Nota não encontrada.');
    const nota = await lerNota(t, m[2]);
    return { titulo: nota.tituloCurto, texto: nota.corpo, origem: `nota do cofre ${t.nome}` };
  }
  const eid = espaco.idDoSlug(slug);
  if (!eid || !/^\d{1,12}$/.test(m[2])) throw new ErroHttp(404, 'Nota não encontrada.');
  const n = espaco.obterNota(u.id, eid, Number(m[2]));
  return { titulo: n.titulo, texto: n.texto, origem: 'nota do Meu espaço' };
}

async function pedidoIA(u, b) {
  const tarefa = String(b.tarefa || '');
  const modo = String(b.modo || '');
  if (!Object.hasOwn(ia.TAREFAS, tarefa)) throw new ErroHttp(400, 'Escolha a tarefa.');
  if (!Object.hasOwn(ia.MODOS, modo)) throw new ErroHttp(400, 'Escolha o modo de raciocínio.');
  const slug = String(b.trilha || '');
  const trilha = slug ? trilhasTodas(u).find((t) => t.slug === slug) : null;
  if (slug && !trilha) throw new ErroHttp(400, 'Trilha inválida.');
  const assunto = String(b.assunto || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  const cofre = trilha && !trilha.espaco ? acharTrilha(slug) : null;
  const estudos = cofre ? estudosDe(u, cofre, await lerEstudos(cofre)) : null;
  let material = null;
  if (b.material) {
    const m = await lerMaterial(u, slug, String(b.material));
    const r = ia.recortarMaterial(m.texto, String(b.secao || ''));
    if (!r.texto) throw new ErroHttp(400, 'O material escolhido está vazio.');
    ia.conferirTamanho(r.texto);
    material = { ...m, texto: r.texto, secao: r.secao };
  }
  if (!assunto && !material) throw new ErroHttp(400, 'Escreva o assunto ou escolha um material de referência.');
  const cargos = Object.keys(estudos?.cargos || {});
  const cargo = cargos.includes(String(b.cargo)) ? nomeCargo(String(b.cargo)) : cargos.length === 1 ? nomeCargo(cargos[0]) : '';
  const pedido = ia.montarPedido({
    tarefa, modo, assunto, trilha, concurso: estudos?.concurso || '', cargo,
    estilo: Object.hasOwn(ia.ESTILOS, b.estilo) ? String(b.estilo) : ia.estiloDe(estudos),
    quantidade: ia.QUANTIDADES.includes(Number(b.quantidade)) ? Number(b.quantidade) : 5,
    dificuldade: Object.hasOwn(ia.DIFICULDADES, b.dificuldade) ? String(b.dificuldade) : 'misto',
    material,
  });
  const info = { tarefa, modo, trilha: slug || null, assunto, material: material ? `${material.titulo}${material.secao ? ` › ${material.secao}` : ''}` : null };
  return { pedido, info };
}

app.get('/ia', async (req, res) => {
  const u = req.usuario;
  const estado = ia.estadoIA(u);
  const materiais = [];
  const dados = { trilhas: {}, podeGerar: estado.podeGerar, modos: Object.fromEntries(Object.entries(ia.MODOS).map(([k, m]) => [k, m.descricao])) };
  for (const t of trilhasDe(u)) {
    for (const n of await notasDe(u, t)) materiais.push({ trilha: t.slug, valor: `nota:${n.rel}`, titulo: n.tituloCurto });
    const estudos = estudosDe(u, t, await lerEstudos(t));
    dados.trilhas[t.slug] = { estilo: ia.estiloDe(estudos), cargos: Object.keys(estudos?.cargos || {}).map((c) => ({ chave: c, nome: nomeCargo(c) })) };
  }
  for (const e of espaco.listarEspacos(u.id)) {
    const slug = espaco.slugEspaco(e.id);
    for (const n of espaco.notasDoEspaco(u.id, e.id)) materiais.push({ trilha: slug, valor: `espaco:${n.id}`, titulo: n.titulo });
    dados.trilhas[slug] = { estilo: 'tecnico', cargos: [] };
  }
  const escolhas = trilhasTodas(u);
  const ultima = foco.ultimaTrilha(u.id);
  res.send(paginaIA({
    ...(await comum(req)), estado, escolhas, materiais, assuntos: await assuntosPorTrilha(u), dados,
    trilhaInicial: escolhas.some((t) => t.slug === ultima) ? ultima : escolhas[0]?.slug || '',
    historico: ia.historico(u.id), gasto: ia.gastoDoMes(), hojeN: ia.pedidosHoje(u.id), regras: ia.regras(),
  }));
});

app.get('/ia/:id', async (req, res) => {
  const p = ia.obterPedido(req.usuario.id, numeroDaRota(req, 'Resposta não encontrada.'));
  const questoes = p.tarefa === 'questoes' && p.estado === 'ok' ? ia.questoesDe(p) : null;
  res.send(paginaIAResultado({
    ...(await comum(req)), pedido: p,
    conteudoHtml: questoes ? htmlQuestoes(questoes) : p.resposta ? renderizarTexto(p.resposta) : '',
    raciocinioHtml: p.raciocinio ? renderizarTexto(p.raciocinio) : '',
  }));
});

app.get('/api/ia/secoes', async (req, res) => {
  const valor = String(req.query.material || '');
  if (!valor) return res.json({ secoes: [] });
  const m = await lerMaterial(req.usuario, String(req.query.trilha || ''), valor);
  res.json({ secoes: ia.secoesDoTexto(m.texto).map(({ id, titulo, nivel }) => ({ id, titulo, nivel })), caracteres: m.texto.length });
});

app.post('/api/ia/prompt', async (req, res) => {
  const { pedido } = await pedidoIA(req.usuario, req.body ?? {});
  res.json({ ok: true, prompt: pedido.previa, parametros: pedido.parametros });
});

// Resposta em NDJSON: uma linha por evento ("texto", "pensando", "ping", "fim" ou "erro"), para mostrar a
// resposta enquanto ela é escrita e manter a conexão viva durante o raciocínio longo.
app.post('/api/ia/gerar', async (req, res) => {
  const u = req.usuario;
  ia.exigirPodeGerar(u);
  const { pedido, info } = await pedidoIA(u, req.body ?? {});
  res.status(200).set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const enviar = (o) => { if (!res.writableEnded) res.write(`${JSON.stringify(o)}\n`); };
  const controle = new AbortController();
  res.on('close', () => { if (!res.writableFinished) controle.abort(); });
  const ping = setInterval(() => enviar({ t: 'ping' }), 15000);
  enviar({ t: 'inicio', parametros: pedido.parametros });
  try {
    const r = await ia.gerar(u.id, pedido, info, {
      aoTexto: (d) => enviar({ t: 'texto', d }), aoPensar: (d) => enviar({ t: 'pensando', d }), signal: controle.signal,
    });
    if (['ok', 'cortado', 'recusado'].includes(r.estado)) {
      enviar({
        t: 'fim', id: r.id, estado: r.estado, erro: r.erro, modelo: r.modelo, custo: r.custo,
        html: r.questoes ? htmlQuestoes(r.questoes) : renderizarTexto(r.resposta || ''),
        raciocinio: r.raciocinio ? renderizarTexto(r.raciocinio) : '',
        uso: { entrada: r.uso?.input_tokens || 0, saida: r.uso?.output_tokens || 0, cache: r.uso?.cache_read_input_tokens || 0 },
      });
    } else {
      enviar({ t: 'erro', id: r.id, erro: r.erro });
    }
  } finally {
    clearInterval(ping);
    res.end();
  }
});

app.post('/api/ia/:id/remover', (req, res) => { ia.removerPedido(req.usuario.id, numeroDaRota(req, 'Resposta não encontrada.')); res.json({ ok: true }); });
app.post('/api/ia/:id/revisao', (req, res) => {
  const u = req.usuario;
  const p = ia.obterPedido(u.id, numeroDaRota(req, 'Resposta não encontrada.'));
  const assunto = p.assunto || p.material;
  if (!p.trilha || !assunto || !slugsDe(u).includes(p.trilha)) throw new ErroHttp(400, 'Esta resposta não tem trilha e assunto para agendar.');
  const r = revisoes.registrarEstudo(u.id, { trilha: p.trilha, assunto, origem: 'ia', ref: `ia-${p.id}` });
  res.json({ ok: true, proxima: r?.proxima || null });
});

app.get('/conta', (req, res) => res.redirect(301, '/configuracoes'));
app.get('/configuracoes', async (req, res) => {
  const u = req.usuario;
  res.send(paginaConfiguracoes({
    ...(await comum(req)), conta: dadosDaConta(u.id), emailPendente: emailPendenteDe(u.id), membro: grupo.membroDe(u.id),
    usuarios: u.dono ? listarUsuarios() : null, perfis: nomesPerfis(), emailAtivo: emailConfigurado(), ajustesRevisoes: revisoes.ajustesDe(u.id),
  }));
});

app.get('/configuracoes/meus-dados.json', (req, res) => {
  const id = req.usuario.id;
  const tudo = (sql) => db.prepare(sql).all(id);
  const dados = {
    exportado_em: new Date().toISOString(),
    conta: dadosDaConta(id),
    grupo: grupo.membroDe(id),
    pomodoros: tudo('SELECT * FROM pomodoros WHERE usuario_id = ?'),
    caderno: tudo('SELECT * FROM caderno WHERE usuario_id = ?'),
    espacos: tudo('SELECT * FROM espacos WHERE usuario_id = ?'),
    espaco_notas: tudo('SELECT * FROM espaco_notas WHERE usuario_id = ?'),
    progresso: tudo('SELECT * FROM progresso WHERE usuario_id = ?'),
    eventos: tudo('SELECT * FROM eventos WHERE usuario_id = ?'),
    consentimentos: tudo('SELECT * FROM consentimentos WHERE usuario_id = ?'),
    cronograma_blocos: tudo('SELECT * FROM cronograma_blocos WHERE usuario_id = ?'),
    cronograma_feitos: tudo('SELECT * FROM cronograma_feitos WHERE usuario_id = ?'),
    revisoes: tudo('SELECT * FROM revisoes WHERE usuario_id = ?'),
    revisoes_log: tudo('SELECT * FROM revisoes_log WHERE usuario_id = ?'),
    ia_pedidos: tudo('SELECT * FROM ia_pedidos WHERE usuario_id = ?'),
  };
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="meus-dados-ayo-std-${hojeISO()}.json"` });
  res.send(JSON.stringify(dados, null, 2));
});

// ---------- API: tarefas, questões, ritmo ----------

// Tarefa marcada vira revisão espaçada; desmarcada, some a revisão que ainda não foi feita nenhuma vez.
function agendarPelaTarefa(u, slug, texto, ref, marcado) {
  try {
    if (marcado) revisoes.registrarEstudo(u.id, { trilha: slug, assunto: texto, origem: 'tarefa', ref });
    else revisoes.desfazerTarefa(u.id, { trilha: slug, assunto: texto, ref });
  } catch (e) { console.error('[revisoes]', e); }
}

// Questões do tópico (ou da matéria): abaixo da meta da semana, o assunto volta amanhã.
function agendarPelasQuestoes(u, t, r) {
  if (/^reda[çc][ãa]o/i.test(r.materia)) return;
  lerEstudos(t).then((estudos) => {
    const meta = metaPctNa(estudos, r.data) ?? 70;
    const pct = r.questoes ? (100 * r.acertos) / r.questoes : 0;
    revisoes.registrarEstudo(u.id, { trilha: t.slug, assunto: r.topico || r.materia, origem: 'questoes', desempenho: pct < meta ? 'ruim' : 'bom' });
  }).catch((e) => console.error('[revisoes]', e));
}

app.post('/api/t/:slug/tarefa', async (req, res) => {
  const u = req.usuario;
  const t = exigirTrilha(req);
  const { arquivo, linha, hash, chave, marcado } = req.body ?? {};
  if (typeof arquivo !== 'string' || typeof marcado !== 'boolean') throw new ErroHttp(400, 'Pedido incompleto.');
  if (!podeVerArquivo(u, t.slug, arquivo)) throw new ErroHttp(404, 'Nota não encontrada.');
  let feitas;
  let total;
  let texto;
  let novoHash;
  if (gravaNasNotas(u)) {
    if (typeof hash !== 'string') throw new ErroHttp(400, 'Pedido incompleto.');
    const r = await alternarTarefa(t, arquivo, Number(linha), hash, marcado);
    ({ feitas, total, texto } = r);
    novoHash = r.hash;
  } else {
    if (typeof chave !== 'string') throw new ErroHttp(400, 'Pedido incompleto.');
    const nota = await lerNota(t, arquivo);
    const achada = [...nota.chavePorLinha].find(([, c]) => c === chave);
    if (!achada) throw new ErroHttp(409, 'Esta nota mudou depois que a página abriu.');
    marcarNoBanco(u.id, t.slug, arquivo, chave, marcado);
    const set = feitasNoBanco(u.id, t.slug, arquivo);
    feitas = nota.chaves.filter((c) => set.has(c)).length;
    total = nota.total;
    const l = nota.linhas[achada[0]].replace(/\r$/, '');
    texto = l.slice((RE_TAREFA.exec(l)?.[0] || '').length).trim();
  }
  registrarEvento({
    usuarioId: u.id, trilha: t.slug, tipo: 'tarefa', arquivo,
    detalhe: `${marcado ? 'Concluiu' : 'Desmarcou'}: ${texto.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`#]/g, '').slice(0, 140)}`,
  });
  agendarPelaTarefa(u, t.slug, texto, arquivo, marcado);
  res.json({ ok: true, hash: novoHash, feitas, total, almas: temaDe(u) === 'pixel' ? await contarAlmas(u) : null });
});

app.post('/api/t/:slug/registro', async (req, res) => {
  const u = req.usuario;
  const t = exigirTrilha(req);
  const { erro, registro } = validarRegistro(req.body ?? {}, await lerEstudos(t), cargosPermitidos(u, t.slug));
  if (erro) throw new ErroHttp(400, erro);
  await adicionarRegistro(t, registro);
  agendarPelasQuestoes(u, t, registro);
  registrarEvento({
    usuarioId: u.id, trilha: t.slug, tipo: 'registro', arquivo: 'registro-questoes.csv',
    detalhe: `Registrou ${registro.acertos}/${registro.questoes} em ${registro.materia} (${nomeCargo(registro.cargo)})`,
  });
  res.json({ ok: true });
});

app.post('/api/t/:slug/registro/remover', async (req, res) => {
  const u = req.usuario;
  const t = exigirTrilha(req);
  const { linha, hash } = req.body ?? {};
  if (typeof hash !== 'string') throw new ErroHttp(400, 'Pedido incompleto.');
  const cs = cargosPermitidos(u, t.slug);
  const removida = await removerRegistro(t, Number(linha), hash, (r) => !cs || cs.includes(r.cargo));
  registrarEvento({ usuarioId: u.id, trilha: t.slug, tipo: 'remocao', arquivo: 'registro-questoes.csv', detalhe: `Removeu o registro ${removida.slice(0, 120)}` });
  res.json({ ok: true });
});

app.post('/api/t/:slug/projecao', (req, res) => {
  const t = exigirTrilha(req);
  if (!gravaNasNotas(req.usuario)) throw new ErroHttp(403, 'Seu perfil não altera o ritmo desta trilha.');
  const ritmo = Number(req.body?.ritmo);
  const inicio = String(req.body?.inicio || '');
  if (![5, 8, 10, 15, 20, 25, 30, 40].includes(ritmo)) throw new ErroHttp(400, 'Ritmo inválido.');
  if (inicio && !/^\d{4}-\d{2}-\d{2}$/.test(inicio)) throw new ErroHttp(400, 'Data inválida.');
  gravarAjuste(`projecao:${t.slug}`, { ritmo, inicio });
  res.json({ ok: true });
});

// ---------- API: pomodoro ----------

app.post('/api/foco/iniciar', (req, res) => { foco.iniciar(req.usuario.id, req.body ?? {}, slugsDe(req.usuario)); res.json({ ok: true }); });
app.post('/api/foco/pausar', (req, res) => { foco.pausar(req.usuario.id, req.body?.id); res.json({ ok: true }); });
app.post('/api/foco/retomar', (req, res) => { foco.retomar(req.usuario.id, req.body?.id); res.json({ ok: true }); });
app.post('/api/foco/cancelar', (req, res) => { foco.cancelar(req.usuario.id, req.body?.id); res.json({ ok: true }); });
app.post('/api/foco/concluir', (req, res) => {
  const r = foco.concluir(req.usuario.id, req.body?.id, req.body?.automatico === true);
  const s = r.sessao;
  res.json({ ok: true, jaConcluida: !!r.jaConcluida, curta: !!r.curta, tipo: s.tipo, assunto: s.assunto, minutos: Math.round((s.foco_s || 0) / 60) });
});
app.post('/api/foco/manual', (req, res) => { foco.registrarManual(req.usuario.id, req.body ?? {}, slugsDe(req.usuario)); res.json({ ok: true }); });
app.post('/api/foco/remover', (req, res) => { foco.remover(req.usuario.id, req.body?.id); res.json({ ok: true }); });
app.get('/api/foco', (req, res) => res.json({ sessao: foco.sessaoAtiva(req.usuario.id), agora: Date.now() }));

// ---------- API: conta ----------

async function conferirIdentidade(req, senha) {
  const espera = esperaBloqueio(req.ip);
  if (espera) throw new ErroHttp(429, `Muitas tentativas. Tente de novo em ${Math.ceil(espera / 60)} min.`);
  if (typeof senha !== 'string' || !(await conferirSenhaDoUsuario(req.usuario.id, senha.slice(0, 200)))) {
    registrarFalha(req.ip);
    throw new ErroHttp(401, 'A senha atual está incorreta.');
  }
  limparFalhas(req.ip);
}

app.post('/api/conta/nome', async (req, res) => {
  const novo = String(req.body?.usuario || '').trim();
  const erro = validarUsuario(novo);
  if (erro) throw new ErroHttp(400, erro);
  await conferirIdentidade(req, req.body?.senha);
  if (usuarioExiste(novo, req.usuario.id)) throw new ErroHttp(409, 'Esse nome de usuário já está em uso.');
  renomearUsuario(req.usuario.id, novo);
  registrarEvento({ usuarioId: req.usuario.id, tipo: 'conta', detalhe: `Trocou o nome de usuário para ${novo}` });
  res.json({ ok: true });
});

app.post('/api/conta/senha', async (req, res) => {
  const { atual, nova, confirmacao } = req.body ?? {};
  const erro = validarSenha(nova) || (nova !== confirmacao ? 'As senhas novas não são iguais.' : null) || (nova === atual ? 'A senha nova precisa ser diferente da atual.' : null);
  if (erro) throw new ErroHttp(400, erro);
  await conferirIdentidade(req, atual);
  await trocarSenhaPorId(req.usuario.id, nova, req.sessaoHash);
  registrarEvento({ usuarioId: req.usuario.id, tipo: 'conta', detalhe: 'Trocou a senha' });
  res.json({ ok: true });
});

app.post('/api/conta/perfil', async (req, res) => {
  const u = req.usuario;
  const nome = String(req.body?.nome || '').trim();
  const arroba = String(req.body?.arroba || '').trim().toLowerCase().replace(/^@/, '');
  const erroNome = validarNome(nome);
  if (erroNome) throw new ErroHttp(400, erroNome);
  if (arroba !== u.arroba) {
    const erro = validarArroba(arroba, { permitirReservado: u.dono });
    if (erro) throw new ErroHttp(400, erro);
    await conferirIdentidade(req, req.body?.senha);
    if (arrobaExiste(arroba, u.id)) throw new ErroHttp(409, 'Esse @ já está em uso.');
  }
  definirPerfilPublico(u.id, { nome, arroba });
  res.json({ ok: true });
});

app.post('/api/conta/email', async (req, res) => {
  const u = req.usuario;
  const email = String(req.body?.email || '').trim().toLowerCase();
  const erro = validarEmail(email);
  if (erro) throw new ErroHttp(400, erro);
  await conferirIdentidade(req, req.body?.senha);
  if (emailExiste(email, u.id)) throw new ErroHttp(409, 'Esse e-mail já está em uso por outra conta.');
  if (!permitir(`email:${u.id}`, 5, 60 * 60_000)) throw new ErroHttp(429, 'Muitos pedidos de troca de e-mail. Tente em 1 hora.');
  const enviado = await enviarConfirmacao({ para: email, nome: u.nome, token: criarTokenEmail(u.id, email), motivo: 'troca' });
  res.json({ ok: true, enviado });
});

app.post('/api/conta/tema', (req, res) => {
  if (!temaExiste(req.body?.tema)) throw new ErroHttp(400, 'Tema desconhecido.');
  definirTema(req.usuario.id, req.body?.tema);
  res.json({ ok: true });
});

app.post('/api/conta/excluir', async (req, res) => {
  const u = req.usuario;
  if (u.dono) throw new ErroHttp(400, 'A conta do dono do site não pode ser excluída por aqui.');
  await conferirIdentidade(req, req.body?.senha);
  grupo.sairDoGrupo(u.id);
  db.prepare('DELETE FROM eventos WHERE usuario_id = ?').run(u.id);
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(u.id);
  encerrarSessao(req, res);
  res.json({ ok: true });
});

app.post('/api/conta/usuarios/confirmar', (req, res) => {
  exigirDono(req);
  confirmarManualmente(Number(req.body?.id));
  res.json({ ok: true });
});

function exigirDono(req) {
  if (!req.usuario.dono) throw new ErroHttp(403, 'Só o dono do site gerencia as contas.');
}

app.post('/api/conta/usuarios', async (req, res) => {
  exigirDono(req);
  const usuario = String(req.body?.usuario || '').trim();
  const { senha, perfil } = req.body ?? {};
  const erro = validarUsuario(usuario) || validarSenha(senha) || (!nomesPerfis().some((p) => p.chave === perfil) ? 'Escolha um perfil.' : null);
  if (erro) throw new ErroHttp(400, erro);
  if (usuarioExiste(usuario)) throw new ErroHttp(409, 'Esse nome de usuário já está em uso.');
  await criarUsuario(usuario, senha, { perfil, trocarSenha: true });
  registrarEvento({ usuarioId: req.usuario.id, tipo: 'conta', detalhe: `Criou a conta ${usuario} (${perfil})` });
  res.json({ ok: true });
});

app.post('/api/conta/usuarios/redefinir', async (req, res) => {
  exigirDono(req);
  const id = Number(req.body?.id);
  const erro = validarSenha(req.body?.senha);
  if (erro) throw new ErroHttp(400, erro);
  const alvo = listarUsuarios().find((x) => x.id === id);
  if (!alvo || alvo.id === req.usuario.id) throw new ErroHttp(400, 'Escolha outra conta (a sua senha se troca no formulário acima).');
  await redefinirSenha(id, req.body.senha);
  registrarEvento({ usuarioId: req.usuario.id, tipo: 'conta', detalhe: `Redefiniu a senha de ${alvo.usuario}` });
  res.json({ ok: true });
});

app.post('/api/conta/usuarios/remover', (req, res) => {
  exigirDono(req);
  const id = Number(req.body?.id);
  const alvo = listarUsuarios().find((x) => x.id === id);
  if (!alvo || alvo.dono) throw new ErroHttp(400, 'Essa conta não pode ser removida.');
  removerUsuario(id);
  registrarEvento({ usuarioId: req.usuario.id, tipo: 'conta', detalhe: `Removeu a conta ${alvo.usuario}` });
  res.json({ ok: true });
});

// ---------- erros ----------

app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
app.use(async (req, res) => {
  res.status(404).send(paginaErro({ status: 404, ...(req.usuario ? await comum(req) : {}) }));
});

app.use(async (err, req, res, next) => {
  if (res.headersSent) return next(err);
  let status = err instanceof ErroHttp ? err.status : err.type === 'entity.too.large' ? 413 : err.type === 'entity.parse.failed' ? 400 : 500;
  if (err.status === 404 || err.code === 'ENOENT') status = 404;
  if (status === 500) console.error('[erro]', req.method, req.originalUrl, err);
  const mensagem = status === 500 ? 'Erro interno. Nada foi gravado pela metade.' : err.message;
  if (req.originalUrl.startsWith('/api/')) return res.status(status).json({ erro: mensagem });
  try {
    res.status(status).send(paginaErro({ status, ...(req.usuario ? await comum(req) : {}) }));
  } catch {
    res.status(status).type('text').send(mensagem);
  }
});

const servidor = app.listen(config.porta, config.host, () => {
  console.log(`[ayo-std] ouvindo em http://${config.host}:${config.porta} · dados em ${config.dataDir}`);
  console.log(`[ayo-std] trilhas: ${listarTrilhas().map((t) => `${t.slug} → ${t.pasta}`).join(' | ')}`);
});

function desligar(sinal) {
  console.log(`[ayo-std] ${sinal} recebido, encerrando…`);
  servidor.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', desligar);
process.on('SIGINT', desligar);
// Erro inesperado: registra e sai; o systemd sobe de novo em seguida, com estado limpo.
process.on('uncaughtException', (e) => { console.error('[fatal]', e); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('[fatal]', e); process.exit(1); });
