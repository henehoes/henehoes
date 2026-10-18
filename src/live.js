// Datamine styles are not stored in the project: their sprites are fetched from maplestory.io the first time they are needed
// (a card scrolling into view, or the style being worn), turned into the same positioned parts the stored styles have, and kept
// in memory. Released styles never come through here.

let cfg = null;
export const configureLive = c => { cfg = c; };

const API = 'https://maplestory.io/api/GMS';
const queue = [];
let running = 0;
const MAX_AT_ONCE = 4; // be polite to the API: a full list would otherwise fire a hundred requests together
function limited(task) {
  return new Promise((resolve, reject) => {
    queue.push(() => task().then(resolve, reject).finally(() => { running--; next(); }));
    next();
  });
}
function next() { while (running < MAX_AT_ONCE && queue.length) { running++; queue.shift()(); } }

// The same choice scripts/download.mjs makes: the standing pose, or the two-handed pose for stand2.
const frameOf = (book, kind, stance) => {
  const b = kind === 'face' ? book.default : stance ? (book[stance] ?? book.stand1 ?? book.default) : (book.stand1 ?? book.stand2 ?? book.default);
  return b?.frames?.[0]?.effects ?? {};
};

// Same placement as scripts/build-catalog.mjs `partsOf`: anchor point minus the part's origin and map offset.
function partsFrom(effects, anchors) {
  const out = [];
  for (const leaf of Object.values(effects)) {
    if (!leaf?.image) continue;
    const map = cfg.priority.find(m => leaf.mapOffset?.[m]);
    if (!map) continue;
    const v = leaf.mapOffset[map], position = leaf.position;
    const zi = cfg.zmap.indexOf(cfg.zFallback[position] ?? position);
    out.push({
      file: `data:image/png;base64,${leaf.image}`, layer: position,
      x: anchors[map][0] - leaf.origin.x - v.x, y: anchors[map][1] - leaf.origin.y - v.y,
      z: zi === -1 ? 74.6 : zi, ...(cfg.partHiddenBy[position] && { hiddenBy: cfg.partHiddenBy[position] }),
    });
  }
  return out;
}

// Makes sure a colour variant has its parts, fetching them if it is a datamine one. Resolves true when it can be drawn.
export function ensureParts(variant, kind) {
  if (variant.parts) return Promise.resolve(true);
  if (!variant.live || !cfg) return Promise.resolve(false);
  if (variant.loading) return variant.loading;
  variant.loading = limited(async () => {
    const res = await fetch(`${API}/${variant.version}/item/${variant.id}`);
    if (!res.ok) throw new Error(`${res.status}`);
    const book = (await res.json()).frameBooks ?? {};
    variant.parts = partsFrom(frameOf(book, kind), cfg.anchors);
    variant.parts2 = partsFrom(frameOf(book, kind, 'stand2'), cfg.anchors2);
    return variant.parts.length > 0;
  }).catch(err => { variant.failed = String(err.message ?? err); variant.loading = null; return false; });
  return variant.loading;
}
