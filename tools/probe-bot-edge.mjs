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
await sleep(3000);

const out = await page.evaluate(async () => {
  const app = window.__game;
  const g = app.session.game;
  const snap1 = [...g.players.values()].filter((p) => p.isBot).map((p) => ({
    id: String(p.id).slice(4, 9), x: +p.x.toFixed(2), z: +p.z.toFixed(2), y: +p.y.toFixed(2), alive: p.alive,
    fellOff: !!p.fellOff, input: `${p.input.x},${p.input.z}`,
  }));
  await new Promise((r) => setTimeout(r, 4000));
  const g2 = app.session.game;
  const snap2 = [...g2.players.values()].filter((p) => p.isBot).map((p) => ({
    id: String(p.id).slice(4, 9), x: +p.x.toFixed(2), z: +p.z.toFixed(2), y: +p.y.toFixed(2), alive: p.alive,
    fellOff: !!p.fellOff, input: `${p.input.x},${p.input.z}`,
  }));
  return { snap1, snap2, phase: g2.phase, round: g2.round };
});
await browser.close();

console.log(`--- t0 (phase=${out.phase} round=${out.round}) ---`);
for (const b of out.snap1) console.log(`  ${b.id} pos=(${b.x},${b.z}) y=${b.y} alive=${b.alive} fellOff=${b.fellOff} in=${b.input}`);
console.log('--- t+4s ---');
for (const b of out.snap2) console.log(`  ${b.id} pos=(${b.x},${b.z}) y=${b.y} alive=${b.alive} fellOff=${b.fellOff} in=${b.input}`);

const edge = out.snap2.filter((b) => Math.abs(b.x) > 12.5 || Math.abs(b.z) > 12.5).length;
const fell = out.snap2.filter((b) => b.fellOff).length;
console.log('---');
console.log(`bots at/over the edge: ${edge}, fell off: ${fell}`);
