import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

page.on('pageerror', (e) => console.log('PAGEERROR:', (e.stack || e.message).split('\n').slice(0, 6).join('\n   ')));
page.on('console', (m) => {
  const t = m.text();
  if (!t.includes('GL Driver') && !t.includes('[vite]')) console.log(`[${m.type()}]`, t);
});
page.on('requestfailed', (r) => console.log('REQFAIL:', r.url(), r.failure()?.errorText));

// Intercept module load to see whether main.js even executes its try block.
await page.addInitScript(() => {
  window.__trace = [];
  window.addEventListener('DOMContentLoaded', () => window.__trace.push('DCL'));
  window.addEventListener('load', () => window.__trace.push('load'));
});

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

const info = await page.evaluate(() => ({
  trace: window.__trace,
  hasGame: 'game' in window ? typeof window.__game : 'undefined-prop',
  gameKeys: window.__game ? Object.keys(window.__game).slice(0, 5) : null,
  loaderHTML: document.getElementById('loader')?.innerHTML.slice(0, 300),
  scripts: [...document.querySelectorAll('script')].map((s) => s.src || s.type),
  canvasPresent: !!document.getElementById('scene'),
}));

console.log(JSON.stringify(info, null, 2));
await browser.close();
