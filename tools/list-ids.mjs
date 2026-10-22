import fs from 'node:fs';
const s = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ids = [...s.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
console.log('screen- ids :', ids.filter((i) => i.startsWith('screen-')).join(', '));
console.log('plain loader:', ids.includes('loader'));
console.log('plain menu  :', ids.includes('menu'));
