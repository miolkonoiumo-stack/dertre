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
await sleep(3200);

const out = await page.evaluate(() => {
  const app = window.__game;
  const g = app.session.game;
  const arena = app.arena;
  const arr = arena.tiles.instanceColor.array;
  const GRID = 12;
  const rows = [];
  for (let z = 0; z < GRID; z++) {
    let row = '';
    for (let x = 0; x < GRID; x++) {
      const i = z * GRID + x;
      const r = arr[i * 3], gg = arr[i * 3 + 1], b = arr[i * 3 + 2];
      const safe = g.safe[i] === 1;
      if (safe) row += (r < 0.4 && gg > 0.5 && b < 0.4) ? 'G' : '?';
      else row += (r > 0.3 && gg < 0.45 && b < 0.3) ? '.' : 'o';
    }
    rows.push(row);
  }
  // also report plain safe mask
  const maskRows = [];
  for (let z = 0; z < GRID; z++) {
    let row = '';
    for (let x = 0; x < GRID; x++) row += g.safe[z * GRID + x] ? 'X' : '.';
    maskRows.push(row);
  }
  return { colourMap: rows, maskRows, phase: g.phase, round: g.round };
});
await browser.close();
console.log('SAFE MASK (X = safe):');
out.maskRows.forEach((r, i) => console.log(`  ${String(i).padStart(2)} ${r}`));
console.log('\nRENDERED (G = green/drawn safe, ? = safe but NOT green, . = lava, o = other):');
out.colourMap.forEach((r, i) => console.log(`  ${String(i).padStart(2)} ${r}`));
const mismatch = out.colourMap.join('').split('').filter((c) => c === '?').length;
console.log(`\n---\nphase=${out.phase} round=${out.round}`);
console.log(`safe tiles drawn wrong: ${mismatch}`);
