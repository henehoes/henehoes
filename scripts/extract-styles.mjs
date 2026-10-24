// Reads hair and face styles straight from the game's own files, with in-game ids and names, and puts them in the catalogue data: the
// pictures, offsets, layer names and covered-slot lists (Character/Hair, Character/Face) in the layout download.mjs uses, written to
// public/sprites/mcw/<kind>/<colour id>/ (meta.json, meta2.json, <part>.png, <part>.2.png), plus an entry per style in
// data/game-styles.json and data/items.json. add-styles.mjs appends data/game-styles.json (replacing a style with the same Classic id),
// so a rebuild of the styles keeps these.
//   WZ_DATA=".../maplestorycw/appdata/Data" node scripts/extract-styles.mjs hair 30010 32010
//   WZ_DATA=".../maplestorycw/appdata/Data" node scripts/extract-styles.mjs face 21036
// Arguments: the kind, then the style ids (a hair style id is its first colour, e.g. 30010; a face style id is its first colour, e.g.
// 21036). A style's other colours are found by id (hair: +1 to +7, face: +100 to +800). Gender comes from the id range (hair 30xxx male,
// 31xxx female, anything else both; face 20xxx male, 21xxx female). A style already in the data keeps its released / collab flags; a new
// one is not released. Needs the game files: see scripts/lib-wz.mjs.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { image, png, originOf, at, str, val } from './lib-wz.mjs';

const [kind, ...argIds] = process.argv.slice(2);
if (!['hair', 'face'].includes(kind) || !argIds.length) throw new Error('usage: extract-styles.mjs <hair|face> <style id> [...]');
const FOLDER = kind === 'hair' ? 'Hair' : 'Face', COLOURS = kind === 'hair' ? 8 : 9;
const colourId = (base, c) => kind === 'hair' ? base + c : base + c * 100;
const keyOf = base => kind === 'hair' ? Math.floor(base / 10) : base;
const read = f => JSON.parse(readFileSync(f, 'utf8'));
const strings = image('String', 'Eqp.img');
const nameOf = id => { const n = at(strings, `ClassicWorld/${FOLDER}/${id}`); return n ? str(n, 'name') : null; };
const genderOf = base => kind === 'hair' ? (base >= 30000 && base < 31000 ? 'male' : base >= 31000 && base < 32000 ? 'female' : 'both') : (base >= 20000 && base < 21000 ? 'male' : base >= 21000 && base < 22000 ? 'female' : 'both');
const pairs = s => (s ?? '').match(/.{1,2}/g) ?? [];

const items = read('data/items.json');
const gameStylesFile = existsSync('data/game-styles.json') ? read('data/game-styles.json') : { items: [] };
const out = [];
for (const base of argIds.map(Number)) {
  const colours = [];
  for (let c = 0; c < COLOURS; c++) {
    const id = colourId(base, c), img = image(`Character/${FOLDER}`, `${String(id).padStart(8, '0')}.img`);
    if (!img) { if (c === 0) throw new Error(`${kind} ${base} is not in the game files`); continue; }
    const dir = `public/sprites/mcw/${kind}/${id}`; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    const parts = [];
    for (const p of img.getFromPath('default').wzProperties()) { // hair, hairOverHead, hairBelowBody (the sub-property hairShade has no picture of its own); face
      const pic = p.getPropertyType() === 7 ? null : png(p); if (!pic) continue;
      const [ox, oy] = originOf(p), maps = {};
      for (const m of p.getFromPath('map')?.wzProperties() ?? []) { const v = val(m); if (Array.isArray(v)) maps[m.getName()] = { x: v[0], y: v[1], isEmpty: false }; }
      if (!maps.brow) maps.brow = { x: 0, y: 0, isEmpty: true };
      pic.saveToFile(`${dir}/${p.getName()}.png`); pic.saveToFile(`${dir}/${p.getName()}.2.png`); // hair and face are the same in the standing and two-handed poses
      parts.push({ key: p.getName(), w: pic.getWidth(), h: pic.getHeight(), origin: { x: ox, y: oy, isEmpty: false }, maps, position: str(p, 'z') ?? p.getName() });
    }
    if (!parts.length) throw new Error(`${kind} ${id} has no picture`);
    const info = img.getFromPath('info'), name = nameOf(id) ?? nameOf(base);
    writeFileSync(`${dir}/meta.json`, JSON.stringify({ id, name, version: '1', kind, equipGroup: FOLDER, vslots: pairs(str(info, 'vslot')), islots: pairs(str(info, 'islot')), parts }));
    writeFileSync(`${dir}/meta2.json`, JSON.stringify({ parts }));
    colours.push({ id, name, colour: c });
  }
  const old = items.styles.find(s => s.kind === kind && s.classicId === base);
  const entry = { style: colours[0].name, matchedAs: colours[0].name, kind, gender: old?.gender ?? genderOf(base), region: 'MCW', version: '1', key: keyOf(base), classicId: base, released: old?.released ?? false, ...(old?.collab && { collab: true }), colours };
  out.push(entry);
  if (old?.region && old.region !== 'MCW') { // the picture came from another region's data before: that folder is no longer used
    const key = old.colours.map(c => c.id); for (const id of key) rmSync(`public/sprites/${old.region.toLowerCase()}/${kind}/${id}`, { recursive: true, force: true });
  }
  console.log(`${kind} ${entry.style} (${base}, ${entry.gender}${old ? `, was ${old.region} ${old.colours[0].id}` : ', new'}): ${colours.length} colours, ${colours[0].id ? '' : ''}${out[out.length - 1].released ? 'released' : 'datamine'}`);
}
const same = e => s => s.kind === e.kind && s.classicId === e.classicId;
writeFileSync('data/game-styles.json', JSON.stringify({ _comment: 'Hair and face styles read from the game files by scripts/extract-styles.mjs (in-game ids and names). add-styles.mjs appends these to data/items.json, replacing a style with the same kind and Classic id.', items: [...gameStylesFile.items.filter(s => !out.some(e => same(e)(s))), ...out] }, null, 1));
items.styles = [...items.styles.filter(s => !out.some(e => same(e)(s))), ...out].sort((a, b) => a.kind.localeCompare(b.kind) || a.classicId - b.classicId);
writeFileSync('data/items.json', JSON.stringify(items, null, 2));
