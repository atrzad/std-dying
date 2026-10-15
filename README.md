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
- Documentação completa: `~/Projects Vaults/ayo-std-vault/`

As notas `.md` dos cofres são a fonte da verdade. O site marca tarefas direto nos arquivos (com backup e escrita atômica) e grava questões no `registro-questoes.csv` de cada cofre.
