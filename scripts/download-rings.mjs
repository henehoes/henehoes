// Downloads the UI pieces of the name tag and chat bubble rings listed in data/rings.json from the raw WZ endpoint.
// Output: public/sprites/ring/<kind>/<code>/<piece>.png and meta.json (piece sizes, origins, text colour). Resumable.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { sleep, decodeB64 } from './lib.mjs';

const VERSIONS = ['150', '210.1.1', '110'];
const IMG = { nameTag: 'NameTag.img', chatBalloon: 'ChatBalloon.img' };
const { rings } = JSON.parse(readFileSync('data/rings.json', 'utf8'));

// null = the endpoint says there is no such node. Network errors are retried, never read as "absent".
async function node(version, path) {
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(`https://maplestory.io/api/wz/GMS/${version}/UI/${path}`);
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
      const body = await res.json().catch(() => null);
      if (body?.error?.includes('does not exist')) return null;
    } catch {}
    await sleep(700 * (i + 1));
  }
  throw new Error(`could not fetch ${path} (v${version})`);
}

for (const r of rings.filter(r => r.code != null)) {
  const dir = `public/sprites/ring/${r.kind}/${r.code}`;
  if (existsSync(`${dir}/meta.json`)) { console.log(`have ${r.name}`); continue; }
  let done = false;
  for (const v of VERSIONS) {
    const base = `${IMG[r.kind]}/${r.code}`;
    const listing = await node(v, base);
    if (!listing?.children) continue;
    mkdirSync(dir, { recursive: true });
    const pieces = {};
    let colour = '#ffffff';
    for (const key of listing.children) {
      if (key === 'clr') {
        const clr = (await node(v, `${base}/clr`))?.value ?? -1;
        colour = '#' + ((clr >>> 0) & 0xffffff).toString(16).padStart(6, '0');
        continue;
      }
      const leaf = await node(v, `${base}/${key}`);
      if (!leaf?.value || typeof leaf.value !== 'string') continue; // not an image (e.g. animation frames)
      const origin = (await node(v, `${base}/${key}/origin`))?.value ?? { x: 0, y: 0 };
      const png = decodeB64(leaf.value);
      writeFileSync(`${dir}/${key}.png`, PNG.sync.write(png));
      pieces[key] = { w: png.width, h: png.height, ox: origin.x, oy: origin.y };
      await sleep(150);
    }
    writeFileSync(`${dir}/meta.json`, JSON.stringify({ kind: r.kind, code: r.code, version: v, colour, pieces }));
    console.log(`${r.name}: ${Object.keys(pieces).join(',')} colour ${colour} (v${v})`);
    done = true;
    break;
  }
  if (!done) console.log(`NOT FOUND ${r.name} (${r.kind} ${r.code})`);
}
