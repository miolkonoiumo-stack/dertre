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

// Sample the countdown every 250ms for the whole countdown, then through round 1
// and the transition to round 2.
const samples = await page.evaluate(async () => {
  const out = [];
  const t0 = performance.now();
  let lastRound = -1;
  while (performance.now() - t0 < 22000) {
    const g = window.__game.session?.game;
    if (g) {
      const el = document.getElementById('countdown');
      const cs = el ? getComputedStyle(el) : null;
      const visible = cs && cs.display !== 'none';
      if (g.round !== lastRound) lastRound = g.round;
      out.push({
        t: Math.round(performance.now() - t0),
        round: g.round,
        phase: g.phase,
        cdVisible: !!visible,
        cdText: el ? el.textContent.trim() : '',
      });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
});
await browser.close();

// Report: when was the overlay visible, grouped.
let prev = null;
for (const s of samples) {
  const key = `${s.phase}|${s.cdVisible}|${s.cdText}`;
  if (key !== prev) {
    console.log(`t=${s.t}ms round=${s.round} phase=${s.phase} overlay=${s.cdVisible ? 'VISIBLE "' + s.cdText + '"' : 'hidden'}`);
    prev = key;
  }
}
const leaks = samples.filter((s) => s.phase === 'play' && s.round >= 2 && s.cdVisible);
console.log(`\nround>=2 play ticks with overlay visible: ${leaks.length} (must be 0)`);
