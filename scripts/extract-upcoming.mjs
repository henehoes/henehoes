// Draws the "possible upcoming" items: equipment the game files mark as dyeable (data/game-dye.json, scripts/extract-dyeable.mjs)
// that is not in the catalogue. Writes each one's pictures, offsets, layer names, icon and covered-slot lists to
// public/sprites/upcoming/<Classic id>/ (the layout extract-wearables.mjs uses, so build-catalog.mjs reads them with the same code)
// and the list to data/upcoming.json. Nothing here is confirmed: dyeable is only a hint (see AGENTS.md).
//   WZ_DATA=".../maplestorycw/appdata/Data" node scripts/extract-upcoming.mjs
// Needs the game files: see scripts/lib-wz.mjs. "In the catalogue" means a catalogue item's Classic id (or sprite id) is the same.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { image, png, originOf, at, str, val } from './lib-wz.mjs';

const read = f => JSON.parse(readFileSync(f, 'utf8'));
const dye = read('data/game-dye.json');
const catalogue = read('public/catalog.json');
const before = existsSync('data/upcoming.json') ? read('data/upcoming.json').items : []; // the last run: its items (released or not) are not "already in the catalogue"
const mine = new Set(before.map(i => i.id)), releasedBefore = new Set(before.filter(i => i.released).map(i => i.id));
const have = new Set(Object.values(catalogue.wearables).flatMap(s => s.items.filter(i => !mine.has(i.classicId ?? i.id)).flatMap(i => [i.id, i.classicId])));
const skip = new Set(read('data/rules.json').upcomingExclude ?? []); // left out on purpose (data/rules.json)
const todo = dye.items.filter(i => !have.has(i.id) && !skip.has(i.id));

// The picture node behind a part: follows _inlink (same image), a UOL link, or _outlink (handled by png()).
function resolve(node, img) {
  const inl = node.getFromPath?.('_inlink')?.getString?.();
  if (inl) { const t = at(img, inl); if (t) return t; }
  if (node.getPropertyType() === 13 && !node.getFromPath?.('_outlink')) { try { return node.getLinkValue?.() ?? node; } catch {} }
  return node;
}
// The parts of one frame node: `f0` is the node whose children are the parts.
function partsOf(img, f0, dir, suffix) {
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
// `base` is where the animations live: the item itself, or for a weapon one weapon class (the client stores a weapon's art per class).
function frame(img, base, anim, dir, suffix) {
  const f0 = at(img, `${base}${anim}/0`);
  return f0 ? partsOf(img, f0, dir, suffix) : null;
}
// A weapon is drawn from the first weapon class it has a standing pose for, preferring 30 (one-handed sword), the pose the app starts in.
const weaponClass = img => {
  const classes = [...img.wzProperties()].map(c => c.getName()).filter(n => /^\d+$/.test(n) && at(img, `${n}/stand1/0`));
  return classes.includes('30') ? '30' : classes[0] ?? null;
};
const pairs = s => (s ?? '').match(/.{1,2}/g) ?? [];

const out = [], problems = [];
rmSync('public/sprites/upcoming', { recursive: true, force: true });
for (const it of todo) {
  const img = image(`Character/${it.folder}`, `${String(it.id).padStart(8, '0')}.img`);
  if (!img || !it.name) { problems.push(`${it.name ?? it.id}: ${!img ? 'not in the game files' : 'no in-game name'}`); continue; }
  const dir = `public/sprites/upcoming/${it.id}`; mkdirSync(dir, { recursive: true });
  const info = img.getFromPath('info');
  let base = '', cls = null;
  if (it.folder === 'Weapon') { cls = weaponClass(img); base = cls ? `${cls}/` : ''; }
  let parts = frame(img, base, 'stand1', dir, ''); const parts2 = frame(img, base, 'stand2', dir, '.2') ?? [];
  // a face accessory (and an earring) has no animations: one picture in default/default
  if (!parts && it.folder === 'Accessory' && at(img, 'default/default')) parts = partsOf(img, at(img, 'default'), dir, '');
  if (!parts?.length) { problems.push(`${it.name} (${it.id}): no stand1 picture`); rmSync(dir, { recursive: true, force: true }); continue; }
  // a few items (Glowing Pumpkin Basket, Evil Skull, Cat Soul) have only iconRaw, no icon
  const icon = png(info?.getFromPath('icon')) ?? png(info?.getFromPath('iconRaw')); if (icon) icon.saveToFile(`${dir}/icon.png`);
  writeFileSync(`${dir}/meta.json`, JSON.stringify({ id: it.id, name: it.name, source: 'game files', kind: 'wearable', vslots: pairs(str(info, 'vslot')), islots: pairs(str(info, 'islot')), parts }, null, 1));
  writeFileSync(`${dir}/meta2.json`, JSON.stringify({ parts: parts2 }, null, 1));
  out.push({ id: it.id, name: it.name, folder: it.folder, ...(releasedBefore.has(it.id) && { released: true }), ...(cls && { weaponClass: Number(cls) }) });
}
writeFileSync('data/upcoming.json', JSON.stringify({ _comment: 'Dyeable equipment in the game files that is not in the catalogue (the possible-upcoming list). UNCONFIRMED: dyeable may hint at items for an upcoming release, nothing more. `released: true` marks items that have since come out: build-catalog.mjs lists them as ordinary released items. Written by scripts/extract-upcoming.mjs, which keeps the `released` flags.', items: out }, null, 1));
console.log(`${out.length} upcoming items written of ${todo.length}`, problems.length ? `\nPROBLEMS:\n${problems.join('\n')}` : '');
