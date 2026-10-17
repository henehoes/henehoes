import { PNG } from 'pngjs';

export const API = 'https://maplestory.io/api';
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Some API responses carry bytes after the IEND chunk, which pngjs rejects.
const trimPng = buf => {
  const end = buf.indexOf('IEND');
  return end === -1 ? buf : buf.subarray(0, end + 8);
};
export const decodePng = buf => PNG.sync.read(trimPng(buf));
export const decodeB64 = b64 => decodePng(Buffer.from(b64, 'base64'));

export async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    await sleep(500 * (i + 1));
  }
  throw new Error(`GET ${url} failed`);
}

export function renderUrl(ids, version = '110', anim = 'stand1', frame = 0) {
  const items = ids.map(id => encodeURIComponent(JSON.stringify({ ItemId: id, Version: version, Region: 'GMS' })));
  return `${API}/character/${items.join(',')}/${anim}/${frame}`;
}

export async function getRender(ids, version) {
  const res = await fetch(renderUrl(ids, version));
  if (!res.ok) throw new Error(`render ${ids} -> ${res.status}`);
  return decodePng(Buffer.from(await res.arrayBuffer()));
}

// Find where `part` sits inside `scene` by exact match of its opaque pixels. Returns {x, y, score} of the best position.
export function locate(scene, part) {
  const px = [];
  for (let y = 0; y < part.height; y++) for (let x = 0; x < part.width; x++) {
    const i = (y * part.width + x) * 4;
    if (part.data[i + 3] === 255) px.push([x, y, part.data[i], part.data[i + 1], part.data[i + 2]]);
  }
  if (!px.length) return null;
  let best = { score: -1 };
  for (let oy = -part.height; oy <= scene.height; oy++) for (let ox = -part.width; ox <= scene.width; ox++) {
    let hit = 0;
    for (const [x, y, r, g, b] of px) {
      const sx = ox + x, sy = oy + y;
      if (sx < 0 || sy < 0 || sx >= scene.width || sy >= scene.height) continue;
      const i = (sy * scene.width + sx) * 4;
      if (scene.data[i + 3] && Math.abs(scene.data[i] - r) < 24 && Math.abs(scene.data[i + 1] - g) < 24 && Math.abs(scene.data[i + 2] - b) < 24) hit++;
    }
    const score = hit / px.length;
    if (score > best.score) best = { x: ox, y: oy, score };
  }
  return best;
}
