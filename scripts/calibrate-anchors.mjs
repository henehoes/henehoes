// Derives each attachment-point anchor in skin-PNG coordinates by locating real parts inside API renders.
// A part sits at (anchor - origin - mapOffset), so anchor = foundPos + origin + mapOffset.
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { getRender, locate } from './lib.mjs';

const probes = process.argv.slice(2).map(a => a.split(':')); // kind:id:version
const base = await getRender([2000, 12000], '110');
for (const [kind, id, version] of probes) {
  const dir = `public/sprites/${kind}/${id}`;
  const meta = JSON.parse(readFileSync(`${dir}/meta.json`));
  const scene = await getRender([2000, 12000, Number(id)], version);
  const shift = locate(scene, base); // where the skin sits inside the scene
  for (const p of meta.parts) {
    const img = PNG.sync.read(readFileSync(`${dir}/${p.key}.png`));
    const m = locate(scene, img);
    if (!m || m.score < 0.9) { console.log(meta.name, p.key, 'no confident match', m?.score?.toFixed(2)); continue; }
    const pos = { x: m.x - shift.x, y: m.y - shift.y };
    for (const [map, v] of Object.entries(p.maps ?? {}))
      console.log(meta.name, `[${meta.equipGroup}]`, p.key, map, 'anchor =', [pos.x + p.origin.x + v.x, pos.y + p.origin.y + v.y].join(','), 'score', m.score.toFixed(2), 'skinshift', shift.x + ',' + shift.y, 'shiftScore', shift.score.toFixed(2));
  }
}
