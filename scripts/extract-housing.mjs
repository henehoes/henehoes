// Reads the housing homes and furniture from the game's own files and writes public/housing/ (home pictures, furniture pictures
// and catalog.json, the only file the Housing book reads). Needs the game installed: see scripts/lib-wz.mjs.
//   WZ_DATA=".../maplestorycw/appdata/Data" node scripts/extract-housing.mjs
//
// Homes: the Yellow Mushroom House (map 010001008) and the Kerning City apartment (map 010003008), rebuilt from the map's own
// backgrounds, tiles and objects (no parallax, animation or NPCs), then cropped to the house itself (the `focus` rectangle below,
// in map-picture coordinates), so the whole surrounding scene is never shown.
// Furniture: Item/Install 0300 (decor: has its own "placed" art), 0302 (chests) and 0303 (crafting stations), where the placed
// art is the NPC the item puts in the home. Chairs (0301, a sit effect), the 0399 reward items and the straw dummy (0304, its
// picture is in an encrypted pack) cannot be placed, so they are left out.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { image, png, originOf, at, num, str, openWz } from './lib-wz.mjs';
import { PNG } from 'pngjs';

const OUT = 'public/housing';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/homes`, { recursive: true }); mkdirSync(`${OUT}/furniture`, { recursive: true }); mkdirSync('tmp/housing', { recursive: true });

// ---------- decoded sprites ----------
const cache = new Map(); let n = 0;
function sprite(key, node) {
  if (cache.has(key)) return cache.get(key);
  let r = null; const p = png(node);
  if (p) { const f = `tmp/housing/${n++}.png`; if (p.saveToFile(f)) { const d = PNG.sync.read(readFileSync(f)); r = { w: d.width, h: d.height, data: d.data, o: originOf(node), z: num(node, 'z', 0) }; } }
  cache.set(key, r); return r;
}
const toPng = (w, h, data) => PNG.sync.write(Object.assign(new PNG({ width: w, height: h }), { data: Buffer.from(data) }));
function draw(dst, s, x, y, flip) {
  for (let j = 0; j < s.h; j++) { const ty = y + j; if (ty < 0 || ty >= dst.h) continue;
    for (let i = 0; i < s.w; i++) { const tx = x + i; if (tx < 0 || tx >= dst.w) continue;
      const si = (j * s.w + (flip ? s.w - 1 - i : i)) * 4, a = s.data[si + 3]; if (!a) continue;
      const di = (ty * dst.w + tx) * 4, da = dst.data[di + 3];
      if (a === 255 || !da) { dst.data[di] = s.data[si]; dst.data[di + 1] = s.data[si + 1]; dst.data[di + 2] = s.data[si + 2]; dst.data[di + 3] = a; }
      else { const o = a / 255, k = 1 - o; for (let c = 0; c < 3; c++) dst.data[di + c] = Math.round(s.data[si + c] * o + dst.data[di + c] * k); dst.data[di + 3] = Math.min(255, da + a); } } }
}

// ---------- homes ----------
const HOMES = [
  { key: 'yellow-mushroom-house', name: 'Yellow Mushroom House', mapId: '010001008', focus: [330, 190, 760, 590] }, // focus: x, y, width, height of the house itself in the map picture; the stored picture is cropped to it
  { key: 'kerning-apartment', name: 'Kerning City Apartment', mapId: '010003008', focus: [300, 230, 900, 700] },
];
const maps = openWz('Map/Map/Map0/Map0_000.wz').getWzDirectory();
const homes = [];
for (const h of HOMES) {
  const img = maps.getImageByName(`${h.mapId}.img`); img.parseImage();
  const info = img.getFromPath('info');
  const L = num(info, 'VRLeft'), T = num(info, 'VRTop'), R = num(info, 'VRRight'), B = num(info, 'VRBottom');
  const dst = { w: R - L, h: B - T, data: new Uint8Array((R - L) * (B - T) * 4) };
  const put = (s, x, y, flip = false) => { if (s) draw(dst, s, Math.round(x - (flip ? s.w - s.o[0] : s.o[0]) - L), Math.round(y - s.o[1] - T), flip); };
  const front = [];
  for (const b of img.getFromPath('back')?.wzProperties() ?? []) { // backgrounds
    const bS = str(b, 'bS'); if (!bS) continue;
    const no = num(b, 'no'), ani = num(b, 'ani'), type = num(b, 'type'), bx = num(b, 'x'), by = num(b, 'y');
    const s = sprite(`back:${bS}:${ani}:${no}`, at(image('Map/Back', `${bS}.img`), `${ani ? 'ani' : 'back'}/${no}`)); if (!s) continue;
    const cx = num(b, 'cx') || s.w, cy = num(b, 'cy') || s.h;
    const xs = type === 1 || type === 3 ? Array.from({ length: Math.ceil(dst.w / cx) + 3 }, (_, k) => (Math.floor((L - bx) / cx) + k) * cx) : [0];
    const ys = type === 2 || type === 3 ? Array.from({ length: Math.ceil(dst.h / cy) + 3 }, (_, k) => (Math.floor((T - by) / cy) + k) * cy) : [0];
    const job = () => { for (const dx of xs) for (const dy of ys) put(s, bx + dx, by + dy); };
    if (num(b, 'front')) front.push(job); else job();
  }
  for (let l = 0; l < 8; l++) { // layers: tiles, then objects
    const lay = img.getFromPath(`${l}`); if (!lay) continue;
    const tS = str(lay.getChildByName('info'), 'tS');
    const tiles = [...(lay.getChildByName('tile')?.wzProperties() ?? [])].map(t => ({ t, s: tS && sprite(`tile:${tS}:${str(t, 'u')}:${num(t, 'no')}`, at(image('Map/Tile', `${tS}.img`), `${str(t, 'u')}/${num(t, 'no')}`)) })).filter(x => x.s).sort((a, b) => a.s.z - b.s.z || num(a.t, 'zM') - num(b.t, 'zM'));
    for (const { t, s } of tiles) put(s, num(t, 'x'), num(t, 'y'));
    for (const o of [...(lay.getChildByName('obj')?.wzProperties() ?? [])].sort((a, b) => num(a, 'z') - num(b, 'z'))) {
      const oS = str(o, 'oS'), p = `${str(o, 'l0')}/${str(o, 'l1')}/${str(o, 'l2')}`;
      const o0 = image('Map/Obj', `${oS}.img`), node = at(o0, `${p}/0`) ?? at(o0, p);
      put(sprite(`obj:${oS}:${p}`, node), num(o, 'x'), num(o, 'y'), !!num(o, 'f'));
    }
  }
  front.forEach(j => j());
  // crop to the house: `focus` is x, y, width, height in the full map picture (the Kerning sky starts below the top, so its
  // crop sits inside the drawn part)
  const [cx, cy] = h.focus, w = Math.min(h.focus[2], dst.w - cx), hh = Math.min(h.focus[3], dst.h - cy), out = new Uint8Array(w * hh * 4), x0 = cx, y0 = cy;
  for (let y = 0; y < hh; y++) out.set(dst.data.subarray(((y + y0) * dst.w + x0) * 4, ((y + y0) * dst.w + x0 + w) * 4), y * w * 4);
  // The published home pictures are this PNG converted to lossless WebP (about half the size, identical pixels), and public/housing/catalog.json
  // points at the .webp. After a re-run, convert again (e.g. Pillow: Image.open(png).save(webp, lossless=True, method=6)) and fix the paths.
  writeFileSync(`${OUT}/homes/${h.key}.png`, toPng(w, hh, out));
  homes.push({ id: h.key, name: h.name, mapId: h.mapId, file: `housing/homes/${h.key}.png`, width: w, height: hh });
  console.log(h.name, `${w}x${hh}`);
}

// ---------- furniture ----------
// A placed item is one or more layers: image/0, image/1, ... (the Cherry Bed is a headboard and a footboard). Each layer's first
// frame (its "0" canvas; the other numbers are animation frames) has an origin that points at one shared anchor, so the layers are
// stacked by z and merged into one picture whose origin is that anchor. Items with only image/0 come out unchanged.
function placedArt(it, id) {
  const root = it.getFromPath('image'); if (!root) return null;
  const layers = root.wzProperties().filter(l => /^\d+$/.test(l.getName())).map(l => ({ l, z: num(l, 'z', 0), i: Number(l.getName()) })).sort((a, b) => a.z - b.z || a.i - b.i);
  const parts = layers.map(({ l, i }) => sprite(`placed:${id}:${i}`, l.getChildByName('0'))).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  const x0 = Math.min(...parts.map(s => -s.o[0])), y0 = Math.min(...parts.map(s => -s.o[1])), x1 = Math.max(...parts.map(s => s.w - s.o[0])), y1 = Math.max(...parts.map(s => s.h - s.o[1]));
  const dst = { w: x1 - x0, h: y1 - y0, data: new Uint8Array((x1 - x0) * (y1 - y0) * 4) };
  for (const s of parts) draw(dst, s, -s.o[0] - x0, -s.o[1] - y0, false);
  return { w: dst.w, h: dst.h, data: dst.data, o: [-x0, -y0], z: 0 };
}

const names = new Map();
const ins = openWz('String/String_000.wz').getWzDirectory().getImageByName('Ins.img'); ins.parseImage();
for (const p of ins.wzProperties()) names.set(p.getName(), { name: str(p, 'name'), desc: str(p, 'desc') });
const GROUPS = [['0300', 'decor', 'Decor'], ['0302', 'chests', 'Chests'], ['0303', 'stations', 'Crafting stations']];
const furniture = [];
const save = (s, file) => { writeFileSync(`${OUT}/furniture/${file}`, toPng(s.w, s.h, s.data)); return `housing/furniture/${file}`; };
for (const [f, group] of GROUPS) {
  const book = image('Item/Install', `${f}.img`);
  for (const it of book.wzProperties()) {
    const id = Number(it.getName()), nm = names.get(String(id)); if (!nm?.name) continue;
    const info = it.getFromPath('info'), icon = sprite(`icon:${id}`, at(it, 'info/icon'));
    let art = placedArt(it, id);
    if (!art && num(info, 'npcID')) { const npc = image('Npc', `${String(num(info, 'npcID')).padStart(7, '0')}.img`); const node = at(npc, 'stand/0') ?? at(npc, 'stand'); art = sprite(`npc:${id}`, node); } // a chest or station is shown as the NPC it adds
    if (!icon || !art) { console.log('skipped (no art)', id, nm.name); continue; }
    furniture.push({ id, name: nm.name, desc: nm.desc, group, icon: save(icon, `${id}_icon.png`), art: { file: save(art, `${id}.png`), w: art.w, h: art.h, ox: art.o[0], oy: art.o[1] } });
  }
}
console.log('furniture', furniture.length, GROUPS.map(([, g]) => `${g}:${furniture.filter(x => x.group === g).length}`).join(' '));
writeFileSync(`${OUT}/catalog.json`, JSON.stringify({ homes, groups: GROUPS.map(([, id, label]) => ({ id, label })), furniture }));
rmSync('tmp/housing', { recursive: true, force: true });
