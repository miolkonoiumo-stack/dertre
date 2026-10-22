import { chromium } from 'playwright';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 40; i++) {
  if ((await page.evaluate(() => window.__game?.ui?.current)) === 'menu') break;
  await sleep(400);
}
await page.evaluate(() => window.__game.startSolo());
await sleep(1200);
for (let i = 0; i < 200; i++) {
  const ok = await page.evaluate(() => !!(window.__game?.session?.game?.pending) && (window.__game?.arena?.pendingStrength || 0) > 0.5);
  if (ok) break;
  await sleep(100);
}
const out = await page.evaluate(() => {
  const app = window.__game;
  const g = app.session.game;
  const arr = app.arena.tiles.instanceColor.array;
  const rows = [];
  for (let i = 0; i < 144; i++) {
    const safe = g.safe[i] ? 'S' : '.';
    const pend = g.pending && g.pending[i] ? 'P' : '.';
    const r = arr[i * 3], gg = arr[i * 3 + 1], b = arr[i * 3 + 2];
    rows.push({ i, flags: safe + pend, r: +r.toFixed(2), g: +gg.toFixed(2), b: +b.toFixed(2) });
  }
  return rows;
});
// Group by (safe, pending) state and show the distinct colours seen.
const buckets = {};
for (const r of out) {
  const k = r.flags;
  if (!buckets[k]) buckets[k] = new Set();
  buckets[k].add(`r=${r.r} g=${r.g} b=${r.b}`);
}
for (const [k, v] of Object.entries(buckets)) {
  console.log(`state "${k}" (safe+pend) tiles=${[...v].length === 0 ? 0 : ''}`);
  console.log('   colours:', [...v].slice(0, 4).join('  |  '));
}
const safeCount = out.filter((r) => r.flags.startsWith('S')).length;
const pendCount = out.filter((r) => r.flags.endsWith('P')).length;
console.log('---');
console.log('safe tiles:', safeCount, '| pending tiles:', pendCount);
await browser.close();
