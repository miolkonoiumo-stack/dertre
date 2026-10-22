// Measure, in the real browser, the exact window where `pending` is set and
// where the arena is actually told to draw it (pendingStrength > 0).
import { chromium } from 'playwright';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 40; i++) {
  if ((await page.evaluate(() => window.__game?.ui?.current)) === 'menu') break;
  await sleep(400);
}
await page.evaluate(() => window.__game.startSolo());
await sleep(1500);

const t0 = Date.now();
const rows = [];
for (let i = 0; i < 160; i++) {
  const r = await page.evaluate(() => {
    const app = window.__game;
    const g = app?.session?.game;
    if (!g) return null;
    return {
      phase: g.phase,
      round: g.round,
      hasPending: !!g.pending,
      pendTiles: g.pending ? g.pending.reduce((a, b) => a + b, 0) : 0,
      strength: app.arena.pendingStrength || 0,
      arenaPending: !!app.arena.pendingMask,
      left: Math.round(g.roundEndsAt - g.now),
      now: Math.round(g.now),
      roundEndsAt: Math.round(g.roundEndsAt),
    };
  });
  if (r) rows.push({ t: Date.now() - t0, ...r });
  await sleep(80);
}
await browser.close();

let prev = null;
for (const r of rows) {
  const key = `${r.phase}/${r.round}/${r.hasPending}/${r.strength > 0}`;
  const pkey = prev ? `${prev.phase}/${prev.round}/${prev.hasPending}/${prev.strength > 0}` : null;
  if (key !== pkey) {
    console.log(`t=${r.t}ms phase=${r.phase} round=${r.round} pending=${r.hasPending}(${r.pendTiles}) strength=${r.strength.toFixed(2)} left=${r.left}ms`);
  }
  prev = r;
}
const withPending = rows.filter((r) => r.hasPending);
const drawn = rows.filter((r) => r.strength > 0.01);
console.log('---');
console.log('samples', rows.length, '| game.pending set:', withPending.length, '| arena drawing it:', drawn.length);
if (withPending.length) {
  const gaps = withPending.filter((r) => r.strength <= 0.01);
  console.log('samples where pending exists but arena strength is 0:', gaps.length);
  if (gaps.length) console.log('  example:', JSON.stringify(gaps[0]));
}
