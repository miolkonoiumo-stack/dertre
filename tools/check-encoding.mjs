import fs from 'node:fs';

const s = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sample = s.match(/Partida r.pida[^<]*/);
console.log('sample     :', JSON.stringify(sample ? sample[0] : 'n/a'));
console.log('charset    :', /charset=["']?utf-8/i.test(s));
console.log('mojibake   :', s.includes('\u00c3') || s.includes('\u00e2\u20ac'));
console.log('has-acentos:', s.includes('r\u00e1pida'), s.includes('MEN\u00da'), s.includes('C\u00f3mo'));
