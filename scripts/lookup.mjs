// Usage: node scripts/lookup.mjs [region] [version]
import { readFileSync, writeFileSync } from 'node:fs';

const region = process.argv[2] ?? 'GMS';
const version = process.argv[3] ?? '110';
const base = `https://maplestory.io/api/${region}/${version}`;
const names = readFileSync('data/names.txt', 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const matched = [];
const unmatched = [];
for (const name of names) {
  const res = await fetch(`${base}/item?searchFor=${encodeURIComponent(name)}&count=15`);
  const results = res.ok ? await res.json() : [];
  const equips = results.filter(r => r.typeInfo?.overallCategory === 'Equip');
  const exact = equips.filter(r => norm(r.name) === norm(name));
  if (exact.length) {
    matched.push({ name, candidates: exact.map(({ id, name, typeInfo }) => ({ id, name, category: typeInfo.category, subCategory: typeInfo.subCategory })) });
  } else {
    unmatched.push({ name, suggestions: equips.slice(0, 5).map(r => ({ id: r.id, name: r.name, category: r.typeInfo.category })) });
  }
  await sleep(250);
}
writeFileSync('data/matched.json', JSON.stringify(matched, null, 2));
writeFileSync('data/unmatched.json', JSON.stringify(unmatched, null, 2));
console.log(`${region} ${version}: ${matched.length} matched, ${unmatched.length} unmatched of ${names.length}`);
