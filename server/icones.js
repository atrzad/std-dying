// Ícones vetoriais locais: a forma indica a ação; a cor vem do tema.
// Os rótulos ficam no botão/link, sem repetir o nome no leitor de tela.
import { esc } from './markdown.js';

const FORMAS = {
  inicio: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z"/>',
  foco: '<circle cx="12" cy="14" r="8"/><path d="M9 2h6m-3 0v4m6 1 2-2m-8 5v5l3 2"/>',
  pasta: '<path d="M3 6h6l2 3h10v11H3Zm0 0V4h6l2 2h8v3"/>',
  caderno: '<path d="M5 3h15v18H5Zm3 0v18M3 7h4m-4 5h4m-4 5h4m5-10h5m-5 4h5"/>',
  grupo: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3Zm13-11a3 3 0 1 0 0-6m2 10a5 5 0 0 1 3 4v3"/>',
  codigo: '<path d="m7 6-5 6 5 6m10-12 5 6-5 6M14 3l-4 18"/>',
  carreira: '<rect x="3" y="7" width="18" height="14" rx="1"/><path d="M8 7V3h8v4M3 12l9 3 9-3m-9 0v5"/>',
  estudos: '<path d="m2 8 10-5 10 5-10 5Zm4 2v7q6 5 12 0v-7m4-2v9"/>',
  instituicao: '<path d="m3 8 9-5 9 5ZM3 21h18M5 11v7m7-7v7m7-7v7M3 18h18"/>',
  banco: '<path d="M3 21V8h18v13M2 8l10-5 10 5M7 12v5m5-5v5m5-5v5M2 21h20"/>',
  configuracoes: '<path d="M4 3v18M12 3v18M20 3v18M1 8h6m2 8h6m2-8h6"/>',
  sair: '<path d="M10 3H3v18h7m5-14 5 5-5 5m-8-5h13"/>',
  entrar: '<path d="M14 3h7v18h-7M9 7l5 5-5 5m-6-5h11"/>',
  recolher: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M8 3v18m8-13-4 4 4 4"/>',
  fechar: '<path d="m5 5 14 14M19 5 5 19"/>',
  iniciar: '<path d="m6 3 15 9-15 9Z"/>',
  pausar: '<path d="M6 4h3v16H6Zm9 0h3v16h-3Z"/>',
  concluir: '<path d="m4 12 5 5L20 6"/>',
  editar: '<path d="m14 4 6 6M3 21l5-1L21 7l-5-5L3 15Zm0-6 5 5"/>',
  adicionar: '<path d="M12 4v16M4 12h16"/>',
  salvar: '<path d="M3 3h15l3 3v15H3Zm4 0v7h10V3M7 21v-7h10v7"/>',
  excluir: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  baixar: '<path d="M12 3v12m-5-5 5 5 5-5M3 15v6h18v-6"/>',
  copiar: '<path d="M8 8h13v13H8ZM16 8V3H3v13h5"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="m3 6 9 7 9-7"/>',
  voltar: '<path d="m10 5-7 7 7 7M3 12h18"/>',
  avancar: '<path d="m14 5 7 7-7 7M21 12H3"/>',
  link: '<path d="M14 3h7v7m0-7L11 13M10 5H3v16h16v-7"/>',
  atualizar: '<path d="M20 4v6h-6M4 20v-6h6M4 9a8 8 0 0 1 14-5l2 3M4 17l2 3a8 8 0 0 0 14-5"/>',
  filtrar: '<path d="M3 4h18l-7 8v7l-4 2v-9Z"/>',
  calendario: '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4m8-4v4M7 14h3m4 0h3M7 18h3"/>',
  revisao: '<path d="M4 12a8 8 0 1 0 2.6-5.9M4 3.5V9h5.5"/><path d="M12 8v4.5l3 2"/>',
  ia: '<path d="m11 3 1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9Z"/><path d="m18.5 14 .9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9Z"/>',
  parar: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  olho: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  setas: '<path d="m8 9 4-4 4 4M8 15l4 4 4-4"/>',
  // Caderno
  documento: '<path d="M6 2h8l5 5v15H6Zm8 0v5h5M9 12h7m-7 4h7"/>',
  'nota-nova': '<path d="M6 2h8l5 5v15H6Zm8 0v5h5m-6.5 4v7M9 14.5h7"/>',
  'pasta-nova': '<path d="M3 6h6l2 3h10v11H3Zm9 5v6m-3-3h6"/>',
  desenho: '<path d="m15 4 5 5-9 9H6v-5Z"/><path d="M3 21c3-2 5 1 8-1s5-1 7 0"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  grafo: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="9" cy="18" r="2.5"/><path d="m8.3 7 7.4.6M7 8.3l1.4 7.3m8-5.6-5.8 6.3"/>',
  busca: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 6 6"/>',
  mais: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  'painel-esq': '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M9 4v16M5 8h2m-2 3h2"/>',
  'painel-dir': '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M15 4v16m2-12h2m-2 3h2"/>',
  comando: '<path d="m4 7 5 5-5 5m8 1h8"/>',
};

export function iconeUI(nome) {
  const forma = FORMAS[nome];
  if (!forma) throw new Error(`Ícone desconhecido: ${nome}`);
  return `<svg class="icone-ui" data-icone="${nome}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${forma}</svg>`;
}

export const iconeTrilha = (slug) => ({ dev: 'codigo', carreira: 'carreira', enem: 'estudos', manausprev: 'instituicao', bb: 'banco' })[slug] || 'caderno';
export const acao = (nome, rotulo) => `${iconeUI(nome)}<span data-rotulo>${esc(rotulo)}</span>`;
