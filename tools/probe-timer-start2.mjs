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

// Poll fast (every 40ms) and catch the first PLAY sample of each round.
const firsts = [];
let lastRound = -1;
for (let i = 0; i < 300; i++) {
  const s = await page.evaluate(() => {
    const g = window.__game?.session?.game;
    if (!g) return null;
    return {
      phase: g.phase, round: g.round,
      left: Math.round(g.roundEndsAt - g.now),
      now: Math.round(g.now),
      ends: Math.round(g.roundEndsAt),
      hud: document.querySelector('#timer')?.textContent ?? null,
    };
  });
  if (s && s.phase === 'play' && s.round !== lastRound) {
    lastRound = s.round;
    firsts.push(s);
    if (firsts.length >= 4) break;
  }
  await sleep(40);
}
for (const f of firsts) console.log(`round ${f.round}: left=${f.left}ms now=${f.now} ends=${f.ends} HUD="${f.hud}"`);
await browser.close();
const ok = firsts.length > 0 && firsts.every((f) => f.left >= 4600);
console.log('---');
console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
