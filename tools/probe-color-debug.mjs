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
await sleep(1500);
const out = await page.evaluate(() => {
  const arena = window.__game.arena;
  const game = window.__game.session.game;
  // Read the module-level colours the arena actually holds.
  const info = {
    tileMatColor: [arena.tileMat.color.r, arena.tileMat.color.g, arena.tileMat.color.b],
    hasSafeMask: !!arena.safeMask,
    safeOnes: arena.safeMask ? arena.safeMask.reduce((a, b) => a + b, 0) : -1,
    allSafe: !!arena.allSafe,
    pendingStrength: arena.pendingStrength,
    rendererColorMgmt: window.__game.world?.renderer?.outputColorSpace,
    toneMapping: window.__game.world?.renderer?.toneMapping,
  };
  // Find one tile that is safe right now and report its computed instance colour.
  const arr = arena.tiles.instanceColor.array;
  const i = arena.safeMask.findIndex((v) => v === 1);
  info.sampleSafeIndex = i;
  info.sampleSafeRGB = i >= 0 ? [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]] : null;
  info.emissive = [arena.tileMat.emissive?.r, arena.tileMat.emissive?.g, arena.tileMat.emissive?.b];
  info.emissiveIntensity = arena.tileMat.emissiveIntensity;
  info.pendingTileRGB = (() => {
    if (!game.pending) return null;
    const j = game.pending.findIndex((v, k) => v === 1 && !arena.safeMask[k]);
    return j >= 0 ? [arr[j * 3], arr[j * 3 + 1], arr[j * 3 + 2]] : null;
  })();
  return info;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
