// Visual verification: boot the game, enter a match, and sample the actual
// rendered colours + geometry so the redesign can be checked numerically
// (I cannot look at screenshots).
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

const boot = await page.evaluate(() => ({
  ui: window.__game?.ui?.current,
  hasArena: !!window.__game?.arena,
  hasWorld: !!window.__game?.world,
}));
console.log('boot:', JSON.stringify(boot));

await page.evaluate(() => window.__game.startSolo());
// Wait for an actual LIVE round (safe zones visible), not the opening deck.
for (let i = 0; i < 60; i++) {
  const st = await page.evaluate(() => ({
    phase: window.__game?.session?.game?.phase,
    round: window.__game?.session?.game?.round,
  }));
  if (st.phase === 'play' && st.round >= 1) { console.log('live round:', JSON.stringify(st)); break; }
  await sleep(400);
}
await sleep(1200);   // let the arena lerp into its round colours

const report = await page.evaluate(() => {
  const g = window.__game;
  const arena = g.arena;
  const out = { tiles: {}, caps: {}, avatar: {} };

  // Sample the instanced colours of the plate mesh.
  const tc = arena.tiles.instanceColor.array;
  const cc = arena.tileCaps.instanceColor.array;
  let safeG = 0, lavaR = 0, maxG = 0, maxR = 0;
  for (let i = 0; i < 144; i++) {
    const r = tc[i * 3], gg = tc[i * 3 + 1], b = tc[i * 3 + 2];
    maxG = Math.max(maxG, gg); maxR = Math.max(maxR, r);
    if (gg > r * 1.25 && gg > 0.35) safeG++;
    if (r > 0.45 && gg < 0.35) lavaR++;
    if (i < 3) {
      out.tiles[i] = [+r.toFixed(2), +gg.toFixed(2), +b.toFixed(2)];
      out.caps[i] = [+cc[i * 3].toFixed(2), +cc[i * 3 + 1].toFixed(2), +cc[i * 3 + 2].toFixed(2)];
    }
  }
  out.safeTilesGreen = safeG;
  out.lavaTilesRed = lavaR;
  out.maxGreen = +maxG.toFixed(2);
  out.maxRed = +maxR.toFixed(2);

  // Avatar structure: count meshes and check the face + headgear exist.
  let av = null;
  if (g.avatars) {
    const first = g.avatars.values ? [...g.avatars.values()][0] : g.avatars[0];
    av = first;
  }
  if (av && av.root) {
    let meshes = 0;
    av.root.traverse((o) => { if (o.isMesh) meshes++; });
    out.avatar = {
      meshes,
      headgear: av.headgearKind,
      eyes: av.eyes?.length ?? 0,
      pupils: av.pupils?.length ?? 0,
      hasBlob: !!av.blob,
      hasRing: !!av.ring,
      headY: av.head?.position.y,
      height: (() => {
        const box = new (window.THREE_BOX || Object)();
        return null;
      })(),
    };
  }
  return out;
});

console.log(JSON.stringify(report, null, 2));
console.log('errors:', errors.length ? errors.slice(0, 6) : 'none');

await browser.close();
