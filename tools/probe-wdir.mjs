import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu.active', { timeout: 30000 });
await page.click('#btn-campaign');

// Poll tightly while holding W so a teleport/respawn cannot be mistaken for motion.
await page.waitForTimeout(5000);
await page.evaluate(() => {
  const g = window.__game;
  g.__trace = [];
  const me = g.session.me;
  // Record raw sim position every frame from the game loop.
  const orig = g._frame?.bind(g);
  window.__meRef = me;
});

await page.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'KeyW', bubbles: true }));
});

const samples = [];
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(100);
  const s = await page.evaluate(() => {
    const me = window.__meRef;
    return me ? { x: +me.x.toFixed(2), z: +me.z.toFixed(2), vx: +(me.vx ?? 0).toFixed(2), vz: +(me.vz ?? 0).toFixed(2), alive: me.alive } : null;
  });
  samples.push(s);
}
await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'KeyW', bubbles: true })));

const yaw = await page.evaluate(() => window.__game.rig.yaw);
const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
console.log('yaw', yaw.toFixed(2), 'forward', fx.toFixed(2), fz.toFixed(2));
console.log('samples:');
for (const s of samples) console.log('  ', JSON.stringify(s));

const first = samples.filter(Boolean)[0];
const last = samples.filter(Boolean).at(-1);
if (first && last) {
  const dx = last.x - first.x, dz = last.z - first.z;
  const dot = dx * fx + dz * fz;
  console.log(`net dx=${dx.toFixed(2)} dz=${dz.toFixed(2)} dot=${dot.toFixed(2)} => ${dot > 0 ? 'FORWARD ok' : 'BACKWARD bad'}`);
}
// velocity check is the honest one: it is the command, not the delta
const mid = samples.filter(Boolean)[3];
if (mid) {
  const vdot = mid.vx * fx + mid.vz * fz;
  console.log(`velocity vx=${mid.vx} vz=${mid.vz} dot=${vdot.toFixed(2)} => ${vdot > 0 ? 'commanding FORWARD ok' : 'commanding BACKWARD bad'}`);
}

await browser.close();
