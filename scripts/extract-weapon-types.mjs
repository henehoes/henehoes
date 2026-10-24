// Reads which weapon types each cash weapon can be worn over, from the game's own item description in String/Eqp.img
// ("... can be equipped over #cany weapon#." / "... over any #ccrossbow#."), and writes data/weapon-types.json: Classic id -> list.
// The colour-coded (#c...#) words of the first line are the types; "any weapon" is kept as it is. build-catalog.mjs adds the list to
// each weapon as `worksWith`, and the Equipped panel shows it.
//   WZ_DATA=".../maplestorycw/appdata/Data" node scripts/extract-weapon-types.mjs
// Needs the game files: see scripts/lib-wz.mjs.
import { writeFileSync, readdirSync } from 'node:fs';
import { openWz, image, at, str, DATA } from './lib-wz.mjs';

const eqp = image('String', 'Eqp.img');
const out = {}, odd = [];
for (const wz of readdirSync(`${DATA}/Character/Weapon`).filter(n => /_\d{3}\.wz$/.test(n))) {
  for (const img of openWz(`Character/Weapon/${wz}`).getWzDirectory().wzImages()) {
    const id = parseInt(img.getName()); if (!id) continue;
    const desc = str(at(eqp, `ClassicWorld/Weapon/${id}`), 'desc'); if (!desc) continue;
    const first = desc.split('\\n')[0]; // later lines name skills the weapon grants, not weapon types
    const types = [...first.matchAll(/#c(.+?)#/g)].flatMap(m => m[1].split(/,\s*(?:or\s+)?|\s+or\s+|\s+and\s+/)).map(t => t.replace(/^(a|an|any)\s+/i, '').replace(/\.$/, '').trim()).filter(Boolean);
    if (types.length) out[id] = types; else if (/equipped over/i.test(desc)) odd.push(`${id}: ${desc}`);
  }
}
writeFileSync('data/weapon-types.json', JSON.stringify({ _comment: 'Weapon types each cash weapon goes over, parsed from the game descriptions by scripts/extract-weapon-types.mjs. Classic id -> list; ["weapon"] means any weapon.', types: out }, null, 1));
console.log(`${Object.keys(out).length} weapons with a type list`, odd.length ? `\nNOT PARSED:\n${odd.join('\n')}` : '');
