// The Housing book: pick a home, then place furniture in it (at most MAX_PIECES per home). Furniture can be dragged anywhere in the
// home; the selected piece carries a mirror button (top left) and a remove button (top right) right on it. Data:
// public/housing/catalog.json (made by scripts/extract-housing.mjs). main.js calls into this file while the Housing book is open;
// this file does not know about the character side.
const KEY = 'maple-layers:housing-v2'; // v2: the home pictures are cropped to the house, so v1 positions would be off
export const MAX_PIECES = 16;           // the most pieces a home holds
let h;            // helpers from main.js: { el, $, iconBox, flash, refresh }
let data = null;  // the catalogue
let canvas = null, flipBtn = null, delBtn = null, countEl = null;
const st = { home: null, layouts: {}, selected: null }; // layouts: homeId -> [{ uid, id, x, y, flip }] (later = in front)
let uid = 1;

const furnitureOf = id => data.furniture.find(f => f.id === id);
const homeOf = () => data?.homes.find(x => x.id === st.home) ?? data?.homes[0];
const layout = () => (st.layouts[homeOf().id] ??= []);
const picked = () => layout().find(p => p.uid === st.selected);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const isFull = () => !!data && layout().length >= MAX_PIECES;

// ---------- saving ----------
function save() { try { localStorage.setItem(KEY, JSON.stringify({ home: st.home, layouts: Object.fromEntries(Object.entries(st.layouts).map(([k, l]) => [k, l.map(({ id, x, y, flip }) => ({ id, x, y, flip }))])) })); } catch {} }
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (!s) return;
    if (data.homes.some(x => x.id === s.home)) st.home = s.home;
    for (const [k, l] of Object.entries(s.layouts ?? {})) {
      const home = data.homes.find(x => x.id === k); if (!home) continue;
      st.layouts[k] = (Array.isArray(l) ? l : []).filter(p => furnitureOf(p.id)).slice(0, MAX_PIECES).map(p => ({ uid: uid++, id: p.id, x: clamp(Math.round(+p.x || 0), 0, home.width), y: clamp(Math.round(+p.y || 0), 0, home.height), flip: !!p.flip }));
    }
  } catch {}
}

export async function load(helpers) {
  h = helpers;
  if (data) return;
  data = await (await fetch('/housing/catalog.json')).json();
  st.home = data.homes[0].id;
  restore();
}
export const loaded = () => !!data;

// ---------- what the book shows ----------
export const tabs = () => data ? [{ key: 'homes', label: 'Homes', count: 0 }, ...data.groups.map(g => ({ key: g.id, label: g.label, count: layout().filter(p => furnitureOf(p.id)?.group === g.id).length }))] : [];
export const chapterTitle = key => key === 'homes' ? 'Homes' : data?.groups.find(g => g.id === key)?.label ?? '';
const countText = () => `${layout().length} of ${MAX_PIECES} pieces`;

export function renderContent(c, tab, matches, changed) {
  if (tab === 'homes') {
    const grid = h.el('div', { className: 'grid homes' });
    for (const home of data.homes.filter(x => matches(x.name))) {
      const img = h.el('img', { className: 'home-thumb', src: '/' + home.file, alt: '', loading: 'lazy' });
      const b = h.el('button', { className: 'card home-card', type: 'button' }, h.el('span', { className: 'art-box' }, img), h.el('span', { className: 'label', textContent: home.name }));
      b.title = home.name;
      b.setAttribute('aria-pressed', String(homeOf().id === home.id));
      b.onclick = () => { st.home = home.id; st.selected = null; save(); changed(); };
      grid.append(b);
    }
    c.append(h.el('p', { className: 'hint', textContent: `Choose a home, then open Decor, Chests or Crafting stations and click furniture to put it in. A home holds up to ${MAX_PIECES} pieces.` }), grid);
    return;
  }
  const full = isFull();
  c.append(h.el('p', { className: `hint${full ? ' full' : ''}`, textContent: full ? `This home is full (${MAX_PIECES} of ${MAX_PIECES} pieces). Remove a piece to add another.` : `${countText()} placed. A home holds up to ${MAX_PIECES}.` }));
  const grid = h.el('div', { className: 'grid' });
  for (const f of data.furniture.filter(f => f.group === tab && matches(f.name))) {
    const b = h.el('button', { className: 'card', type: 'button' }, h.iconBox(f.icon), h.el('span', { className: 'label', textContent: f.name }));
    b.title = f.desc ? `${f.name}: ${f.desc}` : f.name;
    if (full) { b.disabled = true; b.title = `${b.title}\n(This home is full: ${MAX_PIECES} pieces)`; }
    b.onclick = () => { if (add(f.id)) changed(); };
    grid.append(b);
  }
  c.append(grid);
}

// ---------- changing the layout ----------
function add(id) {
  if (isFull()) { h.flash(`This home is full: ${MAX_PIECES} pieces is the most`); return false; }
  const home = homeOf(), n = layout().length;
  const p = { uid: uid++, id, x: Math.round(home.width * 0.5 + ((n % 5) - 2) * 40), y: Math.round(home.height * 0.6), flip: false };
  layout().push(p); st.selected = p.uid; save();
  return true;
}
export function removeItem(u = st.selected) { const l = layout(), i = l.findIndex(p => p.uid === u); if (i === -1) return; l.splice(i, 1); if (st.selected === u) st.selected = null; save(); }
export function flipSelected() { const p = picked(); if (p) { p.flip = !p.flip; save(); } }
export function clearAll() { st.layouts[homeOf().id] = []; st.selected = null; save(); }
export const placedCount = () => data ? layout().length : 0;

// ---------- the left panel: what is placed ----------
export function renderPanel(c, changed) {
  c.append(h.el('h3', { textContent: `Placed in ${homeOf().name} (${layout().length}/${MAX_PIECES})` }));
  const l = layout();
  if (!l.length) return c.append(h.el('div', { className: 'empty-note', role: 'note' }, h.el('span', { className: 'empty-badge', textContent: 'i', 'aria-hidden': 'true' }), h.el('p', {}, h.el('strong', { textContent: 'Nothing placed yet.' }), ` Pick furniture from the book to add it, then drag it into place. A home holds up to ${MAX_PIECES} pieces.`)));
  const grid = h.el('div', { className: 'equipped grid' });
  [...l].reverse().forEach(p => { // front-most first
    const f = furnitureOf(p.id);
    const b = h.el('button', { className: 'card mini', type: 'button' }, h.iconBox(f.icon, 44), h.el('span', { className: 'label', textContent: f.name }));
    b.title = f.name; b.setAttribute('aria-label', f.name); b.setAttribute('aria-pressed', String(p.uid === st.selected));
    b.onclick = () => { st.selected = p.uid; changed(); };
    const x = h.el('button', { className: 'remove', type: 'button', title: `Remove ${f.name}` });
    x.setAttribute('aria-label', `Remove ${f.name}`); x.onclick = () => { removeItem(p.uid); changed(); };
    grid.append(h.el('div', { className: 'slot' }, b, x));
  });
  c.append(grid);
}

// ---------- the stage: the home with its furniture ----------
const pics = new Map();
function pic(file) {
  let i = pics.get(file);
  if (!i) { i = new Image(); i.onload = () => { i._alpha = null; draw(); }; i.src = '/' + file; pics.set(file, i); }
  return i;
}
const alphaOf = img => { // the picture's alpha channel, for clicking only on the solid parts
  if (img._alpha) return img._alpha;
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data, a = new Uint8Array(c.width * c.height);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return (img._alpha = { w: c.width, a });
};
let view = { s: 1, ox: 0, oy: 0, W: 0, H: 0 };

// The stage is sized to the home's own proportions (so the picture always fills it, with no empty space at the sides) and made as
// big as the left half allows: the left column is widened to suit, and the Placed panel under it keeps a fixed two-row height.
const narrow = matchMedia('(max-width: 800px)'); // the one-column phone layout
function sizeStage() {
  const stage = h.$('stage'), home = homeOf(), app = stage.closest('.app'), side = stage.parentElement;
  const aspect = home.width / home.height;
  let W, H;
  if (narrow.matches) {
    app.style.removeProperty('--left');
    W = Math.min(app.clientWidth - 20, Math.floor(window.innerHeight * 0.46 * aspect)); H = Math.round(W / aspect);
  } else {
    const cs = getComputedStyle(side), padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const gap = parseFloat(cs.rowGap) || 0, availH = side.clientHeight - padY - h.$('colour').offsetHeight - gap;
    const idealW = Math.floor(availH * aspect), inner = app.clientWidth - 26;
    app.style.setProperty('--left', `${Math.round(Math.min(inner * 0.72, Math.max(inner * 0.5, idealW + padX)))}px`); // the catalogue gets the rest
    W = Math.min(side.clientWidth - padX, idealW); H = Math.round(W / aspect);
  }
  stage.style.width = `${W}px`; stage.style.height = `${H}px`;
}
const resetStageSize = () => { const stage = h.$('stage'); stage.style.width = stage.style.height = ''; stage.closest('.app').style.removeProperty('--left'); };
function fit() {
  sizeStage();
  const stage = h.$('stage'), home = homeOf();
  const W = stage.clientWidth - 2, H = stage.clientHeight - 2;
  const s = Math.max(W / home.width, H / home.height); // the same shape, so this fills the stage exactly
  view = { s, ox: (W - home.width * s) / 2, oy: (H - home.height * s) / 2, W, H };
}
const SVG = d => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export function renderStage() {
  if (!data) return;
  const stage = h.$('stage');
  if (!canvas) {
    canvas = h.el('canvas', { id: 'housing', tabIndex: 0 });
    canvas.setAttribute('aria-label', `Home. Drag furniture to move it. Arrow keys nudge the selected piece, F mirrors it, Delete removes it.`);
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('keydown', key);
    // Mirror (top left) and remove (top right) sit on the selected piece itself.
    flipBtn = h.el('button', { className: 'item-btn item-flip', type: 'button', title: 'Mirror this piece' }); flipBtn.setAttribute('aria-label', 'Mirror this piece');
    flipBtn.innerHTML = SVG('<path d="m3 7 5 5-5 5V7"/><path d="m21 7-5 5 5 5V7"/><path d="M12 20v2M12 14v2M12 8v2M12 2v2"/>'); // Lucide "flip-horizontal-2" (ISC licence)
    delBtn = h.el('button', { className: 'item-btn item-del', type: 'button', title: 'Take this piece out of the home' }); delBtn.setAttribute('aria-label', 'Remove this piece from the home');
    delBtn.innerHTML = SVG('<path d="M6 6l12 12M18 6L6 18"/>');
    for (const b of [flipBtn, delBtn]) b.addEventListener('pointerdown', e => e.stopPropagation());
    flipBtn.onclick = () => { flipSelected(); draw(); h.refresh(); canvas.focus(); };
    delBtn.onclick = () => { removeItem(); draw(); h.refresh(); canvas.focus(); };
    countEl = h.el('span', { className: 'house-count', role: 'status' });
    stage.append(canvas, flipBtn, delBtn, countEl);
  }
  draw();
}
export const hideStage = () => { for (const e of [canvas, flipBtn, delBtn, countEl]) if (e) e.style.display = 'none'; if (data) resetStageSize(); };
export const showStage = () => { for (const e of [canvas, flipBtn, delBtn, countEl]) if (e) e.style.display = ''; draw(); };

const bounds = (p, f) => { const a = f.art; return { left: p.flip ? p.x - (a.w - a.ox) : p.x - a.ox, top: p.y - a.oy, w: a.w, h: a.h }; };
export function draw() {
  if (!canvas || !data) return;
  fit();
  const d = window.devicePixelRatio || 1, home = homeOf();
  canvas.width = Math.round(view.W * d); canvas.height = Math.round(view.H * d);
  canvas.style.width = `${view.W}px`; canvas.style.height = `${view.H}px`;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.setTransform(d * view.s, 0, 0, d * view.s, d * view.ox, d * view.oy);
  const base = pic(home.file); if (base.complete && base.naturalWidth) g.drawImage(base, 0, 0, home.width, home.height);
  for (const p of layout()) {
    const f = furnitureOf(p.id), img = pic(f.art.file); if (!img.complete || !img.naturalWidth) continue;
    g.save(); g.translate(p.x, p.y); if (p.flip) g.scale(-1, 1); g.drawImage(img, -f.art.ox, -f.art.oy); g.restore();
  }
  const p = picked();
  if (p) { // a dashed frame around the selected piece
    const b = bounds(p, furnitureOf(p.id)); g.lineWidth = 2 / view.s; g.setLineDash([6 / view.s, 4 / view.s]); g.strokeStyle = '#ff8a1c'; g.strokeRect(b.left - 2, b.top - 2, b.w + 4, b.h + 4); g.setLineDash([]);
  }
  countEl.textContent = `${layout().length}/${MAX_PIECES} pieces`; countEl.classList.toggle('full', isFull());
  placeButtons(p);
}

// The two buttons ride on the selected piece's top corners (mirror left, remove right), kept inside the stage and apart from each other.
function placeButtons(p) {
  const on = !!p && !!flipBtn;
  if (!flipBtn) return;
  flipBtn.hidden = delBtn.hidden = !on;
  if (!on) return;
  const b = bounds(p, furnitureOf(p.id)), S = 22;
  const left = 1 + view.ox + b.left * view.s, right = 1 + view.ox + (b.left + b.w) * view.s, top = 1 + view.oy + b.top * view.s;
  const lx = clamp(left, S / 2 + 2, view.W - S * 1.5 - 4), rx = clamp(Math.max(right, lx + S + 2), S * 1.5 + 4, view.W - S / 2 - 2), ty = clamp(top, S / 2 + 2, view.H);
  flipBtn.style.left = `${Math.round(lx - S / 2)}px`; flipBtn.style.top = `${Math.round(ty - S / 2)}px`;
  delBtn.style.left = `${Math.round(rx - S / 2)}px`; delBtn.style.top = `${Math.round(ty - S / 2)}px`;
}

// ---------- mouse, touch and keys ----------
let drag = null;
const toHome = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left - view.ox) / view.s, (e.clientY - r.top - view.oy) / view.s]; };
function hit(hx, hy) { // front-most piece with a solid pixel under the point
  const l = layout();
  for (let i = l.length - 1; i >= 0; i--) {
    const p = l[i], f = furnitureOf(p.id), img = pic(f.art.file); if (!img.complete || !img.naturalWidth) continue;
    const col = Math.floor(p.flip ? p.x - hx + f.art.ox : hx - p.x + f.art.ox), row = Math.floor(hy - p.y + f.art.oy);
    if (col < 0 || row < 0 || col >= f.art.w || row >= f.art.h) continue;
    if (alphaOf(img).a[row * f.art.w + col] > 12) return p;
  }
  return null;
}
function down(e) {
  canvas.focus();
  const [hx, hy] = toHome(e), p = hit(hx, hy);
  if (!p) { if (st.selected != null) { st.selected = null; draw(); h.refresh(); } return; }
  st.selected = p.uid;
  const l = layout(); l.push(l.splice(l.indexOf(p), 1)[0]); // the piece you pick up comes to the front
  drag = { p, dx: p.x - hx, dy: p.y - hy };
  canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging'); draw();
}
function move(e) {
  if (!drag) { const [hx, hy] = toHome(e); canvas.style.cursor = hit(hx, hy) ? 'grab' : 'default'; return; }
  const [hx, hy] = toHome(e), home = homeOf();
  drag.p.x = Math.round(clamp(hx + drag.dx, 0, home.width)); drag.p.y = Math.round(clamp(hy + drag.dy, 0, home.height)); draw();
}
function up() { if (!drag) return; drag = null; canvas.classList.remove('dragging'); save(); h.refresh(); }
function key(e) {
  const p = picked(); if (!p) return;
  const step = e.shiftKey ? 10 : 1, home = homeOf();
  const nudge = (dx, dy) => { p.x = clamp(p.x + dx, 0, home.width); p.y = clamp(p.y + dy, 0, home.height); };
  if (e.key === 'ArrowLeft') nudge(-step, 0); else if (e.key === 'ArrowRight') nudge(step, 0); else if (e.key === 'ArrowUp') nudge(0, -step); else if (e.key === 'ArrowDown') nudge(0, step);
  else if (e.key === 'f' || e.key === 'F') flipSelected();
  else if (e.key === 'Delete' || e.key === 'Backspace') removeItem();
  else return;
  e.preventDefault(); save(); draw(); h.refresh();
}
