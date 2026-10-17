// Checks the dye maths on single pixels. Run: node scripts/colour-check.mjs
import { adjustColour } from '../src/compose.js';

const px = (r, g, b, a = 255) => ({ width: 1, height: 1, data: new Uint8ClampedArray([r, g, b, a]) });
const go = (rgb, tone, chroma, bright) => [...adjustColour(px(...rgb), tone, chroma, bright).data].slice(0, 3);
const hueOf = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
const sat = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 510; return mx === mn ? 0 : (mx - mn) / 255 / (1 - Math.abs(2 * l - 1)); };
const lum = ([r, g, b]) => (r + g + b) / 3;

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const eq = (a, b) => a.join() === b.join();

const muted = [153, 102, 102], teal = [34, 170, 153];
check('all zero leaves a colour unchanged', eq(go(teal, 0, 0, 0), teal));
check('black outlines never change (brightness +60, tone, chroma)', eq(go([0, 0, 0], 120, 50, 60), [0, 0, 0]));
check('pure white never changes (brightness -60, tone, chroma)', eq(go([255, 255, 255], 120, -50, -60), [255, 255, 255]));
check('transparent pixels are left alone', adjustColour(px(10, 20, 30, 0), 90, 0, 0).data.join() === '10,20,30,0');
const turned = go([255, 0, 0], 120, 0, 0);
check('tone 120 turns red to green', hueOf(turned) === 120, turned.join());
check('tone is a full circle: 359 is almost back where it started', Math.abs(((hueOf(go([255, 0, 0], 359, 0, 0)) + 180) % 360) - 180) <= 2);
check('chroma -99 leaves an almost grey colour', sat(go(muted, 0, -99, 0)) < 0.05, go(muted, 0, -99, 0).join());
check('chroma +50 makes a muted colour more vivid', sat(go(muted, 0, 50, 0)) > sat(muted));
check('brightness +50 lightens', lum(go(muted, 0, 0, 50)) > lum(muted));
check('brightness -50 darkens', lum(go(muted, 0, 0, -50)) < lum(muted));
check('brightness +99 gets very light (palette colours stop at 238, as in the game)', lum(go(muted, 0, 0, 99)) > 200, go(muted, 0, 0, 99).join());
check('colours on the 17-step palette stay on it', go(teal, 77, -20, 30).every(v => v % 17 === 0), go(teal, 77, -20, 30).join());
check('a colour off the palette is not forced onto it', !go([151, 103, 101], 0, 0, 20).every(v => v % 17 === 0));
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
