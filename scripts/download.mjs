// Downloads stand-pose part sprites for every item in data/items.json.
// Usage: node scripts/download.mjs [limit]   (limit = max items, for a quick trial)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { API, getJson, decodeB64, sleep } from './lib.mjs';
import { PNG } from 'pngjs';

const limit = Number(process.argv[2] ?? Infinity);
// Stored sprites: GMS ones in sprites/<kind>/<id>, other regions (MCW = Classic) in sprites/<region>/<kind>/<id>.
const spriteDir = (region, kind, id) => !region || region === 'GMS' || kind === 'wearable' ? `sprites/${kind}/${id}` : `sprites/${region.toLowerCase()}/${kind}/${id}`;
const { wearables, styles } = JSON.parse(readFileSync('data/items.json', 'utf8'));

const jobs = [
  ...wearables.map(w => ({ kind: 'wearable', id: w.id, version: w.version, region: w.region, name: w.name })),
  // Every style is stored (released or datamine), so the app never needs the API while running.
  ...styles.flatMap(s => s.colours.map(c => ({ kind: s.kind, id: c.id, version: s.version, region: s.region, name: c.name }))),
].slice(0, limit);

// Also fetches the two-handed pose (stand2) into pose2/, used when a weapon that has no standing pose is worn.
const POSE2 = 'stand2';
// Which animation frame holds the standing pose for each kind.
const pickFrame = (j, kind, stance) => {
  const book = kind === 'face' ? j.frameBooks.default : stance ? (j.frameBooks[stance] ?? j.frameBooks.stand1 ?? j.frameBooks.default) : (j.frameBooks.stand1 ?? j.frameBooks.stand2 ?? j.frameBooks.default);
  return book?.frames?.[0]?.effects ?? {};
};

// The sprite API is flaky under load (502/503, aborted connections), so retry with growing pauses. An item that exists but has no
// sprite data comes back as `null`; for hair and faces we then look for the same id in other regions (checked 19/10/2026: TWMS 256
// has Maiden's Weave in every colour; TWMS/TMS/SEA have Chantelle Hair's last colour).
const FALLBACKS = [['TWMS', '256'], ['JMS', '444'], ['GMS', '270'], ['TMS', '209'], ['SEA', '220']];
async function fetchItem(region, version, id, { tries = 6, timeout = 90000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${API}/${region}/${version}/item/${id}`, { signal: AbortSignal.timeout(timeout) });
      if (res.status === 404) return null;
      if (res.ok) { const j = await res.json(); return j?.frameBooks ? j : null; }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) { lastErr = e; }
    await sleep(1500 * (i + 1));
  }
  throw lastErr;
}
async function itemWithFallback(job) {
  const home = job.region ?? 'GMS';
  const j = await fetchItem(home, job.version, job.id);
  if (j || (job.kind !== 'hair' && job.kind !== 'face')) return { j, source: `${home} ${job.version}` };
  for (const [region, version] of FALLBACKS) {
    if (region === home) continue;
    try { const k = await fetchItem(region, version, job.id, { tries: 2, timeout: 30000 }); if (k) return { j: k, source: `${region} ${version}` }; } catch {}
  }
  return { j: null, source: null };
}

let done = 0, skipped = 0, failed = [];
async function run(job) {
  const dir = `public/${spriteDir(job.region, job.kind, job.id)}`;
  const has1 = existsSync(`${dir}/meta.json`), has2 = existsSync(`${dir}/meta2.json`);
  if (has1 && has2) { skipped++; return; }
  try {
    const { j, source } = await itemWithFallback(job);
    if (!j) throw new Error('no sprite data in any region');
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
      if (has1) { done++; await sleep(250); return; }
    }
    const parts = [];
    for (const [key, leaf] of Object.entries(pickFrame(j, job.kind))) {
      if (!leaf?.image) continue;
      const png = decodeB64(leaf.image);
      writeFileSync(`${dir}/${key}.png`, PNG.sync.write(png));
      parts.push({ key, w: png.width, h: png.height, origin: leaf.origin, maps: leaf.mapOffset, position: leaf.position });
    }
    writeFileSync(`${dir}/meta.json`, JSON.stringify({ id: job.id, name: job.name, source, version: job.version, kind: job.kind, equipGroup: j.equipGroup, vslots: j.metaInfo?.vslots, islots: j.metaInfo?.islots, parts }));
    done++;
  } catch (e) { failed.push({ ...job, error: String(e.message) }); }
  await sleep(250);
}
// Several at a time: the API answers slowly (about 2.5 s and 500 KB per item), so one by one would take over an hour.
const queue = [...jobs];
await Promise.all(Array.from({ length: Number(process.env.DOWNLOAD_WORKERS ?? 6) }, async () => { for (let job; (job = queue.shift());) await run(job); }));
writeFileSync('data/download-failed.json', JSON.stringify(failed, null, 2));
console.log(`downloaded ${done}, already had ${skipped}, failed ${failed.length}`);
