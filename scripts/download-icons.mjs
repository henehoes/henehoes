// Downloads each wearable's inventory icon (the "preview sprite") from the maplestory.io icon endpoint.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { API, sleep } from './lib.mjs';

const { wearables } = JSON.parse(readFileSync('data/items.json', 'utf8'));
let got = 0, had = 0;
const failed = [];
for (const w of wearables) {
  const dir = `public/sprites/wearable/${w.id}`;
  if (existsSync(`${dir}/icon.png`)) { had++; continue; }
  const res = await fetch(`${API}/GMS/${w.version}/item/${w.id}/icon`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok || buf.length < 60) { failed.push(`${w.name} (${w.id}): ${res.status}`); continue; }
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/icon.png`, buf);
  got++;
  await sleep(150);
}
console.log(`icons downloaded ${got}, already had ${had}, failed ${failed.length}`);
if (failed.length) console.log(failed.join('\n'));
