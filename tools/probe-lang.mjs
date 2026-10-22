// Recorre todas las pantallas y saca sus textos, para detectar inglés residual.
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
await sleep(500);

const screens = ['menu', 'rooms', 'settings', 'howto', 'lobby'];
const out = {};
for (const name of screens) {
  await page.evaluate((n) => window.__game.ui.show(n), name);
  await sleep(280);
  out[name] = await page.evaluate(() => {
    const texts = [];
    const walk = (n) => {
      if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) texts.push(t); return; }
      if (n.nodeType !== 1) return;
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden') return;
      for (const c of n.childNodes) walk(c);
    };
    walk(document.querySelector('.screen.active') || document.body);
    return texts;
  });
}

const EN = /\b(PLAY|SETTINGS|QUICK|ROOMS?|JOIN|CREATE|BACK|RESUME|QUIT|READY|START|HOW|CUSTOMIZE|SKIN|DIFFICULTY|RETRY|MENU|LOBBY|CHAT|SEND|PLAYER|NAME|LOADING|WAITING|VOLUME|MUSIC|SOUND|QUALITY|SHADOWS?|BLOOM|HIGH|LOW|MEDIUM|ENTER|CODE|COPY|SHARE|WIN|LOSE|ROUND|ALIVE|PAUSE)\b/i;

for (const [name, texts] of Object.entries(out)) {
  const bad = texts.filter((t) => EN.test(t));
  console.log(`\n[${name}] ${texts.length} textos — inglés: ${bad.length ? bad.join(' | ') : 'ninguno'}`);
  if (name === 'howto') console.log('  muestra:', texts.slice(0, 10).join(' / '));
}
console.log('\nerrors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
