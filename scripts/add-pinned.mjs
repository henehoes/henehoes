// Adds the hair and face styles in data/pinned.json to data/items.json by item id (no name search).
// Idempotent: an existing entry with the same style and gender is replaced. Run after build-manifest.mjs, then download.mjs and build-catalog.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { API, sleep } from './lib.mjs';

// null = the API says there is no such item. Errors are retried, never treated as "absent", so colours are not silently dropped.
async function item(v, id) {
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(`${API}/GMS/${v}/item/${id}`);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(700 * (i + 1));
  }
  throw new Error(`could not fetch ${id} (v${v})`);
}

const VERSIONS = ['110', '210.1.1'];
const items = JSON.parse(readFileSync('data/items.json', 'utf8'));
const pinned = JSON.parse(readFileSync('data/pinned.json', 'utf8'));
// Optional: node scripts/add-pinned.mjs "Chestnut" runs only the named styles.
const only = process.argv.slice(2);
const all = [...pinned.hair.map(p => ({ ...p, kind: 'hair' })), ...pinned.face.map(p => ({ ...p, kind: 'face' }))].filter(p => !only.length || only.includes(p.style));

// Hair: colour is the last digit (8 colours). Face: colour is the hundreds digit (9 colours).
const idOf = (p, c) => p.kind === 'hair' ? Math.floor(p.id / 10) * 10 + c : p.id - Math.floor((p.id % 1000) / 100) * 100 + c * 100;
const keyOf = p => p.kind === 'hair' ? Math.floor(p.id / 10) : p.id - Math.floor((p.id % 1000) / 100) * 100;

for (const p of all) {
  let version, colours = [];
  for (const v of VERSIONS) {
    colours = [];
    for (let c = 0; c < (p.kind === 'hair' ? 8 : 9); c++) {
      const id = idOf(p, c);
      const j = await item(v, id);
      if (j?.typeInfo?.subCategory === (p.kind === 'hair' ? 'Hair' : 'Face')) colours.push({ id, name: j.description.name, colour: c });
      await sleep(150);
    }
    if (colours.length) { version = v; break; }
  }
  if (!colours.length) { console.log(`NOT FOUND ${p.style} (${p.id})`); continue; }
  items.styles = items.styles.filter(s => !(s.style === p.style && s.gender === p.gender && s.kind === p.kind));
  items.styles.push({ style: p.style, matchedAs: p.style, kind: p.kind, gender: p.gender, version, key: keyOf(p), colours });
  console.log(`${p.style} (${p.kind}, ${p.gender}): ${colours.length} colours from v${version}, e.g. ${colours[0].name}`);
}
// A pinned style is no longer a guess, so drop any stale "assumed match" note for it.
const report = JSON.parse(readFileSync('data/report.json', 'utf8'));
report.assumedMatches = report.assumedMatches.filter(a => !all.some(p => p.style === a.pasted));
report.styleUnresolved = report.styleUnresolved.filter(u => !all.some(p => p.style === u.style && p.gender === u.gender));
writeFileSync('data/report.json', JSON.stringify(report, null, 2));
writeFileSync('data/items.json', JSON.stringify(items, null, 2));
