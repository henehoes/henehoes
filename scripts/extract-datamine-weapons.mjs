// Draws every cash weapon in the game files (Classic ids 1700000 to 1709999) that is not in the catalogue yet, for the Weapon tab's
// All · Datamine view. Writes each one to public/sprites/datamine-weapons/<Classic id>/ (the layout extract-wearables.mjs uses) and the
// list to data/datamine-weapons.json. build-catalog.mjs adds them to the Weapon list with `released: false`.
//   WZ_DATA=".../maplestorycw/appdata/Data" node scripts/extract-datamine-weapons.mjs
// Needs the game files: see scripts/lib-wz.mjs. Run build-catalog.mjs first if the catalogue changed, and extract-poses.mjs after.
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { openWz, image, at, str, DATA } from './lib-wz.mjs';
import { drawItem } from './lib-draw.mjs';

const read = f => JSON.parse(readFileSync(f, 'utf8'));
const catalogue = read('public/catalog.json');
const before = existsSync('data/datamine-weapons.json') ? new Set(read('data/datamine-weapons.json').items.map(i => i.id)) : new Set(); // the last run's own items
const have = new Set(Object.values(catalogue.wearables).flatMap(s => s.items.filter(i => !before.has(i.classicId ?? i.id)).flatMap(i => [i.id, i.classicId])));
const eqp = image('String', 'Eqp.img');

const ids = [];
for (const wz of readdirSync(`${DATA}/Character/Weapon`).filter(n => /_\d{3}\.wz$/.test(n)))
  for (const img of openWz(`Character/Weapon/${wz}`).getWzDirectory().wzImages()) { const id = parseInt(img.getName()); if (id >= 1700000 && id < 1710000 && !have.has(id)) ids.push(id); }

const out = [], problems = [];
rmSync('public/sprites/datamine-weapons', { recursive: true, force: true });
for (const id of ids.sort((a, b) => a - b)) {
  const name = str(at(eqp, `ClassicWorld/Weapon/${id}`), 'name');
  const r = drawItem({ id, name, folder: 'Weapon' }, `public/sprites/datamine-weapons/${id}`);
  if (r.problem) { problems.push(`${name ?? id} (${id}): ${r.problem}`); continue; }
  out.push({ id, name, ...(r.weaponClass && { weaponClass: r.weaponClass }), ...(r.stand2Only && { stand2Only: true }) });
}
writeFileSync('data/datamine-weapons.json', JSON.stringify({ _comment: 'Cash weapons in the game files that are not in the catalogue (not released). Written by scripts/extract-datamine-weapons.mjs.', items: out }, null, 1));
console.log(`${out.length} datamine weapons written of ${ids.length}`, problems.length ? `\nPROBLEMS (${problems.length}):\n${problems.join('\n')}` : '');
