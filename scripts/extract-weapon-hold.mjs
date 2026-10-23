// Writes a weapon's one-handed hold (its "stand1" picture) from the game's own files into the stored sprites, for weapons whose
// stand1 the sprite API did not give us. The client stores a weapon's art per weapon class (30 = one-handed sword class, 49 = gun
// class, 46 = crossbow, ...), each with its own stand1 / stand2: a cash weapon is drawn from the class of what you hold.
//   WZ_DATA=".../maplestorycw/appdata/Data" node scripts/extract-weapon-hold.mjs <itemId> <class> [--also-stand2]
// e.g. node scripts/extract-weapon-hold.mjs 1702010 30   (the Orange Toy Hammer's one-handed hold)
// Needs the game files: see scripts/lib-wz.mjs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { image, png, originOf, at, str, openWz } from './lib-wz.mjs';
const [id, cls] = process.argv.slice(2); if (!id || !cls) throw new Error('usage: extract-weapon-hold.mjs <itemId> <class> [--also-stand2]');
const also2 = process.argv.includes('--also-stand2');
const img = image('Character/Weapon', `${String(id).padStart(8, '0')}.img`); if (!img) throw new Error(`no weapon ${id} in the game files`);
const dir = `public/sprites/wearable/${id}`; mkdirSync('tmp', { recursive: true });
function take(anim, file, metaFile) {
  const node = at(img, `${cls}/${anim}/0/weapon`); const p = png(node); if (!p) throw new Error(`${id} class ${cls} has no ${anim}`);
  const [ox, oy] = originOf(node);
  p.saveToFile(`${dir}/${file}`);
  const meta = JSON.parse(readFileSync(`${dir}/${metaFile}`, 'utf8')); const part = { key: 'weapon', w: p.getWidth(), h: p.getHeight(), origin: { x: ox, y: oy, isEmpty: false }, maps: { navel: { x: 0, y: 0, isEmpty: true } }, position: str(node, 'z') };
  if (metaFile === 'meta.json') { meta.parts = [part]; meta.holdSource = `game files, weapon class ${cls}, ${anim}`; } else meta.parts = [part];
  writeFileSync(`${dir}/${metaFile}`, JSON.stringify(meta));
  console.log(anim, `${part.w}x${part.h}`, 'origin', ox, oy, 'layer', part.position, '->', `${dir}/${file}`);
}
take('stand1', 'weapon.png', 'meta.json');
if (also2) take('stand2', 'weapon.2.png', 'meta2.json');
