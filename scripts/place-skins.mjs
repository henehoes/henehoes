// Finds where each body part sits inside the API's flattened skin render (data/skin-renders/<tone>.png),
// because the head's attachment points are not readable from the WZ API. Writes `pos` into data/skins.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { locate, decodePng } from './lib.mjs';

const SUFFIX = process.argv[2] === 'stand2' ? '2' : ''; // stand2: the two-handed pose
const skins = JSON.parse(readFileSync(`data/skins${SUFFIX}.json`, 'utf8'));
for (const s of skins) {
  const scene = decodePng(readFileSync(`data/skin-renders${SUFFIX}/${s.tone}.png`));
  const scores = [];
  for (const p of s.parts) {
    const m = locate(scene, PNG.sync.read(readFileSync(`public/sprites/skin${SUFFIX}/${s.tone}/${p.key}.png`)));
    p.pos = { x: m.x, y: m.y };
    scores.push(`${p.key}@${m.x},${m.y}=${m.score.toFixed(2)}`);
  }
  console.log(`tone ${s.tone}: ${scores.join('  ')}`);
}
writeFileSync(`data/skins${SUFFIX}.json`, JSON.stringify(skins, null, 1));
