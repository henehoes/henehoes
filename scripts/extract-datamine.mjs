// Draws every cash item of the named sections that is in the game files but not in the catalogue yet, for each tab's All · Datamine view.
// Writes each one to public/sprites/datamine/<section>/<Classic id>/ (the layout extract-wearables.mjs uses) and the section's list to
// data/datamine/<section>.json. build-catalog.mjs adds them to their tab's list with `released: false`.
//   WZ_DATA=".../maplestorycw/appdata/Data" node scripts/extract-datamine.mjs [section ...]   (no section: all of them)
// Needs the game files: see scripts/lib-wz.mjs. Run build-catalog.mjs first if the catalogue changed, and extract-poses.mjs after.
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { openWz, image, at, str, val, DATA } from './lib-wz.mjs';
import { drawItem } from './lib-draw.mjs';

// section -> the game folder its items are in and the first three digits of their ids (an item id is 7 digits: 100xxxx is a hat)
export const SECTIONS = {
  cap: ['Cap', 100], faceAcc: ['Accessory', 101], eyeAcc: ['Accessory', 102], earrings: ['Accessory', 103], coat: ['Coat', 104],
  longcoat: ['Longcoat', 105], pants: ['Pants', 106], shoes: ['Shoes', 107], glove: ['Glove', 108], cape: ['Cape', 110], weapon: ['Weapon', 170],
};
const read = f => JSON.parse(readFileSync(f, 'utf8'));
const catalogue = read('public/catalog.json');
const eqp = image('String', 'Eqp.img');

for (const section of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SECTIONS)) {
  const [folder, group] = SECTIONS[section] ?? []; if (!folder) throw new Error(`Unknown section ${section}: one of ${Object.keys(SECTIONS).join(', ')}`);
  const listFile = `data/datamine/${section}.json`;
  const before = existsSync(listFile) ? new Set(read(listFile).items.map(i => i.id)) : new Set(); // the last run's own items
  const have = new Set(Object.values(catalogue.wearables).flatMap(s => s.items.filter(i => !before.has(i.classicId ?? i.id)).flatMap(i => [i.id, i.classicId])));
  const ids = [];
  for (const wz of readdirSync(`${DATA}/Character/${folder}`).filter(n => /_\d{3}\.wz$/.test(n)))
    for (const img of openWz(`Character/${folder}/${wz}`).getWzDirectory().wzImages()) {
      const id = parseInt(img.getName()), cash = img.getFromPath('info/cash');
      if (Math.floor(id / 10000) === group && cash && val(cash) == 1 && !have.has(id)) ids.push(id); // cash items only: the app is about the cash shop
    }
  const out = [], problems = [], dir = `public/sprites/datamine/${section}`;
  rmSync(dir, { recursive: true, force: true });
  for (const id of ids.sort((a, b) => a - b)) {
    const name = str(at(eqp, `ClassicWorld/${folder}/${id}`), 'name');
    const r = drawItem({ id, name, folder }, `${dir}/${id}`);
    if (r.problem) { problems.push(`${name ?? id} (${id}): ${r.problem}`); continue; }
    out.push({ id, name, ...(r.weaponClass && { weaponClass: r.weaponClass }), ...(r.stand2Only && { stand2Only: true }) });
  }
  mkdirSync('data/datamine', { recursive: true });
  writeFileSync(listFile, JSON.stringify({ _comment: `Cash ${section} items in the game files that are not in the catalogue (not released). Written by scripts/extract-datamine.mjs.`, items: out }, null, 1));
  console.log(`${section}: ${out.length} written of ${ids.length}`, problems.length ? `\n  not drawn (${problems.length}): ${problems.join('; ')}` : '');
}
