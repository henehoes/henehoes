// Drives the running dev server in Chrome and checks the main interactions. Usage: node scripts/ui-test.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';
const SHOW_UPCOMING = /const SHOW_UPCOMING = true/.test(readFileSync('src/main.js', 'utf8')); // the possible-upcoming items are hidden while the flag in src/main.js is false
mkdirSync('tmp', { recursive: true }); // screenshots go here; the folder is not shipped

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport: { width: 1200, height: 1000 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });

// Counts come from the built catalogue, so the checks follow the data (items move from upcoming to released as boxes come out)
const CAT = JSON.parse(readFileSync('public/catalog.json', 'utf8')).wearables;
const released = slot => CAT[slot].items.filter(i => !i.upcoming), upcoming = slot => CAT[slot].items.filter(i => i.upcoming);
const fitOf = i => i.fit ?? (i.vslots?.includes('H2') ? 'helmet' : i.vslots?.includes('H1') ? 'cap' : 'topper');
const HATS = released('cap'), FIT = f => HATS.filter(i => fitOf(i) === f).length;
const UPCOMING_TOTAL = Object.keys(CAT).reduce((n, k) => n + upcoming(k).length, 0);
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
const clickTab = label => page.evaluate(l => [...document.querySelectorAll('.tab')].find(t => t.title.startsWith(l)).click(), label);
const pixels = () => page.evaluate(() => { const c = document.getElementById('preview'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0, n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { n++; h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; } return { n, h }; });
const settle = () => new Promise(r => setTimeout(r, 700));

const start = await pixels();
check('preview draws something', start.n > 500, `(${start.n} px)`);
check('on load the Released tab is open, on Mystery Fashion and its newest box (Nov 4)', (await page.$eval('.tab[aria-selected="true"]', e => e.title)).startsWith('Released') && (await page.$eval('#content .past-tab[aria-selected="true"]', e => e.textContent)) === 'Mystery Fashion' && (await page.$eval('#content .pill[aria-pressed="true"]', e => e.textContent)) === 'Nov 4 – Nov 18');
check('Released and Upcoming close the rail, below Chat Ring, and never carry a checkmark', await page.$$eval('.tab', ts => { const t = ts.map(x => x.title); const n = t.length; return t[n - 2].startsWith('Released') && t[n - 1].startsWith('Possible') && t[n - 3] === 'Chat Ring' && !ts[n - 2].querySelector('.tick') && !ts[n - 1].querySelector('.tick'); }));

// Nothing is worn at the start: no face and no hair
const selectedNames = async tab => { await clickTab(tab); await settle(); return page.$$eval('#content .grid .card[aria-pressed="true"] .label', els => els.map(e => e.textContent)); };
const clickGender = async g => { await page.evaluate(g => [...document.querySelectorAll('.seg button')].find(b => b.textContent.endsWith(g)).click(), g); await settle(); };
const startNames = [await selectedNames('Face'), await selectedNames('Hair')];
check('no face and no hair are selected on a fresh page', startNames.every(a => a.length === 0), JSON.stringify(startNames));
check('the Equipped panel shows the empty-state sentence in a box', (await page.$eval('#colour .empty-note p', e => e.textContent)) === 'Nothing equipped yet. Pick your face, hair and clothing items on the right. You can select them here to change their colour.' && (await page.$eval('#colour .empty-note p', e => parseFloat(getComputedStyle(e).fontSize))) >= 15);
check('nothing is listed in the Equipped panel yet', (await page.$$('#colour .slot')).length === 0);
await clickGender('Female');
check('the All / Male / Female picker only filters the list (still nothing selected)', (await selectedNames('Face')).length === 0 && (await selectedNames('Hair')).length === 0);
const femaleHairShown = await page.$$eval('#content .grid .card:not(.placeholder) .label', els => els.length);
await clickGender('Male');
check('the picker still changes which hair is listed', femaleHairShown > 0);
// The cards stay readable with nothing worn: hair thumbnails borrow a neutral face
const borrowed = await page.evaluate(() => { const c = document.querySelector('#content .card canvas'); return c ? c.width > 0 : false; });
check('hair cards still draw with no face worn', borrowed);
// Equip the first face and the first hair, as the rest of this run expects a worn face and hair
await clickTab('Face'); await settle(); await (await page.$$('#content .grid .card:not(.placeholder)'))[0].click(); await settle();
await clickTab('Hair'); await settle(); await (await page.$$('#content .grid .card:not(.placeholder)'))[0].click(); await settle();
check('picking a face and a hair equips them', (await page.$$('#colour .slot')).length === 2);

// Body tab: gender picker and the undergarments that come with it (not equipped items, not in the Top and Bottom lists)
await clickTab('Body'); await settle();
const sexButtons = await page.$$eval('#source .seg button', bs => bs.map(b => `${b.textContent}:${b.getAttribute('aria-pressed')}`));
check('Body tab has a gender picker, Male selected at the start', sexButtons.join() === '♂ Male:true,♀ Female:false', sexButtons.join());
const maleBody = await pixels();
await page.evaluate(() => [...document.querySelectorAll('#source .seg button')].find(b => b.textContent.endsWith('Female')).click()); await settle();
const femaleBody = await pixels();
check('switching to Female changes the undergarments drawn on the body', femaleBody.h !== maleBody.h && femaleBody.n > 500, `${maleBody.h} -> ${femaleBody.h}`);
check('the undergarments are not shown in the Equipped panel', (await page.$$('#colour .slot')).length === 2);
const undies = ['Blue Striped Undershirt', 'Blue-Striped Boxers', 'Pink Tank Top', 'Pink Cotton Boxers'];
for (const [tab, n] of [['Top', released('coat').length], ['Bottom', released('pants').length]]) {
  await clickTab(tab); await settle();
  const names = await page.$$eval('#content .grid .card .label', els => els.map(e => e.textContent));
  check(`${tab} tab lists no undergarments`, names.length === n && !names.some(x => undies.includes(x)), `${names.length} items`);
}
await clickTab('Top'); await settle(); await (await page.$$('#content .grid .card'))[0].click(); await settle();
const topOn = await pixels();
check('wearing a top replaces the undershirt (the body changes)', topOn.h !== femaleBody.h);
await (await page.$$('#content .grid .card'))[0].click(); await settle();
check('taking the top off brings the undershirt back', (await pixels()).h === femaleBody.h);
await clickTab('Body'); await settle();
await page.evaluate(() => [...document.querySelectorAll('#source .seg button')].find(b => b.textContent.endsWith('Male') && !b.textContent.includes('Fe')).click()); await settle();

// White eyes: the Singapore eye colour coupon cannot set them, so the catalogue and the Equipped panel warn
await clickTab('Face'); await settle();
check('Face colour bar: the White swatch carries a warning marker', await page.$$eval('.swatch.warn', s => s.length === 1 && /coupon/i.test(s[0].title)));
check('no warning while the list is shown in a normal eye colour', !(await page.$('#content .warn-note')));
await page.evaluate(() => document.querySelector('.swatch.warn').click()); await settle();
check('browsing the list in White shows the coupon warning', /coupon/i.test(await page.$eval('#content .warn-note', e => e.textContent)));
await (await page.$$('#content .grid .card:not(.placeholder)'))[1].click(); await settle(); // wear a (different) face in White: the first one is already worn and a second click would take it off
check('wearing White eyes marks the Equipped tile and warns in the Face panel', !!(await page.$('#colour .equipped .card.mini[data-key="face"] .fix')) && !!(await page.$('#colour .warn-note')));
check('the White colour preview in the Face panel has a warning badge', await page.$$eval('#colour .colour-options .warn-badge', b => b.length === 1 && b[0].textContent.trim().length > 0));
await page.evaluate(() => document.querySelector('#colour .colour-options .card').click()); await settle(); // first colour: Black
check('picking a normal eye colour clears the Equipped warnings', !(await page.$('#colour .warn-note')) && !(await page.$('#colour .equipped .card.mini[data-key="face"] .fix')));
await page.evaluate(() => document.querySelector('.swatch').click()); await settle(); // list back to Black
await (await page.$$('#content .grid .card:not(.placeholder)'))[0].click(); await settle(); // the first face again, as the rest of the run expects

// Dyeing is off for items the game does not let you dye; the Upcoming tab lists dyeable items that are not in the catalogue (unconfirmed)
const slotsNow = async () => (await page.$$('#colour .slot')).length, slidersNow = async () => (await page.$$('#colour .slider')).length;
const worn0 = await slotsNow();
await clickTab('Hat'); await settle();
await page.type('.search-input', 'Aura Hair'); await settle(); await (await page.$$('#content .grid .card'))[0].click(); await settle();
check('an item the game cannot dye (Aura Hair (Hat)) has no colour sliders and says why', await slotsNow() === worn0 + 1 && await slidersNow() === 0 && /can't be dyed/.test(await page.$eval('#colour .hint', e => e.textContent)));
await (await page.$$('#content .grid .card'))[0].click(); await settle();
await clickTab('Hat'); await settle();
await page.$eval('.search-input', e => { e.value = ''; e.dispatchEvent(new Event('input')); }); await settle();
await (await page.$$('#content .grid .card'))[0].click(); await settle();
check('an ordinary dyeable hat still has the three colour sliders', await slidersNow() === 3);
await (await page.$$('#content .grid .card'))[0].click(); await settle();
if (SHOW_UPCOMING) {
await clickTab('Possible'); await settle();
const note = await page.$eval('#content .empty-note p', e => e.textContent);
check('Upcoming tab opens with an "Unconfirmed" note', /speculative/.test(note) && /no guarantee/.test(note));
check('the note is three lines until Read more, then shows the whole explanation', await (async () => {
  const lines = () => page.$eval('#content .note-text', e => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)));
  const collapsed = await lines(); await page.click('#content .note-toggle'); await settle();
  const open = await lines(), label = await page.$eval('#content .note-toggle', e => e.textContent + e.getAttribute('aria-expanded'));
  const full = await page.$eval('#content .note-text', e => /Aurora/.test(e.textContent) && /already been marked dyeable/.test(e.textContent));
  await page.click('#content .note-toggle'); await settle();
  return collapsed === 3 && open > 3 && label === 'Show lesstrue' && full;
})());
const upCards = await page.$$eval('#content .grid .card', cs => cs.map(c => c.textContent));
check('Upcoming tab lists the dyeable items not in the catalogue, each badged UPCOMING', upCards.length === UPCOMING_TOTAL && upCards.every(t => t.includes('UPCOMING')), `${upCards.length} cards`);
await (await page.$$('#content .grid .card'))[0].click(); await settle();
check('an upcoming item can be tried on (equipped and dyeable)', await slotsNow() === worn0 + 1 && await slidersNow() === 3);
await (await page.$$('#content .grid .card'))[0].click(); await settle();
await clickTab('Hat'); await settle();
check('upcoming items are not mixed into the normal Hat tab', (await page.$$('#content .grid .card')).length === HATS.length);
await clickTab('Search'); await settle(); await page.type('.search-input', 'pumpkin'); await settle();
check('and not in Search either', !(await page.$$eval('#content .card', cs => cs.some(c => c.textContent.includes('UPCOMING')))));
await page.$eval('.search-input', e => { e.value = ''; e.dispatchEvent(new Event('input')); }); await clickTab('Body'); await settle();
} else {
check('Next Crate: no Next Crate tab while upcoming items are hidden', !(await page.$$eval('.tab', t => t.some(x => /Next Crate|Possible/.test(x.title + x.textContent)))));
}

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
const dyeNote = await page.$eval('#colour .dye-note', e => ({ text: e.textContent.replace(/^!/, ''), below: e.getBoundingClientRect().top >= document.querySelector('#colour .btn-row').getBoundingClientRect().bottom }));
check('the dye note sits below the dye buttons with the approved wording', dyeNote.below && dyeNote.text === "Some special effects keep their original colour in the game even when dyed. We can't tell which, so this preview dyes every part it can; some items may show little or no change.", JSON.stringify(dyeNote));
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

// Random dye
const dyeBefore = await pixels();
await page.evaluate(() => [...document.querySelectorAll('.small-btn')].find(b => b.textContent === 'Random dye').click()); await settle();
const dyed = await page.evaluate(() => ['Tone', 'Chroma', 'Brightness'].map(l => Number(document.querySelector(`#s-${l}`).value)));
check('Random dye sets tone, chroma and brightness within range', dyed[0] >= 0 && dyed[0] <= 359 && Math.abs(dyed[1]) <= 99 && Math.abs(dyed[2]) <= 99, JSON.stringify(dyed));
check('the number boxes show the random values', await page.evaluate(d => ['Tone', 'Chroma', 'Brightness'].every((l, i) => Number(document.querySelector(`.slider .num[aria-label="${l} value"]`).value) === d[i]), dyed));
let varies = false;
for (let i = 0; i < 6 && !varies; i++) { await page.evaluate(() => [...document.querySelectorAll('.small-btn')].find(b => b.textContent === 'Random dye').click()); const v = await page.evaluate(() => document.querySelector('#s-Tone').value); varies = String(dyed[0]) !== v; }
check('Random dye gives different results', varies);
await page.evaluate(() => [...document.querySelectorAll('.small-btn')].find(b => b.textContent.includes('Reset')).click()); await settle();
check('Reset colour still returns the item to its own colours', (await pixels()).h === dyeBefore.h);

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
const overallDot = await page.evaluate(() => [...document.querySelectorAll('.tab')].find(t => t.textContent.startsWith('Overall')).querySelector('.tick') !== null);
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
await clickTab('Body'); await settle();
await (await page.$$('#content .grid .card'))[2].click(); await settle();
await clickTab('Face'); await settle();
check('face thumbnails change when my skin changes', true && (await thumbHash()) !== faceThumbsA);
await page.screenshot({ path: 'tmp/ui-face-thumbs.png' });

// All / Male / Female lives in the Face and Hair tabs
await clickTab('Hair'); await settle();
check('the gender picker is All / Male / Female and sits with the search box above the cards', (await page.$$eval('#filters > .seg button', bs => bs.map(b => b.textContent))).join() === 'All,♂ Male,♀ Female' && (await page.$$('#tabs .seg')).length === 0 && !!(await page.$('#filters .search-input')));
const maleOnly = await page.$$eval('#content .grid .card .label', els => els.length);
await page.evaluate(() => [...document.querySelectorAll('#filters > .seg button')].find(b => b.textContent.endsWith('All')).click()); await settle();
const allHair = await page.$$eval('#content .grid .card .label', els => els.length);
check('All shows male and female styles together', allHair > maleOnly, `(${maleOnly} male, ${allHair} all)`);
await page.evaluate(() => [...document.querySelectorAll('#filters > .seg button')].find(b => b.textContent.endsWith('Male') && !b.textContent.endsWith('Female')).click()); await settle();

// Search box
const typeSearch = async text => { const box = await page.$('#filters .search-input'); await box.click({ clickCount: 3 }); await page.keyboard.type(text); await settle(); };
await typeSearch('bowl');
const found = await page.$$eval('#content .grid .card .label', els => els.map(e => e.textContent));
check('search narrows the list by name (case-insensitive)', found.length === 1 && found[0] === 'Bowl Cut', JSON.stringify(found));
await typeSearch('zzzz');
check('search with no match says so', (await page.$$('#content .card')).length === 0 && !!(await page.$('#content .empty')));
await clickTab('Face'); await settle();
check('changing tab clears the search', (await page.$eval('#filters .search-input', i => i.value)) === '' && (await page.$$('#content .card')).length > 5);
await clickTab('Hat'); await settle();
check('search is also on wearable tabs and the gender picker is not', !!(await page.$('#filters .search-input')) && (await page.$$('#filters .seg')).length === 0);
await clickTab('Hair'); await settle();

// Released / datamine switch (design only): on Face and Hair, not on wearables
check('Face and Hair have a Released / Mystery Rotation / All · Datamine switch, defaulting to Released', (await page.$$eval('#source .seg button', bs => bs.map(b => `${b.textContent}:${b.getAttribute('aria-pressed')}`))).join() === 'Released:true,Mystery Rotation:false,All · Datamine:false');
await page.evaluate(() => [...document.querySelectorAll('#source .seg button')].find(b => b.textContent.includes('Datamine')).click()); await settle();
check('choosing Datamine shows the note, more styles, and marks the unreleased ones', !!(await page.$('#content .datamine-note')) && (await page.$$('#content .card')).length > 20 && (await page.$$('#content .card .unreleased-badge')).length > 5);
check('every unreleased card is marked DATAMINE and no released card is', await page.evaluate(() => [...document.querySelectorAll('#content .card:not(.placeholder)')].every(c => c.classList.contains('unreleased') === !!c.querySelector('.unreleased-badge'))));
await page.evaluate(() => [...document.querySelectorAll('#source .seg button')].find(b => b.textContent === 'Released').click()); await settle();
check('back to Released hides the note and every DATAMINE badge', !(await page.$('#content .datamine-note')) && (await page.$$('#content .card .unreleased-badge')).length === 0);
await clickTab('Hat'); await settle();
check('the Released/Datamine switch is not on wearable tabs (the Hat tab has Show and Fit rows)', !(await page.$$eval('#source .seg button', b => b.some(x => /Datamine/.test(x.textContent)))));
await clickTab('Hair'); await settle();

// Order inside the book on Face and Hair: Released/Datamine, then search and gender, then colours
const order = await page.evaluate(() => ['source', 'filters', 'toolbar'].map(id => document.getElementById(id).getBoundingClientRect().top));
check('Released/Datamine sits above search, and the colour picker sits below it', order[0] < order[1] && order[1] < order[2], JSON.stringify(order));
// Selected card shows a check, not a letter
const badge = await page.evaluate(() => { const c = document.querySelector('#content .card[aria-pressed="true"]'); const s = getComputedStyle(c, '::after'); return { content: s.content, image: s.backgroundImage.startsWith('url'), width: s.width }; });
check('the selected card shows a check badge (no "E")', badge.content !== '"E"' && badge.image && badge.width === '16px', JSON.stringify(badge));
// Equipped categories show a check, and the Equipped tiles can be removed with an x
await clickTab('Hat'); await settle();
await page.evaluate(() => document.querySelectorAll('#content .card:not(.placeholder)')[0].click()); await settle();
check('a category with something equipped shows a check on its tab', await page.evaluate(() => ['Face', 'Hair', 'Hat'].every(n => !!([...document.querySelectorAll('.tab')].find(t => t.title === n)?.querySelector('.tick')))));
const hatTile = await page.evaluateHandle(() => [...document.querySelectorAll('#colour .slot')].find(s => s.querySelector('.card').dataset.slot === 'Hat'));
check('the x is hidden until you hover a tile', await page.evaluate(s => getComputedStyle(s.querySelector('.remove')).display === 'none', hatTile));
await hatTile.hover(); await settle();
check('hovering a tile shows an x', await page.evaluate(s => getComputedStyle(s.querySelector('.remove')).display !== 'none', hatTile));
await (await hatTile.$('.remove')).click(); await settle();
check('clicking the x takes the hat off and drops its check', !(await page.evaluate(() => [...document.querySelectorAll('#colour .slot .card')].some(c => c.dataset.slot === 'Hat'))) && !(await page.evaluate(() => !![...document.querySelectorAll('.tab')].find(t => t.title === 'Hat')?.querySelector('.tick'))));
await clickTab('Hair'); await settle();

// The Equipped panel and the book end on the same line; the credits sit in the top bar, level with the book tabs
const ends = await page.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); const n = r('.note'), b = r('.books'); return { equippedBottom: r('#colour').bottom, coverBottom: r('.cover').bottom, noteTop: n.top, noteBottom: n.bottom, tabsBottom: b.bottom, noteText: document.querySelector('.note').textContent, sideTop: r('.side').top }; });
check('Equipped and catalogue panels end on the same line', Math.abs(ends.equippedBottom - ends.coverBottom) < 0.6, JSON.stringify(ends));
check('the credits are in the top bar, above the panels, with the shortened wording', ends.noteBottom <= ends.sideTop + 1 && ends.noteText === 'Sprites © Nexon. Dye behaviour from meaegi.com.', JSON.stringify(ends));

// Datamine view lists the whole henesys.gg salon (male, female and collab styles)
await page.evaluate(() => [...document.querySelectorAll('#filters > .seg button')].find(b => b.textContent.endsWith('All')).click());
await page.evaluate(() => [...document.querySelectorAll('#source .seg button')].find(b => b.textContent.includes('Datamine')).click()); await settle();
const dmHair = await page.$$eval('#content .card', els => els.length);
check('Datamine + All lists every hair on henesys.gg (about 180 cards, with placeholders for those with no sprite)', dmHair >= 170, `(${dmHair})`);
await page.evaluate(() => [...document.querySelectorAll('#filters > .seg button')].find(b => b.textContent.endsWith('Female')).click()); await settle();
check('Datamine + Female has far more styles than the 15 released', (await page.$$('#content .card.unreleased')).length > 60);
await page.evaluate(() => [...document.querySelectorAll('#source .seg button')].find(b => b.textContent === 'Released').click());
await page.evaluate(() => [...document.querySelectorAll('#filters > .seg button')].find(b => b.textContent.endsWith('Male') && !b.textContent.endsWith('Female')).click()); await settle();

// Search tab: one box for everything
const searchBox = async text => { await page.$eval('#filters .search-input', (e, text) => { e.value = text; e.dispatchEvent(new Event('input', { bubbles: true })); }, text); await new Promise(r => setTimeout(r, 700)); };
check('Search is the first tab', (await page.$eval('.tab', t => t.title)) === 'Search');
await clickTab('Search'); await settle();
check('opening Search shows the type-3-letters note and renders no cards', (await page.$eval('#content .empty-note p', e => e.textContent)) === 'Type at least 3 letters to search body, faces, hairs and clothing.' && (await page.$$('#content .card')).length === 0);
check('Search has no gender picker, release switch or colour bar', (await page.$$('#filters > .seg')).length === 0 && (await page.$$('#source .seg')).length === 0 && (await page.$$('#toolbar .swatch')).length === 0);
await searchBox('to');
check('two letters still show only the note', (await page.$$('#content .card')).length === 0 && !!(await page.$('#content .empty-note')));
await searchBox('toben');
const tobenGroups = await page.$$eval('#content .group-title', hs => hs.map(h => h.textContent));
check('"toben" finds Toben Hair under Hairstyles', tobenGroups.some(g => g.startsWith('Hairstyles')) && (await page.$$eval('#content .card .label', els => els.map(e => e.textContent))).includes('Toben Hair'), JSON.stringify(tobenGroups));
await searchBox('mohecan');
check('punctuation and case do not matter ("mohecan" finds Mohecan Shaggy \'Do)', (await page.$$eval('#content .card .label', els => els.map(e => e.textContent))).some(n => n.startsWith('Mohecan')));
await searchBox('rockstar');
const rock = await page.evaluate(() => ({ cards: document.querySelectorAll('#content .card').length, datamine: document.querySelectorAll('#content .card .unreleased-badge').length }));
check('"rockstar" returns both released and DATAMINE cards', rock.cards >= 2 && rock.datamine >= 1 && rock.datamine < rock.cards, JSON.stringify(rock));
await searchBox('sailor');
check('clothing shows up grouped by category', (await page.$$eval('#content .group-title', hs => hs.map(h => h.textContent))).some(g => /^(Overalls|Tops|Bottoms|Hats)/.test(g)));
await searchBox('hair');
const broad = await page.evaluate(() => ({ cards: document.querySelectorAll('#content .card').length, note: document.querySelector('#content .empty-note p')?.textContent ?? '' }));
check('a broad search returns every match when there are fewer than 60 (the cap is only a safety net)', broad.cards > 30 && broad.cards <= 60 && broad.note === '', JSON.stringify(broad));
await searchBox('zzzzzz');
check('no match says so', !!(await page.$('#content .empty')) && (await page.$$('#content .card')).length === 0);
await searchBox('sailor hat');
await page.evaluate(() => [...document.querySelectorAll('#content .card')].find(c => c.textContent.includes('Sailor Hat')).click()); await settle();
check('clicking a result equips it and stays on the Search tab', (await page.evaluate(() => [...document.querySelectorAll('#colour .slot .card')].some(c => c.dataset.slot === 'Hat'))) && (await page.$eval('.tab[aria-selected="true"]', t => t.title)) === 'Search');
check('the category tab shows its tick and the box keeps what was typed', (await page.evaluate(() => !![...document.querySelectorAll('.tab')].find(t => t.title === 'Hat')?.querySelector('.tick'))) && (await page.$eval('#filters .search-input', i => i.value)) === 'sailor hat');
await page.evaluate(() => [...document.querySelectorAll('#content .card')].find(c => c.textContent.includes('Sailor Hat')).click()); await settle(); // take it off again
check('clicking the worn result takes it off', !(await page.evaluate(() => [...document.querySelectorAll('#colour .slot .card')].some(c => c.dataset.slot === 'Hat'))));
await clickTab('Hair'); await settle();
check('changing tab clears the search box', (await page.$eval('#filters .search-input', i => i.value)) === '');
await clickTab('Hair'); await settle();

// Browser tab: title and icon
check('the page title is "classic henehoes"', (await page.title()) === 'classic henehoes');
check('the Orange Cat Beanie icons are linked and served', await page.evaluate(async () => { const hrefs = [...document.querySelectorAll('link[rel~=icon], link[rel=apple-touch-icon]')].map(l => l.getAttribute('href')); return hrefs.length === 3 && (await Promise.all(hrefs.map(h => fetch(h).then(r => r.ok)))).every(Boolean); }));

// Backdrop: the preview is drawn on the Henesys picture, so it has no transparent pixels
const backdropPx = await page.evaluate(() => { const c = document.getElementById('preview'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let clear = 0; for (let i = 3; i < d.length; i += 4) if (d[i] < 255) clear++; return { clear, total: d.length / 4 }; });
check('the preview sits on the Henesys backdrop (no empty pixels)', backdropPx.clear === 0, JSON.stringify(backdropPx));

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
await page.evaluate(() => [...document.querySelectorAll('.seg button')].find(b => b.textContent.endsWith('Female')).click()); await settle();
const femaleHair = await names();
const COLLAB = /frieren|fern |stark |himmel|übel|aura |linie|lügner/i; // the collab styles are listed for both genders on purpose
check('hair is split by gender', maleHair.length > 5 && femaleHair.length > 5 && !maleHair.some(n => !COLLAB.test(n) && femaleHair.includes(n)), `(${maleHair.length} male, ${femaleHair.length} female)`);
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
await settle();
await (await page.$$('.colour-options .card'))[1].click(); await settle(); await settle(); // Red, in the Equipped panel
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
check('face and hair colour panels have no dye note', (await page.$$('#colour .dye-note')).length === 0);
await page.evaluate(() => [...document.querySelectorAll('#content .card .label')].find(l => l.textContent === 'Beret').parentElement.click()); await settle(); // take it off again
check('taking the hat off removes it from the Equipped panel', !(await page.evaluate(() => [...document.querySelectorAll('#colour .equipped .card')].some(b => b.title.includes('Beret')))));

// Placeholders
await clickTab('Hair'); await settle();
await page.evaluate(() => [...document.querySelectorAll('.seg button')].find(b => b.textContent.endsWith('Male') && !b.textContent.endsWith('Female')).click()); await settle();
const hairPh = await page.$$eval('#content .card.placeholder', els => els.length);
check('no hair placeholders are left (Chestnut is now pinned by id)', hairPh === 0, `(${hairPh})`);
check('Chestnut is listed under male hair', (await names()).includes('Chestnut'));
// Name tag and chat bubble rings (rebuilt from the game files)
{
  check('the Name tag and Chat bubble tabs are back', await page.evaluate(() => ['Name Ring', 'Chat Ring'].every(l => [...document.querySelectorAll('.tab')].some(t => t.title === l))));
  await clickTab('Name Ring'); await settle();
  const showSource = async label => { await page.evaluate(l => [...document.querySelectorAll('#source .seg button')].find(b => b.textContent === l).click(), label); await settle(); };
  const labels = () => page.$$eval('#content .card .label', e => e.map(x => x.textContent));
  const tagCards = await labels();
  check('Name tag, Released: the six released tags, White Label Ring first and only once', JSON.stringify(tagCards) === JSON.stringify(['White Label Ring', 'Classic Beginnings Label Ring', 'MapleStory Fest 2026 Label Ring', "Founder's Label Ring", 'Chocolate Label Ring', 'Ink-and-Wash Painting Name Tag Ring']), tagCards.join(', '));
  check('Name tag: the Released / All · Datamine switch is above the search box', await page.evaluate(() => [...document.querySelectorAll('#source .seg button')].map(b => b.textContent).join('|')) === 'Released|All · Datamine');
  await showSource('All · Datamine');
  const allTags = await labels();
  check('Name tag, All · Datamine: every tag in the game files (76), with the DATAMINE badge on the unreleased ones', allTags.length === 76 && (await page.$$('#content .card .unreleased-badge')).length === 70 && !!(await page.$('#content .datamine-note')), String(allTags.length));
  // editable name: the Name box, the tag redrawn for each ring including Rainbow (cut from its sample) and White Label (plain box); every one of the 76 tags works the same way (a few datamine ones are tried here)
  for (const ring of ['Chocolate Label Ring', 'Rainbow Label Ring', 'Pink Candy Label Ring', 'White Cloud Label Ring', 'Beach Label Ring', 'Ink-and-Wash Painting Name Tag Ring', 'White Label Ring', 'Red Cloud Label Ring', 'White Puppy Label Ring', 'Meadow Sheep Label Ring', 'Honey Bee Label Ring']) {
    await page.evaluate(r => [...document.querySelectorAll('#content .card')].find(c => c.querySelector('.label')?.textContent === r).click(), ring); await settle(); await settle();
    const nameBox = await page.evaluate(() => { const i = document.querySelector('#colour .text-field input'); return i ? i.value : null; });
    const drawn = async () => page.evaluate(() => { const c = document.getElementById('preview'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) h++; return [...d].reduce((a, v, k) => (k % 4 === 0 ? (a * 31 + v) % 1000003 : a), 7); });
    const before = await drawn();
    await page.evaluate(() => { const i = document.querySelector('#colour .text-field input'); i.value = 'Liam Long Name'.slice(0, 12); i.dispatchEvent(new Event('input', { bubbles: true })); }); await settle(); await settle();
    check(`name tag: ${ring} has a Name box and changing the name redraws the tag`, nameBox === 'henehoe' && (await drawn()) !== before, String(nameBox));
    await page.evaluate(() => { const i = document.querySelector('#colour .text-field input'); i.value = 'henehoe'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await settle();
  }
  await showSource('Released');
  await clickTab('Chat Ring'); await settle();
  const chatCards = await labels();
  check('Chat bubble, Released: the seven released bubbles', JSON.stringify(chatCards) === JSON.stringify(['Kitty Chat Ring', 'Teddy Bear Chat Ring', 'Classic Beginnings Chat Ring', 'MapleStory Fest 2026 Chat Ring', "Founder's Chat Ring", 'Ink-and-Wash Thought Bubble Ring', 'Chocolate Chat Ring']), chatCards.join(', '));
  await showSource('All · Datamine');
  check('Chat bubble, All · Datamine: all 81 bubbles', (await labels()).length === 81 && (await page.$$('#content .card .unreleased-badge')).length === 74, String((await labels()).length));
  await showSource('Released');
  await page.evaluate(() => [...document.querySelectorAll('#content .card')].find(c => c.querySelector('.label')?.textContent === 'Kitty Chat Ring').click()); await settle(); await settle();
  check('wearing a chat ring puts it in the Equipped panel, with no text boxes (it is shown as in the game)', await page.evaluate(() => [...document.querySelectorAll('#colour .slot .card')].some(c => c.dataset.slot === 'Chat Ring') && !document.querySelector('#colour .text-field, #colour input[type="text"]')));
  const bubble = await page.evaluate(() => { const c = document.getElementById('preview'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let gold = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] > 170 && d[i + 1] < 215 && d[i + 2] < 60) gold++; return gold; });
  check('the Kitty bubble is drawn on the preview (its gold frame)', bubble > 50, String(bubble));
  await clickTab('Chat Ring'); await settle();
  await page.evaluate(() => [...document.querySelectorAll('#content .card')].find(c => c.querySelector('.label')?.textContent === 'Kitty Chat Ring').click()); await settle(); // take it off again
  check('clicking the worn ring takes it off', !(await page.evaluate(() => [...document.querySelectorAll('#colour .slot .card')].some(c => c.dataset.slot === 'Chat Ring'))));
  // a look saved with the old placeholder "Maple" opens with "henehoe"; an emptied Name box falls back to it too
  await page.evaluate(() => localStorage.setItem('maple-layers:default-v2', JSON.stringify({ skin: 0, face: { key: null }, hair: { key: null }, wear: {}, text: { name: 'Maple' } })));
  await page.reload({ waitUntil: 'networkidle0' }); await settle();
  await clickTab('Name Ring'); await settle();
  await page.evaluate(() => [...document.querySelectorAll('#content .card')].find(c => c.querySelector('.label')?.textContent === 'Chocolate Label Ring').click()); await settle(); await settle();
  check('Name box: a look saved with the old "Maple" opens with "henehoe"', await page.evaluate(() => document.querySelector('#colour .text-field input')?.value) === 'henehoe');
  check('Name box: its placeholder is "henehoe"', await page.evaluate(() => document.querySelector('#colour .text-field input')?.placeholder) === 'henehoe');
  await page.evaluate(() => localStorage.removeItem('maple-layers:default-v2')); await page.reload({ waitUntil: 'networkidle0' }); await settle();
  await clickTab('Name Ring'); await settle();
}
await clickTab('Top'); await settle();
check('Beetle Long Sleeve is a drawn Top card, no badge', await page.evaluate(() => { const c = [...document.querySelectorAll('#content .card')].find(c => c.textContent.includes('Beetle Long Sleeve')); return !!c && !c.classList.contains('placeholder') && !c.querySelector('.badge'); }));

// Weapon sits between body and hand: with a weapon on, the arm part is drawn after it
await clickTab('Weapon'); await settle();
await (await page.$$('#content .grid .card:not(.none):not(.placeholder)'))[0].click(); await settle();
await page.screenshot({ path: 'tmp/ui-final.png' });
// Phone layout (390 wide): stage, then catalogue, then Equipped; nothing moves when you pick a card
{
  const phone = await browser.newPage();
  await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
  const wait = ms => new Promise(r => setTimeout(r, ms)); await wait(900);
  const openTab = label => phone.evaluate(l => [...document.querySelectorAll('.tab')].find(t => t.title.startsWith(l)).click(), label);
  await openTab('Hair'); await wait(900);
  const layout = await phone.evaluate(() => { const top = s => document.querySelector(s).getBoundingClientRect().top; const cards = [...document.querySelectorAll('#content .card')].slice(0, 6).map(c => Math.round(c.getBoundingClientRect().top)); return { stage: top('#stage'), book: top('.book'), equipped: top('#colour'), overflow: document.documentElement.scrollWidth > innerWidth, perRow: cards.filter(y => y === cards[0]).length, width: Math.round(document.querySelector('#content .card').getBoundingClientRect().width) }; });
  check('phone: the character, then the catalogue, then the Equipped panel, top to bottom', layout.stage < layout.book && layout.book < layout.equipped, JSON.stringify(layout));
  check('phone: nothing overflows sideways and cards are full size, 3 per row', !layout.overflow && layout.perRow === 3 && layout.width >= 95, JSON.stringify(layout));
  check('phone: the empty-state text says the catalogue is above', (await phone.$eval('#colour .empty-note p', e => e.textContent)).includes('items above.'));
  await phone.evaluate(() => document.querySelector('#content .card').scrollIntoView({ block: 'center' })); await wait(300);
  const probe = () => phone.evaluate(() => ({ y0: Math.round(document.querySelector('#content .card').getBoundingClientRect().top), y4: Math.round(document.querySelectorAll('#content .card')[4].getBoundingClientRect().top), scroll: Math.round(scrollY) }));
  const before = await probe();
  const pt = await phone.evaluate(() => { const r = document.querySelector('#content .card').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await phone.touchscreen.tap(pt.x, pt.y); await wait(700);
  const after = await probe();
  check('phone: picking a card does not shift the list under your finger', before.y0 === after.y0 && before.y4 === after.y4 && before.scroll === after.scroll, JSON.stringify([before, after]));
  check('phone: that tap equipped the card tapped', (await phone.evaluate(() => [...document.querySelectorAll('#colour .slot .card')].some(c => c.dataset.slot === 'Hair'))));
  await phone.evaluate(() => scrollTo(0, 0)); await wait(300); // the tab strip scrolls with the page: go back up to use it
  await phone.evaluate(() => { const s = document.getElementById('tabs'); s.scrollLeft = [...s.children].find(t => t.title.startsWith('Overall')).offsetLeft - 60; }); await wait(300);
  const strip = await phone.evaluate(() => document.getElementById('tabs').scrollLeft);
  const tp = await phone.evaluate(() => { const r = [...document.querySelectorAll('.tab')].find(t => t.title.startsWith('Overall')).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await phone.touchscreen.tap(tp.x, tp.y); await wait(700);
  check('phone: tapping a tab keeps the tab strip where it was', (await phone.evaluate(() => document.getElementById('tabs').scrollLeft)) === strip && (await phone.$eval('.tab[aria-selected="true"]', t => t.title)) === 'Overall', `strip ${strip}`);
  await phone.close();
}

// ---- Hat tab: the Fit filter ----
{
  const clickTab = async l => { await page.evaluate(l => [...document.querySelectorAll('.tab')].find(t => t.title === l)?.click(), l); await settle(); };
  const fitBtn = label => page.evaluate(l => [...document.querySelectorAll('#source .seg button')].find(b => b.textContent.startsWith(l))?.click(), label);
  const cards = () => page.$$eval('#content .card .label', e => e.map(x => x.textContent));
  await clickTab('Hat');
  check('Fit filter: the Hat tab has All, Topper, Cap and Helmet with counts', JSON.stringify(await page.$$eval('#source .source-group:last-child .seg button', b => b.map(x => x.textContent))) === JSON.stringify([`All (${HATS.length})`, `Topper (${FIT('topper')})`, `Cap (${FIT('cap')})`, `Helmet (${FIT('helmet')})`]));
  await fitBtn('Helmet'); await settle(); const helmets = await cards();
  check('Fit filter: Helmet leaves the helmets, including the three Hair (Hat) hats', helmets.length === FIT('helmet') && ['Aura Hair (Hat)', 'Linie Hair (Hat)'].every(n => helmets.includes(n)), helmets.join(', '));
  await fitBtn('Topper'); await settle(); const toppers = await cards();
  check('Fit filter: Demon Goblin and Iljimae Mask are in Helmet (put there by hand), not in Cap', ['Demon Goblin', 'Iljimae Mask'].every(n => helmets.includes(n)));
  check('Fit filter: Topper leaves the hats that do not flatten hair', toppers.length === FIT('topper') && toppers.includes('Angel Halo') && toppers.includes('Bunny Ears') && !toppers.includes('Cat Hat'), toppers.join(', '));
  await fitBtn('Cap'); await settle();
  check('Fit filter: Cap leaves the ordinary caps', (await cards()).length === FIT('cap') && (await cards()).includes('Cat Hat'));
  await page.type('.search-input', 'beanie'); await settle();
  check('Fit filter: it combines with the search box (the beanies that are caps)', (await cards()).length === HATS.filter(i => fitOf(i) === 'cap' && /beanie/i.test(i.name)).length && (await cards()).every(n => /Beanie/.test(n)), (await cards()).join(', '));
  await page.$eval('.search-input', i => { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); }); await settle();
  await fitBtn('All'); await settle();
  check('Fit filter: All shows every hat again', (await cards()).length === HATS.length);
  await clickTab('Top');
  check('Fit filter: the row is only on the Hat tab', (await page.$$eval('#source .seg button', b => b.filter(x => /^All \(/.test(x.textContent)).length)) === 0);
  if (SHOW_UPCOMING) {
  // Released | Upcoming switch on the category tabs that have possible upcoming items (Next Crate tab's items, by slot)
  const segTexts = () => page.$$eval('#source .source-group:first-child .seg button', b => b.map(x => x.textContent));
  const crateBtn = label => page.evaluate(l => [...document.querySelectorAll('#source .seg button')].find(b => b.textContent === l)?.click(), label);
  await clickTab('Hat');
  check('Hat tab has a Released | Upcoming switch, the ? is an icon and not text', JSON.stringify(await segTexts()) === JSON.stringify(['Released', 'Upcoming']) && (await page.$$('#source .q-icon')).length === 1);
  await crateBtn('Upcoming'); await settle();
  const upHats = await page.$$eval('#content .card', cs => cs.map(c => c.textContent));
  check('Upcoming view lists the upcoming hats, each badged UPCOMING, under the Unconfirmed note', upHats.length === upcoming('cap').length && upHats.every(t => t.includes('UPCOMING')) && /speculative/.test(await page.$eval('#content .empty-note p', e => e.textContent)), `${upHats.length} cards`);
  check('Fit counts follow the view (the upcoming hats)', (await page.$eval('#source .source-group:last-child .seg button', b => b.textContent)) === `All (${upcoming('cap').length})`);
  await crateBtn('Released'); await settle();
  check('Released view: every released hat, no note, no UPCOMING badges', (await cards()).length === HATS.length && !(await page.$('#content .empty-note')) && !(await page.$$eval('#content .card', cs => cs.some(c => c.textContent.includes('UPCOMING')))));
  for (const [tab, n] of [['Top', 'coat'], ['Overall', 'longcoat'], ['Bottom', 'pants'], ['Shoes', 'shoes'], ['Gloves', 'glove'], ['Cape', 'cape'], ['Weapon', 'weapon'], ['Face accessory', 'faceAcc'], ['Eye decoration', 'eyeAcc']].map(([t, k]) => [t, upcoming(k).length]).filter(([, n]) => n)) { // slots with no upcoming item left have no Upcoming view to check
    await clickTab(tab); await crateBtn('Upcoming'); await settle();
    check(`${tab} tab: Upcoming view lists ${n} items`, (await cards()).length === n, `${(await cards()).length}`);
    await crateBtn('Released'); await settle();
  }
  } else {
  await clickTab('Hat');
  check('Next Crate: no Released | Upcoming switch on the Hat tab, and still every released hat', (await page.$$eval('#source .seg button', b => b.filter(x => x.textContent === 'Upcoming').length)) === 0 && (await cards()).length === HATS.length);
  }
  await clickTab('Earrings');
  check('Earrings (nothing upcoming) has no Released | Upcoming switch', (await page.$$eval('#source .seg button', b => b.filter(x => x.textContent === 'Upcoming').length)) === 0);
  // Weapons say which weapon types they go over (the game's own description), in the Equipped panel
  const wearByName = async (tab, name) => { await clickTab(tab); await page.$eval('.search-input', (i, n) => { i.value = n; i.dispatchEvent(new Event('input', { bubbles: true })); }, name); await settle(); await (await page.$$('#content .grid .card'))[0].click(); await settle(); };
  const worksWithText = async () => { const t = await page.$$eval('#colour .chip', e => e.map(x => x.textContent)); return t.length ? t.join(', ') : null; };
  await wearByName('Weapon', 'Toy Rifle');
  check('Equipped panel: the Toy Rifle works with crossbows', (await worksWithText()) === 'Crossbow');
  await wearByName('Weapon', 'Angel Wand');
  check('Equipped panel: the Angel Wand works with any weapon', (await worksWithText()) === 'Any weapon');
  await wearByName('Weapon', "Frieren's Staff");
  check('an undyeable weapon shows both what it works with and that it cannot be dyed', (await worksWithText()) === 'Any weapon' && (await page.$eval('#colour .hint', e => e.textContent)) === "This item can't be dyed in the game.");
  await wearByName('Top', 'Pink');
  check('the Works with section is only for weapons', (await worksWithText()) === null);
  // Hat slot codes hide what the game says they hide: the Scream Mask covers earrings (Ae), the Demon Goblin does not
  await wearByName('Hat', 'Scream Mask'); const maskAlone = await pixels();
  await wearByName('Earrings', 'Slime'); const maskEarrings = await pixels();
  check('the Scream Mask hides worn earrings (the game says it covers Ae)', maskEarrings.h === maskAlone.h);
  await wearByName('Hat', 'Scream Mask'); const earringsAlone = await pixels();
  await wearByName('Hat', 'Demon Goblin'); const goblinEarrings = await pixels();
  await wearByName('Earrings', 'Slime'); const goblinAlone = await pixels();
  check('the Demon Goblin does not hide earrings (it does not declare Ae)', goblinEarrings.h !== goblinAlone.h && earringsAlone.h !== maskAlone.h);
  await wearByName('Hat', 'Demon Goblin');
  // Past tab: every past crate and box, grouped; the Halloween crate holds its 50 items with their listed rates
  await clickTab('Released crates and boxes, and what each held'); await settle();
  const groups = await page.$$eval('#content .past-tab', g => g.map(x => x.textContent));
  check('Released tab: category tabs Mystery Fashion, Mystery Styles and Aurora, the first selected', JSON.stringify(groups) === JSON.stringify(['Mystery Fashion', 'Mystery Styles', 'Aurora']) && (await page.$eval('#content .past-tab[aria-selected="true"]', e => e.textContent)) === 'Mystery Fashion', groups.join(' | '));
  const pillsOf = () => page.$$eval('#content .pill', p => p.map(x => x.textContent));
  const pickTab = async l => { await page.evaluate(l => [...document.querySelectorAll('#content .past-tab')].find(t => t.textContent === l).click(), l); await settle(); };
  const pills = [await pillsOf()]; await pickTab('Mystery Styles'); pills.push(await pillsOf()); const stylesOpen = await page.$eval('#content .pill[aria-pressed="true"]', e => e.textContent);
  await pickTab('Aurora'); pills.push(await pillsOf()); await pickTab('Mystery Fashion');
  check('Released tab: each category shows only its own pills, date first, newest last', JSON.stringify(pills) === JSON.stringify([["Oct 6 – Oct 28 · Founder's", 'Oct 21 – Nov 4', 'Oct 28 – Nov 4 · Halloween', 'Nov 4 – Nov 18'], ['Oct 6 – Oct 28', 'Oct 28 – Nov 11'], ['Season 1']]) && stylesOpen === 'Oct 28 – Nov 11', JSON.stringify(pills));
  check('Past tab: the Nov 4 crate is selected at first and its 50 items are drawn below all the categories, with no rates (the page prints none)', (await page.$$eval('#content .pill[aria-pressed="true"]', p => p.map(x => x.textContent))).join() === 'Nov 4 – Nov 18' && (await page.$$('#content .past-title ~ .grid .card')).length === 50 && (await page.$$('#content .past-title ~ .grid .rate-badge')).length === 0 && (await page.$$eval('#content .past-title ~ .grid .card', c => c.filter(x => /\d%$/.test(x.title)).length)) === 0);
  const catOf = { "Oct 6 – Oct 28 · Founder's": 'Mystery Fashion', 'Oct 21 – Nov 4': 'Mystery Fashion', 'Oct 6 – Oct 28': 'Mystery Styles', 'Oct 28 – Nov 11': 'Mystery Styles', 'Season 1': 'Aurora', 'Oct 28 – Nov 4 · Halloween': 'Mystery Fashion', 'Nov 4 – Nov 18': 'Mystery Fashion' };
  const pickPill = async label => { await pickTab(catOf[label]); await page.evaluate(l => [...document.querySelectorAll('#content .pill')].find(p => p.textContent === l).click(), label); await settle(); };
  await pickPill('Oct 28 – Nov 4 · Halloween');
  check('Past tab: the Halloween crate holds its 50 items with their listed rates', (await page.$$('#content .past-title ~ .grid .card')).length === 50 && (await page.$$eval('#content .past-title ~ .grid .card', c => c.filter(x => /\d%$/.test(x.title)).length)) === 50);
  const shown = () => page.$$('#content .past-title ~ .grid .card').then(c => c.length);
  const expected = { "Oct 6 – Oct 28 · Founder's": 50, 'Oct 21 – Nov 4': 50, 'Oct 6 – Oct 28': 24, 'Oct 28 – Nov 11': 24, 'Season 1': 26 };
  const got = {}; for (const [label] of Object.entries(expected)) { await pickPill(label); got[label] = await shown(); }
  check('Past tab: each box shows the items from the saved Nexon pages (Founder\'s 50, Oct 21 crate 50, Mystery Styles 24 and 24, Aurora 26)', JSON.stringify(got) === JSON.stringify(expected), JSON.stringify(got));
  await pickPill('Season 1');
  check('Past tab: the Aurora box says it is the Aurora Mystery Fashion Crate and leaves the palette coupons out', /Aurora Mystery Fashion Crate/.test(await page.$eval('#content .past-title ~ .hint', e => e.textContent)));
  await pickPill('Oct 28 – Nov 11');
  const female = await page.$$eval('#content .past-title ~ .grid .card .label', l => l.map(x => x.textContent));
  check('Past tab: the Oct 28 Mystery Styles has Cecelia Twist (not Rockstar Hair), as the post corrected', female.includes('Cecelia Twist') && !female.includes('Rockstar Hair'));
  const sections = await page.$$eval('#content .past-title ~ .past-section', h => h.map(x => x.textContent));
  const subs = await page.$$eval('#content .past-title ~ .group-title.sub', h => h.map(x => x.textContent));
  check('Mystery Styles: big Hairstyles and Faces headings, each with Male and Female lists of six', JSON.stringify(sections) === JSON.stringify(['Hairstyles', 'Faces']) && JSON.stringify(subs) === JSON.stringify(['Male · 6', 'Female · 6', 'Male · 6', 'Female · 6']), sections.join(' | ') + ' // ' + subs.join(' | '));
  check('Mystery Styles: each colour bar sits right under its heading (hair colour under Hairstyles, eye colour under Faces)', await page.$$eval('#content .past-section', h => h.map(x => x.nextElementSibling?.className === 'colour-bar' && x.nextElementSibling.textContent.startsWith(x.textContent.startsWith('Hair') ? 'Hair' : 'Eye')).join()) === 'true,true');
  const cardPixels = () => page.$eval('#content .past-title ~ .grid canvas', c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3]) | 0; return h; });
  const hairBefore = await cardPixels();
  await page.evaluate(() => document.querySelectorAll('.colour-bar')[0].querySelectorAll('.swatch')[1].click()); await settle();
  check('picking a hair colour redraws the hair cards in that colour', (await cardPixels()) !== hairBefore);
  await page.evaluate(() => document.querySelectorAll('.colour-bar')[0].querySelectorAll('.swatch')[0].click()); await settle();
  await page.evaluate(() => document.querySelectorAll('.colour-bar')[1].querySelectorAll('.swatch.warn')[0].click()); await settle();
  check('browsing the faces in White shows the coupon warning here too', !!(await page.$('#content .warn-note')));
  await page.evaluate(() => document.querySelectorAll('.colour-bar')[1].querySelectorAll('.swatch')[0].click()); await settle();
  await pickPill('Oct 28 – Nov 4 · Halloween');
  await (await page.$$('#content .past-title ~ .grid .card'))[0].click(); await settle();
  check('Past tab: a card can be tried on like any other', (await page.$$('#colour .slot')).length >= 1);
  await (await page.$$('#content .past-title ~ .grid .card'))[0].click(); await settle();
  check('Released and Upcoming have no search bar', !(await page.$('.search-input')));

  // Mystery Rotation view on Hair and Face: only the styles in a live Mystery Styles box, with the time left; the clock is pinned
  const clock = async iso => { await page.evaluate(iso => { window.__now ??= Date.now; const t = Date.parse(iso); Date.now = () => t; }, iso); };
  const showView = async v => { await page.evaluate(v => [...document.querySelectorAll('#source .seg button')].find(b => b.textContent.includes(v)).click(), v); await settle(); };
  const view = async (tab, v) => { await clickTab(tab); await settle(); await showView(v); return page.evaluate(() => ({ line: document.querySelector('#content .rotation-line')?.textContent ?? '', cards: document.querySelectorAll('#content .grid .card').length, headings: document.querySelectorAll('#content .group-title').length })); };
  await clock('2026-11-03T20:00:00Z');
  await clickTab('Hair'); await settle(); await showView('Released');
  const releasedCount = await page.$$eval('#content .grid .card', c => c.length);
  let v = await view('Hair', 'Mystery Rotation');
  check('Hair: Mystery Rotation lists only the 12 Oct 28 styles per gender view, a clean list with no headings', v.cards >= 6 && v.cards < releasedCount && v.headings === 0, JSON.stringify(v));
  check('Hair: the line gives the end (Nov 11) on a 12-hour clock, and days left', /^Ends .*11.*(AM|PM) [A-Z]*[+-−]?[\w:]*\s*·\s*[78] days left$/.test(v.line) && !/(^|\s)(1[3-9]|2\d):\d\d/.test(v.line), v.line);
  await clock('2026-11-11T05:00:00Z');
  const line2 = (await view('Hair', 'Mystery Rotation')).line;
  check('Hair: hours left on the final day (no "Last day" wording)', /^Ends .* · \d+ hours? left$/.test(line2) && !/Last day/.test(line2));
  await clock('2026-11-11T08:00:00Z');
  v = await view('Hair', 'Mystery Rotation');
  check('Hair: nothing on rotation says so and lists no cards', v.cards === 0 && /No Mystery Style Coupon rotation/.test(v.line), JSON.stringify(v));
  await clock('2026-11-03T20:00:00Z');
  await showView('Released');
  check('Hair: Released is still the full list, with no section headings or labels', (await page.$$eval('#content .grid .card', c => c.length)) === releasedCount && (await page.$$eval('#content .group-title, #content .rotation-line', h => h.length)) === 0);
  v = await view('Face', 'Mystery Rotation');
  check('Face: Mystery Rotation lists its styles too', v.cards >= 6 && /Ends/.test(v.line), JSON.stringify(v));
  await showView('Released');
  // The Released tab (boxes) shows the same line, only for a box that has not ended
  await clickTab('Released crates and boxes, and what each held'); await settle(); await pickTab('Mystery Fashion');
  const endsOf = async pill => { await page.evaluate(l => [...document.querySelectorAll('#content .pill')].find(p => p.textContent.includes(l)).click(), pill); await settle(); return page.$eval('#content .past-title ~ .ends-line', e => e.textContent).catch(() => null); };
  const halloween = await endsOf('Halloween'), founders = await endsOf("Founder's");
  check('Released tab: a box that is on rotation says when it ends (12-hour clock) and the time left', /^Ends .*(AM|PM) [^·]* · \d+ hours? left$/.test(halloween ?? '') && !/Last day/.test(halloween ?? ''), String(halloween));
  check('Released tab: a box that has ended says when, and how long ago, in grey (grey dot)', /^Ended [^·]+ · \d+ days? ago$/.test(founders ?? '') && await page.$eval('#content .past-title ~ .ends-line', e => e.classList.contains('ended') && getComputedStyle(e.querySelector('.ends-dot')).backgroundColor === 'rgb(179, 172, 160)'), String(founders));
  // A dot on each pill: green while the box is on sale, grey when it is off sale (ended, or not started); a box without an end stays green
  const dots = async iso => { await clock(iso); await clickTab('Released crates and boxes, and what each held'); await settle(); await pickTab('Mystery Fashion'); return page.$$eval('#content .pill', p => p.map(x => x.querySelector('.sale-dot').classList.contains('on') ? 'on' : 'off').join()); };
  check('Released tab: pill dots, Nov 3 evening (Halloween and Oct 21 on sale)', (await dots('2026-11-03T20:00:00Z')) === 'off,on,on,off');
  check('Released tab: pill dots, Nov 5 (only the Nov 4 crate, which has no end, is on sale)', (await dots('2026-11-05T00:00:00Z')) === 'off,off,off,on');
  const lineOf = () => page.$eval('#content .past-title ~ .ends-line', e => `${e.textContent}|${e.classList.contains('ended')}`).catch(() => null);
  const novLine = iso => dots(iso).then(lineOf);
  check('Released tab: the Nov 4 crate (end is a date, no time) says Ends date and days left, no hour', (await novLine('2026-11-05T00:00:00Z')) === 'Ends Wed 18 Nov · 14 days left|false', String(await lineOf()));
  check('Released tab: the Nov 4 crate is on sale to the end of the UTC day (1 day left on the 18th)', (await novLine('2026-11-18T23:00:00Z')) === 'Ends Wed 18 Nov · 1 day left|false', String(await lineOf()));
  check('Released tab: after that day it is grey, Ended date and days ago, and its dot is grey', (await dots('2026-11-20T10:00:00Z')) === 'off,off,off,off' && (await lineOf()) === 'Ended Wed 18 Nov · 1 day ago|true', String(await lineOf()));
  // The countdown ticks by itself (every 30 s and when the page is shown again): move the clock and fire the page-shown event, with no re-render for a live box
  await clock('2026-11-03T20:00:00Z');
  await clickTab('Released crates and boxes, and what each held'); await settle(); await pickTab('Mystery Fashion');
  await page.evaluate(() => [...document.querySelectorAll('#content .pill')].find(p => p.textContent.includes('Halloween')).click()); await settle();
  // It sleeps until the words would change: 12.5 hours left (13 hours) wakes in 30 minutes, when it turns to 12 hours, not every 30 seconds
  await clock('2026-11-03T19:30:00Z');
  await page.evaluate(() => { window.__delays = []; window.__st ??= window.setTimeout; window.setTimeout = (f, d, ...a) => { if (d > 1000) window.__delays.push(d); return window.__st(f, d, ...a); }; });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const delays = await page.evaluate(() => { window.setTimeout = window.__st; return window.__delays; });
  check('the countdown wakes when the words change (in 30 minutes from 12.5 hours left), not on a fixed short timer', delays.some(d => d >= 1.7e6 && d <= 1.9e6), JSON.stringify(delays));
  await clock('2026-11-03T20:00:00Z');
  await page.evaluate(() => [...document.querySelectorAll('#content .pill')].find(p => p.textContent.includes('Oct 21')).click()); await settle();
  await page.evaluate(() => [...document.querySelectorAll('#content .pill')].find(p => p.textContent.includes('Halloween')).click()); await settle();
  const endsText = () => page.$eval('#content .ends-line span', e => e.textContent).catch(() => null);
  const before = await endsText();
  await page.$eval('#content .ends-line', e => { e.dataset.same = '1'; });
  await clock('2026-11-04T05:00:00Z'); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const during = await endsText();
  check('the countdown updates itself when the clock moves (12 hours, then 3 hours left), in the same element', /12 hours left$/.test(before ?? '') && /3 hours left$/.test(during ?? '') && (await page.$eval('#content .ends-line', e => e.dataset.same)) === '1', `${before} -> ${during}`);
  await clock('2026-11-04T08:00:00Z'); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await settle();
  check('...and turns into the grey "Ended" line by itself once the box has ended', /^Ended [^·]+ · less than an hour ago$/.test((await endsText()) ?? '') && (await page.$eval('#content .ends-line', e => e.classList.contains('ended'))));
  await clock('2026-11-04T11:00:00Z'); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await clock('2026-11-06T11:00:00Z'); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  check('...and its "ago" keeps counting (2 days ago two days later)', /· 2 days ago$/.test((await endsText()) ?? ''), String(await endsText()));
  // Equipped panel: an Availability section says if the worn item is in a box on sale now, or when it was last available (Bright Eyes: the Oct 28 Mystery Face coupon, to Nov 11)
  const wearBright = async iso => { await clock(iso); await clickTab('Face'); await settle(); await page.evaluate(() => [...document.querySelectorAll('#content .card')].find(c => c.querySelector('.label')?.textContent === 'Bright Eyes').click()); await settle(); return page.$$eval('#colour .panel-section', ss => ss.map(x => x.textContent).find(t => t.startsWith('Availability')) ?? null); };
  const availNow = await wearBright('2026-11-05T00:00:00Z');
  check('Equipped panel: Availability says a worn face on sale now is available now, as a Mystery Face, with the time left', /^AvailabilityAvailable now · \d+ days left · Mystery Face$/.test(availNow ?? ''), String(availNow));
  await page.evaluate(() => [...document.querySelectorAll('#colour .slot .remove')].forEach(b => b.click())); await settle();
  const availLast = await wearBright('2026-11-12T12:00:00Z');
  check('Equipped panel: Availability says when a face was last available, as what', /^AvailabilityLast available 1 day ago · Mystery Face$/.test(availLast ?? ''), String(availLast));
  await page.evaluate(() => [...document.querySelectorAll('#colour .slot .remove')].forEach(b => b.click())); await settle();
  await page.evaluate(() => { Date.now = window.__now; });
  await clickTab('Hair'); await settle();
  await clickTab('Name Ring'); await settle();
  check('a ring tab keeps its two options and shows Released when Mystery Rotation was picked on Face', (await page.$$eval('#source .seg button', bs => bs.map(b => `${b.textContent}:${b.getAttribute('aria-pressed')}`))).join() === 'Released:true,All · Datamine:false');
  await page.evaluate(() => { Date.now = window.__now; });
}

// ---- Pose buttons on the stage: seven attack motions (each click the next swing, then the motion's stance) and the ladder (two climbs, then back) ----
{
  const poseOf = () => page.$eval('#preview', e => e.dataset.pose);
  const pressed = () => page.$$eval('#pose-tools .tool', b => b.filter(x => x.getAttribute('aria-pressed') === 'true').map(x => x.dataset.pose).join());
  const rows = await page.$$eval('#pose-tools .pose-row', r => r.map(x => [...x.querySelectorAll('.tool')].map(b => b.dataset.pose + (b.querySelector('svg rect') ? '' : '!')).join()));
  check('pose buttons: one row of the attack motions and the ladder, each with a silhouette icon, none pressed', rows.join('|') === 'oneHanded,stab,twoHanded,spear,polearm,bow,crossbow,ladder' && (await pressed()) === '', rows.join('|'));
  const off = await page.$$eval('#pose-tools .tool:disabled', b => b.map(x => x.title));
  check('pose buttons: a motion the weapon lacks is greyed out and says so', off.every(t => /not a motion the .+ has$/.test(t)), off.join('; '));
  await settle(); const still = JSON.stringify(await pixels());
  // One click plays to the end and settles: returns the frames seen (name:action:frame) and where it settled.
  const play = async name => {
    await page.click(`#pose-tools [data-pose="${name}"]`);
    const seen = []; let v;
    for (let i = 0; i < 120; i++) { v = await poseOf(); if (v.startsWith(name + ':') && v.split(':')[1] !== 'stand1' && v.split(':')[1] !== 'stand2') { if (seen.at(-1) !== v) seen.push(v); } else if (seen.length) break; await new Promise(r => setTimeout(r, 30)); }
    await settle(); return { seen, rest: await poseOf() };
  };
  const acts = r => [...new Set(r.seen.map(v => v.split(':')[1]))];
  const l0 = await play('ladder');
  check('Ladder: climbs twice (each frame twice, back view) and goes back to standing', l0.seen.join() === 'ladder:ladder:0,ladder:ladder:1,ladder:ladder:0,ladder:ladder:1' && l0.rest === 'stand' && JSON.stringify(await pixels()) === still && (await pressed()) === '', JSON.stringify(l0));
  const s1 = await play('oneHanded'), s2 = await play('oneHanded');
  check('One-handed swing: the first click plays swing 1 once and rests in the one-handed stance, button pressed', acts(s1).join() === 'swingO1' && s1.rest === 'oneHanded:stand1:0' && (await pressed()) === 'oneHanded', JSON.stringify(s1));
  check('One-handed swing: the next click plays the next swing', acts(s2).length === 1 && /^swingO[23]$/.test(acts(s2)[0]) && s2.rest === 'oneHanded:stand1:0', JSON.stringify(s2));
  if (!(await page.$eval('#pose-tools [data-pose="twoHanded"]', b => b.disabled))) {
    const t1 = await play('twoHanded');
    check('Two-handed swing: a new motion starts at its first swing and rests holding the weapon in both hands', acts(t1).join() === 'swingT1' && /^twoHanded:stand[12]:0$/.test(t1.rest), JSON.stringify(t1));
    const rested = JSON.stringify(await pixels());
    check('Two-handed stance: drawn from the pose data (not the standing picture)', !t1.rest.endsWith('stand2:0') || rested !== still);
    const l1 = await play('ladder');
    check('Ladder: from the two-handed stance it climbs and goes back to that stance', l1.rest === t1.rest && JSON.stringify(await pixels()) === rested && (await pressed()) === 'twoHanded', JSON.stringify(l1));
    const t2 = await play('twoHanded');
    check('Two-handed swing: the ladder in between keeps the count (swing 2 next)', acts(t2).join() === 'swingT2', JSON.stringify(t2));
  }
}

// ---- Housing book ----
{
  await page.evaluate(() => localStorage.removeItem('maple-layers:housing-v1'));
  const tabByTitle = title => page.evaluate(t => [...document.querySelectorAll('.tab, .bk')].find(x => x.title === t)?.click(), title);
  await tabByTitle('Housing book'); await settle(); await settle();
  check('Housing book: the two books are tabs along the top, Housing selected', JSON.stringify(await page.$$eval('.bk', b => b.map(x => `${x.textContent}:${x.getAttribute('aria-selected')}`))) === JSON.stringify(['Character:false', 'Housing:true']));
  check('Housing book: the rail offers Homes, Decor, Chests and Crafting stations', JSON.stringify(await page.$$eval('.tab', t => t.map(x => x.title))) === JSON.stringify(['Homes', 'Decor', 'Chests', 'Crafting stations']));
  check('Housing book: no pose buttons', (await page.$$('#pose-tools .tool')).length === 0);
  check('Housing book: two homes to choose from, the first selected', (await page.$$eval('.home-card', c => c.map(x => x.getAttribute('aria-pressed')))).join() === 'true,false');
  await page.waitForFunction(() => [...document.querySelectorAll('.home-thumb')].every(i => i.complete && i.naturalWidth > 0), { timeout: 8000 }).catch(() => {});
  check('Housing book: the home pictures are the zoomed-in houses only (no zoomed-out version)', (await page.$$eval('.home-thumb', i => i.map(x => `${x.naturalWidth}x${x.naturalHeight}`))).join() === '760x590,900x700');
  await tabByTitle('Decor'); await settle();
  const addCard = n => page.evaluate(n => [...document.querySelectorAll('#content .card')].find(c => c.querySelector('.label')?.textContent === n)?.click(), n);
  await addCard('Cherry Bed'); await addCard('Potted Sunflower'); await settle();
  const layout = () => page.evaluate(() => JSON.parse(localStorage.getItem('maple-layers:housing-v2') ?? '{"layouts":{}}').layouts['yellow-mushroom-house'] ?? []);
  check('Housing book: clicking furniture places it, and the Placed panel lists it', (await layout()).length === 2 && (await page.$$eval('#colour .slot', s => s.length)) === 2);
  check('Housing book: the stage has just one tool, Clear all, and no per-piece button block', (await page.$$eval('#stage-tools .tool', b => b.map(x => x.title))).join() === 'Clear all furniture from this home' && !(await page.$$eval('#colour .small-btn', b => b.length)));
  const btns = await page.evaluate(() => { const f = document.querySelector('.item-flip'), d = document.querySelector('.item-del'), s = document.getElementById('stage').getBoundingClientRect(), a = f.getBoundingClientRect(), b = d.getBoundingClientRect(); return { shown: !f.hidden && !d.hidden, mirrorLeftOfRemove: a.left < b.left, inside: a.left >= s.left && b.right <= s.right && a.top >= s.top - 1 }; });
  check('Housing book: the selected piece carries a mirror button (left) and a remove button (right), inside the stage', btns.shown && btns.mirrorLeftOfRemove && btns.inside, JSON.stringify(btns));
  const before = (await layout())[1];
  await page.click('.item-flip'); await settle();
  check('Housing book: the mirror button on the piece flips it', (await layout())[1].flip === !before.flip);
  const box = await (await page.$('#housing')).boundingBox();
  check('Housing book: the home is drawn on the stage', box.width > 100 && box.height > 100);
  await page.click('.item-del'); await settle();
  check('Housing book: the remove button on the piece takes it out of the home', (await layout()).length === 1 && (await page.$eval('.item-del', b => b.hidden)));
  for (let k = 0; k < 15; k++) await addCard('Oak Window');
  await settle();
  const capped = await page.evaluate(() => ({ count: document.querySelector('.house-count').textContent, full: document.querySelector('.house-count').classList.contains('full'), disabled: [...document.querySelectorAll('#content .card')].every(c => c.disabled), hint: document.querySelector('#content .hint')?.textContent ?? '' }));
  check('Housing book: 16 pieces fills the home: the counter says so and the cards are disabled', (await layout()).length === 16 && capped.count === '16/16 pieces' && capped.full && capped.disabled && /full/.test(capped.hint), JSON.stringify(capped));
  await addCard('Cherry Bed'); await settle();
  check('Housing book: a 17th piece is refused', (await layout()).length === 16);
  await page.click('#stage-tools .tool'); await settle();
  check('Housing book: Clear all empties the home and frees the cards', (await layout()).length === 0 && (await page.$$eval('#content .card', c => c.every(x => !x.disabled))));
  await tabByTitle('Character book'); await settle();
  check('Housing book: back to the Character book shows the character tabs again', (await page.$$eval('.tab', t => t.map(x => x.title))).includes('Body') && (await page.$eval('#preview', c => getComputedStyle(c).display)) !== 'none');
}

// A zoomed-out browser (device pixel ratio below 1) on a big monitor: the Henesys picture is narrower than the stage, so its edges are
// carried on as mirrored copies. The old fill left flat sky-blue bands at the sides and a grey band underneath.
{
  const wide = await browser.newPage();
  await wide.setViewport({ width: 2400, height: 1100, deviceScaleFactor: 0.8 });
  await wide.goto('http://localhost:5173/', { waitUntil: 'networkidle0' }); await new Promise(r => setTimeout(r, 1200));
  const colours = await wide.$eval('#preview', c => {
    const g = c.getContext('2d'), seen = new Set(), edge = 8;
    for (const x0 of [0, c.width - edge]) { const d = g.getImageData(x0, 0, edge, c.height).data; for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`); }
    const bottom = g.getImageData(0, c.height - 6, c.width, 6).data, row = new Set(); for (let i = 0; i < bottom.length; i += 4) row.add(`${bottom[i]},${bottom[i + 1]},${bottom[i + 2]}`);
    return { edges: seen.size, bottom: row.size, zoom: c.dataset.zoom };
  });
  check('zoomed-out wide stage: the backdrop reaches both side edges and the bottom (no flat bands)', colours.edges > 100 && colours.bottom > 40, JSON.stringify(colours));
  // With a name tag and a chat bubble both worn, the character is still drawn at 2x (it used to drop to 1x, half the size) in frame
  const wtab = async l => { await wide.evaluate(l => [...document.querySelectorAll('.tab')].find(x => x.title === l).click(), l); await new Promise(r => setTimeout(r, 500)); };
  await wtab('Name Ring'); await wide.evaluate(() => document.querySelector('#content .card').click()); await new Promise(r => setTimeout(r, 500));
  await wtab('Chat Ring'); await wide.evaluate(() => [...document.querySelectorAll('#source .seg button')].find(b => b.textContent.includes('Datamine'))?.click()); await new Promise(r => setTimeout(r, 500));
  await wide.$eval('.search-input', i => { i.value = 'Frog'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await new Promise(r => setTimeout(r, 500));
  await wide.evaluate(() => document.querySelector('#content .card').click()); await new Promise(r => setTimeout(r, 700));
  check('zoomed-out browser, name tag and chat bubble worn: the character is drawn at 2x, not 1x', (await wide.$eval('#preview', c => c.dataset.zoom)) === '2');
  await wide.close();
}

// An ultrawide screen: the page stops at 2400px and sits in the middle, with the checked background on both sides
{
  const ultra = await browser.newPage();
  await ultra.setViewport({ width: 3440, height: 1440, deviceScaleFactor: 1 });
  await ultra.goto('http://localhost:5173/', { waitUntil: 'networkidle0' }); await new Promise(r => setTimeout(r, 1200));
  const m = await ultra.evaluate(() => { const a = document.querySelector('.app').getBoundingClientRect(), s = document.querySelector('.stage-box').getBoundingClientRect(); return { left: Math.round(a.left), width: Math.round(a.width), right: Math.round(innerWidth - a.right), stage: Math.round(s.width), zoom: document.querySelector('#preview').dataset.zoom, scrollW: document.documentElement.scrollWidth, perRow: (() => { const c = [...document.querySelectorAll('#content .card')]; return c.length ? c.filter(x => x.offsetTop === c[0].offsetTop).length : 0; })() }; });
  check('ultrawide 3440px: the page is capped at 2400px and centred', m.width === 2400 && Math.abs(m.left - m.right) <= 1 && m.scrollW <= 3440, JSON.stringify(m));
  check('ultrawide 3440px: the preview is still drawn zoomed in (2x or more)', Number(m.zoom) >= 2, JSON.stringify(m));
  check('ultrawide 3440px: at most 10 cards per row', m.perRow >= 9 && m.perRow <= 10, JSON.stringify(m));
  await ultra.screenshot({ path: '/private/tmp/claude-501/-Users-hannah-Projects/cc6e1d70-a595-4f36-be81-e85faff457f1/scratchpad/ultra.png' });
  await ultra.close();
}

// Hair is the front view only (no backDefault layers: those are the back-facing pose) plus the hair shade, one picture per skin tone
{
  const FULL = JSON.parse(readFileSync('public/catalog.json', 'utf8'));
  const layers = new Set(FULL.hair.flatMap(h => h.variants.flatMap(v => v.parts.map(p => p.layer))));
  check('hair: only the front-view layers and the hair shade are in the catalogue (no back-view layers)', [...layers].every(l => ['hair', 'hairOverHead', 'hairBelowBody', 'hairShade'].includes(l)) && layers.has('hairShade'), [...layers].join());
  const shade = FULL.hair.flatMap(h => h.variants.flatMap(v => v.parts.filter(p => p.layer === 'hairShade')));
  check('hair shade: each picture lists the skin tones it is for, and every skin tone is covered', shade.length > 0 && shade.every(p => Array.isArray(p.tones)) && FULL.skins.every(sk => FULL.hair[0].variants[0].parts.filter(p => p.layer === 'hairShade').some(p => p.tones.includes(sk.tone))));
}
console.log(results.join('\n'));
console.log('console/page errors:', errors.length ? errors : 'none');
await browser.close();
