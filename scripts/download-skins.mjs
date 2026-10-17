// Downloads the separate body parts (body, arm, head, ear) for each skin tone from the raw WZ browser API,
// so clothing and weapons can be layered between them. Standing pose, frame 0.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { PNG } from 'pngjs';
import { decodeB64, getJson, sleep } from './lib.mjs';

// Usage: node scripts/download-skins.mjs [stand2]  (stand2 = the two-handed pose, written to skin2/ and data/skins2.json)
const STANCE = process.argv[2] ?? 'stand1';
const SUFFIX = STANCE === 'stand1' ? '' : '2';
const WZ = 'https://maplestory.io/api/wz/GMS/110/Character';
const node = async path => { await sleep(120); return getJson(`${WZ}/${path}`); };
const skipKeys = new Set(['delay', 'face']); // faces come from the face items instead

async function partOf(path, key) {
  const n = await node(`${path}/${key}`);
  if (!n.value || n.type !== 12) return null; // not an image
  const png = decodeB64(n.value);
  // The API sometimes answers a map listing with no children on the first try, so retry until it has some.
  let names = [];
  for (let i = 0; i < 5 && !names.length; i++) names = (await node(`${path}/${key}/map`)).children;
  if (!names.length) throw new Error(`no attachment points for ${path}/${key}`);
  const maps = {};
  for (const name of names) maps[name] = (await node(`${path}/${key}/map/${name}`)).value;
  return {
    key, png, w: png.width, h: png.height,
    origin: (await node(`${path}/${key}/origin`)).value,
    maps, position: (await node(`${path}/${key}/z`)).value,
  };
}

const tones = [];
for (let t = 0; t < 14; t++) {
  const id = String(2000 + t).padStart(8, '0'), headId = String(12000 + t).padStart(8, '0');
  const bodyPath = `${id}.img/${STANCE}/0`, headPath = `${headId}.img/${STANCE}/0`;
  let bodyKids;
  try { bodyKids = (await node(bodyPath)).children; } catch { continue; } // tone does not exist
  const parts = [];
  for (const [path, kids] of [[bodyPath, bodyKids], [headPath, (await node(headPath)).children]])
    for (const key of kids.filter(k => !skipKeys.has(k))) { const p = await partOf(path, key); if (p) parts.push(p); }
  const dir = `public/sprites/skin${SUFFIX}/${t}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const p of parts) writeFileSync(`${dir}/${p.key}.png`, PNG.sync.write(p.png));
  tones.push({ tone: t, parts: parts.map(({ png, ...rest }) => rest) });
  console.log(`tone ${t}: ${parts.map(p => `${p.key}(${p.position})`).join(', ')}`);
}
writeFileSync(`data/skins${SUFFIX}.json`, JSON.stringify(tones, null, 1));
