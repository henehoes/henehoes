// Builds the preview backdrop: a slice of Henesys Town (map 100000000) from maplestory.io, with the ground line marked.
// Usage: node scripts/download-map.mjs [centreX]   (centreX = map x to centre on; default 1700, a long flat stretch of street)
//
// maplestory.io's map render has the ground tiles and objects but not the sky and hills, so those are drawn here from
// the map's own background set (Map/Back/grassySoil.img).
// Output: public/maps/henesys.png (800x240) and public/maps/henesys.json { width, height, groundRow, centreX }.
import { writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { decodePng, decodeB64, getJson, sleep } from './lib.mjs';

const VERSION = '83', MAP = 100000000;                  // GMS v83 is the closest to MapleStory Classic's art
const CENTRE_X = Number(process.argv[2] ?? 1700);   // a long flat stretch of street with no objects on it
const W = 800, H = 240, GROUND_ROW = 170;               // output size, and which row of it the ground line sits on
// Where the map's coordinates sit inside maplestory.io's render (measured on the v83 Henesys render: the flat street
// at y=334 has its first grass pixel on row 842, and the first row of ground at map x=938 is column ~2005).
const RENDER = { x: 1067, y: 508 };

const wz = path => getJson(`https://maplestory.io/api/wz/GMS/${VERSION}/${path}`);
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36' };

// ---- ground height under the chosen x, from the map's foothold lines ----
const map = await getJson(`https://maplestory.io/api/GMS/${VERSION}/map/${MAP}`);
const feet = Object.values(map.footholds).filter(f => f && [f.x1, f.x2, f.y1, f.y2].every(Number.isFinite));
const under = feet.filter(f => f.y1 === f.y2 && Math.min(f.x1, f.x2) <= CENTRE_X && Math.max(f.x1, f.x2) >= CENTRE_X);
if (!under.length) throw new Error(`no flat ground at x=${CENTRE_X}`);
const groundY = under[0].y1;
console.log(`ground at map x=${CENTRE_X}: y=${groundY}`);

// ---- the render: tiles and objects on a transparent background ----
const res = await fetch(`https://maplestory.io/api/GMS/${VERSION}/map/${MAP}/render`, { headers: UA });
if (!res.ok) throw new Error(`render -> ${res.status}`);
const render = decodePng(Buffer.from(await res.arrayBuffer()));
const rx0 = CENTRE_X - W / 2 + RENDER.x, ry0 = groundY - GROUND_ROW + RENDER.y;
const centreCol = CENTRE_X + RENDER.x;
// The ground must be solid just below the line the offset says it is on (objects such as the big tree can cover the area above it).
const solid = (x, y) => render.data[(y * render.width + x) * 4 + 3] > 200;
const groundRow = groundY + RENDER.y;
if (!solid(centreCol, groundRow + 12) || !solid(centreCol, groundRow + 40)) throw new Error(`render offset looks wrong: no solid ground below row ${groundRow}`);

// ---- backdrop: plain pieces of the map's own background set (Map/Back/grassySoil.img) ----
// Layers 0 (sky), 1 (clouds) and 4 (meadow). The others carry a tree, a stump, a fence, a yellow tree or scattered bushes, so
// they are left out to keep the scene plain. Placement is chosen for the picture rather than copied from the town map.
const out = new PNG({ width: W, height: H });
const blit = (img, x, y) => {
  for (let sy = 0; sy < img.height; sy++) {
    const dy = y + sy; if (dy < 0 || dy >= H) continue;
    for (let sx = 0; sx < img.width; sx++) {
      const dx = x + sx; if (dx < 0 || dx >= W) continue;
      const si = (sy * img.width + sx) * 4, di = (dy * W + dx) * 4, a = img.data[si + 3] / 255;
      if (!a) continue;
      const da = out.data[di + 3] / 255, oa = a + da * (1 - a);
      for (let c = 0; c < 3; c++) out.data[di + c] = (img.data[si + c] * a + out.data[di + c] * da * (1 - a)) / oa;
      out.data[di + 3] = oa * 255;
    }
  }
};
const back = async n => decodeB64((await wz(`Map/Back/grassySoil.img/back/${n}`)).value);
const sky = await back(0), clouds = await back(1), meadow = await back(4);
for (let y = 0; y < H; y += sky.height) for (let x = 0; x < W; x += sky.width) blit(sky, x, y);
blit(clouds, Math.round((W - clouds.width) / 2), -120);
blit(meadow, Math.round((W - meadow.width) / 2), GROUND_ROW + 110 - meadow.height); // its lower part hides behind the floor

// ---- the floor: only the ground band of the render (tiles and grass), so no objects come with it ----
const floorTop = GROUND_ROW - 12;
const floor = crop(render, rx0, ry0 + floorTop, W, H - floorTop);
blit({ width: W, height: H - floorTop, data: floor }, 0, floorTop);
function crop(im, x0, y0, w, h) {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 + x, sy = y0 + y;
    if (sx < 0 || sy < 0 || sx >= im.width || sy >= im.height) continue;
    for (let c = 0; c < 4; c++) d[(y * w + x) * 4 + c] = im.data[(sy * im.width + sx) * 4 + c];
  }
  return d;
}
// Where to stand a character. The foothold line is the very top of the blade tips, which are ragged, so feet ending there look
// like they hover. Stand them a few pixels into the grass instead: the first row where nearly every column of the floor is
// opaque, plus PLANT rows.
const PLANT = 4;
let standRow = GROUND_ROW;
for (let y = floorTop; y < H; y++) {
  let solidCols = 0;
  for (let x = 0; x < W; x++) if (floor[((y - floorTop) * W + x) * 4 + 3] > 200) solidCols++;
  if (solidCols >= W * 0.97) { standRow = y + PLANT; break; }
}
console.log(`foothold row ${GROUND_ROW}, feet end on row ${standRow - 1}`);
mkdirSync('public/maps', { recursive: true });
writeFileSync('public/maps/henesys.png', PNG.sync.write(out));
writeFileSync('public/maps/henesys.json', JSON.stringify({ width: W, height: H, groundRow: standRow, footholdRow: GROUND_ROW, centreX: W / 2, map: MAP, version: VERSION }));
console.log('wrote public/maps/henesys.png');
