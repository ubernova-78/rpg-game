// Tuning sweep for the Sail Race (run: jsc tests/sweep_sail.js from the repo root).
// Every reasonable parametric boat through sailAnalyze; counts passes and why the
// rest fail. Re-run before changing anything in SAIL.
load('game/sail-physics.js');
const R = (a, b, s) => { const o = []; for (let x = a; x <= b + 1e-9; x += s) o.push(+x.toFixed(3)); return o; };
function split(pts) { // break any side longer than a stick into equal pieces
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / SAIL.STICK_L - 1e-9);
    for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}
const segsOf = h => h.slice(1).map((p, i) => ({ a: h[i], b: p }));
const shapes = [];
for (const B of R(0.5, 1.5, 0.25)) for (const D of R(0.25, 0.75, 0.25)) {
  shapes.push({ k: 'box', B, D, pts: [[-B / 2, D], [-B / 2, 0], [B / 2, 0], [B / 2, D]] });
  shapes.push({ k: 'V', B, D, pts: [[-B / 2, D], [0, 0], [B / 2, D]] });
  for (const w of [0.25, 0.5]) shapes.push({ k: 'Vwall', B, D, w, pts: [[-B / 2, D + w], [-B / 2, D], [0, 0], [B / 2, D], [B / 2, D + w]] });
  for (const k of [0.2, 0.3]) for (const kw of [0.2, 0.4]) shapes.push({ k: 'keel', B, D, pts: [[-B / 2, D + k], [-B / 2, k], [-kw / 2, k], [0, 0], [kw / 2, k], [B / 2, k], [B / 2, D + k]] });
  for (const b of R(0.25, B - 0.25, 0.25)) shapes.push({ k: 'flare', B, D, b, pts: [[-B / 2, D], [-b / 2, 0], [b / 2, 0], [B / 2, D]] });
}
const sails = [];
for (const w of [1.0, 1.5, 2.16]) for (const h of [1.0, 1.5, 2.0, 2.79]) sails.push({ w, h, shape: 'rect' });
const tally = {}, passes = [], byKind = {};
let n = 0;
function run(d, tag) {
  const r = sailAnalyze(d); n++;
  tally[r.fail || 'PASS'] = (tally[r.fail || 'PASS'] || 0) + 1;
  byKind[tag] = byKind[tag] || { n: 0, pass: 0 }; byKind[tag].n++;
  if (r.ok) { byKind[tag].pass++; passes.push({ tag, r, d }); }
  return r;
}
for (const sh of shapes) {
  const pts = split(sh.pts), low = lowest(pts);
  for (const L of R(1.0, 3.0, 0.25)) for (const bow of ['square', 'pointed']) for (const sail of sails) {
    run({ segs: segsOf(pts), hulls: [pts], L, bow, sail, mastFoot: [0, low[1]], }, sh.k);
    // catamaran: two narrower copies with a beam across the inner gunwales
    if (sh.B <= 0.75) for (const S of [1.0, 1.5, 2.0]) {
      const off = (p, dx) => p.map(q => [q[0] + dx, q[1]]);
      const h1 = off(pts, -S / 2), h2 = off(pts, S / 2);
      const top = h1[h1.length - 1][1], beam = split([[h1[h1.length - 1][0], top], [h2[0][0], top]]);
      const segs = segsOf(h1).concat(segsOf(h2), segsOf(beam));
      run({ segs, hulls: [h1, h2], L, bow, sail, mastFoot: [0, top], }, 'cat-' + sh.k);
    }
  }
}
print('designs', n, JSON.stringify(tally));
for (const k in byKind) print(k.padEnd(12), byKind[k].pass + '/' + byKind[k].n);
const singles = passes.filter(p => p.d.hulls.length === 1);
print('single-hull passes', singles.length);
const fast = singles.sort((a, b) => b.r.speedKt - a.r.speedKt).slice(0, 8);
for (const p of fast) print(p.tag, 'B', p.d.hulls[0].slice(-1)[0][0] * 2, 'L', p.d.L, p.d.bow, 'sail', p.d.sail.w + 'x' + p.d.sail.h, 'kt', p.r.speedKt.toFixed(2), 'sticks', p.r.sticks, 'heel', p.r.heelDeg.toFixed(1) + '/' + p.r.floodDeg.toFixed(1), 'dip', p.r.bowDip.toFixed(2) + '/' + p.r.freeboard.toFixed(2));
// a few reference boats
function show(lbl, d) { const r = sailAnalyze(d); print(lbl, r.fail || 'PASS', 'kt', (r.speedKt || 0).toFixed(2), 'M', r.mass.toFixed(0), 'T', (r.draft||0).toFixed(3), 'fb', (r.freeboard||0).toFixed(2), 'GMT', (r.GMT||0).toFixed(2), 'heel', (r.heelDeg||0).toFixed(1) + '/' + (r.floodDeg||0).toFixed(1), 'dip', (r.bowDip||0).toFixed(3), 'sticks', r.sticks, r.problems.join(' ')); }
const box = [[-0.4, 0.5], [-0.4, 0], [0.4, 0], [0.4, 0.5]];
show('box .8x.5 L2.5 pointed fullsail', { segs: segsOf(box), hulls: [box], L: 2.5, bow: 'pointed', sail: { w: 2.16, h: 2.79, shape: 'rect' }, mastFoot: [0, 0] });
show('box .8x.5 L1.5 pointed fullsail', { segs: segsOf(box), hulls: [box], L: 1.5, bow: 'pointed', sail: { w: 2.16, h: 2.79, shape: 'rect' }, mastFoot: [0, 0] });
// why each kind fails, and how the sail size plays out
const why = {};
for (const sh of shapes) { const pts = split(sh.pts), low = lowest(pts);
  for (const L of [2.0, 2.5]) for (const sail of sails) { const r = sailAnalyze({ segs: segsOf(pts), hulls: [pts], L, bow: 'pointed', sail, mastFoot: [0, low[1]], });
    const k = sh.k + ' ' + (r.fail || 'PASS'); why[k] = (why[k] || 0) + 1; } }
print(JSON.stringify(why));
const bySail = {};
for (const p of passes) { const k = p.d.sail.w + 'x' + p.d.sail.h; bySail[k] = (bySail[k] || 0) + 1; }
print('passes by sail', JSON.stringify(bySail));
const catS = passes.filter(p => p.d.hulls.length === 2).map(p => p.r.sticks);
print('cat sticks min/max', Math.min(...catS), Math.max(...catS));
const v1 = [[-0.5, 0.5], [0, 0], [0.5, 0.5]];
show('V 1x.5 L2.5', { segs: segsOf(v1), hulls: [v1], L: 2.5, bow: 'pointed', sail: { w: 2.16, h: 2.0, shape: 'rect' }, mastFoot: [0, 0] });

const shapePass = {}, shapeAll = {};
for (const p of passes) { const k = p.tag + JSON.stringify(p.d.hulls[0]); shapePass[k] = 1; }
print('distinct passing shapes (single, cat):', Object.keys(shapePass).filter(k => !k.startsWith('cat')).length, Object.keys(shapePass).filter(k => k.startsWith('cat')).length, 'of shapes', shapes.length);
const sens = { n: 0, pass: 0 };
for (const sh of shapes) { const pts = split(sh.pts), low = lowest(pts);
  for (const L of [2.0, 2.25, 2.5, 2.75]) for (const sail of sails.filter(s => s.w * s.h >= 3)) { const r = sailAnalyze({ segs: segsOf(pts), hulls: [pts], L, bow: 'pointed', sail, mastFoot: [0, low[1]] });
    if (r.fail === 'rules') continue; sens.n++; if (r.ok) sens.pass++; } }
print('sensible single hulls (pointed, L 2-2.75, sail >= 3 m2, legal):', sens.pass + '/' + sens.n);
