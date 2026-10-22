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

// Wait until the preview is up, then dump the exact RGB of the pending tiles.
for (let i = 0; i < 200; i++) {
  const ok = await page.evaluate(() => !!(window.__game?.session?.game?.pending) && (window.__game?.arena?.pendingStrength || 0) > 0.5);
  if (ok) break;
  await sleep(100);
}
const out = await page.evaluate(() => {
  const app = window.__game;
  const g = app.session.game;
  const arena = app.arena;
  const arr = arena.tiles.instanceColor.array;
  const pend = g.pending;
  const safe = g.safe;
  const pendRGB = [], safeRGB = [], lavaRGB = [];
  for (let i = 0; i < 144; i++) {
    const r = +arr[i * 3].toFixed(2), gg = +arr[i * 3 + 1].toFixed(2), b = +arr[i * 3 + 2].toFixed(2);
    if (pend && pend[i] && !safe[i]) pendRGB.push([i, r, gg, b]);
    else if (safe[i]) safeRGB.push([i, r, gg, b]);
    else lavaRGB.push([i, r, gg, b]);
  }
  return {
    strength: arena.pendingStrength,
    taken: [...(arena.takenZones || [])],
    pendCount: pendRGB.length,
    pendRGB: pendRGB.slice(0, 6),
    safeRGB: safeRGB.slice(0, 3),
    lavaRGB: lavaRGB.slice(0, 3),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
