// Compares my compositor with the API's own render for the same item ids. Writes tmp/verify-<name>.png (mine | API).
// Usage: node scripts/verify.mjs <name> <id,id,...>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { composite } from '../src/compose.js';
import { getRender, locate } from './lib.mjs';

mkdirSync('tmp', { recursive: true }); // scratch output folder, not shipped
const [name, idList] = process.argv.slice(2);
const ids = idList.split(',').map(Number);
const cat = JSON.parse(readFileSync('public/catalog.json', 'utf8'));
const all = new Map();
for (const w of Object.values(cat.wearables)) for (const i of w.items) all.set(i.id, i);
for (const s of [...cat.hair, ...cat.face]) for (const v of s.variants) all.set(v.id, v);

const W = 160, H = 160, OX = 60, OY = 50; // skin top-left in my canvas
const png = f => PNG.sync.read(readFileSync(`public/${f}`));
const layers = cat.skins[0].parts.map(p => ({ img: png(p.file), x: OX + p.x, y: OY + p.y, z: p.z }));
const covered = new Set(ids.flatMap(id => all.get(id)?.vslots ?? []));
for (const id of ids) {
  const item = all.get(id);
  if (!item) { console.log('not in catalog', id); continue; }
  for (const p of item.parts.filter(p => !covered.has(p.hiddenBy))) layers.push({ img: png(p.file), x: OX + p.x, y: OY + p.y, z: p.z });
}
const mine = composite(layers, W, H);
const api = await getRender([2000, 12000, ...ids], '110');
const skin = PNG.sync.read(readFileSync('data/skin-renders/0.png'));
const shift = locate(api, skin); // where the skin sits inside the API render (it crops to the content)

let diff = 0, total = 0;
for (let y = 0; y < api.height; y++) for (let x = 0; x < api.width; x++) {
  const ai = (y * api.width + x) * 4, mx = x - shift.x + OX, my = y - shift.y + OY;
  const mi = (my * W + mx) * 4;
  const aOpaque = api.data[ai + 3] > 0, mOpaque = mx >= 0 && my >= 0 && mx < W && my < H && mine.data[mi + 3] > 0;
  if (aOpaque || mOpaque) { total++; if (aOpaque !== mOpaque || (aOpaque && Math.abs(api.data[ai] - mine.data[mi]) + Math.abs(api.data[ai + 1] - mine.data[mi + 1]) + Math.abs(api.data[ai + 2] - mine.data[mi + 2]) > 60)) diff++; }
}
console.log(`${name}: ${(100 * diff / total).toFixed(1)}% of ${total} drawn pixels differ`);

const K = 4, out = new PNG({ width: (W + api.width) * K + 8, height: Math.max(H, api.height) * K });
const put = (img, ox) => { for (let y = 0; y < img.height * K; y++) for (let x = 0; x < img.width * K; x++) { const s = (Math.floor(y / K) * img.width + Math.floor(x / K)) * 4, d = (y * out.width + x + ox) * 4; if (img.data[s + 3]) { out.data[d] = img.data[s]; out.data[d + 1] = img.data[s + 1]; out.data[d + 2] = img.data[s + 2]; out.data[d + 3] = 255; } else { out.data[d] = out.data[d + 1] = out.data[d + 2] = 235; out.data[d + 3] = 255; } } };
put(mine, 0); put(api, W * K + 8);
writeFileSync(`tmp/verify-${name}.png`, PNG.sync.write(out));
