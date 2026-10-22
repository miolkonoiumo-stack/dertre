import { chromium } from 'playwright';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 40; i++) {
  if ((await page.evaluate(() => window.__game?.ui?.current)) === 'menu') break;
  await sleep(400);
}

// Sample inside the page at 25ms: no round-trip latency hiding the first frame.
const samples = await page.evaluate(async () => {
  window.__game.startSolo();
  const out = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 22000) {
    const g = window.__game?.session?.game;
    if (g && g.phase === 'play') {
      out.push({
        round: g.round,
        left: Math.round(g.roundEndsAt - g.now),
        hud: document.querySelector('#timer-num')?.textContent ?? null,
      });
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return out;
});
await browser.close();

const firsts = [];
let last = -1;
for (const s of samples) {
  if (s.round !== last) { last = s.round; firsts.push(s); }
}
console.log('first PLAY sample of each round:');
for (const f of firsts) console.log(`  round ${f.round}: left=${f.left}ms HUD="${f.hud}"`);
const ok = firsts.length > 0 && firsts.every((f) => f.left >= 4700);
console.log('---');
console.log(ok ? 'RESULT: PASS — every round starts with ~5s on the clock' : 'RESULT: FAIL');
