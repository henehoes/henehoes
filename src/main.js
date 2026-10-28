import '@fontsource/noto-sans-kr/latin-500.css'; // the game's own text font (its client embeds Noto Sans KR Medium), for the text drawn on the Ink-and-Wash rings
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/silkscreen/400.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';
import { adjustColour, composite } from './compose.js';
import { drawNameTag, drawPlainTag, loadFont } from './ring.js';
import * as housing from './housing.js';

// Vercel Web Analytics (page views only). Only in the production build: during development and tests it would load a debug script
// from vercel-scripts.com and log to the console. On a deployment it needs Analytics switched on in the Vercel project settings.
// Loaded on the side and allowed to fail: an ad or tracker blocker that blocks anything called "analytics" must not stop the app
// (as a plain import it did: the whole page stayed empty).
if (import.meta.env.PROD) import('@vercel/analytics').then(m => m.inject()).catch(() => {});

const W = 160, H = 230;          // working canvas, in sprite pixels (tall: a chat bubble sits above the head, a name tag below the feet)
const OX = 60, OY = 112;          // where the skin's top-left sits on that canvas

// A slot named in DISABLED_SLOTS is hidden from the tabs, the Equipped panel, the preview, Random and saved defaults (code and data stay).
const narrowLayout = matchMedia('(max-width: 800px)'); // the one-column phone layout (see the media query in style.css)
// The possible-upcoming items (Next Crate tab, Released | Upcoming switches) are hidden while this is false; code and data stay.
const SHOW_UPCOMING = true;
const DISABLED_SLOTS = new Set(); // a slot named here is hidden everywhere (the code and data stay); empty now that the rings are rebuilt from the game files
const WEAR_ORDER = ['cap', 'faceAcc', 'eyeAcc', 'earrings', 'longcoat', 'coat', 'pants', 'glove', 'shoes', 'cape', 'weapon', 'nameTag', 'chatBalloon'];

// Sharpness: every sprite pixel is drawn as a whole number of DEVICE pixels, so on-screen pixels are all the same
// size. On a 2x display that allows scales such as 1.5x or 2.5x in CSS pixels.
const ART_H = 84;                                // card art height, CSS px
const VIEW = { scale: 1.5, focus: [OX + 20, OY + 15] };  // shared crop for every skin, face and hair card, in the catalogue and the Equipped panel: head and chest
// The Equipped panel's small preview tiles: the whole head and a little chest at 1 css px per sprite px (a whole-number zoom, so still crisp).
// The Body tab's cards show the whole body (undergarments, plus the worn face and hair) in a taller art box (`.art-box.tall`, 120px), at the same 1.5x.
const BODY_VIEW = { scale: 1.5, focus: [OX + 21, OY + 27] };
const MINI_VIEW = { scale: 1, focus: [OX + 21, OY + 15], centre: true }; // centre: put whatever is drawn in the middle of the tile
const MINI_ART = 44;                              // art height of a small Equipped tile, CSS px
const SHORT_LABEL = { faceAcc: 'Face', eyeAcc: 'Eye' }; // category names shortened for the small tiles
// Sprite pixels the main preview aims to show across. 150 with a preview 25% taller than before (300 px, 235 px on a phone) keeps the
// character the same size as when it was 120 in 240 px, and leaves room above the head for a chat bubble up to about 64 px tall, so
// wearing most rings no longer makes the preview zoom out.
const PREVIEW_VIEW = 150;
const PREVIEW_FOCUS = [OX + 22, OY + 30];

// In-game skin names (MeowDB, MapleStory Classic skin tones). Ids not listed here are not in Classic, so they are hidden.
const SKIN_NAMES = { 0: 'Light', 1: 'Tan', 2: 'Brown', 3: 'Pale', 4: 'Ashen', 5: 'Green', 10: 'Pink', 11: 'Warm' };

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter(k => k != null));
  return n;
};
const dpr = () => window.devicePixelRatio || 1;

// ---------- images ----------
const imgCache = new Map();
function loadImg(file) {
  if (!imgCache.has(file)) {
    imgCache.set(file, new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas');
        c.width = im.width; c.height = im.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(im, 0, 0);
        resolve(ctx.getImageData(0, 0, im.width, im.height));
      };
      im.onerror = () => reject(new Error(`failed to load ${file}`));
      im.src = '/' + file;
    }));
  }
  return imgCache.get(file);
}

const hsbCache = new Map();
async function tinted(file, h, c, b) {
  const base = await loadImg(file);
  if (!h && !c && !b) return base;
  const key = `${file}|${h}|${c}|${b}`;
  if (!hsbCache.has(key)) hsbCache.set(key, adjustColour(base, h, c, b));
  return hsbCache.get(key);
}

// Swatch colours for the colour bar above the Face/Hair catalogue, taken from the game's own colour pickers.
const HAIR_COLOURS = { Black: '#515356', Red: '#ea4448', Orange: '#ef8640', Blonde: '#fae255', Green: '#65d940', Blue: '#4898f7', Purple: '#8b40c5', Brown: '#a96d41' };
const EYE_COLOURS = { Black: '#515356', Blue: '#4898f7', Red: '#ea4448', Green: '#65d940', Hazel: '#a96d41', Sapphire: '#6eebdd', Violet: '#ae50f6', Amethyst: '#ef8aee', White: '#ffffff' };

// ---------- state ----------
let catalog;
const DEFAULT_NAME = 'henehoe'; // the placeholder name on a name tag (also what an emptied Name box falls back to)
// Two-handed pose: a weapon with no one-handed picture (the Toy Rifle) always puts the whole character in it. Every other weapon is shown
// in its default one-handed hold: there is no Hold choice (a cash weapon is drawn from the class of what is held, so the real hold varies).
function isTwoHanded(sel) {
  const item = catalog.wearables.weapon?.items.find(i => i.id === sel.wear.weapon.item);
  return !!item && item.pose === 'stand2';
}
const fresh = () => ({
  text: { name: DEFAULT_NAME }, // shown by a name tag ring (the name can be edited in the Equipped panel)
  sex: 'male', // the body's gender: decides which undergarments are worn when no top or bottom is
  skin: 0,
  face: { style: null, colour: 0 },
  hair: { style: null, colour: 0 },
  wear: Object.fromEntries(WEAR_ORDER.map(k => [k, { item: null, h: 0, c: 0, b: 0, two: false }])), // the game's dye: tone 0..359 (h), chroma -99..99 (c), brightness -99..99 (b); all 0 = the item's own colours
});
// The starting look: a male body in the lowest-numbered skin, no face, no hair and nothing worn.
const initial = () => fresh();
// ---------- saved default (kept in this browser, so it is still there when the page is reopened) ----------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const SAVE_KEY = 'maple-layers:default-v2'; // v2: colour values are the game's tone/chroma/brightness numbers
// Styles are stored by their key, not their list position, so a catalogue update cannot shift them.
const pack = () => ({
  gender, sex: state.sex, skin: state.skin, text: state.text,
  face: { key: styleOf('face')?.key ?? null, colour: state.face.colour },
  hair: { key: styleOf('hair')?.key ?? null, colour: state.hair.colour },
  wear: Object.fromEntries(WEAR_ORDER.map(k => [k, { ...state.wear[k] }])),
});
function loadSaved() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!d) return null;
    const s = fresh();
    if (catalog.skins.some(x => x.tone === d.skin)) s.skin = d.skin;
    if (d.sex === 'male' || d.sex === 'female') s.sex = d.sex;
    for (const kind of ['face', 'hair']) {
      const i = catalog[kind].findIndex(x => x.key === d[kind]?.key);
      if (i >= 0) s[kind] = { style: i, colour: catalog[kind][i].variants.some(v => v.colour === d[kind].colour) ? d[kind].colour : catalog[kind][i].variants[0].colour };
    }
    for (const k of WEAR_ORDER) {
      if (DISABLED_SLOTS.has(k)) continue; // a ring saved before they were switched off is not brought back
      const w = d.wear?.[k];
      if (w && (w.item == null || catalog.wearables[k]?.items.some(i => i.id === w.item && (SHOW_UPCOMING || !i.upcoming)))) s.wear[k] = { item: w.item, two: !!w.two, h: clamp(Math.round(+w.h || 0), 0, 359), c: clamp(Math.round(+w.c || 0), -99, 99), b: clamp(Math.round(+w.b || 0), -99, 99) };
    }
    // A look saved before the placeholder became "henehoe" carries the old placeholder "Maple": show the new one instead.
    if (typeof d.text?.name === 'string') s.text = { name: d.text.name === 'Maple' ? DEFAULT_NAME : d.text.name.slice(0, 12) };
    return { state: s, gender: ['male', 'female'].includes(d.gender) ? d.gender : 'all' };
  } catch { return null; } // storage blocked or the saved data is damaged: start from the normal default
}
const hasSaved = () => { try { return localStorage.getItem(SAVE_KEY) != null; } catch { return false; } };

let gender = 'all'; // which styles the Face and Hair tabs list: 'all' (the default), 'male' or 'female'
let state = fresh();
let activeTab = 'body';
let mode = 'character'; // which book is open: 'character' (the dress-up catalogue) or 'housing' (src/housing.js)
const lastTab = { character: 'body', housing: 'homes' }; // the tab each book was on when it was left
let source = 'released'; // Face/Hair lists: 'released' (in the game now) or 'datamine' (everything found in the game files, released or not)
const forGender = s => gender === 'all' || s.gender === 'both' || s.gender === gender; // 'both': collab styles listed for both genders
const regular = slot => catalog.wearables[slot].items.filter(i => !i.upcoming); // a slot's own items: the possible upcoming ones (Upcoming tab) are left out
// Category tabs that have possible upcoming items (the Next Crate tab's items, by slot) get a Released | Upcoming switch.
let crate = 'released'; // 'released' or 'upcoming': which items those tabs list (shared between them, like `source`)
const hasUpcoming = slot => SHOW_UPCOMING && !!catalog.wearables[slot]?.items.some(i => i.upcoming);
const inView = (slot, item) => !!item.upcoming === (hasUpcoming(slot) && crate === 'upcoming');
const dyeOf = (item, w) => item.dyeable === false ? [0, 0, 0] : [w.h, w.c, w.b]; // the game does not let you dye some items: their colour settings do nothing
const listed = s => source === 'datamine' || s.released !== false;
let search = ''; // text typed in the catalogue's search box; cleared when the tab changes
// Hat tab filter ("Fit"): how a hat treats the worn hair, from the covered-slot codes (vslots) it carries, the same ones buildLayers
// acts on (H1 hides the hair over the top of the head, H2 hides the rest). The names are ours: the game has no player-facing term.
let hatFit = 'all'; // 'all', 'topper', 'cap' or 'helmet'
const hairEffectOf = item => item.vslots?.includes('H2') ? 'helmet' : item.vslots?.includes('H1') ? 'cap' : 'topper';
const HAT_FITS = [
  ['topper', 'Topper', 'Sits on top of your hair, which stays as it is'],
  ['cap', 'Cap', 'Fits snugly: the hair over the top of your head is flattened'],
  ['helmet', 'Helmet', 'Hides your hair completely (helmets, and Hair (Hat) items, which bring their own hair)'],
];
const matches = name => name.toLowerCase().includes(search.trim().toLowerCase());
let configTarget = null; // which equipped item the Equipped panel (left) is editing: 'face', 'hair' or a wearable slot
// The colour the Face and Hair catalogues are shown in. Separate from the colour of the face/hair I am wearing.
const browse = { face: 0, hair: 0 };

const styleOf = kind => state[kind].style == null ? null : catalog[kind][state[kind].style];
const variantOf = kind => {
  const s = styleOf(kind);
  return s ? (s.variants.find(v => v.colour === state[kind].colour) ?? s.variants[0]) : null;
};

// ---------- rendering ----------
// The body's undergarments (catalog.base, by gender): the top unless a top or an overall is worn, the bottom unless a bottom or an overall is.
// They are not an equipped item: no tab, no Equipped tile, no colour settings.
function baseOf(sel) {
  const b = catalog.base[sel.sex], w = sel.wear, overall = w.longcoat.item != null;
  return [!overall && w.coat.item == null && b.coat, !overall && w.pants.item == null && b.pants].filter(Boolean);
}
async function buildLayers(sel) {
  // Every sprite file the look needs is requested at once (not one after another: on a phone each request waits for the network, so
  // a look of 25 parts took seconds). Layers keep the order they were added in, which decides how same-height parts stack.
  const jobs = [];
  // Worn items declare slot codes (e.g. a hat with H1); parts tied to a covered slot are hidden.
  const base = baseOf(sel);
  const covered = new Set([...WEAR_ORDER.flatMap(slot => catalog.wearables[slot]?.items.find(i => i.id === sel.wear[slot].item)?.vslots ?? []), ...base.flatMap(i => i.vslots ?? [])]);
  const add = (parts, h = 0, c = 0, b = 0) => {
    for (const p of parts.filter(p => !covered.has(p.hiddenBy))) jobs.push(tinted(p.file, h, c, b).then(img => ({ img, x: OX + p.x, y: OY + p.y, z: p.z })));
  };
  // A weapon with no standing pose (Orange Toy Hammer) puts the whole body in the two-handed pose.
  const twoHanded = isTwoHanded(sel);
  const partsFor = x => (twoHanded && x.parts2) || x.parts;
  const skin = catalog.skins.find(s => s.tone === sel.skin);
  add(partsFor(skin));
  for (const kind of ['face', 'hair']) {
    const st = sel[kind].style == null ? null : catalog[kind][sel[kind].style];
    const v = st && (st.variants.find(x => x.colour === sel[kind].colour) ?? st.variants[0]);
    if (v && partsFor(v)) add(partsFor(v));
  }
  for (const item of base) add(partsFor(item)); // the undergarments, drawn as part of the body
  for (const slot of WEAR_ORDER) {
    const w = sel.wear[slot];
    const item = catalog.wearables[slot]?.items.find(i => i.id === w.item);
    if (item) add(partsFor(item), ...dyeOf(item, w));
  }
  for (const slot of RING_SLOTS) {
    if (DISABLED_SLOTS.has(slot)) continue;
    const item = catalog.wearables[slot]?.items.find(i => i.id === sel.wear[slot].item);
    if (item) jobs.push(ringLayer(item.effect, sel.text));
  }
  return Promise.all(jobs);
}

// ---------- name tag and chat bubble rings ----------
const RING_SLOTS = ['nameTag', 'chatBalloon'];
const CENTRE_X = OX + 21, FEET_Y = OY + 68, HEAD_Y = OY - 6; // where a tag hangs under the feet and a bubble sits over the head

// A chat bubble is a finished picture (the ring item's own sample, from the game files), shown as it is just over the head. A name tag is
// built from pieces (or a plain box) with the name drawn in (src/ring.js), just under the feet. Both are centred on the character.
const canvasOf = im => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').putImageData(im, 0, 0); return c; };
async function tagPieces(effect) {
  const pieces = {};
  for (const [key, p] of Object.entries(effect.tag.pieces)) pieces[key] = { ...p, cv: canvasOf(await loadImg(`${effect.tag.dir}/${key}.png`)) };
  return pieces;
}
// The name tag for `name`: { canvas, ax, ay } as ring.js returns it.
async function drawTag(effect, name) {
  await loadFont(name); // canvas text needs the web font loaded first
  return effect.plain ? drawPlainTag(name, effect.plain) : drawNameTag(await tagPieces(effect), effect.tag.colour, name, effect.tag.pad);
}
const RING_FONT = '500 11px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
async function ringImage(effect) {
  const im = await loadImg(effect.file); // loadImg gives the picture as ImageData
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
  const ctx = c.getContext('2d');
  ctx.putImageData(im, 0, 0);
  if (effect.text) { // a sample with no text in it (Ink-and-Wash): the client draws white text on the ink
    await document.fonts.load(RING_FONT, effect.text.value).catch(() => {});
    ctx.font = RING_FONT; ctx.fillStyle = effect.text.colour; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(effect.text.value, effect.text.x, effect.text.y + 1);
  }
  return c;
}
async function ringLayer(effect, text) {
  if (effect.kind === 'nameTag' && (effect.tag || effect.plain)) {
    const { canvas, ax, ay } = await drawTag(effect, text.name.trim() || DEFAULT_NAME); // an emptied box shows the placeholder
    const img = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    // the tag's layout line sits just under the feet
    return { img, x: Math.round(CENTRE_X - ax), y: Math.round(FEET_Y + (effect.plain ? 3 : 5) - ay), z: 9999 };
  }
  // a chat bubble, or a name tag that only exists as a picture (a datamine ring): the picture as it is
  const canvas = await ringImage(effect);
  const img = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const y = effect.kind === 'nameTag' ? FEET_Y + 3 : HEAD_Y - canvas.height;
  return { img, x: Math.round(CENTRE_X - canvas.width / 2), y: Math.round(y), z: 9999 };
}
const ringWorn = sel => RING_SLOTS.some(slot => sel.wear[slot].item != null);

// Composes `sel` into a canvas of its own and runs `paint(buf, source)` in the same step. Every call gets a fresh canvas on purpose:
// WebKit (the engine of every iPhone browser) reads a canvas late when it is drawn into another one, so with one shared canvas that
// the next card then overwrote, each thumbnail showed its neighbour's picture.
async function withScene(sel, paint) {
  const buf = composite(await buildLayers(sel), W, H);
  const source = document.createElement('canvas');
  source.width = W; source.height = H;
  source.getContext('2d').putImageData(new ImageData(buf.data, W, H), 0, 0);
  return paint(buf, source);
}

// Sizes `canvas` to cover a boxW x boxH CSS box, drawing each sprite pixel as `n` whole device pixels, then paints
// the part of the scene around `focus`. The canvas may overhang the box by under one sprite pixel; the box crops it.
// The Henesys backdrop (public/maps/henesys.png, made by scripts/download-map.mjs). The map's ground line is lined up with
// the bottom of the character's feet, and it is drawn at the same whole-number zoom as the sprites so both share one pixel grid.
const FOOT_EDGE = OY + 66; // the sprite row just under the feet
let backdrop = null;
function drawBackdrop(ctx, n, startX, startY, canvasW, canvasH) {
  const { img, info } = backdrop;
  const dx = (CENTRE_X - info.centreX - startX) * n, dy = (FOOT_EDGE - info.groundRow - startY) * n;
  ctx.fillStyle = info.skyColour; ctx.fillRect(0, 0, canvasW, canvasH); // beyond the picture's top edge: carry on in the meadow's colour
  ctx.fillStyle = info.groundColour; ctx.fillRect(0, Math.min(canvasH, dy + info.height * n), canvasW, canvasH);
  ctx.drawImage(img, dx, dy, info.width * n, info.height * n);
}
function paintFocus(canvas, boxW, boxH, n, focus, source, withBackdrop = false) {
  const d = dpr();
  const sw = Math.ceil(boxW * d / n), sh = Math.ceil(boxH * d / n);
  canvas.width = sw * n; canvas.height = sh * n;
  canvas.style.width = `${canvas.width / d}px`; canvas.style.height = `${canvas.height / d}px`;
  canvas.style.left = `${Math.floor((boxW * d - canvas.width) / 2) / d}px`;
  canvas.style.top = `${Math.floor((boxH * d - canvas.height) / 2) / d}px`;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const startX = Math.round(focus[0] - sw / 2), startY = Math.round(focus[1] - sh / 2);
  if (withBackdrop && backdrop) drawBackdrop(ctx, n, startX, startY, canvas.width, canvas.height);
  ctx.drawImage(source, startX, startY, sw, sh, 0, 0, canvas.width, canvas.height);
}

let renderToken = 0;
async function renderPreview() {
  if (mode === 'housing') return housing.renderStage();
  const token = ++renderToken;
  await withScene(state, (buf, source) => {
    if (token !== renderToken) return; // a newer render has started
    const box = $('stage').getBoundingClientRect();
    const side = Math.min(box.width, box.height) - 2; // inside the border
    // Normally a fixed frame on the character. With a tag or bubble worn, widen it to fit them.
    let view = PREVIEW_VIEW, focus = PREVIEW_FOCUS;
    if (ringWorn(state)) {
      let x0 = CENTRE_X - 28, x1 = CENTRE_X + 28, y0 = OY - 15, y1 = OY + 72;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (buf.data[(y * W + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      view = Math.max(PREVIEW_VIEW, y1 - y0 + 8, x1 - x0 + 8);
      focus = [(x0 + x1) / 2, (y0 + y1) / 2];
    }
    const n = Math.max(1, Math.floor(side * dpr() / (view * 0.95))); // allow edges to crop by up to 5% to get a bigger whole-number scale
    paintFocus($('preview'), box.width - 2, box.height - 2, n, focus, source, true);
    $('preview').dataset.zoom = n; // device pixels per sprite pixel (read by the tests)
  });
}

async function drawThumb(canvas, boxEl, sel, view) {
  await withScene(sel, (buf, source) => {
    const box = boxEl.getBoundingClientRect();
    let focus = view.focus;
    if (view.centre) {
      // Aim at the middle of what is drawn around the head (not the whole body), so the picture sits in the middle of its tile.
      let x0 = W, x1 = -1, y0 = H, y1 = -1;
      for (let y = OY - 30; y <= OY + 36; y++) for (let x = 0; x < W; x++) if (buf.data[(y * W + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (x1 >= 0) focus = [(x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2];
    }
    paintFocus(canvas, box.width, box.height, Math.max(1, Math.round(view.scale * dpr())), focus, source);
  });
}

// A selection that shows only the skin plus one thing.
function only(patch) {
  const sel = fresh();
  sel.skin = state.skin; sel.sex = state.sex;
  return patch(sel);
}

// ---------- UI ----------
const note = text => { $('ph-note').textContent = text; };

// Chapter tabs down the right edge of the book. Short names keep the rail narrow; the chapter title shows the full one.
const TAB_NAMES = { search: 'All', faceAcc: 'Face Acc.', eyeAcc: 'Eye Deco', longcoat: 'Overall', nameTag: 'Name Ring', chatBalloon: 'Chat Ring', upcoming: 'Upcoming' };
const CHAPTER_TITLES = { upcoming: 'Possible Upcoming Crates', search: 'Search Everything', body: 'Body', face: 'Faces', hair: 'Hairstyles', cap: 'Hats', faceAcc: 'Face Accessories', eyeAcc: 'Eye Decorations', earrings: 'Earrings', longcoat: 'Overalls', coat: 'Tops', pants: 'Bottoms', glove: 'Gloves', shoes: 'Shoes', cape: 'Capes', weapon: 'Weapons', nameTag: 'Name Rings', chatBalloon: 'Chat Rings' };

function renderTabs() {
  const tabs = $('tabs');
  const scrolled = tabs.scrollLeft; // on a phone the tabs scroll sideways: rebuilding them must not send the strip back to the start
  const needsFix = new Set([...WEAR_ORDER.filter(s => catalog.wearables[s]?.placeholders?.length), ...['face', 'hair'].filter(k => catalog.placeholders[k].some(p => p.released !== false))]); // datamine placeholders are expected, so only released ones are flagged
  tabs.replaceChildren();
  if (mode === 'housing') {
    for (const tb of housing.tabs()) {
      const b = el('button', { className: `tab ${tb.key === 'homes' ? 'character' : 'wearable'}`, type: 'button', role: 'tab' }, el('span', { className: 'tab-name', textContent: tb.label }));
      b.setAttribute('aria-selected', String(activeTab === tb.key)); b.title = tb.label;
      if (tb.count) b.append(el('span', { className: 'tick', title: 'Placed' }));
      b.onclick = () => { activeTab = tb.key; lastTab.housing = tb.key; search = ''; note(''); renderTabs(); renderFilters(); renderContent(); };
      tabs.append(b);
    }
    tabs.scrollLeft = scrolled;
    $('chapter').textContent = housing.chapterTitle(activeTab);
    return;
  }
  const add = (key, label, active, group) => {
    const t = el('button', { className: `tab ${group}`, type: 'button', role: 'tab' }, key === 'search' ? el('span', { className: 'glass tab-glass', 'aria-hidden': 'true' }) : null, el('span', { className: 'tab-name', textContent: TAB_NAMES[key] ?? label }));
    t.setAttribute('aria-selected', String(activeTab === key));
    t.title = label;
    if (active) t.append(el('span', { className: 'tick', title: 'Equipped' }));
    if (needsFix.has(key)) t.append(el('span', { className: 'fix', title: 'Has placeholders to fix', textContent: '!' }));
    t.onclick = () => { activeTab = key; search = ''; note(''); renderTabs(); renderFilters(); renderContent(); };
    tabs.append(t);
  };
  add('search', 'Search', false, 'lookup');
  add('body', 'Body', false, 'character');
  add('face', 'Face', state.face.style != null, 'character');
  add('hair', 'Hair', state.hair.style != null, 'character');
  WEAR_ORDER.filter(s => catalog.wearables[s] && !DISABLED_SLOTS.has(s)).forEach((s, i) => add(s, catalog.wearables[s].label, state.wear[s].item != null, i === 0 ? 'wearable first' : 'wearable'));
  if (SHOW_UPCOMING) add('upcoming', 'Possible items for the next Mystery Fashion Crates (unconfirmed)', upcomingWorn(), 'wearable upcoming');
  tabs.scrollLeft = scrolled;
  $('chapter').textContent = CHAPTER_TITLES[activeTab] ?? catalog.wearables[activeTab]?.label ?? '';
}

// The search box (every tab) and the All / Male / Female picker (Face and Hair), just above the cards.
let searchTimer;
function renderFilters() {
  const box = $('filters');
  box.replaceChildren();
  $('source').replaceChildren();
  const everything = activeTab === 'search';
  const input = el('input', { type: 'search', className: 'search-input', placeholder: everything ? 'Search everything…' : 'Search entries…', value: search, autocomplete: 'off', spellcheck: false });
  input.setAttribute('aria-label', everything ? 'Search body, faces, hairs and clothing' : 'Search this list');
  // The Search tab waits a moment after the last keystroke, so fast typing does not rebuild the results on every letter.
  input.oninput = () => { search = input.value; clearTimeout(searchTimer); if (everything) searchTimer = setTimeout(() => renderContent(false), 150); else renderContent(true); };
  box.append(el('label', { className: 'search' }, el('span', { className: 'glass', 'aria-hidden': 'true' }), input));
  if (everything) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  if (activeTab === 'body') return renderSexPicker();
  if (WEAR_ORDER.includes(activeTab) && hasUpcoming(activeTab)) renderCrateSwitch();
  if (activeTab === 'cap') return renderFit();
  if (RING_SLOTS.includes(activeTab)) return renderSourceSwitch(activeTab === 'nameTag' ? 'Which name tags to list' : 'Which chat bubbles to list', 'Rings');
  if (activeTab !== 'face' && activeTab !== 'hair') return;
  const seg = el('div', { className: 'seg', role: 'radiogroup', 'aria-label': 'Show styles for' });
  for (const [g, label] of [['all', 'All'], ['male', '♂ Male'], ['female', '♀ Female']]) {
    const btn = el('button', { type: 'button', role: 'radio', textContent: label });
    btn.setAttribute('aria-pressed', String(gender === g));
    btn.setAttribute('aria-checked', String(gender === g));
    btn.onclick = () => {
      gender = g;
      afterChangeKeep(false);
    };
    seg.append(btn);
  }
  box.append(seg);
  renderSourceSwitch('Which styles to list', 'Styles');
}

// The Released / All · Datamine switch (Face, Hair and the two ring tabs), in the row above the search box. `what` names the things listed.
function renderSourceSwitch(label, what) {
  const src = $('source');
  src.append(el('span', { className: 'source-label', textContent: 'Show' }));
  const sw = el('div', { className: 'seg', role: 'radiogroup', 'aria-label': label });
  for (const [s, text] of [['released', 'Released'], ['datamine', 'All · Datamine']]) {
    const btn = el('button', { type: 'button', role: 'radio', textContent: text, title: s === 'released' ? `${what} that are in the game now` : `Everything found in the game files, including ${what.toLowerCase()} not released yet` });
    btn.setAttribute('aria-pressed', String(source === s));
    btn.setAttribute('aria-checked', String(source === s));
    btn.onclick = () => { source = s; renderFilters(); renderContent(true); };
    sw.append(btn);
  }
  src.append(sw);
}

// The Body tab's gender picker, in the row above the search box: it decides the undergarments the body wears.
function renderSexPicker() {
  const src = $('source');
  src.append(el('span', { className: 'source-label', textContent: 'Gender' }));
  const sw = el('div', { className: 'seg', role: 'radiogroup', 'aria-label': 'Body gender' });
  for (const [g, label, tip] of [['male', '♂ Male', 'Blue striped undershirt and boxers'], ['female', '♀ Female', 'Pink tank top and cotton boxers']]) {
    const btn = el('button', { type: 'button', role: 'radio', textContent: label, title: `${tip} when no top or bottom is worn` });
    btn.setAttribute('aria-pressed', String(state.sex === g)); btn.setAttribute('aria-checked', String(state.sex === g));
    btn.onclick = () => { state.sex = g; afterChangeKeep(true); };
    sw.append(btn);
  }
  src.append(sw);
}

// The Released | Upcoming switch on a category tab that has possible upcoming items. The question-mark icon says "unconfirmed".
function renderCrateSwitch() {
  const src = $('source'), group = el('div', { className: 'source-group' });
  group.append(el('span', { className: 'source-label', textContent: 'Show' }));
  const sw = el('div', { className: 'seg', role: 'radiogroup', 'aria-label': 'Released items or possible upcoming items' });
  for (const [v, text] of [['released', 'Released'], ['upcoming', 'Upcoming']]) {
    const btn = el('button', { type: 'button', role: 'radio', title: v === 'released' ? 'Items that are in the game now' : 'Possible items for the next Mystery Fashion Crates (unconfirmed)' }, text);
    if (v === 'upcoming') { btn.append(el('i', { className: 'q-icon', 'aria-hidden': 'true' })); btn.setAttribute('aria-label', 'Upcoming, unconfirmed'); }
    btn.setAttribute('aria-pressed', String(crate === v)); btn.setAttribute('aria-checked', String(crate === v));
    btn.onclick = () => { crate = v; renderFilters(); renderContent(true); };
    sw.append(btn);
  }
  group.append(sw); src.append(group);
}

// The Hat tab's "Fit" picker, in the row above the search box: All, Topper, Cap, Helmet, each with how many hats it holds.
function renderFit() {
  const hats = catalog.wearables.cap.items.filter(i => inView('cap', i)), src = $('source');
  const group = el('div', { className: 'source-group' }, el('span', { className: 'source-label', textContent: 'Fit' }));
  const sw = el('div', { className: 'seg', role: 'radiogroup', 'aria-label': 'How the hat treats your hair' });
  for (const [v, label, tip] of [['all', 'All', 'Every hat'], ...HAT_FITS]) {
    const n = v === 'all' ? hats.length : hats.filter(i => hairEffectOf(i) === v).length;
    const btn = el('button', { type: 'button', role: 'radio', textContent: `${label} (${n})`, title: tip });
    btn.setAttribute('aria-pressed', String(hatFit === v)); btn.setAttribute('aria-checked', String(hatFit === v));
    btn.onclick = () => { hatFit = v; renderFilters(); renderContent(true); };
    sw.append(btn);
  }
  group.append(sw); src.append(group);
}

// A card for something that is on the list but could not be drawn. Clicking it explains why.
function placeholderCard(p) {
  const b = el('button', { className: 'card placeholder', type: 'button' },
    el('span', { className: 'badge', textContent: 'PLACEHOLDER' }), el('span', { className: 'q', textContent: '?' }), el('span', { textContent: p.name }));
  b.setAttribute('aria-disabled', 'true');
  b.title = p.reason;
  b.onclick = () => note(`Placeholder, needs fixing: ${p.name}. ${p.reason}.`);
  return b;
}

// Wearables show the item's own inventory icon at a whole-number scale; hair and face show a drawn thumbnail.
function iconBox(file, size = ART_H) {
  const img = el('img', { className: 'icon', src: '/' + file, alt: '', loading: 'lazy' });
  img.onload = () => { const k = Math.max(1, Math.floor((size - 4) / Math.max(img.naturalWidth, img.naturalHeight))); img.style.width = `${img.naturalWidth * k}px`; };
  return el('span', { className: 'art-box' }, img);
}

// view: { scale, focus } for drawn thumbnails, or null when `icon` is given.
function optionCard(name, selected, view, selFor, onClick, check, icon, size) {
  let box, canvas;
  if (icon) box = iconBox(icon, size);
  else { canvas = el('canvas'); box = el('span', { className: 'art-box' }, canvas); }
  const b = el('button', { className: 'card', type: 'button' }, check && el('span', { className: 'badge check', textContent: 'CHECK' }), box, el('span', { className: 'label', textContent: name }));
  b.title = check ?? name; // the label is cut off after two lines, so the tooltip carries the full name
  b.setAttribute('aria-pressed', String(selected));
  b.onclick = onClick;
  if (canvas) {
    // Draw thumbnails as they scroll into view, so large lists stay quick.
    observer.observe(b);
    b._draw = () => drawThumb(canvas, box, selFor(), view);
  }
  return b;
}

const observer = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) { observer.unobserve(e.target); e.target._draw?.(); }
}, { rootMargin: '120px', root: null });

// Colour options as previews: the current style drawn in each of its colours, on my skin with the other of face/hair.
function colourGrid(kind) {
  const grid = el('div', { className: 'grid colour-options' });
  const st = styleOf(kind);
  for (const v of st.variants) {
    grid.append(optionCard(v.label, v.colour === variantOf(kind).colour, VIEW,
      () => only(sel => { sel.face = { ...state.face }; sel.hair = { ...state.hair }; sel[kind] = { style: state[kind].style, colour: v.colour }; return sel; }),
      () => { state[kind].colour = v.colour; afterChange(); }));
    if (kind === 'face' && v.label === NO_COUPON_EYES) { const card = grid.lastChild; card.title = NO_COUPON_TIP; card.append(el('span', { className: 'badge warn-badge', textContent: 'NOT SELECTABLE' })); }
  }
  return grid;
}

// A slider with a box beside it showing the number. Moving the slider updates the box; typing in the box (digits, + and -)
// moves the slider. The value is kept within min..max, and the box is tidied up (for example "+7") when you leave it.
function sliderRow(label, min, max, step, value, fmt, onInput) {
  const input = el('input', { type: 'range', min, max, step, value, id: `s-${label}` });
  const box = el('input', { type: 'text', className: 'num', value: fmt(value), inputMode: 'numeric', autocomplete: 'off', maxLength: 4 });
  box.setAttribute('aria-label', `${label} value`);
  const apply = n => { input.value = n; onInput(n); };
  input.oninput = () => { box.value = fmt(Number(input.value)); onInput(Number(input.value)); };
  box.oninput = () => {
    box.value = box.value.replace(/[^0-9+-]/g, '').replace(/(?!^)[+-]/g, ''); // only digits, and a sign at the start
    if (/^[+-]?\d+$/.test(box.value)) apply(clamp(parseInt(box.value, 10), min, max)); // "+" or "-" alone: wait for the digits
  };
  const tidy = () => { box.value = fmt(Number(input.value)); };
  box.onfocus = () => setTimeout(() => box.select(), 0); // typing replaces the old number
  box.onblur = tidy;
  box.onkeydown = e => { if (e.key === 'Enter') { tidy(); box.blur(); } };
  return el('div', { className: 'slider' }, el('label', { htmlFor: input.id, textContent: label }), input, box);
}

// One small preview tile in the Equipped panel: the face or hair on the skin, or the item's own sprite, with its category
// underneath. The full name (and the colour) is the tooltip.
// A worn item counts as dyed once any of its tone, chroma or brightness is off 0 (face and hair have no dye, only colour styles).
const isDyed = key => {
  const w = state.wear[key], item = w && catalog.wearables[key]?.items.find(i => i.id === w.item);
  return !!item && item.dyeable !== false && (w.h !== 0 || w.c !== 0 || w.b !== 0);
};
// Shows or hides the palette icon on the Equipped tiles without redrawing them (the sliders are being dragged).
const syncDyed = () => document.querySelectorAll('.equipped .card.mini[data-key]').forEach(b => b.classList.toggle('dyed', isDyed(b.dataset.key)));

function equippedCard(e) {
  let b;
  const choose = () => { configTarget = e.key; renderColour(); };
  if (e.key === 'face' || e.key === 'hair') {
    // The face alone on the skin, or the hair alone, so the two tiles look different.
    b = optionCard(e.label, false, MINI_VIEW, () => { const sel = fresh(); sel.skin = state.skin; sel.sex = state.sex; sel[e.key] = { ...state[e.key] }; return sel; }, choose);
  } else if (RING_SLOTS.includes(e.key)) {
    b = ringCard(e.item, false, e.key, true);
    b.querySelector('.label').textContent = e.label;
    b.onclick = choose;
  } else {
    b = optionCard(e.label, false, null, null, choose, undefined, e.item.icon, MINI_ART);
  }
  b.classList.add('mini');
  b.dataset.slot = e.slot;
  b.dataset.key = e.key;
  b.classList.toggle('dyed', isDyed(e.key));
  b.title = e.colour ? `${e.name} · ${e.colour}` : e.name;
  b.setAttribute('aria-label', b.title);
  b.setAttribute('aria-pressed', String(e.key === configTarget));
  if (e.key === 'face' && e.colour === NO_COUPON_EYES) { b.title += ` · ${NO_COUPON_TIP}`; b.setAttribute('aria-label', b.title); b.append(el('span', { className: 'fix', title: NO_COUPON_TIP, textContent: '!' })); }
  return b;
}

// Takes one worn thing off (the x on its Equipped tile).
function removeEquipped(e) {
  if (e.key === 'face' || e.key === 'hair') state[e.key] = { style: null, colour: state[e.key].colour };
  else state.wear[e.key].item = null;
  afterChange();
}

// What I am wearing, in the order the Equipped panel lists it.
function equipped() {
  const out = [];
  for (const kind of ['face', 'hair']) {
    const st = styleOf(kind);
    if (st) out.push({ key: kind, slot: kind === 'face' ? 'Face' : 'Hair', label: kind === 'face' ? 'Face' : 'Hair', name: st.style, colour: variantOf(kind).label });
  }
  for (const slot of WEAR_ORDER) {
    if (DISABLED_SLOTS.has(slot)) continue;
    const id = state.wear[slot].item;
    const item = id != null && catalog.wearables[slot]?.items.find(i => i.id === id);
    if (item) out.push({ key: slot, slot: catalog.wearables[slot].label, label: SHORT_LABEL[slot] ?? catalog.wearables[slot].label, name: item.name, item });
  }
  return out;
}

// White eyes show in the game's preview, but the Signature eye colour coupon's description lists every colour except white, so you cannot
// actually change to it. Anything that shows or selects White eyes warns about it.
const NO_COUPON_EYES = 'White';
const NO_COUPON_TIP = "White can't be set with the Signature Eye Colour Coupon";
const whiteEyesWorn = () => state.face.style != null && variantOf('face')?.label === NO_COUPON_EYES;
const eyeWhiteNote = () => el('div', { className: 'dye-note warn-note', role: 'note' }, el('span', { className: 'dye-badge', textContent: '!', 'aria-hidden': 'true' }), el('p', {},
  el('strong', { textContent: "White eyes can't be set in the game. " }),
  "White eyes can be previewed in the cash shop, but cannot be selected with the Signature Eye Colour Coupon. The coupon allows you to select every eye colour aside from white."));

// The Equipped panel's headings: the category and the name of what is worn, then sections with small-caps subheadings.
const panelHeading = (label, name) => el('h3', {}, label, name ? el('span', { className: 'item-name', textContent: name }) : null);
const panelSection = (title, ...kids) => el('section', { className: 'panel-section' }, el('h4', { className: 'sub', textContent: title }), ...kids);

// The Equipped panel (left): what I am wearing as sprites, and the colour settings of the one I select.
// Face and hair show every colour of the chosen style; a wearable shows hue, chroma and brightness.
function renderColour() {
  const c = $('colour');
  c.replaceChildren();
  if (mode === 'housing') return housing.renderPanel(c, () => { renderTabs(); renderColour(); housing.draw(); });
  const list = equipped();
  if (!list.some(e => e.key === configTarget)) configTarget = list[0]?.key ?? null;
  c.append(el('h3', { textContent: 'Equipped' }));
  if (!list.length) return c.append(infoNote(el('strong', { textContent: 'Nothing equipped yet.' }), ` Pick your face, hair and clothing items ${narrowLayout.matches ? 'above' : 'on the right'}. You can select them here to change their colour.`));
  const grid = el('div', { className: 'equipped grid' });
  for (const e of list) {
    // Hovering (or tabbing to) a tile shows an x that takes the item off.
    const x = el('button', { className: 'remove', type: 'button', title: `Remove ${e.name}` });
    x.setAttribute('aria-label', `Remove ${e.name}`);
    x.onclick = () => removeEquipped(e);
    grid.append(el('div', { className: 'slot' }, equippedCard(e), x));
  }
  c.append(grid);
  if (configTarget === 'face' || configTarget === 'hair') return c.append(panelHeading(configTarget === 'face' ? 'Face' : 'Hair', styleOf(configTarget)?.style), ...(configTarget === 'face' && whiteEyesWorn() ? [eyeWhiteNote()] : []), panelSection(configTarget === 'face' ? 'Eye colour' : 'Hair colour', colourGrid(configTarget)));
  const data = catalog.wearables[configTarget], w = state.wear[configTarget];
  // Every worn item's panel starts with its category and name; then sections with small-caps subheadings.
  const worn = data.items.find(i => i.id === w.item), isWeapon = configTarget === 'weapon' && !!worn;
  const section = panelSection, heading = panelHeading(data.label, worn?.name);
  if (RING_SLOTS.includes(configTarget)) {
    const fx = worn?.effect, editable = configTarget === 'nameTag' && !!(fx?.tag || fx?.plain);
    return c.append(heading, ...(editable ? [textFields()] : []), el('p', { className: 'hint', textContent: editable ? 'This ring has no colour settings. Type the name it shows.' : 'This ring has no colour settings: it is shown as it looks in the game (its text cannot be changed).' }));
  }
  // A weapon also says which weapon types it goes over (the game's own description).
  const types = worn?.worksWith?.[0] === 'weapon' ? ['any weapon'] : worn?.worksWith ?? [];
  const worksWith = isWeapon && types.length ? [section('Works with', el('div', { className: 'chips' }, ...types.map(t => el('span', { className: 'chip', textContent: t[0].toUpperCase() + t.slice(1) }))))] : [];
  // The game does not let you dye some items (no dye flag in its files): no sliders, just a note.
  if (worn?.dyeable === false) { const hint = el('p', { className: 'hint', textContent: "This item can't be dyed in the game." }); return c.append(heading, ...worksWith, isWeapon ? section('Dye', hint) : hint); }
  // The game's own numbers, all starting at 0 (the item's own colours): Tone 0 to 359, Chroma and Brightness -99 to +99.
  const signed = v => `${v > 0 ? '+' : ''}${v}`;
  const slider = (label, key, min, max) => sliderRow(label, min, max, 1, w[key], signed, v => { w[key] = v; syncDyed(); renderPreview(); });
  const sliders = el('div', { className: 'sliders' }, slider('Tone', 'h', 0, 359), slider('Chroma', 'c', -99, 99), slider('Brightness', 'b', -99, 99));
  const reset = el('button', { className: 'small-btn', type: 'button', textContent: 'Reset colour' });
  reset.onclick = () => { Object.assign(w, { h: 0, c: 0, b: 0 }); renderColour(); renderPreview(); };
  // Random dye: the full range of all three sliders.
  const random = el('button', { className: 'small-btn', type: 'button', textContent: 'Random dye' });
  random.onclick = () => {
    const between = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    Object.assign(w, { h: between(0, 359), c: between(-99, 99), b: between(-99, 99) });
    renderColour(); renderPreview();
  };
  // The game keeps some special effects in their own colour, and the sprite data does not say which, so this preview dyes every part it can.
  const note = el('div', { className: 'dye-note', role: 'note' }, el('span', { className: 'dye-badge', textContent: '!', 'aria-hidden': 'true' }),
    el('p', { textContent: "Some special effects keep their original colour in the game even when dyed. We can't tell which, so this preview dyes every part it can; some items may show little or no change." }));
  const buttons = el('div', { className: 'btn-row' }, random, reset);
  // Only a weapon has more than dye (Works with), so only a weapon labels its Dye section.
  if (isWeapon) return c.append(heading, ...worksWith, section('Dye', sliders, buttons, note));
  c.append(heading, sliders, buttons, note);
}

// keepScroll: redraw in place (after a selection or colour change) instead of jumping back to the top of the list.
function renderContent(keepScroll = false) {
  const c = $('content');
  const top = c.scrollTop;
  c.replaceChildren();
  $('toolbar').replaceChildren();
  if (mode === 'housing') { housing.renderContent(c, activeTab, matches, () => afterChangeKeep(true)); c.scrollTop = keepScroll ? top : 0; return; }
  if (activeTab === 'search') renderSearch(c);
  else if (activeTab === 'body') renderBody(c)
  else if (activeTab === 'upcoming') renderUpcoming(c);
  else if (activeTab === 'face' || activeTab === 'hair') renderStyles(c, activeTab);
  else renderWearable(c, activeTab);
  if (activeTab !== 'search' && search && !c.querySelector('.card')) c.append(el('p', { className: 'empty', textContent: 'No entries match. Try another word.' }));
  c.scrollTop = keepScroll ? top : 0;
}

// Colour options above the Face/Hair catalogue: picking one redraws every card in that colour. It does not touch
// what I am wearing; that is changed in the Equipped panel.
function renderColourBar(kind) {
  const colours = [...new Map(catalog[kind].flatMap(s => s.variants).map(v => [v.colour, v])).values()].sort((a, b) => a.colour - b.colour);
  const row = el('div', { className: 'swatches', role: 'group', 'aria-label': `${kind === 'face' ? 'Eye' : 'Hair'} colour of the list` });
  for (const v of colours) {
    const dot = el('i');
    const b = el('button', { className: 'swatch', type: 'button', title: v.label, 'aria-label': v.label }, dot);
    b.setAttribute('aria-pressed', String(browse[kind] === v.colour));
    b.onclick = () => { browse[kind] = v.colour; renderContent(true); };
    dot.style.background = (kind === 'face' ? EYE_COLOURS : HAIR_COLOURS)[v.label] ?? '#888';
    if (kind === 'face' && v.label === NO_COUPON_EYES) { b.classList.add('warn'); b.title = NO_COUPON_TIP; b.setAttribute('aria-label', `${v.label}: ${NO_COUPON_TIP}`); }
    row.append(b);
  }
  $('toolbar').append(el('div', { className: 'colour-bar' }, el('span', { className: 'bar-label', textContent: kind === 'face' ? 'Eye colour' : 'Hair colour' }), row));
}

// The card builders below are shared by the catalogue tabs and the Search tab, so a card behaves the same wherever it appears.
function skinCard(s) {
  // The whole body in this skin with its undergarments (the body's gender), plus the face and hair I wear; no other clothing.
  const card = optionCard(SKIN_NAMES[s.tone], s.tone === state.skin, BODY_VIEW,
    () => { const sel = fresh(); sel.skin = s.tone; sel.sex = state.sex; sel.face = { ...state.face }; sel.hair = { ...state.hair }; return sel; },
    () => { state.skin = s.tone; afterChange(); });
  card.querySelector('.art-box').classList.add('tall');
  return card;
}

function styleCard(kind, s, i) {
  const first = s.variants.find(v => v.colour === browse[kind]) ?? s.variants[0];
  const card = optionCard(s.style, state[kind].style === i, VIEW,
    // Preview the style on my current skin, with my current face (or hair) alongside.
    () => only(sel => { sel.face = { ...state.face }; sel.hair = { ...state.hair }; sel[kind] = { style: i, colour: first.colour }; return sel; }),
    // Clicking the selected style takes it off again.
    () => {
      const on = state[kind].style === i;
      state[kind] = { style: on ? null : i, colour: on ? state[kind].colour : first.colour };
      if (!on) configTarget = kind;
      afterChange();
    }, s.check);
  if (s.classicId) card.title = `${card.title} · Classic ${s.classicId}`;
  if (s.collab) card.append(el('span', { className: 'badge collab-badge', textContent: `${s.collab.toUpperCase()} COLLAB` }));
  if (s.released === false) { card.classList.add('unreleased'); card.append(el('span', { className: 'badge unreleased-badge', textContent: 'DATAMINE' })); }
  return card;
}

function wearableCard(slot, item) {
  const selected = state.wear[slot].item === item.id;
  const card = item.effect ? ringCard(item, selected, slot) : optionCard(item.name, selected, null, null, () => select(slot, item.id), item.check, item.icon);
  if (item.classicId) card.title = `${card.title} · Classic ${item.classicId}`;
  if (item.collab) card.append(el('span', { className: 'badge collab-badge', textContent: `${item.collab.toUpperCase()} COLLAB` }));
  if (item.released === false) { card.classList.add('unreleased'); card.append(el('span', { className: 'badge unreleased-badge', textContent: 'DATAMINE' })); }
  // A possible upcoming item has its own violet look (the Next Crate tab's colour), apart from the blue DATAMINE one, so a card can carry both.
  if (item.upcoming) { card.classList.add('upcoming-card'); card.append(el('span', { className: 'badge upcoming-badge', title: 'Possible item for a coming Mystery Fashion Crate (unconfirmed)' }, 'UPCOMING', el('i', { className: 'q-icon', 'aria-hidden': 'true' }))); }
  return card;
}

function renderBody(c) {
  const grid = el('div', { className: 'grid' });
  for (const s of catalog.skins) if (SKIN_NAMES[s.tone] && matches(SKIN_NAMES[s.tone])) grid.append(skinCard(s));
  c.append(grid);
}

function renderStyles(c, kind) {
  renderColourBar(kind);
  if (kind === 'face' && catalog.face.some(s => s.variants.some(v => v.colour === browse.face && v.label === NO_COUPON_EYES))) c.append(eyeWhiteNote()); // the list is shown in White
  if (source === 'datamine') c.append(el('p', { className: 'datamine-note', textContent: 'Showing everything in the game data. Styles marked DATAMINE are not released yet.' }));
  const grid = el('div', { className: 'grid' });
  catalog[kind].forEach((s, i) => { if (forGender(s) && listed(s) && matches(s.style)) grid.append(styleCard(kind, s, i)); });
  for (const p of catalog.placeholders[kind].filter(p => (gender === 'all' || p.gender === 'both' || p.gender === gender) && (p.released !== false || source === 'datamine') && matches(p.name))) grid.append(placeholderCard(p));
  c.append(grid);
}

// The Upcoming tab: equipment the game files mark as dyeable that is not in the catalogue. UNCONFIRMED, and the page says so.
const upcomingWorn = () => WEAR_ORDER.some(slot => catalog.wearables[slot]?.items.some(i => i.upcoming && i.id === state.wear[slot].item));
// The disclaimer shown on the Next Crate tab and above the Upcoming view of a category tab.
let noteOpen = false; // whether the explanation is expanded (kept while the lists redraw)
const unconfirmedNote = () => {
  // Three lines when collapsed (Read more opens the rest); one paragraph of inline text so the line clamp counts the whole thing.
  const text = el('p', { className: `note-text${noteOpen ? '' : ' collapsed'}` },
    el('strong', { textContent: 'Upcoming items are speculative and based on datamined info. ' }),
    el('span', { className: 'note-para', textContent: 'These are the only datamined items marked as dyeable that are not in the shop yet. They seem to fit cleanly into two new seasons plus one new Aurora season: Halloween (now released), winter (snowboard gear, parkas, beanies) and Aurora (fairy outfits such as Romance Rose, Baby Doll Puka, Baby Doll Linka and Fairy Pico). ' }),
    el('span', { className: 'note-para', textContent: 'The Halloween release backed this up - every item in the new Halloween Mystery Fashion Crate had already been marked dyeable in the datamine. The same logic might carry through to the next crates, but there is no guarantee.' }));
  const toggle = el('button', { className: 'note-toggle', type: 'button', textContent: noteOpen ? 'Show less' : 'Read more' });
  toggle.setAttribute('aria-expanded', String(noteOpen));
  toggle.onclick = () => { noteOpen = !noteOpen; text.classList.toggle('collapsed', !noteOpen); toggle.textContent = noteOpen ? 'Show less' : 'Read more'; toggle.setAttribute('aria-expanded', String(noteOpen)); };
  return el('div', { className: 'empty-note unconfirmed', role: 'note' }, el('span', { className: 'empty-badge', textContent: '?', 'aria-hidden': 'true' }), el('div', { className: 'note-main' }, text, toggle));
};
function renderUpcoming(c) {
  c.append(unconfirmedNote());
  for (const slot of WEAR_ORDER) {
    const items = (catalog.wearables[slot]?.items ?? []).filter(i => i.upcoming && matches(i.name));
    if (!items.length) continue;
    c.append(el('h3', { className: 'group-title', textContent: `${CHAPTER_TITLES[slot] ?? catalog.wearables[slot].label} · ${items.length}` }));
    const grid = el('div', { className: 'grid' });
    for (const item of items) grid.append(wearableCard(slot, item));
    c.append(grid);
  }
}

function renderWearable(c, slot) {
  const data = catalog.wearables[slot];
  const grid = el('div', { className: 'grid' });
  if (RING_SLOTS.includes(slot) && source === 'datamine') c.append(el('p', { className: 'datamine-note', textContent: 'Showing everything in the game data. Rings marked DATAMINE are not released yet.' }));
  if (hasUpcoming(slot) && crate === 'upcoming') c.append(unconfirmedNote());
  for (const item of data.items.filter(i => inView(slot, i) && matches(i.name) && (RING_SLOTS.includes(slot) ? listed(i) : true) && (slot !== 'cap' || hatFit === 'all' || hairEffectOf(i) === hatFit))) grid.append(wearableCard(slot, item));
  for (const p of (data.placeholders ?? []).filter(p => matches(p.name))) grid.append(placeholderCard(p));
  c.append(grid);
}

// ---------- Search tab: one box for everything ----------
const MIN_SEARCH = 3, MAX_RESULTS = 60;
const flat = s => s.toLowerCase().replace(/[^a-z0-9]/g, ''); // case, spaces and punctuation do not matter
// A framed information note (the same box as the Equipped panel's empty state).
const infoNote = (...content) => el('div', { className: 'empty-note', role: 'note' }, el('span', { className: 'empty-badge', textContent: 'i', 'aria-hidden': 'true' }), el('p', {}, ...content));

function renderSearch(c) {
  const q = flat(search);
  if (q.length < MIN_SEARCH) return c.append(infoNote(`Type at least ${MIN_SEARCH} letters to search body, faces, hairs and clothing.`));
  // Collect the matches first, grouped in tab order; cards are only built for the first MAX_RESULTS.
  const groups = [];
  const add = (title, entries) => { if (entries.length) groups.push({ title, entries }); };
  add('Body', catalog.skins.filter(s => SKIN_NAMES[s.tone] && flat(SKIN_NAMES[s.tone]).includes(q)).map(s => () => skinCard(s)));
  for (const [kind, title] of [['face', 'Faces'], ['hair', 'Hairstyles']])
    add(title, catalog[kind].flatMap((s, i) => flat(s.style).includes(q) ? [() => styleCard(kind, s, i)] : []));
  for (const slot of WEAR_ORDER) {
    if (DISABLED_SLOTS.has(slot) || !catalog.wearables[slot]) continue;
    add(CHAPTER_TITLES[slot] ?? catalog.wearables[slot].label, catalog.wearables[slot].items.filter(it => !it.effect && !it.upcoming && flat(it.name).includes(q)).map(it => () => wearableCard(slot, it)));
  }
  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  if (!total) return c.append(el('p', { className: 'empty', textContent: 'No entries match. Try another word.' }));
  let left = MAX_RESULTS;
  for (const g of groups) {
    if (left <= 0) break;
    c.append(el('h3', { className: 'group-title', textContent: `${g.title} · ${g.entries.length}` }));
    const grid = el('div', { className: 'grid' });
    for (const build of g.entries.slice(0, left)) grid.append(build());
    left -= Math.min(left, g.entries.length);
    c.append(grid);
  }
  if (total > MAX_RESULTS) c.append(infoNote(`Showing the first ${MAX_RESULTS} of ${total} matches. Type more letters to narrow it down.`));
}

// A name tag or chat bubble ring: the card shows the tag or bubble itself with sample text (the real text is set in the text fields).
function ringCard(item, selected, slot, compact = false) {
  const canvas = el('canvas', { className: 'ring-sample' });
  const box = el('span', { className: 'art-box' }, canvas);
  const b = el('button', { className: 'card', type: 'button' }, item.check && el('span', { className: 'badge check', textContent: 'CHECK' }), box, el('span', { className: 'label', textContent: item.name }));
  b.title = item.check ?? item.name;
  b.setAttribute('aria-pressed', String(selected));
  b.onclick = () => select(slot, item.id);
  ringImage(item.effect).then(art => { // the card shows the game's own preview picture as it is; the name only shows once the ring is worn
    // Whole-number scale so the pixels stay crisp; shrink to fit the card.
    const k = compact ? 1 : Math.max(1, Math.min(3, Math.floor(76 / art.height), Math.floor(98 / art.width)));
    canvas.width = art.width * k; canvas.height = art.height * k;
    canvas.style.width = `${canvas.width}px`; canvas.style.height = 'auto';
    canvas.style.maxWidth = 'calc(100% - 6px)'; // a wide bubble may shrink a little to fit the card
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(art, 0, 0, canvas.width, canvas.height);
  });
  return b;
}

// The name box for the name tag ring (the chat bubble is not editable).
function textFields() {
  const input = el('input', { type: 'text', maxLength: 12, value: state.text.name, placeholder: DEFAULT_NAME });
  input.setAttribute('aria-label', 'Name on the tag');
  input.oninput = () => { state.text.name = input.value; renderPreview(); };
  return el('div', { className: 'text-fields' }, el('label', { className: 'text-field' }, el('span', { textContent: 'Name' }), input));
}

// Equipping an overall removes the top and bottom, and the reverse, as in the game.
function select(slot, id) {
  state.wear[slot].item = state.wear[slot].item === id ? null : id; // clicking the worn item takes it off
  if (state.wear[slot].item != null) configTarget = slot;
  if (slot === 'longcoat' && state.wear[slot].item != null) { state.wear.coat.item = null; state.wear.pants.item = null; }
  if ((slot === 'coat' || slot === 'pants') && state.wear[slot].item != null) state.wear.longcoat.item = null;
  afterChange();
}

function afterChangeKeep(keepScroll = true) { renderTabs(); renderFilters(); renderContent(keepScroll); renderColour(); renderPreview(); }
function afterChange() { afterChangeKeep(); }

// ---------- export ----------
// Saves the character as a PNG. Not wired to any button at the moment (the Download button was removed): call exportPng() to use it.
async function exportPng() {
  const out = await withScene(state, (buf, source) => {
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (buf.data[(y * W + x) * 4 + 3]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const pad = 4, w = x1 - x0 + 1 + pad * 2, h = y1 - y0 + 1 + pad * 2;
    const c = el('canvas', { width: w * 4, height: h * 4 });
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, x0 - pad, y0 - pad, w, h, 0, 0, w * 4, h * 4);
    return c;
  });
  out.toBlob(blob => {
    const a = el('a', { href: URL.createObjectURL(blob), download: 'maple-character.png' });
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// ---------- preview buttons: randomise, save as default, back to default ----------
const pick = list => list[Math.floor(Math.random() * list.length)];
function randomise() {
  const s = fresh();
  s.text = state.text;
  s.sex = state.sex; // the body's gender is kept
  s.skin = pick(catalog.skins).tone;
  for (const kind of ['face', 'hair']) {
    const options = catalog[kind].map((x, i) => [x, i]).filter(([x]) => forGender(x) && listed(x));
    const [style, i] = pick(options);
    s[kind] = { style: i, colour: pick(style.variants).colour };
  }
  // Each wearable has an even chance of being worn; an overall replaces the top and bottom. Rings are left alone.
  for (const k of WEAR_ORDER) {
    if (DISABLED_SLOTS.has(k) || RING_SLOTS.includes(k) || !regular(k).length || Math.random() < 0.5) continue;
    s.wear[k].item = pick(regular(k)).id;
  }
  if (s.wear.longcoat.item != null) { if (Math.random() < 0.5) { s.wear.coat.item = null; s.wear.pants.item = null; } else s.wear.longcoat.item = null; }
  state = s;
  afterChange();
}
function resetToDefault() {
  const saved = loadSaved();
  if (saved) { state = saved.state; gender = saved.gender; } else state = initial();
  configTarget = null;
  afterChangeKeep(false);
}
function flash(message) {
  const note = $('stage-note');
  note.textContent = message; note.classList.add('show');
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => note.classList.remove('show'), 1600);
}
function saveDefault() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(pack())); flash('Saved as your default'); }
  catch { flash('Could not save: browser storage is blocked'); }
}
const ICONS = {
  random: '<rect width="12" height="12" x="2" y="10" rx="2" ry="2"/><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"/><path stroke-width="3" d="M6 18h.01M10 14h.01M15 6h.01M18 9h.01"/>', // two dice (the Lucide "dices" icon, ISC licence, as in the mockup)
  save: '<path d="M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4.5h4.5"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>', // Lucide "trash-2" (ISC licence)
};
function stageTools() {
  const make = (icon, label, onClick) => {
    const b = el('button', { className: 'tool', type: 'button', title: label });
    b.setAttribute('aria-label', label);
    b.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
    b.onclick = onClick;
    return b;
  };
  $('stage-tools').replaceChildren(...(mode === 'housing' ? [
    make('trash', 'Clear all furniture from this home', () => { housing.clearAll(); afterChangeKeep(true); })]
  : [
    make('random', 'Randomise look', randomise),
    make('save', 'Save as my default', saveDefault),
    make('reset', 'Back to my default', resetToDefault)]));
}

// The two books, as tabs along the top of the page: dressing up a character, and decorating a home.
function renderBooks() {
  $('books').replaceChildren(...[['character', 'Character'], ['housing', 'Housing']].map(([m, label]) => {
    const b = el('button', { className: 'bk', type: 'button', role: 'tab', textContent: label });
    b.setAttribute('aria-selected', String(mode === m)); b.title = `${label} book`;
    b.onclick = () => setMode(m);
    return b;
  }));
}

// Opens the Character or Housing book. The Housing data is fetched the first time.
async function setMode(m) {
  if (m === mode) return;
  if (m === 'housing') {
    try { await housing.load({ el, $, iconBox, flash, refresh: () => { renderTabs(); renderContent(true); renderColour(); } }); }
    catch { flash('Could not load the housing data'); return; }
  }
  lastTab[mode] = activeTab; mode = m; activeTab = lastTab[m]; search = ''; note('');
  document.querySelector('.app').classList.toggle('housing', m === 'housing');
  renderBooks();
  $('preview').style.display = m === 'housing' ? 'none' : '';
  if (m === 'housing') housing.showStage(); else housing.hideStage();
  stageTools();
  afterChangeKeep(false);
}

// Loads the map picture, then redraws the preview. If it is missing the preview just has no backdrop.
async function loadBackdrop() {
  try {
    const info = await (await fetch('/maps/henesys.json')).json();
    const img = new Image();
    img.src = '/maps/henesys.png';
    await img.decode();
    // Colours to continue the picture with: its top row (meadow) and bottom row (cobblestone).
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const avg = y => { const d = x.getImageData(0, y, img.width, 1).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } const n = d.length / 4; return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`; };
    backdrop = { img, info: { ...info, skyColour: avg(0), groundColour: avg(img.height - 1) } };
    renderPreview();
  } catch { backdrop = null; }
}

// On a phone the catalogue sits above the Equipped panel instead of beside it, so the empty-state text points the right way.
narrowLayout.addEventListener?.('change', () => { if (catalog) renderColour(); });

// ---------- start ----------
async function init() {
  const res = await fetch('/catalog.json');
  catalog = await res.json();
  stageTools();
  renderBooks();
  loadBackdrop();
  const saved = loadSaved();
  if (saved) { state = saved.state; gender = saved.gender; } else state = initial();
  afterChangeKeep();
  // Redraw at the right pixel sizes when the window changes size or moves to another display.
  let timer;
  window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(() => { renderContent(true); renderPreview(); }, 150); });
}
init().catch(err => { $('content').textContent = `Could not load the catalogue: ${err.message}`; });
