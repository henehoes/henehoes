// Reads which weapon types each cash weapon can be worn over, from the game's own item description in String/Eqp.img
// ("... can be equipped over #cany weapon#." / "... over any #ccrossbow#."), and writes data/weapon-types.json: Classic id -> list.
// The colour-coded (#c...#) words of the first line are the types; "any weapon" is kept as it is. build-catalog.mjs adds the list to
// each weapon as `worksWith`, and the Equipped panel shows it.
//   WZ_DATA=".../maplestorycw/appdata/Data" node scripts/extract-weapon-types.mjs
// Needs the game files: see scripts/lib-wz.mjs.
import { writeFileSync, readdirSync } from 'node:fs';
import { openWz, image, at, str, DATA } from './lib-wz.mjs';

const eqp = image('String', 'Eqp.img');
// The weapon types of Classic World (the Glowing Pumpkin Basket's description lists exactly these). Main-game types some descriptions
// also name (knuckle, gun, katana, fan...) are kept in the file; build-catalog.mjs keeps only these.
const CLASSIC = ['one-handed sword', 'one-handed axe', 'one-handed blunt weapon', 'dagger', 'wand', 'staff', 'two-handed sword', 'two-handed axe', 'two-handed blunt weapon', 'spear', 'polearm', 'bow', 'crossbow', 'claw'];
// "any weapon" -> ['weapon']; "any weapon except a, b and c" -> every Classic type but those; "a two-handed sword, axe, or blunt weapon" ->
// the hand carries over to the bare axe and blunt weapon. Lower case, singular ("Crossbows"), "two-handed blunt" -> "two-handed blunt weapon".
function typesOf(text) {
  const words = t => t.replace(/\.$/, '').trim().toLowerCase();
  const except = words(text).match(/^any weapon except (.+)$/);
  const list = (except ? except[1] : words(text)).split(/,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+/).map(t => t.replace(/^(a|an|any|and)\s+/, '').trim()).filter(Boolean);
  let hand = null;
  const types = list.map(t => {
    if (t === 'weapon') return t;
    const h = t.match(/^(one|two)-handed /)?.[0]; if (h) hand = h; else if (hand && /^(sword|axe|blunt( weapon)?)$/.test(t)) t = hand + t;
    t = t.replace(/^((one|two)-handed blunt)$/, '$1 weapon').replace(/-type weapon$/, '').replace(/^pole arm$/, 'polearm');
    return CLASSIC.includes(t) || !t.endsWith('s') ? t : t.slice(0, -1); // "crossbows", "guns", "long swords"
  });
  return except ? CLASSIC.filter(t => !types.includes(t)) : types;
}
const out = {}, odd = [];
for (const wz of readdirSync(`${DATA}/Character/Weapon`).filter(n => /_\d{3}\.wz$/.test(n))) {
  for (const img of openWz(`Character/Weapon/${wz}`).getWzDirectory().wzImages()) {
    const id = parseInt(img.getName()); if (!id) continue;
    const desc = str(at(eqp, `ClassicWorld/Weapon/${id}`), 'desc'); if (!desc) continue;
    const first = desc.split('\\n')[0]; // later lines name skills the weapon grants, not weapon types
    const coded = [...first.matchAll(/#c(.+?)#/g)].map(m => m[1]);
    const types = (coded.length ? coded : [first.match(/equipped over (.+)$/i)?.[1] ?? '']).flatMap(typesOf); // one description has no colour codes
    if (types.length) out[id] = types; else if (/equipped over/i.test(desc)) odd.push(`${id}: ${desc}`);
  }
}
writeFileSync('data/weapon-types.json', JSON.stringify({ _comment: 'Weapon types each cash weapon goes over, parsed from the game descriptions by scripts/extract-weapon-types.mjs. Classic id -> list; ["weapon"] means any weapon.', types: out }, null, 1));
console.log(`${Object.keys(out).length} weapons with a type list`, odd.length ? `\nNOT PARSED:\n${odd.join('\n')}` : '');
