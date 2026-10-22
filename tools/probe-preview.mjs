// Is the upcoming safe layout VISIBLE to the player before the swap?
// The complaint: "las zonas seguras deben verse antes de que estallen".
// Measures, during the warning window, how many tiles are drawn cyan (preview)
// and how long that window lasts in real milliseconds.
import { chromium } from 'playwright';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 40; i++) {
  if ((await page.evaluate(() => window.__game?.ui?.current)) === 'menu') break;
  await sleep(500);
}
await page.evaluate(() => window.__game.startSolo());
await sleep(1000);

// Read the actual rendered instance colours and classify them.
const sample = () => page.evaluate(() => {
  const app = window.__game;
  const arena = app?.arena;
  const game = app?.session?.game;
  if (!arena?.tiles?.instanceColor) return null;
  const arr = arena.tiles.instanceColor.array;
  let cyan = 0, amber = 0, green = 0, red = 0, magenta = 0;
  for (let i = 0; i < arr.length; i += 3) {
    const r = arr[i], g = arr[i + 1], b = arr[i + 2];
    // cyan preview: low red, high green+blue
    if (r < 0.45 && g > 0.45 && b > 0.45) cyan++;
    else if (r > 0.45 && g > 0.25 && b < 0.35) amber++;
    else if (r < 0.45 && g > 0.35 && b < 0.45) green++;
    else if (r > 0.6 && g < 0.35 && b > 0.3) magenta++;
    else if (r > 0.45) red++;
  }
  return {
    cyan, amber, green, red, magenta,
    pending: game?.pending ? game.pending.reduce((a, b) => a + b, 0) : 0,
    phase: game?.phase,
    round: game?.round,
    warn: app?._warnAmount ? app._warnAmount() : null,
  };
});

const rows = [];
for (let i = 0; i < 100; i++) {
  const s = await sample();
  if (s) rows.push({ t: Date.now(), ...s });
  await sleep(120);
}
await browser.close();

// Find stretches where cyan > 0 (preview visible).
let best = 0, cur = 0, curStart = 0, bestStart = 0;
for (const r of rows) {
  if (r.cyan > 0) {
    if (cur === 0) curStart = r.t;
    cur = r.t - curStart;
    if (cur > best) { best = cur; bestStart = curStart; }
  } else cur = 0;
}
// Count, per round, how long the FULL pending set is visible at once.
const byRound = new Map();
for (const r of rows) {
  if (!byRound.has(r.round)) byRound.set(r.round, []);
  byRound.get(r.round).push(r);
}
let okRounds = 0, totalRounds = 0;
for (const [round, list] of byRound) {
  if (list.length < 2) continue;
  totalRounds++;
  const pendingCount = Math.max(...list.map((x) => x.pending || 0));
  const full = list.filter((x) => (x.cyan + x.magenta) >= pendingCount && pendingCount > 0).length;
  console.log(`round ${round}: pending=${pendingCount} visibleSamples=${full}/${list.length} (~${full * 200}ms)`);
  if (full * 120 >= 700) okRounds++;
}
console.log('---');
console.log('rounds with a readable preview:', okRounds, '/', totalRounds);
console.log(okRounds === totalRounds && totalRounds > 0
  ? 'RESULT: PASS (upcoming zones visible before the swap)'
  : 'RESULT: FAIL (preview not visible long enough)');
