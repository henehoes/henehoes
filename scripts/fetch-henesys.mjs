// Pulls henesys.gg's Classic data into data/ so it can be the single source for names and ids:
//   data/henesys-salon.json    every hair and face style listed on https://henesys.gg/salon (the game data, released or not)
//   data/henesys-cashshop.json equipment from https://henesys.gg/data/cash-shop.json (Classic item ids)
// Usage: node scripts/fetch-henesys.mjs   (needs Google Chrome; set CHROME_PATH if it is not at the macOS default)
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36' };
const decode = s => s.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const today = new Date().toISOString().slice(0, 10);

// ---- salon page ----
// The page opens on the male list; the female list is only drawn after pressing "Female", so a real browser is needed.
// The collab styles appear in both lists and are stored once with gender "both".
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setUserAgent(UA['User-Agent']);
await page.goto('https://henesys.gg/salon', { waitUntil: 'networkidle0', timeout: 90000 });
const grab = () => page.evaluate(() => {
  const out = [];
  for (const sec of document.querySelectorAll('section')) {
    const title = sec.querySelector('h2')?.textContent.trim() ?? '';
    for (const c of sec.querySelectorAll('.salon-style-card')) {
      const m = (c.querySelector('img')?.getAttribute('src') ?? '').match(/\/salon\/(hair|face)\/(\d+)\.png/);
      if (m) out.push({ kind: m[1], id: +m[2], name: c.querySelector('.salon-style-name')?.textContent.trim(), group: title.startsWith('Frieren') ? 'collab' : 'salon' });
    }
  }
  return out;
});
await new Promise(r => setTimeout(r, 1500));
const male = await grab();
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Female').click());
await new Promise(r => setTimeout(r, 1500));
const female = await grab();
await browser.close();
const salon = { source: 'https://henesys.gg/salon', fetched: today, hair: [], face: [] };
const key = e => `${e.kind}:${e.id}`;
const femaleIds = new Set(female.map(key));
for (const e of male) salon[e.kind].push({ id: e.id, name: decode(e.name), gender: femaleIds.has(key(e)) ? 'both' : 'male', group: e.group });
const maleIds = new Set(male.map(key));
for (const e of female) if (!maleIds.has(key(e))) salon[e.kind].push({ id: e.id, name: decode(e.name), gender: 'female', group: e.group });
for (const k of ['hair', 'face']) salon[k].sort((a, b) => a.id - b.id);
if (salon.hair.length < 150 || salon.face.length < 70) throw new Error(`salon page looks different: ${salon.hair.length} hair, ${salon.face.length} face`);
writeFileSync('data/henesys-salon.json', JSON.stringify(salon, null, 1));
const count = (k, g) => salon[k].filter(e => e.gender === g).length;
console.log(`salon: hair ${count('hair', 'male')} male + ${count('hair', 'female')} female + ${count('hair', 'both')} both; face ${count('face', 'male')} male + ${count('face', 'female')} female + ${count('face', 'both')} both`);

// ---- cash shop ----
const shop = (await (await fetch('https://henesys.gg/data/cash-shop.json', { headers: UA })).json()).items;
const equip = shop.filter(i => i.category === 'Equipment').map(i => ({ id: i.id, name: i.name, sub: i.sub }));
writeFileSync('data/henesys-cashshop.json', JSON.stringify({ source: 'https://henesys.gg/data/cash-shop.json', fetched: today, items: equip }, null, 1));
console.log(`cash shop: ${equip.length} equipment items of ${shop.length}`);
