// Draws the "possible upcoming" items: equipment the game files mark as dyeable (data/game-dye.json, scripts/extract-dyeable.mjs)
// that is not in the catalogue. Writes each one's pictures, offsets, layer names, icon and covered-slot lists to
// public/sprites/upcoming/<Classic id>/ (the layout extract-wearables.mjs uses, so build-catalog.mjs reads them with the same code)
// and the list to data/upcoming.json. Nothing here is confirmed: dyeable is only a hint (see AGENTS.md).
//   WZ_DATA=".../maplestorycw/appdata/Data" node scripts/extract-upcoming.mjs
// Needs the game files: see scripts/lib-wz.mjs. "In the catalogue" means a catalogue item's Classic id (or sprite id) is the same.
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { drawItem } from './lib-draw.mjs';

const read = f => JSON.parse(readFileSync(f, 'utf8'));
const dye = read('data/game-dye.json');
const catalogue = read('public/catalog.json');
const before = existsSync('data/upcoming.json') ? read('data/upcoming.json').items : []; // the last run: its items (released or not) are not "already in the catalogue"
const mine = new Set(before.map(i => i.id)), releasedBefore = new Set(before.filter(i => i.released).map(i => i.id));
const have = new Set(Object.values(catalogue.wearables).flatMap(s => s.items.filter(i => !mine.has(i.classicId ?? i.id)).flatMap(i => [i.id, i.classicId])));
const skip = new Set(read('data/rules.json').upcomingExclude ?? []); // left out on purpose (data/rules.json)
const todo = dye.items.filter(i => !have.has(i.id) && !skip.has(i.id));

const out = [], problems = [];
rmSync('public/sprites/upcoming', { recursive: true, force: true });
for (const it of todo) {
  const r = drawItem(it, `public/sprites/upcoming/${it.id}`);
  if (r.problem) { problems.push(`${it.name ?? it.id} (${it.id}): ${r.problem}`); continue; }
  out.push({ id: it.id, name: it.name, folder: it.folder, ...(releasedBefore.has(it.id) && { released: true }), ...(r.weaponClass && { weaponClass: r.weaponClass }) });
}
writeFileSync('data/upcoming.json', JSON.stringify({ _comment: 'Dyeable equipment in the game files that is not in the catalogue (the possible-upcoming list). UNCONFIRMED: dyeable may hint at items for an upcoming release, nothing more. `released: true` marks items that have since come out: build-catalog.mjs lists them as ordinary released items. Written by scripts/extract-upcoming.mjs, which keeps the `released` flags.', items: out }, null, 1));
console.log(`${out.length} upcoming items written of ${todo.length}`, problems.length ? `\nPROBLEMS:\n${problems.join('\n')}` : '');
