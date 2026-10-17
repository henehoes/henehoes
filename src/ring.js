// Name tag and chat bubble rings. The game does not use a picture for these: it builds them from a few small UI
// pieces, stretched to fit the text. A name tag is a left end (w), a one-pixel-wide middle (c) repeated to the text
// width, and a right end (e). A chat bubble is a nine-piece frame (nw n ne / w c e / sw s se) plus an arrow (and
// sometimes a head piece on the top edge). Every piece has an origin: the point that sits on the layout line.
//
// `pieces` maps a piece name to { cv, w, h, ox, oy }: cv is a canvas holding the piece, w/h its size, ox/oy its origin.
// Each draw function returns { canvas, ax, ay }: the finished picture and where its anchor point is inside it.

const FONT = '12px Dotum, "Apple SD Gothic Neo", "Malgun Gothic", "NEXON Lv1 Gothic OTF", sans-serif';
const TAG_FONT = FONT.replace('12px', '11px'); // name labels use a smaller type than chat bubbles
const measure = document.createElement('canvas').getContext('2d');
const textWidth = (text, font = FONT) => { measure.font = font; return Math.ceil(measure.measureText(text).width); };

// Breaks a line anywhere it overflows, as the game does (no word boundaries), and keeps blank lines.
function wrap(text, maxWidth) {
  measure.font = FONT;
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = '';
    for (const ch of raw) {
      if (measure.measureText(line + ch).width <= maxWidth) line += ch;
      else if (line) { lines.push(line); line = ch; }
      else lines.push(ch);
    }
    if (line || !raw) lines.push(line);
  }
  return lines;
}

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

function drawText(ctx, text, colour, x, y, font = FONT) {
  ctx.font = font; ctx.fillStyle = colour; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

// The label the client draws itself when a ring has no pieces (White Label Ring): a white box with a thin blue edge.
export function drawPlainTag(text) {
  const w = Math.max(30, textWidth(text, TAG_FONT) + 8), h = 14;
  const { canvas, ctx } = newCanvas(w, h);
  ctx.fillStyle = '#2288aa'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.73)'; ctx.fillRect(1, 1, w - 2, h - 2);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(2, 2, w - 4, h - 4);
  drawText(ctx, text, '#000000', w / 2, h / 2 + 1, TAG_FONT);
  return { canvas, ax: w / 2, ay: 0 };
}

export function drawNameTag(pieces, colour, text) {
  const { w, c, e } = pieces;
  const width = Math.max(c.w, Math.ceil(textWidth(text, TAG_FONT) / c.w) * c.w); // the middle is repeated, so the width is a multiple of it
  const top = Math.max(w.oy, c.oy, e.oy);                                // rows above the layout line
  const left = w.ox;                                                     // where the text area starts
  const right = left + width;
  const height = Math.max(...[w, c, e].map(p => top - p.oy + p.h));
  const { canvas, ctx } = newCanvas(right - e.ox + e.w, height);
  ctx.drawImage(w.cv, 0, top - w.oy);
  tileX(ctx, c, left, right, top - c.oy);
  ctx.drawImage(e.cv, Math.floor(right - e.ox), Math.floor(top - e.oy));
  if (text) drawText(ctx, text, colour, left + width / 2, top - c.oy + c.h / 2 + 1, TAG_FONT);
  return { canvas, ax: left + width / 2, ay: top };
}

export function drawBalloon(pieces, colour, text) {
  const { nw, n, ne, w, c, e, sw, s, se } = pieces;
  const head = pieces.head ?? null;
  const arrow = pieces.arrow ?? null;
  const lineH = c.h;
  // The frame is always three repeats of an edge piece plus the arrow (or head) wide; long text wraps onto more lines.
  const edge = head ? n.w : s.w;
  const notch = head ? head.w : (arrow ?? s).w;
  const inner = edge * 2 * 3 + notch;
  const lines = wrap(text, inner);
  const rows = Math.max(1, lines.length);
  const half = inner / 2;

  const all = [nw, n, head, ne, w, c, e, sw, s, arrow, se].filter(Boolean);
  const above = Math.max(...all.map(p => p.oy));
  const below = Math.max(...all.map(p => p.h - p.oy));
  const overhang = Math.max(Math.abs(nw.ox), Math.abs(w.ox), Math.abs(sw.ox));
  const spill = Math.max(ne.w - ne.ox, e.w - e.ox, se.w - se.ox);
  const width = inner + overhang + spill;
  const height = lineH * rows + below + above;
  const { canvas, ctx } = newCanvas(width, height);
  const cx = overhang + half;
  const L = cx - half, R = cx + half;       // inside left and right edge
  let y = above;                            // layout line of the row being drawn

  const put = (p, x, yy) => ctx.drawImage(p.cv, Math.floor(x), Math.floor(yy));
  put(nw, L - nw.ox, y - nw.oy);
  const topFrom = L - nw.ox + nw.w, topTo = R - ne.ox;
  if (head) {
    tileX(ctx, n, topFrom, cx - head.w / 2, y - n.oy);
    tileX(ctx, n, cx + head.w / 2, topTo, y - n.oy);
    put(head, cx - head.w / 2, y - head.oy);
  } else tileX(ctx, n, topFrom, topTo, y - n.oy);
  put(ne, R - ne.ox, y - ne.oy);
  for (let i = 0; i < rows; i++) {
    put(w, L - w.ox, y - w.oy);
    tileX(ctx, c, L - w.ox + w.w, R - e.ox, y - c.oy);
    put(e, R - e.ox, y - e.oy);
    y += lineH;
  }
  put(sw, L - sw.ox, y - sw.oy);
  if (arrow) {
    tileX(ctx, s, L, cx - arrow.w / 2, y - s.oy);
    put(arrow, cx - arrow.w / 2, y - arrow.oy);
    tileX(ctx, s, cx + arrow.w / 2, R - se.ox, y - s.oy);
  } else {
    for (let x = L; x < R; x += s.w) put(s, x, y - s.oy);
  }
  put(se, R - se.ox, y - se.oy);

  const step = rows > 1 ? lineH : 16;
  const first = above + (lineH * rows - lines.length * step) / 2;
  lines.forEach((line, i) => drawText(ctx, line, colour, cx, first + i * step + step / 2 + 1));
  return { canvas, ax: cx, ay: height };
}
