// Draws one wearable from the game files into public/sprites/<group>/<Classic id>/ (pictures, meta.json, meta2.json, icon.png): the layout
// extract-wearables.mjs uses, so build-catalog.mjs reads it with the same code. Used by extract-upcoming.mjs and extract-datamine-weapons.mjs.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { image, png, originOf, at, str, val } from './lib-wz.mjs';

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
// A weapon with no one-handed stance at all (guitars, some crossbows: like the Toy Rifle) is drawn from the first class with a stand2.
export const weaponClass = img => {
  const all = [...img.wzProperties()].map(c => c.getName()).filter(n => /^\d+$/.test(n)), classes = all.filter(n => at(img, `${n}/stand1/0`));
  return classes.includes('30') ? '30' : classes[0] ?? all.find(n => at(img, `${n}/stand2/0`)) ?? null;
};
const pairs = s => (s ?? '').match(/.{1,2}/g) ?? [];

// Draws `it` ({ id, name, folder }) into `dir`. Returns { weaponClass, stand2Only } (a weapon's class, else null; true when it only has
// the two-handed stance), or { problem }: why it could not be drawn.
export function drawItem(it, dir) {
  const img = image(`Character/${it.folder}`, `${String(it.id).padStart(8, '0')}.img`);
  if (!img || !it.name) return { problem: !img ? 'not in the game files' : 'no in-game name' };
  mkdirSync(dir, { recursive: true });
  const info = img.getFromPath('info');
  let base = '', cls = null;
  if (it.folder === 'Weapon') { cls = weaponClass(img); base = cls ? `${cls}/` : ''; }
  let parts = frame(img, base, 'stand1', dir, ''); const parts2 = frame(img, base, 'stand2', dir, '.2') ?? [];
  // no stand1 but a stand2: the item only has the two-handed stance, so that picture is its standing one too (`stand2Only`)
  const stand2Only = !parts && parts2.length > 0;
  if (stand2Only) parts = frame(img, base, 'stand2', dir, '');
  // a face accessory (and an earring) has no animations: one picture in default/default
  if (!parts && it.folder === 'Accessory' && at(img, 'default/default')) parts = partsOf(img, at(img, 'default'), dir, '');
  if (!parts?.length) { rmSync(dir, { recursive: true, force: true }); return { problem: 'no stand1 picture' }; }
  // a few items (Glowing Pumpkin Basket, Evil Skull, Cat Soul) have only iconRaw, no icon
  const icon = png(info?.getFromPath('icon')) ?? png(info?.getFromPath('iconRaw')); if (icon) icon.saveToFile(`${dir}/icon.png`);
  writeFileSync(`${dir}/meta.json`, JSON.stringify({ id: it.id, name: it.name, source: 'game files', kind: 'wearable', vslots: pairs(str(info, 'vslot')), islots: pairs(str(info, 'islot')), parts }, null, 1));
  writeFileSync(`${dir}/meta2.json`, JSON.stringify({ parts: parts2 }, null, 1));
  return { weaponClass: cls && Number(cls), ...(stand2Only && { stand2Only }) };
}
