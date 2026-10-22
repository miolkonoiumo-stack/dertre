// Measures the LIVE client state (what the player actually sees), not the sim.
// Checks the two complaints:
//   1. zones == alive - 1 at every instant, including after deaths
//   2. safe zones MOVE between rounds (they must not repeat position)
import { chromium } from 'playwright';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 40; i++) {
  const st = await page.evaluate(() => window.__game?.ui?.current);
  if (st === 'menu') break;
  await sleep(500);
}
await page.evaluate(() => window.__game.startSolo());
await sleep(1200);

// Track per-round the exact safe mask that the client renders.
const rows = [];
let lastRound = -1;
let lastKey = null;
for (let i = 0; i < 90; i++) {
  const s = await page.evaluate(() => {
    const app = window.__game;
    const game = app?.session?.game;
    if (!game) return null;
    const mask = Array.from(game.safe || []);
    const G = Math.round(Math.sqrt(mask.length));
    const seen = new Uint8Array(mask.length);
    const zones = [];
    for (let k = 0; k < mask.length; k++) {
      if (!mask[k] || seen[k]) continue;
      const cells = [];
      const st = [k]; seen[k] = 1;
      while (st.length) {
        const c = st.pop(); cells.push(c);
        const x = c % G, z = (c / G) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nx >= G || nz < 0 || nz >= G) continue;
          const q = nz * G + nx;
          if (mask[q] && !seen[q]) { seen[q] = 1; st.push(q); }
        }
      }
      zones.push(cells.length);
    }
    // Render mask: what the arena was told to draw.
    const renderMask = app.arena?.safeMask ? Array.from(app.arena.safeMask) : null;
    return {
      phase: game.phase,
      round: game.round,
      alive: game.aliveCount(),
      zones: zones.length,
      sizes: zones.sort((a, b) => a - b),
      safeCount: mask.reduce((a, b) => a + b, 0),
      mask,
      renderCount: renderMask ? renderMask.reduce((a, b) => a + b, 0) : null,
      renderSame: renderMask ? renderMask.every((v, i) => (v ? 1 : 0) === (mask[i] ? 1 : 0)) : null,
    };
  });
  if (s) {
    if (s.phase === 'play' && s.round !== lastRound) {
      rows.push(s);
      lastRound = s.round;
    }
    if (s.phase === 'play') {
      const key = `${s.round}:${s.safeCount}`;
      if (key !== lastKey) lastKey = key;
    }
  }
  await sleep(700);
}
await browser.close();

console.log('=== ROUND BY ROUND (live client) ===');
let viol = 0, repeat = 0;
const prevMasks = [];
for (const r of rows) {
  const need = Math.max(1, r.alive - 1);
  const bad = r.zones !== need;
  if (bad) viol++;
  let sameAsBefore = false;
  for (const pm of prevMasks) {
    if (pm.length === r.mask.length && pm.every((v, i) => v === r.mask[i])) sameAsBefore = true;
  }
  if (sameAsBefore) repeat++;
  prevMasks.push(r.mask);
  console.log(
    `round ${r.round} alive=${r.alive} zones=${r.zones} need=${need} ${bad ? '<<< VIOLATION' : 'ok'}` +
    ` tiles=${r.safeCount} sizes=[${r.sizes}] renderSame=${r.renderSame} ${sameAsBefore ? '<<< REPEATED LAYOUT' : ''}`,
  );
}
console.log('---');
console.log('zone-count violations:', viol, '/', rows.length, 'rounds');
console.log('repeated layouts:', repeat, '/', rows.length, 'rounds');
console.log(viol === 0 && repeat === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');
