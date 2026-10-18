// Screenshots the app at a few window sizes and display densities and reports layout facts. Needs the dev server.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
mkdirSync('tmp', { recursive: true }); // screenshots go here; the folder is not shipped
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const settle = ms => new Promise(r => setTimeout(r, ms));
for (const [w, h, dsf] of [[1440, 800, 2], [1280, 720, 2], [1280, 720, 1]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dsf });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
  const click = label => page.evaluate(l => [...document.querySelectorAll('.tab')].find(t => t.textContent.startsWith(l)).click(), label);
  await click('Hair'); await settle(1200);
  const facts = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.grid .card')];
    const tops = [...new Set(cards.map(c => Math.round(c.getBoundingClientRect().top)))];
    const firstRow = cards.filter(c => c.closest('#content') && Math.round(c.getBoundingClientRect().top) === Math.round(cards.find(k => k.closest('#content')).getBoundingClientRect().top)).length;
    const size = list => { const r = list.map(c => c.getBoundingClientRect()); return r.length ? `${r[0].width.toFixed(1)}x${r[0].height.toFixed(1)}` : 'none'; };
    const catalogue = cards.filter(c => c.closest('#content'));
    const equipped = [...document.querySelectorAll('.colour-options .card')];
    const gaps = list => { const r = list.map(c => c.getBoundingClientRect()); const sideways = r.length > 1 ? (r[1].left - r[0].right).toFixed(1) : '-'; const down = r.length > 5 ? (r[5].top - r[0].bottom).toFixed(1) : '-'; return `${sideways}/${down}`; };
    const cv = document.getElementById('preview');
    return { catalogueCard: size(catalogue), equippedCard: size(equipped), gaps: gaps(catalogue), perRow: firstRow, pageScrolls: document.documentElement.scrollHeight > innerHeight + 1, firstRow, gridScrolls: document.getElementById('content').scrollHeight > document.getElementById('content').clientHeight, previewCss: `${cv.style.width}x${cv.style.height}`, previewDevice: `${cv.width}x${cv.height}`, dpr: devicePixelRatio };
  });
  console.log(`${w}x${h} @${dsf}x:`, JSON.stringify(facts));
  await page.screenshot({ path: `tmp/layout-${w}x${h}@${dsf}.png` });
  // Wearable tab with sliders
  await click('Overall'); await settle(500);
  await page.evaluate(() => document.querySelectorAll('.grid .card:not(.none)')[1].click()); await settle(800);
  await page.screenshot({ path: `tmp/layout-overall-${w}x${h}@${dsf}.png` });
  await page.close();
}
await browser.close();
