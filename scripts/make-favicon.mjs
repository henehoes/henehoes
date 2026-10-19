// Makes the website icons from the Orange Cat Beanie's inventory icon (public/sprites/wearable/1004028/icon.png), scaled by whole
// numbers so the pixels stay sharp. Writes public/favicon-32.png (32x32, as is), public/favicon.png (64x64) and
// public/apple-touch-icon.png (180x180 on the page's sky blue, because iPhones fill transparency with black).
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { decodePng } from './lib.mjs';

const icon = decodePng(readFileSync('public/sprites/wearable/1004028/icon.png'));
function render(size, scale, background) {
  const out = new PNG({ width: size, height: size });
  const w = icon.width * scale, h = icon.height * scale, ox = Math.floor((size - w) / 2), oy = Math.floor((size - h) / 2);
  for (let i = 0; i < out.data.length; i += 4) if (background) out.data.set([...background, 255], i);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (Math.floor(y / scale) * icon.width + Math.floor(x / scale)) * 4, d = ((oy + y) * size + ox + x) * 4;
    if (icon.data[s + 3] === 0) continue;
    for (let c = 0; c < 4; c++) out.data[d + c] = icon.data[s + c];
  }
  return PNG.sync.write(out);
}
writeFileSync('public/favicon-32.png', render(32, 1, null));
writeFileSync('public/favicon.png', render(64, 2, null));
writeFileSync('public/apple-touch-icon.png', render(180, 5, [200, 232, 248]));
console.log('wrote favicon-32.png, favicon.png, apple-touch-icon.png');
