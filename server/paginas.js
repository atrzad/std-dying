import { esc, caminhoURL, renderizarTexto } from './markdown.js';
import { sprite } from './sprites.js';
import { iconeUI, iconeTrilha, acao } from './icones.js';
import { dataBR, diasEntre, hojeISO, somarDias, nomeCargo } from './resumo.js';
import { formatarDuracao } from './foco.js';
import { CITACOES, citacaoDoDia } from './citacoes.js';
import { TEMAS, temaPorId } from './temas.js';
import { DIAS, DIAS_CURTOS, FONTES, TODAS } from './cronograma.js';
import { RESULTADOS, ORIGENS, PRESETS, rotuloEtapa } from './revisoes.js';
import { TAREFAS, MODOS as MODOS_IA, ESTILOS, DIFICULDADES, QUANTIDADES } from './ia.js';

// "Anotar": abre uma nota nova no Caderno, já com o título e a tag da trilha.
const linkAnotar = (titulo, tag) => `/caderno/nova?titulo=${encodeURIComponent(titulo || '')}${tag ? `&amp;tags=${encodeURIComponent(tag)}` : ''}`;

const fmt = new Intl.NumberFormat('pt-BR');
const pctTxt = (v) => (v == null ? '—' : `${Math.round(v)}%`);
const MESES = ['jan.', 'fev.', 'mar.', 'abr.', 'maio', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
const mesAno = (iso) => `${MESES[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;
// Tema pixel (padrão) ou normal (perfil sem enfeites). Sem usuário (login, erro deslogado) = pixel.
const ehPixel = (usuario) => (usuario?.tema || 'pixel') === 'pixel';
const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function tempoAtras(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  if (s < 2 * 86400) return 'ontem';
  return dataBR(new Date(ms).toLocaleDateString('sv-SE'), false);
}

function medidor(pct, { rotulo = '', classe = '', marca = '' } = {}) {
  const p = Math.max(0, Math.min(100, pct || 0));
  return `<span class="medidor ${classe}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p)}"${
    rotulo ? ` aria-label="${esc(rotulo)}"` : ''}><i data-pct="${p.toFixed(1)}"${marca}></i></span>`;
}

const emblema = (slug) => iconeUI(iconeTrilha(slug));

// ---------- casca ----------

// O mesmo pomodoro flutua no início da página e se fixa no cabeçalho ao rolar.
function barraFoco(foco, px, trilhas) {
  if (!foco) return '';
  const pausado = foco.estado === 'pausado';
  const trilha = trilhas.find((t) => t.slug === foco.trilha);
  const pct = (100 * foco.decorridoMs) / (foco.duracao_s * 1000);
  return `
  <aside class="foco-fixo t-${esc(foco.trilha)}${pausado ? ' pausado' : ''}" aria-label="Pomodoro em andamento"
      data-foco-id="${foco.id}" data-foco-estado="${foco.estado}" data-foco-restante="${foco.restanteMs}"
      data-foco-total="${foco.duracao_s * 1000}" data-foco-tipo="${foco.tipo}" data-agora="${Date.now()}">
    <div class="foco-fixo-in">
      ${px ? sprite('ampulheta', { escala: 2 }) : ''}
      <a class="foco-fixo-info" href="/foco">
        <span class="foco-fixo-tipo">${foco.tipo === 'pausa' ? 'Pausa' : 'Foco'} · ${esc(trilha?.curto || foco.trilha)}${pausado ? ' · pausado' : ''}</span>
        <span class="foco-fixo-assunto">${esc(foco.assunto || (foco.tipo === 'pausa' ? 'Descanso' : 'Sem assunto'))}</span>
      </a>
      <b class="foco-fixo-relogio" data-foco-relogio>${mmss(foco.restanteMs)}</b>
      <button type="button" class="btn foco-expandir" data-foco-expandir aria-expanded="true" aria-controls="foco-controles" aria-label="Ocultar controles do pomodoro" hidden>${iconeUI('configuracoes')}</button>
      <span class="foco-fixo-acoes" id="foco-controles">
        ${pausado
          ? `<button type="button" class="btn btn-ouro" data-foco-acao="retomar" data-id="${foco.id}">${acao('iniciar', 'Retomar')}</button>`
          : `<button type="button" class="btn" data-foco-acao="pausar" data-id="${foco.id}">${acao('pausar', 'Pausar')}</button>`}
        <button type="button" class="btn" data-foco-acao="concluir" data-id="${foco.id}">${acao('concluir', 'Concluir')}</button>
        <a class="btn" href="${linkAnotar(foco.assunto || 'Sessão de foco', foco.trilha)}">${acao('editar', 'Anotar')}</a>
        <button type="button" class="btn-x" data-foco-acao="cancelar" data-id="${foco.id}">${acao('fechar', 'Abandonar')}</button>
      </span>
    </div>
    <span class="foco-fixo-trilho"><i data-foco-barra data-pct="${pct.toFixed(1)}"></i></span>
  </aside>`;
}

// Todos os temas usam os mesmos símbolos, com as cores da própria paleta.
const icone = (nome) => `<span class="nav-icone">${iconeUI(nome)}</span>`;

// O nome: "std(dying)". No tema pixel, o "(dying)" vem em vermelho, como a faixa de morte.
const MARCA_TXT = '<span class="marca-txt"><span class="marca-nome">std</span><span class="marca-std">(dying)</span></span>';

// Navegação: barra lateral fixa no computador; no celular, gaveta aberta pelo botão ☰ do cabeçalho.
// Funciona sem JavaScript: o ☰ é um link para #navegacao e a gaveta abre por :target.
function navegacao({ px, ativo, usuario, trilhas, almas, notaAtual }) {
  const item = (slug, href, rotulo, ico, extra = '') => `<a class="nav-item t-${slug}${ativo === slug ? ' ativa' : ''}" href="${href}"${
    ativo === slug ? ' aria-current="page"' : ''} title="${esc(rotulo)}">${ico}<span class="nav-rot">${esc(rotulo)}</span>${extra}</a>`;
  const cofres = trilhas.filter((t) => !t.espaco);
  const caminhos = cofres.map((t) => {
    const aberta = ativo === t.slug;
    const pct = typeof t.pct === 'number' ? t.pct : null;
    const notas = aberta && t.notas?.length ? `
        <ul class="nav-notas" aria-label="Notas de ${esc(t.nome)}">${t.notas.map((n) => {
          const atual = n.rel === notaAtual;
          return `
          <li><a class="nav-nota${atual ? ' atual' : ''}" href="/t/${t.slug}/n/${caminhoURL(n.rel)}"${atual ? ' aria-current="page" data-nav-nota-atual' : ''}>
            <span>${esc(n.titulo)}</span>${n.total ? `<small data-nav-contagem>${n.feitas}/${n.total}</small>` : ''}</a></li>`;
        }).join('')}
        </ul>` : '';
    return `
      <li class="nav-trilha t-${t.slug}${aberta ? ' aberta' : ''}">
        ${item(t.slug, `/t/${t.slug}`, t.nome, icone(iconeTrilha(t.slug)), pct == null ? '' : `<b class="nav-pct">${pctTxt(pct)}</b>`)}
        ${pct == null ? '' : medidor(pct, { rotulo: `Progresso de ${t.nome}`, classe: 'tc nav-medidor' })}${notas}
      </li>`;
  }).join('');
  const pendentes = usuario.revisoesPendentes || 0;
  const ferramentas = [
    item('foco', '/foco', 'Foco', icone('foco')),
    item('cronograma', '/cronograma', 'Cronograma', icone('calendario')),
    item('revisoes', '/revisoes', 'Revisões', icone('revisao'),
      pendentes ? `<b class="nav-badge" title="${pendentes} ${pendentes === 1 ? 'revisão' : 'revisões'} para hoje">${pendentes}</b>` : ''),
    item('ia', '/ia', 'IA', icone('ia')),
    item('espaco', '/espaco', 'Meu espaço', icone('pasta')),
    item('caderno', '/caderno', 'Caderno', icone('caderno')),
    item('grupo', '/grupo', 'Grupo', icone('grupo')),
  ].map((a) => `<li>${a}</li>`).join('');
  return `
  <nav class="navlat" id="navegacao" aria-label="Navegação">
    <div class="navlat-topo">
      ${px ? `<div class="brasas" aria-hidden="true">${'<i></i>'.repeat(10)}</div>` : ''}
      <a class="marca" href="/" aria-label="std(dying), início">${px ? sprite('fogueira', { escala: 3 }) : ''}${MARCA_TXT}</a>
      <button type="button" class="navlat-recolher" data-nav-recolher aria-pressed="false" title="Recolher a barra lateral">${iconeUI('recolher')}<span class="visivel-leitor">Recolher a barra lateral</span></button>
      <a class="navlat-fechar" href="#" data-nav-fechar title="Fechar o menu">${iconeUI('fechar')}<span class="visivel-leitor">Fechar o menu</span></a>
    </div>
    <div class="navlat-rolagem">
      <ul class="nav-lista">
        <li>${item('inicio', '/', px ? 'Fogueira' : 'Início', icone('inicio'))}</li>
      </ul>
      ${cofres.length ? `<p class="nav-grupo">Caminhos</p>
      <ul class="nav-lista">${caminhos}
      </ul>` : ''}
      <p class="nav-grupo">Ferramentas</p>
      <ul class="nav-lista">${ferramentas}</ul>
    </div>
    <div class="navlat-pe">
      ${px && almas != null ? `<span class="almas" title="Lágrimas: tarefas concluídas">${sprite('lagrima', { escala: 2 })}<b>${fmt.format(almas)}</b></span>` : ''}
      <a class="conta-link${ativo === 'conta' ? ' ativa' : ''}" href="/configuracoes" title="Configurações">${iconeUI('configuracoes')}@${esc(usuario.arroba || usuario.usuario)}</a>
      <button type="button" class="btn btn-sair" data-sair>${acao('sair', 'Sair')}</button>
    </div>
  </nav>
  <a class="nav-fundo" href="#" data-nav-fechar tabindex="-1" aria-hidden="true"></a>`;
}

export function layout({ titulo, ativo = 'inicio', usuario = null, corpo, classe = '', trilhas = [], almas = null, foco = null, scripts = [], estilos = [], notaAtual = null }) {
  const px = ehPixel(usuario);
  const wiki = temaPorId(usuario?.temaId || usuario?.tema).wikipedia;
  const esquema = px ? 'dark' : wiki && wiki !== 'auto' ? wiki : 'light dark';
  const topoMovel = usuario ? `
    <header class="topo-movel">
      ${px ? `<div class="brasas" aria-hidden="true">${'<i></i>'.repeat(8)}</div>` : ''}
      <a class="hamburguer" href="#navegacao" data-nav-abrir aria-controls="navegacao" aria-expanded="false" title="Abrir o menu"><span class="hamburguer-linhas" aria-hidden="true"><i></i><i></i><i></i></span><span class="visivel-leitor">Abrir o menu</span></a>
      <a class="marca" href="/" aria-label="std(dying), início">${px ? sprite('fogueira', { escala: 2 }) : ''}${MARCA_TXT}</a>
      ${px && almas != null ? `<span class="almas" title="Lágrimas: tarefas concluídas">${sprite('lagrima', { escala: 2 })}<b>${fmt.format(almas)}</b></span>` : ''}
    </header>` : '';
  const rodape = `<footer class="rodape envolve"><a href="/privacidade">Privacidade e regras</a>${usuario ? ' · <a href="/configuracoes">Configurações</a>' : ' · <a href="/convite">Tenho um convite</a>'}</footer>`;
  const conteudo = `
${usuario ? barraFoco(foco, px, trilhas) : ''}
<main id="conteudo">
${corpo}
</main>
${rodape}`;
  return `<!doctype html>
<html lang="pt-BR"${wiki ? ` data-wikipedia="${wiki}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${esquema}">
<title>${esc(titulo ? `${titulo} · std(dying)` : 'std(dying)')}</title>
<link rel="icon" href="/icone.svg" type="image/svg+xml">
${px ? '<link rel="stylesheet" href="/css/fontes.css">\n<link rel="stylesheet" href="/css/ayo.css">' : '<link rel="stylesheet" href="/css/normal.css">'}
<link rel="stylesheet" href="/css/temas.css">
${wiki ? '<link rel="stylesheet" href="/css/wikipedia.css">' : ''}
<link rel="stylesheet" href="/css/icones.css">
<link rel="stylesheet" href="/css/planejamento.css">
${estilos.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n')}
${usuario && foco ? '<link rel="stylesheet" href="/css/pomodoro.css">' : ''}
<script src="/js/ayo.js" defer></script>
${scripts.map((src) => `<script src="${src}" defer></script>`).join('\n')}
</head>
<body class="${px ? 'tema-pixel' : 'tema-normal'}${wiki ? ' tema-wikipedia' : ''}${px && usuario?.temaId && usuario.temaId !== 'pixel' ? ` paleta-${esc(usuario.temaId)}` : ''}${usuario ? ' com-nav' : ''}${usuario && foco ? ' com-foco' : ''} ${esc(classe)}">
<a class="pular" href="#conteudo">Pular para o conteúdo</a>
${usuario ? `<div class="casca">
${navegacao({ px, ativo, usuario, trilhas, almas, notaAtual })}
<div class="coluna">
${topoMovel}
${conteudo}
</div>
</div>` : conteudo}
<div class="aviso-cookies caixa" data-aviso-cookies hidden role="region" aria-label="Aviso de cookies">
  <p>Este site usa <b>apenas cookies essenciais</b>: o da sua sessão de login. Preferências como som e caneta ficam só no seu navegador. Nada é vendido nem enviado a terceiros.</p>
  <div class="foco-botoes"><button type="button" class="btn btn-ouro" data-aceitar-cookies>Entendi e aceito</button><a class="btn" href="/privacidade">Ler a política</a></div>
</div>
<div id="aviso" role="status" aria-live="polite"></div>
<div id="banner" aria-hidden="true"><span></span></div>
</body>
</html>`;
}

// ---------- entrada ----------

export function paginaEntrar({ primeira = false, local = true, voltar = '' }) {
  const titulo = primeira ? 'Primeira fogueira' : 'Descanse na fogueira';
  const texto = primeira
    ? 'Crie o seu usuário e a sua senha. Esta tela só aparece uma vez e só abre nesta máquina.'
    : 'Entre para continuar de onde parou.';
  const form = primeira && !local
    ? '<p class="erro-form">A primeira configuração só pode ser feita nesta máquina, em http://localhost.</p>'
    : `<form class="form-entrar" data-form="${primeira ? 'configurar' : 'entrar'}"${voltar ? ` data-voltar="${esc(voltar)}"` : ''} novalidate>
      <label for="usuario">${primeira ? 'Usuário' : '@usuário ou e-mail'}</label>
      <input id="usuario" name="usuario" autocomplete="username" required minlength="3" maxlength="32" autofocus>
      <label for="senha">Senha${primeira ? ' (mínimo de 10 caracteres)' : ''}</label>
      <input id="senha" name="senha" type="password" autocomplete="${primeira ? 'new-password' : 'current-password'}" required maxlength="200">
      ${primeira ? `<label for="confirmacao">Repita a senha</label>
      <input id="confirmacao" name="confirmacao" type="password" autocomplete="new-password" required maxlength="200">` : ''}
      <p class="erro-form" data-erro hidden></p>
      <button class="btn btn-ouro" type="submit">${acao('entrar', primeira ? 'Acender a fogueira' : 'Entrar')}</button>
      ${primeira ? '' : `<button type="button" class="btn-x" data-reenviar hidden>Reenviar e-mail de confirmação</button>
      <p class="ajuda">Ainda não tem conta? As contas são criadas por convite: <a href="/convite">tenho um código</a>.</p>`}
    </form>`;
  return layout({
    titulo,
    classe: 'tela-entrar',
    corpo: `
    <section class="cena-fogueira">
      <div class="brasas grandes" aria-hidden="true">${'<i></i>'.repeat(18)}</div>
      <div class="fogueira-grande">${sprite('fogueira', { escala: 8 })}</div>
      <h1 class="titulo-gotico">std<span class="titulo-dying">(dying)</span></h1>
      <p class="sub">${esc(titulo)}</p>
      <div class="caixa caixa-entrar">
        <p>${esc(texto)}</p>
        ${form}
      </div>
    </section>`,
  });
}

// ---------- início ----------

const MENSAGENS_NO_CHAO = [
  'Prova adiante, portanto revise',
  'Questão difícil adiante, portanto respire',
  'Cuidado com a pressa',
  'Tente o caderno de erros',
  'Tesouro adiante: a revisão de 24 h',
  'Se ao menos eu tivesse feito o simulado…',
  'Visões de aprovação…',
  'Sono adiante, portanto durma',
  'Seja forte, ó estudante',
  'Edital adiante, portanto leia com calma',
];

export function proximaProva(cards) {
  const hoje = hojeISO();
  return cards
    .filter((c) => c.prova && c.prova >= hoje)
    .map((c) => ({ ...c, dias: diasEntre(hoje, c.prova) }))
    .sort((a, b) => a.dias - b.dias)[0] || null;
}

function saudacao() {
  const h = new Date().getHours();
  return h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function blocoCitacao() {
  const i = citacaoDoDia();
  const c = CITACOES[i];
  return `<figure class="citacao" data-citacao data-indice="${i}">
    <span class="citacao-tipo" data-citacao-tipo>${esc(c.tipo)}</span>
    <blockquote data-citacao-texto>“${esc(c.texto)}”</blockquote>
    <figcaption><b data-citacao-autor>${esc(c.autor)}</b> · <cite data-citacao-fonte>${esc(c.fonte)}</cite></figcaption>
    <button type="button" class="btn-x" data-citacao-outra>${acao('atualizar', 'Outra reflexão')}</button>
    <script type="application/json" id="citacoes-dados">${JSON.stringify(CITACOES).replace(/</g, '\\u003c')}</script>
  </figure>`;
}

export function paginaInicio({ usuario, cards, eventos, trilhas, almas, foco, totais, streak, grupoNome, diaHoje = null }) {
  const px = ehPixel(usuario);
  const prox = proximaProva(cards);
  const hoje = new Date();
  const dataLonga = hoje.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const msg = MENSAGENS_NO_CHAO[(hoje.getDate() + hoje.getMonth() * 31) % MENSAGENS_NO_CHAO.length];
  const heroi = prox ? `
      <div class="heroi-numero">
        <span class="numero">${prox.dias}</span>
        <span class="numero-rotulo">${prox.dias === 1 ? 'dia' : 'dias'} até ${esc(prox.provaNome)}<br><small>${dataBR(prox.prova)}</small></span>
      </div>` : '<p class="sub">Nenhuma prova marcada.</p>';
  const focoHoje = `<p class="foco-hoje">Foco hoje: <b>${totais.hoje.n ? `${formatarDuracao(totais.hoje.s)} em ${totais.hoje.n} ${totais.hoje.n === 1 ? 'sessão' : 'sessões'}` : 'nenhuma sessão ainda'}</b> · <a href="/foco">${foco ? 'ver sessão em andamento' : 'começar um pomodoro'}</a></p>`;

  const cartoes = cards.map((c) => `
    <a class="cartao caixa ${c.espaco ? `c-${esc(c.cor)}` : `t-${c.slug}`}" href="${c.href || `/t/${c.slug}`}">
      <span class="cartao-topo">${c.espaco ? iconeUI('pasta') : emblema(c.slug)}<span class="cartao-nome">${esc(c.espaco ? 'Meu espaço' : (px ? c.nome : 'Trilha'))}</span></span>
      <span class="mundo">${esc(px ? c.mundo : c.nome)}</span>
      <span class="cartao-linha">${esc(c.linhaPrazo)}</span>
      <span class="barra-rot"><span>Progresso das notas</span><b>${pctTxt(c.pct)}</b></span>
      ${medidor(c.pct, { rotulo: `Progresso de ${c.nome}`, classe: 'tc' })}
      <span class="cartao-pe">${c.semana ? esc(c.semana) : `${fmt.format(c.feitas)} de ${fmt.format(c.total)} tarefas`}</span>
      ${c.focoSemana ? `<span class="cartao-pe">Foco na semana: ${esc(c.focoSemana)}</span>` : ''}
    </a>`).join('');

  const lista = eventos.length
    ? eventos.map((e) => `<li><span class="ev-trilha t-${esc(e.trilha || 'inicio')}">${esc(trilhas.find((t) => t.slug === e.trilha)?.curto || 'Conta')}</span>
        <span class="ev-txt">${esc(e.texto)}</span><time>${tempoAtras(e.quando)}</time></li>`).join('')
    : '<li class="vazio">Nada por aqui ainda. Marque uma tarefa, registre questões ou comece um pomodoro.</li>';

  return layout({
    titulo: px ? 'Fogueira' : 'Início',
    ativo: 'inicio',
    usuario,
    trilhas,
    almas,
    foco,
    classe: 'pg-inicio',
    corpo: `
    <section class="inicio-topo envolve">
      <div class="inicio-txt">
        <p class="eyebrow">${esc(dataLonga)}</p>
        <h1 class="titulo-gotico">${esc(saudacao())}, ${esc(usuario.usuario)}.</h1>
        ${heroi}
        ${focoHoje}
        ${blocoStreak(streak, px, grupoNome)}
        ${blocoCitacao()}
        ${px ? `<p class="mensagem-chao" title="Mensagem deixada no chão"><span>Mensagem no chão</span>“${esc(msg)}”</p>` : ''}
      </div>
      ${px ? `<div class="inicio-fogo" aria-hidden="true">${sprite('fogueira', { escala: 9 })}</div>` : ''}
    </section>
    ${blocoHoje(diaHoje, trilhas)}
    <section class="envolve">
      <h2 class="titulo-secao">${px ? 'Escolha a sua trilha' : 'Trilhas'}</h2>
      <div class="cartoes">${cartoes}</div>
    </section>
    <section class="envolve">
      <h2 class="titulo-secao">Últimas ações</h2>
      <ul class="eventos caixa">${lista}</ul>
    </section>`,
  });
}

// ---------- gráfico de questões por semana (SVG) ----------

function teto(v) {
  const passos = [10, 20, 50, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000];
  return passos.find((p) => p >= v) || Math.ceil(v / 1000) * 1000;
}

function graficoSemanas(cargo, semanaAtual) {
  const ws = cargo.semanas;
  const max = teto(Math.max(10, ...ws.map((w) => Math.max(w.q, w.metaQ || 0))) * 1.05);
  const passo = 20, larg = 12, esq = 34, topo = 8, alt = 110, base = topo + alt;
  const L = esq + ws.length * passo + 6, A = base + 22;
  const y = (v) => base - Math.round((v / max) * alt);
  const ticks = [0, max / 2, max].map((v) => `
      <line class="g-grade" x1="${esq}" x2="${L - 4}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="g-eixo" x="${esq - 5}" y="${y(v) + 3}" text-anchor="end">${fmt.format(v)}</text>`).join('');
  const barras = ws.map((w, i) => {
    const x = esq + i * passo + (passo - larg) / 2;
    const h = base - y(w.q);
    const atual = w.s === semanaAtual;
    const dica = `S${w.s} (${dataBR(w.inicio, false)}): ${fmt.format(w.q)} questões${w.pct != null ? `, ${Math.round(w.pct)}% de acerto` : ''}${w.metaQ ? ` · meta ${fmt.format(w.metaQ)}` : ''}`;
    const rotuloX = ws.length <= 10 || i % 2 === (ws.length - 1) % 2
      ? `<text class="g-eixo${atual ? ' g-atual' : ''}" x="${x + larg / 2}" y="${base + 14}" text-anchor="middle">S${w.s}</text>` : '';
    return `<g class="g-coluna" tabindex="0" data-dica="${esc(dica)}">
        <rect class="g-alvo" x="${esq + i * passo}" y="${topo}" width="${passo}" height="${alt}"/>
        ${h > 0 ? `<rect class="g-barra${atual ? ' g-barra-atual' : ''}" x="${x}" y="${y(w.q)}" width="${larg}" height="${h}"/>
        <rect class="g-brilho" x="${x}" y="${y(w.q)}" width="${larg}" height="2"/>` : ''}
        ${rotuloX}
      </g>`;
  }).join('');
  const meta = ws.map((w, i) => (w.metaQ ? `<line class="g-meta" x1="${esq + i * passo + 1}" x2="${esq + (i + 1) * passo - 1}" y1="${y(w.metaQ)}" y2="${y(w.metaQ)}"/>` : '')).join('');
  const temMeta = ws.some((w) => w.metaQ);
  return `<figure class="grafico">
      <figcaption>Questões por semana${temMeta ? ' · <span class="chave-meta">linha clara = meta da semana</span>' : ''}</figcaption>
      <div class="grafico-rolagem"><svg viewBox="0 0 ${L} ${A}" width="${L * 2}" height="${A * 2}" shape-rendering="crispEdges" role="img" aria-label="Questões resolvidas por semana">
        ${ticks}
        <line class="g-base" x1="${esq}" x2="${L - 4}" y1="${base}" y2="${base}"/>
        ${barras}
        ${meta}
      </svg></div>
    </figure>`;
}

function blocoDesempenho(resumo, px) {
  if (!resumo) return '';
  if (resumo.semanaAtual < 1) {
    const dias = diasEntre(hojeISO(), resumo.inicio);
    return `<div class="caixa painel-vazio">${px ? sprite('moeda', { escala: 3 }) : ''}<p>O plano começa em ${dataBR(resumo.inicio)}, daqui a ${dias} ${dias === 1 ? 'dia' : 'dias'}. Registros feitos antes disso contam como treino.</p></div>`;
  }
  return resumo.cargos.map((c) => {
    const w = c.atual;
    const metaQ = w?.metaQ;
    const pctQ = metaQ ? Math.min(100, (100 * (w?.q || 0)) / metaQ) : 0;
    const naMeta = w?.pct != null && w.pct >= w.metaPct;
    const status = w?.pct == null ? '<span class="status neutro">sem questões nesta semana</span>'
      : naMeta ? `<span class="status bom">✓ na meta (≥ ${w.metaPct}%)</span>`
        : `<span class="status ruim">▼ abaixo da meta de ${w.metaPct}%</span>`;
    const horas = w?.min ? `${Math.floor(w.min / 60)}h${String(w.min % 60).padStart(2, '0')}` : '0h';
    const materias = w?.materias?.length
      ? `<div class="tabela"><table class="t-materias"><thead><tr><th>Matéria</th><th class="num">Questões</th><th class="num">Acerto</th></tr></thead><tbody>
          ${w.materias.map((m) => `<tr><td>${esc(m.materia)}</td><td class="num">${fmt.format(m.q)}</td><td class="num">${pctTxt(m.pct)}${m.pct != null && m.pct < w.metaPct ? ' <span class="status ruim mini">▼</span>' : ''}</td></tr>`).join('')}
        </tbody></table></div>` : '';
    const grafico = c.totalQ > 0 ? graficoSemanas(c, resumo.semanaAtual)
      : '<p class="vazio">Nenhuma questão registrada ainda para este cargo. Use o formulário “Registrar sessão” para lançar a primeira.</p>';
    return `
    <section class="caixa cargo">
      <h3 class="cargo-nome">${esc(c.nome)} <small>semana S${resumo.semanaAtual}${w ? ` · ${dataBR(w.inicio, false)} a ${dataBR(somarDias(w.inicio, 6), false)}` : ''}</small></h3>
      ${c.obs ? `<p class="nota-cargo">${esc(c.obs)}</p>` : ''}
      <div class="tiles">
        <div class="tile"><span class="tile-rot">Questões na semana</span><span class="tile-val">${fmt.format(w?.q || 0)}</span>
          <span class="tile-sub">${metaQ ? `meta: ${fmt.format(metaQ)}` : 'sem meta definida'}</span>${metaQ ? medidor(pctQ, { rotulo: 'Questões da semana em relação à meta', classe: 'tc' }) : ''}</div>
        <div class="tile"><span class="tile-rot">Acerto na semana</span><span class="tile-val">${pctTxt(w?.pct)}</span>${status}</div>
        <div class="tile"><span class="tile-rot">Tempo registrado</span><span class="tile-val">${horas}</span>
          <span class="tile-sub">${c.horasSemana ? `plano: ${c.horasSemana} h por semana` : ''}</span></div>
        ${w?.redacao != null ? `<div class="tile"><span class="tile-rot">Redação</span><span class="tile-val">${pctTxt(w.redacao)}</span><span class="tile-sub">nota média da semana</span></div>` : ''}
      </div>
      ${grafico}
      ${materias}
    </section>`;
  }).join('');
}

function blocoRegistro(t, estudos, registros) {
  const cargos = Object.keys(estudos?.cargos || {});
  if (!cargos.length) return '';
  const ultimos = (registros || []).slice(-8).reverse();
  const materias = [...new Set((registros || []).map((r) => r.materia))].slice(-60);
  return `
  <section class="caixa registro">
    <h3>Registrar sessão de questões</h3>
    <p class="ajuda">Grava uma linha no registro de questões desta trilha.</p>
    <form class="form-registro" data-form="registro" data-trilha="${t.slug}" novalidate>
      <div class="campos">
        <label>Data<input type="date" name="data" value="${hojeISO()}" required></label>
        <label class="cargo">Cargo<select name="cargo" required>${cargos.map((c) => `<option value="${esc(c)}">${esc(nomeCargo(c))}</option>`).join('')}</select></label>
        <label class="largo">Matéria<input name="materia" list="materias-${t.slug}" maxlength="80" required placeholder="Ex.: Português"></label>
        <label class="largo">Tópico<input name="topico" maxlength="120" placeholder="Ex.: Crase"></label>
        <label class="largo">Fonte<input name="fonte" maxlength="120" placeholder="Ex.: FCC 2021"></label>
        <label>Questões<input type="number" name="questoes" min="1" max="1000" required inputmode="numeric"></label>
        <label>Acertos<input type="number" name="acertos" min="0" max="1000" step="any" required inputmode="decimal"></label>
        <label>Minutos<input type="number" name="tempo_min" min="0" max="1440" inputmode="numeric"></label>
      </div>
      <datalist id="materias-${t.slug}">${materias.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
      <p class="erro-form" data-erro hidden></p>
      <button class="btn btn-ouro" type="submit">${acao('adicionar', 'Registrar')}</button>
      <p class="ajuda">Para redação, use a matéria “Redação”: questões = nota máxima, acertos = nota.</p>
    </form>
    ${ultimos.length ? `<h4>Últimos registros</h4><ul class="ultimos">${ultimos.map((r) => `
      <li><span>${dataBR(r.data, false)} · ${esc(r.materia)}${r.topico ? ` <small>${esc(r.topico)}</small>` : ''}</span>
        <b>${fmt.format(r.acertos)}/${fmt.format(r.questoes)}</b>
        <button type="button" class="btn-x" data-remover="${r.linha}" data-hash="${r.hash}" data-trilha="${t.slug}" aria-label="Remover registro de ${esc(r.materia)} em ${dataBR(r.data)}">${acao('excluir', 'Remover')}</button></li>`).join('')}</ul>` : ''}
  </section>`;
}

function blocoProjecao(t, proj) {
  if (!proj) return '';
  return `
  <section class="caixa projecao">
    <h3>Ritmo da forja</h3>
    <form class="form-projecao" data-form="projecao" data-trilha="${t.slug}">
      <label>Horas por semana<select name="ritmo">${[5, 8, 10, 15, 20, 25, 30, 40].map((h) => `<option value="${h}"${h === proj.ritmo ? ' selected' : ''}>${h} h</option>`).join('')}</select></label>
      <label>Ritmo cheio a partir de<input type="date" name="inicio" value="${esc(proj.inicio)}"></label>
    </form>
    <div class="tiles">
      <div class="tile"><span class="tile-rot">Horas restantes</span><span class="tile-val">${fmt.format(Math.round(proj.restantes))}</span><span class="tile-sub">de ${fmt.format(proj.total)} h</span></div>
      <div class="tile"><span class="tile-rot">Chefe final</span><span class="tile-val">${proj.restantes < 0.5 ? 'Derrotado' : esc(mesAno(proj.fim))}</span><span class="tile-sub">${fmt.format(Math.ceil(proj.semanas))} semanas a ${proj.ritmo} h</span></div>
    </div>
  </section>`;
}

function blocoFocoTrilha(t, tot) {
  return `
  <section class="caixa foco-trilha">
    <h3>Foco nesta trilha</h3>
    <div class="tiles">
      <div class="tile"><span class="tile-rot">Hoje</span><span class="tile-val">${tot?.hojeN ? formatarDuracao(tot.hojeS) : '0 min'}</span><span class="tile-sub">${tot?.hojeN || 0} ${tot?.hojeN === 1 ? 'sessão' : 'sessões'}</span></div>
      <div class="tile"><span class="tile-rot">Nesta semana</span><span class="tile-val">${tot?.semanaN ? formatarDuracao(tot.semanaS) : '0 min'}</span><span class="tile-sub">${tot?.semanaN || 0} ${tot?.semanaN === 1 ? 'sessão' : 'sessões'}</span></div>
    </div>
    <a class="btn btn-ouro" href="/foco?trilha=${t.slug}">${acao('iniciar', 'Começar um pomodoro aqui')}</a>
  </section>`;
}

// ---------- página da trilha ----------

export function paginaTrilha({ usuario, trilhas, almas, foco, t, info, notas, arquivos, estudos, resumo, registros, proj, eventos, temCSV, focoTrilha, anotacoes = [] }) {
  const px = ehPixel(usuario);
  const listaNotas = notas.map((n) => {
    const pct = n.total ? (100 * n.feitas) / n.total : null;
    const icone = px ? (n.meta.hex ? sprite('minerio', { arg: n.meta.hex, escala: 3 }) : '<span class="pergaminho" aria-hidden="true"></span>') : '';
    const fimFase = proj?.porNota?.get(n.rel);
    return `
      <li><a class="nota-linha" href="/t/${t.slug}/n/${caminhoURL(n.rel)}">
        ${icone}
        <span class="nota-info"><span class="nota-titulo">${esc(n.tituloCurto)}</span>
          <span class="nota-meta">${px ? esc(n.rel) : ''}${n.meta.horas ? ` · ${n.meta.horas} h` : ''}${n.meta.cor ? ` · faixa ${esc(n.meta.cor)}` : ''}${fimFase ? ` · ${esc(fimFase)}` : ''}</span></span>
        <span class="nota-prog">${n.total ? `<b>${n.feitas}/${n.total}</b>${medidor(pct, { rotulo: `Progresso de ${n.tituloCurto}`, classe: 'tc' })}` : '<small>sem tarefas</small>'}</span>
      </a></li>`;
  }).join('');

  const outros = arquivos.filter((a) => a.ext !== '.md');
  const pastas = new Map();
  for (const a of outros) {
    const dir = a.rel.includes('/') ? a.rel.slice(0, a.rel.lastIndexOf('/')) : '';
    if (!pastas.has(dir)) pastas.set(dir, []);
    pastas.get(dir).push(a);
  }
  const blocoArquivos = outros.length ? `
    <section class="envolve">
      <h2 class="titulo-secao">${px ? 'Baú de arquivos' : 'Arquivos'}</h2>
      <div class="bau">${[...pastas].map(([dir, itens]) => `
        <details class="caixa"${pastas.size === 1 ? ' open' : ''}>
          <summary>${esc(dir || (px ? 'Raiz do cofre' : 'Arquivos'))} <small>${itens.length} ${itens.length === 1 ? 'arquivo' : 'arquivos'}</small></summary>
          <ul>${itens.map((a) => `<li><a href="/t/${t.slug}/arquivo/${caminhoURL(a.rel)}" target="_blank" rel="noopener">${esc(a.rel.split('/').pop())}</a><small>${(a.tamanho / 1024).toFixed(0)} KB</small></li>`).join('')}</ul>
        </details>`).join('')}</div>
    </section>` : '';

  const evs = eventos.length ? `<ul class="eventos caixa">${eventos.map((e) => `<li><span class="ev-txt">${esc(e.texto)}</span><time>${tempoAtras(e.quando)}</time></li>`).join('')}</ul>` : '';

  return layout({
    titulo: t.nome,
    ativo: t.slug,
    usuario,
    trilhas,
    almas,
    foco,
    classe: `pg-trilha t-${t.slug}`,
    corpo: `
    <section class="trilha-heroi envolve">
      ${px ? `<div class="heroi-emblema">${emblema(t.slug, 6)}</div>` : ''}
      <div class="heroi-txt">
        <p class="eyebrow">Trilha · ${esc(t.curto)}</p>
        <h1 class="titulo-gotico">${esc(px ? (t.mundo || t.nome) : t.nome)}</h1>
        <p class="heroi-nome">${esc(estudos?.concurso || t.nome)}</p>
        ${px ? `<p class="lema">${esc(t.lema || '')}</p>` : ''}
        ${info.chamado ? `<p class="chamado">${esc(info.chamado)}</p>` : ''}
        <div class="heroi-barra">
          <span class="barra-rot"><span>${fmt.format(info.feitas)} de ${fmt.format(info.total)} tarefas concluídas</span><b>${pctTxt(info.pct)}</b></span>
          ${medidor(info.pct, { rotulo: 'Progresso da trilha', classe: 'tc grande' })}
        </div>
      </div>
    </section>
    <div class="trilha-grade envolve">
      <section>
        <h2 class="titulo-secao">${t.slug === 'dev' ? 'Fases' : t.slug === 'carreira' ? 'Partes' : px ? 'Notas do cofre' : 'Conteúdo'}</h2>
        <ul class="notas caixa">${listaNotas || '<li class="vazio">Nenhuma nota encontrada.</li>'}</ul>
        <h2 class="titulo-secao">Anotações</h2>
        <div class="caixa anotacoes-trilha">
          <p>As anotações ficam no <b>Caderno</b>: notas em Markdown, links entre notas, grafo e desenho à caneta.</p>
          <div class="foco-botoes"><a class="btn btn-ouro" href="${linkAnotar(t.nome, t.slug)}">${acao('editar', 'Nova anotação desta trilha')}</a><a class="btn" href="/caderno">${acao('caderno', 'Abrir o Caderno')}</a></div>
        </div>
        ${evs ? `<h2 class="titulo-secao">Últimas ações</h2>${evs}` : ''}
      </section>
      <aside class="lateral">
        ${blocoFocoTrilha(t, focoTrilha)}
        ${blocoProjecao(t, proj)}
        ${temCSV ? blocoRegistro(t, estudos, registros) : ''}
        ${resumo ? `<h2 class="titulo-secao">Desempenho</h2>${blocoDesempenho(resumo, px)}` : ''}
      </aside>
    </div>
    ${blocoArquivos}`,
  });
}

// ---------- nota ----------

export function paginaNota({ usuario, trilhas, almas, foco, t, nota, html, toc, linkCaderno = null }) {
  const px = ehPixel(usuario);
  const pct = nota.total ? (100 * nota.feitas) / nota.total : null;
  const indice = toc.length > 1 ? `
    <details class="indice caixa" data-indice-nota open>
      <summary class="indice-rot">Seções</summary>
      <nav aria-label="Seções da nota"><ol>${toc.map((s) => `<li class="n${s.nivel}"><a href="#${esc(s.id)}" data-secao="${esc(s.id)}">${esc(s.texto)}</a></li>`).join('')}</ol></nav>
    </details>` : '';
  return layout({
    titulo: nota.tituloCurto,
    ativo: t.slug,
    usuario,
    trilhas,
    almas,
    foco,
    classe: `pg-nota t-${t.slug}`,
    notaAtual: nota.rel,
    corpo: `
    <div class="envolve nota-cabeca">
      <nav class="migalhas" aria-label="Você está em"><a href="/t/${t.slug}">${esc(px ? (t.mundo || t.nome) : t.nome)}</a> <span aria-hidden="true">›</span> <span>${esc(px ? nota.rel : nota.tituloCurto)}</span></nav>
      <div class="nota-acoes">
        ${nota.total ? `<span class="barra-rot"><span><b data-feitas>${nota.feitas}</b> de <b data-total>${nota.total}</b> tarefas</span><b data-pct-txt>${pctTxt(pct)}</b></span>
        ${medidor(pct, { rotulo: 'Progresso da nota', classe: 'tc', marca: ' data-nota-medidor' })}` : ''}
        <div class="nota-botoes">
          <a class="btn" href="/foco?trilha=${t.slug}&amp;assunto=${encodeURIComponent(nota.tituloCurto)}">${acao('foco', 'Focar nesta nota')}</a>
          ${linkCaderno ? `<a class="btn" href="${esc(linkCaderno)}">${acao('editar', 'Editar no caderno')}</a>` : ''}
          <a class="btn" href="${linkAnotar(nota.tituloCurto, t.slug)}">${acao('adicionar', 'Anotar')}</a>
          ${px ? `<a class="btn" href="obsidian://open?path=${encodeURIComponent(nota.abs)}">${acao('link', 'Abrir no Obsidian')}</a>` : ''}
        </div>
      </div>
    </div>
    <div class="nota-grade envolve${indice ? '' : ' sem-indice'}">
      ${indice}
      <article class="nota caixa" data-trilha="${t.slug}" data-arquivo="${esc(nota.rel)}">${html}</article>
    </div>`,
  });
}

// ---------- foco (pomodoro) ----------

const MODOS = [
  { valor: 'foco-25', tipo: 'foco', minutos: 25, rotulo: 'Foco 25' },
  { valor: 'foco-50', tipo: 'foco', minutos: 50, rotulo: 'Foco 50' },
  { valor: 'pausa-5', tipo: 'pausa', minutos: 5, rotulo: 'Pausa 5' },
  { valor: 'pausa-15', tipo: 'pausa', minutos: 15, rotulo: 'Pausa 15' },
  { valor: 'livre', tipo: 'foco', minutos: 30, rotulo: 'Livre' },
];

export function paginaFoco({ usuario, trilhas, almas, foco, totais, recentes, assuntos, trilhaInicial, assuntoInicial }) {
  const px = ehPixel(usuario);
  const nomeTrilha = (slug) => trilhas.find((t) => t.slug === slug)?.nome || slug;
  const curtoTrilha = (slug) => trilhas.find((t) => t.slug === slug)?.curto || slug;
  const slugPainel = foco?.trilha || trilhaInicial;

  const painel = foco ? `
    <div class="foco-ativo" data-foco-painel-id="${foco.id}">
      <p class="foco-tipo">${foco.tipo === 'pausa' ? 'Pausa' : 'Foco'} · ${esc(nomeTrilha(foco.trilha))}${foco.estado === 'pausado' ? ' · <b>pausado</b>' : ''}</p>
      <p class="foco-assunto">${esc(foco.assunto || 'Sem assunto')}</p>
      <div class="relogio-grande" data-foco-relogio>${mmss(foco.restanteMs)}</div>
      ${medidor((100 * foco.decorridoMs) / (foco.duracao_s * 1000), { rotulo: 'Tempo decorrido', classe: 'tc grande', marca: ' data-foco-barra' })}
      <div class="foco-botoes">
        ${foco.estado === 'rodando'
          ? `<button type="button" class="btn" data-foco-acao="pausar" data-id="${foco.id}">${acao('pausar', 'Pausar')}</button>`
          : `<button type="button" class="btn btn-ouro" data-foco-acao="retomar" data-id="${foco.id}">${acao('iniciar', 'Retomar')}</button>`}
        <button type="button" class="btn" data-foco-acao="concluir" data-id="${foco.id}">${acao('concluir', 'Concluir agora')}</button>
        <button type="button" class="btn-x" data-foco-acao="cancelar" data-id="${foco.id}">${acao('fechar', 'Abandonar')}</button>
      </div>
      <p class="ajuda">Pode trocar de página ou fechar o navegador: o tempo continua contando no servidor e a sessão é registrada quando acabar.</p>
    </div>` : `
    <form class="form-foco" data-form="foco-iniciar" novalidate>
      <fieldset class="modos"><legend>Modo</legend>
        ${MODOS.map((m, i) => `<label class="modo"><input type="radio" name="modo" value="${m.valor}" data-tipo="${m.tipo}" data-minutos="${m.minutos}"${i === 0 ? ' checked' : ''}><span>${m.rotulo}</span></label>`).join('')}
      </fieldset>
      <label class="livre" hidden>Minutos<input type="number" name="minutos" min="1" max="180" value="30" inputmode="numeric"></label>
      <div class="relogio-grande" data-relogio-previa>25:00</div>
      <div class="campos-foco">
        <label>Trilha<select name="trilha" required>${trilhas.map((t) => `<option value="${t.slug}"${t.slug === trilhaInicial ? ' selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></label>
        <label>Assunto<input name="assunto" maxlength="100" value="${esc(assuntoInicial)}" list="assuntos-${esc(trilhaInicial)}" placeholder="Ex.: Crase, Redes, Ponteiros em C" autocomplete="off"></label>
      </div>
      ${Object.entries(assuntos).map(([slug, lista]) => `<datalist id="assuntos-${esc(slug)}">${lista.map((a) => `<option value="${esc(a)}">`).join('')}</datalist>`).join('')}
      <p class="erro-form" data-erro hidden></p>
      <div class="foco-botoes">
        <button class="btn btn-ouro" type="submit">${acao('iniciar', px ? 'Acender a chama' : 'Começar')}</button>
        <label class="som"><input type="checkbox" id="foco-som" checked> Som ao terminar</label>
      </div>
    </form>`;

  const n = totais.hoje.n;
  const frascos = px
    ? `<div class="frascos" aria-label="${n} ${n === 1 ? 'sessão concluída' : 'sessões concluídas'} hoje">${
      Array.from({ length: Math.max(8, n) }, (_, i) => sprite('frasco', { arg: i < n ? 'cheio' : 'vazio', escala: 3 })).join('')}</div>`
    : '';
  const porTrilha = trilhas.map((t) => {
    const p = totais.porTrilha[t.slug];
    return `<tr><td><span class="ev-trilha t-${t.slug}">${esc(t.curto)}</span></td><td class="num">${p?.hojeN ? formatarDuracao(p.hojeS) : '—'}</td><td class="num">${p?.semanaN ? formatarDuracao(p.semanaS) : '—'}</td></tr>`;
  }).join('');

  const listaRecentes = recentes.length ? recentes.map((s) => {
    const d = new Date(s.inicio);
    const quando = `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toTimeString().slice(0, 5)}`;
    const estado = s.estado === 'cancelado' ? ' · abandonada' : s.manual ? ' · manual' : '';
    return `<li><span class="ev-trilha t-${esc(s.trilha)}">${esc(curtoTrilha(s.trilha))}</span>
      <span class="ev-txt">${esc(s.assunto || 'Sem assunto')} <small>${s.tipo === 'pausa' ? 'pausa' : 'foco'} de ${formatarDuracao(s.foco_s || 0)}${estado}</small></span>
      <time>${quando}</time>
      <button type="button" class="btn-x" data-foco-remover="${s.id}" aria-label="Remover sessão de ${esc(s.assunto || 'sem assunto')}">${acao('excluir', 'Remover')}</button></li>`;
  }).join('') : '<li class="vazio">Nenhuma sessão ainda. A primeira aparece aqui assim que terminar.</li>';

  return layout({
    titulo: 'Foco',
    ativo: 'foco',
    usuario,
    trilhas,
    almas,
    foco,
    classe: 'pg-foco',
    corpo: `
    <div class="foco-grade envolve">
      <section class="foco-painel caixa t-${esc(slugPainel)}" data-foco-pagina>
        <p class="eyebrow">Pomodoro</p>
        <h1 class="titulo-gotico">Foco</h1>
        ${painel}
      </section>
      <aside class="lateral">
        <section class="caixa">
          <h3>Hoje</h3>
          ${frascos}
          <p class="foco-resumo"><b>${n ? formatarDuracao(totais.hoje.s) : '0 min'}</b> de foco em ${n} ${n === 1 ? 'sessão' : 'sessões'} · semana: <b>${formatarDuracao(totais.semana.s)}</b></p>
        </section>
        <section class="caixa">
          <h3>Tempo por trilha</h3>
          <div class="tabela"><table><thead><tr><th>Trilha</th><th class="num">Hoje</th><th class="num">Semana</th></tr></thead><tbody>${porTrilha}</tbody></table></div>
        </section>
      </aside>
    </div>
    <section class="envolve">
      <h2 class="titulo-secao">Sessões recentes</h2>
      <ul class="eventos caixa sessoes">${listaRecentes}</ul>
      <div class="foco-extras">
        <details class="caixa manual">
          <summary>Registrar uma sessão feita sem o cronômetro</summary>
          <form class="form-manual" data-form="foco-manual" novalidate>
            <div class="campos">
              <label>Data<input type="date" name="data" value="${hojeISO()}" required></label>
              <label>Início<input type="time" name="hora" required></label>
              <label>Minutos<input type="number" name="minutos" min="1" max="600" required inputmode="numeric"></label>
              <label class="cargo">Trilha<select name="trilha">${trilhas.map((t) => `<option value="${t.slug}"${t.slug === trilhaInicial ? ' selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></label>
              <label class="largo">Assunto<input name="assunto" maxlength="100" list="assuntos-${esc(trilhaInicial)}"></label>
            </div>
            <p class="erro-form" data-erro hidden></p>
            <button class="btn btn-ouro" type="submit">${acao('adicionar', 'Registrar sessão')}</button>
          </form>
        </details>
        <a class="btn" href="/foco/exportar.csv">${acao('baixar', 'Exportar sessões (CSV)')}</a>
      </div>
    </section>`,
  });
}

// ---------- caderno: ver paginaCaderno (fim do arquivo) ----------

// ---------- conta: ver paginaConfiguracoes ----------


// ---------- streak e mapa de dias ----------

function blocoStreak(st, px, grupoNome) {
  if (!st) return '';
  const vivo = st.atual > 0;
  return `<p class="streak-linha">${px ? sprite('fogueira', { escala: 2 }) : ''}<b>${st.atual} ${st.atual === 1 ? 'dia seguido' : 'dias seguidos'}</b>
    estudando${st.hojeConta ? ' · hoje já conta' : vivo ? ' · estude hoje para não perder' : ''} · recorde ${st.recorde}
    · <a href="/grupo">${grupoNome ? `grupo ${esc(grupoNome)}` : 'criar um grupo de estudos'}</a></p>`;
}

const nivel = (min) => (min <= 0 ? 0 : min < 25 ? 1 : min < 60 ? 2 : min < 120 ? 3 : 4);
function mapaDias(mapa, rotulo) {
  if (!mapa) return '';
  return `<div class="mapa-dias" role="img" aria-label="${esc(rotulo)}">${mapa.map((d) => `<i class="n${d.futuro ? 'f' : nivel(d.min)}" title="${dataBR(d.dia, false)}: ${d.min} min"></i>`).join('')}</div>
    <div class="mapa-legenda"><span>menos</span><i class="n0"></i><i class="n1"></i><i class="n2"></i><i class="n3"></i><i class="n4"></i><span>mais</span></div>`;
}

const iniciais = (nome) => String(nome || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
const CORES_AVATAR = ['brasa', 'anil', 'verde', 'ouro', 'violeta', 'rubi'];
const avatar = (m) => `<span class="avatar c-${CORES_AVATAR[m.id % CORES_AVATAR.length]}" aria-hidden="true">${esc(iniciais(m.nome))}</span>`;

function quando(ms) {
  const d = new Date(ms);
  const hoje = new Date().toLocaleDateString('sv-SE');
  const dia = d.toLocaleDateString('sv-SE');
  const hora = d.toTimeString().slice(0, 5);
  return dia === hoje ? `hoje ${hora}` : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
}

function itemMural(x) {
  const detalhe = [x.trilha, x.assunto].filter(Boolean).map(esc).join(' · ');
  return `<li><span class="mural-quem">${avatar(x)}<a href="/grupo/${esc(x.arroba)}">${x.souEu ? 'Você' : esc(x.nome)}</a></span>
    <span class="ev-txt">estudou <b>${x.minutos} min</b>${detalhe ? ` · ${detalhe}` : ''}${x.manual ? ' <small>(registro manual)</small>' : ''}</span>
    <time>${quando(x.quando)}</time></li>`;
}

// ---------- grupo ----------

export function paginaGrupo({ usuario, trilhas, almas, foco, membro, membros = [], mural = [], convites = [], base, streak }) {
  const px = ehPixel(usuario);
  let corpo;
  if (!membro) {
    corpo = `
    <section class="envolve conta-topo"><p class="eyebrow">Grupo de estudos</p><h1 class="titulo-gotico">Grupo</h1>
      <p class="lema">Estude junto: cada pessoa vê o streak e as sessões que as outras escolheram compartilhar.</p></section>
    <div class="conta-grade envolve">
      <section class="caixa"><h3>Criar um grupo</h3>
        <form data-form="grupo-criar" class="form-conta" novalidate>
          <label>Nome do grupo<input name="nome" maxlength="60" required placeholder="Ex.: Rumo à aprovação"></label>
          <p class="erro-form" data-erro hidden></p>
          <button class="btn btn-ouro" type="submit">${acao('grupo', 'Criar grupo')}</button>
        </form></section>
      <section class="caixa"><h3>Recebi um convite</h3>
        <p>Abra o link que recebeu ou digite o código.</p>
        <a class="btn" href="/convite">Digitar código</a></section>
    </div>`;
  } else if (!membro.consentiu) {
    corpo = `
    <section class="envolve conta-topo"><p class="eyebrow">Grupo de estudos</p><h1 class="titulo-gotico">${esc(membro.grupo_nome)}</h1></section>
    <section class="envolve"><div class="caixa consentimento">
      <h3>Antes de entrar: o que você compartilha?</h3>
      <p>No grupo, cada pessoa vê <b>apenas</b> o que as outras escolheram compartilhar. Suas notas, caderno, cofres e questões <b>nunca</b> aparecem para ninguém. Você pode mudar isto quando quiser em Configurações.</p>
      <form data-form="grupo-consentir" class="form-conta" novalidate>
        <label class="opcao"><input type="checkbox" name="tempo" checked> <span><b>Tempo e dias de estudo</b>: streak, mapa de dias e duração das sessões de foco.</span></label>
        <label class="opcao"><input type="checkbox" name="trilha" checked> <span><b>Trilha</b> de cada sessão (ex.: “ENEM 2026”).</span></label>
        <label class="opcao"><input type="checkbox" name="assunto"> <span><b>Assunto</b> de cada sessão (ex.: “Crase”).</span></label>
        <p class="ajuda">Só quem também aceitou estas regras vê o grupo. Registramos a data deste aceite.</p>
        <p class="erro-form" data-erro hidden></p>
        <div class="foco-botoes"><button class="btn btn-ouro" type="submit">Aceitar e entrar no grupo</button>
          <button type="button" class="btn-x" data-acao-url="/api/grupo/sair" data-confirmar data-acao-ir="/grupo">Recusar e sair do grupo</button></div>
      </form></div></section>`;
  } else {
    const admin = membro.dono_id === usuario.id;
    const cartoes = membros.map((m) => `
      <article class="caixa membro${m.souEu ? ' eu' : ''}">
        <header>${avatar(m)}<span class="membro-nome"><a href="/grupo/${esc(m.arroba)}">${esc(m.nome)}</a><small>@${esc(m.arroba)}${m.admin ? ' · administra' : ''}${m.souEu ? ' · você' : ''}</small></span></header>
        ${m.pendente ? '<p class="vazio">Ainda não aceitou as regras do grupo.</p>'
          : !m.compartilhaTempo ? '<p class="vazio">Não compartilha o tempo de estudo.</p>'
          : `<div class="membro-streak">${px ? sprite('fogueira', { escala: 2 }) : ''}<b>${m.streak.atual}</b><span>${m.streak.atual === 1 ? 'dia seguido' : 'dias seguidos'}<br><small>recorde ${m.streak.recorde} · hoje ${m.streak.minutosHoje} min</small></span></div>
             ${mapaDias(m.mapa, `Dias de estudo de ${m.nome} nas últimas 12 semanas`)}`}
        ${admin && !m.souEu ? `<button type="button" class="btn-x" data-acao-url="/api/grupo/remover" data-acao-corpo='{"id":${m.id}}' data-confirmar data-acao-msg="Membro removido do grupo.">${acao('excluir', 'Remover do grupo')}</button>` : ''}
      </article>`).join('');
    corpo = `
    <section class="envolve grupo-topo">
      <div><p class="eyebrow">Grupo de estudos</p><h1 class="titulo-gotico">${esc(membro.grupo_nome)}</h1>
        <p class="lema">Um dia entra no streak com pelo menos 10 min de foco concluído (pomodoro ou registro manual).</p></div>
      <div class="heroi-numero"><span class="numero">${streak.atual}</span><span class="numero-rotulo">${streak.atual === 1 ? 'dia seguido' : 'dias seguidos'}<br><small>recorde: ${streak.recorde}</small></span></div>
    </section>
    <section class="envolve"><h2 class="titulo-secao">Membros</h2><div class="membros">${cartoes}</div></section>
    <div class="trilha-grade envolve">
      <section><h2 class="titulo-secao">Mural</h2>
        <ul class="eventos caixa mural">${mural.length ? mural.map(itemMural).join('') : '<li class="vazio">Nenhuma sessão compartilhada ainda. Conclua um pomodoro e ela aparece aqui.</li>'}</ul></section>
      <aside class="lateral">
        <section class="caixa"><h3>Convidar alguém</h3>
          <form data-form="grupo-convite" class="form-conta" novalidate>
            <div class="campos"><label class="cargo">Validade<select name="horas"><option value="24">24 horas</option><option value="72">3 dias</option><option value="168">7 dias</option></select></label>
            <label>Usos<select name="usos"><option value="1">1 pessoa</option><option value="3">3 pessoas</option><option value="5">5 pessoas</option></select></label></div>
            <p class="erro-form" data-erro hidden></p>
            <button class="btn btn-ouro" type="submit">${acao('adicionar', 'Gerar convite')}</button>
          </form>
          <div class="convite-gerado" data-convite-gerado hidden>
            <p>Código: <b class="codigo" data-convite-codigo></b></p>
            <input readonly data-convite-link aria-label="Link do convite">
            <button type="button" class="btn" data-copiar>${acao('copiar', 'Copiar link')}</button>
            <p class="ajuda">Quem não tem conta cria uma pelo link (com confirmação por e-mail). Também dá para digitar o código em <b>${esc(base)}/convite</b>.</p>
          </div>
          ${convites.length ? `<h4>Convites ativos</h4><ul class="ultimos">${convites.map((c) => `<li><span><b class="codigo">${esc(c.codigo)}</b> <small>até ${quando(c.expira)} · ${c.usos}/${c.usos_max} usos</small></span><span></span>
            <button type="button" class="btn-x" data-acao-url="/api/grupo/convite/revogar" data-acao-corpo='{"codigo":"${esc(c.codigo)}"}' data-confirmar data-acao-msg="Convite revogado.">${acao('fechar', 'Revogar')}</button></li>`).join('')}</ul>` : ''}
        </section>
        <section class="caixa"><h3>Seu compartilhamento</h3>
          <p>Tempo e dias: <b>${membro.compartilha_tempo ? 'sim' : 'não'}</b> · Trilha: <b>${membro.compartilha_trilha ? 'sim' : 'não'}</b> · Assunto: <b>${membro.compartilha_assunto ? 'sim' : 'não'}</b></p>
          <div class="foco-botoes"><a class="btn" href="/configuracoes#privacidade">Mudar</a>
          <button type="button" class="btn-x" data-acao-url="/api/grupo/sair" data-confirmar data-acao-ir="/grupo">${acao('sair', 'Sair do grupo')}</button></div>
        </section>
      </aside>
    </div>`;
  }
  return layout({ titulo: 'Grupo', ativo: 'grupo', usuario, trilhas, almas, foco, classe: 'pg-grupo', corpo });
}

export function paginaMembro({ usuario, trilhas, almas, foco, alvo, mural }) {
  const px = ehPixel(usuario);
  return layout({
    titulo: alvo.nome, ativo: 'grupo', usuario, trilhas, almas, foco, classe: 'pg-grupo',
    corpo: `
    <section class="envolve grupo-topo">
      <div><nav class="migalhas"><a href="/grupo">Grupo</a> › @${esc(alvo.arroba)}</nav>
        <h1 class="titulo-gotico">${esc(alvo.nome)}</h1><p class="heroi-nome">@${esc(alvo.arroba)}</p></div>
      ${alvo.compartilhaTempo ? `<div class="heroi-numero">${px ? sprite('fogueira', { escala: 4 }) : ''}<span class="numero">${alvo.streak.atual}</span><span class="numero-rotulo">${alvo.streak.atual === 1 ? 'dia seguido' : 'dias seguidos'}<br><small>recorde ${alvo.streak.recorde} · ${alvo.streak.diasEstudados} dias estudados</small></span></div>` : ''}
    </section>
    <section class="envolve">${alvo.compartilhaTempo
      ? `<div class="caixa mapa-grande"><h3>Últimas 12 semanas</h3>${mapaDias(alvo.mapa, `Dias de estudo de ${alvo.nome}`)}</div>
         <h2 class="titulo-secao">Histórico de sessões</h2>
         <ul class="eventos caixa mural">${mural.length ? mural.map(itemMural).join('') : '<li class="vazio">Nenhuma sessão ainda.</li>'}</ul>`
      : '<p class="vazio">Esta pessoa não compartilha o tempo de estudo com o grupo.</p>'}</section>`,
  });
}

// ---------- convite, cadastro e mensagens ----------

export function paginaMensagem({ titulo, texto, links = [], usuario = null }) {
  return layout({
    titulo, usuario, classe: 'pg-mensagem',
    corpo: `<section class="envolve mensagem caixa"><h1 class="titulo-gotico">${esc(titulo)}</h1><p>${esc(texto)}</p>
      <div class="foco-botoes">${links.map(([href, rot], i) => `<a class="btn${i === 0 ? ' btn-ouro' : ''}" href="${esc(href)}">${esc(rot)}</a>`).join('')}</div></section>`,
  });
}

export function paginaConviteManual({ usuario }) {
  return layout({
    titulo: 'Convite', usuario, classe: 'pg-mensagem',
    corpo: `<section class="envolve mensagem caixa"><p class="eyebrow">Convite</p><h1 class="titulo-gotico">Tenho um código</h1>
      <p>Digite o código de convite que você recebeu (8 letras e números).</p>
      <form data-form="convite-manual" class="form-conta" novalidate>
        <label>Código<input name="codigo" class="campo-codigo" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" required placeholder="ABCD2345"></label>
        <p class="erro-form" data-erro hidden></p>
        <button class="btn btn-ouro" type="submit">Continuar</button>
      </form></section>`,
  });
}

export function paginaConvite({ usuario, convite, codigo, grupoAtual }) {
  let corpo;
  if (!convite) {
    corpo = `<h1 class="titulo-gotico">Convite inválido</h1><p>O código <b class="codigo">${esc(codigo)}</b> não existe, expirou ou já foi usado. Peça um convite novo a quem te chamou.</p>
      <div class="foco-botoes"><a class="btn" href="/convite">Digitar outro código</a></div>`;
  } else if (usuario) {
    corpo = grupoAtual
      ? `<h1 class="titulo-gotico">${esc(convite.grupo_nome)}</h1><p>Você já participa do grupo <b>${esc(grupoAtual)}</b>. Para entrar neste, saia do atual na página do grupo.</p>
        <div class="foco-botoes"><a class="btn" href="/grupo">Ir para o meu grupo</a></div>`
      : `<p class="eyebrow">Convite</p><h1 class="titulo-gotico">${esc(convite.grupo_nome)}</h1><p>Você foi convidado(a) para este grupo de estudos. Ao entrar, você escolhe o que compartilhar.</p>
        <div class="foco-botoes"><button type="button" class="btn btn-ouro" data-acao-url="/api/convite/aceitar" data-acao-corpo='{"codigo":"${esc(convite.codigo)}"}' data-acao-ir="/grupo">Entrar no grupo</button></div>`;
  } else {
    corpo = `<p class="eyebrow">Convite</p><h1 class="titulo-gotico">${esc(convite.grupo_nome)}</h1><p>Você foi convidado(a) para este grupo de estudos no std(dying).</p>
      <div class="foco-botoes"><a class="btn btn-ouro" href="/criar-conta?convite=${esc(convite.codigo)}">Criar minha conta</a>
      <a class="btn" href="/entrar?voltar=${encodeURIComponent(`/convite/${convite.codigo}`)}">Já tenho conta</a></div>`;
  }
  return layout({ titulo: 'Convite', usuario, classe: 'pg-mensagem', corpo: `<section class="envolve mensagem caixa">${corpo}</section>` });
}

export function paginaCriarConta({ convite, codigo, emailAtivo }) {
  return layout({
    titulo: 'Criar conta', classe: 'pg-mensagem',
    corpo: `<section class="envolve mensagem caixa largo">
      <p class="eyebrow">Nova conta${convite ? ` · grupo ${esc(convite.grupo_nome)}` : ''}</p>
      <h1 class="titulo-gotico">Criar conta</h1>
      <form data-form="criar-conta" class="form-conta" novalidate>
        <label>Código do convite<input name="convite" class="campo-codigo" value="${esc(codigo || '')}" maxlength="12" required autocomplete="off"></label>
        <label>Seu nome<input name="nome" maxlength="60" required autocomplete="name"></label>
        <label>@usuário (3 a 24: letras minúsculas, números, . ou _)<input name="arroba" maxlength="25" required autocomplete="username" placeholder="@seunome" spellcheck="false" autocapitalize="none"></label>
        <label>E-mail<input name="email" type="email" maxlength="200" required autocomplete="email"></label>
        <label>Senha (mínimo de 10 caracteres)<input name="senha" type="password" maxlength="200" required autocomplete="new-password"></label>
        <label>Repita a senha<input name="confirmacao" type="password" maxlength="200" required autocomplete="new-password"></label>
        <label class="opcao"><input type="checkbox" name="aceite"> <span>Li e aceito as <a href="/privacidade" target="_blank" rel="noopener">regras de uso e a política de privacidade</a>.</span></label>
        <label class="opcao"><input type="checkbox" name="cookies" checked> <span>Aceito o cookie essencial de sessão.</span></label>
        <p class="erro-form" data-erro hidden></p>
        <button class="btn btn-ouro" type="submit">Criar conta</button>
        <p class="ajuda">Enviaremos um link de confirmação para o seu e-mail. A conta só entra depois da confirmação.${emailAtivo ? '' : ' (O envio de e-mails ainda não está configurado neste servidor: o administrador pode confirmar sua conta manualmente.)'}</p>
      </form>
      <div data-conta-criada hidden><h2>Quase lá!</h2><p>Enviamos um link de confirmação para <b data-email-enviado></b>. Abra o e-mail (confira o spam) e clique no link para ativar sua conta.</p></div>
    </section>`,
  });
}

// ---------- privacidade ----------

export function paginaPrivacidade({ usuario }) {
  return layout({
    titulo: 'Privacidade', usuario, classe: 'pg-privacidade',
    corpo: `<section class="envolve texto-longo caixa">
      <p class="eyebrow">Regras de uso e privacidade</p><h1 class="titulo-gotico">Privacidade</h1>
      <h2>O que guardamos</h2>
      <ul><li>Conta: nome, @usuário, e-mail (depois de confirmado) e a senha cifrada (nunca a senha em si).</li>
        <li>O que você cria aqui: sessões de foco, anotações do caderno, trilhas e notas do seu espaço, cronograma, revisões, pedidos à IA, progresso e o histórico das suas ações.</li>
        <li>Registros de consentimento: quando aceitou os termos, os cookies e as regras de compartilhamento do grupo.</li></ul>
      <h2>Cookies</h2>
      <p>Usamos <b>um único cookie essencial</b>, o da sessão de login (protegido: só trafega por HTTPS e não é lido por scripts). Preferências como som do pomodoro e modo da caneta ficam apenas no seu navegador. Não há cookies de publicidade nem de rastreamento.</p>
      <h2>Inteligência artificial</h2>
      <p>A página IA é opcional. Quando você pede uma análise, um resumo ou questões, o assunto e o trecho da nota que você escolheu são enviados à API da Anthropic (Claude) para gerar a resposta, que fica salva só na sua conta. Nada é enviado sem você clicar em “Gerar”.</p>
      <h2>Regras entre contas</h2>
      <ol><li>Cada conta só lê e altera os próprios dados. Isso é conferido no servidor em cada pedido, não só escondido na tela.</li>
        <li>Contas novas não têm acesso aos cofres do dono do site; trabalham no próprio espaço.</li>
        <li>No grupo de estudos, cada pessoa vê <b>só o que as outras escolheram compartilhar</b> (tempo e dias de estudo, trilha, assunto). Notas, caderno, cofres e questões nunca são compartilhados.</li>
        <li>Só membros do mesmo grupo, que aceitaram estas regras, veem uns aos outros. Não existe busca de pessoas.</li>
        <li>Convites expiram, têm número limitado de usos e podem ser revogados; tentativas de adivinhar códigos são bloqueadas.</li>
        <li>Contas novas só entram com convite e e-mail confirmado.</li></ol>
      <h2>Seus direitos</h2>
      <p>Em Configurações você pode mudar o que compartilha, baixar todos os seus dados (JSON) e excluir sua conta, o que apaga seus dados do banco. Os backups diários são apagados sozinhos em até 14 dias.</p>
      <h2>Contato</h2><p>Fale com quem administra o site e te convidou.</p>
    </section>`,
  });
}

// ---------- meu espaço ----------

const NOMES_COR = { brasa: 'Brasa', anil: 'Anil', verde: 'Verde', ouro: 'Ouro', violeta: 'Violeta', rubi: 'Rubi' };
const seletorCor = (cores, atual) => `<fieldset class="modos"><legend>Cor</legend>${cores.map((c) => `<label class="modo c-${c}"><input type="radio" name="cor" value="${c}"${c === atual ? ' checked' : ''}><span><i class="amostra"></i>${NOMES_COR[c]}</span></label>`).join('')}</fieldset>`;

export function paginaEspacos({ usuario, trilhas, almas, foco, espacos, cores }) {
  const px = ehPixel(usuario);
  return layout({
    titulo: 'Meu espaço', ativo: 'espaco', usuario, trilhas, almas, foco, classe: 'pg-espaco',
    corpo: `
    <section class="envolve conta-topo"><p class="eyebrow">Meu espaço</p><h1 class="titulo-gotico">Suas trilhas</h1>
      <p class="lema">Monte as suas próprias trilhas: cada uma tem notas em Markdown com checklists, entra no pomodoro, no caderno e no streak.</p></section>
    <section class="envolve"><div class="cartoes">
      ${espacos.map((e) => `<a class="cartao caixa c-${esc(e.cor)}" href="/espaco/${e.id}">
        <span class="cartao-topo">${iconeUI('pasta')}<span class="cartao-nome">Trilha</span></span>
        <span class="mundo">${esc(e.nome)}</span><span class="cartao-linha">${esc(e.descricao || 'Sem descrição')}</span>
        <span class="barra-rot"><span>Progresso</span><b>${pctTxt(e.pct)}</b></span>${medidor(e.pct, { classe: 'tc', rotulo: `Progresso de ${e.nome}` })}
        <span class="cartao-pe">${e.feitas} de ${e.total} tarefas</span></a>`).join('')}
      <section class="cartao caixa novo-espaco"><h3>Nova trilha</h3>
        <form data-form="espaco-criar" class="form-conta" novalidate>
          <label>Nome<input name="nome" maxlength="60" required placeholder="Ex.: Inglês para viagem"></label>
          <label>Descrição<input name="descricao" maxlength="240" placeholder="Opcional"></label>
          ${seletorCor(cores, 'brasa')}
          <label class="opcao"><input type="checkbox" name="modelo" checked> <span>Começar com uma nota-modelo (objetivo, tarefas e recursos)</span></label>
          <p class="erro-form" data-erro hidden></p>
          <button class="btn btn-ouro" type="submit">${acao('adicionar', 'Criar trilha')}</button>
        </form></section>
    </div></section>`,
  });
}

export function paginaEspaco({ usuario, trilhas, almas, foco, e, notas, cores, progresso }) {
  return layout({
    titulo: e.nome, ativo: 'espaco', usuario, trilhas, almas, foco, classe: `pg-espaco c-${esc(e.cor)}`,
    corpo: `
    <section class="trilha-heroi envolve sem-emblema"><div class="heroi-txt">
      <nav class="migalhas"><a href="/espaco">Meu espaço</a> › ${esc(e.nome)}</nav>
      <h1 class="titulo-gotico">${esc(e.nome)}</h1>${e.descricao ? `<p class="lema">${esc(e.descricao)}</p>` : ''}
      <div class="heroi-barra"><span class="barra-rot"><span>${progresso.feitas} de ${progresso.total} tarefas</span><b>${pctTxt(progresso.pct)}</b></span>${medidor(progresso.pct, { classe: 'tc grande', rotulo: 'Progresso' })}</div>
    </div></section>
    <div class="trilha-grade envolve">
      <section><h2 class="titulo-secao">Notas</h2>
        <ul class="notas caixa">${notas.length ? notas.map((n) => `<li><a class="nota-linha" href="/espaco/${e.id}/nota/${n.id}">
          <span class="nota-info"><span class="nota-titulo">${esc(n.titulo)}</span><span class="nota-meta">atualizada ${tempoAtras(n.atualizado)}</span></span>
          <span class="nota-prog">${n.total ? `<b>${n.feitas}/${n.total}</b>${medidor((100 * n.feitas) / n.total, { classe: 'tc' })}` : '<small>sem tarefas</small>'}</span></a></li>`).join('') : '<li class="vazio">Nenhuma nota ainda.</li>'}</ul>
        <form data-form="espaco-nota" data-espaco="${e.id}" class="form-conta nova-nota" novalidate>
          <label>Nova nota<input name="titulo" maxlength="120" required placeholder="Título da nota"></label>
          <p class="erro-form" data-erro hidden></p><button class="btn btn-ouro" type="submit">${acao('editar', 'Criar e editar')}</button>
        </form>
      </section>
      <aside class="lateral">
        <section class="caixa"><h3>Usar esta trilha</h3><div class="foco-botoes">
          <a class="btn btn-ouro" href="/foco?trilha=e${e.id}">${acao('iniciar', 'Começar um pomodoro')}</a><a class="btn" href="${linkAnotar(e.nome, '')}">${acao('editar', 'Anotar no Caderno')}</a></div></section>
        <section class="caixa"><h3>Editar trilha</h3>
          <form data-form="espaco-editar" data-espaco="${e.id}" class="form-conta" novalidate>
            <label>Nome<input name="nome" maxlength="60" required value="${esc(e.nome)}"></label>
            <label>Descrição<input name="descricao" maxlength="240" value="${esc(e.descricao)}"></label>
            ${seletorCor(cores, e.cor)}
            <p class="erro-form" data-erro hidden></p><button class="btn" type="submit">${acao('salvar', 'Salvar')}</button>
          </form>
          <button type="button" class="btn-x" data-acao-url="/api/espaco/${e.id}/remover" data-confirmar data-acao-ir="/espaco">${acao('excluir', 'Apagar trilha e notas')}</button>
        </section>
      </aside>
    </div>`,
  });
}

export function paginaEspacoNota({ usuario, trilhas, almas, foco, e, n, html, toc }) {
  const pct = n.total ? (100 * n.feitas) / n.total : null;
  const indice = toc.length > 1 ? `<details class="indice caixa" data-indice-nota open><summary class="indice-rot">Seções</summary><nav aria-label="Seções"><ol>${toc.map((s2) => `<li class="n${s2.nivel}"><a href="#${esc(s2.id)}" data-secao="${esc(s2.id)}">${esc(s2.texto)}</a></li>`).join('')}</ol></nav></details>` : '';
  return layout({
    titulo: n.titulo, ativo: 'espaco', usuario, trilhas, almas, foco, classe: `pg-nota c-${esc(e.cor)}`,
    corpo: `
    <div class="envolve nota-cabeca">
      <nav class="migalhas"><a href="/espaco">Meu espaço</a> › <a href="/espaco/${e.id}">${esc(e.nome)}</a> › ${esc(n.titulo)}</nav>
      <div class="nota-acoes">
        ${n.total ? `<span class="barra-rot"><span><b data-feitas>${n.feitas}</b> de <b data-total>${n.total}</b> tarefas</span><b data-pct-txt>${pctTxt(pct)}</b></span>
        ${medidor(pct, { classe: 'tc', marca: ' data-nota-medidor' })}` : ''}
        <div class="nota-botoes"><a class="btn btn-ouro" href="/espaco/${e.id}/nota/${n.id}/editar">${acao('editar', 'Editar')}</a>
          <a class="btn" href="/foco?trilha=e${e.id}&amp;assunto=${encodeURIComponent(n.titulo)}">${acao('foco', 'Focar')}</a></div>
      </div>
    </div>
    <div class="nota-grade envolve${indice ? '' : ' sem-indice'}">${indice}
      <article class="nota caixa" data-trilha="e${e.id}" data-arquivo="nota-${n.id}" data-endpoint="/api/espaco/${e.id}/nota/${n.id}/tarefa">
        <h1>${esc(n.titulo)}</h1>${html || '<p class="vazio">Nota vazia. Clique em Editar para escrever.</p>'}</article>
    </div>`,
  });
}

export function paginaEspacoNotaEditar({ usuario, trilhas, almas, foco, e, n }) {
  return layout({
    titulo: `Editar ${n.titulo}`, ativo: 'espaco', usuario, trilhas, almas, foco, classe: `pg-caderno-editor c-${esc(e.cor)}`,
    corpo: `
    <div class="caderno-editor envolve">
      <div class="ed-topo"><a class="btn" href="/espaco/${e.id}/nota/${n.id}">${acao('voltar', 'Voltar sem salvar')}</a><span class="ed-status"></span>
        <span class="ed-acoes"><button type="button" class="btn-x" data-acao-url="/api/espaco/${e.id}/nota/${n.id}/remover" data-confirmar data-acao-ir="/espaco/${e.id}">${acao('excluir', 'Apagar nota')}</button></span></div>
      <form data-form="espaco-nota-salvar" data-espaco="${e.id}" data-nota="${n.id}" data-versao="${n.versao}" class="caixa ed-painel" novalidate>
        <input class="ed-titulo" name="titulo" maxlength="120" required value="${esc(n.titulo)}" aria-label="Título">
        <p class="ajuda">Markdown: <code>## Seção</code>, <code>- [ ] tarefa</code>, <code>**negrito**</code>, listas e links. As seções viram sugestões de assunto no pomodoro e no caderno.</p>
        <textarea class="ed-texto" name="texto" spellcheck="true" aria-label="Texto da nota">${esc(n.texto)}</textarea>
        <p class="erro-form" data-erro hidden></p>
        <div class="foco-botoes"><button class="btn btn-ouro" type="submit">${acao('salvar', 'Salvar nota')}</button></div>
      </form>
    </div>`,
  });
}

// ---------- configurações ----------

export function paginaConfiguracoes({ usuario, trilhas, almas, foco, conta, emailPendente, membro, usuarios, perfis, emailAtivo, ajustesRevisoes }) {
  const nomePerfil = (chave) => perfis.find((p) => p.chave === chave)?.descricao || chave;
  const tema = usuario.temaId || usuario.tema;
  const gestao = usuarios ? `
    <section class="caixa largo"><h3>Pessoas com acesso</h3>
      <div class="tabela"><table><thead><tr><th>Pessoa</th><th>Perfil</th><th>Situação</th><th></th></tr></thead><tbody>
        ${usuarios.map((x) => `<tr><td>${esc(x.nome || x.usuario)}<br><small>@${esc(x.arroba || x.usuario)}${x.email ? ` · ${esc(x.email)}` : ''}${x.dono ? ' · você, dono' : ''}</small></td>
          <td>${esc(x.perfil)}<br><small>${esc(nomePerfil(x.perfil))}</small></td>
          <td>${x.confirmacao_pendente ? 'aguardando e-mail' : x.trocar_senha ? 'senha provisória' : 'ativa'}</td>
          <td>${x.confirmacao_pendente ? `<button type="button" class="btn-x" data-acao-url="/api/conta/usuarios/confirmar" data-acao-corpo='{"id":${x.id}}' data-acao-msg="Conta confirmada.">Confirmar à mão</button>` : ''}
            ${x.dono ? '' : `<button type="button" class="btn-x" data-acao-url="/api/conta/usuarios/remover" data-acao-corpo='{"id":${x.id}}' data-confirmar data-acao-msg="Conta removida.">${acao('excluir', 'Remover')}</button>`}</td></tr>`).join('')}
      </tbody></table></div>
      ${emailAtivo ? '' : '<p class="ajuda">O envio de e-mail não está configurado (SMTP no .env). Links de confirmação aparecem no log do serviço; use “Confirmar à mão” se precisar.</p>'}
    </section>
    <section class="caixa"><h3>Adicionar pessoa (sem convite)</h3>
      <form data-form="conta-criar" novalidate class="form-conta">
        <label>Usuário<input name="usuario" autocomplete="off" required minlength="3" maxlength="32"></label>
        <label>Senha provisória<input name="senha" type="text" autocomplete="off" required minlength="10" maxlength="200"></label>
        <label>Perfil<select name="perfil">${perfis.map((p) => `<option value="${esc(p.chave)}">${esc(p.chave)} — ${esc(p.descricao)}</option>`).join('')}</select></label>
        <p class="erro-form" data-erro hidden></p><button class="btn" type="submit">Criar conta</button>
      </form>
    </section>
    <section class="caixa"><h3>Redefinir senha de outra pessoa</h3>
      <form data-form="conta-redefinir" novalidate class="form-conta">
        <label>Conta<select name="id">${usuarios.filter((x) => !x.dono).map((x) => `<option value="${x.id}">@${esc(x.arroba || x.usuario)}</option>`).join('')}</select></label>
        <label>Nova senha provisória<input name="senha" type="text" autocomplete="off" required minlength="10" maxlength="200"></label>
        <p class="erro-form" data-erro hidden></p><button class="btn" type="submit">Redefinir</button>
      </form>
    </section>` : '';
  return layout({
    titulo: 'Configurações', ativo: 'conta', usuario, trilhas, almas, foco, classe: 'pg-conta',
    corpo: `
    <section class="envolve conta-topo"><p class="eyebrow">Configurações</p><h1 class="titulo-gotico">${esc(conta.nome || conta.usuario)}</h1>
      <p class="heroi-nome">@${esc(conta.arroba || conta.usuario)}</p>
      ${usuario.trocarSenha ? '<p class="aviso-senha">Você está usando uma senha provisória. Crie a sua senha abaixo para liberar o resto do site.</p>' : ''}</section>
    <div class="conta-grade envolve">
      <section class="caixa"><h3>Senha</h3>
        <form data-form="conta-senha" novalidate class="form-conta">
          <label>Senha atual<input name="atual" type="password" autocomplete="current-password" required maxlength="200"></label>
          <label>Senha nova (mínimo de 10 caracteres)<input name="nova" type="password" autocomplete="new-password" required minlength="10" maxlength="200"></label>
          <label>Repita a senha nova<input name="confirmacao" type="password" autocomplete="new-password" required maxlength="200"></label>
          <p class="erro-form" data-erro hidden></p><button class="btn btn-ouro" type="submit">${acao('salvar', 'Salvar senha')}</button>
        </form></section>
      ${usuario.trocarSenha ? '' : `
      <section class="caixa"><h3>Perfil</h3>
        <form data-form="conta-perfil" novalidate class="form-conta">
          <label>Nome<input name="nome" maxlength="60" required value="${esc(conta.nome || conta.usuario)}"></label>
          <label>@usuário<input name="arroba" maxlength="25" required value="${esc(conta.arroba || conta.usuario)}" spellcheck="false" autocapitalize="none"></label>
          <label>Senha atual (só para trocar o @)<input name="senha" type="password" autocomplete="current-password" maxlength="200"></label>
          <p class="ajuda">O @ é como as outras pessoas do grupo te veem e serve para entrar no site.</p>
          <p class="erro-form" data-erro hidden></p><button class="btn" type="submit">${acao('salvar', 'Salvar perfil')}</button>
        </form></section>
      <section class="caixa"><h3>E-mail</h3>
        <p>${conta.email ? `Atual: <b>${esc(conta.email)}</b> (confirmado)` : 'Nenhum e-mail confirmado.'}${emailPendente ? `<br>Aguardando confirmação: <b>${esc(emailPendente)}</b>` : ''}</p>
        <form data-form="conta-email" novalidate class="form-conta">
          <label>${conta.email ? 'Trocar para' : 'Adicionar e-mail'}<input name="email" type="email" maxlength="200" required autocomplete="email"></label>
          <label>Senha atual<input name="senha" type="password" autocomplete="current-password" required maxlength="200"></label>
          <p class="ajuda">Enviamos um link para o e-mail novo; ele só passa a valer depois da confirmação.</p>
          <p class="erro-form" data-erro hidden></p><button class="btn" type="submit">${acao('email', 'Enviar confirmação')}</button>
        </form></section>
      <section class="caixa"><h3>Aparência</h3>
        <form data-form="conta-tema" class="form-conta" novalidate>
          <fieldset class="modos temas-lista"><legend>Tema</legend>
            ${TEMAS.map((t) => `<label class="modo" title="${esc(t.descricao)}"><input type="radio" name="tema" value="${esc(t.id)}"${tema === t.id ? ' checked' : ''}><span><em class="tema-cores paleta-${esc(t.id)}" aria-hidden="true"><i></i><i></i><i></i><i></i></em>${esc(t.nome)}${t.id === 'pixel' ? ' (padrão)' : ''}</span></label>`).join('\n            ')}
          </fieldset>
          <p class="ajuda">${esc(TEMAS.find((t) => t.id === tema)?.descricao || '')} Toda conta nova começa no tema padrão. A troca vale na hora.</p>
        </form></section>
      ${blocoAjustesRevisoes(ajustesRevisoes)}
      <section class="caixa" id="privacidade"><h3>Privacidade e compartilhamento</h3>
        ${membro ? `<p>Grupo: <b>${esc(membro.grupo_nome)}</b>. O que você compartilha com ele:</p>
        <form data-form="grupo-consentir" class="form-conta" novalidate>
          <label class="opcao"><input type="checkbox" name="tempo"${membro.compartilha_tempo ? ' checked' : ''}> <span>Tempo e dias de estudo (streak, mapa, sessões)</span></label>
          <label class="opcao"><input type="checkbox" name="trilha"${membro.compartilha_trilha ? ' checked' : ''}> <span>Trilha de cada sessão</span></label>
          <label class="opcao"><input type="checkbox" name="assunto"${membro.compartilha_assunto ? ' checked' : ''}> <span>Assunto de cada sessão</span></label>
          <p class="erro-form" data-erro hidden></p><button class="btn" type="submit">${acao('salvar', 'Salvar compartilhamento')}</button>
        </form>` : '<p>Você não participa de um grupo: nada é compartilhado.</p>'}
        <p class="ajuda">Cookies: só o essencial de sessão. <a href="/privacidade">Ler a política</a>.</p>
        <div class="foco-botoes"><a class="btn" href="/configuracoes/meus-dados.json">${acao('baixar', 'Baixar meus dados (JSON)')}</a></div>
      </section>
      ${usuario.dono ? '' : `<section class="caixa"><h3>Excluir conta</h3>
        <p>Apaga sua conta e tudo o que você criou aqui (sessões, caderno, espaço). Não dá para desfazer.</p>
        <form data-form="conta-excluir" class="form-conta" novalidate>
          <label>Senha atual<input name="senha" type="password" autocomplete="current-password" required maxlength="200"></label>
          <p class="erro-form" data-erro hidden></p><button class="btn-x" type="submit">${acao('excluir', 'Excluir minha conta')}</button>
        </form></section>`}
      ${gestao}`}
    </div>`,
  });
}

// ---------- erros ----------

export function paginaErro({ status, usuario = null, trilhas = [], almas = null, foco = null }) {
  const px = ehPixel(usuario);
  const perdido = status === 404;
  return layout({
    titulo: perdido ? (px ? 'Você se perdeu' : 'Página não encontrada') : 'Erro',
    usuario,
    trilhas,
    almas,
    foco,
    classe: 'pg-erro',
    corpo: `
    <section class="cena-erro envolve">
      ${px ? sprite('caveira', { escala: 8 }) : ''}
      <h1 class="titulo-morte">${perdido ? (px ? 'Você se perdeu' : 'Página não encontrada') : 'Algo deu errado'}</h1>
      <p>${perdido ? 'Esta página não existe ou não está disponível para a sua conta.' : 'O servidor encontrou um erro. Nada foi gravado pela metade; tente de novo.'}</p>
      <a class="btn btn-ouro" href="/">${px ? 'Voltar à fogueira' : 'Voltar ao início'}</a>
    </section>`,
  });
}

// ---------- cronograma, revisões e IA: peças comuns ----------

// Nome curto e classe de cor de cada trilha (cofre: t-<slug>; espaço: c-<cor>; "*": todas).
function infoTrilhas(trilhas) {
  const mapa = new Map(trilhas.map((t) => [t.slug, t]));
  return (slug) => {
    if (slug === TODAS) return { slug, nome: 'Todas as trilhas', curto: 'Todas', classe: 't-inicio' };
    const t = mapa.get(slug);
    if (!t) return { slug, nome: 'Outra trilha', curto: '?', classe: 't-inicio', desconhecida: true };
    return { slug, nome: t.nome, curto: t.curto || t.nome, classe: t.espaco ? `c-${t.cor}` : `t-${t.slug}` };
  };
}

const linkFoco = (trilha, assunto) => `/foco?trilha=${encodeURIComponent(trilha)}&amp;assunto=${encodeURIComponent(String(assunto || '').slice(0, 100))}`;

function linkDaRevisao(r, info) {
  if (!r.ref || info(r.trilha).desconhecida) return '';
  const e = /^e(\d{1,12})$/.exec(r.trilha);
  const n = /^nota-(\d{1,12})$/.exec(r.ref);
  if (e && n) return `/espaco/${e[1]}/nota/${n[1]}`;
  if (!e && /\.md$/i.test(r.ref)) return `/t/${r.trilha}/n/${caminhoURL(r.ref)}`;
  return '';
}

function botoesRevisao(r) {
  const b = (res, classe) => `<button type="button" class="${classe}" data-acao-url="/api/revisoes/${r.id}/resultado" data-acao-corpo='{"resultado":"${res}"}' data-acao-msg="Revisão registrada: ${RESULTADOS[res].toLowerCase()}.">${RESULTADOS[res]}</button>`;
  return `<span class="rev-botoes" role="group" aria-label="Como foi a revisão">${b('facil', 'btn')}${b('bom', 'btn btn-ouro')}${b('dificil', 'btn')}${b('errei', 'btn-x')}</span>`;
}

function htmlBloco(b, dia, info) {
  const t = info(b.trilha);
  const pct = b.minutos ? (100 * b.feitosMin) / b.minutos : 0;
  const assunto = b.assunto || (b.fonte === 'rotacao' ? 'Sem conteúdo nesta semana no cronograma.' : '');
  const acaoBloco = b.fonte === 'revisoes'
    ? `<a class="btn" href="/revisoes">${acao('revisao', 'Revisar')}</a>`
    : `<a class="btn" href="${linkFoco(b.trilha, b.assunto || b.rotulo || t.nome)}">${acao('foco', 'Focar')}</a>`;
  const auto = b.feito && !b.manual;
  return `
      <li class="bloco ${t.classe}${b.feito ? ' feito' : ''}">
        <label class="bloco-check" title="${auto ? 'Feito pelo tempo de foco do dia' : 'Marcar como feito'}"><input type="checkbox" class="cb" data-crono-feito="${b.id}" data-data="${dia.data}"${b.feito ? ' checked' : ''}${auto ? ' disabled' : ''}><span class="visivel-leitor">Feito</span></label>
        <span class="bloco-tempo">${b.inicio ? `<time>${esc(b.inicio)}</time>` : ''}<b>${formatarDuracao(b.minutos * 60)}</b></span>
        <span class="bloco-txt">
          <span class="bloco-topo"><span class="ev-trilha ${t.classe}">${esc(t.curto)}</span>${b.rotulo ? `<b class="bloco-rotulo">${esc(b.rotulo)}</b>` : ''}${b.detalhe ? `<small>${esc(b.detalhe)}</small>` : ''}</span>
          <span class="bloco-assunto">${esc(assunto)}</span>
          ${b.fonte === 'revisoes' ? '' : `<span class="bloco-prog">${medidor(pct, { classe: 'tc', rotulo: `Foco feito: ${b.feitosMin} de ${b.minutos} minutos` })}<small>${b.feitosMin ? `${b.feitosMin} de ${b.minutos} min de foco` : 'sem foco ainda'}</small></span>`}
        </span>
        <span class="bloco-acoes">${acaoBloco}</span>
      </li>`;
}

function htmlDia(dia, { info, hoje, maxRev = 8 }) {
  const eventos = dia.eventos.map((e) => {
    const t = info(e.trilha);
    return `<li class="evento${e.prova ? ' prova' : ''}${e.feito ? ' feito' : ''}"><span class="ev-trilha ${t.classe}">${esc(t.curto)}</span><span>${esc(e.texto)}</span></li>`;
  }).join('');
  const blocos = dia.blocos.map((b) => htmlBloco(b, dia, info)).join('');
  const revs = dia.revisoes.length ? `
      <div class="dia-revisoes">
        <h3 class="mini-titulo">${iconeUI('revisao')}<span>Revisões ${dia.data === hoje ? 'para hoje' : 'do dia'} (${dia.revisoes.length})</span></h3>
        <ul>${dia.revisoes.slice(0, maxRev).map((r) => {
          const t = info(r.trilha);
          return `<li class="rev-curta"><span class="ev-trilha ${t.classe}">${esc(t.curto)}</span><span class="rev-assunto">${esc(r.assunto)}${r.atrasada ? ' <small class="atrasada">atrasada</small>' : ''}</span>${r.proxima <= hoje ? botoesRevisao(r) : ''}</li>`;
        }).join('')}</ul>
        ${dia.revisoes.length > maxRev ? `<a class="mais-revisoes" href="/revisoes">mais ${dia.revisoes.length - maxRev} em Revisões</a>` : ''}
      </div>` : '';
  const total = dia.planejado ? `${formatarDuracao(dia.planejado * 60)} planejadas` : 'sem blocos';
  const feito = dia.focoDia ? ` · ${formatarDuracao(dia.focoDia * 60)} de foco` : '';
  const cabeca = `<span class="dia-nome">${esc(dia.nome)} <small>${dataBR(dia.data, false)}${dia.hoje ? ' · hoje' : ''}</small></span><span class="dia-total">${total}${feito}</span>`;
  const miolo = `${eventos ? `<ul class="dia-eventos">${eventos}</ul>` : ''}
      ${blocos ? `<ol class="blocos">${blocos}</ol>` : '<p class="vazio">Nenhum bloco neste dia.</p>'}
      ${revs}`;
  // dias que já passaram ficam recolhidos
  return dia.passado
    ? `<details class="caixa dia passado" id="d-${dia.data}"><summary class="dia-cabeca">${cabeca}</summary>${miolo}</details>`
    : `<section class="caixa dia${dia.hoje ? ' hoje' : ''}" id="d-${dia.data}" aria-label="${esc(dia.nome)}, ${dataBR(dia.data)}"><header class="dia-cabeca">${cabeca}</header>${miolo}</section>`;
}

function blocoHoje(dia, trilhas) {
  if (!dia) return '';
  const vazio = !dia.blocos.length && !dia.eventos.length && !dia.revisoes.length;
  return `
    <section class="envolve hoje-inicio">
      <h2 class="titulo-secao">Hoje</h2>
      ${vazio
        ? '<p class="caixa painel-vazio">Nada marcado para hoje. <a href="/cronograma/modelo">Monte a sua semana-modelo</a> para ver aqui o que estudar a cada dia, junto com as revisões que vencerem.</p>'
        : htmlDia({ ...dia, passado: false }, { info: infoTrilhas(trilhas), hoje: dia.data, maxRev: 5 })}
      <p class="ajuda"><a href="/cronograma">Ver a semana inteira</a> · <a href="/revisoes">Todas as revisões</a></p>
    </section>`;
}

function blocoAjustesRevisoes(a) {
  if (!a) return '';
  const atual = Object.entries(PRESETS).find(([, p]) => p.intervalos.join(',') === a.intervalos.join(','))?.[0] || 'personalizado';
  const opcao = (valor, rotulo, dias = '') => `<label class="modo"><input type="radio" name="preset" value="${valor}"${dias ? ` data-intervalos="${dias}"` : ''}${atual === valor ? ' checked' : ''}><span>${esc(rotulo)}</span></label>`;
  return `
      <section class="caixa" id="revisoes"><h3>Revisões espaçadas</h3>
        <form data-form="revisoes-ajustes" class="form-conta" novalidate>
          <fieldset class="modos"><legend>Intervalos entre as revisões</legend>
            ${Object.entries(PRESETS).map(([k, p]) => opcao(k, `${p.nome}: ${p.intervalos.join(' · ')} dias`, p.intervalos.join(','))).join('')}
            ${opcao('personalizado', 'Personalizado')}
          </fieldset>
          <label>Dias, separados por vírgula (personalizado)<input name="personalizado" value="${esc(a.intervalos.join(', '))}" inputmode="numeric" placeholder="1, 7, 30, 90"></label>
          <p class="ajuda">Cada revisão boa avança um intervalo; “Fácil” pula um; “Difícil” volta um; “Errei” recomeça do primeiro. Revisões que cairiam depois da prova vêm para dois dias antes dela.</p>
          <label class="opcao"><input type="checkbox" name="foco"${a.foco ? ' checked' : ''}> <span>Pomodoro com assunto (10 min ou mais) agenda revisão</span></label>
          <label class="opcao"><input type="checkbox" name="tarefa"${a.tarefa ? ' checked' : ''}> <span>Marcar tarefa numa nota agenda revisão</span></label>
          <label class="opcao"><input type="checkbox" name="questoes"${a.questoes ? ' checked' : ''}> <span>Registrar questões agenda ou ajusta a revisão (abaixo da meta: revisar amanhã)</span></label>
          <p class="erro-form" data-erro hidden></p><button class="btn" type="submit">${acao('salvar', 'Salvar revisões')}</button>
        </form></section>`;
}

// ---------- cronograma ----------

export function paginaCronograma({ usuario, trilhas, almas, foco, semana, temModelo, anterior, proxima, ehAtual }) {
  const info = infoTrilhas(trilhas);
  const hoje = hojeISO();
  const faixa = semana.dias.map((d) => `<a class="dia-chip${d.hoje ? ' hoje' : ''}${d.passado ? ' passado' : ''}" href="#d-${d.data}">
      <b>${d.curto}</b><span>${dataBR(d.data, false)}</span>
      <small>${d.planejado ? formatarDuracao(d.planejado * 60) : '—'}${d.focoDia ? ` · ✓ ${formatarDuracao(d.focoDia * 60)}` : ''}</small>
      ${d.eventos.length || d.revisoes.length ? `<i class="chip-marcas">${d.eventos.length ? `<span title="${d.eventos.length} evento(s)">●</span>` : ''}${d.revisoes.length ? `<span title="${d.revisoes.length} revisão(ões)">↻${d.revisoes.length}</span>` : ''}</i>` : ''}
    </a>`).join('');
  const semanas = semana.semanas.filter((x) => x.s >= 1).map((x) => `${esc(x.t.curto)} S${x.s}`).join(' · ');
  return layout({
    titulo: 'Cronograma', ativo: 'cronograma', usuario, trilhas, almas, foco, classe: 'pg-cronograma',
    corpo: `
    <section class="envolve conta-topo">
      <p class="eyebrow">Cronograma da semana</p>
      <h1 class="titulo-gotico">${dataBR(semana.segunda, false)} a ${dataBR(semana.ate, false)}</h1>
      <p class="lema">${semanas ? `Semana do plano: ${semanas}. ` : ''}Os assuntos vêm dos cronogramas dos cofres; os horários, da sua semana-modelo.</p>
      <nav class="semana-nav" aria-label="Semanas">
        <a class="btn" href="/cronograma?semana=${anterior}">${acao('voltar', 'Anterior')}</a>
        ${ehAtual ? '' : '<a class="btn" href="/cronograma">Esta semana</a>'}
        <a class="btn" href="/cronograma?semana=${proxima}">${acao('avancar', 'Próxima')}</a>
        <a class="btn btn-ouro" href="/cronograma/modelo">${acao('editar', 'Editar semana-modelo')}</a>
      </nav>
    </section>
    <section class="envolve"><nav class="semana-faixa" aria-label="Dias da semana">${faixa}</nav></section>
    ${temModelo ? '' : '<section class="envolve"><p class="caixa painel-vazio">Sua semana-modelo ainda está vazia. <a href="/cronograma/modelo">Monte os blocos</a>: cada bloco é uma faixa de estudo num dia da semana (ex.: segunda, 2h de Manaus Prev na coluna A do cronograma). Os eventos com data dos cronogramas e as revisões já aparecem abaixo.</p></section>'}
    <section class="envolve semana-dias">${semana.dias.map((d) => htmlDia(d, { info, hoje })).join('')}</section>`,
  });
}

function formBloco({ b = null, escolhas, colunas }) {
  const fonte = b?.fonte || 'rotacao';
  const dias = b
    ? `<label>Dia<select name="dia">${DIAS.map((d, i) => `<option value="${i}"${b.dia === i ? ' selected' : ''}>${d}</option>`).join('')}</select></label>`
    : `<fieldset class="modos dias-sel"><legend>Dias da semana</legend>${DIAS_CURTOS.map((d, i) => `<label class="modo"><input type="checkbox" name="dias" value="${i}"${i < 5 ? ' checked' : ''}><span>${d}</span></label>`).join('')}</fieldset>`;
  const trilhaAtual = b?.trilha || escolhas[0]?.slug || '';
  const optsTrilhas = escolhas.map((t) => `<option value="${esc(t.slug)}"${t.slug === trilhaAtual ? ' selected' : ''}>${esc(t.nome)}</option>`).join('')
    + `<option value="${TODAS}"${trilhaAtual === TODAS ? ' selected' : ''}>Todas (só para revisões)</option>`;
  const optsColunas = colunas.length
    ? colunas.map((c) => `<option value="${esc(c.valor)}" data-trilha="${esc(c.trilha)}"${b?.coluna === c.valor ? ' selected' : ''}>${esc(c.rotulo)}</option>`).join('')
    : '<option value="">Nenhum cronograma com tabela de semanas</option>';
  return `<form class="form-conta form-bloco" data-form="${b ? 'crono-bloco-editar' : 'crono-bloco'}"${b ? ` data-id="${b.id}"` : ''} novalidate>
      ${dias}
      <div class="campos">
        <label>Início<input type="time" name="inicio" value="${esc(b?.inicio || '')}"></label>
        <label>Minutos<input type="number" name="minutos" min="5" max="720" step="5" value="${b?.minutos || 60}" required inputmode="numeric"></label>
        <label class="cargo">Trilha<select name="trilha" data-bloco-trilha>${optsTrilhas}</select></label>
        <label class="largo">Rótulo (opcional)<input name="rotulo" maxlength="60" value="${esc(b?.rotulo || '')}" placeholder="Ex.: Específica A, Matemática, Redação"></label>
      </div>
      <fieldset class="modos"><legend>De onde vem o assunto</legend>${Object.entries(FONTES).map(([k, v]) => `<label class="modo"><input type="radio" name="fonte" value="${k}"${k === fonte ? ' checked' : ''}><span>${v}</span></label>`).join('')}</fieldset>
      <label data-campo-fonte="rotacao">Coluna do cronograma (o assunto muda a cada semana)<select name="coluna" data-bloco-coluna>${optsColunas}</select></label>
      <label data-campo-fonte="fixo">Assunto<input name="assunto" maxlength="160" value="${esc(b?.fonte === 'fixo' ? b.assunto : '')}" placeholder="Ex.: Redação completa e correção pelas 5 competências"></label>
      <p class="ajuda" data-campo-fonte="proxima">O bloco mostra a primeira tarefa ainda não feita da trilha, na ordem das notas.</p>
      <p class="ajuda" data-campo-fonte="revisoes">O bloco junta as revisões espaçadas do dia.</p>
      <p class="erro-form" data-erro hidden></p>
      <button class="btn btn-ouro" type="submit">${acao(b ? 'salvar' : 'adicionar', b ? 'Salvar bloco' : 'Adicionar bloco')}</button>
    </form>`;
}

export function paginaCronogramaModelo({ usuario, trilhas, almas, foco, blocos, escolhas, colunas }) {
  const info = infoTrilhas(trilhas);
  const rotuloColuna = new Map(colunas.map((c) => [c.valor, c.rotulo]));
  const porDia = DIAS.map((nome, d) => {
    const lista = blocos.filter((b) => b.dia === d);
    const total = lista.reduce((s, b) => s + b.minutos, 0);
    return `
      <section class="caixa modelo-dia">
        <h3>${nome} <small>${total ? formatarDuracao(total * 60) : 'livre'}</small></h3>
        ${lista.length ? `<ol class="modelo-blocos">${lista.map((b, i) => {
          const t = info(b.trilha);
          const origem = b.fonte === 'rotacao' ? (rotuloColuna.get(b.coluna) || 'coluna que sumiu do cronograma')
            : b.fonte === 'fixo' ? b.assunto : FONTES[b.fonte];
          return `<li class="modelo-bloco">
            <span class="modelo-info"><span class="ev-trilha ${t.classe}">${esc(t.curto)}</span>
              <b>${b.inicio ? `${esc(b.inicio)} · ` : ''}${formatarDuracao(b.minutos * 60)}</b>${b.rotulo ? ` ${esc(b.rotulo)}` : ''}
              <small>${esc(origem)}</small></span>
            <span class="modelo-acoes">
              ${i > 0 ? `<button type="button" class="btn-x" data-acao-url="/api/cronograma/blocos/${b.id}/mover" data-acao-corpo='{"direcao":-1}' aria-label="Subir">↑</button>` : ''}
              ${i < lista.length - 1 ? `<button type="button" class="btn-x" data-acao-url="/api/cronograma/blocos/${b.id}/mover" data-acao-corpo='{"direcao":1}' aria-label="Descer">↓</button>` : ''}
              <button type="button" class="btn-x" data-acao-url="/api/cronograma/blocos/${b.id}/remover" data-confirmar data-acao-msg="Bloco removido.">${acao('excluir', 'Remover')}</button>
            </span>
            <details class="editar-bloco"><summary>Editar</summary>${formBloco({ b, escolhas, colunas })}</details>
          </li>`;
        }).join('')}</ol>` : '<p class="vazio">Nenhum bloco.</p>'}
      </section>`;
  }).join('');
  const semanaTotal = blocos.reduce((s, b) => s + b.minutos, 0);
  return layout({
    titulo: 'Semana-modelo', ativo: 'cronograma', usuario, trilhas, almas, foco, classe: 'pg-cronograma',
    scripts: [],
    corpo: `
    <section class="envolve conta-topo">
      <nav class="migalhas"><a href="/cronograma">Cronograma</a> › Semana-modelo</nav>
      <h1 class="titulo-gotico">Semana-modelo</h1>
      <p class="lema">Os blocos se repetem toda semana. Um bloco ligado a uma coluna do cronograma mostra o assunto daquela semana (S1, S2…), lido direto da nota no cofre. Total: ${semanaTotal ? formatarDuracao(semanaTotal * 60) : '0 h'} por semana.</p>
    </section>
    <div class="trilha-grade envolve modelo-grade">
      <section class="modelo-dias">${porDia}</section>
      <aside class="lateral">
        <section class="caixa"><h3>Novo bloco</h3>${formBloco({ escolhas, colunas })}</section>
      </aside>
    </div>`,
  });
}

// ---------- revisões ----------

function htmlRevisao(r, { info, intervalos, hoje }) {
  const t = info(r.trilha);
  const vencida = r.proxima <= hoje;
  const atraso = r.proxima < hoje ? diasEntre(r.proxima, hoje) : 0;
  const link = linkDaRevisao(r, info);
  const quando = vencida
    ? (atraso ? `atrasada ${atraso} ${atraso === 1 ? 'dia' : 'dias'}` : 'para hoje')
    : `em ${dataBR(r.proxima, false)} (${diasEntre(hoje, r.proxima)} d)`;
  return `
      <li class="revisao${vencida ? ' vencida' : ''}">
        <span class="ev-trilha ${t.classe}">${esc(t.curto)}</span>
        <span class="rev-info">
          <span class="rev-assunto">${link ? `<a href="${link}">${esc(r.assunto)}</a>` : esc(r.assunto)}</span>
          <small>${rotuloEtapa(r, intervalos)} · ${quando} · estudado em ${dataBR(r.ultima, false)} · ${esc(ORIGENS[r.origem] || r.origem)}${r.revisoes ? ` · ${r.revisoes} ${r.revisoes === 1 ? 'revisão feita' : 'revisões feitas'}` : ''}</small>
        </span>
        <span class="rev-acoes">
          ${vencida ? botoesRevisao(r) : ''}
          <a class="btn" href="${linkFoco(r.trilha, r.assunto)}">${acao('foco', 'Focar')}</a>
          <details class="rev-mais"><summary>Mais</summary><span class="rev-menu">
            <button type="button" class="btn-x" data-acao-url="/api/revisoes/${r.id}/adiar" data-acao-corpo='{"dias":1}' data-acao-msg="Revisão adiada em 1 dia.">Adiar 1 dia</button>
            <button type="button" class="btn-x" data-acao-url="/api/revisoes/${r.id}/arquivar" data-acao-msg="Revisão arquivada.">Arquivar</button>
            <button type="button" class="btn-x" data-acao-url="/api/revisoes/${r.id}/remover" data-confirmar data-acao-msg="Revisão removida.">${acao('excluir', 'Remover')}</button>
          </span></details>
        </span>
      </li>`;
}

export function paginaRevisoes({ usuario, trilhas, almas, foco, lista, arquivadas, ajustes, escolhas, filtro, feitasHoje }) {
  const info = infoTrilhas(trilhas);
  const hoje = hojeISO();
  const em7 = somarDias(hoje, 7);
  const ctx = { info, intervalos: ajustes.intervalos, hoje };
  const vis = filtro ? lista.filter((r) => r.trilha === filtro) : lista;
  const paraHoje = vis.filter((r) => r.proxima <= hoje);
  const semana = vis.filter((r) => r.proxima > hoje && r.proxima <= em7);
  const depois = vis.filter((r) => r.proxima > em7);
  const atrasadas = paraHoje.filter((r) => r.proxima < hoje).length;
  const listaHtml = (itens, vazio) => (itens.length ? `<ul class="revisoes-lista caixa">${itens.map((r) => htmlRevisao(r, ctx)).join('')}</ul>` : `<p class="vazio">${vazio}</p>`);
  return layout({
    titulo: 'Revisões', ativo: 'revisoes', usuario, trilhas, almas, foco, classe: 'pg-revisoes',
    corpo: `
    <section class="envolve conta-topo">
      <p class="eyebrow">Revisões espaçadas</p>
      <h1 class="titulo-gotico">Revisões</h1>
      <p class="lema">Cada assunto estudado volta em ${ajustes.intervalos.join(', ')} dias. Pomodoros com assunto, tarefas marcadas e questões registradas agendam sozinhos. <a href="/configuracoes#revisoes">Mudar os intervalos</a>.</p>
      <div class="tiles revisoes-tiles">
        <div class="tile"><span class="tile-rot">Para hoje</span><span class="tile-val">${paraHoje.length}</span><span class="tile-sub">${atrasadas ? `${atrasadas} ${atrasadas === 1 ? 'atrasada' : 'atrasadas'}` : 'nenhuma atrasada'}</span></div>
        <div class="tile"><span class="tile-rot">Feitas hoje</span><span class="tile-val">${feitasHoje}</span><span class="tile-sub">revisões registradas</span></div>
        <div class="tile"><span class="tile-rot">Próximos 7 dias</span><span class="tile-val">${semana.length}</span><span class="tile-sub">até ${dataBR(em7, false)}</span></div>
        <div class="tile"><span class="tile-rot">No ciclo</span><span class="tile-val">${vis.length}</span><span class="tile-sub">assuntos ativos</span></div>
      </div>
    </section>
    <div class="trilha-grade envolve revisoes-grade">
      <section>
        <form class="filtro-trilha" method="get" action="/revisoes"><label>Trilha<select name="trilha" data-enviar-ao-mudar><option value="">Todas</option>${escolhas.map((t) => `<option value="${esc(t.slug)}"${t.slug === filtro ? ' selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></label><noscript><button class="btn" type="submit">Filtrar</button></noscript></form>
        <h2 class="titulo-secao">Para hoje</h2>
        ${listaHtml(paraHoje, 'Nenhuma revisão para hoje. Estude algo novo e ela aparece aqui amanhã.')}
        <h2 class="titulo-secao">Próximos 7 dias</h2>
        ${listaHtml(semana, 'Nada nos próximos 7 dias.')}
        ${depois.length ? `<details class="mais-tarde"><summary>Mais adiante (${depois.length})</summary>${listaHtml(depois, '')}</details>` : ''}
        ${arquivadas.length ? `<details class="mais-tarde"><summary>Arquivadas (${arquivadas.length})</summary><ul class="revisoes-lista caixa">${arquivadas.map((r) => `
          <li class="revisao arquivada"><span class="ev-trilha ${info(r.trilha).classe}">${esc(info(r.trilha).curto)}</span><span class="rev-info"><span class="rev-assunto">${esc(r.assunto)}</span><small>arquivada · estudado em ${dataBR(r.ultima, false)}</small></span>
            <span class="rev-acoes"><button type="button" class="btn" data-acao-url="/api/revisoes/${r.id}/restaurar" data-acao-msg="Revisão de volta ao ciclo.">Restaurar</button>
            <button type="button" class="btn-x" data-acao-url="/api/revisoes/${r.id}/remover" data-confirmar data-acao-msg="Revisão removida.">${acao('excluir', 'Remover')}</button></span></li>`).join('')}</ul></details>` : ''}
      </section>
      <aside class="lateral">
        <section class="caixa"><h3>Estudei algo fora do site</h3>
          <form data-form="revisao-nova" class="form-conta" novalidate>
            <label>Trilha<select name="trilha">${escolhas.map((t) => `<option value="${esc(t.slug)}"${t.slug === filtro ? ' selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></label>
            <label>Assunto<input name="assunto" maxlength="160" required placeholder="Ex.: Crase, DNS e DHCP, Funções afim"></label>
            <label>Estudado em<input type="date" name="data" value="${hoje}" max="${hoje}" required></label>
            <p class="erro-form" data-erro hidden></p>
            <button class="btn btn-ouro" type="submit">${acao('adicionar', 'Agendar revisões')}</button>
          </form>
        </section>
        <section class="caixa"><h3>Como funciona</h3>
          <ul class="lista-simples">
            <li><b>Fácil</b> pula um intervalo; <b>Bom</b> avança um; <b>Difícil</b> volta um; <b>Errei</b> recomeça.</li>
            <li>Estudar de novo um assunto vencido (pomodoro, tarefa ou questões na meta) conta como revisão boa.</li>
            <li>Questões abaixo da meta da semana mandam o assunto de volta para amanhã.</li>
            <li>Revisões que cairiam depois da prova vêm para dois dias antes dela.</li>
          </ul>
        </section>
      </aside>
    </div>`,
  });
}

// ---------- IA ----------

const NOMES_NIVEL = { facil: 'fácil', medio: 'média', dificil: 'difícil' };

export function htmlQuestoes(questoes) {
  return `<ol class="questoes">${questoes.map((q, i) => {
    const correta = q.alternativas.find((a) => a.correta);
    return `
      <li class="questao" data-questao>
        <p class="q-cab"><b>Questão ${i + 1}</b> <small>${esc(q.assunto)}${q.nivel ? ` · ${esc(NOMES_NIVEL[q.nivel] || q.nivel)}` : ''}</small></p>
        <div class="q-enunciado">${renderizarTexto(q.enunciado)}</div>
        <ol class="q-alternativas">${q.alternativas.map((a) => `<li><button type="button" class="q-alt" data-correta="${a.correta ? 1 : 0}"><b>${esc(a.letra)}</b><span>${esc(a.texto)}</span></button></li>`).join('')}</ol>
        <details class="q-gabarito"><summary>Gabarito e comentários</summary>
          <p class="q-resposta">Resposta: <b>${esc(correta?.letra || '?')}</b></p>
          ${renderizarTexto(q.explicacao)}
          <ul class="q-comentarios">${q.alternativas.map((a) => `<li${a.correta ? ' class="correta"' : ''}><b>${esc(a.letra)}${a.correta ? ' (correta)' : ''}:</b> ${renderizarTexto(a.comentario)}</li>`).join('')}</ul>
        </details>
      </li>`;
  }).join('')}</ol>`;
}

const ESTADOS_IA = { rodando: 'em andamento', ok: 'pronto', erro: 'erro', recusado: 'recusado', cortado: 'cortado', cancelado: 'cancelado' };
const usd = (v) => `US$ ${Number(v || 0).toFixed(v >= 1 ? 2 : 3)}`;

function linhaHistorico(h, info) {
  const t = h.trilha ? info(h.trilha) : null;
  const quando = new Date(h.criado);
  return `<li><span class="ev-trilha ${t ? t.classe : 't-inicio'}">${esc(t ? t.curto : 'IA')}</span>
    <span class="ev-txt"><a href="/ia/${h.id}">${esc(TAREFAS[h.tarefa].nome)}: ${esc(h.assunto || h.material || 'sem assunto')}</a>
      <small>${esc(MODOS_IA[h.modo].nome.toLowerCase())} · ${esc(ESTADOS_IA[h.estado])}${h.custo_usd ? ` · ${usd(h.custo_usd)}` : ''}</small></span>
    <time>${quando.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${quando.toTimeString().slice(0, 5)}</time></li>`;
}

export function paginaIA({ usuario, trilhas, almas, foco, estado, escolhas, materiais, assuntos, dados, historico, gasto, hojeN, regras, trilhaInicial = '' }) {
  const info = infoTrilhas(trilhas);
  const status = estado.podeGerar
    ? `<p class="ia-status ligada">${iconeUI('ia')}<span>Ligada · ${esc(estado.modelo)} · ${hojeN} de ${estado.limiteDiario} pedidos hoje · gasto do mês: ${usd(gasto)} de US$ ${estado.orcamento}</span></p>`
    : `<p class="ia-status desligada">${iconeUI('ia')}<span>${esc(estado.motivo)} Enquanto isso, use “Ver o prompt” e cole no Claude (claude.ai).</span></p>`;
  const radio = (nome, valor, rotulo, descricao, marcado) => `<label class="modo" title="${esc(descricao)}"><input type="radio" name="${nome}" value="${valor}"${marcado ? ' checked' : ''}><span>${esc(rotulo)}</span></label>`;
  return layout({
    titulo: 'IA', ativo: 'ia', usuario, trilhas, almas, foco, classe: 'pg-ia', scripts: ['/js/ia.js'],
    corpo: `
    <section class="envolve conta-topo">
      <p class="eyebrow">Inteligência artificial</p>
      <h1 class="titulo-gotico">${ehPixel(usuario) ? 'O Oráculo' : 'IA de estudo'}</h1>
      <p class="lema">Analisa um assunto, faz resumos e cria questões no estilo da banca, sempre em linguagem técnica. Escolha o quanto ela deve raciocinar: mais raciocínio dá respostas mais profundas, mas demora e custa mais.</p>
      ${status}
    </section>
    <div class="trilha-grade envolve ia-grade">
      <section class="caixa ia-form-caixa">
        <form class="form-conta form-ia" data-form="ia" novalidate>
          <fieldset class="modos"><legend>Tarefa</legend>${Object.entries(TAREFAS).map(([k, t], i) => radio('tarefa', k, t.nome, t.descricao, i === 0)).join('')}</fieldset>
          <fieldset class="modos"><legend>Raciocínio</legend>${Object.entries(MODOS_IA).map(([k, m]) => radio('modo', k, m.nome, m.descricao, k === 'medio')).join('')}</fieldset>
          <p class="ajuda" data-ia-modo-desc>${esc(MODOS_IA.medio.descricao)}</p>
          <div class="campos">
            <label class="largo">Trilha<select name="trilha" data-ia-trilha><option value="">Sem trilha</option>${escolhas.map((t) => `<option value="${esc(t.slug)}"${t.slug === trilhaInicial ? ' selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></label>
            <label class="largo">Material de referência<select name="material" data-ia-material><option value="">Nenhum: só o assunto</option>${materiais.map((m) => `<option value="${esc(m.valor)}" data-trilha="${esc(m.trilha)}">${esc(m.titulo)}</option>`).join('')}</select></label>
            <label class="largo" data-ia-secao-campo hidden>Seção da nota<select name="secao" data-ia-secao><option value="">Nota inteira</option></select></label>
            <label class="largo">Assunto<input name="assunto" maxlength="200" data-ia-assunto placeholder="Ex.: DNS e DHCP; Crase; Geometria espacial" autocomplete="off"></label>
            <label class="largo" data-ia-cargo-campo hidden>Cargo<select name="cargo" data-ia-cargo></select></label>
          </div>
          <div class="campos" data-so-questoes hidden>
            <label>Quantidade<select name="quantidade">${QUANTIDADES.map((n) => `<option value="${n}"${n === 5 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
            <label>Nível<select name="dificuldade">${Object.entries(DIFICULDADES).map(([k, v]) => `<option value="${k}">${esc(v.replace(/ \(.*\)$/, ''))}</option>`).join('')}</select></label>
            <label class="largo">Estilo<select name="estilo" data-ia-estilo>${Object.entries(ESTILOS).map(([k, v]) => `<option value="${k}">${esc(v.split(':')[0])}</option>`).join('')}</select></label>
          </div>
          ${Object.entries(assuntos).map(([slug, lista]) => `<datalist id="ia-assuntos-${esc(slug)}">${lista.map((a) => `<option value="${esc(a)}">`).join('')}</datalist>`).join('')}
          <p class="erro-form" data-erro hidden></p>
          <div class="foco-botoes">
            <button class="btn btn-ouro" type="submit" data-ia-gerar${estado.podeGerar ? '' : ` disabled title="${esc(estado.motivo)}"`}>${acao('ia', 'Gerar')}</button>
            <button class="btn" type="button" data-ia-ver-prompt>${acao('olho', 'Ver o prompt')}</button>
            <button class="btn-x" type="button" data-ia-parar hidden>${acao('parar', 'Parar')}</button>
          </div>
        </form>
      </section>
      <aside class="lateral">
        <details class="caixa ia-regras" open><summary><h3>Regras fixas</h3></summary>
          <div class="nota ia-regras-txt">${renderizarTexto(regras)}</div>
          <table class="ia-modos"><thead><tr><th>Modo</th><th>Esforço na API</th></tr></thead><tbody>${Object.entries(MODOS_IA).map(([k, m]) => `<tr><td>${esc(m.nome)}</td><td><code>${esc(estado.esforco[k])}</code></td></tr>`).join('')}</tbody></table>
          <p class="ajuda">As regras ficam em <code>config/ia-regras.md</code>; modelo, esforço, limites e orçamento em <code>config/ia.json</code>.</p>
        </details>
      </aside>
    </div>
    <section class="envolve" data-ia-prompt hidden>
      <h2 class="titulo-secao">Prompt</h2>
      <div class="caixa ia-prompt"><div class="foco-botoes"><button class="btn btn-ouro" type="button" data-ia-copiar>${acao('copiar', 'Copiar prompt')}</button><span class="ajuda" data-ia-prompt-info></span></div><pre data-ia-prompt-texto></pre></div>
    </section>
    <section class="envolve" data-ia-resultado hidden>
      <h2 class="titulo-secao" data-ia-titulo>Resposta</h2>
      <div class="caixa ia-resultado">
        <p class="ia-andamento" data-ia-andamento role="status"></p>
        <details class="ia-pensamento" data-ia-pensamento hidden><summary>Raciocínio do modelo (resumo)</summary><div class="ia-pensamento-txt" data-ia-pensamento-txt></div></details>
        <div class="ia-saida nota" data-ia-saida></div>
        <div class="foco-botoes" data-ia-acoes hidden>
          <a class="btn" data-ia-abrir href="/ia">${acao('link', 'Abrir resposta salva')}</a>
          <button type="button" class="btn" data-ia-revisao>${acao('revisao', 'Agendar revisão do assunto')}</button>
          <button type="button" class="btn" data-ia-copiar-resposta>${acao('copiar', 'Copiar texto')}</button>
        </div>
      </div>
    </section>
    <section class="envolve">
      <h2 class="titulo-secao">Histórico</h2>
      ${historico.length ? `<ul class="eventos caixa ia-historico">${historico.map((h) => linhaHistorico(h, info)).join('')}</ul>` : '<p class="vazio">Nenhum pedido ainda.</p>'}
    </section>
    <script type="application/json" id="ia-dados">${JSON.stringify(dados).replace(/</g, '\\u003c')}</script>`,
  });
}

export function paginaIAResultado({ usuario, trilhas, almas, foco, pedido, conteudoHtml, raciocinioHtml }) {
  const info = infoTrilhas(trilhas);
  const t = pedido.trilha ? info(pedido.trilha) : null;
  const quando = new Date(pedido.criado);
  return layout({
    titulo: `${TAREFAS[pedido.tarefa].nome}: ${pedido.assunto || pedido.material || 'IA'}`, ativo: 'ia', usuario, trilhas, almas, foco, classe: 'pg-ia', scripts: ['/js/ia.js'],
    corpo: `
    <section class="envolve conta-topo">
      <nav class="migalhas"><a href="/ia">IA</a> › ${esc(TAREFAS[pedido.tarefa].nome)}</nav>
      <h1 class="titulo-gotico">${esc(pedido.assunto || pedido.material || TAREFAS[pedido.tarefa].nome)}</h1>
      <p class="heroi-nome">${t ? `${esc(t.nome)} · ` : ''}${esc(MODOS_IA[pedido.modo].nome)} · ${quando.toLocaleDateString('pt-BR')} ${quando.toTimeString().slice(0, 5)}</p>
      <p class="ajuda">${esc(ESTADOS_IA[pedido.estado])}${pedido.material ? ` · material: ${esc(pedido.material)}` : ''} · ${esc(pedido.modelo || '')}
        · ${pedido.entrada_tokens.toLocaleString('pt-BR')} tokens de entrada${pedido.cache_lidos ? ` (+${pedido.cache_lidos.toLocaleString('pt-BR')} do cache)` : ''}, ${pedido.saida_tokens.toLocaleString('pt-BR')} de saída · ${usd(pedido.custo_usd)}${pedido.duracao_ms ? ` · ${Math.round(pedido.duracao_ms / 1000)} s` : ''}</p>
      ${pedido.erro ? `<p class="erro-form">${esc(pedido.erro)}</p>` : ''}
    </section>
    <section class="envolve">
      <div class="caixa ia-resultado">
        ${raciocinioHtml ? `<details class="ia-pensamento"><summary>Raciocínio do modelo (resumo)</summary><div class="ia-pensamento-txt nota">${raciocinioHtml}</div></details>` : ''}
        <div class="ia-saida nota">${conteudoHtml || '<p class="vazio">Sem conteúdo.</p>'}</div>
        <div class="foco-botoes">
          ${pedido.assunto && pedido.trilha ? `<button type="button" class="btn" data-acao-url="/api/ia/${pedido.id}/revisao" data-acao-msg="Revisão agendada.">${acao('revisao', 'Agendar revisão do assunto')}</button>` : ''}
          <a class="btn" href="/ia">${acao('voltar', 'Voltar à IA')}</a>
          <button type="button" class="btn-x" data-acao-url="/api/ia/${pedido.id}/remover" data-confirmar data-acao-ir="/ia">${acao('excluir', 'Apagar resposta')}</button>
        </div>
      </div>
    </section>`,
  });
}

// ---------- caderno ----------

// O Caderno (o antigo Ayo Sketchbook): três painéis como o Obsidian, dentro do layout do site.
// Árvore, nota aberta, busca, links e grafo são montados por /js/caderno.js com a API /api/caderno.
export function paginaCaderno({ usuario, trilhas, almas, foco, prefs = {} }) {
  const px = ehPixel(usuario);
  const botao = (cmd, rotulo, ic, extra = '') => `<button type="button" class="cd-ico" data-cmd="${cmd}" title="${esc(rotulo)}" aria-label="${esc(rotulo)}"${extra}>${iconeUI(ic)}</button>`;
  const classe = ['pg-caderno', prefs.esquerda === false ? 'sem-esquerda' : '', prefs.direita === false ? 'sem-direita' : ''].filter(Boolean).join(' ');
  return layout({
    titulo: 'Caderno',
    ativo: 'caderno',
    usuario,
    trilhas,
    almas,
    foco,
    classe,
    estilos: ['/css/caderno.css'],
    scripts: ['/js/desenho.js', '/js/caderno.js'],
    corpo: `
    <div class="cd" data-app data-modo="${esc(prefs.modo || 'dividir')}">
      <div class="cd-topo">
        ${botao('alternar-esquerda', 'Arquivos, busca e tags', 'painel-esq')}
        <button type="button" class="cd-rapida" data-cmd="abrir-rapido">${iconeUI('busca')}<span>Abrir nota…</span><kbd>Ctrl O</kbd></button>
        ${botao('paleta', 'Comandos (Ctrl+P)', 'comando')}
        ${botao('alternar-direita', 'Links, sumário e propriedades', 'painel-dir')}
      </div>
      <div class="cd-app">
        <aside class="cd-lado cd-esq" aria-label="Arquivos, busca e tags">
          <div class="cd-abas" role="tablist">
            <button type="button" role="tab" data-aba="arquivos" aria-selected="true">Arquivos</button>
            <button type="button" role="tab" data-aba="busca" aria-selected="false">Busca</button>
            <button type="button" role="tab" data-aba="tags" aria-selected="false">Tags</button>
          </div>
          <div class="cd-ferr">
            ${botao('nova-nota', 'Nova nota (Ctrl+N)', 'nota-nova')}
            ${botao('nova-pasta', 'Nova pasta', 'pasta-nova')}
            ${botao('novo-desenho', 'Novo desenho', 'desenho')}
            ${botao('diaria', 'Nota do dia', 'sol')}
            ${botao('grafo', 'Grafo', 'grafo')}
            ${botao('recolher', 'Recolher pastas', 'setas')}
          </div>
          <div class="cd-painel" data-painel="arquivos"><ul class="cd-arvore" data-arvore role="tree"><li class="vazio">Abrindo o cofre…</li></ul></div>
          <div class="cd-painel" data-painel="busca" hidden>
            <input type="search" class="cd-campo-busca" data-busca placeholder="Buscar no cofre (tag:nome para tags)" aria-label="Buscar no cofre">
            <ul class="cd-lista" data-resultados></ul>
          </div>
          <div class="cd-painel" data-painel="tags" hidden><ul class="cd-tags" data-tags></ul></div>
        </aside>

        <section class="cd-centro" data-centro aria-label="Nota">
          <div class="cd-barra" data-barra hidden>
            <nav class="cd-caminho" data-migalha aria-label="Caminho"></nav>
            <a class="cd-na-trilha" data-na-trilha hidden></a>
            <span class="cd-estado" data-estado role="status"></span>
            <div class="cd-modos" data-modos role="group" aria-label="Modo de visualização">
              <button type="button" data-modo-btn="editar" title="Editar (Ctrl+E alterna)">Editar</button>
              <button type="button" data-modo-btn="dividir" title="Editar e ler lado a lado">Dividir</button>
              <button type="button" data-modo-btn="ler" title="Ler">Ler</button>
            </div>
            ${botao('mais', 'Mais ações', 'mais', ' data-menu-botao')}
          </div>
          <div class="cd-vazio" data-vazio>
            ${px ? sprite('livro', { escala: 6 }) : ''}
            <h1 class="titulo-gotico">Caderno</h1>
            <p>Abra uma nota na lateral, aperte <kbd>Ctrl O</kbd> para procurar pelo nome ou comece uma nova.</p>
            <div class="foco-botoes">
              <button type="button" class="btn btn-ouro" data-cmd="nova-nota">${acao('nota-nova', 'Nova nota')}</button>
              <button type="button" class="btn" data-cmd="novo-desenho">${acao('desenho', 'Novo desenho')}</button>
              <button type="button" class="btn" data-cmd="diaria">${acao('sol', 'Nota do dia')}</button>
            </div>
          </div>
          <div class="cd-editor" data-editor hidden>
            <textarea class="cd-fonte" data-fonte spellcheck="true" aria-label="Texto da nota em Markdown"></textarea>
            <article class="cd-leitura nota" data-leitura aria-label="Nota renderizada"></article>
          </div>
          <div class="cd-desenho" data-desenho-area hidden></div>
          <div class="cd-grafo" data-grafo-area hidden><canvas data-grafo aria-label="Grafo das notas"></canvas><p class="ajuda">Arraste para mover, use a roda do mouse para aproximar, clique numa nota para abrir.</p></div>
          <div class="cd-imagem" data-imagem-area hidden></div>
        </section>

        <aside class="cd-lado cd-dir" aria-label="Links, sumário e propriedades">
          <div class="cd-abas" role="tablist">
            <button type="button" role="tab" data-aba-dir="links" aria-selected="true">Links</button>
            <button type="button" role="tab" data-aba-dir="sumario" aria-selected="false">Sumário</button>
            <button type="button" role="tab" data-aba-dir="props" aria-selected="false">Propriedades</button>
          </div>
          <div class="cd-painel" data-painel-dir="links"><h3>Links para esta nota</h3><ul class="cd-lista" data-backlinks><li class="vazio">Abra uma nota.</li></ul><h3>Links que saem</h3><ul class="cd-lista" data-saidas></ul></div>
          <div class="cd-painel" data-painel-dir="sumario" hidden><ol class="cd-sumario" data-sumario></ol></div>
          <div class="cd-painel" data-painel-dir="props" hidden><dl class="cd-props" data-props></dl></div>
        </aside>
      </div>
    </div>
    <div class="cd-modal" data-modal hidden>
      <div class="cd-modal-caixa" role="dialog" aria-modal="true" aria-label="Busca rápida">
        <input class="cd-modal-campo" data-modal-campo autocomplete="off" spellcheck="false">
        <ul class="cd-modal-lista" data-modal-lista role="listbox"></ul>
        <p class="cd-modal-dica" data-modal-dica></p>
      </div>
    </div>
    <ul class="cd-flutuante" data-menu hidden role="menu"></ul>
    <ul class="cd-flutuante cd-auto" data-auto hidden role="listbox"></ul>`,
  });
}
