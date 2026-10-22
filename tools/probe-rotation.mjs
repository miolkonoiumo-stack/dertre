// Are the safe zones actually MOVING between rounds, or do they stay put?
// Compares zone centroids per round. A layout that keeps the same tiles lets an
// idle player win, which is exactly the complaint.
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

const rows = [];
let lastRound = -1;
for (let i = 0; i < 120; i++) {
  const s = await page.evaluate(() => {
    const game = window.__game?.session?.game;
    if (!game || game.phase !== 'play') return null;
    const mask = Array.from(game.safe || []);
    const G = Math.round(Math.sqrt(mask.length));
    const seen = new Uint8Array(mask.length);
    const zones = [];
    for (let k = 0; k < mask.length; k++) {
      if (!mask[k] || seen[k]) continue;
      const cells = []; const st = [k]; seen[k] = 1;
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
      let cx = 0, cz = 0;
      for (const c of cells) { cx += c % G; cz += (c / G) | 0; }
      zones.push({ x: +(cx / cells.length).toFixed(2), z: +(cz / cells.length).toFixed(2), n: cells.length });
    }
    return { round: game.round, alive: game.aliveCount(), zones, cells: mask.reduce((a, b) => a + b, 0) };
  });
  if (s && s.round !== lastRound) { rows.push(s); lastRound = s.round; }
  await sleep(600);
  if (rows.length >= 6) break;
}
await browser.close();

console.log('=== ZONE CENTROIDS PER ROUND ===');
let overlapScore = 0, pairs = 0;
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  console.log(`round ${r.round} alive=${r.alive} tiles=${r.cells} zones=` +
    r.zones.map((z) => `(${z.x},${z.z})x${z.n}`).join(' '));
}
// How much do zone positions move between consecutive rounds?
for (let i = 1; i < rows.length; i++) {
  const a = rows[i - 1].zones, b = rows[i].zones;
  // For each zone in b, distance to its nearest zone in a.
  let sum = 0;
  for (const zb of b) {
    let best = Infinity;
    for (const za of a) best = Math.min(best, Math.hypot(zb.x - za.x, zb.z - za.z));
    sum += best;
  }
  const avg = sum / b.length;
  pairs++;
  overlapScore += avg;
  console.log(`  round ${rows[i - 1].round}->${rows[i].round}: avg nearest-zone shift = ${avg.toFixed(2)} tiles`);
}
const avgShift = pairs ? overlapScore / pairs : 0;
console.log('---');
console.log('average zone displacement between rounds:', avgShift.toFixed(2), 'tiles');
// A 12x12 arena has a ~5 tile mean distance; under ~1.5 tiles means "stuck".
console.log(avgShift >= 2 ? 'RESULT: PASS (zones rotate)' : 'RESULT: FAIL (zones barely move)');
