// Check that every player in a match gets a distinct character silhouette.
import { chromium } from 'playwright';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 45; i++) {
  if ((await page.evaluate(() => window.__game?.ui?.current)) === 'menu') break;
  await sleep(400);
}
await page.evaluate(() => window.__game.startSolo());
for (let i = 0; i < 60; i++) {
  const ph = await page.evaluate(() => window.__game?.session?.game?.phase);
  if (ph === 'play') break;
  await sleep(400);
}

const out = await page.evaluate(() => {
  const g = window.__game;
  const rows = [];
  for (const [id, av] of g.avatars) {
    let meshes = 0;
    av.root.traverse((o) => { if (o.isMesh) meshes++; });
    rows.push({
      id: String(id).slice(0, 8),
      colorIndex: av.colorIndex,
      head: av.headgearKind,
      meshes,
    });
  }
  return rows;
});

console.log('jugadores:', out.length);
for (const r of out) console.log(` ${r.id}  color=${r.colorIndex}  cabeza=${r.head.padEnd(9)} mallas=${r.meshes}`);
const heads = new Set(out.map((r) => r.head));
const pairs = new Set(out.map((r) => `${r.colorIndex}|${r.head}`));
console.log(`cabezas distintas: ${heads.size}/${out.length}`);
console.log(`combinaciones color+cabeza distintas: ${pairs.size}/${out.length}`);
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
