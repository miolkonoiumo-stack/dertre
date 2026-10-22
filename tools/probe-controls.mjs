import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu.active', { timeout: 30000 });

// --- difficulty picker ---
const pills = await page.evaluate(() => {
  const p = document.getElementById('difficulty-picker');
  return p ? [...p.querySelectorAll('.diff-opt')].map((b) => b.dataset.diff) : null;
});
console.log('pills:', JSON.stringify(pills));

await page.click('.diff-opt[data-diff="expert"]');
await page.waitForTimeout(200);
const afterClick = await page.evaluate(() => ({
  select: document.getElementById('difficulty')?.value,
  on: [...document.querySelectorAll('.diff-opt.is-on')].map((b) => b.dataset.diff),
  stored: localStorage.getItem('tfil_diff'),
}));
console.log('after clicking Experto:', JSON.stringify(afterClick));

await page.click('.diff-opt[data-diff="tutorial"]');
await page.waitForTimeout(200);
console.log('after clicking Tutorial:', JSON.stringify(await page.evaluate(() => ({
  select: document.getElementById('difficulty')?.value,
  on: [...document.querySelectorAll('.diff-opt.is-on')].map((b) => b.dataset.diff),
}))));

// --- movement direction ---
await page.click('.diff-opt[data-diff="intermediate"]');
await page.click('#btn-campaign');
await page.waitForTimeout(6000);

const read = () => page.evaluate(() => {
  const g = window.__game;
  const me = g?.session?.me;
  return {
    phase: g?.session?.game?.phase,
    x: me ? +me.x.toFixed(2) : null,
    z: me ? +me.z.toFixed(2) : null,
    yaw: g?.rig ? +g.rig.yaw.toFixed(2) : null,
  };
});

const before = await read();
console.log('before W:', JSON.stringify(before));

// Hold W (forward). The camera sits behind at +(sin yaw, cos yaw); pressing W
// must move the player AWAY from the camera, i.e. toward -(sin yaw, cos yaw).
await page.evaluate(() => {
  const ev = (type, code) =>
    document.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
  ev('keydown', 'KeyW');
  window.__wHeld = true;
});
await page.waitForTimeout(1200);
const during = await read();
await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'KeyW', bubbles: true })));
console.log('after W: ', JSON.stringify(during));

const dx = during.x - before.x;
const dz = during.z - before.z;
const yaw = before.yaw ?? 0;
// Expected forward direction (away from camera)
const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
const dot = dx * fx + dz * fz;
const dist = Math.hypot(dx, dz);
console.log(`moved dx=${dx.toFixed(2)} dz=${dz.toFixed(2)} dist=${dist.toFixed(2)}`);
console.log(`dot(actual, forward)=${dot.toFixed(2)}  => ${dot > 0 ? 'FORWARD (correct)' : 'BACKWARD (inverted!)'}`);

await browser.close();
