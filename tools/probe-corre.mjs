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
// Wait until we are 4s into round 1 (well past the CORRE flash).
await sleep(12000);

const out = await page.evaluate(() => {
  const cd = document.getElementById('countdown');
  const msg = document.getElementById('center-msg');
  const cs = cd ? getComputedStyle(cd) : null;
  const ms = msg ? getComputedStyle(msg) : null;
  return {
    phase: window.__game.session?.game?.phase,
    countdown: cd ? { hidden: cd.hidden, display: cs.display, opacity: cs.opacity, text: cd.textContent.trim(), z: cs.zIndex } : null,
    centerMsg: msg ? { text: msg.textContent.trim(), opacity: ms.opacity, display: ms.display, cls: msg.className, fontSize: ms.fontSize } : null,
  };
});
await browser.close();
console.log(JSON.stringify(out, null, 2));
