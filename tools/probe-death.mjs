// Verifica el panel de muerte: aparece al morir, ofrece los dos botones y
// ambos funcionan (seguir mirando / menú).
import { chromium } from 'playwright';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 70; i++) {
  if (await page.evaluate(() => !document.getElementById('boot'))) break;
  await sleep(300);
}
await sleep(400);

// Empezar partida contra la IA.
await page.evaluate(() => window.__game.startSolo());

// Esperar a que el jugador humano esté dentro de una ronda jugable.
for (let i = 0; i < 40; i++) {
  const st = await page.evaluate(() => {
    const g = window.__game.session?.game;
    return g ? { phase: g.phase, round: g.round } : null;
  });
  if (st?.phase === 'play' && st.round >= 1) break;
  await sleep(400);
}

// Provocar la muerte del jugador local, como haría el servidor.
const killed = await page.evaluate(() => {
  const g = window.__game;
  const me = g._myId();
  g._eliminate(me, true);
  return { me, mode: g.mode };
});
console.log('eliminado:', JSON.stringify(killed));
await sleep(500);

const panel = await page.evaluate(() => {
  const el = document.getElementById('death-panel');
  const keep = document.getElementById('btn-spectate');
  const menu = document.getElementById('btn-death-menu');
  const r = (b) => { const x = b.getBoundingClientRect(); return { w: Math.round(x.width), h: Math.round(x.height), visible: x.width > 0 }; };
  return {
    present: !!el,
    visible: el ? !el.hidden && getComputedStyle(el).display !== 'none' : false,
    subText: document.getElementById('death-sub')?.textContent ?? null,
    keepLabel: keep?.textContent ?? null,
    menuLabel: menu?.textContent ?? null,
    keepBox: keep ? r(keep) : null,
    menuBox: menu ? r(menu) : null,
    spectatorBadge: !document.getElementById('spectator-badge')?.hidden,
    matchStillRunning: !!window.__game.matchOver === false,
  };
});
console.log('panel:', JSON.stringify(panel, null, 2));

// ── Botón 1: SEGUIR MIRANDO ──────────────────────────────────────────────
await page.click('#btn-spectate');
await sleep(350);
const afterKeep = await page.evaluate(() => ({
  panelHidden: document.getElementById('death-panel').hidden,
  screen: window.__game.ui.current,
  badge: !document.getElementById('spectator-badge').hidden,
  hudHidden: document.getElementById('hud').hidden,
}));
console.log('\ntras SEGUIR MIRANDO:', JSON.stringify(afterKeep));

// ── Botón 2: MENÚ ────────────────────────────────────────────────────────
// Se vuelve a abrir el panel para probar el segundo botón.
await page.evaluate(() => window.__game.ui.deathPanel(true, { text: 'prueba' }));
await sleep(250);
await page.click('#btn-death-menu');
await sleep(600);
const afterMenu = await page.evaluate(() => ({
  panelHidden: document.getElementById('death-panel').hidden,
  screen: window.__game.ui.current,
  mode: window.__game.mode,
  hudHidden: document.getElementById('hud').hidden,
  badge: !document.getElementById('spectator-badge').hidden,
}));
console.log('tras MENÚ:', JSON.stringify(afterMenu));

console.log('\nerrors:', errors.length ? errors.slice(0, 4) : 'none');
await page.screenshot({ path: 'tools/shot-death.png' });
await browser.close();
