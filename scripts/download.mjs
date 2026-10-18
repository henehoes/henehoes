// Downloads stand-pose part sprites for every item in data/items.json.
// Usage: node scripts/download.mjs [limit]   (limit = max items, for a quick trial)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { API, getJson, decodeB64, sleep } from './lib.mjs';
import { PNG } from 'pngjs';

const limit = Number(process.argv[2] ?? Infinity);
// Stored sprites: GMS ones in sprites/<kind>/<id>, other regions (MCW = Classic) in sprites/<region>/<kind>/<id>.
const spriteDir = (region, kind, id) => !region || region === 'GMS' ? `sprites/${kind}/${id}` : `sprites/${region.toLowerCase()}/${kind}/${id}`;
const { wearables, styles } = JSON.parse(readFileSync('data/items.json', 'utf8'));

const jobs = [
  ...wearables.map(w => ({ kind: 'wearable', id: w.id, version: w.version, name: w.name })),
  // Only released styles are stored; datamine styles are fetched live by the app (src/live.js).
  ...styles.filter(s => s.released !== false).flatMap(s => s.colours.map(c => ({ kind: s.kind, id: c.id, version: s.version, region: s.region, name: c.name }))),
].slice(0, limit);

// Also fetches the two-handed pose (stand2) into pose2/, used when a weapon that has no standing pose is worn.
const POSE2 = 'stand2';
// Which animation frame holds the standing pose for each kind.
const pickFrame = (j, kind, stance) => {
  const book = kind === 'face' ? j.frameBooks.default : stance ? (j.frameBooks[stance] ?? j.frameBooks.stand1 ?? j.frameBooks.default) : (j.frameBooks.stand1 ?? j.frameBooks.stand2 ?? j.frameBooks.default);
  return book?.frames?.[0]?.effects ?? {};
};

let done = 0, skipped = 0, failed = [];
for (const job of jobs) {
  const dir = `public/${spriteDir(job.region, job.kind, job.id)}`;
  const has1 = existsSync(`${dir}/meta.json`), has2 = existsSync(`${dir}/meta2.json`);
  if (has1 && has2) { skipped++; continue; }
  try {
    const j = await getJson(`${API}/${job.region ?? 'GMS'}/${job.version}/item/${job.id}`);
    if (!j) throw new Error('null item');
    mkdirSync(dir, { recursive: true });
    if (!has2) {
      const parts2 = [];
      for (const [key, leaf] of Object.entries(pickFrame(j, job.kind, POSE2))) {
        if (!leaf?.image) continue;
        const png = decodeB64(leaf.image);
        writeFileSync(`${dir}/${key}.2.png`, PNG.sync.write(png));
        parts2.push({ key, w: png.width, h: png.height, origin: leaf.origin, maps: leaf.mapOffset, position: leaf.position });
      }
      writeFileSync(`${dir}/meta2.json`, JSON.stringify({ parts: parts2 }));
      if (has1) { done++; await sleep(250); continue; }
    }
    const parts = [];
    for (const [key, leaf] of Object.entries(pickFrame(j, job.kind))) {
      if (!leaf?.image) continue;
      const png = decodeB64(leaf.image);
      writeFileSync(`${dir}/${key}.png`, PNG.sync.write(png));
      parts.push({ key, w: png.width, h: png.height, origin: leaf.origin, maps: leaf.mapOffset, position: leaf.position });
    }
    writeFileSync(`${dir}/meta.json`, JSON.stringify({ id: job.id, name: job.name, version: job.version, kind: job.kind, equipGroup: j.equipGroup, vslots: j.metaInfo?.vslots, islots: j.metaInfo?.islots, parts }));
    done++;
  } catch (e) { failed.push({ ...job, error: String(e.message) }); }
  await sleep(250);
}
writeFileSync('data/download-failed.json', JSON.stringify(failed, null, 2));
console.log(`downloaded ${done}, already had ${skipped}, failed ${failed.length}`);
