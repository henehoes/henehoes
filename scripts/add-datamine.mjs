// Adds every hair and face style listed on henesys.gg (data/henesys-salon.json) that the catalogue does not have yet, as
// datamine styles (data/released.json decides which are released). Run after fetch-henesys.mjs, build-manifest.mjs and
// add-pinned.mjs; then download.mjs and build-catalog.mjs.
//
// How a Classic style gets its sprite (Classic's ids come from the same game data as GMS, but a few were renamed):
// Classic ids are not always the sprite API's ids (past the early styles the numbering differs, and Sweet Kitty Hair at its
// Classic id is plain hair while the sprite data's Sweet Kitty Hair has the cat ears), so the NAME decides:
//   1. the sprite API has an item at the Classic id whose name matches            -> used as is
//   2. otherwise a search by the Classic name finds the style (and it is not already used by another style) -> used
//   3. otherwise, if the sprite API has an item at the Classic id, its art is used with a CHECK note (Classic renamed it)
//   4. otherwise the style has no sprite we can draw                              -> listed in data/datamine-placeholders.json
import { readFileSync, writeFileSync } from 'node:fs';
import { API, sleep } from './lib.mjs';

const VERSIONS = ['110', '210.1.1'];
const read = f => JSON.parse(readFileSync(f, 'utf8'));
const salon = read('data/henesys-salon.json');
const rules = read('data/rules.json');
const items = read('data/items.json');
const norm = s => s.toLowerCase().replace(/ (hair|face)$/, '').replace(/[^a-z0-9]/g, '');
const stripColour = n => n.replace(/^(Black|Red|Orange|Blonde|Green|Blue|Purple|Brown) /, '').replace(/ \((Black|Blue|Red|Green|Hazel|Sapphire|Violet|Amethyst|White)\)$/, '');

// null = the API says there is no such item; errors are retried and never treated as "absent".
async function item(v, id) {
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(`${API}/GMS/${v}/item/${id}`);
      if (res.status === 404) return null;
      if (res.ok) return await res.json();
    } catch {}
    await sleep(700 * (i + 1));
  }
  throw new Error(`could not fetch ${id} (v${v})`);
}
async function search(v, q) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`${API}/GMS/${v}/item?searchFor=${encodeURIComponent(q)}&count=60`);
      if (res.ok) return (await res.json()).filter(x => x.typeInfo?.overallCategory === 'Equip');
    } catch {}
    await sleep(600 * (i + 1));
  }
  return [];
}
const sameName = (api, classic) => { const a = norm(stripColour(api)), c = norm(classic); return a.includes(c) || c.includes(a); };
const isVariant = (name, style) => {
  const n = name.toLowerCase().replace(/\s+/g, ' ').trim(), s = style.toLowerCase();
  if (n === s) return true;
  if (n.endsWith(' ' + s)) return n.slice(0, -s.length).trim().split(' ').length === 1;
  return n.startsWith(s) && /^\s*\([^)]*\)$/.test(n.slice(s.length));
};
const searchNames = style => [style, style.replace(/ (Hair|Face)$/, ''), style.replace(/^Medium /, ''), style.replace(/\s*'Do$/, 'Do')].filter((v, i, a) => v && a.indexOf(v) === i);

const baseId = (kind, id) => kind === 'hair' ? Math.floor(id / 10) * 10 : id - Math.floor((id % 1000) / 100) * 100;
const idOf = (kind, id, c) => kind === 'hair' ? Math.floor(id / 10) * 10 + c : baseId(kind, id) + c * 100;
const keyOf = (kind, id) => kind === 'hair' ? Math.floor(id / 10) : baseId(kind, id);
const colourOf = (kind, id) => kind === 'hair' ? id % 10 : Math.floor((id % 1000) / 100);

const genderOk = (s, e) => e.gender === 'both' || s.gender === e.gender;
const excluded = (kind, e) => (rules.exclude ?? []).some(x => x.kind === kind && norm(x.style) === norm(e.name) && (x.gender === e.gender || e.gender === 'both'));
const spriteBase = s => s.kind === 'hair' ? s.key * 10 : s.key;

// ---- Reconcile what the catalogue already has with henesys.gg ----
// An existing style is "the same" as a henesys.gg entry when its sprite id equals the Classic id, or else when the names match.
// It then takes the henesys.gg name and Classic id, so there is one source of truth. (Sprite ids and Classic ids differ for
// some styles, for example Bed Head Hair is Classic 30830 and sprite 32390.)
const renames = [];
const claimed = new Map(), taken = new Set();
const original = items.styles.filter(s => !s.datamine);
for (const pass of ['name', 'id']) for (const kind of ['hair', 'face']) for (const e of salon[kind]) {
  if (claimed.has(`${kind}:${e.id}`)) continue;
  const s = original.find(s => s.kind === kind && !taken.has(s) && genderOk(s, e) && (pass === 'id' ? spriteBase(s) === baseId(kind, e.id) : norm(s.style) === norm(e.name)));
  if (s) { claimed.set(`${kind}:${e.id}`, s); taken.add(s); }
}
for (const [k, s] of claimed) {
  const [kind, id] = k.split(':'), e = salon[kind].find(x => x.id === Number(id));
  s.classicId = e.id;
  if (s.style !== e.name) { renames.push({ kind, gender: s.gender, from: s.style, to: e.name }); s.style = e.name; }
}
const have = (kind, e) => claimed.has(`${kind}:${e.id}`) || items.styles.some(s => s.datamine && s.kind === kind && s.classicId === e.id && genderOk(s, e));
import { existsSync } from 'node:fs';
// Kept between runs, so re-running for a few missing styles does not forget the others.
const oldPlaceholders = existsSync('data/datamine-placeholders.json') ? read('data/datamine-placeholders.json').items : [];
const placeholders = [];
const usedKeys = new Set(items.styles.map(s => `${s.kind}:${s.key}`)); // sprite styles already taken, so two entries never share art
let added = 0, byName = 0;

async function resolve(kind, e) {
  if (have(kind, e) || excluded(kind, e)) return;
  items.styles = items.styles.filter(s => !(s.datamine && s.kind === kind && s.classicId === e.id));
  let found = null, apiName = null, apiAtId = false;

  // 1. the item at the Classic id
  for (const v of VERSIONS) {
    const j = await item(v, baseId(kind, e.id)); await sleep(120);
    if (!j) continue;
    apiAtId = true; apiName = j.description?.name ?? '';
    if (sameName(apiName, e.name)) { found = { version: v, how: 'id' }; break; }
  }
  let colours = [];
  if (found) {
    for (let c = 0; c < (kind === 'hair' ? 8 : 9); c++) {
      const id = idOf(kind, e.id, c), j = await item(found.version, id); await sleep(120);
      if (j?.typeInfo?.subCategory === (kind === 'hair' ? 'Hair' : 'Face')) colours.push({ id, name: j.description.name, colour: c });
    }
  }
  // 2. a search by the Classic name
  let note;
  if (!colours.length) {
    outer: for (const v of VERSIONS) for (const q of searchNames(e.name)) {
      const hits = (await search(v, q)).filter(x => ['Hair', 'Face'].includes(x.typeInfo.subCategory) && x.typeInfo.subCategory.toLowerCase() === kind && isVariant(x.name, q));
      await sleep(150);
      if (!hits.length) continue;
      const groups = new Map();
      for (const h of hits) { const k = kind === 'hair' ? Math.floor(h.id / 10) : baseId('face', h.id); (groups.get(k) ?? groups.set(k, []).get(k)).push(h); }
      const wantFemale = e.gender === 'female';
      const free = [...groups].filter(([k]) => !usedKeys.has(`${kind}:${k}`));
      const pick = free.find(([k, m]) => kind === 'face' ? (Math.floor(k / 1000) === 21) === wantFemale : (m[0].requiredGender === 1) === wantFemale) ?? free[0];
      if (!pick) continue; // every match is already another style: try the next spelling, then the Classic id
      colours = pick[1].map(m => ({ id: m.id, name: m.name, colour: colourOf(kind, m.id) })).sort((a, b) => a.colour - b.colour);
      found = { version: v, how: 'name' }; byName++;
      break outer;
    }
  }
  // 3. the art at the Classic id, when Classic renamed the style
  // Not for the collab styles: they are new in Classic and reuse ids that hold unrelated styles in the sprite data.
  if (!colours.length && apiAtId && e.group !== 'collab') {
    for (const ver of VERSIONS) {
      const probe = await item(ver, baseId(kind, e.id)); await sleep(120);
      if (!probe) continue;
      for (let c = 0; c < (kind === 'hair' ? 8 : 9); c++) {
        const id = idOf(kind, e.id, c), j = await item(ver, id); await sleep(120);
        if (j?.typeInfo?.subCategory === (kind === 'hair' ? 'Hair' : 'Face')) colours.push({ id, name: j.description.name, colour: c });
      }
      if (colours.length) { found = { version: ver, how: 'renamed' }; note = `Classic calls this "${e.name}"; the sprite data calls the art at Classic id ${e.id} "${apiName}"`; break; }
    }
  }
  if (!colours.length) {
    placeholders.push({ kind, style: e.name, gender: e.gender, classicId: e.id, reason: apiAtId ? `Classic id ${e.id} is "${apiName}" in the sprite data, and no style with this name was found` : `Classic id ${e.id} is not in the sprite data` });
    console.log(`NO SPRITE  ${kind} ${e.name} (${e.id})`);
    return;
  }
  usedKeys.add(`${kind}:${keyOf(kind, colours[0].id)}`);
  items.styles.push({ style: e.name, matchedAs: e.name, kind, gender: e.gender, version: found.version, key: keyOf(kind, colours[0].id), classicId: e.id, datamine: true, ...(note && { note }), colours });
  added++;
  console.log(`${found.how === 'id' ? 'ok        ' : found.how === 'name' ? 'BY NAME   ' : 'SAME ID   '} ${kind} ${e.name} (${e.id}): ${colours.length} colours`);
}
// Several styles at once: the sprite API answers slowly, one call at a time would take close to an hour.
const queue = ['hair', 'face'].flatMap(kind => salon[kind].map(e => [kind, e]));
await Promise.all(Array.from({ length: 8 }, async () => { for (let job; (job = queue.shift());) await resolve(...job); }));
// Renamed styles keep their released status and their pin.
if (renames.length) {
  const relPath = 'data/released.json', released = read(relPath);
  for (const r of renames) {
    const list = released[r.kind]?.[r.gender];
    const i = list?.findIndex(n => norm(n) === norm(r.from)) ?? -1;
    if (i >= 0) list[i] = r.to;
    console.log(`renamed ${r.kind} (${r.gender}): "${r.from}" -> "${r.to}"`);
  }
  writeFileSync(relPath, JSON.stringify(released, null, 1));
  const pinPath = 'data/pinned.json', pinned = read(pinPath);
  for (const r of renames) for (const p of pinned[r.kind] ?? []) if (p.gender === r.gender && norm(p.style) === norm(r.from)) p.style = r.to;
  writeFileSync(pinPath, JSON.stringify(pinned, null, 2));
}
writeFileSync('data/items.json', JSON.stringify(items, null, 2));
const allPlaceholders = [...oldPlaceholders.filter(o => !placeholders.some(p => p.kind === o.kind && p.classicId === o.classicId)), ...placeholders]
  .filter(p => { const e = salon[p.kind].find(x => x.id === p.classicId); return e && !have(p.kind, e); });
writeFileSync('data/datamine-placeholders.json', JSON.stringify({ _comment: 'Styles on henesys.gg with no sprite we can draw. Written by scripts/add-datamine.mjs; shown as placeholders under the Datamine switch.', items: allPlaceholders }, null, 1));
console.log(`added ${added} styles (${byName} matched by name), ${allPlaceholders.length} without a sprite`);
