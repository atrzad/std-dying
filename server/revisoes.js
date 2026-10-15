// Revisões espaçadas: todo assunto estudado ganha revisões automáticas em intervalos crescentes
// (padrão: 1, 7, 30 e 90 dias). O estudo pode vir de um pomodoro, de uma tarefa marcada, de questões
// registradas ou ser lançado à mão. Tudo é por pessoa e mora no banco: as notas dos cofres não mudam.
//
// "etapa" = quantas revisões deram certo. A próxima data é hoje + intervalos[etapa] (a última repete).
// Resultado de uma revisão: fácil avança 2 etapas, bom avança 1, difícil volta 1, errei volta ao início.
import fs from 'node:fs';
import path from 'node:path';
import { db, lerAjuste, gravarAjuste, registrarEvento } from './db.js';
import { ErroHttp, acharTrilha } from './cofres.js';
import { hojeISO, somarDias, dataBR } from './resumo.js';

export const PRESETS = {
  padrao: { nome: 'Padrão', intervalos: [1, 7, 30, 90] },
  intensivo: { nome: 'Intensivo', intervalos: [1, 3, 7, 15, 30, 60] },
};
export const RESULTADOS = { facil: 'Fácil', bom: 'Bom', dificil: 'Difícil', errei: 'Errei' };
const PASSO = { facil: 2, bom: 1, dificil: -1 };
export const ORIGENS = { foco: 'pomodoro', tarefa: 'tarefa marcada', questoes: 'questões', manual: 'lançada à mão', ia: 'IA' };
export const MINUTOS_FOCO = 10; // pomodoro curto não vira revisão

// Mesma chave para "Geometria plana", "geometria  plana" e "Geometria Plana!".
export const chaveDe = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
export const limparAssunto = (s) => String(s || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a)
  .replace(/[*_`#>~]/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);

// ---------- ajustes de cada pessoa ----------

export function intervalosValidos(lista) {
  if (!Array.isArray(lista) || !lista.length || lista.length > 8) return null;
  const n = lista.map(Number);
  if (n.some((d) => !Number.isInteger(d) || d < 1 || d > 365)) return null;
  for (let i = 1; i < n.length; i++) if (n[i] < n[i - 1]) return null;
  return n;
}

export function ajustesDe(usuarioId) {
  const a = lerAjuste(`revisoes:${usuarioId}`, {}) || {};
  return {
    intervalos: intervalosValidos(a.intervalos) || PRESETS.padrao.intervalos,
    foco: a.foco !== false, tarefa: a.tarefa !== false, questoes: a.questoes !== false,
  };
}

export function salvarAjustes(usuarioId, { intervalos, foco, tarefa, questoes }) {
  const iv = intervalosValidos(intervalos);
  if (!iv) throw new ErroHttp(400, 'Os intervalos devem ser de 1 a 8 números de dias (1 a 365), em ordem crescente.');
  gravarAjuste(`revisoes:${usuarioId}`, { intervalos: iv, foco: foco === true, tarefa: tarefa === true, questoes: questoes === true });
}

// ---------- datas ----------

// Data da prova da trilha (estudos.json), relida só quando o arquivo muda.
const provas = new Map();
function provaDe(slug) {
  const t = acharTrilha(slug);
  if (!t) return null;
  const arq = path.join(t.pasta, 'estudos.json');
  try {
    const st = fs.statSync(arq);
    const c = provas.get(arq);
    if (c && c.mtime === st.mtimeMs) return c.prova;
    const prova = JSON.parse(fs.readFileSync(arq, 'utf8')).prova;
    const v = /^\d{4}-\d{2}-\d{2}$/.test(prova || '') ? prova : null;
    provas.set(arq, { mtime: st.mtimeMs, prova: v });
    return v;
  } catch {
    return null;
  }
}

function proximaData(trilha, etapa, intervalos, base = hojeISO()) {
  let d = somarDias(base, intervalos[Math.min(etapa, intervalos.length - 1)]);
  const hoje = hojeISO();
  const prova = provaDe(trilha);
  // Revisão que cairia depois da prova vem para dois dias antes dela: a última passada antes do dia.
  if (prova && hoje < prova && d > prova) {
    const vespera = somarDias(prova, -2);
    d = vespera > hoje ? vespera : somarDias(hoje, 1);
  }
  return d;
}

// ---------- registrar estudo e revisões ----------

const porChave = db.prepare('SELECT * FROM revisoes WHERE usuario_id = ? AND trilha = ? AND chave = ?');
const porId = db.prepare('SELECT * FROM revisoes WHERE id = ? AND usuario_id = ?');

function aplicar(usuarioId, r, resultado, origem, a = ajustesDe(usuarioId)) {
  const etapa = resultado === 'errei' ? 0 : Math.max(0, r.etapa + PASSO[resultado]);
  const proxima = proximaData(r.trilha, etapa, a.intervalos);
  db.prepare('UPDATE revisoes SET etapa = ?, proxima = ?, ultima = ?, revisoes = revisoes + 1, arquivada = 0 WHERE id = ?')
    .run(etapa, proxima, hojeISO(), r.id);
  db.prepare(`INSERT INTO revisoes_log (revisao_id, usuario_id, quando, resultado, origem, etapa_antes, etapa_depois, proxima)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(r.id, usuarioId, Date.now(), resultado, origem, r.etapa, etapa, proxima);
  return { id: r.id, etapa, proxima, resultado };
}

// Algo foi estudado. Assunto novo entra no ciclo; assunto com revisão vencida conta como revisão feita;
// desempenho "ruim" (questões abaixo da meta) manda revisar de novo amanhã.
export function registrarEstudo(usuarioId, { trilha, assunto, origem, ref = null, desempenho = null, base = null }) {
  const a = ajustesDe(usuarioId);
  if (a[origem] === false) return null;
  const texto = limparAssunto(assunto);
  const chave = chaveDe(texto);
  if (!chave || !trilha) return null;
  const hoje = hojeISO();
  const r = porChave.get(usuarioId, trilha, chave);
  if (!r) {
    const dataBase = base && base < hoje ? base : hoje;
    const proxima = proximaData(trilha, 0, a.intervalos, dataBase);
    const info = db.prepare(`INSERT INTO revisoes (usuario_id, trilha, assunto, chave, origem, ref, etapa, proxima, ultima, criada)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`).run(usuarioId, trilha, texto, chave, origem, ref, proxima, dataBase, Date.now());
    return { id: Number(info.lastInsertRowid), novo: true, proxima };
  }
  if (r.arquivada) {
    const proxima = proximaData(trilha, 0, a.intervalos);
    db.prepare('UPDATE revisoes SET etapa = 0, proxima = ?, ultima = ?, arquivada = 0 WHERE id = ?').run(proxima, hoje, r.id);
    return { id: r.id, novo: false, proxima };
  }
  if (desempenho === 'ruim') return aplicar(usuarioId, r, 'errei', origem, a);
  if (r.proxima <= hoje) return aplicar(usuarioId, r, 'bom', origem, a);
  db.prepare('UPDATE revisoes SET ultima = ? WHERE id = ?').run(hoje, r.id);
  return { id: r.id, novo: false, proxima: r.proxima };
}

// Desmarcou a tarefa: some a revisão que nasceu dela, se ainda não foi revisada nenhuma vez.
export function desfazerTarefa(usuarioId, { trilha, assunto, ref }) {
  db.prepare("DELETE FROM revisoes WHERE usuario_id = ? AND trilha = ? AND chave = ? AND origem = 'tarefa' AND ref IS ? AND revisoes = 0")
    .run(usuarioId, trilha, chaveDe(limparAssunto(assunto)), ref);
}

export function obter(usuarioId, id) {
  const r = porId.get(Number(id), usuarioId);
  if (!r) throw new ErroHttp(404, 'Revisão não encontrada.');
  return r;
}

export function revisar(usuarioId, id, resultado) {
  if (!Object.hasOwn(RESULTADOS, resultado)) throw new ErroHttp(400, 'Resultado inválido.');
  const r = obter(usuarioId, id);
  const x = aplicar(usuarioId, r, resultado, 'manual');
  registrarEvento({ usuarioId, trilha: r.trilha, tipo: 'revisao', detalhe: `Revisou ${r.assunto.slice(0, 120)} (${RESULTADOS[resultado].toLowerCase()})` });
  return x;
}

export function adicionarManual(usuarioId, { trilha, assunto, data }, slugsValidos) {
  const t = String(trilha || '');
  if (!slugsValidos.includes(t)) throw new ErroHttp(400, 'Escolha uma das suas trilhas.');
  const texto = limparAssunto(assunto);
  if (!chaveDe(texto)) throw new ErroHttp(400, 'Informe o assunto.');
  const d = String(data || '') || hojeISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > hojeISO() || d < '2020-01-01') throw new ErroHttp(400, 'A data do estudo deve ser hoje ou antes.');
  const r = porChave.get(usuarioId, t, chaveDe(texto));
  if (r && !r.arquivada) throw new ErroHttp(409, `Esse assunto já está nas revisões (próxima em ${dataBR(r.proxima)}).`);
  const a = ajustesDe(usuarioId);
  // lançar à mão vale mesmo com a origem automática desligada
  if (r) {
    const proxima = proximaData(t, 0, a.intervalos, d);
    db.prepare('UPDATE revisoes SET etapa = 0, proxima = ?, ultima = ?, arquivada = 0 WHERE id = ?').run(proxima, d, r.id);
    return { id: r.id, proxima };
  }
  const proxima = proximaData(t, 0, a.intervalos, d);
  const info = db.prepare(`INSERT INTO revisoes (usuario_id, trilha, assunto, chave, origem, etapa, proxima, ultima, criada)
    VALUES (?, ?, ?, ?, 'manual', 0, ?, ?, ?)`).run(usuarioId, t, texto, chaveDe(texto), proxima, d, Date.now());
  return { id: Number(info.lastInsertRowid), proxima };
}

export function adiar(usuarioId, id, dias = 1) {
  const r = obter(usuarioId, id);
  const n = [1, 2, 3, 7].includes(Number(dias)) ? Number(dias) : 1;
  const hoje = hojeISO();
  const proxima = somarDias(r.proxima > hoje ? r.proxima : hoje, n);
  db.prepare('UPDATE revisoes SET proxima = ? WHERE id = ?').run(proxima, r.id);
  return { proxima };
}

export function arquivar(usuarioId, id, sim = true) {
  const r = obter(usuarioId, id);
  db.prepare('UPDATE revisoes SET arquivada = ? WHERE id = ?').run(sim ? 1 : 0, r.id);
}

export function remover(usuarioId, id) {
  const r = obter(usuarioId, id);
  db.prepare('DELETE FROM revisoes WHERE id = ?').run(r.id);
}

// ---------- consultas ----------

const filtroTrilhas = (slugs) => `trilha IN (${slugs.map(() => '?').join(', ')})`;

export function contarPendentes(usuarioId, slugs) {
  if (!slugs.length) return 0;
  return db.prepare(`SELECT count(*) AS n FROM revisoes WHERE usuario_id = ? AND arquivada = 0 AND proxima <= ? AND ${filtroTrilhas(slugs)}`)
    .get(usuarioId, hojeISO(), ...slugs).n;
}

export function listar(usuarioId, slugs, { arquivadas = false } = {}) {
  if (!slugs.length) return [];
  return db.prepare(`SELECT * FROM revisoes WHERE usuario_id = ? AND arquivada = ? AND ${filtroTrilhas(slugs)} ORDER BY proxima, criada`)
    .all(usuarioId, arquivadas ? 1 : 0, ...slugs);
}

// Para o cronograma: revisões por dia entre "de" e "ate"; as atrasadas aparecem no dia de hoje.
export function porDia(usuarioId, slugs, de, ate) {
  const mapa = new Map();
  if (!slugs.length) return mapa;
  const hoje = hojeISO();
  const linhas = db.prepare(`SELECT * FROM revisoes WHERE usuario_id = ? AND arquivada = 0 AND proxima <= ? AND ${filtroTrilhas(slugs)} ORDER BY proxima, criada`)
    .all(usuarioId, ate, ...slugs);
  for (const r of linhas) {
    const dia = r.proxima < hoje ? hoje : r.proxima;
    if (dia < de || dia > ate) continue;
    if (!mapa.has(dia)) mapa.set(dia, []);
    mapa.get(dia).push({ ...r, atrasada: r.proxima < hoje });
  }
  return mapa;
}

export function feitasNoDia(usuarioId, dia) {
  const ini = new Date(`${dia}T00:00:00`).getTime();
  return db.prepare('SELECT count(DISTINCT revisao_id) AS n FROM revisoes_log WHERE usuario_id = ? AND quando >= ? AND quando < ?')
    .get(usuarioId, ini, ini + 864e5).n;
}

export const rotuloEtapa = (r, intervalos) => (r.etapa >= intervalos.length ? 'manutenção' : `R${r.etapa + 1}`);
