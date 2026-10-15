# std(dying)

Painel de estudos em pixel art (estética soulslike) que une os cofres do Obsidian: Trilha Dev, Trilha Carreira, ENEM, Manaus Previdência e BB. Desde a 2.0.0 inclui o **Caderno** (o antigo Ayo Sketchbook): notas em Markdown no estilo do Obsidian, links, grafo e desenho à caneta. Até a 1.9.0 o projeto se chamava Ayo Std.

- Site: https://std-dying.tail9ff58.ts.net (internet, via container Tailscale em `deploy/tailscale`) · http://localhost:3300 (local)
- Endereços antigos (até 14/11/2026): ayo-std.tail9ff58.ts.net leva à mesma página aqui, com a sessão junto; ayo-sketchbook.tail9ff58.ts.net leva à mesma nota no Caderno. Containers em `deploy/tailscale-antigos/`; depois dessa data, basta `docker compose down` em cada um.
- Serviço: `systemctl --user status std-dying` · log: `journalctl --user -u std-dying -f` · unidade em `deploy/std-dying.service`
- Contas: página `/configuracoes` no site (o dono cria contas; todos trocam nome e senha) · pelo terminal: `npm run senha -- <usuario>`
- Perfis de acesso: `config/perfis.json`
- Cofres e temas: `config/trilhas.json` · porta, pastas e endereços: `.env` (modelo em `.env.exemplo`)
- Caderno (`/caderno`, `server/caderno/`, `public/js/caderno.js` e `desenho.js`, `public/css/caderno.css`):
  - o do dono é a pasta `COFRE_DONO` (a mesma que o Obsidian abre, com as trilhas dentro); o das outras contas fica em `DATA_DIR/cofres/u<id>` e é apagado junto com a conta;
  - árvore de arquivos, busca (`tag:nome` para tags), tags, links de entrada e saída, sumário, propriedades, grafo, nota do dia (`Diário/AAAA-MM-DD.md`, a partir de `Modelos/Diária.md` se existir), anexos colados ou arrastados (`Anexos/`) e desenhos (`.sketch.json` + prévia `.sketch.png`, que o Obsidian mostra);
  - salva sozinho, recusa gravar por cima de mudanças feitas fora (Obsidian, outra aba, página da trilha) e usa a mesma fila de escrita das trilhas; renomear atualiza os `[[links]]`; apagar move para `.lixeira/`;
  - nas notas das trilhas, **Editar no caderno** abre a mesma nota no editor; no Caderno, **Na trilha …** volta para a página da trilha; os botões **Anotar** criam a nota com a tag da trilha;
  - atalhos: Ctrl+O abrir nota, Ctrl+P comandos, Ctrl+N nova nota (onde o navegador deixar), Ctrl+E editar/ler, Ctrl+Shift+F buscar, F2 renomear;
  - preferências (painéis, última nota, modo) ficam no banco, chave `caderno:<id>` da tabela `ajustes`. `npm run importar-sketchbook` trouxe as do Sketchbook (uma vez só).
- Tema Wikipédia: em **Configurações → Tema**, escolha automático (acompanha o aparelho), claro ou escuro. A escolha fica salva na conta e vale para todas as páginas autenticadas. Estilos em `public/css/wikipedia.css`, catálogo em `server/temas.js`.
- Ícones de navegação, cartões e ações em todos os temas, incluindo Wikipédia: SVGs locais em `server/icones.js`, com cores e traços adaptados em `public/css/icones.css`. Os textos dos botões continuam visíveis e acessíveis.
- Pomodoro ativo: painel flutuante no canto inferior, com controles por hover, toque ou teclado. Ao rolar para baixo, fixa no cabeçalho; ao voltar ao início, flutua novamente. Estilos em `public/css/pomodoro.css`.
- Cofres e caminhos: em `config/trilhas.json`, cada trilha tem `pasta` e `alternativas`; vale a primeira pasta que existir (a pasta pode mudar de lugar sem reiniciar o serviço).
- Cronograma da semana (`/cronograma`, `server/cronograma.js`): a semana-modelo de cada pessoa (`/cronograma/modelo`) tem blocos por dia; o assunto de cada bloco vem de uma coluna das tabelas de rotação dos cronogramas nos cofres (primeira coluna "Semana", linhas S1, S2…), da próxima tarefa não feita da trilha, de um texto fixo ou das revisões do dia. Eventos com data escritos nos cronogramas (simulados, checkpoints, prova) aparecem no dia certo, e o tempo de pomodoro do dia preenche os blocos. O dia de hoje também aparece no início.
- Revisões espaçadas (`/revisoes`, `server/revisoes.js`): todo assunto estudado volta em 1, 7, 30 e 90 dias (ajustável em Configurações). Pomodoro com assunto (10 min ou mais), tarefa marcada e questões registradas agendam sozinhos; questões abaixo da meta mandam o assunto de volta para amanhã; revisão que cairia depois da prova vem para dois dias antes dela.
- IA (`/ia`, `server/ia.js`): analisa assuntos, cria resumos e cria questões no estilo da banca com o Claude (API da Anthropic), em três modos de raciocínio (baixo, médio e alto = esforço low, medium e high). Fica desligada até existir `ANTHROPIC_API_KEY` no `.env`; enquanto isso, “Ver o prompt” monta o pedido para colar no claude.ai. Regras fixas em `config/ia-regras.md`; modelo, esforço, perfis com acesso, limite diário e orçamento mensal em `config/ia.json`.
- Dados: `~/.local/share/std-dying` (banco `std-dying.sqlite`, backups diários em `backups/banco/`, cofres do Caderno das outras contas em `cofres/`). O caminho antigo `~/.local/share/ayo-std` é um link para ele.
- Documentação completa: `~/Projects Vaults/std-dying-vault/`

As notas `.md` dos cofres são a fonte da verdade. O site marca tarefas direto nos arquivos (com backup e escrita atômica) e grava questões no `registro-questoes.csv` de cada cofre.
