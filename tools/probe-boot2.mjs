// Verifica el ciclo completo del loader: arranque oculto, barra que avanza,
// 100% real y retirada del DOM sin dejar capas.
import { chromium } from 'playwright';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });

// Muestrear el estado de la barra hasta que el loader desaparezca.
const samples = [];
for (let i = 0; i < 60; i++) {
  const s = await page.evaluate(() => {
    const boot = document.getElementById('boot');
    const fill = document.getElementById('boot-fill');
    return {
      gone: !boot,
      width: fill?.style.width ?? null,
      pct: document.getElementById('boot-pct')?.textContent ?? null,
      step: document.getElementById('boot-step')?.textContent ?? null,
      done: boot?.classList.contains('is-done') ?? null,
    };
  });
  samples.push(s);
  if (s.gone) break;
  await sleep(250);
}

// Resumen: progreso monótono, llegó al 100%, y el nodo se retiró.
const widths = samples.map((s) => parseInt(s.width || '0', 10));
let monotonic = true;
for (let i = 1; i < widths.length; i++) if (widths[i] < widths[i - 1]) monotonic = false;

const reached100 = samples.some((s) => parseInt(s.width || '0', 10) === 100);
const removed = samples[samples.length - 1].gone;

const final = await page.evaluate(() => {
  const app = document.getElementById('app');
  const menu = document.getElementById('menu');
  const atCenter = document.elementFromPoint(innerWidth / 2, innerHeight * 0.62);
  return {
    bootInDom: !!document.getElementById('boot'),
    appDisplay: getComputedStyle(app).display,
    menuVisible: menu.offsetParent !== null,
    uiCurrent: window.__game?.ui?.current ?? null,
    centered: atCenter ? (atCenter.id || atCenter.className || atCenter.tagName) : null,
    // Nada debe interceptar clics por encima del menú.
    playClickable: !!document.getElementById('btn-campaign'),
  };
});

console.log('muestras:', samples.length);
console.log('progreso monótono:', monotonic);
console.log('llegó al 100%:', reached100);
console.log('nodo retirado:', removed);
console.log('pasos vistos:', [...new Set(samples.map((s) => s.step).filter(Boolean))]);
console.log('anchos:', widths.join(' '));
console.log('\nfinal:', JSON.stringify(final, null, 2));
console.log('errors:', errors.length ? errors.slice(0, 4) : 'none');
await browser.close();
