// Same as calibrate-anchors.mjs, for the two-handed pose (stand2): reads pose2 sprites and renders stand2.
// Usage: node scripts/calibrate-anchors2.mjs kind:id:version ...
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { renderUrl, decodePng, locate } from './lib.mjs';

const render = async (ids, version) => decodePng(Buffer.from(await (await fetch(renderUrl(ids, version, 'stand2'))).arrayBuffer()));
const base = await render([2000, 12000], '110');
for (const [kind, id, version] of process.argv.slice(2).map(a => a.split(':'))) {
  const dir = `public/sprites/${kind}/${id}`;
  const meta = JSON.parse(readFileSync(`${dir}/meta.json`)), meta2 = JSON.parse(readFileSync(`${dir}/meta2.json`));
  const scene = await render([2000, 12000, Number(id)], version);
  const shift = locate(scene, base);
  for (const p of meta2.parts) {
    const img = PNG.sync.read(readFileSync(`${dir}/${p.key}.2.png`));
    const m = locate(scene, img);
    if (!m || m.score < 0.9) { console.log(meta.name, p.key, 'no confident match', m?.score?.toFixed(2)); continue; }
    const pos = { x: m.x - shift.x, y: m.y - shift.y };
    for (const [map, v] of Object.entries(p.maps ?? {}))
      console.log(meta.name, `[${meta.equipGroup}]`, p.key, map, 'anchor =', [pos.x + p.origin.x + v.x, pos.y + p.origin.y + v.y].join(','), 'score', m.score.toFixed(2), 'shift', shift.x + ',' + shift.y, shift.score.toFixed(2));
  }
}
