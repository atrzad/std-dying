// Uma vez só, na união: traz as preferências do Caderno (painéis abertos, última nota, modo) do banco do antigo
// Ayo Sketchbook para o banco do std(dying). Não altera nem apaga o banco antigo; rodar de novo não duplica nada.
// Uso: npm run importar-sketchbook [-- ~/.local/share/ayo-sketchbook/sketchbook.sqlite]
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db, lerAjuste, gravarAjuste } from '../db.js';

const arquivo = path.resolve((process.argv[2] || '~/.local/share/ayo-sketchbook/sketchbook.sqlite').replace(/^~(?=$|\/)/, os.homedir()));
if (!fs.existsSync(arquivo)) {
  console.log(`Banco do Sketchbook não encontrado em ${arquivo}: nada a importar.`);
  process.exit(0);
}

const antigo = new DatabaseSync(arquivo, { readOnly: true });
const contas = new Set(db.prepare('SELECT id FROM usuarios').all().map((u) => u.id));
let importadas = 0;
for (const { usuario_id: id, valor } of antigo.prepare('SELECT usuario_id, valor FROM preferencias').all()) {
  if (!contas.has(id)) continue;
  let prefs;
  try { prefs = JSON.parse(valor); } catch { continue; }
  // o que a pessoa já mudou no std(dying) vale mais que o que veio do Sketchbook
  gravarAjuste(`caderno:${id}`, { ...prefs, ...(lerAjuste(`caderno:${id}`, {}) || {}) });
  importadas++;
}
antigo.close();
db.close();
console.log(`Preferências do Caderno importadas: ${importadas} ${importadas === 1 ? 'conta' : 'contas'}.`);
