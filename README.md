# Ayo Std

Painel de estudos em pixel art (estética soulslike) que une os cofres do Obsidian: Trilha Dev, ENEM, Manaus Previdência e BB.

- Site: https://ayo-std.tail9ff58.ts.net (internet, via container Tailscale em `deploy/tailscale`) · http://localhost:3300 (local)
- Serviço: `systemctl --user status ayo-std` · log: `journalctl --user -u ayo-std -f`
- Contas: página `/conta` no site (dono cria contas; todos trocam nome e senha) · pelo terminal: `npm run senha -- <usuario>`
- Perfis de acesso: `config/perfis.json`
- Cofres e temas: `config/trilhas.json` · porta e pastas: `.env`
- Tema Wikipédia: em **Configurações → Tema**, escolha automático (acompanha o aparelho), claro ou escuro. A escolha fica salva na conta e vale para todas as páginas autenticadas. Estilos em `public/css/wikipedia.css`, catálogo em `server/temas.js`.
- Ícones de navegação, cartões e ações em todos os temas, incluindo Wikipédia: SVGs locais em `server/icones.js`, com cores e traços adaptados em `public/css/icones.css`. Os textos dos botões continuam visíveis e acessíveis.
- Pomodoro ativo: painel flutuante no canto inferior, com controles por hover, toque ou teclado. Ao rolar para baixo, fixa no cabeçalho; ao voltar ao início, flutua novamente. Estilos em `public/css/pomodoro.css`.
- Cofres e caminhos: em `config/trilhas.json`, cada trilha tem `pasta` e `alternativas`; vale a primeira pasta que existir (a pasta pode mudar de lugar sem reiniciar o serviço).
- Cronograma da semana (`/cronograma`, `server/cronograma.js`): a semana-modelo de cada pessoa (`/cronograma/modelo`) tem blocos por dia; o assunto de cada bloco vem de uma coluna das tabelas de rotação dos cronogramas nos cofres (primeira coluna "Semana", linhas S1, S2…), da próxima tarefa não feita da trilha, de um texto fixo ou das revisões do dia. Eventos com data escritos nos cronogramas (simulados, checkpoints, prova) aparecem no dia certo, e o tempo de pomodoro do dia preenche os blocos. O dia de hoje também aparece no início.
- Revisões espaçadas (`/revisoes`, `server/revisoes.js`): todo assunto estudado volta em 1, 7, 30 e 90 dias (ajustável em Configurações). Pomodoro com assunto (10 min ou mais), tarefa marcada e questões registradas agendam sozinhos; questões abaixo da meta mandam o assunto de volta para amanhã; revisão que cairia depois da prova vem para dois dias antes dela.
- IA (`/ia`, `server/ia.js`): analisa assuntos, cria resumos e cria questões no estilo da banca com o Claude (API da Anthropic), em três modos de raciocínio (baixo, médio e alto = esforço low, medium e high). Fica desligada até existir `ANTHROPIC_API_KEY` no `.env`; enquanto isso, “Ver o prompt” monta o pedido para colar no claude.ai. Regras fixas em `config/ia-regras.md`; modelo, esforço, perfis com acesso, limite diário e orçamento mensal em `config/ia.json`.
- Documentação completa: `~/Projects Vaults/ayo-std-vault/`

As notas `.md` dos cofres são a fonte da verdade. O site marca tarefas direto nos arquivos (com backup e escrita atômica) e grava questões no `registro-questoes.csv` de cada cofre.
