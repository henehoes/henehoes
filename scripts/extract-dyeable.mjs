// Reads which equipment the game's own files mark as dyeable (`info/colorvar`) and writes data/game-dye.json:
//   known: every equipment id found in Character/<Cap|Coat|Longcoat|Pants|Shoes|Glove|Cape|Weapon|Accessory>
//   dyeable: the ids among them with colorvar set (all are cash items)
//   items: id, folder and in-game name of each dyeable item
// build-catalog.mjs uses it to switch dyeing off for catalogue items the game does not let you dye, and to list the dyeable items
// that are not in the catalogue as "upcoming" (scripts/extract-upcoming.mjs draws them).
//   WZ_DATA=".../maplestorycw/appdata/Data" node scripts/extract-dyeable.mjs
// Needs the game files: see scripts/lib-wz.mjs.
import { writeFileSync, readdirSync } from 'node:fs';
import { openWz, image, at, str, num, DATA } from './lib-wz.mjs';

const FOLDERS = ['Cap', 'Coat', 'Longcoat', 'Pants', 'Shoes', 'Glove', 'Cape', 'Weapon', 'Accessory'];
const eqp = image('String', 'Eqp.img');
const fix = n => n?.replace(/�/g, 'ü'); // the game's own strings have a damaged ü (see extract-wearables.mjs)
const known = [], dyeable = [], items = [];
for (const folder of FOLDERS) {
  for (const wz of readdirSync(`${DATA}/Character/${folder}`).filter(n => /_\d{3}\.wz$/.test(n))) {
    for (const img of openWz(`Character/${folder}/${wz}`).getWzDirectory().wzImages()) {
      const id = parseInt(img.getName()); if (!id) continue;
      known.push(id);
      img.parseImage();
      if (!num(img.getFromPath('info'), 'colorvar')) continue;
      dyeable.push(id);
      items.push({ id, folder, name: fix(str(at(eqp, `ClassicWorld/${folder}/${id}`), 'name')) ?? null });
    }
  }
}
const byId = (a, b) => a - b;
writeFileSync('data/game-dye.json', JSON.stringify({
  _comment: 'Written by scripts/extract-dyeable.mjs from the game files: info/colorvar on an equipment item means the game lets you dye it. known = every equipment id read, dyeable = those with colorvar.',
  known: known.sort(byId), dyeable: dyeable.sort(byId), items: items.sort((a, b) => a.id - b.id),
}));
console.log(`${known.length} items read, ${dyeable.length} dyeable`);
