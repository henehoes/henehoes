// Pure pixel functions on {width, height, data} RGBA buffers. Works with browser ImageData and pngjs PNGs.

// Layers are ordered by their index in the game's zmap (data/zmap.json), back to front.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---- The game's dye ("All Color Series": Tone, Chroma, Brightness) ----
// Tone turns the hue 0-359 degrees, Chroma changes saturation -99..+99, Brightness blends toward white (+) or black (-)
// -99..+99. Written from how the game's dye behaves (checked against in-game screenshots and meaegi.com's dressing room).
// Pure black and pure white pixels are never changed, so outlines and highlights stay put. A colour that sits on the
// game's 17-step palette (every channel a multiple of 17) comes out on that palette too.

// Rounds to a multiple of `step`, rounding up when within 1.5% of the next one.
const snap = (v, step = 17) => { const r = v / step; return (r - Math.floor(r) >= 0.985 ? Math.ceil(r) : Math.floor(r)) * step; };

function hslToRgb(hue, sat, light, onPalette) {
  const c = (1 - Math.abs(2 * light - 1)) * sat, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = light - c / 2;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hue / 60) % 6];
  const out = [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  return onPalette === null ? out : out.map(v => snap(v, onPalette ? 17 : 1)); // null: leave unrounded
}

// One colour. Returns [r, g, b] bytes.
function dyePixel(R, G, B, tone, chroma, bright) {
  const r0 = R / 255, g0 = G / 255, b0 = B / 255, hi = Math.max(r0, g0, b0), lo = Math.min(r0, g0, b0), span = hi - lo;
  const grey = hi === lo, light = (hi + lo) / 2, gap = 255 * span, top = 255 * hi, bottom = 255 * lo;
  let sat = light > 0 && light < 1 ? span / (1 - Math.abs(2 * light - 1)) : 0, hue = 0;
  if (!(R === G && G === B)) { hue = (hi === r0 ? (g0 - b0) / span : hi === g0 ? 2 + (b0 - r0) / span : 4 + (r0 - g0) / span) * 60; if (hue < 0) hue += 360; }
  const onPalette = R % 17 === 0 && G % 17 === 0 && B % 17 === 0; // otherwise keep full precision
  let [r, g, b] = [R, G, B];
  if (tone > 0) { hue = (hue + tone) % 360; [r, g, b] = hslToRgb(hue, sat, light, onPalette); }
  const reach = [r, g, b].map(v => !onPalette || v > 238); // channels allowed to reach 255 (palette colours stop at 238)
  if (chroma && sat) {
    sat = chroma > 0 ? clamp(sat + chroma / 100, 0, 1) : (sat * (chroma + 100)) / 100;
    [r, g, b] = hslToRgb(hue, sat, light, null);
  }
  if (bright) {
    const ch = [r, g, b], n = Math.max(r, g, b), o = Math.min(r, g, b);
    let delta = [0, 0, 0];
    if (bright < 0) {
      if (!grey) { const k = top === 0 ? 0 : (gap / top) * n; delta = ch.map(v => (v <= 0 ? -255 : ((o === 0 ? v : k) * bright) / 100)); }
    } else {
      delta = ch.map(v => ((n === 255 || grey) ? (255 - v) * bright / 100 : (((255 - n) * (15 - (12 * gap) / (bottom + gap))) / 15 + n - v) * bright / 100));
    }
    [r, g, b] = ch.map((v, i) => clamp(v + delta[i], 0, 255));
  }
  [r, g, b] = [r, g, b].map((v, i) => clamp(v, 0, reach[i] ? 255 : 238));
  if (onPalette) [r, g, b] = [r, g, b].map(v => snap(v));
  return [Math.floor(r), Math.floor(g), Math.floor(b)];
}

// tone 0..359, chroma and bright -99..99 (all 0 = unchanged). Returns a new buffer.
export function adjustColour(img, tone, chroma, bright) {
  const out = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  if (!tone && !chroma && !bright) return out;
  const cache = new Map(); // sprites use few distinct colours
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    if (!img.data[i + 3] || (!r && !g && !b) || (r === 255 && g === 255 && b === 255)) continue;
    const key = (r << 16) | (g << 8) | b;
    let rgb = cache.get(key);
    if (!rgb) cache.set(key, rgb = dyePixel(r, g, b, tone, chroma, bright));
    out.data[i] = rgb[0]; out.data[i + 1] = rgb[1]; out.data[i + 2] = rgb[2];
  }
  return out;
}

// Source-over blend of `src` onto `dst` with its top-left at (x, y).
export function blit(dst, src, x, y) {
  for (let sy = 0; sy < src.height; sy++) {
    const dy = y + sy;
    if (dy < 0 || dy >= dst.height) continue;
    for (let sx = 0; sx < src.width; sx++) {
      const dx = x + sx;
      if (dx < 0 || dx >= dst.width) continue;
      const si = (sy * src.width + sx) * 4, di = (dy * dst.width + dx) * 4;
      const sa = src.data[si + 3] / 255;
      if (!sa) continue;
      const da = dst.data[di + 3] / 255, oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) dst.data[di + c] = (src.data[si + c] * sa + dst.data[di + c] * da * (1 - sa)) / oa;
      dst.data[di + 3] = oa * 255;
    }
  }
}

// layers: [{ img, x, y, z }] in world coordinates. Draws in ascending z (stable).
export function composite(layers, width, height) {
  const dst = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  layers.map((l, i) => [l, i]).sort((a, b) => a[0].z - b[0].z || a[1] - b[1]).forEach(([l]) => blit(dst, l.img, l.x, l.y));
  return dst;
}
