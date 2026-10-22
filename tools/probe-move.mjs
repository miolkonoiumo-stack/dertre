import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text()); });

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu.active', { timeout: 20000 });
await page.click('#btn-campaign');
await page.focus('body').catch(() => {});

// Track my avatar's tile + the safe mask over the whole round.
const log = [];
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(600);
  const s = await page.evaluate(() => {
    const g = window.__game;
    const game = g?.session?.game;
    if (!game) return null;
    const me = game.players.get(g.session.id);
    const av = g.avatars.get(g.session.id);
    return {
      phase: game.phase, round: game.round,
      myPos: me ? [+me.x.toFixed(2), +me.z.toFixed(2)] : null,
      myAlive: me?.alive,
      avPos: av ? [+av.root.position.x.toFixed(2), +av.root.position.z.toFixed(2)] : null,
      input: g.input?.axis ? g.input.axis() : null,
      alive: game.aliveCount(),
    };
  });
  log.push(s);
  console.log(i, JSON.stringify(s));
}

// Now hold a movement key and see if the avatar actually moves.
console.log('--- holding ArrowRight ---');
const before = await page.evaluate(() => {
  const g = window.__game; const me = g.session.game.players.get(g.session.id);
  return [+me.x.toFixed(2), +me.z.toFixed(2)];
});
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(1200);
const during = await page.evaluate(() => {
  const g = window.__game; const me = g.session.game.players.get(g.session.id);
  const av = g.avatars.get(g.session.id);
  return {
    sim: [+me.x.toFixed(2), +me.z.toFixed(2)],
    render: av ? [+av.root.position.x.toFixed(2), +av.root.position.z.toFixed(2)] : null,
  };
});
await page.keyboard.up('ArrowRight');
console.log('before:', JSON.stringify(before), 'during:', JSON.stringify(during));

await browser.close();
