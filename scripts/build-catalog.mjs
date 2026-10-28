// Turns downloaded sprites into public/catalog.json, the only file the web app reads.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';

// Attachment points in skin-PNG pixels, calibrated against API renders (see calibrate-anchors.mjs).
const ANCHORS = { brow: [17, 14], navel: [17, 45], hand: [29, 51] };
// The two-handed pose (stand2): the same points computed from its skin parts (anchor = part position + origin + map offset).
const ANCHORS2 = { brow: [17, 14], navel: [17, 45], hand: [22, 45] };
const ANCHOR_PRIORITY = ['brow', 'hand', 'navel'];

const SLOTS = [
  [100, 'cap', 'Hat'], [101, 'faceAcc', 'Face accessory'], [102, 'eyeAcc', 'Eye decoration'], [103, 'earrings', 'Earrings'],
  [104, 'coat', 'Top'], [105, 'longcoat', 'Overall'], [106, 'pants', 'Bottom'], [107, 'shoes', 'Shoes'],
  [108, 'glove', 'Gloves'], [110, 'cape', 'Cape'], [137, 'weapon', 'Weapon'], [170, 'weapon', 'Weapon'],
];
const COLOUR_NAMES = {
  hair: ['Black', 'Red', 'Orange', 'Blonde', 'Green', 'Blue', 'Purple', 'Brown'],
  face: ['Black', 'Blue', 'Red', 'Green', 'Hazel', 'Sapphire', 'Violet', 'Amethyst', 'White'],
};
const slotOf = id => { const g = Math.floor(id / 10000); return SLOTS.find(([n]) => n === g) ?? (g >= 130 && g < 180 ? [g, 'weapon', 'Weapon'] : null); };

const read = p => JSON.parse(readFileSync(p, 'utf8'));
const zmap = read('data/zmap.json');
const rules = read('data/rules.json');
// henesys.gg is the single source for Classic names and ids (data/henesys-salon.json, data/henesys-cashshop.json, fetched by
// scripts/fetch-henesys.mjs). Sprite ids come from the sprite API; the Classic id is stored beside them as classicId.
const cashShop = read('data/henesys-cashshop.json').items;
const norm = n => n.toLowerCase().replace(/ (hair|face)$/, '').replace(/[^a-z0-9]/g, '');
const shopIds = new Map(); for (const i of cashShop) { const k = norm(i.name); if (!shopIds.has(k)) shopIds.set(k, []); shopIds.get(k).push(i.id); }
const warnings = { unknownAnchor: [], noParts: [], unknownSlot: [], unknownLayer: [] };
const zOf = layer => {
  const i = zmap.indexOf(rules.zFallback[layer] ?? layer);
  if (i === -1) warnings.unknownLayer.push(layer);
  return i === -1 ? 74.6 : i;
};

function partsOf(meta, dir, priority = ANCHOR_PRIORITY, pose2 = false) {
  const out = [], anchors = pose2 ? ANCHORS2 : ANCHORS;
  for (const p of meta.parts) {
    const map = priority.find(m => p.maps?.[m]);
    if (!map) { warnings.unknownAnchor.push(`${meta.name}:${p.key}:${Object.keys(p.maps ?? {})}`); continue; }
    const v = p.maps[map];
    out.push({
      file: `${dir}/${p.key}${pose2 ? '.2' : ''}.png`, layer: p.position,
      x: anchors[map][0] - p.origin.x - v.x, y: anchors[map][1] - p.origin.y - v.y,
      z: zOf(p.position), ...(rules.partHiddenBy[p.position] && { hiddenBy: rules.partHiddenBy[p.position] }),
    });
  }
  return out;
}

// The two-handed pose of an item, if it was downloaded; otherwise the app falls back to the standing pose.
const parts2Of = (dir, name) => existsSync(`public/${dir}/meta2.json`) ? partsOf({ ...read(`public/${dir}/meta2.json`), name }, dir, ANCHOR_PRIORITY, true) : undefined;

const { wearables, styles } = read('data/items.json');
const report = read('data/report.json');

// Items that could not be drawn. Shown in the app as flagged placeholders so they get fixed by hand.
const placeholders = { wearables: {}, hair: [], face: [] };
const slotLabel = key => SLOTS.find(([, k]) => k === key)[2];
const addWearablePlaceholder = (slotKey, name, reason) => {
  const list = (placeholders.wearables[slotKey] ??= []);
  if (!list.some(p => p.name === name)) list.push({ name, reason });
};
for (const p of read('data/placeholders.json').wearables) addWearablePlaceholder(p.slot, p.name, p.reason);
// Skin parts are placed by where they sit in the API's skin render (scripts/place-skins.mjs).
const skins = read('data/skins.json').map(s => ({
  tone: s.tone,
  parts: s.parts.map(p => ({ file: `sprites/skin/${s.tone}/${p.key}.png`, layer: p.position, x: p.pos.x, y: p.pos.y, z: zOf(p.position) })),
}));
// Skin parts for the two-handed pose. The ear is not visible in the API's render, so it is left out.
const skins2 = existsSync('data/skins2.json') ? read('data/skins2.json') : [];
for (const s of skins) {
  const s2 = skins2.find(x => x.tone === s.tone);
  if (s2) s.parts2 = s2.parts.filter(p => p.key !== 'ear').map(p => ({ file: `sprites/skin2/${s.tone}/${p.key}.png`, layer: p.position, x: p.pos.x, y: p.pos.y, z: zOf(p.position) }));
}
const catalog = { skins, face: [], hair: [], wearables: {} };

// The Classic id of a wearable: the henesys.gg cash shop id for its name. Where the name appears more than once, the id nearest
// the sprite's own id in the same equipment group is used. Items henesys.gg does not list get none.
const classicIdOf = w => {
  const ids = shopIds.get(norm(w.name)); if (!ids) return null;
  const group = Math.floor(w.id / 10000);
  return ids.find(i => Math.floor(i / 10000) === group) ?? ids[0];
};
for (const w of wearables) {
  const dir = `sprites/wearable/${w.id}`;
  const slot = slotOf(w.id);
  if (!slot) { warnings.unknownSlot.push(`${w.name}:${w.id}`); continue; }
  if (!existsSync(`public/${dir}/meta.json`)) { addWearablePlaceholder(slot[1], w.name, `Found (id ${w.id}) but the API returned no item data`); continue; }
  const meta = read(`public/${dir}/meta.json`);
  const parts = partsOf(meta, dir);
  if (!parts.length) { warnings.noParts.push(`${w.name} (${slot[2]})`); addWearablePlaceholder(slot[1], w.name, `Found (id ${w.id}) but it has no sprite in the standing pose`); continue; }
  (catalog.wearables[slot[1]] ??= { label: slot[2], items: [] }).items.push({ id: w.id, name: w.name, ...(w.collab && { collab: w.collab }), ...(rules.holds?.includes(w.id) && { holds: true }), ...(w.assumed && { check: w.assumed }), vslots: meta.vslots ?? [], ...(existsSync(`public/${dir}/icon.png`) && { icon: `${dir}/icon.png` }), ...(rules.stand2Only?.includes(w.id) && { pose: 'stand2' }), ...((w.classicId ?? classicIdOf(w)) && { classicId: w.classicId ?? classicIdOf(w) }), parts, ...(parts2Of(dir, w.name) && { parts2: parts2Of(dir, w.name) }) });
}

// Name tag and chat bubble rings draw no avatar sprite: each is a finished sample picture shown under the feet or over the head (data/rings.json).
const RING_LABELS = { nameTag: 'Name Ring', chatBalloon: 'Chat Ring' };
for (const r of read('data/rings.json').rings) {
  // each ring is its own finished sample picture (scripts/extract-rings.mjs)
  if (!existsSync(`public/${r.file}`)) { addWearablePlaceholder(r.kind, r.name, `Classic id ${r.classicId}: its sample picture is missing (run scripts/extract-rings.mjs)`); continue; }
  if (r.tag && !existsSync(`public/${r.tag.dir}/w.png`)) { addWearablePlaceholder(r.kind, r.name, `Classic id ${r.classicId}: its tag pieces are missing (run scripts/extract-rings.mjs)`); continue; }
  // chat bubbles: the sample picture as it is; name tags: pieces (or a plain box) with the name drawn in, the sample is only the fallback
  const effect = { kind: r.kind, file: r.file, w: r.w, h: r.h, ...(r.text && { text: r.text }), ...(r.tag && { tag: r.tag }), ...(r.plain && { plain: r.plain }) };
  (catalog.wearables[r.kind] ??= { label: RING_LABELS[r.kind], items: [] }).items.push({ id: r.classicId, name: r.name, vslots: [], parts: [], effect, ...(r.released === false && { released: false }), ...(r.check && { check: r.check }) });
}

const spriteDirOf = (s, id) => s.region && s.region !== 'GMS' ? `sprites/${s.region.toLowerCase()}/${s.kind}/${id}` : `sprites/${s.kind}/${id}`;
for (const s of styles) {
  if (rules.exclude?.some(x => x.kind === s.kind && x.gender === s.gender && x.style === s.style)) continue;
  const variants = [];
  for (const c of s.colours) {
    const dir = spriteDirOf(s, c.id);
    // The API names colour variants inconsistently (sometimes all the same), so use the game's standard colour order.
    const label = COLOUR_NAMES[s.kind][c.colour] ?? `Colour ${c.colour + 1}`;
    if (!existsSync(`public/${dir}/meta.json`)) continue; // no sprite data anywhere (see data/download-failed.json): that colour is left out
    const parts = partsOf(read(`public/${dir}/meta.json`), dir);
    if (parts.length) variants.push({ id: c.id, colour: c.colour, label, parts, ...(parts2Of(dir, label) && { parts2: parts2Of(dir, label) }) });
  }
  if (variants.length) catalog[s.kind].push({ style: s.style, gender: s.gender, key: s.key, ...(s.classicId && { classicId: s.classicId }), released: s.released !== false, ...(s.collab && { collab: 'Frieren' }), ...(s.note && { check: s.note }), variants });
}

for (const u of report.styleUnresolved) placeholders[u.kind].push({ name: u.style, gender: u.gender, reason: 'Name not found in the item database' });
for (const a of report.assumedMatches) warnings.assumed = [...(warnings.assumed ?? []), `${a.pasted} -> ${a.matchedAs}`];
for (const [slotKey, list] of Object.entries(placeholders.wearables)) {
  catalog.wearables[slotKey] ??= { label: slotLabel(slotKey), items: [] };
  catalog.wearables[slotKey].placeholders = list;
}
// Styles on henesys.gg that have no sprite we can draw (scripts/add-datamine.mjs): shown only under the Datamine switch.
for (const p of read('data/datamine-placeholders.json').items) placeholders[p.kind].push({ name: p.style, gender: p.gender, classicId: p.classicId, released: false, reason: p.reason });
catalog.placeholders = { hair: placeholders.hair, face: placeholders.face };

// Every list is shown lowest id first. Hair and face follow the Classic ids on henesys.gg (matched by name); styles it does not
// list (such as female hair) use their own sprite id, on the same scale.
const byId = (a, b) => a - b;
const orderOf = (kind, s) => s.classicId ?? (kind === 'hair' ? s.key * 10 : s.key);
catalog.skins.sort((a, b) => byId(a.tone, b.tone));
for (const kind of ['face', 'hair']) catalog[kind].sort((a, b) => byId(orderOf(kind, a), orderOf(kind, b)) || byId(a.key, b.key));
// Dyeing: the game marks the items it lets you dye (data/game-dye.json, scripts/extract-dyeable.mjs). A catalogue item the game has and
// does not mark gets `dyeable: false` (no colour sliders in the app); an item the game files do not list is left alone.
const gameDye = read('data/game-dye.json'), knownIds = new Set(gameDye.known), dyeIds = new Set(gameDye.dyeable);
warnings.dyeUnknown = [];
for (const [slotKey, slot] of Object.entries(catalog.wearables)) for (const it of slot.items) {
  if (it.effect) continue; // rings have no colour settings at all
  const cid = it.classicId ?? it.id;
  if (!knownIds.has(cid)) warnings.dyeUnknown.push(`${it.name} (${slotKey} ${cid})`);
  else if (!dyeIds.has(cid)) it.dyeable = false;
}
// Possible upcoming items (data/upcoming.json, scripts/extract-upcoming.mjs): dyeable in the game files, not in the catalogue. They join
// their slot's list flagged `upcoming: true`; the app lists them only in the Upcoming tab. An item the file marks `released: true` (it has come out)
// joins its slot's list as an ordinary released item. UNCONFIRMED: dyeable is only a hint.
for (const u of read('data/upcoming.json').items) {
  const dir = `sprites/upcoming/${u.id}`, slot = slotOf(u.id);
  if (!slot) { warnings.unknownSlot.push(`${u.name}:${u.id}`); continue; }
  const meta = read(`public/${dir}/meta.json`), parts = partsOf(meta, dir);
  if (!parts.length) { warnings.noParts.push(`${u.name} (upcoming ${slot[2]})`); continue; }
  const p2 = parts2Of(dir, u.name);
  (catalog.wearables[slot[1]] ??= { label: slot[2], items: [] }).items.push({ id: u.id, name: u.name, classicId: u.id, ...(!u.released && { upcoming: true }), vslots: meta.vslots ?? [], ...(existsSync(`public/${dir}/icon.png`) && { icon: `${dir}/icon.png` }), ...(u.weaponClass && { weaponClass: u.weaponClass }), parts, ...(p2 && { parts2: p2 }) });
}
// Which weapon types a cash weapon goes over, from the game's own descriptions (data/weapon-types.json, scripts/extract-weapon-types.mjs).
const weaponTypes = read('data/weapon-types.json').types;
for (const it of catalog.wearables.weapon?.items ?? []) { const t = weaponTypes[it.classicId ?? it.id]; if (t) it.worksWith = t; else warnings.noWeaponTypes = [...(warnings.noWeaponTypes ?? []), it.name]; }
// rules.baseBody: the starter undergarments are part of the body (drawn by gender unless a top, bottom or overall replaces them), so they
// leave the Top and Bottom lists and go to catalog.base[gender][slot].
catalog.base = {};
for (const [g, slots] of Object.entries(rules.baseBody ?? {})) for (const [slot, id] of Object.entries(slots)) {
  const list = catalog.wearables[slot].items, i = list.findIndex(x => x.id === id);
  if (i < 0) throw new Error(`baseBody: ${g} ${slot} ${id} is not in the catalogue`);
  (catalog.base[g] ??= {})[slot] = list.splice(i, 1)[0];
}
// rules.listFirst: ids shown at the top of their tab, in that order; everything else follows by sprite id.
const firstRank = id => { const i = (rules.listFirst ?? []).indexOf(id); return i === -1 ? Infinity : i; };
for (const slot of Object.values(catalog.wearables)) slot.items.sort((a, b) => firstRank(a.id) - firstRank(b.id) || byId(a.id, b.id));

writeFileSync('public/catalog.json', JSON.stringify(catalog));
console.log('placeholders:', JSON.stringify(Object.fromEntries(Object.entries(placeholders.wearables).map(([k, v]) => [k, v.map(p => p.name)]))), 'hair', placeholders.hair.map(p => p.name), 'face', placeholders.face.map(p => p.name));
console.log(`skins ${catalog.skins.length}, faces ${catalog.face.length}, hairs ${catalog.hair.length}, wearable slots`, Object.fromEntries(Object.entries(catalog.wearables).map(([k, v]) => [k, v.items.length])));
console.log(JSON.stringify(warnings, null, 1));
