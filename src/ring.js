// Name tag rings. The game builds a name tag from three small pieces stretched to fit the name: a left end (w), a one-pixel-or-wider
// middle (c) repeated to the text width, and a right end (e). Every piece has an origin (ox, oy): the point that sits on the layout
// line. A ring with no pieces (White Label Ring) is a plain box the client draws itself. Chat bubbles are not built here: they are the
// game's own finished sample pictures (see main.js).
//
// `pieces` maps a piece name to { cv, w, h, ox, oy }: cv is a canvas holding the piece, w/h its size, ox/oy its origin.
// Each draw function returns { canvas, ax, ay }: the finished picture and where its anchor point is inside it.

// The game's own text font: the client embeds Noto Sans KR Medium (UI/Font/Font_000.wz) for English. Loaded from @fontsource/noto-sans-kr.
const FONT = '500 11px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
// Canvas text needs the font to be loaded first: call this (it is quick once loaded) before measuring or drawing text.
export const loadFont = text => document.fonts.load(FONT, text || 'Ag').catch(() => {});
const measure = document.createElement('canvas').getContext('2d');
const textWidth = text => { measure.font = FONT; return Math.ceil(measure.measureText(text).width); };

const newCanvas = (w, h) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w)); canvas.height = Math.max(1, Math.ceil(h));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
};

// Repeats `p` along x from `from` to `to`; the last copy is cut short so it does not overshoot.
function tileX(ctx, p, from, to, y) {
  for (let x = from; x < to; x += p.w) {
    const room = to - x;
    if (room >= p.w) ctx.drawImage(p.cv, Math.floor(x), Math.floor(y));
    else ctx.drawImage(p.cv, 0, 0, room, p.h, Math.floor(x), Math.floor(y), room, p.h);
  }
}

function drawText(ctx, text, colour, x, y) {
  ctx.font = FONT; ctx.fillStyle = colour; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

// The box the client draws itself for a ring with no pieces (the White Label Ring): `look` is { edge, fill, fillAlpha, text, h }, read
// from the ring's sample picture. As in the sample, the one-pixel edge is solid, the inside is translucent (fillAlpha, about 73%) and
// the four corner pixels are left clear.
export function drawPlainTag(text, look) {
  const w = Math.max(30, textWidth(text) + 8), h = look.h;
  const { canvas, ctx } = newCanvas(w, h);
  ctx.fillStyle = look.edge;
  ctx.fillRect(1, 0, w - 2, 1); ctx.fillRect(1, h - 1, w - 2, 1); ctx.fillRect(0, 1, 1, h - 2); ctx.fillRect(w - 1, 1, 1, h - 2);
  const k = parseInt(look.fill.slice(1), 16);
  ctx.fillStyle = `rgba(${k >> 16 & 255}, ${k >> 8 & 255}, ${k & 255}, ${look.fillAlpha ?? 1})`; ctx.fillRect(1, 1, w - 2, h - 2);
  drawText(ctx, text, look.text, w / 2, h / 2 + 1);
  return { canvas, ax: w / 2, ay: 0 };
}

// `pad`, when given (tags cut from a sample picture), is the space kept either side of the text; the game's own pieces have it built in
// and stretch in whole repeats of the middle piece instead.
export function drawNameTag(pieces, colour, text, pad) {
  const { w, c, e } = pieces;
  const wide = pad != null ? textWidth(text) + 2 * pad : textWidth(text);
  const width = Math.max(c.w, Math.ceil(wide / c.w) * c.w); // the middle is repeated, so the width is a multiple of it
  const top = Math.max(w.oy, c.oy, e.oy);                    // rows above the layout line
  const left = w.ox;                                         // where the text area starts
  const right = left + width;
  const height = Math.max(...[w, c, e].map(p => top - p.oy + p.h));
  const { canvas, ctx } = newCanvas(right - e.ox + e.w, height);
  ctx.drawImage(w.cv, 0, top - w.oy);
  tileX(ctx, c, left, right, top - c.oy);
  ctx.drawImage(e.cv, Math.floor(right - e.ox), Math.floor(top - e.oy));
  // the text sits in the middle of the strip: for a tag cut from a sample picture that is where the middle piece's opaque rows are (textY)
  if (text) drawText(ctx, text, colour, left + width / 2, top - c.oy + (c.textY ?? c.h / 2) + 1);
  return { canvas, ax: left + width / 2, ay: top };
}
