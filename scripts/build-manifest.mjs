// Resolves names to item ids. Writes data/items.json and data/report.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { API, getJson, sleep } from './lib.mjs';

const VERSIONS = ['110', '210.1.1'];
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const read = f => readFileSync(f, 'utf8').split('\n').map(s => s.trim()).filter(l => l && !l.startsWith('#'));
// data/hairface.txt has "# hair male"-style section headers; returns [{ style, kind, gender }].
const readStyles = f => {
  let kind, gender;
  return readFileSync(f, 'utf8').split('\n').map(l => l.trim()).filter(Boolean).flatMap(l => {
    const h = l.match(/^#\s*(hair|face)\s+(male|female)\s*$/);
    if (h) { [, kind, gender] = h; return []; }
    return l.startsWith('#') ? [] : [{ style: l, kind, gender }];
  });
};

// User-confirmed picks where a name matched several ids (all "option A").
const OVERRIDES = { 'Angel Wand': 1372086, 'White Jeans': 1062039, 'Cat Hat': 1002031, 'Sailor Outfit': 1050152, 'Heart Sunglasses': 1003807 };
// Names to leave out. (Chat and label rings are not listed in data/names.txt: they live in data/rings.json.)
const SKIP = new Set([]);
// Classic's Beetle Long Sleeve (1047027 on henesys.gg/cashshop) is not in the sprite API; the user confirmed the API's
// "Beetle Longsleeve Top" (1042032) is the right art.
const STAND_INS = { 'Beetle Long Sleeve': { id: 1042032, version: '110', category: 'Armor', subCategory: 'Top' } };

async function search(version, q) {
  const r = await getJson(`${API}/GMS/${version}/item?searchFor=${encodeURIComponent(q)}&count=60`);
  await sleep(200);
  return r.filter(x => x.typeInfo?.overallCategory === 'Equip');
}

const report = { wearablesUnresolved: [], styleUnresolved: [], styleMultiple: [], assumedMatches: [], skipped: [...SKIP] };
const wearables = [];
for (const name of read('data/names.txt')) {
  if (SKIP.has(name)) continue;
  if (STAND_INS[name]) { wearables.push({ name, ...STAND_INS[name] }); continue; }
  let found = null;
  for (const v of VERSIONS) {
    const hits = (await search(v, name)).filter(x => norm(x.name) === norm(name));
    const pick = OVERRIDES[name] ? hits.find(h => h.id === OVERRIDES[name]) : hits[0];
    if (pick) { found = { id: pick.id, name: pick.name, version: v, category: pick.typeInfo.category, subCategory: pick.typeInfo.subCategory, ambiguous: hits.length > 1 && !OVERRIDES[name] }; break; }
  }
  if (found) wearables.push(found); else report.wearablesUnresolved.push(name);
}

// Hair: colour is the last digit. Face: colour is the hundreds digit.
const groupKey = (sub, id) => sub === 'Hair' ? Math.floor(id / 10) : id - Math.floor((id % 1000) / 100) * 100;
const colourOf = (sub, id) => sub === 'Hair' ? id % 10 : Math.floor((id % 1000) / 100);
const styles = [];
// Alternative spellings tried when the pasted name finds nothing.
// Closest in-game name where the pasted one finds nothing. These are assumptions and are reported.
const ALIASES = {};
const variants = style => [style, ALIASES[style], style.replace(/ Hair$/, ''), style.replace(/^Medium /, ''), style.replace(/'Do$/, 'Do'), style.replace(/\s*'Do$/, '')]
  .filter((v, i, a) => v && a.indexOf(v) === i);
// A colour variant is "<Colour> <Style>" (one colour word) or "<Style> (<Colour>)", or the bare style.
const isVariant = (name, style) => {
  const n = name.toLowerCase().replace(/\s+/g, ' ').trim(), s = style.toLowerCase();
  if (n === s) return true;
  if (n.endsWith(' ' + s)) return n.slice(0, -s.length).trim().split(' ').length === 1;
  return n.startsWith(s) && /^\s*\([^)]*\)$/.test(n.slice(s.length));
};
for (const { style, kind: listKind, gender } of readStyles('data/hairface.txt')) {
  let hits = [], version = null, used = style;
  outer: for (const v of VERSIONS) for (const q of variants(style)) {
    hits = (await search(v, q)).filter(x => ['Hair', 'Face'].includes(x.typeInfo.subCategory) && isVariant(x.name, q));
    if (hits.length) { version = v; used = q; break outer; }
  }
  if (!hits.length) { report.styleUnresolved.push({ style, kind: listKind, gender }); continue; }
  if (used !== style && ALIASES[style] === used) report.assumedMatches.push({ pasted: style, matchedAs: used });
  const sub = hits[0].typeInfo.subCategory;
  const groups = new Map();
  for (const h of hits.filter(h => h.typeInfo.subCategory === sub)) {
    const k = groupKey(sub, h.id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(h);
  }
  // The same style name is often a separate male and female item. Faces say which in the id (20xxx male, 21xxx female);
  // for hair, use the API's requiredGender when it is 0 or 1. Groups of the wrong gender are dropped.
  const groupGender = (key, members) => sub === 'Face' ? (Math.floor(key / 1000) === 21 ? 'female' : 'male') : ({ 0: 'male', 1: 'female' })[members[0].requiredGender];
  let kept = [...groups].filter(([key, members]) => !groupGender(key, members) || groupGender(key, members) === gender);
  if (!kept.length) kept = [...groups];
  for (const [key, members] of kept) {
    styles.push({
      style, matchedAs: used, kind: sub.toLowerCase(), gender, version, key,
      colours: members.map(m => ({ id: m.id, name: m.name, colour: colourOf(sub, m.id) })).sort((a, b) => a.colour - b.colour),
    });
  }
  if (kept.length > 1) report.styleMultiple.push({ style, gender, keys: kept.map(([k]) => k) });
}

writeFileSync('data/items.json', JSON.stringify({ wearables, styles }, null, 2));
writeFileSync('data/report.json', JSON.stringify(report, null, 2));
console.log(`wearables ${wearables.length}, styles ${styles.length}, colour variants ${styles.reduce((n, s) => n + s.colours.length, 0)}`);
console.log(JSON.stringify(report, null, 1));
