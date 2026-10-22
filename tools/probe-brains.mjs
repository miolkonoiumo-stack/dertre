import { chromium } from 'playwright';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 40; i++) {
  if ((await page.evaluate(() => window.__game?.ui?.current)) === 'menu') break;
  await sleep(400);
}
await page.evaluate(() => window.__game.startSolo());
await sleep(3500);

const out = await page.evaluate(() => {
  const app = window.__game;
  const s = app.session;
  const g = s.game;
  const bots = [...g.players.values()].filter((p) => p.isBot);
  return {
    sessionType: s.constructor?.name,
    hasBrains: !!s.brains,
    brainsSize: s.brains?.size ?? -1,
    botCount: bots.length,
    brainIds: s.brains ? [...s.brains.keys()].map((k) => String(k).slice(4, 9)) : [],
    botIds: bots.map((b) => String(b.id).slice(4, 9)),
    anyTarget: s.brains ? [...s.brains.values()].map((b) => (b.target ? `${b.target.x?.toFixed?.(1)}` : 'null')) : [],
    lastThink: s.brains ? [...s.brains.values()].map((b) => b.nextThink) : [],
    now: Math.round(g.now),
    inputs: bots.map((b) => `${b.input.x.toFixed(2)},${b.input.z.toFixed(2)}`),
    phases: g.phase,
  };
});
await browser.close();
console.log(JSON.stringify(out, null, 2));
