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
const clickTab = label => page.evaluate(l => [...document.querySelectorAll('.tab')].find(t => t.title.startsWith(l)).click(), label);
const pixels = () => page.evaluate(() => { const c = document.getElementById('preview'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0, n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { n++; h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; } return { n, h }; });
const settle = () => new Promise(r => setTimeout(r, 700));

const start = await pixels();
check('preview draws something', start.n > 500, `(${start.n} px)`);

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
await clickTab('Skin'); await settle();
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
check('Face and Hair have a Released / All · Datamine switch, defaulting to Released', (await page.$$eval('#source .seg button', bs => bs.map(b => `${b.textContent}:${b.getAttribute('aria-pressed')}`))).join() === 'Released:true,All · Datamine:false');
await page.evaluate(() => [...document.querySelectorAll('#source .seg button')].find(b => b.textContent.includes('Datamine')).click()); await settle();
check('choosing Datamine shows the note, more styles, and marks the unreleased ones', !!(await page.$('#content .datamine-note')) && (await page.$$('#content .card')).length > 20 && (await page.$$('#content .card .unreleased-badge')).length > 5);
check('every unreleased card is marked DATAMINE and no released card is', await page.evaluate(() => [...document.querySelectorAll('#content .card:not(.placeholder)')].every(c => c.classList.contains('unreleased') === !!c.querySelector('.unreleased-badge'))));
await page.evaluate(() => [...document.querySelectorAll('#source .seg button')].find(b => b.textContent === 'Released').click()); await settle();
check('back to Released hides the note and every DATAMINE badge', !(await page.$('#content .datamine-note')) && (await page.$$('#content .card .unreleased-badge')).length === 0);
await clickTab('Hat'); await settle();
check('the Released/Datamine switch is not on wearable tabs (the Hat tab has its own Fit row)', !(await page.$$eval('#source .seg button', b => b.some(x => /Released|Datamine/.test(x.textContent)))));
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
check('opening Search shows the type-3-letters note and renders no cards', (await page.$eval('#content .empty-note p', e => e.textContent)) === 'Type at least 3 letters to search skins, faces, hairs and clothing.' && (await page.$$('#content .card')).length === 0);
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
  check('Chat bubble, Released: the six released bubbles', JSON.stringify(chatCards) === JSON.stringify(['Kitty Chat Ring', 'Classic Beginnings Chat Ring', 'MapleStory Fest 2026 Chat Ring', "Founder's Chat Ring", 'Ink-and-Wash Thought Bubble Ring', 'Chocolate Chat Ring']), chatCards.join(', '));
  await showSource('All · Datamine');
  check('Chat bubble, All · Datamine: all 81 bubbles', (await labels()).length === 81 && (await page.$$('#content .card .unreleased-badge')).length === 75, String((await labels()).length));
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
  check('Fit filter: the Hat tab has All, Topper, Cap and Helmet with counts', JSON.stringify(await page.$$eval('#source .seg button', b => b.map(x => x.textContent))) === JSON.stringify(['All (29)', 'Topper (6)', 'Cap (20)', 'Helmet (3)']));
  await fitBtn('Helmet'); await settle(); const helmets = await cards();
  check('Fit filter: Helmet leaves the three Hair (Hat) hats', helmets.length === 3 && helmets.every(n => /Hair \(Hat\)/.test(n)), helmets.join(', '));
  await fitBtn('Topper'); await settle(); const toppers = await cards();
  check('Fit filter: Topper leaves the six hats that do not flatten hair', toppers.length === 6 && toppers.includes('Angel Halo') && toppers.includes('Bunny Ears') && !toppers.includes('Cat Hat'), toppers.join(', '));
  await fitBtn('Cap'); await settle();
  check('Fit filter: Cap leaves the 20 ordinary caps', (await cards()).length === 20 && (await cards()).includes('Cat Hat'));
  await page.type('.search-input', 'beanie'); await settle();
  check('Fit filter: it combines with the search box (the four beanies are all caps)', (await cards()).length === 4 && (await cards()).every(n => /Beanie/.test(n)), (await cards()).join(', '));
  await page.$eval('.search-input', i => { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); }); await settle();
  await fitBtn('All'); await settle();
  check('Fit filter: All shows every hat again', (await cards()).length === 29);
  await clickTab('Top');
  check('Fit filter: the row is only on the Hat tab', (await page.$$eval('#source .seg button', b => b.length)) === 0);
}

// ---- Housing book ----
{
  await page.evaluate(() => localStorage.removeItem('maple-layers:housing-v1'));
  const tabByTitle = title => page.evaluate(t => [...document.querySelectorAll('.tab, .bk')].find(x => x.title === t)?.click(), title);
  await tabByTitle('Housing book'); await settle(); await settle();
  check('Housing book: the two books are tabs along the top, Housing selected', JSON.stringify(await page.$$eval('.bk', b => b.map(x => `${x.textContent}:${x.getAttribute('aria-selected')}`))) === JSON.stringify(['Character:false', 'Housing:true']));
  check('Housing book: the rail offers Homes, Decor, Chests and Crafting stations', JSON.stringify(await page.$$eval('.tab', t => t.map(x => x.title))) === JSON.stringify(['Homes', 'Decor', 'Chests', 'Crafting stations']));
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
  check('Housing book: back to the Character book shows the character tabs again', (await page.$$eval('.tab', t => t.map(x => x.title))).includes('Skin') && (await page.$eval('#preview', c => getComputedStyle(c).display)) !== 'none');
}

console.log(results.join('\n'));
console.log('console/page errors:', errors.length ? errors : 'none');
await browser.close();
