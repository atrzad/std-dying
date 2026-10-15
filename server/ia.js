// IA (Claude, da Anthropic) para analisar assuntos, criar resumos e criar questões.
// Fica desligada até existir ANTHROPIC_API_KEY no .env; enquanto isso, a página monta o prompt para copiar.
// Regras fixas em config/ia-regras.md; modelo, esforço de cada modo, limites e preços em config/ia.json.
// A chamada roda só no servidor (a chave nunca vai ao navegador) e cada pedido fica salvo com custo e tokens.
import fs from 'node:fs';
import path from 'node:path';
import Anthropic, {
  APIUserAbortError, AuthenticationError, PermissionDeniedError, RateLimitError, BadRequestError,
  APIConnectionTimeoutError, APIConnectionError, InternalServerError, APIError,
} from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { config } from './config.js';
import { db } from './db.js';
import { ErroHttp } from './cofres.js';
import { slugTexto } from './markdown.js';

const PADRAO = {
  ativa: true,
  modelo: 'claude-opus-5-5',
  esforco: { baixo: 'low', medio: 'medium', alto: 'high' },
  maxTokens: 64000,
  perfis: ['completo'],
  limiteDiarioPorPessoa: 40,
  orcamentoMensalUSD: 15,
  maxCaracteresMaterial: 80000,
  precosUSDporMilhao: { 'claude-opus-5-5': { entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 5 } },
};
let CONF = PADRAO;
let REGRAS = '';

export function carregarIA() {
  const arq = path.join(config.raiz, 'config/ia.json');
  CONF = { ...PADRAO, ...(fs.existsSync(arq) ? JSON.parse(fs.readFileSync(arq, 'utf8')) : {}) };
  CONF.esforco = { ...PADRAO.esforco, ...CONF.esforco };
  REGRAS = fs.readFileSync(path.join(config.raiz, 'config/ia-regras.md'), 'utf8').trim();
  // pedido que ficou "rodando" quando o serviço caiu nunca vai terminar
  db.prepare("UPDATE ia_pedidos SET estado = 'erro', erro = 'Interrompido: o serviço reiniciou no meio do pedido.' WHERE estado = 'rodando'").run();
}
export const regras = () => REGRAS;
export const confIA = () => CONF;

export const TAREFAS = {
  analisar: { nome: 'Analisar assunto', descricao: 'Definição, conceitos-chave, como a banca cobra, conexões e checklist do que dominar.' },
  resumir: { nome: 'Criar resumo', descricao: 'Resumo técnico para revisão, com tabelas, pontos-chave e pontos de atenção para a prova.' },
  questoes: { nome: 'Criar questões', descricao: 'Questões inéditas no estilo da banca, com gabarito e comentário de cada alternativa.' },
};
export const MODOS = {
  baixo: { nome: 'Baixo raciocínio', descricao: 'Rápido e direto: só o essencial.', instrucao: 'Modo de raciocínio: baixo. Entregue só o essencial, de forma direta, sem digressões nem exemplos longos.' },
  medio: { nome: 'Médio raciocínio', descricao: 'Equilíbrio entre profundidade, tempo e custo.', instrucao: 'Modo de raciocínio: médio. Cubra os conceitos centrais com rigor, as relações entre eles e um exemplo curto quando ajudar.' },
  alto: { nome: 'Alto raciocínio', descricao: 'Análise a fundo, com exceções e pegadinhas. Mais lento e mais caro.', instrucao: 'Modo de raciocínio: alto. Aprofunde: exceções, casos-limite, distinções finas entre conceitos parecidos e pegadinhas recorrentes da banca. Confira cada afirmação antes de escrevê-la.' },
};
export const ESTILOS = {
  fcc: 'FCC (Fundação Carlos Chagas): enunciado direto, 5 alternativas (A a E), cobrança literal de lei, de definições e de procedimentos',
  cesgranrio: 'Cesgranrio: enunciado contextualizado, 5 alternativas (A a E)',
  cebraspe: 'Cebraspe: itens para julgar como Certo ou Errado',
  fgv: 'FGV: enunciado longo e interpretativo, 5 alternativas (A a E)',
  vunesp: 'Vunesp: enunciado objetivo, 5 alternativas (A a E)',
  enem: 'ENEM: texto-base com situação-problema contextualizada e 5 alternativas (A a E)',
  tecnico: 'questões técnicas de TI no formato de concurso, 5 alternativas (A a E)',
};
export const DIFICULDADES = { misto: 'níveis variados (fácil, médio e difícil)', facil: 'fácil', medio: 'médio', dificil: 'difícil' };
export const QUANTIDADES = [3, 5, 10, 15, 20];

// Estilo padrão a partir do concurso do estudos.json.
export function estiloDe(estudos) {
  const c = String(estudos?.concurso || '');
  if (/\bFCC\b/i.test(c)) return 'fcc';
  if (/cesgranrio/i.test(c)) return 'cesgranrio';
  if (/cebraspe|cespe/i.test(c)) return 'cebraspe';
  if (/\bFGV\b/i.test(c)) return 'fgv';
  if (/vunesp/i.test(c)) return 'vunesp';
  if (/enem/i.test(c)) return 'enem';
  return 'tecnico';
}

// ---------- material: nota inteira ou uma seção dela ----------

const limparTitulo = (s) => String(s).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim();

export function secoesDoTexto(texto) {
  const linhas = String(texto).split('\n');
  const usados = new Set();
  const secoes = [];
  let cerca = false;
  linhas.forEach((bruta, i) => {
    const l = bruta.replace(/\r$/, '');
    if (/^[ \t]*(```|~~~)/.test(l)) { cerca = !cerca; return; }
    const h = cerca ? null : /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(l);
    if (!h) return;
    const titulo = limparTitulo(h[2]);
    let id = slugTexto(titulo);
    for (let n = 2; usados.has(id); n++) id = `${slugTexto(titulo)}-${n}`;
    usados.add(id);
    secoes.push({ id, titulo, nivel: h[1].length, linha: i });
  });
  return secoes.map((s, k) => {
    const fim = secoes.slice(k + 1).find((x) => x.nivel <= s.nivel);
    return { ...s, fim: fim ? fim.linha : linhas.length };
  });
}

export function recortarMaterial(texto, secaoId) {
  const corpo = String(texto).replace(/^\s*\n/, '');
  if (!secaoId) return { texto: corpo.trim(), secao: null };
  const s = secoesDoTexto(corpo).find((x) => x.id === secaoId);
  if (!s) throw new ErroHttp(400, 'Seção não encontrada na nota (ela pode ter mudado).');
  return { texto: corpo.split('\n').slice(s.linha, s.fim).join('\n').trim(), secao: s.titulo };
}

export function conferirTamanho(texto) {
  if (texto.length > CONF.maxCaracteresMaterial) {
    throw new ErroHttp(413, `O material tem ${texto.length.toLocaleString('pt-BR')} caracteres e o limite é ${CONF.maxCaracteresMaterial.toLocaleString('pt-BR')}. Escolha uma seção da nota.`);
  }
}

// ---------- montar o pedido ----------

const Questoes = z.object({
  questoes: z.array(z.object({
    enunciado: z.string(),
    alternativas: z.array(z.object({ letra: z.string(), texto: z.string(), correta: z.boolean(), comentario: z.string() })),
    explicacao: z.string(),
    assunto: z.string(),
    nivel: z.enum(['facil', 'medio', 'dificil']),
  })),
});

function instrucaoDaTarefa(p, paraCopiar) {
  if (p.tarefa === 'analisar') {
    return [
      'Analise o assunto como preparação para a prova, nesta estrutura:',
      '## Definição e escopo: o que o assunto é, em termos técnicos, e até onde vai neste edital ou trilha.',
      '## Conceitos-chave: os conceitos centrais, definidos, e como se relacionam.',
      '## Como é cobrado: padrões de questão do estilo informado, pegadinhas e confusões frequentes.',
      '## Pré-requisitos e conexões: o que é preciso saber antes e que outros tópicos se ligam a este.',
      '## Checklist de domínio: itens objetivos e verificáveis (ex.: "sei diferenciar X de Y").',
      '## Prioridade: alta, média ou baixa para esta prova, com a justificativa.',
    ].join('\n');
  }
  if (p.tarefa === 'resumir') {
    const extensao = { baixo: 'até cerca de 1 página', medio: 'cerca de 2 páginas', alto: 'completo, sem limite rígido, mas sem repetições' }[p.modo];
    return [
      'Faça um resumo técnico para revisão do assunto.',
      '- Organize em seções hierárquicas; use tabelas para comparar conceitos parecidos.',
      '- Destaque definições, fórmulas, comandos, artigos de lei e valores que costumam cair.',
      '- Termine com "## Pontos de atenção para a prova" (5 a 10 itens).',
      `- Extensão: ${extensao}.`,
    ].join('\n');
  }
  const ce = p.estilo === 'cebraspe';
  return [
    `Crie ${p.quantidade} questões inéditas sobre o assunto, no estilo ${ESTILOS[p.estilo]}, nível ${DIFICULDADES[p.dificuldade]}.`,
    ce ? '- Cada item tem enunciado completo e duas alternativas, "C" (Certo) e "E" (Errado), com exatamente uma correta.'
      : '- Cada questão tem enunciado completo e 5 alternativas (A a E) com exatamente uma correta.',
    '- As alternativas incorretas devem ser plausíveis e explorar confusões reais do assunto.',
    '- O comentário de cada alternativa explica tecnicamente por que ela está certa ou errada.',
    '- A explicação geral resume o raciocínio da resolução em 2 a 4 frases.',
    '- Não repita a mesma ideia em duas questões.',
    paraCopiar
      ? '- Formato: questões numeradas com as alternativas; no fim, o gabarito com o comentário de cada alternativa.'
      : '- Preencha "nivel" com facil, medio ou dificil e "assunto" com o tópico específico da questão.',
  ].join('\n');
}

// p: { tarefa, modo, assunto, trilha: { nome } | null, concurso, cargo, estilo, quantidade, dificuldade, material: { titulo, rel, secao, texto, origem } | null }
export function montarPedido(p) {
  const contexto = [
    p.trilha ? `Trilha: ${p.trilha.nome}${p.concurso ? ` (${p.concurso})` : ''}${p.cargo ? `; cargo: ${p.cargo}` : ''}.` : '',
    p.tarefa === 'questoes' ? '' : `Estilo da prova: ${ESTILOS[p.estilo]}.`,
  ].filter(Boolean);
  const pedido = (paraCopiar) => [
    `Tarefa: ${TAREFAS[p.tarefa].nome}.`,
    `Assunto: ${p.assunto || 'o do material de referência.'}`,
    ...contexto,
    MODOS[p.modo].instrucao,
    '',
    instrucaoDaTarefa(p, paraCopiar),
  ].join('\n');
  const cabecalho = p.material
    ? `Material de referência: ${p.material.origem} "${p.material.titulo}"${p.material.secao ? `, seção "${p.material.secao}"` : ''}.`
    : '';
  const conteudo = [];
  if (p.material) {
    // o material vem antes do pedido e fica em cache: outra tarefa sobre a mesma nota sai mais barata
    conteudo.push({ type: 'text', text: `<material>\n${cabecalho}\n\n${p.material.texto}\n</material>`, cache_control: { type: 'ephemeral' } });
  }
  conteudo.push({ type: 'text', text: pedido(false) });
  const previa = [
    '# Regras fixas',
    REGRAS,
    ...(p.material ? ['# Material de referência', cabecalho, p.material.texto] : []),
    '# Pedido',
    pedido(true),
  ].join('\n\n');
  return {
    tarefa: p.tarefa,
    modo: p.modo,
    system: [{ type: 'text', text: REGRAS, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: conteudo }],
    previa,
    parametros: { modelo: CONF.modelo, esforco: CONF.esforco[p.modo], maxTokens: CONF.maxTokens },
  };
}

// ---------- estado, limites e custo ----------

export function estadoIA(usuario) {
  const chave = !!process.env.ANTHROPIC_API_KEY;
  const ligada = chave && CONF.ativa !== false;
  const permitido = CONF.perfis.includes('*') || CONF.perfis.includes(usuario?.perfil);
  let motivo = '';
  if (!chave) motivo = 'A integração ainda não foi ligada: falta a chave ANTHROPIC_API_KEY no .env do servidor.';
  else if (CONF.ativa === false) motivo = 'A integração está desligada em config/ia.json ("ativa": false).';
  else if (!permitido) motivo = 'Seu perfil ainda não pode gerar respostas da IA. Peça ao dono do site.';
  return { ligada, permitido, podeGerar: ligada && permitido, motivo, modelo: CONF.modelo, esforco: CONF.esforco, orcamento: CONF.orcamentoMensalUSD, limiteDiario: CONF.limiteDiarioPorPessoa };
}

const inicioDoMes = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); };
const inicioDoDia = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const gastoDoMes = () => db.prepare('SELECT coalesce(sum(custo_usd), 0) AS c FROM ia_pedidos WHERE criado >= ?').get(inicioDoMes()).c;
export const pedidosHoje = (usuarioId) => db.prepare("SELECT count(*) AS n FROM ia_pedidos WHERE usuario_id = ? AND criado >= ? AND estado <> 'erro'").get(usuarioId, inicioDoDia()).n;

export function exigirPodeGerar(usuario) {
  const e = estadoIA(usuario);
  if (!e.ligada) throw new ErroHttp(503, e.motivo);
  if (!e.permitido) throw new ErroHttp(403, e.motivo);
  if (db.prepare("SELECT 1 FROM ia_pedidos WHERE usuario_id = ? AND estado = 'rodando'").get(usuario.id)) {
    throw new ErroHttp(409, 'Já existe um pedido seu em andamento. Espere ele terminar.');
  }
  if (pedidosHoje(usuario.id) >= CONF.limiteDiarioPorPessoa) {
    throw new ErroHttp(429, `Limite de ${CONF.limiteDiarioPorPessoa} pedidos por dia atingido. Volte amanhã.`);
  }
  if (gastoDoMes() >= CONF.orcamentoMensalUSD) {
    throw new ErroHttp(429, `O orçamento mensal da IA (US$ ${CONF.orcamentoMensalUSD}) acabou. O dono pode ajustar em config/ia.json.`);
  }
}

function custoDe(modelo, uso) {
  const p = CONF.precosUSDporMilhao[modelo] || CONF.precosUSDporMilhao[CONF.modelo] || PADRAO.precosUSDporMilhao['claude-opus-5-5'];
  return ((uso.input_tokens || 0) * p.entrada + (uso.output_tokens || 0) * p.saida
    + (uso.cache_read_input_tokens || 0) * p.cacheLeitura + (uso.cache_creation_input_tokens || 0) * p.cacheEscrita) / 1e6;
}

function traduzirErro(e) {
  if (e instanceof APIUserAbortError) return { estado: 'cancelado', mensagem: 'Pedido cancelado.' };
  if (e instanceof AuthenticationError) return { estado: 'erro', mensagem: 'A API recusou a chave (ANTHROPIC_API_KEY). Confira o .env do servidor.' };
  if (e instanceof PermissionDeniedError) return { estado: 'erro', mensagem: 'A chave da API não tem permissão para este modelo.' };
  if (e instanceof RateLimitError) return { estado: 'erro', mensagem: 'A API está no limite de uso agora. Tente de novo em alguns minutos.' };
  if (e instanceof BadRequestError) return { estado: 'erro', mensagem: `A API recusou o pedido: ${e.message}` };
  if (e instanceof APIConnectionTimeoutError) return { estado: 'erro', mensagem: 'A API demorou demais para responder. Tente um modo de raciocínio menor.' };
  if (e instanceof APIConnectionError) return { estado: 'erro', mensagem: 'Sem conexão com a API da Anthropic.' };
  if (e instanceof InternalServerError) return { estado: 'erro', mensagem: `A API da Anthropic está com problemas (erro ${e.status}). Tente mais tarde.` };
  if (e instanceof APIError) return { estado: 'erro', mensagem: `Erro da API (${e.status ?? 'sem código'}).` };
  console.error('[ia]', e);
  return { estado: 'erro', mensagem: 'A resposta da IA não pôde ser lida. Tente de novo.' };
}

// ---------- gerar ----------

let cliente = null;
const clienteIA = () => (cliente ||= new Anthropic());

// info: { tarefa, modo, trilha, assunto, material }; eventos: aoTexto(delta), aoPensar(delta), signal
export async function gerar(usuarioId, pedido, info, { aoTexto, aoPensar, signal } = {}) {
  const inicio = Date.now();
  const id = Number(db.prepare(`INSERT INTO ia_pedidos (usuario_id, tarefa, modo, trilha, assunto, material, estado, modelo, criado)
    VALUES (?, ?, ?, ?, ?, ?, 'rodando', ?, ?)`).run(usuarioId, info.tarefa, info.modo, info.trilha, info.assunto, info.material, CONF.modelo, inicio).lastInsertRowid);
  const questoes = info.tarefa === 'questoes';
  let texto = '';
  let raciocinio = '';
  const salvar = (c) => db.prepare(`UPDATE ia_pedidos SET estado = ?, resposta = ?, raciocinio = ?, erro = ?, modelo = ?, entrada_tokens = ?, saida_tokens = ?,
      cache_lidos = ?, cache_gravados = ?, custo_usd = ?, duracao_ms = ? WHERE id = ?`)
    .run(c.estado, c.resposta ?? null, c.raciocinio || null, c.erro ?? null, c.modelo || CONF.modelo, c.uso?.input_tokens || 0, c.uso?.output_tokens || 0,
      c.uso?.cache_read_input_tokens || 0, c.uso?.cache_creation_input_tokens || 0, c.custo || 0, Date.now() - inicio, id);
  try {
    const stream = clienteIA().beta.messages.stream({
      model: CONF.modelo,
      max_tokens: CONF.maxTokens,
      // se o modelo recusar por política, a API refaz o pedido sozinha num modelo de reserva
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: CONF.esforco[info.modo], ...(questoes ? { format: betaZodOutputFormat(Questoes) } : {}) },
      system: pedido.system,
      messages: pedido.messages,
    }, { signal });
    stream.on('text', (d) => { texto += d; if (!questoes) aoTexto?.(d); });
    stream.on('thinking', (d) => { raciocinio += d; aoPensar?.(d); });
    const msg = await stream.finalMessage();
    const uso = msg.usage || {};
    const custo = custoDe(msg.model, uso);
    const pensou = msg.content.filter((b) => b.type === 'thinking').map((b) => b.thinking).filter(Boolean).join('\n\n') || raciocinio;
    let estado = 'ok';
    let erro = null;
    let resposta = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('') || texto;
    let lista = null;
    if (msg.stop_reason === 'refusal') {
      estado = 'recusado';
      erro = `O modelo recusou o pedido${msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : '.'}`;
    } else if (msg.stop_reason === 'max_tokens') {
      estado = 'cortado';
      erro = 'A resposta passou do limite de tamanho e veio cortada.';
    } else if (questoes) {
      lista = msg.parsed_output?.questoes || null;
      if (!lista?.length) { estado = 'erro'; erro = 'A resposta não veio no formato de questões esperado.'; } else resposta = JSON.stringify({ questoes: lista });
    }
    salvar({ estado, resposta, raciocinio: pensou, erro, modelo: msg.model, uso, custo });
    return { id, estado, erro, resposta, questoes: lista, raciocinio: pensou, custo, uso, modelo: msg.model };
  } catch (e) {
    const { estado, mensagem } = traduzirErro(e);
    salvar({ estado, resposta: texto || null, raciocinio, erro: mensagem });
    return { id, estado, erro: mensagem };
  }
}

// ---------- histórico ----------

export function historico(usuarioId, limite = 30) {
  return db.prepare(`SELECT id, tarefa, modo, trilha, assunto, material, estado, modelo, custo_usd, entrada_tokens, saida_tokens, criado, duracao_ms
    FROM ia_pedidos WHERE usuario_id = ? ORDER BY criado DESC LIMIT ?`).all(usuarioId, limite);
}

export function obterPedido(usuarioId, id) {
  const p = db.prepare('SELECT * FROM ia_pedidos WHERE id = ? AND usuario_id = ?').get(Number(id), usuarioId);
  if (!p) throw new ErroHttp(404, 'Resposta não encontrada.');
  return p;
}

export function removerPedido(usuarioId, id) {
  const p = obterPedido(usuarioId, id);
  if (p.estado === 'rodando') throw new ErroHttp(409, 'Espere o pedido terminar.');
  db.prepare('DELETE FROM ia_pedidos WHERE id = ?').run(p.id);
}

export function questoesDe(pedido) {
  try { return JSON.parse(pedido.resposta || '{}').questoes || null; } catch { return null; }
}
