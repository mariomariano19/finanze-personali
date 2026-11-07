// Copia la build (dist/) in docs/ per GitHub Pages, senza toccare docs/intel (dati cifrati del motore).
import fs from 'node:fs';
import path from 'node:path';
const docs = 'docs';
fs.mkdirSync(docs, { recursive: true });
for (const entry of fs.readdirSync(docs)) if (entry !== 'intel') fs.rmSync(path.join(docs, entry), { recursive: true, force: true });
fs.cpSync('dist', docs, { recursive: true });
fs.writeFileSync(path.join(docs, '.nojekyll'), '');
console.log('docs/ aggiornata');
