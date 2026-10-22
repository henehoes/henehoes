// Read-only helpers for the game's own data files (the client's .wz files), via libwz (MIT, WebAssembly build).
// The client splits each file in two: the structure lives in X_000.wz and the picture data in _Canvas/_Canvas_000.wz, which the
// structure points to with an "_outlink" path. Set WZ_DATA to the game's Data folder (for a CrossOver install on a Mac:
// ~/Library/Application Support/MapleStoryNA/Bottles/maplestory/drive_c/Nexon/Library/maplestorycw/appdata/Data).
// libwz is NOT a dependency of the project (its install step builds a native addon, which would break `npm install` on Vercel).
// Install it for a run with:  npm install --no-save --ignore-scripts libwz
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DATA = process.env.WZ_DATA;
if (!DATA) throw new Error('Set WZ_DATA to the game\'s Data folder (see scripts/lib-wz.mjs).');
const GAME_VERSION = Number(process.env.WZ_VERSION ?? 779); // the client's version number; the files only open with the right one
const libwz = process.env.LIBWZ_DIR ? await import(pathToFileURL(`${process.env.LIBWZ_DIR}/dist/index.js`).href) : await import('libwz');
const { init, MapleVersion, WzFile } = libwz;
await init({ forceWasm: true });

const files = new Map();
export function openWz(rel) { // rel like "Map/Obj/Obj_000.wz"
  if (!files.has(rel)) {
    const w = WzFile.fromBytes(rel, new Uint8Array(readFileSync(`${DATA}/${rel}`)), GAME_VERSION, MapleVersion.CLASSIC);
    if (w.parseWzFile() !== 1) throw new Error(`Could not read ${rel} (wrong WZ_VERSION?)`);
    files.set(rel, w);
  }
  return files.get(rel);
}
const imgCache = new Map();
// An image inside a folder such as "Map/Obj" (searches every X_NNN.wz there). Returns null when there is none.
export function image(folder, name) {
  const key = `${folder}/${name}`;
  if (imgCache.has(key)) return imgCache.get(key);
  let found = null;
  for (const f of readdirSync(`${DATA}/${folder}`).filter(n => /_\d{3}\.wz$/.test(n))) {
    const i = openWz(`${folder}/${f}`).getWzDirectory().getImageByName(name);
    if (i) { i.parseImage(); found = i; break; }
  }
  imgCache.set(key, found);
  return found;
}
export const at = (root, path) => path.split('/').filter(Boolean).reduce((n, p) => n && (n.getFromPath ? n.getFromPath(p) : null), root);
// The picture of a canvas node (inline, or a stub whose pixels sit behind an _outlink), or null.
export function png(node) {
  if (!node) return null;
  const link = node.getFromPath?.('_outlink')?.getString?.();
  if (link) {
    const parts = link.split('/'), i = parts.findIndex(x => x.endsWith('.img'));
    const img = image(parts.slice(0, i).join('/'), parts[i]);
    const q = img && at(img, parts.slice(i + 1).join('/'))?.getPngProperty?.();
    return q && q.getWidth() > 1 ? q : null;
  }
  try { const p = node.getPngProperty?.(); return p && p.getWidth() > 0 ? p : null; } catch { return null; }
}
export const originOf = node => { const o = node?.getFromPath?.('origin'); return o ? [o.getX(), o.getY()] : [0, 0]; };
export const val = c => { const t = c.getPropertyType(); return t === 6 ? c.getString() : t === 2 ? c.getInt() : t === 1 ? c.getShort() : t === 9 ? [c.getX(), c.getY()] : null; };
export const num = (p, k, d = 0) => { const c = p?.getChildByName(k); return c ? Number(val(c)) : d; };
export const str = (p, k) => { const c = p?.getChildByName(k); return c ? val(c) : null; };
