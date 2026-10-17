import { getJson, getRender, decodeB64, locate, API } from './lib.mjs';
const V = '110';
const base = await getRender([2000, 12000], V);
console.log('skin only', base.width, base.height);
const probes = [
  { name: 'face', id: 20009, part: 'face', stack: [2000, 12000, 20009] },
  { name: 'hair', id: 30190, part: 'hair', stack: [2000, 12000, 30190] },
  { name: 'cap', id: 1002031, part: 'default', stack: [2000, 12000, 1002031] },
];
for (const p of probes) {
  const j = await getJson(`${API}/GMS/${V}/item/${p.id}`);
  const fr = j.frameBooks.stand1?.frames[0] ?? j.frameBooks.default.frames[0];
  const leaf = fr.effects[p.part];
  const scene = await getRender(p.stack, V);
  const img = decodeB64(leaf.image);
  const m = locate(scene, img);
  console.log(p.name, 'scene', scene.width, scene.height, 'img', img.width, img.height, 'origin', leaf.origin, 'map', leaf.mapOffset, 'pos', leaf.position, 'found', m);
}
