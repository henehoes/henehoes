// Name tag and chat bubble rings, from the game's own files. Every ring item (Character/Ring/0<id>.img) carries a `sample`: a finished
// picture of what the ring looks like (the tag reads "MapleStory", the bubble "Maple").
// - Chat bubbles: the app shows the sample picture as it is (not editable).
// - Name tags: editable once worn (the catalogue card shows the sample picture as it is). A tag is a left end (w), a repeating middle (c)
//   and a right end (e), with the name drawn between. For 15 of the 76 the game's own pieces (UI/NameTag.img/<design>: w, c, e + clr) are
//   right and are used. For the others the pieces are not in this client (design numbers 19 and up are missing, and four rings point at
//   another ring's design: Beach 14, Pink Candy 16, White Cloud 17, Rainbow 18), so the tag is cut from its sample picture (see cutTag).
//   The two White Label Rings (design code 1) are a plain box the client draws itself; the colours come from the sample.
//   WZ_DATA=".../maplestorycw/appdata/Data" node scripts/extract-rings.mjs
// Writes public/sprites/ring/<classic id>.png and data/rings.json (then run scripts/build-catalog.mjs). Which items are rings of this
// kind: those with info/nameTag (name tag) or info/chatBalloon (chat bubble). All 158 rings in the client have a sample and are listed;
// `released: false` marks the datamine ones. Released (named by the user, 24/10/2026), see RELEASED below: 6 name tags and 6 chat bubbles.
// Name tags are editable only where pieces exist (the 18 above); the rest show their sample picture, with its own text.
// Needs the game files: see scripts/lib-wz.mjs.
import { writeFileSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { DATA, image, png, originOf, at, str, val, openWz } from './lib-wz.mjs';

const ringStrings = at(image('String', 'Eqp.img'), 'ClassicWorld/Ring');
// The game's own string is used. A few names have a damaged character (U+FFFD, in "MapleStory Community VIP Label Ring" and its chat
// twin); it becomes a space.
const nameOf = id => { const n = ringStrings.getFromPath(String(id)); return ((n ? str(n, 'name') : null) ?? `Ring ${id}`).replace(/�/g, ' ').replace(/\s+/g, ' ').trim(); };

// The client lists two identical White Label Rings (1112100 and 1112222); only the first is kept.
const SKIP = new Set([1112222]);
// The rings that are released in Classic: White Label, MapleStory Fest, Classic Beginnings, Founder's, Chocolate, Ink-and-Wash (tags) and
// Kitty, Classic Beginnings, MapleStory Fest, Founder's, Ink-and-Wash, Chocolate (chat bubbles). Everything else is datamine.
const RELEASED = new Set([1112100, 1112109, 1112108, 1112110, 1112113, 1112223, 1112215, 1112219, 1112220, 1112221, 1112227, 1112231]);
// Chat bubbles whose sample picture has no text in it (found by looking at all 81 pictures): the client draws the text on top. The app does
// the same only where the game records the text colour (`clr`) of the bubble's UI design: that is the case for the Ink-and-Wash bubble
// alone (design 28, white). The other blank bubbles point at designs the client does not have, so their colour is unknown and they are
// left without text rather than guessing a colour. Where the text goes is the middle of the bubble's inside (the colour that fills most of
// the picture, bounded by the rows and columns where it is at least half as common as at its peak, so the arrow and ornaments are left out).
const BLANK_BUBBLES = new Set([1112227, 1112244, 1112246, 1112247, 1112248, 1112249, 1112250, 1112254, 1112255, 1112256, 1112257, 1112258, 1112259, 1112260, 1112261, 1112262, 1112263, 1112264, 1112265, 1112266, 1112267, 1112268, 1112269, 1112271, 1112272, 1112273, 1112274, 1112276, 1112277, 1112281, 1112282, 1112283, 1112284, 1112285, 1112286, 1112287, 1112288, 1112289, 1112290, 1112291, 1112295, 1112297, 1112298, 1112299]);
// The text colour the game records for a chat bubble design (UI/ChatBalloon.img/<design>/clr), as #rrggbb, or null when the client has no such design.
const chatDesigns = image('UI', 'ChatBalloon.img');
function recordedColour(kind, code) {
  const c = kind === 'chatBalloon' ? chatDesigns.getFromPath(code)?.getChildByName('clr') : null;
  return c ? hex((val(c) >>> 16) & 255, (val(c) >>> 8) & 255, val(c) & 255) : null;
}
function blankText(file, colour) {
  const { width: w, height: h, data } = PNG.sync.read(readFileSync(file));
  const key = i => `${data[i]},${data[i + 1]},${data[i + 2]}`, cnt = new Map();
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 100) cnt.set(key(i), (cnt.get(key(i)) ?? 0) + 1);
  const dk = [...cnt].sort((a, b) => b[1] - a[1])[0][0];
  const isD = i => data[i + 3] > 100 && key(i) === dk;
  const rows = Array.from({ length: h }, (_, y) => { let n = 0; for (let x = 0; x < w; x++) if (isD((y * w + x) * 4)) n++; return n; });
  const cols = Array.from({ length: w }, (_, x) => { let n = 0; for (let y = 0; y < h; y++) if (isD((y * w + x) * 4)) n++; return n; });
  const span = a => { const max = Math.max(...a), ix = a.map((v, i) => v >= max * 0.5 ? i : -1).filter(i => i >= 0); return [ix[0], ix[ix.length - 1]]; };
  const [y0, y1] = span(rows), [x0, x1] = span(cols);
  return { value: 'Maple', colour, x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) };
}
// Name tags with no usable game pieces are cut from their sample picture into a left end (w), a one-column middle (c) and a right end (e).
// Automatic: the edge rows of a tag (top two and bottom two) are never touched by the text, so the longest run of columns whose edge rows
// match the most common ones is the middle; the ends are what is left on either side. Where the edge rows say a tag has no right end
// (the ribbons, flags), or it has little text, the right end starts after the last run of columns that match the middle column exactly.
// MANUAL sets the ends by hand (L: columns on the left, R: on the right) for the tags the automatic cut gets wrong or that are borrowed from
// another ring's design (Beach, Pink Candy, White Cloud, Rainbow); chosen on a rendering with a ruler. TEXT sets a text colour where the
// sample's pattern would fool the automatic choice.
const MANUAL = {
  1112112: { L: 15, R: 15 }, 1112114: { L: 14, R: 14 }, 1112116: { L: 10, R: 10 }, 1112117: { L: 7, R: 7 }, // borrowed designs
  1112121: { L: 17, R: 14 }, 1112135: { L: 6, R: 6 }, 1112141: { L: 18, R: 3 }, 1112142: { L: 18, R: 3 }, 1112150: { L: 32, R: 5 },
  1112152: { L: 22, R: 15 }, 1112163: { L: 26, R: 10 }, 1112168: { L: 31, R: 9 }, 1112171: { L: 5, R: 5 }, 1112173: { L: 38, R: 16 },
  1112174: { L: 38, R: 16 }, 1112189: { L: 28, R: 6 }, 1112155: { L: 28, R: 30 }, 1112156: { L: 28, R: 30 }, 1112164: { L: 34, R: 14 },
};
const TEXT = { 1112150: '#ffffff', 1112158: '#ffffff', 1112173: '#000000', 1112174: '#000000', 1112185: '#0a2a55', 1112186: '#003300' }; // strips with a textured body, where the automatic choice picks up the texture
const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
// Cuts a sample into w / c / e pieces, writes the three PNGs into `dir` and returns the `tag` block: { colour, pad, pieces }.
function cutTag(id, file, dir) {
  const { width: w, height: h, data } = PNG.sync.read(readFileSync(file));
  const px = (x, y) => { const i = (y * w + x) * 4; return data[i + 3] ? `${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}` : '0'; };
  const full = x => Array.from({ length: h }, (_, y) => px(x, y)).join(';');
  const edgeRows = [0, 1, h - 2, h - 1], edge = x => edgeRows.map(y => px(x, y)).join('|');
  let L, R;
  if (MANUAL[id]) ({ L, R } = MANUAL[id]);
  else {
    const ec = new Map(); for (let x = 0; x < w; x++) ec.set(edge(x), (ec.get(edge(x)) ?? 0) + 1);
    const E = [...ec].sort((a, b) => b[1] - a[1])[0][0];
    let best = [0, 0]; for (let x = 0; x < w;) { if (edge(x) === E) { let e = x; while (e < w && edge(e) === E) e++; if (e - x > best[1] - best[0]) best = [x, e]; x = e; } else x++; }
    L = best[0]; R = w - best[1];
    const fc = new Map(); for (let x = L; x < w - R; x++) fc.set(full(x), (fc.get(full(x)) ?? 0) + 1);
    const M0 = [...fc].sort((a, b) => b[1] - a[1])[0][0];
    const textCols = Array.from({ length: w - R - L }, (_, k) => full(L + k) !== M0).filter(Boolean).length;
    let last = null; for (let x = L; x < w - R;) { if (full(x) === M0) { let e = x; while (e < w - R && full(e) === M0) e++; if (e - x >= 2) last = [x, e]; x = e; } else x++; }
    if ((R === 0 || textCols <= 20) && last) R = w - last[1];
  }
  // the middle column: the most common column between the ends (the text and ornaments rarely repeat), then the padding before the text
  const inner = new Map(); for (let x = L; x < w - R; x++) inner.set(full(x), [(inner.get(full(x))?.[0] ?? 0) + 1, x]);
  const [, mid] = [...inner.values()].sort((a, b) => b[0] - a[0])[0];
  const M = full(mid); let pad = 0; while (L + pad < w - R && full(L + pad) === M) pad++;
  pad = pad >= 2 && pad <= 8 ? Math.min(6, pad) : 3;
  // where the strip is, vertically: the opaque rows of the middle column (a tall ornament can stand above or below it)
  const rowsOpaque = Array.from({ length: h }, (_, y) => px(mid, y) !== '0'), top = rowsOpaque.indexOf(true), bottom = rowsOpaque.lastIndexOf(true);
  // text colour: from the sample's own text where it has some, else light on a dark strip and dark on a light one
  const bgAt = y => { const i = (y * w + mid) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  // only the inside of the strip counts as text or background (its edge rows are borders, and ornaments can stand beyond them)
  const y0 = top + Math.round((bottom - top) * 0.3), y1 = bottom - Math.round((bottom - top) * 0.3);
  const far = new Map(); let best = 0, deviating = 0;
  for (let x = L + pad; x < w - R - pad; x++) for (let y = y0; y <= y1; y++) { if (px(x, y) === px(mid, y)) continue; const i = (y * w + x) * 4; if (!data[i + 3]) continue; deviating++; const b = bgAt(y), d = Math.abs(data[i] - b[0]) + Math.abs(data[i + 1] - b[1]) + Math.abs(data[i + 2] - b[2]); best = Math.max(best, d); const k = `${data[i]},${data[i + 1]},${data[i + 2]}`; far.set(k, [d, (far.get(k)?.[1] ?? 0) + 1]); }
  let colour;
  if (TEXT[id]) colour = TEXT[id];
  else if (deviating >= 12) colour = hex(...[...far].filter(([, [d]]) => d >= best * 0.6).sort((a, b) => b[1][1] - a[1][1])[0][0].split(',').map(Number));
  else { const mids = Array.from({ length: y1 - y0 + 1 }, (_, k) => bgAt(y0 + k)); const avg = mids.reduce((a, c) => a + lum(...c), 0) / mids.length; colour = avg < 150 ? '#ffffff' : '#000000'; }
  const piece = (x0, x1) => { const png = new PNG({ width: x1 - x0, height: h }); for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 4; c++) png.data[(y * png.width + x - x0) * 4 + c] = data[(y * w + x) * 4 + c]; return PNG.sync.write(png); };
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/w.png`, piece(0, L)); writeFileSync(`${dir}/c.png`, piece(mid, mid + 1)); writeFileSync(`${dir}/e.png`, piece(w - R, w));
  const oy = top + 5, textY = (top + bottom) / 2; // the strip's top sits 5 rows above the layout line, as in the game's own pieces
  return { colour, pad, pieces: { w: { w: L, h, ox: L, oy }, c: { w: 1, h, ox: 1, oy, textY }, e: { w: R, h, ox: 0, oy } } };
}
// A plain label (White Label Ring): the box colours, read from the sample.
function plainTag(file) {
  const { width: w, height: h, data } = PNG.sync.read(readFileSync(file)), px = (x, y) => (y * w + x) * 4;
  const at = (x, y) => hex(data[px(x, y)], data[px(x, y) + 1], data[px(x, y) + 2]);
  const y0 = Math.floor(h / 2); let edge = at(0, y0), fill = at(2, y0), x = 2; while (x < w && at(x, y0) === fill && x < 6) x++;
  const fillAlpha = +(data[px(2, y0) + 3] / 255).toFixed(2); // the box is translucent (about 73% opaque), as in the sample
  const dark = new Map(); for (let yy = 0; yy < h; yy++) for (let xx = 4; xx < w - 4; xx++) { const i = px(xx, yy); if (data[i + 3] > 200 && data[i] < 90 && data[i + 1] < 90) dark.set(at(xx, yy), (dark.get(at(xx, yy)) ?? 0) + 1); }
  return { edge, fill, fillAlpha, text: [...dark].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '#000000', h }; // the four corner pixels are transparent: the edge leaves them out
}
rmSync('public/sprites/ring', { recursive: true, force: true }); mkdirSync('public/sprites/ring', { recursive: true });
const nameTagDesigns = image('UI', 'NameTag.img');

const out = [], skipped = [];
for (const file of readdirSync(`${DATA}/Character/Ring`).filter(n => /_\d{3}\.wz$/.test(n))) {
  for (const img of openWz(`Character/Ring/${file}`).getWzDirectory().wzImages()) {
    img.parseImage(); const id = Number(img.getName().replace('.img', '')), info = img.getFromPath('info');
    if (SKIP.has(id)) continue;
    const kind = info?.getChildByName('nameTag') ? 'nameTag' : info?.getChildByName('chatBalloon') ? 'chatBalloon' : null; if (!kind) continue;
    const code = String(val(info.getChildByName(kind)));
    const pic = png(info.getFromPath('sample')); if (!pic) { skipped.push(`${id} ${nameOf(id)}`); continue; }
    pic.saveToFile(`public/sprites/ring/${id}.png`);
    const row = { name: nameOf(id), kind, classicId: id, file: `sprites/ring/${id}.png`, w: pic.getWidth(), h: pic.getHeight(), design: Number(code), ...(!RELEASED.has(id) && { released: false }), ...(BLANK_BUBBLES.has(id) && recordedColour(kind, code) && { text: blankText(`public/sprites/ring/${id}.png`, recordedColour(kind, code)) }) };
    if (kind === 'nameTag') { // editable name tags: pieces (the game's, or cut from the sample) or a plain box
      const dir = `public/sprites/ring/tag/${id}`;
      if (code === '1') row.plain = plainTag(`public/sprites/ring/${id}.png`);
      else if (MANUAL[id] || !nameTagDesigns.getFromPath(code)) row.tag = { dir: `sprites/ring/tag/${id}`, source: 'cut from the sample picture', ...cutTag(id, `public/sprites/ring/${id}.png`, dir) };
      else {
        const design = nameTagDesigns.getFromPath(code);
        mkdirSync(dir, { recursive: true }); const pieces = {};
        for (const key of ['w', 'c', 'e']) { const node = design.getFromPath(key), p = png(node); const [ox, oy] = originOf(node); p.saveToFile(`${dir}/${key}.png`); pieces[key] = { w: p.getWidth(), h: p.getHeight(), ox, oy }; }
        const clr = design.getChildByName('clr') ? val(design.getChildByName('clr')) : -1;
        row.tag = { dir: `sprites/ring/tag/${id}`, source: `game design ${code}`, colour: hex((clr >>> 16) & 255, (clr >>> 8) & 255, clr & 255), pieces };
      }
    }
    out.push(row);
  }
}
out.sort((a, b) => a.kind.localeCompare(b.kind) || a.classicId - b.classicId);
writeFileSync('data/rings.json', JSON.stringify({ _comment: "Name tag and chat bubble rings, written by scripts/extract-rings.mjs from the game files: each is the ring item's own `sample` picture (file, w, h), shown as it is, with the in-game name. `design` is the UI design number the item points at (not used: several rings share a design that is not theirs). Applied by scripts/build-catalog.mjs.", rings: out }, null, 1));
for (const r of out) console.log(`${r.kind.padEnd(11)} ${r.classicId} ${r.w}x${r.h} ${r.name}`);
console.log(`${out.length} rings (${out.filter(r => r.kind === 'nameTag').length} name tags, ${out.filter(r => r.kind === 'chatBalloon').length} chat bubbles)`, skipped.length ? `\nno sample picture: ${skipped.join(', ')}` : '');
