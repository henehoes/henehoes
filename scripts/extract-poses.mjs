// Reads the attack, two-handed stance and ladder poses from the game's own files for the preview's pose buttons, and writes them as ready-placed parts:
//   public/poses/body.json            the body (every skin tone) per action and frame: its parts, the frame's delay, whether the face shows,
//                                     and the attachment points (brow, navel, hand, ...), in the app's sprite coordinates
//   public/poses/w/<catalogue id>.json a wearable's parts per action and frame (a weapon only has the actions its file has)
//   public/poses/hair/<colour id>.json a hair colour's parts per action and frame (the back view on ladders)
//   public/sprites/pose/<hash>.png    every picture, once (named by its contents, so the many frames that reuse a picture share one file)
// Faces are not written: the app moves the standing face with the brow, and hides it when the frame says the face does not show.
// Placement is the client's: the body sits at the origin, every other part is moved so one of its points (map) lands on the same point
// already placed (navel, neck, hand, brow, ...). The standing pose's navel lines up with the catalogue's (ANCHORS in build-catalog.mjs).
//   WZ_DATA=".../maplestorycw/appdata/Data" node scripts/extract-poses.mjs        (needs libwz: see scripts/lib-wz.mjs)
import { readFileSync, writeFileSync, mkdirSync, rmSync, renameSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { image, png, originOf, at, str, val } from './lib-wz.mjs';

// The pose buttons' attack motions, as the game numbers them: each click plays the next one, then the character rests in the motion's
// stance (stand2 holds the weapon in both hands). A weapon offers a motion when its file has any of the motion's actions (in the class
// the catalogue draws it from: weaponClass, else 30).
const MOTIONS = {
  oneHanded: { acts: ['swingO1', 'swingO2', 'swingO3'], rest: 'stand1' },
  stab: { acts: ['stabO1', 'stabO2'], rest: 'stand1' },
  twoHanded: { acts: ['swingT1', 'swingT2', 'swingT3'], rest: 'stand2' },
  spear: { acts: ['stabT1', 'stabT2'], rest: 'stand2' },
  polearm: { acts: ['swingP1', 'swingP2'], rest: 'stand2' },
  bow: { acts: ['shoot1'], rest: 'stand1' },
  crossbow: { acts: ['shoot2'], rest: 'stand2' },
};
const ACTIONS = [...Object.values(MOTIONS).flatMap(m => m.acts), 'stand2', 'ladder'];
const SKIN_TONES = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13];
const FOLDERS = { 100: 'Cap', 101: 'Accessory', 102: 'Accessory', 103: 'Accessory', 104: 'Coat', 105: 'Longcoat', 106: 'Pants', 107: 'Shoes', 108: 'Glove', 110: 'Cape', 170: 'Weapon' };
const POINT_ORDER = ['brow', 'hand', 'handMove', 'navel', 'neck'];

const read = f => JSON.parse(readFileSync(f, 'utf8'));
const catalog = read('public/catalog.json'), zmap = read('data/zmap.json'), rules = read('data/rules.json');
const smap = image('Base', 'smap.img');
const zOf = layer => { const i = zmap.indexOf(rules.zFallback[layer] ?? layer); return i === -1 ? 74.6 : i; };
// A part of the hair, head or face (or an accessory) is hidden when another worn item covers its slot: the catalogue's rule, else the game's
// own slot code for the layer (the back-view layers: backHair H3, ...).
const COVERABLE = /^(H[1-6]|Hf|Hb|Hs|Hd|Fc|Af|Ay|Ae)$/;
const hiddenByOf = layer => rules.partHiddenBy[layer] ?? (() => { const s = smap && at(smap, layer); const v = s && val(s); return typeof v === 'string' && COVERABLE.test(v) ? v : undefined; })();

const PICS = 'public/sprites/pose';
// Old pictures and poses are cleared file by file: removing the folders themselves breaks libwz's writes into them (it keeps the folder it saw).
for (const d of [PICS, 'public/poses/w', 'public/poses/hair']) { mkdirSync(d, { recursive: true }); for (const f of readdirSync(d)) rmSync(`${d}/${f}`); }
const seen = new Map(); let picCount = 0, tmpN = 0;
function save(p) { // -> the picture's file name (by its contents)
  const tmp = `${PICS}/_tmp${tmpN++}.png`; p.saveToFile(tmp); // a new name each time: libwz cannot write to a path it wrote before (even after a rename)
  const h = createHash('sha1').update(readFileSync(tmp)).digest('hex').slice(0, 14);
  if (!seen.has(h)) { renameSync(tmp, `${PICS}/${h}.png`); seen.set(h, true); picCount++; } else rmSync(tmp);
  return `sprites/pose/${h}.png`;
}

const follow = (node, img) => { // a frame or part that is a link to another one
  for (let hop = 0; node && hop < 5; hop++) {
    const inl = node.getFromPath?.('_inlink')?.getString?.(); if (inl) { node = at(img, inl); continue; }
    if (node.getPropertyType() === 13 && !node.getFromPath?.('_outlink')) { try { node = node.getLinkValue(); continue; } catch { return null; } }
    break;
  }
  return node;
};
// The pieces of one frame: [{ name, pic, origin, maps, layer }] (a hair shade comes as one piece per picture, with the skin tones it is for)
function pieces(frame, img) {
  const out = [];
  for (const c of frame?.wzProperties() ?? []) {
    const name = c.getName(); if (name === 'delay' || name === 'face' || name === 'move' || /ear$/i.test(name) && name !== 'accessoryEar') continue;
    const node = follow(c, img); if (!node) continue;
    if (name === 'hairShade') {
      const byPic = new Map();
      for (const tone of SKIN_TONES) {
        let n = node.getFromPath(String(tone)) ?? node.getFromPath('0');
        for (let hop = 0; n && n.getPropertyType() === 13 && hop < 4; hop++) n = node.getFromPath(String(n.getValue()));
        if (!n || n.getPropertyType() === 13) continue;
        if (!byPic.has(n.getName())) byPic.set(n.getName(), { n, tones: [] });
        byPic.get(n.getName()).tones.push(tone);
      }
      for (const { n, tones } of byPic.values()) { const p = png(n); if (p) out.push(piece(name, n, p, tones)); }
      continue;
    }
    const p = png(node) ?? png(c); if (!p) continue;
    out.push(piece(name, c.getFromPath('origin') ? c : node, p));
  }
  return out;
}
// A few pictures give a number instead of a layer name: those are drawn on their own name's layer.
function piece(name, own, p, tones) {
  const [ox, oy] = originOf(own), maps = {};
  for (const m of own.getFromPath('map')?.wzProperties() ?? []) { const v = val(m); if (Array.isArray(v)) maps[m.getName()] = v; }
  return { name, p, origin: [ox, oy], maps, layer: typeof str(own, 'z') === 'string' ? str(own, 'z') : name, ...(tones && { tones }) };
}
// Places pieces onto the points placed so far (and adds their own points). Returns [{ piece, x, y }] (top-left, game coordinates).
function place(list, points) {
  const out = [], left = [...list];
  for (let pass = 0; pass < 4 && left.length; pass++) for (let i = 0; i < left.length; i++) {
    const pc = left[i];
    const key = Object.keys(points).length ? [...POINT_ORDER, ...Object.keys(pc.maps)].find(k => pc.maps[k] && points[k]) : null;
    if (Object.keys(points).length && !key) continue;
    const at0 = key ? [points[key][0] - pc.maps[key][0], points[key][1] - pc.maps[key][1]] : [0, 0];
    for (const [k, v] of Object.entries(pc.maps)) points[k] ??= [at0[0] + v[0], at0[1] + v[1]];
    out.push({ pc, x: at0[0] - pc.origin[0], y: at0[1] - pc.origin[1] });
    left.splice(i--, 1);
  }
  return out;
}
const frameOf = (img, path) => follow(at(img, path), img);
const framesOf = (img, act) => { const a = at(img, act); return a ? [...a.wzProperties()].filter(f => /^\d+$/.test(f.getName())).length : 0; };

// ---- the body ----
const bodyImg = t => image('Character', `000020${String(t).padStart(2, '0')}.img`), headImg = t => image('Character', `000120${String(t).padStart(2, '0')}.img`);
// game -> app coordinates: the standing pose's navel is the catalogue's navel (17, 45)
const standPoints = {}; place([...pieces(frameOf(bodyImg(0), 'stand1/0'), bodyImg(0)), ...pieces(frameOf(headImg(0), 'stand1/0'), headImg(0))], standPoints);
const DX = 17 - standPoints.navel[0], DY = 45 - standPoints.navel[1];
const app = ([x, y]) => [x + DX, y + DY];
console.log('stand points (app):', Object.fromEntries(Object.entries(standPoints).map(([k, v]) => [k, app(v)])), '(catalogue: brow 17,14 navel 17,45 hand 29,51)');

const body = { actions: {} }, framePoints = {}; // framePoints[act][i]: the points every item is placed on (the same for every skin tone)
for (const act of ACTIONS) {
  const n = framesOf(bodyImg(0), act); body.actions[act] = []; framePoints[act] = [];
  for (let i = 0; i < n; i++) {
    const f0 = frameOf(bodyImg(0), `${act}/${i}`);
    const points = {}, parts = new Map();
    for (const tone of SKIN_TONES) {
      const pts = {};
      const placed = place([...pieces(frameOf(bodyImg(tone), `${act}/${i}`), bodyImg(tone)), ...pieces(frameOf(headImg(tone), `${act}/${i}`), headImg(tone))], pts);
      if (tone === 0) Object.assign(points, pts);
      for (const { pc, x, y } of placed) {
        const k = `${pc.name}|${x}|${y}`;
        if (!parts.has(k)) parts.set(k, { layer: pc.layer, x: x + DX, y: y + DY, z: zOf(pc.layer), ...(hiddenByOf(pc.layer) && { hiddenBy: hiddenByOf(pc.layer) }), files: {} });
        parts.get(k).files[tone] = save(pc.p);
      }
    }
    framePoints[act].push(points);
    body.actions[act].push({ delay: Number(str(f0, 'delay') ?? 250), face: str(f0, 'face') !== 0, points: Object.fromEntries(Object.entries(points).map(([k, v]) => [k, app(v)])), parts: [...parts.values()] });
  }
}
body.stand = Object.fromEntries(Object.entries(standPoints).map(([k, v]) => [k, app(v)]));
body.motions = MOTIONS;
writeFileSync('public/poses/body.json', JSON.stringify(body));

// ---- an item: its parts per action and frame, placed on the body's points ----
function itemPoses(img, actions, base = '') {
  const out = {};
  for (const act of actions) {
    const n = framePoints[act].length, frames = [];
    for (let i = 0; i < n; i++) {
      let f = frameOf(img, `${base}${act}/${i}`) ?? (base ? null : frameOf(img, `${act}/0`)); // an item with fewer frames keeps its first
      if (!f && !base && !img.getFromPath('stand1') && img.getFromPath('default')) f = frameOf(img, act === 'ladder' ? 'backDefault' : 'default') ?? frameOf(img, 'default'); // accessories: one picture
      if (!f) { frames.push(null); continue; }
      const pts = JSON.parse(JSON.stringify(framePoints[act][i]));
      frames.push(place(pieces(f, img), pts).filter(({ pc }) => Object.keys(pc.maps).length).map(({ pc, x, y }) => ({ f: save(pc.p), x: x + DX, y: y + DY, z: zOf(pc.layer), layer: pc.layer, ...(hiddenByOf(pc.layer) && { hiddenBy: hiddenByOf(pc.layer) }), ...(pc.tones && { tones: pc.tones }) })));
    }
    if (frames.some(Boolean)) out[act] = frames.map(f => f ?? []);
  }
  return out;
}

const missing = [];
const wearables = [...Object.entries(catalog.wearables).filter(([s]) => s !== 'nameTag' && s !== 'chatBalloon').flatMap(([, g]) => g.items), ...Object.values(catalog.base).flatMap(g => Object.values(g))];
let written = 0;
for (const it of wearables) {
  const cid = it.classicId ?? it.id, group = Math.floor(cid / 10000), folder = FOLDERS[group] ?? (group >= 130 && group < 180 ? 'Weapon' : null);
  const img = folder && image(`Character/${folder}`, `${String(cid).padStart(8, '0')}.img`);
  if (!img) { missing.push(`${it.name} (${cid})`); continue; }
  let out;
  if (folder === 'Weapon') {
    const classes = [...img.wzProperties()].map(c => c.getName()).filter(n => /^\d+$/.test(n));
    const cls = String(it.weaponClass ?? (classes.includes('30') ? 30 : classes[0]));
    out = { actions: itemPoses(img, ACTIONS, `${cls}/`) }; // only the actions its file has
  } else out = { actions: itemPoses(img, ACTIONS) };
  writeFileSync(`public/poses/w/${it.id}.json`, JSON.stringify(out)); written++;
}
let hairs = 0;
for (const st of catalog.hair) for (const v of st.variants) {
  if (v.live) continue;
  const img = image('Character/Hair', `${String(v.id).padStart(8, '0')}.img`);
  if (!img) { missing.push(`hair ${st.style} ${v.label} (${v.id})`); continue; }
  writeFileSync(`public/poses/hair/${v.id}.json`, JSON.stringify({ actions: itemPoses(img, ACTIONS) })); hairs++;
}
console.log(`body: ${ACTIONS.map(a => `${a} ${body.actions[a].length}`).join(', ')}; ${written} wearables, ${hairs} hair colours, ${picCount} pictures`);
if (missing.length) console.log(`not in the game files (${missing.length}), drawn standing-still-moved in the app:`, missing.slice(0, 40).join('; '), missing.length > 40 ? '...' : '');
