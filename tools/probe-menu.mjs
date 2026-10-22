// Revisa la pantalla de menú: calcula estilos clave y busca textos en inglés
// que hayan quedado sin traducir.
import { chromium } from 'playwright';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) {
  if (await page.evaluate(() => !document.getElementById('boot'))) break;
  await sleep(300);
}
await sleep(600);

const look = await page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      radius: s.borderTopLeftRadius,
      bg: s.backgroundImage.includes('gradient') ? 'gradient' : s.backgroundColor,
      shadow: s.boxShadow !== 'none',
      font: s.fontFamily.split(',')[0].replace(/"/g, ''),
      size: s.fontSize,
    };
  };

  // Recoge textos visibles de la pantalla de menú.
  const texts = [];
  const walk = (n) => {
    if (n.nodeType === 3) {
      const t = n.textContent.trim();
      if (t) texts.push(t);
      return;
    }
    if (n.nodeType !== 1) return;
    const s = getComputedStyle(n);
    if (s.display === 'none' || s.visibility === 'hidden') return;
    for (const c of n.childNodes) walk(c);
  };
  const menu = document.getElementById('menu');
  if (menu) walk(menu);

  return {
    title: document.querySelector('.brand h1')?.innerText ?? null,
    tagline: document.querySelector('.tagline')?.textContent ?? null,
    play: box('#btn-campaign'),
    quick: box('#btn-quick'),
    rooms: box('#btn-rooms'),
    panel: box('.panel-main'),
    side: box('.panel-side'),
    swatchCount: document.querySelectorAll('#color-picker .swatch, #color-picker > *').length,
    diffOptions: [...document.querySelectorAll('.diff-opt')].map((b) => b.textContent.trim()),
    diffOn: document.querySelector('.diff-opt.is-on')?.textContent.trim() ?? null,
    allText: texts,
  };
});

// Palabras inglesas típicas que delatarían un texto sin traducir.
const suspicious = look.allText.filter((t) =>
  /\b(PLAY|SETTINGS|QUICK|ROOMS|JOIN|CREATE|BACK|RESUME|QUIT|READY|START|HOW TO|CUSTOMIZE|SKIN|NAME|DIFFICULTY|RETRY|MENU|LOBBY|CHAT|SEND)\b/i.test(t),
);

console.log(JSON.stringify({
  title: look.title,
  tagline: look.tagline,
  play: look.play,
  quick: look.quick,
  rooms: look.rooms,
  panel: look.panel,
  side: look.side,
  swatchCount: look.swatchCount,
  diffOptions: look.diffOptions,
  diffOn: look.diffOn,
}, null, 2));
console.log('\ntextos visibles:', look.allText.length);
console.log('sospechosos de inglés:', suspicious.length ? suspicious : 'ninguno');
console.log('errors:', errors.length ? errors.slice(0, 4) : 'none');

await page.screenshot({ path: 'tools/shot-menu.png' });
await browser.close();
