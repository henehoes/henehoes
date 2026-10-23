// Replaces a slot's stored wearables with the ones in the game's own files, using the in-game ids and names: sprite folders are
// named by the item's Classic id, names come from String/Eqp.img, and the pictures, offsets, layer names, inventory icon and
// covered-slot lists come from Character/<Folder>/0<id>.img, written in the layout download.mjs uses (meta.json, meta2.json,
// <part>.png, <part>.2.png, icon.png) so build-catalog.mjs reads them unchanged.
//   WZ_DATA=".../maplestorycw/appdata/Data" node scripts/extract-wearables.mjs cap
// The slot's items are listed in data/game-wearables.json (the single source for that slot: build-manifest.mjs appends it and skips
// the same names in names.txt). Run once per slot; items already in the catalogue for the slot are re-read from the game, so
// to add an item of that slot, add its Classic id to the catalogue's data first (e.g. data/mcw-wearables.json) and run again.
// Needs the game files: see scripts/lib-wz.mjs. Slots: cap -> Character/Cap.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { image, png, originOf, at, str, val } from './lib-wz.mjs';

const SLOTS = { cap: { folder: 'Cap', group: 100, equip: 'Cap', sub: 'Hat', strings: 'Cap' } };
const slot = process.argv[2], S = SLOTS[slot];
if (!S) throw new Error(`usage: extract-wearables.mjs <${Object.keys(SLOTS).join('|')}>`);
const read = f => JSON.parse(readFileSync(f, 'utf8')), write = (f, o) => writeFileSync(f, JSON.stringify(o, null, 1));
const norm = n => n.toLowerCase().replace(/ (hair|face)$/, '').replace(/[^a-z0-9]/g, '');
const inGroup = id => Math.floor(id / 10000) === S.group;
const eqp = image('String', 'Eqp.img');
// The game's own string for Lügner's items has a damaged character (U+FFFD where the u-umlaut should be); it is put back as "ü".
const gameName = id => str(at(eqp, `ClassicWorld/${S.strings}/${id}`), 'name')?.replace(/\uFFFD/g, 'ü');

// Which items: everything of this slot in the catalogue's data (the old GMS-id entries and the Classic-id ones), by Classic id.
const shop = new Map(); for (const i of read('data/henesys-cashshop.json').items) { const k = norm(i.name); shop.set(k, [...(shop.get(k) ?? []), i.id]); }
const classicOf = w => w.classicId ?? (() => { const ids = shop.get(norm(w.name)); return ids && (ids.find(i => Math.floor(i / 10000) === S.group) ?? ids[0]); })();
const sources = ['data/items.json', 'data/mcw-wearables.json', 'data/collab-wearables.json'];
const old = [read('data/items.json').wearables, read('data/mcw-wearables.json').items, read('data/collab-wearables.json').items].flat().filter(w => inGroup(w.id));
const collab = new Set(read('data/collab-wearables.json').items.filter(w => inGroup(w.id)).map(w => classicOf(w)));
const wanted = new Map(); const problems = [];
for (const w of old) { const cid = classicOf(w); if (!cid) problems.push(`${w.name}: no Classic id`); else wanted.set(cid, w); }

// The picture node behind a part: follows _inlink (same image), a UOL link, or _outlink (handled by png()).
function resolve(node, img) {
  const inl = node.getFromPath?.('_inlink')?.getString?.();
  if (inl) { const t = at(img, inl); if (t) return t; }
  if (node.getPropertyType() === 13 && !node.getFromPath?.('_outlink')) { try { return node.getLinkValue?.() ?? node; } catch {} }
  return node;
}
function frame(img, anim, dir, suffix) {
  const f0 = at(img, `${anim}/0`); if (!f0) return null;
  const parts = [];
  for (const c of f0.wzProperties()) {
    const node = resolve(c, img), p = png(node) ?? png(c); if (!p) continue;
    const own = c.getFromPath('origin') ? c : node; // origin, layer and anchors belong to the part node itself
    const [ox, oy] = originOf(own), maps = {};
    for (const m of own.getFromPath('map')?.wzProperties() ?? []) { const v = val(m); if (Array.isArray(v)) maps[m.getName()] = { x: v[0], y: v[1], isEmpty: false }; }
    p.saveToFile(`${dir}/${c.getName()}${suffix}.png`);
    parts.push({ key: c.getName(), w: p.getWidth(), h: p.getHeight(), origin: { x: ox, y: oy, isEmpty: false }, maps, position: str(own, 'z') ?? c.getName() });
  }
  return parts;
}
const pairs = s => (s ?? '').match(/.{1,2}/g) ?? [];

const out = []; const dropFolders = new Set();
for (const [cid, w] of [...wanted].sort((a, b) => a[0] - b[0])) {
  const img = image(`Character/${S.folder}`, `${String(cid).padStart(8, '0')}.img`);
  const name = gameName(cid);
  if (!img || !name) { problems.push(`${w.name} (${cid}): ${!img ? 'not in the game files' : 'no in-game name'}`); continue; }
  const dir = `public/sprites/wearable/${cid}`; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const info = img.getFromPath('info');
  const parts = frame(img, 'stand1', dir, ''), parts2 = frame(img, 'stand2', dir, '.2') ?? [];
  if (!parts?.length) { problems.push(`${name} (${cid}): no stand1 picture`); continue; }
  const icon = png(info?.getFromPath('icon')); if (icon) icon.saveToFile(`${dir}/icon.png`);
  write(`${dir}/meta.json`, { id: cid, name, source: 'game files', kind: 'wearable', equipGroup: S.equip, vslots: pairs(str(info, 'vslot')), islots: pairs(str(info, 'islot')), parts });
  write(`${dir}/meta2.json`, { parts: parts2 });
  out.push({ id: cid, name, region: 'MCW', version: '1', category: 'Armor', subCategory: S.sub, ambiguous: false, classicId: cid, ...(collab.has(cid) && { collab: 'Frieren' }) });
  if (w.id !== cid) dropFolders.add(w.id);
  console.log(`${name} (${cid}${w.id !== cid ? `, was sprite ${w.id}` : ''}${w.name !== name ? `, was "${w.name}"` : ''}): ${parts.length} part(s) stand1, ${parts2.length} stand2`);
}
// the old GMS-id folders go, and the data moves to the slot's own file
for (const id of dropFolders) rmSync(`public/sprites/wearable/${id}`, { recursive: true, force: true });
write('data/game-wearables.json', { _comment: `Wearables read from the game files by scripts/extract-wearables.mjs (slot: ${slot}), with in-game ids and names. build-manifest.mjs appends these to data/items.json and skips the same names in names.txt.`, items: [...(existsSync('data/game-wearables.json') ? read('data/game-wearables.json').items.filter(i => !inGroup(i.id)) : []), ...out] });
const items = read('data/items.json'); items.wearables = [...items.wearables.filter(w => !inGroup(w.id)), ...out]; write('data/items.json', items);
for (const f of ['data/mcw-wearables.json', 'data/collab-wearables.json']) { const j = read(f); j.items = j.items.filter(i => !inGroup(i.id)); write(f, j); }
console.log(`${out.length} ${slot} items written; removed ${dropFolders.size} old folders`, problems.length ? `\nPROBLEMS:\n${problems.join('\n')}` : '');
