// Verifies the three live rules the user reported as broken:
//  1. every round shows exactly (living - 1) safe zones
//  2. no zone is a single tile
//  3. a swap never leaves more zones than the rule allows
import { chromium } from 'playwright';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });

// Wait for boot -> menu
for (let i = 0; i < 30; i++) {
  const st = await page.evaluate(() => window.__game?.ui?.current);
  if (st === 'menu') break;
  await sleep(500);
}

// Start a solo match with bots.
await page.evaluate(() => {
  const g = window.__game;
  const diff = document.querySelector('#difficulty');
  if (diff) diff.value = 'intermediate';
  g.startSolo?.();
});
await sleep(1500);

const samples = [];
for (let i = 0; i < 70; i++) {
  const s = await page.evaluate(() => {
    const game = window.__game?.session?.game;
    if (!game) return null;
    const alive = typeof game.aliveCount === 'function' ? game.aliveCount() : null;
    const safeArr = Array.from(game.safe || []);
    // Count connected safe components directly from the mask.
    const G = Math.round(Math.sqrt(safeArr.length));
    const seen = new Uint8Array(safeArr.length);
    const sizes = [];
    for (let k = 0; k < safeArr.length; k++) {
      if (!safeArr[k] || seen[k]) continue;
      let n = 0;
      const stack = [k];
      seen[k] = 1;
      while (stack.length) {
        const c = stack.pop();
        n++;
        const x = c % G, z = (c / G) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nx >= G || nz < 0 || nz >= G) continue;
          const q = nz * G + nx;
          if (safeArr[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
      sizes.push(n);
    }
    return {
      phase: game.phase,
      round: game.round,
      alive,
      zones: sizes.length,
      minZone: sizes.length ? Math.min(...sizes) : 0,
      taken: window.__game?.arena?.takenZones ? [...window.__game.arena.takenZones] : null,
    };
  });
  if (s) samples.push(s);
  await sleep(1000);
}

await browser.close();

const plays = samples.filter((s) => s.phase === 'play' && s.alive > 1);
const wrong = plays.filter((s) => s.zones !== s.alive - 1);
const tiny = plays.filter((s) => s.minZone < 2);
const overSafe = plays.filter((s) => s.zones > s.alive - 1);

console.log('samples', samples.length, '| play-phase samples', plays.length);
console.log('rounds seen:', [...new Set(plays.map((s) => s.round))].join(','));
console.log('alive counts:', [...new Set(plays.map((s) => s.alive))].sort().join(','));
console.log('zone-count violations:', wrong.length);
console.log('  of which TOO MANY zones (the reported bug):', overSafe.length);
console.log('single-tile zones seen:', tiny.length);
console.log('sample rows:');
for (const s of plays.slice(0, 12)) {
  console.log(`  round ${s.round} ${s.phase} alive=${s.alive} zones=${s.zones} minZone=${s.minZone} taken=${JSON.stringify(s.taken)}`);
}
const ok = wrong.length === 0 && tiny.length === 0;
console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(ok ? 0 : 1);
