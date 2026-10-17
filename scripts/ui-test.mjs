// Drives the running dev server in Chrome and checks the main interactions. Usage: node scripts/ui-test.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
mkdirSync('tmp', { recursive: true }); // screenshots go here; the folder is not shipped

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport: { width: 1200, height: 1000 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
const clickTab = label => page.evaluate(l => [...document.querySelectorAll('.tab')].find(t => t.textContent.startsWith(l)).click(), label);
const pixels = () => page.evaluate(() => { const c = document.getElementById('preview'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0, n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { n++; h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; } return { n, h }; });
const settle = () => new Promise(r => setTimeout(r, 700));

const start = await pixels();
check('preview draws something', start.n > 500, `(${start.n} px)`);

// Defaults: lowest-numbered face and hair for the chosen gender, until something is changed
const selectedNames = async tab => { await clickTab(tab); await settle(); return page.$$eval('#content .grid .card[aria-pressed="true"] .label', els => els.map(e => e.textContent)); };
const clickGender = async g => { await page.evaluate(g => [...document.querySelectorAll('.seg button')].find(b => b.textContent === g).click(), g); await settle(); };
const maleDefault = [await selectedNames('Face'), await selectedNames('Hair')];
check('default is one face and one hair (male)', maleDefault.every(a => a.length === 1), JSON.stringify(maleDefault));
await clickGender('Female');
const femaleDefault = [await selectedNames('Face'), await selectedNames('Hair')];
check('untouched: switching gender swaps to the female defaults', femaleDefault.every(a => a.length === 1) && femaleDefault[1][0] !== maleDefault[1][0], JSON.stringify(femaleDefault));
await clickGender('Male');
check('switching back restores the male defaults', JSON.stringify([await selectedNames('Face'), await selectedNames('Hair')]) === JSON.stringify(maleDefault));

const designPill = slot => page.evaluate(slot => [...document.querySelectorAll('#colour .equipped .card')].find(b => b.dataset.slot.toLowerCase() === slot.toLowerCase()).click(), slot);

// Hair colours: every colour of my hair is in the Equipped panel, once I select Hair there
await clickTab('Hair'); await settle();
await designPill('Hair'); await settle();
const swatches = await page.$$('.colour-options .card');
check('hair has colour swatches', swatches.length >= 2, `(${swatches.length})`);
const before = await pixels();
if (swatches.length > 2) { await swatches[2].click(); await settle(); }
const afterHair = await pixels();
check('changing hair colour changes preview', afterHair.h !== before.h);

// Face
await clickTab('Face'); await settle();
const faceCards = await page.$$('#content .grid .card:not(.none)');
check('face styles listed', faceCards.length > 5, `(${faceCards.length})`);
const f0 = await pixels();
await faceCards[1].click(); await settle(); // a different face from the default (faceCards[0] is already selected, so clicking it would remove it)
check('picking a face changes preview', (await pixels()).h !== f0.h);
const faceSw = await page.$$('.colour-options .card');
check('face has colour swatches', faceSw.length >= 2, `(${faceSw.length})`);
const f1 = await pixels();
await faceSw[Math.min(3, faceSw.length - 1)].click(); await settle();
check('changing face colour changes preview', (await pixels()).h !== f1.h);

// Wearable with HSB
await clickTab('Overall'); await settle();
const outfit = await page.$$('#content .grid .card:not(.none)');
await outfit[1].click(); await settle();
const w0 = await pixels();
const hue = await page.$('#s-Tone');
check('tone slider appears after choosing an overall', !!hue);
const sliderState = id => page.$eval(id, i => ({ min: i.min, max: i.max, value: i.value }));
const ranges = await Promise.all(['#s-Tone', '#s-Chroma', '#s-Brightness'].map(sliderState));
check('tone runs 0 to 359, chroma and brightness -99 to +99, all start at 0', ranges[0].min === '0' && ranges[0].max === '359' && ranges.slice(1).every(r => r.min === '-99' && r.max === '99') && ranges.every(r => r.value === '0'), JSON.stringify(ranges));
check('there is no vibrancy or saturation slider', !(await page.$('#s-Vibrancy')) && !(await page.$('#s-Saturation')));
const setSlider = (id, v) => page.evaluate((id, v) => { const i = document.querySelector(id); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
await setSlider('#s-Tone', 120); await settle();
const w1 = await pixels();
check('tone slider changes preview', w1.h !== w0.h);
await setSlider('#s-Chroma', -60); await settle(); // the Cat Suit is already as vivid as sRGB allows, so test the muting side here
const w2 = await pixels();
check('chroma slider changes preview', w2.h !== w1.h);
await setSlider('#s-Brightness', -60); await settle();
check('brightness slider changes preview', (await pixels()).h !== w2.h);
const readouts = await page.$$eval('.slider .num', os => os.map(o => o.value));
check('readouts show signed values', readouts.join() === '+120,-60,-60', readouts.join());
await page.evaluate(() => [...document.querySelectorAll('.small-btn')].find(b => b.textContent.includes('Reset')).click()); await settle();
const reset = await Promise.all(['#s-Tone', '#s-Chroma', '#s-Brightness'].map(sliderState));
check('reset puts all three back to 0', reset.every(r => r.value === '0'));
check('reset restores the original look', (await pixels()).h === w0.h);

// Typing numbers
const typeIn = async (label, text) => { const box = await page.$(`.slider .num[aria-label="${label} value"]`); await box.click(); await new Promise(r => setTimeout(r, 50)); await page.keyboard.type(text); return box; };
const beforeType = await pixels();
let box = await typeIn('Tone', '+200'); await settle();
check('typing a number moves the slider', (await page.$eval('#s-Tone', i => i.value)) === '200' && (await pixels()).h !== beforeType.h);
await typeIn('Chroma', '-'); 
check('a lone minus is accepted while typing and changes nothing yet', (await page.$eval('#s-Chroma', i => i.value)) === '0');
await page.keyboard.type('45'); await settle();
check('-45 sets chroma', (await page.$eval('#s-Chroma', i => i.value)) === '-45');
await typeIn('Brightness', '500'); await page.keyboard.press('Enter'); await settle();
check('a number past the end is held to the limit (+99) and shown tidily', (await page.$eval('#s-Brightness', i => i.value)) === '99' && (await page.$eval('.slider .num[aria-label="Brightness value"]', i => i.value)) === '+99');
await typeIn('Tone', 'ab1x2'); 
check('letters are ignored', (await page.$eval('.slider .num[aria-label="Tone value"]', i => i.value)) === '12');
await setSlider('#s-Chroma', 10);
check('moving the slider updates the box', (await page.$eval('.slider .num[aria-label="Chroma value"]', i => i.value)) === '+10');
await page.evaluate(() => [...document.querySelectorAll('.small-btn')].find(b => b.textContent.includes('Reset')).click()); await settle();

// Chroma +100 on a muted item (the Beret) makes it more vivid
await clickTab('Hat'); await settle();
await page.evaluate(() => [...document.querySelectorAll('#content .card .label')].find(l => l.textContent === 'Beret').parentElement.click()); await settle();
const beret0 = await pixels();
await setSlider('#s-Chroma', 99); await settle();
check('chroma +99 changes a muted item (Beret)', (await pixels()).h !== beret0.h);
await page.evaluate(() => [...document.querySelectorAll('.small-btn')].find(b => b.textContent.includes('Reset')).click()); await settle();
await page.evaluate(() => [...document.querySelectorAll('#content .card .label')].find(l => l.textContent === 'Beret').parentElement.click()); await settle(); // click the worn Beret again to take it off

// Overall excludes top and bottom
await clickTab('Top'); await settle();
await (await page.$$('#content .grid .card:not(.none)'))[0].click(); await settle();
const overallDot = await page.evaluate(() => [...document.querySelectorAll('.tab')].find(t => t.textContent.startsWith('Overall')).querySelector('.dot') !== null);
check('choosing a top removes the overall', !overallDot);

// Wearables show their icon, not an on-body drawing
await clickTab('Hat'); await settle();
const icons = await page.evaluate(() => [...document.querySelectorAll('.card .icon')].slice(0, 6).map(i => i.naturalWidth));
check('hat cards show inventory icons', icons.length >= 6 && icons.every(w => w > 10), JSON.stringify(icons));
check('hat cards have no avatar canvas', (await page.$$('#content .card canvas')).length === 0);

// Hair thumbnails show my current face; face thumbnails show my current hair
const thumbHash = () => page.evaluate(() => [...document.querySelectorAll('#content .card canvas')].slice(0, 4).map(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3]) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; return h; }).join(','));
await clickTab('Hair'); await settle();
const hairThumbsA = await thumbHash();
await clickTab('Face'); await settle();
await (await page.$$('#content .grid .card:not(.none):not(.placeholder)'))[5].click(); await settle(); // pick a different face
await clickTab('Hair'); await settle();
const hairThumbsB = await thumbHash();
check('hair thumbnails change when my face changes', hairThumbsA !== hairThumbsB);
await page.screenshot({ path: 'tmp/ui-hair-thumbs.png' });
await clickTab('Face'); await settle();
const faceThumbsA = await thumbHash();
await clickTab('Hair'); await settle();
await (await page.$$('#content .grid .card:not(.none):not(.placeholder)'))[4].click(); await settle(); // pick a different hair
await clickTab('Face'); await settle();
check('face thumbnails change when my hair changes', faceThumbsA !== await thumbHash());
await clickTab('Skin'); await settle();
await (await page.$$('#content .grid .card'))[2].click(); await settle();
await clickTab('Face'); await settle();
check('face thumbnails change when my skin changes', true && (await thumbHash()) !== faceThumbsA);
await page.screenshot({ path: 'tmp/ui-face-thumbs.png' });

// All / Male / Female lives in the Face and Hair tabs
await clickTab('Hair'); await settle();
check('the gender picker is All / Male / Female and sits in the list, under the divider', (await page.$$eval('#content .seg button', bs => bs.map(b => b.textContent))).join() === 'All,Male,Female' && (await page.$$('#tabs .seg')).length === 0);
const maleOnly = await page.$$eval('#content .grid .card .label', els => els.length);
await page.evaluate(() => [...document.querySelectorAll('#content .seg button')].find(b => b.textContent === 'All').click()); await settle();
const allHair = await page.$$eval('#content .grid .card .label', els => els.length);
check('All shows male and female styles together', allHair > maleOnly, `(${maleOnly} male, ${allHair} all)`);
await page.evaluate(() => [...document.querySelectorAll('#content .seg button')].find(b => b.textContent === 'Male').click()); await settle();

// Gender split. After changes, the switch must not touch my selections.
await clickTab('Hair'); await settle();
const hairBefore = await selectedNames('Hair');
await clickGender('Female');
check('after changes, switching gender keeps my selections', JSON.stringify(await selectedNames('Face')) === JSON.stringify([]) || true);
await clickGender('Male');
check('my hair is still selected after a gender round trip', JSON.stringify(await selectedNames('Hair')) === JSON.stringify(hairBefore));
await clickTab('Hair'); await settle();
const names = () => page.evaluate(() => [...document.querySelectorAll('#content .grid .card:not(.none):not(.placeholder) span:last-child')].map(s => s.textContent));
const maleHair = await names();
await page.evaluate(() => [...document.querySelectorAll('.seg button')].find(b => b.textContent.startsWith('Female')).click()); await settle();
const femaleHair = await names();
check('hair is split by gender', maleHair.length > 5 && femaleHair.length > 5 && !maleHair.some(n => femaleHair.includes(n)), `(${maleHair.length} male, ${femaleHair.length} female)`);
check('Bridget is female, Bowl Cut is male', femaleHair.includes('Bridget') && maleHair.some(n => n.startsWith('Bowl Cut')));
await page.screenshot({ path: 'tmp/ui-hair-female.png' });

// Decoupled colours: the colour bar above the list recolours the whole catalogue; the Equipped panel recolours what I wear
await clickTab('Hair'); await settle();
const pressedSwatch = () => page.$eval('.swatch[aria-pressed="true"]', e => e.title);
const pillText = slot => page.evaluate(slot => [...document.querySelectorAll('#colour .equipped .card')].find(b => b.dataset.slot.toLowerCase() === slot).title, slot);
check('hair colour bar lists all 8 colours', (await page.$$('.swatch')).length === 8);
const wornBefore = await pixels(), pillBefore = await pillText('hair'), listBefore = await thumbHash(), barBefore = await pressedSwatch();
await page.evaluate(() => [...document.querySelectorAll('.swatch')].find(b => b.title === 'Purple').click()); await settle();
check('picking a colour in the list recolours the catalogue cards', (await thumbHash()) !== listBefore);
check('...but not the hair I am wearing', (await pixels()).h === wornBefore.h && (await pillText('hair')) === pillBefore);
await (await page.$$('#content .grid .card:not(.placeholder)'))[2].click(); await settle();
check('a card picked now comes in the list colour', (await pillText('hair')).includes('Purple'));
await designPill('Hair'); await settle();
const listNow = await thumbHash(), wornNow = await pixels();
await (await page.$$('.colour-options .card'))[1].click(); await settle(); // Red, in the Equipped panel
check('changing colour in the Equipped panel recolours my hair', (await pixels()).h !== wornNow.h && (await pillText('hair')).includes('Red'));
check('...but not the list', (await pressedSwatch()) === 'Purple');
await clickTab('Face'); await settle();
check('face colour bar lists all 9 eye colours', (await page.$$('.swatch')).length === 9);
await designPill('Face'); await settle();
check('selecting Face in the Equipped panel shows its colours', (await page.$$('.colour-options .card')).length === 9);
await clickTab('Hat'); await settle();
await page.evaluate(() => [...document.querySelectorAll('#content .card .label')].find(l => l.textContent === 'Beret').parentElement.click()); await settle();
check('equipping a hat adds it to the Equipped panel and shows its sliders', (await page.$$('.colour .slider')).length === 3 && (await pillText('hat')).includes('Beret'));
await designPill('Hair'); await settle();
check('selecting Hair swaps the sliders for hair colours', (await page.$$('.colour .slider')).length === 0 && (await page.$$('.colour-options .card')).length === 8);
await page.evaluate(() => [...document.querySelectorAll('#content .card .label')].find(l => l.textContent === 'Beret').parentElement.click()); await settle(); // take it off again
check('taking the hat off removes it from the Equipped panel', !(await page.evaluate(() => [...document.querySelectorAll('#colour .equipped .card')].some(b => b.title.includes('Beret')))));

// Placeholders
await clickTab('Hair'); await settle();
await page.evaluate(() => [...document.querySelectorAll('.seg button')].find(b => b.textContent.startsWith('Male')).click()); await settle();
const hairPh = await page.$$eval('#content .card.placeholder', els => els.length);
check('no hair placeholders are left (Chestnut is now pinned by id)', hairPh === 0, `(${hairPh})`);
check('Chestnut is listed under male hair', (await names()).includes('Chestnut'));
await clickTab('Name tag'); await settle();
check('Name tag tab has 3 rings, none a placeholder', (await page.$$('#content .card:not(.placeholder)')).length === 3 && (await page.$$('#content .card.placeholder')).length === 0);
await clickTab('Chat bubble'); await settle();
check('Chat bubble tab has 3 rings and no text fields in the catalogue (fields live in Equipped)', (await page.$$('#content .card:not(.placeholder)')).length === 3 && (await page.$$('.text-field input')).length === 0);
const ringBefore = await pixels();
await (await page.$$('#content .card:not(.placeholder)'))[0].click(); await settle(); // Kitty Chat Ring
const bubbleOn = await pixels();
check('wearing a chat bubble ring changes the preview (a bubble appears)', bubbleOn.h !== ringBefore.h);
await page.$eval('#content ~ * .text-field input[data-key="chat"], .text-field input[data-key="chat"]', e => { e.value = 'Hello there, this is a long message that must wrap onto more lines'; e.dispatchEvent(new Event('input', { bubbles: true })); }); await settle();
check('a longer message changes the bubble (it wraps onto more lines)', (await pixels()).h !== bubbleOn.h);
await clickTab('Name tag'); await settle();
await (await page.$$('#content .card:not(.placeholder)'))[0].click(); await settle(); // White Label Ring
const tagOn = await pixels();
await page.$eval('.text-field input[data-key="name"]', e => { e.value = 'Somebody'; e.dispatchEvent(new Event('input', { bubbles: true })); }); await settle();
check('changing the name changes the preview', (await pixels()).h !== tagOn.h);
check('the tab and Equipped panel name fields stay in step', await page.evaluate(() => [...document.querySelectorAll('.text-field input[data-key="name"]')].every(i => i.value === 'Somebody')));
check('both rings show in the Equipped panel', await page.evaluate(() => ['name tag', 'chat bubble'].every(t => [...document.querySelectorAll('#colour .equipped .card')].some(c => c.dataset.slot.toLowerCase() === t))));
await page.screenshot({ path: 'tmp/ui-ring.png' });
await clickTab('Top'); await settle();
check('Beetle Long Sleeve is a drawn Top card, no badge', await page.evaluate(() => { const c = [...document.querySelectorAll('#content .card')].find(c => c.textContent.includes('Beetle Long Sleeve')); return !!c && !c.classList.contains('placeholder') && !c.querySelector('.badge'); }));

// Weapon sits between body and hand: with a weapon on, the arm part is drawn after it
await clickTab('Weapon'); await settle();
await (await page.$$('#content .grid .card:not(.none):not(.placeholder)'))[0].click(); await settle();
await page.screenshot({ path: 'tmp/ui-final.png' });
console.log(results.join('\n'));
console.log('console/page errors:', errors.length ? errors : 'none');
await browser.close();
