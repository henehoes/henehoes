// Builds every hair and face style in data/items.json from henesys.gg's salon list (data/henesys-salon.json) and the sprite
// API's MCW region, which is MapleStory Classic World's own game data: its ids and names are Classic's, so a Classic id IS the
// style (checked: 257 of the 262 salon entries have the same name at the same id, and where an id also exists in the GMS data
// the art is byte-identical). Run after fetch-henesys.mjs and build-manifest.mjs; then download.mjs and build-catalog.mjs.
//
// Replaces any hair/face the older name-matching steps put in items.json (build-manifest.mjs, add-pinned.mjs).
// Styles missing at their id are searched for by name in MCW; anything still missing goes to data/datamine-placeholders.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { API, sleep } from './lib.mjs';

const REGION = 'MCW', VERSION = '1';
const read = f => JSON.parse(readFileSync(f, 'utf8'));
const salon = read('data/henesys-salon.json');
const rules = read('data/rules.json');
const items = read('data/items.json');
const released = read('data/released.json');
const overrides = read('data/art-sources.json');
const norm = s => s.toLowerCase().replace(/ (hair|face)$/, '').replace(/[^a-z0-9]/g, '');

// Does the item have sprite data? Some items exist as an icon only and the full item is `null`.
async function hasSprites(id, region = REGION, version = VERSION, soft = false) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`${API}/${region}/${version}/item/${id}`, { signal: AbortSignal.timeout(30000) });
      if (res.status === 404) return false;
      if (res.ok) { const j = await res.json(); return !!j?.frameBooks; }
    } catch {}
    await sleep(700 * (i + 1));
  }
  if (soft) return false; // other regions answer erratically for ids they do not have: treat repeated errors as "no"
  throw new Error(`could not fetch ${id}`);
}
// Does the item exist? The icon endpoint answers in about a second with a 2 KB picture (the full item is 650 KB), and 404s when
// there is no such item. Errors are retried and never treated as "absent".
async function exists(id) {
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(`${API}/${REGION}/${VERSION}/item/${id}/icon`, { signal: AbortSignal.timeout(30000) });
      if (res.status === 404) return false;
      if (res.ok) return true;
    } catch {}
    await sleep(700 * (i + 1));
  }
  throw new Error(`could not check ${id}`);
}
async function search(q) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`${API}/${REGION}/${VERSION}/item?searchFor=${encodeURIComponent(q)}&count=60`, { signal: AbortSignal.timeout(30000) });
      if (res.ok) return (await res.json()).filter(x => ['Hair', 'Face'].includes(x.typeInfo?.subCategory));
    } catch {}
    await sleep(600 * (i + 1));
  }
  return [];
}
const baseId = (kind, id) => kind === 'hair' ? Math.floor(id / 10) * 10 : id - Math.floor((id % 1000) / 100) * 100;
const idOf = (kind, id, c) => kind === 'hair' ? baseId(kind, id) + c : baseId(kind, id) + c * 100;
const keyOf = (kind, id) => kind === 'hair' ? Math.floor(id / 10) : baseId(kind, id);
const colourOf = (kind, id) => kind === 'hair' ? id % 10 : Math.floor((id % 1000) / 100);
const excluded = (kind, e) => (rules.exclude ?? []).some(x => x.kind === kind && norm(x.style) === norm(e.name) && (x.gender === e.gender || e.gender === 'both'));

// A style is released when released.json lists its Classic id, or lists its name and it is the first style with that name.
const firstByName = new Map();
for (const kind of ['hair', 'face']) for (const e of salon[kind]) { const k = `${kind}:${e.gender}:${norm(e.name)}`; if (!firstByName.has(k) || firstByName.get(k) > e.id) firstByName.set(k, e.id); }
const isReleased = (kind, e) => (e.gender === 'both' ? ['male', 'female'] : [e.gender]).some(g => released[kind]?.[g]?.some(n => typeof n === 'number' ? n === e.id : norm(n) === norm(e.name) && firstByName.get(`${kind}:${e.gender}:${norm(e.name)}`) === e.id));

const styles = [], placeholders = [];
async function resolve(kind, e) {
  if (excluded(kind, e)) return;
  let colours = [];
  if (await exists(baseId(kind, e.id))) {
    for (let c = 0; c < (kind === 'hair' ? 8 : 9); c++) {
      const id = idOf(kind, e.id, c);
      if (c === 0 || await exists(id)) colours.push({ id, name: e.name, colour: c });
    }
  }
  if (colours.length && !await hasSprites(colours[0].id)) colours = []; // an icon but no sprite data
  let how = 'id';
  if (!colours.length) { // not at its id: look for it by name
    const hits = (await search(e.name.replace(/ (Hair|Face)$/, ''))).filter(h => h.typeInfo.subCategory.toLowerCase() === kind && norm(h.name.replace(/ \((Black|Red|Orange|Blonde|Yellow|Green|Blue|Purple|Brown)\)$/, '')) === norm(e.name));
    if (hits.length) {
      const key = kind === 'hair' ? Math.floor(hits[0].id / 10) : baseId('face', hits[0].id);
      colours = hits.filter(h => (kind === 'hair' ? Math.floor(h.id / 10) : baseId('face', h.id)) === key).map(h => ({ id: h.id, name: h.name, colour: colourOf(kind, h.id) })).sort((a, b) => a.colour - b.colour);
      how = 'name';
    }
  }
  if (colours.length && how === 'name' && !await hasSprites(colours[0].id)) colours = []; // listed by name, but still no sprite data
  let source = { region: REGION, version: VERSION };
  const other = overrides[`${kind}:${e.id}`];
  if (!colours.length && other) { // not in the Classic data: take the art from the region the override names
    const first = other.id ?? baseId(kind, e.id);
    for (let c = 0; c < (kind === 'hair' ? 8 : 9); c++) {
      const id = other.id ? (kind === 'hair' ? first + c : first + c * 100) : idOf(kind, e.id, c);
      if (await hasSprites(id, other.region, other.version, true)) colours.push({ id, name: e.name, colour: c });
    }
    if (colours.length) { source = other; how = `${other.region} ${other.version}`; }
  }
  if (!colours.length) { placeholders.push({ kind, style: e.name, gender: e.gender, classicId: e.id, reason: `Classic id ${e.id} is not in the Classic game data on the sprite API` }); console.log(`NO SPRITE  ${kind} ${e.name} (${e.id})`); return; }
  const rel = isReleased(kind, e);
  styles.push({ style: e.name, matchedAs: e.name, kind, gender: e.gender, region: source.region, version: source.version, key: keyOf(kind, colours[0].id), classicId: e.id, released: rel, ...(e.group === 'collab' && { collab: true }), ...(how === 'name' && { note: `Not at Classic id ${e.id} in the Classic data; found by name` }), ...(source.region !== REGION && { note: `Not in the Classic game data; art from ${source.region} ${source.version}` }), colours });
  console.log(`${how === 'id' ? 'ok       ' : how === 'name' ? 'BY NAME  ' : 'OTHER    '} ${rel ? 'released ' : 'datamine '}${kind} ${e.name} (${e.id}): ${colours.length} colours`);
}
const queue = ['hair', 'face'].flatMap(kind => salon[kind].map(e => [kind, e]));
await Promise.all(Array.from({ length: 12 }, async () => { for (let job; (job = queue.shift());) await resolve(...job); }));

items.styles = [...styles.sort((a, b) => a.kind.localeCompare(b.kind) || a.classicId - b.classicId)];
writeFileSync('data/items.json', JSON.stringify(items, null, 2));
writeFileSync('data/datamine-placeholders.json', JSON.stringify({ _comment: 'Styles on henesys.gg with no sprite in the Classic data. Written by scripts/add-styles.mjs; shown as placeholders under the Datamine switch.', items: placeholders.sort((a, b) => a.classicId - b.classicId) }, null, 1));
const rel = styles.filter(s => s.released).length;
console.log(`styles ${styles.length} (${rel} released, ${styles.length - rel} datamine), ${placeholders.length} without a sprite`);
