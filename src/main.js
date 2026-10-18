import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/silkscreen/400.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';
import { adjustColour, composite } from './compose.js';
import { drawBalloon, drawNameTag, drawPlainTag } from './ring.js';

const W = 160, H = 230;          // working canvas, in sprite pixels (tall: a chat bubble sits above the head, a name tag below the feet)
const OX = 60, OY = 112;          // where the skin's top-left sits on that canvas

// Switched off for now (not rendered cleanly enough yet): hidden from the tabs, the Equipped panel, the preview, Random and saved
// defaults. The code, data and sprites stay, so turning them back on is removing the names from this set.
const DISABLED_SLOTS = new Set(['nameTag', 'chatBalloon']);
const WEAR_ORDER = ['cap', 'faceAcc', 'eyeAcc', 'earrings', 'longcoat', 'coat', 'pants', 'glove', 'shoes', 'cape', 'weapon', 'nameTag', 'chatBalloon'];

// Sharpness: every sprite pixel is drawn as a whole number of DEVICE pixels, so on-screen pixels are all the same
// size. On a 2x display that allows scales such as 1.5x or 2.5x in CSS pixels.
const ART_H = 84;                                // card art height, CSS px
const VIEW = { scale: 1.5, focus: [OX + 20, OY + 15] };  // shared crop for every skin, face and hair card, in the catalogue and the Equipped panel: head and chest
// The Equipped panel's small preview tiles: the whole head and a little chest at 1 css px per sprite px (a whole-number zoom, so still crisp).
const MINI_VIEW = { scale: 1, focus: [OX + 21, OY + 15], centre: true }; // centre: put whatever is drawn in the middle of the tile
const MINI_ART = 44;                              // art height of a small Equipped tile, CSS px
const SHORT_LABEL = { faceAcc: 'Face', eyeAcc: 'Eye' }; // category names shortened for the small tiles
const PREVIEW_VIEW = 120;                        // sprite pixels the main preview aims to show across
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
const fresh = () => ({
  skin: 0,
  face: { style: null, colour: 0 },
  hair: { style: null, colour: 0 },
  wear: Object.fromEntries(WEAR_ORDER.map(k => [k, { item: null, h: 0, c: 0, b: 0 }])), // the game's dye: tone 0..359 (h), chroma -99..99 (c), brightness -99..99 (b); all 0 = the item's own colours
  text: { name: 'Maple', chat: 'Hello!' }, // shown by a name tag ring and a chat bubble ring
});
// The starting look: the lowest-numbered skin, no face, no hair and nothing worn.
const initial = () => fresh();
// ---------- saved default (kept in this browser, so it is still there when the page is reopened) ----------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const SAVE_KEY = 'maple-layers:default-v2'; // v2: colour values are the game's tone/chroma/brightness numbers
// Styles are stored by their key, not their list position, so a catalogue update cannot shift them.
const pack = () => ({
  gender, skin: state.skin, text: state.text,
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
    for (const kind of ['face', 'hair']) {
      const i = catalog[kind].findIndex(x => x.key === d[kind]?.key);
      if (i >= 0) s[kind] = { style: i, colour: catalog[kind][i].variants.some(v => v.colour === d[kind].colour) ? d[kind].colour : catalog[kind][i].variants[0].colour };
    }
    for (const k of WEAR_ORDER) {
      if (DISABLED_SLOTS.has(k)) continue; // a ring saved before they were switched off is not brought back
      const w = d.wear?.[k];
      if (w && (w.item == null || catalog.wearables[k]?.items.some(i => i.id === w.item))) s.wear[k] = { item: w.item, h: clamp(Math.round(+w.h || 0), 0, 359), c: clamp(Math.round(+w.c || 0), -99, 99), b: clamp(Math.round(+w.b || 0), -99, 99) };
    }
    if (typeof d.text?.name === 'string') s.text = { name: d.text.name.slice(0, 12), chat: String(d.text.chat ?? '').slice(0, 60) };
    return { state: s, gender: ['all', 'female'].includes(d.gender) ? d.gender : 'male' };
  } catch { return null; } // storage blocked or the saved data is damaged: start from the normal default
}
const hasSaved = () => { try { return localStorage.getItem(SAVE_KEY) != null; } catch { return false; } };

let gender = 'male'; // which styles the Face and Hair tabs list: 'all', 'male' or 'female'
let state = fresh();
let activeTab = 'skin';
let source = 'released'; // Face/Hair lists: 'released' (in the game now) or 'datamine' (everything found in the game files, released or not)
const forGender = s => gender === 'all' || s.gender === 'both' || s.gender === gender; // 'both': collab styles listed for both genders
const listed = s => source === 'datamine' || s.released !== false;
let search = ''; // text typed in the catalogue's search box; cleared when the tab changes
const matches = name => name.toLowerCase().includes(search.trim().toLowerCase());
let configTarget = null; // which equipped item the Equipped panel (left) is editing: 'face', 'hair' or a wearable slot
// The colour the Face and Hair catalogues are shown in. Separate from the colour of the face/hair I am wearing.
const browse = { face: 0, hair: 0 };

// Catalogue thumbnails show hair and skin on a face. With no face worn they borrow the first released one for the list being
// shown, so the cards stay readable; the stage and the Equipped panel still show exactly what is worn.
const previewFace = () => {
  if (state.face.style != null) return { ...state.face };
  const g = gender === 'all' ? 'male' : gender;
  const i = catalog.face.findIndex(x => x.released && (x.gender === g || x.gender === 'both'));
  return { style: i >= 0 ? i : null, colour: state.face.colour };
};
const styleOf = kind => state[kind].style == null ? null : catalog[kind][state[kind].style];
const variantOf = kind => {
  const s = styleOf(kind);
  return s ? (s.variants.find(v => v.colour === state[kind].colour) ?? s.variants[0]) : null;
};

// ---------- rendering ----------
async function buildLayers(sel) {
  const layers = [];
  // Worn items declare slot codes (e.g. a hat with H1); parts tied to a covered slot are hidden.
  const covered = new Set(WEAR_ORDER.flatMap(slot => catalog.wearables[slot]?.items.find(i => i.id === sel.wear[slot].item)?.vslots ?? []));
  const add = async (parts, h = 0, c = 0, b = 0) => {
    for (const p of parts.filter(p => !covered.has(p.hiddenBy))) layers.push({ img: await tinted(p.file, h, c, b), x: OX + p.x, y: OY + p.y, z: p.z });
  };
  // A weapon with no standing pose (Orange Toy Hammer) puts the whole body in the two-handed pose.
  const twoHanded = catalog.wearables.weapon?.items.some(i => i.id === sel.wear.weapon.item && i.pose === 'stand2');
  const partsFor = x => (twoHanded && x.parts2) || x.parts;
  const skin = catalog.skins.find(s => s.tone === sel.skin);
  await add(partsFor(skin));
  for (const kind of ['face', 'hair']) {
    const st = sel[kind].style == null ? null : catalog[kind][sel[kind].style];
    const v = st && (st.variants.find(x => x.colour === sel[kind].colour) ?? st.variants[0]);
    if (v && partsFor(v)) await add(partsFor(v));
  }
  for (const slot of WEAR_ORDER) {
    const w = sel.wear[slot];
    const item = catalog.wearables[slot]?.items.find(i => i.id === w.item);
    if (item) await add(partsFor(item), w.h, w.c, w.b);
  }
  for (const slot of RING_SLOTS) {
    if (DISABLED_SLOTS.has(slot)) continue;
    const item = catalog.wearables[slot]?.items.find(i => i.id === sel.wear[slot].item);
    if (item) layers.push(await ringLayer(item.effect, sel.text));
  }
  return layers;
}

// ---------- name tag and chat bubble rings ----------
const RING_SLOTS = ['nameTag', 'chatBalloon'];
const CENTRE_X = OX + 21, FEET_Y = OY + 68, HEAD_Y = OY - 6; // where a tag hangs under the feet and a bubble sits over the head

const canvasOf = im => {
  const c = document.createElement('canvas');
  c.width = im.width; c.height = im.height;
  c.getContext('2d').putImageData(im, 0, 0);
  return c;
};
async function ringPieces(effect) {
  const pieces = {};
  for (const [key, p] of Object.entries(effect.pieces)) pieces[key] = { ...p, cv: canvasOf(await loadImg(p.file)) };
  return pieces;
}
// Draws the ring's tag or bubble for `text`: returns { canvas, ax, ay } as ring.js does.
async function drawRing(effect, text) {
  if (effect.plain) return drawPlainTag(text.name);
  const pieces = await ringPieces(effect);
  return effect.kind === 'nameTag' ? drawNameTag(pieces, effect.colour, text.name) : drawBalloon(pieces, effect.colour, `${text.name} : ${text.chat}`);
}
async function ringLayer(effect, text) {
  const { canvas, ax, ay } = await drawRing(effect, text);
  const img = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  // Tag: its layout line sits just under the feet. Bubble: the bottom of the arrow sits just over the head.
  const y = effect.kind === 'nameTag' ? FEET_Y + (effect.plain ? 3 : 5) - ay : HEAD_Y - canvas.height;
  return { img, x: Math.round(CENTRE_X - ax), y: Math.round(y), z: 9999 };
}
const ringWorn = sel => RING_SLOTS.some(slot => sel.wear[slot].item != null);

const scratch = document.createElement('canvas');
scratch.width = W; scratch.height = H;
// Composes `sel` into the shared scratch canvas and runs `paint` in the same step. Painting must not be deferred:
// other renders share the scratch canvas and would overwrite it.
async function withScene(sel, paint) {
  const buf = composite(await buildLayers(sel), W, H);
  scratch.getContext('2d').putImageData(new ImageData(buf.data, W, H), 0, 0);
  return paint(buf);
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
function paintFocus(canvas, boxW, boxH, n, focus, withBackdrop = false) {
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
  ctx.drawImage(scratch, startX, startY, sw, sh, 0, 0, canvas.width, canvas.height);
}

let renderToken = 0;
async function renderPreview() {
  const token = ++renderToken;
  await withScene(state, buf => {
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
    paintFocus($('preview'), box.width - 2, box.height - 2, n, focus, true);
  });
}

async function drawThumb(canvas, boxEl, sel, view) {
  await withScene(sel, buf => {
    const box = boxEl.getBoundingClientRect();
    let focus = view.focus;
    if (view.centre) {
      // Aim at the middle of what is drawn around the head (not the whole body), so the picture sits in the middle of its tile.
      let x0 = W, x1 = -1, y0 = H, y1 = -1;
      for (let y = OY - 30; y <= OY + 36; y++) for (let x = 0; x < W; x++) if (buf.data[(y * W + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (x1 >= 0) focus = [(x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2];
    }
    paintFocus(canvas, box.width, box.height, Math.max(1, Math.round(view.scale * dpr())), focus);
  });
}

// A selection that shows only the skin plus one thing.
function only(patch) {
  const sel = fresh();
  sel.skin = state.skin;
  return patch(sel);
}

// ---------- UI ----------
const note = text => { $('ph-note').textContent = text; };

// Chapter tabs down the right edge of the book. Short names keep the rail narrow; the chapter title shows the full one.
const TAB_NAMES = { faceAcc: 'Face Acc.', eyeAcc: 'Eye Deco', longcoat: 'Overall', nameTag: 'Name Tag', chatBalloon: 'Chat' };
const CHAPTER_TITLES = { skin: 'Skin Tones', face: 'Faces', hair: 'Hairstyles', cap: 'Hats', faceAcc: 'Face Accessories', eyeAcc: 'Eye Decorations', earrings: 'Earrings', longcoat: 'Overalls', coat: 'Tops', pants: 'Bottoms', glove: 'Gloves', shoes: 'Shoes', cape: 'Capes', weapon: 'Weapons', nameTag: 'Name Tag Rings', chatBalloon: 'Chat Bubble Rings' };

function renderTabs() {
  const tabs = $('tabs');
  const needsFix = new Set([...WEAR_ORDER.filter(s => catalog.wearables[s]?.placeholders?.length), ...['face', 'hair'].filter(k => catalog.placeholders[k].some(p => p.released !== false))]); // datamine placeholders are expected, so only released ones are flagged
  tabs.replaceChildren();
  const add = (key, label, active, group) => {
    const t = el('button', { className: `tab ${group}`, type: 'button', role: 'tab' }, el('span', { className: 'tab-name', textContent: TAB_NAMES[key] ?? label }));
    t.setAttribute('aria-selected', String(activeTab === key));
    t.title = label;
    if (active) t.append(el('span', { className: 'tick', title: 'Equipped' }));
    if (needsFix.has(key)) t.append(el('span', { className: 'fix', title: 'Has placeholders to fix', textContent: '!' }));
    t.onclick = () => { activeTab = key; search = ''; note(''); renderTabs(); renderFilters(); renderContent(); };
    tabs.append(t);
  };
  add('skin', 'Skin', false, 'character');
  add('face', 'Face', state.face.style != null, 'character');
  add('hair', 'Hair', state.hair.style != null, 'character');
  WEAR_ORDER.filter(s => catalog.wearables[s] && !DISABLED_SLOTS.has(s)).forEach((s, i) => add(s, catalog.wearables[s].label, state.wear[s].item != null, i === 0 ? 'wearable first' : 'wearable'));
  $('chapter').textContent = CHAPTER_TITLES[activeTab] ?? catalog.wearables[activeTab]?.label ?? '';
}

// The search box (every tab) and the All / Male / Female picker (Face and Hair), just above the cards.
function renderFilters() {
  const box = $('filters');
  box.replaceChildren();
  $('source').replaceChildren();
  const input = el('input', { type: 'search', className: 'search-input', placeholder: 'Search entries…', value: search, autocomplete: 'off', spellcheck: false });
  input.setAttribute('aria-label', 'Search this list');
  input.oninput = () => { search = input.value; renderContent(true); };
  box.append(el('label', { className: 'search' }, el('span', { className: 'glass', 'aria-hidden': 'true' }), input));
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
  // Released / datamine switch (Face and Hair only). The datamine list is not loaded yet, so for now this only changes the note.
  const src = $('source');
  src.append(el('span', { className: 'source-label', textContent: 'Show' }));
  const sw = el('div', { className: 'seg', role: 'radiogroup', 'aria-label': 'Which styles to list' });
  for (const [s, label] of [['released', 'Released'], ['datamine', 'All · Datamine']]) {
    const btn = el('button', { type: 'button', role: 'radio', textContent: label, title: s === 'released' ? 'Styles that are in the game now' : 'Everything found in the game files, including styles not released yet' });
    btn.setAttribute('aria-pressed', String(source === s));
    btn.setAttribute('aria-checked', String(source === s));
    btn.onclick = () => { source = s; renderFilters(); renderContent(true); };
    sw.append(btn);
  }
  src.append(sw);
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
      () => only(sel => { sel.face = previewFace(); sel.hair = { ...state.hair }; sel[kind] = { style: state[kind].style, colour: v.colour }; return sel; }),
      () => { state[kind].colour = v.colour; afterChange(); }));
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
function equippedCard(e) {
  let b;
  const choose = () => { configTarget = e.key; renderColour(); };
  if (e.key === 'face' || e.key === 'hair') {
    // The face alone on the skin, or the hair alone, so the two tiles look different.
    b = optionCard(e.label, false, MINI_VIEW, () => { const sel = fresh(); sel.skin = state.skin; sel[e.key] = { ...state[e.key] }; return sel; }, choose);
  } else if (RING_SLOTS.includes(e.key)) {
    b = ringCard(e.item, false, e.key, true);
    b.querySelector('.label').textContent = e.label;
    b.onclick = choose;
  } else {
    b = optionCard(e.label, false, null, null, choose, undefined, e.item.icon, MINI_ART);
  }
  b.classList.add('mini');
  b.dataset.slot = e.slot;
  b.title = e.colour ? `${e.name} · ${e.colour}` : e.name;
  b.setAttribute('aria-label', b.title);
  b.setAttribute('aria-pressed', String(e.key === configTarget));
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

// The Equipped panel (left): what I am wearing as sprites, and the colour settings of the one I select.
// Face and hair show every colour of the chosen style; a wearable shows hue, chroma and brightness.
function renderColour() {
  const c = $('colour');
  c.replaceChildren();
  const list = equipped();
  if (!list.some(e => e.key === configTarget)) configTarget = list[0]?.key ?? null;
  c.append(el('h3', { textContent: 'Equipped' }));
  if (!list.length) return c.append(el('div', { className: 'empty-note', role: 'note' }, el('span', { className: 'empty-badge', textContent: 'i', 'aria-hidden': 'true' }),
    el('p', {}, el('strong', { textContent: 'Nothing equipped yet.' }), ' Pick your face, hair and clothing items on the right. You can select them here to change their colour.')));
  const grid = el('div', { className: 'equipped grid' });
  for (const e of list) {
    // Hovering (or tabbing to) a tile shows an x that takes the item off.
    const x = el('button', { className: 'remove', type: 'button', title: `Remove ${e.name}` });
    x.setAttribute('aria-label', `Remove ${e.name}`);
    x.onclick = () => removeEquipped(e);
    grid.append(el('div', { className: 'slot' }, equippedCard(e), x));
  }
  c.append(grid);
  if (configTarget === 'face' || configTarget === 'hair') return c.append(el('h3', { textContent: `${configTarget === 'face' ? 'Face' : 'Hair'} colour` }), colourGrid(configTarget));
  const data = catalog.wearables[configTarget], w = state.wear[configTarget];
  if (RING_SLOTS.includes(configTarget)) return c.append(el('h3', { textContent: data.label }), textFields(configTarget), el('p', { className: 'hint', textContent: 'This ring has no colour settings. Its text is shown in the preview.' }));
  // The game's own numbers, all starting at 0 (the item's own colours): Tone 0 to 359, Chroma and Brightness -99 to +99.
  const signed = v => `${v > 0 ? '+' : ''}${v}`;
  const slider = (label, key, min, max) => sliderRow(label, min, max, 1, w[key], signed, v => { w[key] = v; renderPreview(); });
  const sliders = el('div', { className: 'sliders' }, slider('Tone', 'h', 0, 359), slider('Chroma', 'c', -99, 99), slider('Brightness', 'b', -99, 99));
  const reset = el('button', { className: 'small-btn', type: 'button', textContent: 'Reset colour' });
  reset.onclick = () => { Object.assign(w, { h: 0, c: 0, b: 0 }); renderColour(); renderPreview(); };
  // Random dye: any tone, with chroma and brightness kept to a range that still looks like a dyed item.
  const random = el('button', { className: 'small-btn', type: 'button', textContent: 'Random dye' });
  random.onclick = () => {
    const between = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    Object.assign(w, { h: between(0, 359), c: between(-60, 60), b: between(-50, 50) });
    renderColour(); renderPreview();
  };
  // The game keeps some special effects in their own colour, and the sprite data does not say which, so this preview dyes every part it can.
  const note = el('div', { className: 'dye-note', role: 'note' }, el('span', { className: 'dye-badge', textContent: '!', 'aria-hidden': 'true' }),
    el('p', { textContent: "Some special effects keep their original colour in the game even when dyed. We can't tell which, so this preview dyes every part it can; some items may show little or no change." }));
  c.append(el('h3', { textContent: `${data.label} colour` }), sliders, el('div', { className: 'btn-row' }, random, reset), note);
}

// keepScroll: redraw in place (after a selection or colour change) instead of jumping back to the top of the list.
function renderContent(keepScroll = false) {
  const c = $('content');
  const top = c.scrollTop;
  c.replaceChildren();
  $('toolbar').replaceChildren();
  if (activeTab === 'skin') renderSkin(c);
  else if (activeTab === 'face' || activeTab === 'hair') renderStyles(c, activeTab);
  else renderWearable(c, activeTab);
  if (search && !c.querySelector('.card')) c.append(el('p', { className: 'empty', textContent: 'No entries match. Try another word.' }));
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
    row.append(b);
  }
  $('toolbar').append(el('div', { className: 'colour-bar' }, el('span', { className: 'bar-label', textContent: kind === 'face' ? 'Eye colour' : 'Hair colour' }), row));
}

function renderSkin(c) {
  const grid = el('div', { className: 'grid' });
  for (const s of catalog.skins) {
    const name = SKIN_NAMES[s.tone];
    if (!name || !matches(name)) continue;
    // Same crop as face and hair, on this skin wearing the current face and hair only.
    grid.append(optionCard(name, s.tone === state.skin, VIEW,
      () => { const sel = fresh(); sel.skin = s.tone; sel.face = previewFace(); sel.hair = { ...state.hair }; return sel; },
      () => { state.skin = s.tone; afterChange(); }));
  }
  c.append(grid);
}

function renderStyles(c, kind) {
  renderColourBar(kind);
  if (source === 'datamine') c.append(el('p', { className: 'datamine-note', textContent: 'Showing everything in the game data. Styles marked DATAMINE are not released yet.' }));
  const grid = el('div', { className: 'grid' });
  catalog[kind].forEach((s, i) => {
    if (!forGender(s) || !listed(s) || !matches(s.style)) return;
    // Same style name can exist as separate items; show the id to tell them apart.
    const dup = catalog[kind].filter(o => o.style === s.style && o.gender === s.gender).length > 1;
    const first = s.variants.find(v => v.colour === browse[kind]) ?? s.variants[0];
    const card = optionCard(dup ? `${s.style} (#${s.classicId ?? s.key})` : s.style, state[kind].style === i, VIEW,
      // Preview the style on my current skin, with my current face (or hair) alongside.
      () => only(sel => { sel.face = previewFace(); sel.hair = { ...state.hair }; sel[kind] = { style: i, colour: first.colour }; return sel; }),
      // Clicking the selected style takes it off again.
      () => {
        const on = state[kind].style === i;
        state[kind] = { style: on ? null : i, colour: on ? state[kind].colour : first.colour };
        if (!on) configTarget = kind;
        afterChange();
      }, s.check);
    if (s.classicId) card.title = `${card.title} · Classic ${s.classicId}`;
    if (s.released === false) { card.classList.add('unreleased'); card.append(el('span', { className: 'badge unreleased-badge', textContent: 'DATAMINE' })); }
    grid.append(card);
  });
  for (const p of catalog.placeholders[kind].filter(p => (gender === 'all' || p.gender === 'both' || p.gender === gender) && (p.released !== false || source === 'datamine') && matches(p.name))) grid.append(placeholderCard(p));
  c.append(grid);
}

function renderWearable(c, slot) {
  const data = catalog.wearables[slot];
  const w = state.wear[slot];
  const grid = el('div', { className: 'grid' });
  for (const item of data.items.filter(i => matches(i.name))) {
    const card = item.effect ? ringCard(item, w.item === item.id, slot) : optionCard(item.name, w.item === item.id, null, null, () => select(slot, item.id), item.check, item.icon);
    if (item.classicId) card.title = `${card.title} · Classic ${item.classicId}`;
    grid.append(card);
  }
  for (const p of (data.placeholders ?? []).filter(p => matches(p.name))) grid.append(placeholderCard(p));
  c.append(grid);
}

// A name tag or chat bubble ring: the card shows the tag or bubble itself with sample text (the real text is set in the text fields).
function ringCard(item, selected, slot, compact = false) {
  const canvas = el('canvas', { className: 'ring-sample' });
  const box = el('span', { className: 'art-box' }, canvas);
  const b = el('button', { className: 'card', type: 'button' }, item.check && el('span', { className: 'badge check', textContent: 'CHECK' }), box, el('span', { className: 'label', textContent: item.name }));
  b.title = item.check ?? item.name;
  b.setAttribute('aria-pressed', String(selected));
  b.onclick = () => select(slot, item.id);
  drawRing(item.effect, { name: 'Maple', chat: 'Hello!' }).then(({ canvas: art }) => {
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

// Text inputs for the name tag (name) and the chat bubble (name and message).
function textFields(slot) {
  const field = (label, key, max) => {
    const input = el('input', { type: 'text', maxLength: max, value: state.text[key] });
    input.dataset.key = key;
    input.oninput = () => {
      state.text[key] = input.value; renderPreview();
      // The same field can be on screen twice (the tab and the Equipped panel): keep them in step.
      for (const other of document.querySelectorAll(`.text-field input[data-key="${key}"]`)) if (other !== input) other.value = input.value;
    };
    return el('label', { className: 'text-field' }, el('span', { textContent: label }), input);
  };
  return el('div', { className: 'text-fields' }, slot === 'chatBalloon' ? field('Message', 'chat', 60) : field('Name', 'name', 12));
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
  const out = await withScene(state, buf => {
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (buf.data[(y * W + x) * 4 + 3]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const pad = 4, w = x1 - x0 + 1 + pad * 2, h = y1 - y0 + 1 + pad * 2;
    const c = el('canvas', { width: w * 4, height: h * 4 });
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scratch, x0 - pad, y0 - pad, w, h, 0, 0, w * 4, h * 4);
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
  s.skin = pick(catalog.skins).tone;
  for (const kind of ['face', 'hair']) {
    const options = catalog[kind].map((x, i) => [x, i]).filter(([x]) => forGender(x) && listed(x));
    const [style, i] = pick(options);
    s[kind] = { style: i, colour: pick(style.variants).colour };
  }
  // Each wearable has an even chance of being worn; an overall replaces the top and bottom. Rings are left alone.
  for (const k of WEAR_ORDER) {
    if (DISABLED_SLOTS.has(k) || RING_SLOTS.includes(k) || !catalog.wearables[k]?.items.length || Math.random() < 0.5) continue;
    s.wear[k].item = pick(catalog.wearables[k].items).id;
  }
  if (s.wear.longcoat.item != null) { if (Math.random() < 0.5) { s.wear.coat.item = null; s.wear.pants.item = null; } else s.wear.longcoat.item = null; }
  s.text = state.text;
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
  random: '<path d="M3 7h3.5c3 0 4 3 6 5s3 5 6 5H21M3 17h3.5c1.5 0 2.5-.7 3.5-1.7M13.5 8.7c1-.9 2-1.7 3.5-1.7H21M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5"/>',
  save: '<path d="M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4.5h4.5"/>',
};
function previewButtons() {
  const make = (icon, label, onClick) => {
    const b = el('button', { className: 'tool', type: 'button', title: label });
    b.setAttribute('aria-label', label);
    b.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
    b.onclick = onClick;
    return b;
  };
  $('stage-tools').append(
    make('random', 'Randomise look', randomise),
    make('save', 'Save as my default', saveDefault),
    make('reset', 'Back to my default', resetToDefault));
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

// ---------- start ----------
async function init() {
  const res = await fetch('/catalog.json');
  catalog = await res.json();
  previewButtons();
  loadBackdrop();
  const saved = loadSaved();
  if (saved) { state = saved.state; gender = saved.gender; } else state = initial();
  afterChangeKeep();
  // Redraw at the right pixel sizes when the window changes size or moves to another display.
  let timer;
  window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(() => { renderContent(true); renderPreview(); }, 150); });
}
init().catch(err => { $('content').textContent = `Could not load the catalogue: ${err.message}`; });
