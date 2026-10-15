// Página da IA: escolhe tarefa, modo e material; mostra o prompt; recebe a resposta aos poucos (NDJSON).
// Também deixa responder as questões geradas (aqui e na página de uma resposta salva).
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  let timerAviso;
  function avisar(texto, erro = false) {
    const el = $('#aviso');
    if (!el) return;
    el.textContent = texto;
    el.classList.toggle('erro', erro);
    el.classList.add('mostrar');
    clearTimeout(timerAviso);
    timerAviso = setTimeout(() => el.classList.remove('mostrar'), erro ? 6000 : 3000);
  }

  async function api(url, dados) {
    const resp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ayo': '1' }, body: JSON.stringify(dados ?? {}), credentials: 'same-origin',
    });
    let corpo = {};
    try { corpo = await resp.json(); } catch {}
    if (!resp.ok) throw new Error(corpo.erro || `Erro ${resp.status}.`);
    return corpo;
  }

  // ---------- questões: clicar numa alternativa mostra se acertou e abre o gabarito ----------
  document.addEventListener('click', (e) => {
    const alt = e.target.closest('.q-alt');
    if (!alt) return;
    const q = alt.closest('[data-questao]');
    if (!q || q.classList.contains('respondida')) return;
    q.classList.add('respondida');
    alt.classList.add('escolhida');
    $$('.q-alt', q).forEach((b) => {
      if (b.dataset.correta === '1') b.classList.add('certa');
      b.setAttribute('aria-disabled', 'true');
    });
    if (alt.dataset.correta !== '1') alt.classList.add('errada');
    const gabarito = $('.q-gabarito', q);
    if (gabarito) gabarito.open = true;
  });

  const form = $('form[data-form="ia"]');
  if (!form) return;
  let dados = {};
  try { dados = JSON.parse($('#ia-dados').textContent); } catch {}

  const trilha = $('[data-ia-trilha]', form);
  const material = $('[data-ia-material]', form);
  const secao = $('[data-ia-secao]', form);
  const secaoCampo = $('[data-ia-secao-campo]', form);
  const cargo = $('[data-ia-cargo]', form);
  const cargoCampo = $('[data-ia-cargo-campo]', form);
  const estilo = $('[data-ia-estilo]', form);
  const assunto = $('[data-ia-assunto]', form);
  const soQuestoes = $('[data-so-questoes]', form);
  const modoDesc = $('[data-ia-modo-desc]', form);
  const erroForm = $('[data-erro]', form);
  const botaoGerar = $('[data-ia-gerar]', form);
  const botaoParar = $('[data-ia-parar]', form);

  const caixaPrompt = $('[data-ia-prompt]');
  const textoPrompt = $('[data-ia-prompt-texto]');
  const infoPrompt = $('[data-ia-prompt-info]');
  const caixaResultado = $('[data-ia-resultado]');
  const titulo = $('[data-ia-titulo]');
  const andamento = $('[data-ia-andamento]');
  const pensamento = $('[data-ia-pensamento]');
  const pensamentoTxt = $('[data-ia-pensamento-txt]');
  const saida = $('[data-ia-saida]');
  const acoes = $('[data-ia-acoes]');
  const abrir = $('[data-ia-abrir]');
  const agendar = $('[data-ia-revisao]');

  const mostrarErro = (msg) => { erroForm.textContent = msg; erroForm.hidden = false; };

  // ---------- campos que dependem da trilha, do material e da tarefa ----------
  let pedidoSecoes = 0;
  async function aoMudarMaterial() {
    secao.replaceChildren(new Option('Nota inteira', ''));
    secaoCampo.hidden = !material.value;
    if (!material.value) return;
    const n = ++pedidoSecoes;
    try {
      const resp = await fetch(`/api/ia/secoes?trilha=${encodeURIComponent(trilha.value)}&material=${encodeURIComponent(material.value)}`, { credentials: 'same-origin' });
      const j = await resp.json();
      if (n !== pedidoSecoes) return;
      if (!resp.ok) throw new Error(j.erro || `Erro ${resp.status}.`);
      for (const s of j.secoes || []) secao.add(new Option(`${'— '.repeat(Math.max(0, s.nivel - 1))}${s.titulo}`, s.id));
    } catch (err) {
      avisar(err.message, true);
    }
  }

  function aoMudarTrilha() {
    const t = trilha.value;
    $$('option', material).forEach((o) => {
      const serve = !o.dataset.trilha || o.dataset.trilha === t;
      o.hidden = !serve;
      o.disabled = !serve;
    });
    if (material.selectedOptions[0]?.disabled) material.value = '';
    const info = dados.trilhas?.[t];
    cargo.replaceChildren(...(info?.cargos || []).map((c) => new Option(c.nome, c.chave)));
    cargoCampo.hidden = !(info?.cargos?.length > 1);
    if (info?.estilo) estilo.value = info.estilo;
    assunto.setAttribute('list', `ia-assuntos-${t}`);
    aoMudarMaterial();
  }

  function aoMudarTarefa() {
    soQuestoes.hidden = $('input[name="tarefa"]:checked', form)?.value !== 'questoes';
    modoDesc.textContent = dados.modos?.[$('input[name="modo"]:checked', form)?.value] || '';
  }

  trilha.addEventListener('change', aoMudarTrilha);
  material.addEventListener('change', aoMudarMaterial);
  form.addEventListener('change', (e) => { if (['tarefa', 'modo'].includes(e.target.name)) aoMudarTarefa(); });
  aoMudarTrilha();
  aoMudarTarefa();

  const corpo = () => Object.fromEntries(new FormData(form));

  // ---------- ver e copiar o prompt (funciona mesmo com a IA desligada) ----------
  const botaoPrompt = $('[data-ia-ver-prompt]', form);
  botaoPrompt.addEventListener('click', async () => {
    erroForm.hidden = true;
    botaoPrompt.disabled = true;
    try {
      const r = await api('/api/ia/prompt', corpo());
      textoPrompt.textContent = r.prompt;
      infoPrompt.textContent = `${r.prompt.length.toLocaleString('pt-BR')} caracteres · na API: ${r.parametros.modelo}, esforço ${r.parametros.esforco}`;
      caixaPrompt.hidden = false;
      caixaPrompt.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      mostrarErro(err.message);
    } finally {
      botaoPrompt.disabled = false;
    }
  });
  $('[data-ia-copiar]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(textoPrompt.textContent); avisar('Prompt copiado. Cole no Claude (claude.ai).'); } catch { avisar('Selecione o texto e copie.', true); }
  });
  $('[data-ia-copiar-resposta]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(saida.innerText); avisar('Resposta copiada.'); } catch { avisar('Selecione o texto e copie.', true); }
  });

  // ---------- gerar: a resposta chega em linhas JSON ----------
  let controle = null;
  let ultimoId = null;
  const NOMES = { analisar: 'Análise', resumir: 'Resumo', questoes: 'Questões' };
  const ESTADOS = { ok: 'Pronto.', cortado: 'A resposta veio cortada (passou do limite de tamanho).', recusado: 'O modelo recusou o pedido.' };

  function tratar(ev, tarefa) {
    if (ev.t === 'inicio') andamento.textContent = tarefa === 'questoes' ? 'Pensando e montando as questões…' : 'Pensando…';
    else if (ev.t === 'pensando') { pensamento.hidden = false; pensamentoTxt.append(ev.d); }
    else if (ev.t === 'texto') {
      if (!saida.classList.contains('bruto')) { saida.replaceChildren(); saida.classList.add('bruto'); }
      saida.append(ev.d);
      andamento.textContent = 'Escrevendo…';
    } else if (ev.t === 'fim') {
      saida.classList.remove('bruto');
      saida.innerHTML = ev.html;
      if (ev.raciocinio) { pensamento.hidden = false; pensamentoTxt.innerHTML = ev.raciocinio; }
      const custo = ev.custo ? ` · ${ev.uso.entrada.toLocaleString('pt-BR')} tokens de entrada, ${ev.uso.saida.toLocaleString('pt-BR')} de saída · US$ ${ev.custo.toFixed(3)}` : '';
      andamento.textContent = `${ESTADOS[ev.estado] || ''}${ev.erro && ev.estado !== 'ok' ? ` ${ev.erro}` : ''}${custo}`;
      ultimoId = ev.id;
      abrir.href = `/ia/${ev.id}`;
      acoes.hidden = false;
    } else if (ev.t === 'erro') {
      andamento.textContent = '';
      mostrarErro(ev.erro || 'Erro na IA.');
      if (ev.id) { ultimoId = ev.id; abrir.href = `/ia/${ev.id}`; }
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!dados.podeGerar || controle) return;
    erroForm.hidden = true;
    const dadosPedido = corpo();
    titulo.textContent = `${NOMES[dadosPedido.tarefa] || 'Resposta'}${dadosPedido.assunto ? `: ${dadosPedido.assunto}` : ''}`;
    caixaResultado.hidden = false;
    saida.replaceChildren();
    saida.classList.remove('bruto');
    pensamento.hidden = true;
    pensamento.open = false;
    pensamentoTxt.replaceChildren();
    acoes.hidden = true;
    andamento.textContent = 'Enviando…';
    andamento.classList.add('rodando');
    caixaResultado.scrollIntoView({ behavior: 'smooth', block: 'start' });
    controle = new AbortController();
    botaoGerar.disabled = true;
    botaoParar.hidden = false;
    try {
      const resp = await fetch('/api/ia/gerar', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ayo': '1' }, body: JSON.stringify(dadosPedido),
        credentials: 'same-origin', signal: controle.signal,
      });
      if (!resp.ok) {
        let j = {};
        try { j = await resp.json(); } catch {}
        throw new Error(j.erro || `Erro ${resp.status}.`);
      }
      const leitor = resp.body.getReader();
      const decodificador = new TextDecoder();
      let resto = '';
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        resto += decodificador.decode(value, { stream: true });
        let i;
        while ((i = resto.indexOf('\n')) >= 0) {
          const linha = resto.slice(0, i).trim();
          resto = resto.slice(i + 1);
          if (linha) tratar(JSON.parse(linha), dadosPedido.tarefa);
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') andamento.textContent = 'Pedido interrompido. O que já veio fica no histórico.';
      else { andamento.textContent = ''; mostrarErro(err.message.startsWith('Failed') ? 'Sem conexão com o servidor.' : err.message); }
    } finally {
      andamento.classList.remove('rodando');
      controle = null;
      botaoGerar.disabled = false;
      botaoParar.hidden = true;
    }
  });

  botaoParar.addEventListener('click', () => controle?.abort());

  agendar.addEventListener('click', async () => {
    if (!ultimoId) return;
    agendar.disabled = true;
    try {
      const r = await api(`/api/ia/${ultimoId}/revisao`);
      avisar(r.proxima ? `Revisão agendada para ${r.proxima.split('-').reverse().slice(0, 2).join('/')}.` : 'Revisão agendada.');
    } catch (err) {
      avisar(err.message, true);
    } finally {
      agendar.disabled = false;
    }
  });
})();
