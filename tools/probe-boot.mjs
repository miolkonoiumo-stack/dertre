// ¿Se ve de verdad la interfaz en el primer frame? Usa la API del navegador,
// no el estilo computado del elemento (que ignora si el padre está oculto).
import { chromium } from 'playwright';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.route('**/src/main.js*', async (route) => {
  await sleep(3000);
  await route.continue();
});
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await sleep(600);

const early = await page.evaluate(() => {
  const menu = document.getElementById('menu');
  const app = document.getElementById('app');
  const boot = document.getElementById('boot');
  // Lo que hay PINTADO en el centro: si la interfaz se viera, sería el menú.
  const atCenter = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  const inBoot = (el) => !!el && !!boot && boot.contains(el);
  return {
    // Este es el dato que importa: ¿lo visible es el loader o la interfaz?
    firstPaintIsLoader: inBoot(atCenter),
    centeredElement: atCenter ? (atCenter.id || atCenter.className || atCenter.tagName) : null,
    bootOnScreen: boot ? getComputedStyle(boot).display : null,
    // La UI está oculta porque #app lleva display:none hasta html.ready.
    appHidden: app ? getComputedStyle(app).display === 'none' : null,
    appOffsetParent: app ? (app.offsetParent === null ? 'oculto' : 'visible') : null,
    menuOffsetParent: menu ? (menu.offsetParent === null ? 'oculto' : 'visible') : null,
  };
});
console.log('── primer instante ──');
console.log(JSON.stringify(early, null, 2));

// Esperar a que arranque del todo.
for (let i = 0; i < 80; i++) {
  if (await page.evaluate(() => !document.getElementById('boot'))) break;
  await sleep(400);
}

const after = await page.evaluate(() => {
  const menu = document.getElementById('menu');
  const app = document.getElementById('app');
  const atCenter = document.elementFromPoint(innerWidth / 2, innerHeight * 0.62);
  return {
    htmlReady: document.documentElement.classList.contains('ready'),
    appDisplay: app ? getComputedStyle(app).display : null,
    menuOffsetParent: menu ? (menu.offsetParent === null ? 'oculto' : 'visible') : null,
    uiCurrent: window.__game?.ui?.current ?? null,
    bootGone: !document.getElementById('boot'),
    canvasSize: (() => { const c = document.getElementById('scene'); return c ? `${c.width}x${c.height}` : null; })(),
    centeredElement: atCenter ? (atCenter.id || atCenter.className || atCenter.tagName) : null,
  };
});
console.log('── tras cargar ──');
console.log(JSON.stringify(after, null, 2));
console.log('errors:', errors.length ? errors.slice(0, 4) : 'none');
await browser.close();
