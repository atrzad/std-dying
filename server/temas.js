// Temas que cada pessoa escolhe nas configurações. "base" diz qual folha de estilo e quais enfeites a página usa
// (pixel: sprites, almas, banners; normal: sem enfeites). As paletas do pixel ficam em public/css/temas.css.
export const TEMAS = [
  { id: 'pixel', base: 'pixel', nome: 'Fogueira', descricao: 'O padrão: pedra, bronze e brasa.' },
  { id: 'abismo', base: 'pixel', nome: 'Abismo', descricao: 'O mais escuro: preto puro, prata e chama violeta.' },
  { id: 'nevoa', base: 'pixel', nome: 'Névoa', descricao: 'Cinza de neblina, ferrugem e vermelho seco.' },
  { id: 'fosforo', base: 'pixel', nome: 'Fósforo', descricao: 'Verde de osciloscópio com linhas de varredura.' },
  { id: 'mega', base: 'pixel', nome: 'Megaestrutura', descricao: 'Concreto sem fim, luz fria e sinais em ciano.' },
  { id: 'profundezas', base: 'pixel', nome: 'Profundezas', descricao: 'Mar escuro e a lanterna do barco.' },
  { id: 'unidade', base: 'pixel', nome: 'Unidade 01', descricao: 'Roxo e verde de máquina, laranja de alerta.' },
  { id: 'normal', base: 'normal', nome: 'Normal', descricao: 'Sem pixel art, claro ou escuro conforme o aparelho.' },
];

const PORID = new Map(TEMAS.map((t) => [t.id, t]));
export const temaExiste = (id) => PORID.has(id);
// Valor desconhecido (ou vazio) cai no normal, como antes: um erro de digitação no perfil não liga enfeites.
export const temaPorId = (id) => PORID.get(id) || PORID.get('normal');
