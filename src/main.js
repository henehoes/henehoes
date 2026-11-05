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
// The preview stage is 330 CSS px tall, and taller when the browser is zoomed out (a pixel ratio below 1, where a sprite pixel is one device
// pixel at most): that is what lets the character be drawn at 2x, with the name tag and a chat bubble both in frame, instead of shrinking to 1x.
function setStageHeight() { document.documentElement.style.setProperty('--stage-h', `${Math.min(480, Math.ceil(330 / Math.min(1, dpr())))}px`); }
setStageHeight();

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
let activeTab = 'past'; // the page opens on the Released tab (its newest box: see latestBox)
let mode = 'character'; // which book is open: 'character' (the dress-up catalogue) or 'housing' (src/housing.js)
const lastTab = { character: 'past', housing: 'homes' }; // the tab each book was on when it was left
let source = 'released'; // Face/Hair lists: 'released' (in the game now), 'rotation' (what the Mystery Style Coupon gives right now) or 'datamine' (everything found in the game files, released or not)
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
// A few hats are put in Helmet by hand (rules.json fitHelmet: Demon Goblin, Iljimae Mask): they hide the face or most of the head.
let hatFit = 'all'; // 'all', 'topper', 'cap' or 'helmet'
const hairEffectOf = item => item.fit ?? (item.vslots?.includes('H2') ? 'helmet' : item.vslots?.includes('H1') ? 'cap' : 'topper');
const HAT_FITS = [
  ['topper', 'Topper', 'Sits on your head without changing your hair'],
  ['cap', 'Cap', 'Flattens your hair but leaves most of it visible'],
  ['helmet', 'Helmet', 'Replaces your hair or hides most of your face (helmets, masks, and Hair (Hat) items, which bring their own hair)'],
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
// ---------- poses (the pose buttons on the stage) ----------
// Standing uses the catalogue's own pictures. The attacks, the two-handed stance and the ladder come from public/poses (scripts/extract-poses.mjs), fetched the
// first time they are needed: the body per action and frame (with the points everything hangs on), and each worn item's and hair
// colour's parts, already placed. A face is the standing one moved with the brow, and is left out when the frame turns the face away.
const poseFiles = new Map();
const fetchPose = path => { if (!poseFiles.has(path)) poseFiles.set(path, fetch(path).then(r => r.ok ? r.json() : null).catch(() => null)); return poseFiles.get(path); };
let pose = { name: 'stand' }; // what the preview shows: { name, act, frame } while posing (act 'stand1' is the catalogue's standing picture)
const weaponWorn = sel => sel.wear.weapon.item != null && catalog.wearables.weapon?.items.find(i => i.id === sel.wear.weapon.item);
// What an attack motion (body.motions: one-handed swing, spear stab, ...) does with the worn weapon: the actions it plays in turn and the
// stance it rests in, or null when the weapon has none of them (a Teddy Bear never swings two-handed). With no weapon, every motion works.
async function motionFor(sel, name) {
  const body = await fetchPose('poses/body.json'), m = body?.motions[name], w = weaponWorn(sel);
  const wf = w && await fetchPose(`poses/w/${w.id}.json`);
  if (!m) return null;
  const has = list => wf ? list.filter(a => wf.actions[a]) : list;
  const acts = has(m.acts).length ? has(m.acts) : has(m.fallback ?? []); // two-handed: the polearm swings, for a weapon with only those
  return acts.length ? { acts, rest: m.rest === 'stand2' && (!wf || wf.actions.stand2) ? 'stand2' : 'stand1' } : null;
}
// The parts of one pose frame for `sel`, or null when the pose data cannot be had (the standing pictures are drawn instead).
async function posed(sel, act, i) {
  const body = await fetchPose('poses/body.json'), bf = body?.actions[act]?.[i];
  if (!bf) return null;
  const items = WEAR_ORDER.map(slot => catalog.wearables[slot]?.items.find(x => x.id === sel.wear[slot].item)).filter(Boolean);
  const hairV = sel.hair.style == null ? null : (catalog.hair[sel.hair.style]?.variants.find(x => x.colour === sel.hair.colour) ?? catalog.hair[sel.hair.style]?.variants[0]);
  const paths = [...items, ...baseOf(sel)].map(x => `poses/w/${x.id}.json`).concat(hairV && !hairV.live ? [`poses/hair/${hairV.id}.json`] : []);
  const files = new Map(await Promise.all(paths.map(async p => [p, await fetchPose(p)])));
  const shift = [bf.points.brow[0] - body.stand.brow[0], bf.points.brow[1] - body.stand.brow[1]];
  const moved = parts => parts.map(p => ({ ...p, x: p.x + shift[0], y: p.y + shift[1] }));
  // An item with pose data draws what this frame has of it (nothing, for a weapon on a ladder); one without is moved with the brow.
  const of = (path, fallback) => { const f = files.get(path); return f ? (f.actions[act]?.[i] ?? []).map(p => ({ ...p, file: p.f })) : moved(fallback ?? []); };
  return { face: bf.face, skin: bf.parts.filter(p => p.files[sel.skin]).map(p => ({ ...p, file: p.files[sel.skin] })), moved, of }; // a body part placed differently for another tone is its own entry
}

async function buildLayers(sel, view = null) {
  const P = view && view.act && view.act !== 'stand1' ? await posed(sel, view.act, view.frame) : null;
  // Every sprite file the look needs is requested at once (not one after another: on a phone each request waits for the network, so
  // a look of 25 parts took seconds). Layers keep the order they were added in, which decides how same-height parts stack.
  const jobs = [];
  // Worn items declare slot codes (e.g. a hat with H1, Ae); a part tied to a slot that ANOTHER worn item covers is hidden. An item never
  // hides its own parts (earrings declare Ae themselves), so each owner is told apart: 'body' for the skin, face and hair.
  const base = baseOf(sel);
  const covering = [...WEAR_ORDER.flatMap(slot => { const it = catalog.wearables[slot]?.items.find(i => i.id === sel.wear[slot].item); return it ? [{ owner: slot, codes: it.vslots ?? [] }] : []; }),
    ...base.map((it, n) => ({ owner: `base${n}`, codes: it.vslots ?? [] }))];
  const add = (parts, h = 0, c = 0, b = 0, owner = 'body') => {
    const covered = new Set(covering.filter(e => e.owner !== owner).flatMap(e => e.codes));
    for (const p of parts.filter(p => !covered.has(p.hiddenBy) && (!p.tones || p.tones.includes(sel.skin)))) jobs.push(tinted(p.file, h, c, b).then(img => ({ img, x: OX + p.x, y: OY + p.y, z: p.z })));
  };
  // A weapon with no standing pose (Orange Toy Hammer) puts the whole body in the two-handed pose.
  const twoHanded = isTwoHanded(sel);
  const partsFor = x => (twoHanded && x.parts2) || x.parts;
  const skin = catalog.skins.find(s => s.tone === sel.skin);
  add(P ? P.skin : partsFor(skin));
  for (const kind of ['face', 'hair']) {
    const st = sel[kind].style == null ? null : catalog[kind][sel[kind].style];
    const v = st && (st.variants.find(x => x.colour === sel[kind].colour) ?? st.variants[0]);
    if (!v || !partsFor(v)) continue;
    if (!P) add(partsFor(v));
    else if (kind === 'face') { if (P.face) add(P.moved(v.parts)); }
    else add(v.live ? P.moved(v.parts) : P.of(`poses/hair/${v.id}.json`, v.parts));
  }
  base.forEach((item, n) => add(P ? P.of(`poses/w/${item.id}.json`, item.parts) : partsFor(item), 0, 0, 0, `base${n}`)); // the undergarments, drawn as part of the body
  for (const slot of WEAR_ORDER) {
    const w = sel.wear[slot];
    const item = catalog.wearables[slot]?.items.find(i => i.id === w.item);
    if (!item) continue;
    if (P && !P.face && (slot === 'faceAcc' || slot === 'eyeAcc')) continue; // the face is turned away (ladder)
    add(P ? P.of(`poses/w/${item.id}.json`, item.parts) : partsFor(item), ...dyeOf(item, w), slot);
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
async function withScene(sel, paint, view = null) {
  const buf = composite(await buildLayers(sel, view), W, H);
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
  const w = info.width * n, h = info.height * n;
  const dx = (CENTRE_X - info.centreX - startX) * n, dy = (FOOT_EDGE - info.groundRow - startY) * n;
  ctx.fillStyle = info.skyColour; ctx.fillRect(0, 0, canvasW, canvasH); // beyond the picture's top edge: carry on in the meadow's colour
  // The picture is only 800 sprite pixels wide, so a wide stage (a big monitor, or a browser zoomed out, where a sprite pixel is one device
  // pixel or less) is wider than it. Carry the picture on to the left and right, and below the ground, as mirrored copies: the edges meet
  // seamlessly and the stage is always full. The copy at (0, 0) is the picture itself, drawn as before.
  const tile = (x, y, flipX, flipY) => {
    ctx.save(); ctx.translate(flipX ? x + w : x, flipY ? y + h : y); ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(img, 0, 0, w, h); ctx.restore();
  };
  const rows = Math.max(1, Math.ceil((canvasH - dy) / h)), first = Math.floor(-dx / w), last = Math.floor((canvasW - dx) / w);
  for (let iy = 0; iy < rows; iy++) for (let ix = first; ix <= last; ix++) tile(dx + ix * w, dy + iy * h, Math.abs(ix) % 2 === 1, iy % 2 === 1);
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
  poseButtons(); // the motions the worn weapon has
  const token = ++renderToken;
  await withScene(state, (buf, source) => {
    if (token !== renderToken) return; // a newer render has started
    const box = $('stage').getBoundingClientRect();
    // Normally a fixed frame on the character. With a tag or bubble worn, widen it to fit them.
    let viewW = PREVIEW_VIEW, viewH = PREVIEW_VIEW, focus = PREVIEW_FOCUS;
    if (ringWorn(state)) {
      let x0 = CENTRE_X - 28, x1 = CENTRE_X + 28, y0 = OY - 15, y1 = OY + 72;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (buf.data[(y * W + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      viewH = Math.max(PREVIEW_VIEW, y1 - y0 + 8); viewW = Math.max(PREVIEW_VIEW, x1 - x0 + 8); // each axis on its own: a wide bubble must not shrink a stage that is wide anyway
      focus = [(x0 + x1) / 2, (y0 + y1) / 2];
    }
    // The biggest whole-number scale that fits both ways, allowing the edges to crop by up to 5%.
    const n = Math.max(1, Math.floor(Math.min((box.width - 2) / viewW, (box.height - 2) / viewH) * dpr() / 0.95));
    paintFocus($('preview'), box.width - 2, box.height - 2, n, focus, source, true);
    $('preview').dataset.view = `${viewW}x${viewH}`; // the frame in sprite pixels (read by the tests)
    $('preview').dataset.zoom = n; // device pixels per sprite pixel (read by the tests)
    $('preview').dataset.pose = pose.name === 'stand' ? 'stand' : `${pose.name}:${pose.act}:${pose.frame}`; // read by the tests
  }, pose);
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
const TAB_NAMES = { search: 'All', faceAcc: 'Face Acc.', eyeAcc: 'Eye Deco', longcoat: 'Overall', nameTag: 'Name Ring', chatBalloon: 'Chat Ring', upcoming: 'Upcoming', past: 'Released' };
const CHAPTER_TITLES = { past: 'Released Crates & Styles', upcoming: 'Possible Upcoming Crates', search: 'Search Everything', body: 'Body', face: 'Faces', hair: 'Hairstyles', cap: 'Hats', faceAcc: 'Face Accessories', eyeAcc: 'Eye Decorations', earrings: 'Earrings', longcoat: 'Overalls', coat: 'Tops', pants: 'Bottoms', glove: 'Gloves', shoes: 'Shoes', cape: 'Capes', weapon: 'Weapons', nameTag: 'Name Rings', chatBalloon: 'Chat Rings' };

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
    t.onclick = () => { activeTab = key; if (key === 'past') pastBox = latestBox().id; search = ''; note(''); renderTabs(); renderFilters(); renderContent(); };
    tabs.append(t);
  };
  add('search', 'Search', false, 'lookup');
  add('body', 'Body', false, 'character');
  add('face', 'Face', state.face.style != null, 'character');
  add('hair', 'Hair', state.hair.style != null, 'character');
  WEAR_ORDER.filter(s => catalog.wearables[s] && !DISABLED_SLOTS.has(s)).forEach((s, i) => add(s, catalog.wearables[s].label, state.wear[s].item != null, i === 0 ? 'wearable first' : 'wearable'));
  // Released (every crate and box so far, newest first) and Upcoming (a guess) close the rail, below Chat Ring.
  add('past', 'Released crates and boxes, and what each held', false, 'wearable past');
  if (SHOW_UPCOMING) add('upcoming', 'Possible items for the next Mystery Fashion Crates (unconfirmed)', false, 'wearable upcoming'); // never a checkmark: it is not something you wear
  tabs.scrollLeft = scrolled;
  $('chapter').textContent = CHAPTER_TITLES[activeTab] ?? catalog.wearables[activeTab]?.label ?? '';
}

// The search box (every tab) and the All / Male / Female picker (Face and Hair), just above the cards.
let searchTimer;
function renderFilters() {
  const box = $('filters');
  box.replaceChildren();
  $('source').replaceChildren();
  if (activeTab === 'past' || activeTab === 'upcoming') return; // Released and Upcoming are browsed by category and box, so they have no search bar
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
  renderSourceSwitch('Which styles to list', 'Styles', true);
}

// The Released / All · Datamine switch (Face, Hair and the two ring tabs), in the row above the search box. `what` names the things listed.
function renderSourceSwitch(label, what, withRotation = false) {
  const src = $('source');
  src.append(el('span', { className: 'source-label', textContent: 'Show' }));
  const sw = el('div', { className: 'seg', role: 'radiogroup', 'aria-label': label });
  const options = [['released', 'Released'], ...(withRotation ? [['rotation', 'Mystery Rotation']] : []), ['datamine', 'All · Datamine']];
  const shown = options.some(([s]) => s === source) ? source : 'released'; // the ring tabs have no rotation view
  const tips = { released: `${what} that are in the game now`, rotation: `${what} the Mystery Style Coupon can give right now`, datamine: `Everything found in the game files, including ${what.toLowerCase()} not released yet` };
  for (const [s, text] of options) {
    const btn = el('button', { type: 'button', role: 'radio', textContent: text, title: tips[s] });
    btn.setAttribute('aria-pressed', String(shown === s));
    btn.setAttribute('aria-checked', String(shown === s));
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
// The Availability section of a worn item's panel: whether it is in a box on sale now, or when it was last available, from the boxes in data/boxes.json.
// The box's group names what it was ("Mystery Face", "Mystery Hair", "Mystery Fashion Crate"). An item in no box we know of says so, and one that is not released says that.
const BOX_NOUN = { 'mystery-crates': () => 'Mystery Fashion Crate', aurora: () => 'Aurora Stamp Shop', 'mystery-styles': kind => kind === 'face' ? 'Mystery Face' : 'Mystery Hair' };
function availability(target) {
  const kind = target === 'face' || target === 'hair' ? target : 'wearable';
  const item = kind === 'wearable' ? catalog.wearables[target]?.items.find(i => i.id === state.wear[target].item) : styleOf(kind);
  if (!item) return null;
  const same = it => kind === 'wearable' ? it.kind === 'wearable' && it.id === item.id : it.kind === kind && it.key === item.key && it.gender === item.gender;
  const found = catalog.boxes.flatMap(g => g.boxes.filter(b => b.items.some(same)).map(b => ({ b, noun: BOX_NOUN[g.id]?.(kind) ?? g.title })));
  const line = (dot, text) => el('p', { className: `ends-line avail${dot ? '' : ' ended'}` }, el('i', { className: 'ends-dot', 'aria-hidden': 'true' }), el('span', { textContent: text }));
  const now = found.find(f => onSale(f.b));
  if (now) return line(true, `Available now${now.b.end ? ` · ${leftText(saleEnd(now.b) - Date.now(), isDay(now.b.end))}` : ''} · ${now.noun}`);
  const last = found.sort((x, y) => saleEnd(y.b) - saleEnd(x.b))[0];
  if (last) return line(false, `Last available ${agoText(Date.now() - saleEnd(last.b), isDay(last.b.end))} · ${last.noun}`);
  return line(false, item.released === false || item.upcoming ? 'Not released yet' : 'Not in any Mystery box on record');
}
function renderColour() {
  renderColourPanel();
  const c = $('colour'), target = mode === 'housing' ? null : equipped().find(e => e.key === configTarget)?.key, avail = target && availability(target);
  if (avail) c.append(panelSection('Availability', avail));
}
function renderColourPanel() {
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
  else if (activeTab === 'upcoming') renderUpcoming(c)
  else if (activeTab === 'past') renderPast(c);
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

// Mystery Styles boxes (hair and faces from the coupon) on rotation now, by the start and end in data/boxes.json (UTC). The end is the last minute sold, so it runs
// to the end of that minute; a start with no time is a date only.
const DAY = 864e5;
// An `end` with no time ("2026-11-18") is a whole UTC day: the box is on sale to the end of that day, and its line gives the date and the days left, never an hour.
const isDay = end => typeof end === 'string' && end.length <= 10;
const endMs = b => b.end ? Date.parse(b.end) + (isDay(b.end) ? DAY : 6e4) : Infinity;
const liveStyleBoxes = () => {
  const now = Date.now();
  return (catalog.boxes.find(g => g.id === 'mystery-styles')?.boxes ?? []).filter(b => b.end && now >= Date.parse(b.start ?? b.end) && now < endMs(b));
};
// "Ends Wed 4 Nov · 4:00 PM GMT+8 · 21 hours left": when the soonest of these boxes ends, in the viewer's timezone on a 12-hour clock, and the time left. A box's end
// is the last minute it is sold, so it runs to the end of that minute. Null when every box has already ended.
const leftText = (left, day) => { if (day) { const days = Math.max(1, Math.ceil(left / DAY)); return `${days} day${days === 1 ? '' : 's'} left`; } const hours = Math.ceil(left / 36e5); return left <= DAY ? (hours <= 1 ? 'less than an hour left' : `${hours} hours left`) : `${Math.ceil(left / DAY)} days left`; };
function endsText(ends, day = false) {
  const left = ends - Date.now();
  if (left <= 0) return endedText(ends, day);
  if (day) return `Ends ${dayName(ends)} · ${leftText(left, true)}`;
  const date = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(ends).replace(',', '');
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' }).format(ends).replace(/\b([ap])m\b/i, (_, x) => `${x.toUpperCase()}M`);
  return `Ends ${date} · ${time} · ${leftText(left)}`;
}
// "Ended Wed 28 Oct · 3 days ago": the same line for a box that is over, in grey (the date only, no time).
const dayName = ends => new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(ends - 1).replace(',', ''); // the last UTC day
const agoText = (ago, day = false) => { if (day) { const days = Math.floor(ago / DAY); return days < 1 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`; } const hours = Math.floor(ago / 36e5), days = Math.floor(ago / DAY); return ago < 36e5 ? 'less than an hour ago' : ago < DAY ? `${hours} hour${hours === 1 ? '' : 's'} ago` : `${days} day${days === 1 ? '' : 's'} ago`; };
function endedText(ends, day = false) {
  const when = agoText(Date.now() - ends, day);
  if (day) return `Ended ${dayName(ends)} · ${when}`;
  const date = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(ends).replace(',', '');
  return `Ended ${date} · ${when}`;
}
const nextAgoChange = (ends, day = false) => { const ago = Date.now() - ends, unit = day || ago >= DAY ? DAY : 36e5; return ends + (Math.floor(ago / unit) + 1) * unit; };
function endedLine(box) {
  if (!box.end || endMs(box) > Date.now()) return null;
  const ends = endMs(box), day = isDay(box.end);
  const line = el('p', { className: 'ends-line ended' }, el('i', { className: 'ends-dot', 'aria-hidden': 'true' }), el('span', { textContent: endedText(ends, day) }));
  line.dataset.ended = ends; if (day) line.dataset.day = '1';
  wakeAt(nextAgoChange(ends, day));
  return line;
}
function endsLine(boxes, className = '') {
  const next = boxes.filter(b => b.end && endMs(b) > Date.now()).sort((x, y) => endMs(x) - endMs(y))[0];
  if (!next) return null;
  const ends = endMs(next), day = isDay(next.end);
  const line = el('p', { className: `ends-line ${className}`.trim() }, el('i', { className: 'ends-dot', 'aria-hidden': 'true' }), el('span', { textContent: endsText(ends, day) }));
  line.dataset.ends = ends; if (day) line.dataset.day = '1';
  wakeAt(nextChange(ends, day));
  return line;
}
// Keeps the countdown current without a refresh. It wakes only when the words would change (on the hour when under a day is left, on the day otherwise, at the
// end of the box), and again as soon as the page is shown (a sleeping laptop, a background tab). A line whose box has ended, or a Mystery Rotation list whose boxes
// have changed, redraws the page instead.
let rotationSeen = ''; // the live Mystery Styles boxes the rotation view was drawn for
let tickTimer = null, tickAt = Infinity;
const nextChange = (ends, day = false) => { const left = ends - Date.now(), unit = day || left > DAY ? DAY : 36e5; return ends - (Math.ceil(left / unit) - 1) * unit; };
function wakeAt(ms) {
  ms = Math.max(ms + 500, Date.now() + 1000); // a moment past the change; the timer is capped (6 h) and simply sets itself again
  if (ms >= tickAt) return;
  clearTimeout(tickTimer); tickAt = ms;
  tickTimer = setTimeout(() => { tickAt = Infinity; tickEnds(); }, Math.min(ms - Date.now(), 216e5));
}
const mysteryBoundary = () => Math.min(...(catalog.boxes.find(g => g.id === 'mystery-styles')?.boxes ?? []).flatMap(b => [b.start && Date.parse(b.start), b.end && endMs(b)]).filter(x => x > Date.now()));
function paintSaleDot(dot, on) {
  dot.classList.toggle('on', on);
  dot.closest('.pill').title = dot.closest('.pill').title.replace(/ · (on sale|off sale)$/, '') + (on ? ' · on sale' : ' · off sale');
}
function tickEnds() {
  clearTimeout(tickTimer); tickAt = Infinity; // set again below from what is on the page now, so an old wake-up can never block a new one
  if (mode === 'housing') return;
  let redraw = false;
  for (const line of document.querySelectorAll('.ends-line[data-ends], .ends-line[data-ended]')) { // not the Availability line in the Equipped panel, which is drawn once
    const day = !!line.dataset.day;
    if (line.dataset.ended) { const ended = +line.dataset.ended; line.querySelector('span').textContent = endedText(ended, day); wakeAt(nextAgoChange(ended, day)); continue; }
    const ends = +line.dataset.ends;
    if (ends <= Date.now()) redraw = true; else { line.querySelector('span').textContent = endsText(ends, day); wakeAt(nextChange(ends, day)); }
  }
  for (const dot of document.querySelectorAll('.sale-dot')) {
    if (+dot.dataset.end <= Date.now()) { if (dot.classList.contains('on')) paintSaleDot(dot, false); } else wakeAt(+dot.dataset.end);
  }
  const rotating = source === 'rotation' && (activeTab === 'hair' || activeTab === 'face');
  if (rotating && liveStyleBoxes().map(b => b.id).join() !== rotationSeen) redraw = true;
  if (redraw) renderContent(true);
  else if (rotating && Number.isFinite(mysteryBoundary())) wakeAt(mysteryBoundary());
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) tickEnds(); });
function renderStyles(c, kind) {
  renderColourBar(kind);
  if (kind === 'face' && catalog.face.some(s => s.variants.some(v => v.colour === browse.face && v.label === NO_COUPON_EYES))) c.append(eyeWhiteNote()); // the list is shown in White
  if (source === 'datamine') c.append(el('p', { className: 'datamine-note', textContent: 'Showing everything in the game data. Styles marked DATAMINE are not released yet.' }));
  // Mystery Rotation view: only the styles a live Mystery Styles box can give right now, with the end and the time left.
  const live = source === 'rotation' ? liveStyleBoxes() : [];
  rotationSeen = live.map(b => b.id).join();
  if (source === 'rotation' && Number.isFinite(mysteryBoundary())) wakeAt(mysteryBoundary());
  const inRotation = s => live.some(b => b.items.some(it => it.kind === kind && it.key === s.key && it.gender === s.gender));
  if (source === 'rotation') {
    const line = live.length && endsLine(live, 'rotation-line');
    if (line) c.append(line);
    else c.append(el('p', { className: 'hint rotation-line', textContent: 'No Mystery Style Coupon rotation is running right now.' }));
  }
  const grid = el('div', { className: 'grid' });
  catalog[kind].forEach((s, i) => { if (forGender(s) && listed(s) && matches(s.style) && (source !== 'rotation' || inRotation(s))) grid.append(styleCard(kind, s, i)); });
  if (source !== 'rotation') for (const p of catalog.placeholders[kind].filter(p => (gender === 'all' || p.gender === 'both' || p.gender === gender) && (p.released !== false || source === 'datamine') && matches(p.name))) grid.append(placeholderCard(p));
  c.append(grid);
}

// The Upcoming tab: equipment the game files mark as dyeable that is not in the catalogue. UNCONFIRMED, and the page says so.
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
// ---------- Past tab: every past crate and box and what it held ----------
const pct = r => `${+r.toFixed(2)}%`; // 2 -> "2%", 2.5 -> "2.5%", 16.67 -> "16.67%"
function boxCards(box) {
  // The box's items as the usual cards, grouped like the Next Crate tab: by slot, then hairs, then faces. `matches` filters by name.
  const groups = new Map(); // title -> [card builders]
  const put = (title, name, build) => { if (matches(name)) (groups.get(title) ?? groups.set(title, []).get(title)).push(build); };
  const rated = (card, it) => { if (it.rate != null) card.title += ` · ${pct(it.rate)}`; return card; }; // the rate is in the hover text only: as a badge it was too small to read
  for (const slot of WEAR_ORDER) for (const it of box.items.filter(x => x.kind === 'wearable' && x.slot === slot)) {
    const item = catalog.wearables[slot].items.find(i => i.id === it.id);
    if (item) put(CHAPTER_TITLES[slot] ?? catalog.wearables[slot].label, item.name, () => rated(wearableCard(slot, item), it));
  }
  // Hair and faces come out as sections (Hairstyles, Faces), each split by the gender list the box puts them in (Male, Female).
  const styles = [];
  for (const [kind, title] of [['hair', 'Hairstyles'], ['face', 'Faces']]) {
    const subs = [];
    for (const [sex, label] of [['male', 'Male'], ['female', 'Female']]) {
      const builders = [];
      for (const it of box.items.filter(x => x.kind === kind && (x.sex ?? x.gender) === sex)) {
        const i = catalog[kind].findIndex(x => x.key === it.key && x.gender === it.gender);
        if (i >= 0 && matches(catalog[kind][i].style)) builders.push(() => rated(styleCard(kind, catalog[kind][i], i), it));
      }
      if (builders.length) subs.push({ title: label, builders });
    }
    if (subs.length) styles.push({ kind, title, subs });
  }
  return { groups, styles };
}
let pastBox = null; // the box shown below the pills; set to the latest box whenever the Released tab is opened
const pillLabel = b => b.pill && b.dates ? `${b.dates} · ${b.pill}` : (b.dates ?? b.pill); // date first, then the name where there is one
const allBoxes = () => catalog.boxes.flatMap(g => g.boxes);
const latestBox = () => allBoxes().find(b => b.latest) ?? allBoxes()[0]; // the Released tab always opens on the newest box
const groupOf = box => catalog.boxes.find(g => g.boxes.some(x => x.id === box.id));
// A box is on sale from its start until the end of its last minute; no `end` means it has not been given one, so it still is.
const saleEnd = endMs;
const onSale = box => Date.now() >= Date.parse(box.start ?? 0) && Date.now() < saleEnd(box);
function renderPast(c) {
  // A tab per category (Mystery Fashion Crates, Mystery Styles, Aurora Stamp Shop); the selected category's boxes are pills, in date order,
  // and the selected box's title and items are drawn below. Picking a category opens its newest box (the last pill).
  const all = allBoxes();
  if (!all.some(b => b.id === pastBox)) pastBox = latestBox().id;
  const current = groupOf(all.find(b => b.id === pastBox));
  const tabs = el('div', { className: 'past-tabs', role: 'tablist' });
  for (const g of catalog.boxes) {
    const t = el('button', { className: 'past-tab', type: 'button', role: 'tab', textContent: g.tab ?? g.title, title: g.title });
    t.setAttribute('aria-selected', String(g.id === current.id));
    t.onclick = () => { pastBox = (g.boxes.find(b => b.latest) ?? g.boxes[g.boxes.length - 1]).id; renderContent(true); };
    tabs.append(t);
  }
  c.append(tabs);
  const row = el('div', { className: 'pills', role: 'radiogroup', 'aria-label': current.title });
  for (const box of current.boxes) {
    const btn = el('button', { className: 'pill', type: 'button', role: 'radio', title: box.name + (box.dates ? ` (${box.dates})` : '') }, el('span', { className: 'sale-dot', 'aria-hidden': 'true' }), pillLabel(box));
    const dot = btn.firstChild; dot.dataset.end = saleEnd(box); paintSaleDot(dot, onSale(box)); // grey once the box is off sale, green while it is on sale
    if (saleEnd(box) > Date.now()) wakeAt(saleEnd(box));
    btn.setAttribute('aria-pressed', String(box.id === pastBox)); btn.setAttribute('aria-checked', String(box.id === pastBox));
    btn.onclick = () => { pastBox = box.id; renderContent(true); };
    row.append(btn);
  }
  c.append(row);
  const box = all.find(b => b.id === pastBox), { groups, styles } = boxCards(box);
  const count = [...groups.values()].reduce((n, l) => n + l.length, 0) + styles.reduce((n, sec) => n + sec.subs.reduce((m, sub) => m + sub.builders.length, 0), 0);
  // The selected box's title: the name large, then its dates and size. Not an alert box.
  c.append(el('div', { className: 'past-title' }, el('h2', { textContent: box.name }),
    el('p', { className: 'past-meta' }, ...[box.dates ?? box.range, box.pending ? 'contents not added yet' : `${count} item${count === 1 ? '' : 's'}`].filter(Boolean).flatMap((t, i) => i ? [el('span', { className: 'dot', textContent: '·', 'aria-hidden': 'true' }), t] : [t]))));
  const endsIn = endsLine([box]) ?? endedLine(box); // green "Ends…" while on sale, grey "Ended… ago" once over
  if (endsIn) c.append(endsIn);
  if (box.pending) c.append(infoNote('The contents of this one have not been added yet.'));
  if (box.note) c.append(el('p', { className: 'hint', textContent: box.note }));
  for (const [title, builders] of groups) {
    c.append(el('h3', { className: 'group-title', textContent: `${title} · ${builders.length}` }));
    const grid = el('div', { className: 'grid' });
    for (const build of builders) grid.append(build());
    c.append(grid);
  }
  // Hairs and faces (Mystery Styles): a big heading per kind, its colour options right under it (renderColourBar draws into the toolbar above
  // the list, so the bar is moved down into the content), then the Male and Female lists. The cards are drawn in the chosen colour.
  for (const sec of styles) {
    c.append(el('h3', { className: 'past-section', textContent: sec.title }));
    renderColourBar(sec.kind);
    c.append(...$('toolbar').children);
    if (sec.kind === 'face' && catalog.face.some(st => st.variants.some(v => v.colour === browse.face && v.label === NO_COUPON_EYES))) c.append(eyeWhiteNote());
    for (const sub of sec.subs) {
      c.append(el('h4', { className: 'group-title sub', textContent: `${sub.title} · ${sub.builders.length}` }));
      const grid = el('div', { className: 'grid' });
      for (const build of sub.builders) grid.append(build());
      c.append(grid);
    }
  }
}

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
// Plays a pose. An attack motion plays its next action once (each click the next: swing 1, 2, 3, 1, ...) and then rests in the motion's
// stance; the ladder climbs twice and goes back to the stance it left (`resting`). Every frame is built once before it starts (fetching
// its pictures), so the motion does not stutter.
let poseRun = 0, motionStep = -1, resting = { name: 'stand' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function playPose(name) {
  const run = ++poseRun;
  const body = await fetchPose('poses/body.json');
  if (!body) { flash('Could not load the poses'); return; }
  const motion = body.motions[name] && await motionFor(state, name);
  if (body.motions[name] && !motion) return;
  if (motion) motionStep = (pose.name === name ? motionStep + 1 : 0) % motion.acts.length; // a ladder in between keeps the count
  const act = motion ? motion.acts[motionStep] : name, frames = body.actions[act];
  const back = motion ? { name, act: motion.rest, frame: 0 } : resting;
  await Promise.all(frames.map((_, frame) => buildLayers(state, { name, act, frame })));
  if (run !== poseRun) return;
  if (motion) resting = back;
  for (let round = 0; round < (motion ? 1 : 2); round++) for (let i = 0; i < frames.length; i++) {
    pose = { name, act, frame: i }; poseButtons();
    await renderPreview();
    await sleep(frames[i].delay);
    if (run !== poseRun) return;
  }
  pose = back; poseButtons(); return renderPreview();
}
const stopPose = () => { poseRun++; pose = resting = { name: 'stand' }; };
// The pose buttons' icons: 16 x 16 pixel drawings of each weapon (designed by the user) and a ladder, in the button's ink. A letter is a
// pixel: o outline; w, r, d the darker fills (wood, gem, dark steel); g, s the lighter ones (gold, steel). Each is drawn cropped to its
// own size, so a small drawing fills the button as well as a big one.
const POSE_ICONS = {
  oneHanded: ["", "............oo", ".......oo..owo", ".......oggowo", "........ogro", "........odggo", ".......odsoogo", "......odso..oo", ".....odso", "....odso", "...osso", "..osso", "..ooo", "", "", ""], // a sword
  twoHanded: ["........o", ".......owo.o", ".......owooso", ".......owossdo", "......oowosssdo", ".....osowossssdo", "....ossowossssdo", ".....osowossssdo", "......oowosssdo", ".......owossdo", ".......owooso", ".......owo.o", ".......owo", ".......owo", "......ogggo", ".......ooo"], // a two-handed axe
  spear: ["...............o", ".............ooo", "...........oosdo", ".........oossddo", ".......oosssddoo", ".......osssdoo", ".......ossoo", ".......ooo", "......ogo", ".....owo", "....owo", "...owo", "..owo", ".owo", "owo", "wo"], // a spear (a bigger, leaf-shaped head than the design, so it reads as one)
  stab: ["", "", "", "", "", ".....oo", "....ogo.ooooo", "..ooogoosssssoo", ".owwwrosssssssso", "..ooogoodddddoo", "....ogo.ooooo", ".....oo", "", "", "", ""], // a dagger thrust
  crossbow: ["", ".....oo", ".....oso", "......oso", "......odo", ".oooooodoooo", "owwwwwogowwwo..o", "owwwwwogooooosso", "ooooowogowwwo..o", "....owodoooo", "....ooodo", "......oso", ".....oso", ".....oo", "", ""], // a crossbow
  bow: ["..oo", "..owo", "..o.owo", "..o..owo", "..o...owo", "..o....owo", "..o.....owo", "ggoooooooogwooso", "..o.....owo", "..o....owo", "..o...owo", "..o..owo", "..o.owo", "..owo", "..oo", ""], // a bow and arrow
  ladder: ["...owo....owo", "...owo....owo", "...owoooooowo", "...owwwwwwwwo", "...owoooooowo", "...owo....owo", "...owoooooowo", "...owwwwwwwwo", "...owoooooowo", "...owo....owo", "...owoooooowo", "...owwwwwwwwo", "...owoooooowo", "...owo....owo", "...owo....owo", "...ooo....ooo"],
};
const ICON_SHADE = { o: 1, w: .6, r: .6, d: .6, g: .3, s: .2 };
// The attack motions (each click the next swing), then the ladder.
const MOTION_BUTTONS = [['oneHanded', 'One-handed swing'], ['twoHanded', 'Two-handed swing'], ['spear', 'Spear stab'], ['stab', 'Dagger stab'], ['crossbow', 'Crossbow shot'], ['bow', 'Bow shot']];
const POSES = [['ladder', 'Climb a ladder (twice)']];
function poseSvg(rows) {
  const px = rows.flatMap((r, y) => [...r].flatMap((c, x) => ICON_SHADE[c] ? [{ x, y, c }] : []));
  const x0 = Math.min(...px.map(p => p.x)), x1 = Math.max(...px.map(p => p.x)) + 1, y0 = Math.min(...px.map(p => p.y)), y1 = Math.max(...px.map(p => p.y)) + 1;
  const side = Math.max(x1 - x0, y1 - y0), box = `${(x0 + x1 - side) / 2} ${(y0 + y1 - side) / 2} ${side} ${side}`; // a square around the drawing
  return `<svg viewBox="${box}" width="22" height="22" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${px.map(({ x, y, c }) => `<rect x="${x}" y="${y}" width="1" height="1"${ICON_SHADE[c] < 1 ? ` fill-opacity="${ICON_SHADE[c]}"` : ''}/>`).join('')}</svg>`;
}
function poseButtons() {
  const box = $('pose-tools');
  if (!box) return;
  if (mode === 'housing') return box.replaceChildren();
  const button = ([name, label]) => {
    const b = el('button', { className: 'tool pose', type: 'button', title: label });
    b.setAttribute('aria-label', label); b.dataset.pose = name; b.dataset.label = label;
    b.innerHTML = poseSvg(POSE_ICONS[name]);
    b.onclick = () => playPose(name);
    return b;
  };
  if (!box.children.length) box.append(el('div', { className: 'pose-row' }, ...MOTION_BUTTONS.map(button), ...POSES.map(button)));
  const all = [...box.querySelectorAll('.tool')];
  for (const b of all) b.setAttribute('aria-pressed', String(b.dataset.pose === pose.name));
  // A motion the worn weapon cannot do is greyed out (and a pose resting in one goes back to standing when the weapon changes).
  const w = weaponWorn(state);
  Promise.all(MOTION_BUTTONS.map(([name]) => motionFor(state, name))).then(ok => {
    if (weaponWorn(state) !== w) return;
    MOTION_BUTTONS.forEach(([name], i) => {
      const b = all.find(x => x.dataset.pose === name);
      b.disabled = !ok[i];
      b.title = ok[i] ? b.dataset.label : `${b.dataset.label}: not a motion the ${w.name} has`;
    });
    if (MOTION_BUTTONS.some(([name], i) => name === pose.name && !ok[i])) { stopPose(); poseButtons(); renderPreview(); }
  });
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
    make('reset', 'Back to my default', resetToDefault)]));  poseButtons();
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
  stopPose();
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
  const redraw = () => { clearTimeout(timer); timer = setTimeout(() => { setStageHeight(); renderContent(true); renderColour(); renderPreview(); }, 150); };
  window.addEventListener('resize', redraw);
  // Zooming the page (or dragging it to a screen with another pixel density) changes the device pixel ratio, and not every browser sends a
  // resize for that. Check the ratio itself twice a second, so the thumbnails and the preview are redrawn and re-centred either way.
  let seenRatio = dpr();
  setInterval(() => { if (dpr() !== seenRatio) { seenRatio = dpr(); redraw(); } }, 500);
}
init().catch(err => { $('content').textContent = `Could not load the catalogue: ${err.message}`; });
