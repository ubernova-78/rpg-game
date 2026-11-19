// sail-physics.js — the Sail Race's physics (Nick, 2026-11-18). Shared by
// sail-builder.html and the tuning sweep (tests/sweep_sail.js), so both run the
// same numbers.
//
// Scale: the classroom build at 10x length, 1000x mass, like the first Boat
// Builder. A popsicle stick (113 x 9.7 x 2.1 mm) is 1.13 m x 9.7 cm x 2.1 cm and
// 1.38 kg; a foil sheet (12" x 10.75") is 3.05 x 2.73 m; the 8.5x11 sail is
// 2.16 x 2.79 m of cloth; a 5 g marble is a 5 kg stone.
//
// The boat: one or two hulls, each a cross-section drawn as sticks (x across,
// y up, meters) and run L meters long. Everything is in one section frame, so
// the waterline T is a y value. A pointed bow tapers the front TAPER of the hull
// to nothing in plan view.
//
// The run: 20 kt of wind dead astern. The sail is a drag sail,
// F = 1/2 rho_air Cd A (Vw - v)^2, against skin friction (ITTC-57) plus a wave
// drag that climbs past hull speed. Three ways to lose:
//   slow   the boat's top speed is under the serpent's 6 kt
//   bow    a 30 kt gust's push pitches the bow down until it's under (bow dive)
//   roll   the serpent's waves heel it past the point its rail goes under
// plus 'sinks' (no freeboard at the dock) and 'capsize' (GM <= 0 at rest).

const SAIL = {
  STICK_L: 1.13, STICK_W: 0.097, STICK_T: 0.021, STICK_KG: 1.38, STICKS: 70,
  SPLICE: 0.15,             // overlap when two sticks are glued end to end
  SHEET_A: 3.05, SHEET_B: 2.73, SKIN_KG_M2: 0.43, SKINS: 2, // foil 3.6 kg a sheet
  SAIL_W: 2.16, SAIL_H: 2.79, CLOTH_KG_M2: 0.8, CLOTHS: 2, MASTS: 4, // two sheets of cloth (two sheets of paper in class), up to 4 masts
  RIDER_KG: 60, RIDER_SIT: 0.25, HIPS: 0.5, // the rider needs 50 cm of room to sit
  STONES: 6, STONE_KG: 5, STONE_R: 0.08,
  RIB_GAP: 1.0,             // ribs at least every 1 m along the hull
  TAPER: 0.35,              // a pointed bow tapers the front 35% of the length
  MAST_GAP: 0.5,            // the sail's foot sits this far up the mast (over the rider's head)
  WIND_KT: 20, GUST_KT: 30, MONSTER_KT: 6, KT: 0.5144,
  RHO_AIR: 1.225, CD_SAIL: 1.2, RHO_W: 1000, NU: 1.0e-6, G: 9.81,
  FORM: 1.2,                // friction form factor
  KW: 7, FN0: 0.45, SQUARE_BOW: 2.0, // wave drag: KW rho g Ax^2 / L * h(Fn)
  WAVE_NM: 200,             // the serpent's waves: a heeling moment, the same for every boat
};

// ---------- section geometry ----------
const sLen = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// A hull chain (gunwale to gunwale) closed across the top, clipped to y <= T.
function clipBelow(pts, T) {
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], ain = a[1] <= T, bin = b[1] <= T;
    if (ain) out.push(a);
    if (ain !== bin) { const t = (T - a[1]) / (b[1] - a[1]); out.push([a[0] + t * (b[0] - a[0]), T]); }
  }
  return out;
}
function polyArea(p) { // signed area and centroid
  let A = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = a[0] * b[1] - b[0] * a[1];
    A += c; cx += (a[0] + b[0]) * c; cy += (a[1] + b[1]) * c;
  }
  A /= 2;
  return A ? { A: Math.abs(A), cx: cx / (6 * A), cy: cy / (6 * A) } : { A: 0, cx: 0, cy: 0 };
}
// Where the chain crosses y = T: the waterline's left and right ends.
function waterline(pts, T) {
  const xs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if ((a[1] - T) * (b[1] - T) <= 0 && a[1] !== b[1]) xs.push(a[0] + (T - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
    else if (a[1] === T && b[1] === T) xs.push(a[0], b[0]);
  }
  if (xs.length < 2) return null;
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return { B: hi - lo, xc: (hi + lo) / 2 };
}
function wettedGirth(pts, T) {
  let g = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    let a = pts[i], b = pts[i + 1];
    if (a[1] > T && b[1] > T) continue;
    if (a[1] > T || b[1] > T) { if (a[1] > T) [a, b] = [b, a]; const t = (T - a[1]) / (b[1] - a[1]); b = [a[0] + t * (b[0] - a[0]), T]; }
    g += sLen(a, b);
  }
  return g;
}
const girth = pts => pts.slice(1).reduce((g, p, i) => g + sLen(pts[i], p), 0);
const lowest = pts => pts.reduce((m, p) => p[1] < m[1] ? p : m, pts[0]);

// Plan-view taper integrals: s(z) is the width scale along the hull.
function taper(bow) {
  if (bow !== 'pointed') return { c1: 1, c3: 1 };
  const t = SAIL.TAPER;
  return { c1: 1 - t / 2, c3: 1 - t + t / 4 };
}
// Waterplane inertia about a midship line, and the longitudinal one about the
// center of flotation, integrated in slices.
function longInertia(B, L, bow) {
  const N = 40, t = SAIL.TAPER; let A = 0, M = 0;
  const sl = [];
  for (let i = 0; i < N; i++) {
    const z = (i + 0.5) / N * L, f = z / L; // stern at 0, bow at L
    const s = bow === 'pointed' ? Math.min(1, (1 - f) / t) : 1;
    sl.push([z, s * B * L / N]); A += s * B * L / N; M += s * B * L / N * z;
  }
  const zf = M / A; let I = 0;
  for (const [z, a] of sl) I += a * (z - zf) * (z - zf);
  return I;
}

// ---------- sticks: count by cutting pieces from whole sticks ----------
// Every section stick is repeated at every rib; every hull vertex carries a
// stringer the hull's length (spliced); the mast is spliced to its height.
function ribCount(L) { return Math.max(2, Math.ceil(L / SAIL.RIB_GAP - 1e-9) + 1); }
function splicedPieces(len) { // pieces for one long member
  const S = SAIL.STICK_L, out = [];
  if (len <= S + 1e-9) return [len];
  let left = len;
  out.push(S); left -= S;
  while (left > 1e-9) { const p = Math.min(S, left + SAIL.SPLICE); out.push(p); left -= p - SAIL.SPLICE; }
  return out;
}
function packSticks(pieces) { // first-fit decreasing: whole sticks used
  const bins = [];
  for (const p of pieces.slice().sort((a, b) => b - a)) {
    const k = bins.findIndex(r => r >= p - 1e-9);
    if (k >= 0) bins[k] -= p; else bins.push(SAIL.STICK_L - p);
  }
  return bins.length;
}

// The sail: either a shape cut from the cloth, poly [[x, y], ...] in cloth meters
// (x across 0..2.16, y up 0..2.79), hung with its lowest point `hang` up a mast
// of height mastH; or (the tuning sweep) a plain w x h rectangle or triangle
// with its foot MAST_GAP up and the mast MAST_GAP taller than the sail.
function sailGeom(sail) {
  if (sail.poly) {
    const p = sail.poly, c = polyArea(p), ys = p.map(q => q[1]), xs = p.map(q => q[0]);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    return { A: c.A, ceUp: c.cy - lo, h: hi - lo, w: Math.max(...xs) - Math.min(...xs), hang: sail.hang, mastH: sail.mastH,
      inCloth: xs.every(x => x >= -1e-9 && x <= SAIL.SAIL_W + 1e-9) && ys.every(y => y >= -1e-9 && y <= SAIL.SAIL_H + 1e-9) };
  }
  const tri = sail.shape === 'tri';
  return { A: tri ? sail.w * sail.h / 2 : sail.w * sail.h, ceUp: tri ? sail.h / 3 : sail.h / 2, h: sail.h, w: sail.w,
    hang: SAIL.MAST_GAP, mastH: sail.h + SAIL.MAST_GAP, inCloth: sail.w <= SAIL.SAIL_W + 1e-9 && sail.h <= SAIL.SAIL_H + 1e-9 };
}

// All the sails (Nick, 2026-11-19: two sheets of cloth, cut into as many sails as
// you like, each on its own mast, up to MASTS). d.sails is a list of
// { sheet, poly, mastH, hang }; the sweep's single d.sail still works.
const sailList = d => d.sails || [d.sail];
const inPoly = (x, y, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
// Do two pieces cut from the same sheet overlap? Checked on a 2.5 cm grid of points.
function clothOverlap(sails) {
  for (let i = 0; i < sails.length; i++) for (let j = i + 1; j < sails.length; j++) {
    const a = sails[i], b = sails[j]; if (!a.poly || !b.poly || (a.sheet || 0) !== (b.sheet || 0)) continue;
    for (let x = 0.0125; x < SAIL.SAIL_W; x += 0.025) for (let y = 0.0125; y < SAIL.SAIL_H; y += 0.025) if (inPoly(x, y, a.poly) && inPoly(x, y, b.poly)) return [i, j];
  }
  return null;
}

// A stick is part of a hull (not a seat or a beam) when it lies along the hull's
// skin line. Checked by its midpoint, since the builder's skin line can split or
// merge sticks where others are glued to them.
function onChain(p, h) {
  for (let i = 0; i < h.length - 1; i++) {
    const a = h[i], b = h[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    if (Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]) < 0.004) return true;
  }
  return false;
}
function riderSeat(d) {
  let best = null;
  for (const s of d.segs) {
    const mid = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
    if (d.hulls.some(h => onChain(mid, h))) continue;
    const [a, b] = s.a[0] <= s.b[0] ? [s.a, s.b] : [s.b, s.a];
    if (a[0] > 1e-6 || b[0] < -1e-6 || b[0] - a[0] < 1e-6) continue;
    const y = a[1] + (0 - a[0]) / (b[0] - a[0]) * (b[1] - a[1]);
    if (best == null || y < best) best = y;
  }
  for (const h of d.hulls) {
    const lo = lowest(h)[1], hi = Math.min(h[0][1], h[h.length - 1][1]);
    for (let y = lo; y <= hi + 1e-9; y += 0.01) {
      const w = waterline(h, y);
      if (w && w.B >= SAIL.HIPS && w.xc - w.B / 2 <= -SAIL.HIPS / 2 + 1e-6 && w.xc + w.B / 2 >= SAIL.HIPS / 2 - 1e-6) { if (best == null || y < best) best = y; break; }
    }
  }
  return best;
}
const segKey = (a, b) => { const k1 = a[0].toFixed(3) + ',' + a[1].toFixed(3), k2 = b[0].toFixed(3) + ',' + b[1].toFixed(3); return k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1; };

// ---------- the whole boat ----------
// d = { segs:[{a:[x,y], b:[x,y]}], hulls:[[pt,...]], L, bow, sail:{w,h,shape}, mastFoot:[x,y] }
// hulls are the skinned chains (gunwale to gunwale); segs is every stick in the
// section (hull sticks, beams, seats). Returns everything the page shows.
// The wood alone: every piece cut, whole sticks used, and its mass and height.
// The builder's live stick counter calls this too, so it can't drift from the
// physics. (Before any skin is on, there are no hulls and so no stringers yet.)
function sailWood(d) {
  const P = SAIL, L = d.L, nRib = ribCount(L);
  const pieces = []; let woodM = 0, woodMy = 0, tooLong = false;
  const addWood = (len, y) => { const m = len / P.STICK_L * P.STICK_KG; woodM += m; woodMy += m * y; };
  for (const s of d.segs) {
    const len = sLen(s.a, s.b), y = (s.a[1] + s.b[1]) / 2;
    for (let k = 0; k < nRib; k++) { pieces.push(len); addWood(len, y); }
    if (len > P.STICK_L + 1e-6) tooLong = true;
  }
  const verts = new Map();
  for (const h of d.hulls) for (const p of h) verts.set(p[0].toFixed(3) + ',' + p[1].toFixed(3), p);
  for (const p of verts.values()) for (const pc of splicedPieces(L)) { pieces.push(pc); addWood(pc, p[1]); }
  // The masts are sticks too, spliced to their height: one mast per sail.
  const mastPieces = [], mastHs = sailList(d).map(sl => sailGeom(sl).mastH);
  for (const mh of mastHs) { for (const pc of splicedPieces(mh)) { pieces.push(pc); mastPieces.push(pc); } addWood(mh, d.mastFoot[1] + mh / 2); }
  return { sticks: packSticks(pieces), nRib, mastH: mastHs.length ? Math.max(...mastHs) : 0, mastHs, mastSticks: packSticks(mastPieces), woodM, woodMy, tooLong, stringers: verts.size };
}

function sailAnalyze(d) {
  const P = SAIL, L = d.L, tp = taper(d.bow);
  const r = { ok: true, problems: [] };
  if (!d.hulls.length) { r.ok = false; r.fail = 'rules'; r.problems.push('There is no skin on the boat yet, so the water comes straight through.'); return r; }

  // Wood: pieces and their heights (for the center of gravity).
  const w = sailWood(d), woodM = w.woodM, woodMy = w.woodMy;
  if (w.tooLong) r.problems.push('A stick in the section is longer than one stick (1.13 m).');
  const sgs = sailList(d).map(sailGeom), sailA = sgs.reduce((t, g) => t + g.A, 0);
  r.sticks = w.sticks; r.nRib = w.nRib; r.mastH = w.mastH;
  if (r.sticks > P.STICKS) r.problems.push(`That takes ${r.sticks} sticks; you have ${P.STICKS}.`);

  // Skin: each hull's net (bottom and sides, plus end flaps) on one sheet.
  r.skins = d.hulls.map(h => {
    const G = girth(h), D = Math.max(...h.map(p => p[1])) - lowest(h)[1];
    const long = L + (d.bow === 'pointed' ? D : 2 * D);
    const fits = (long <= P.SHEET_A + 1e-9 && G <= P.SHEET_B + 1e-9) || (long <= P.SHEET_B + 1e-9 && G <= P.SHEET_A + 1e-9);
    return { G, D, long, fits };
  });
  if (d.hulls.length > P.SKINS) r.problems.push('You only have 2 pieces of monster skin.');
  r.skins.forEach((s, i) => { if (!s.fits) r.problems.push(`Hull ${d.hulls.length > 1 ? i + 1 + ' ' : ''}needs a ${s.long.toFixed(2)} x ${s.G.toFixed(2)} m piece of skin; a sheet is 3.05 x 2.73 m.`); });
  const many = sgs.length > 1, nm = i => many ? `Sail ${i + 1}` : 'The sail';
  sgs.forEach((sg, i) => {
    if (!sg.inCloth) r.problems.push(`${nm(i)} is bigger than the cloth.`);
    if (sg.hang < P.MAST_GAP - 1e-9) r.problems.push(`The bottom of ${many ? 'sail ' + (i + 1) : 'the sail'} must be at least 0.5 m up its mast, over your head.`);
    if (sg.hang + sg.h > sg.mastH + 1e-9) r.problems.push(`${nm(i)} goes higher than the top of its mast.`);
  });
  if (sgs.length > P.MASTS) r.problems.push(`You can have up to ${P.MASTS} masts.`);
  if (d.sails) { const ov = clothOverlap(d.sails); if (ov) r.problems.push(`Sails ${ov[0] + 1} and ${ov[1] + 1} overlap on the cloth: you can't cut the same cloth twice.`); }
  if (sailA < 0.01) r.problems.push('There is no sail.');

  // Masses and heights.
  const items = [];
  items.push({ m: woodM, y: woodM ? woodMy / woodM : 0, what: 'wood' });
  let skinA = 0, skinMy = 0;
  d.hulls.forEach(h => { for (let i = 0; i < h.length - 1; i++) { const a = sLen(h[i], h[i + 1]) * L * tp.c1; skinA += a; skinMy += a * (h[i][1] + h[i + 1][1]) / 2; } });
  items.push({ m: skinA * P.SKIN_KG_M2, y: skinA ? skinMy / skinA : 0, what: 'skin' });
  // Where the wind pushes: the area-weighted middle of all the sails together.
  r.ceY = sailA ? sgs.reduce((t, g) => t + g.A * (d.mastFoot[1] + g.hang + g.ceUp), 0) / sailA : d.mastFoot[1];
  sgs.forEach(g => items.push({ m: g.A * P.CLOTH_KG_M2, y: d.mastFoot[1] + g.hang + g.ceUp, what: 'sail' }));
  // The rider sits in the middle: on a stick across it (a seat or a beam), or
  // down in the hull where it's at least HIPS wide, whichever is lower.
  const seat = riderSeat(d);
  if (seat == null) { r.problems.push('Your rider has nowhere to sit. They sit in the middle, and need 50 cm of room.'); }
  r.seatY = seat == null ? 0 : seat;
  r.riderY = r.seatY + P.RIDER_SIT;
  // d.load (optional, for the builder's intro): who's aboard. Default: you and all 6 stones.
  const load = d.load || {}, withRider = load.rider !== false, nStones = load.stones != null ? load.stones : P.STONES;
  if (withRider) items.push({ m: P.RIDER_KG, y: r.riderY, what: 'rider' });
  // Stones settle at the lowest inside point; with two hulls they share it.
  const lows = d.hulls.map(h => lowest(h)[1]).sort((a, b) => a - b);
  r.stoneY = [];
  for (let i = 0; i < nStones; i++) {
    const y = (lows.length > 1 && lows[1] - lows[0] < 0.01) ? lows[i % 2] : lows[0];
    r.stoneY.push(y + P.STONE_R); items.push({ m: P.STONE_KG, y: y + P.STONE_R, what: 'stone' });
  }
  const M = items.reduce((s, it) => s + it.m, 0);
  r.mass = M; r.items = items;
  r.KG = items.reduce((s, it) => s + it.m * it.y, 0) / M;

  // Float: find the waterline T where the hulls displace M.
  const vol = T => d.hulls.reduce((s, h) => s + polyArea(clipBelow(h, T)).A * L * tp.c1, 0);
  const lo0 = Math.min(...d.hulls.map(h => lowest(h)[1]));
  const top = Math.min(...d.hulls.map(h => Math.min(h[0][1], h[h.length - 1][1])));
  const need = M / P.RHO_W;
  if (vol(top) < need) { r.ok = false; r.fail = 'sinks'; r.T = top; return finish(r); }
  let a = lo0, b = top;
  for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (vol(m) < need) a = m; else b = m; }
  const T = r.T = (a + b) / 2, V = vol(T);
  r.freeboard = top - T; r.draft = T - lo0;

  // Stability across (roll) and along (pitch).
  let IT = 0, IL = 0, KBm = 0, Rf = 0, Rw = 0;
  const per = d.hulls.map(h => {
    const sub = polyArea(clipBelow(h, T)), wl = waterline(h, T) || { B: 0, xc: 0 };
    IT += (Math.pow(wl.B, 3) / 12 * tp.c3 + wl.B * tp.c1 * wl.xc * wl.xc) * L;
    IL += longInertia(wl.B, L, d.bow);
    KBm += sub.A * L * tp.c1 * sub.cy;
    return { Ax: sub.A, B: wl.B, xc: wl.xc, Sw: wettedGirth(h, T) * L * (1 + tp.c1) / 2 };
  });
  r.KB = KBm / V; r.BMT = IT / V; r.BML = IL / V;
  r.GMT = r.KB + r.BMT - r.KG; r.GML = r.KB + r.BML - r.KG;
  r.beamWL = per.reduce((m, p) => Math.max(m, Math.abs(p.xc) + p.B / 2), 0) * 2;
  r.wetted = per.reduce((s, p) => s + p.Sw, 0);
  // Heel at which the lowest rail goes under (about the centerline).
  r.floodDeg = 90;
  for (const h of d.hulls) for (const p of [h[0], h[h.length - 1]]) {
    if (Math.abs(p[0]) < 1e-6) continue;
    r.floodDeg = Math.min(r.floodDeg, Math.atan2(p[1] - T, Math.abs(p[0])) * 180 / Math.PI);
  }
  if (r.GMT <= 0) { r.ok = false; r.fail = 'capsize'; return finish(r); }

  // Drag at speed v (m/s), and the sail's push.
  const W = M * P.G;
  const drag = v => {
    let R = 0;
    for (const p of per) {
      const Re = Math.max(1e4, v * L / P.NU), Cf = 0.075 / Math.pow(Math.log10(Re) - 2, 2);
      const fr = 0.5 * P.RHO_W * Cf * P.FORM * p.Sw * v * v;
      const Fn = v / Math.sqrt(P.G * L), h6 = Math.pow(Fn / P.FN0, 6);
      const wv = P.KW * P.RHO_W * P.G * p.Ax * p.Ax / L * h6 / (1 + h6) * (d.bow === 'pointed' ? 1 : P.SQUARE_BOW);
      R += fr + wv;
    }
    return R;
  };
  const Vw = P.WIND_KT * P.KT;
  const push = v => 0.5 * P.RHO_AIR * P.CD_SAIL * sailA * Math.pow(Math.max(0, Vw - v), 2);
  let va = 0, vb = Vw;
  for (let i = 0; i < 60; i++) { const m = (va + vb) / 2; if (push(m) > drag(m)) va = m; else vb = m; }
  const v = (va + vb) / 2;
  r.speedKt = v / P.KT; r.push = push(v); r.drag = drag(v); r.sailA = sailA;
  r.dragAt = v => drag(v); r.pushAt = v => push(v);

  // Bow dive, in a gust: the push acts at the sail's center, the water resists
  // about half the draft down; the hull trims bow-down until the moments balance.
  r.gustPush = 0.5 * P.RHO_AIR * P.CD_SAIL * sailA * Math.pow(Math.max(0, P.GUST_KT * P.KT - v), 2);
  r.pitchNm = r.gustPush * (r.ceY - (T + lo0) / 2);
  r.trimDeg = r.pitchNm / (W * r.GML) * 180 / Math.PI;
  r.bowDip = Math.tan(r.trimDeg * Math.PI / 180) * L / 2;
  // Roll: the serpent's waves.
  r.heelDeg = P.WAVE_NM / (W * r.GMT) * 180 / Math.PI;

  if (r.speedKt < P.MONSTER_KT) { r.ok = false; r.fail = 'slow'; }
  else if (r.bowDip >= r.freeboard) { r.ok = false; r.fail = 'bow'; }
  else if (r.heelDeg >= r.floodDeg) { r.ok = false; r.fail = 'roll'; }
  return finish(r);

  function finish(r) {
    if (r.problems.length) { r.ok = false; r.fail = 'rules'; }
    return r;
  }
}

// ---------- The skin, wrapped automatically (Nick, 2026-11-19) ----------
// The skin goes round the OUTSIDE of the frame: from its left-most top edge,
// down and under the boat, and up to its right-most top edge. Walking that
// outline is a wall-follow with the outside always on the walker's right (at each
// joint, take the sharpest right turn). Where the outline climbs at least
// SPLIT_RISE to a high point and drops again (a beam between two hulls), the skin
// stops and a new piece starts: that's how a second hull gets its own skin.
// Returns { hulls: [chain, ...], path } with each chain from one top edge to the other.
const SPLIT_RISE = 0.1;
function sailSkin(segs) {
  const K = p => p[0].toFixed(3) + ',' + p[1].toFixed(3), r3 = v => Math.round(v * 1000) / 1000;
  // Planar graph: split every stick where another one's end touches it or crosses it.
  const cuts = segs.map(() => []);
  segs.forEach((s, i) => {
    cuts[i].push(0, 1);
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], l2 = dx * dx + dy * dy || 1;
    segs.forEach((t, j) => {
      if (i === j) return;
      for (const p of [t.a, t.b]) {
        const u = ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / l2;
        if (u > 0 && u < 1 && Math.hypot(s.a[0] + u * dx - p[0], s.a[1] + u * dy - p[1]) < 0.004) cuts[i].push(u);
      }
      const ex = t.b[0] - t.a[0], ey = t.b[1] - t.a[1], den = dx * ey - dy * ex;
      if (Math.abs(den) > 1e-12) {
        const u = ((t.a[0] - s.a[0]) * ey - (t.a[1] - s.a[1]) * ex) / den, v = ((t.a[0] - s.a[0]) * dy - (t.a[1] - s.a[1]) * dx) / den;
        if (u > 1e-6 && u < 1 - 1e-6 && v > -1e-6 && v < 1 + 1e-6) cuts[i].push(u);
      }
    });
  });
  const pt = new Map(), adj = new Map();
  const node = p => { const q = [r3(p[0]), r3(p[1])], k = K(q); if (!pt.has(k)) { pt.set(k, q); adj.set(k, new Set()); } return k; };
  segs.forEach((s, i) => {
    const us = [...new Set(cuts[i].map(u => +u.toFixed(6)))].sort((a, b) => a - b);
    for (let n = 0; n < us.length - 1; n++) {
      const at = u => [s.a[0] + (s.b[0] - s.a[0]) * u, s.a[1] + (s.b[1] - s.a[1]) * u];
      const a = node(at(us[n])), b = node(at(us[n + 1]));
      if (a !== b) { adj.get(a).add(b); adj.get(b).add(a); }
    }
  });
  if (!pt.size) return { hulls: [], path: [] };
  const all = [...pt.keys()];
  const pick = (dir) => all.reduce((m, k) => { const p = pt.get(k), q = pt.get(m);
    return dir * p[0] > dir * q[0] + 0.0005 || (Math.abs(p[0] - q[0]) <= 0.0005 && p[1] > q[1]) ? k : m; }, all[0]);
  const start = pick(-1), goal = pick(1);
  // The walk. Arrive at the start heading straight down, as if from above it.
  const path = [start]; let at = start, dir = [0, -1], from = null;
  for (let step = 0; step < 4 * all.length + 10 && at !== goal; step++) {
    let best = null, bestTurn = Infinity;
    const nb = [...adj.get(at)];
    for (const k of nb) {
      if (k === from && nb.length > 1) continue;
      const p = pt.get(at), q = pt.get(k), d = [q[0] - p[0], q[1] - p[1]], l = Math.hypot(d[0], d[1]);
      const cr = dir[0] * d[1] - dir[1] * d[0], dt = dir[0] * d[0] + dir[1] * d[1];
      const turn = Math.atan2(cr, dt) / 1; // + left, - right
      const tt = k === from ? Math.PI : turn; // a dead end turns straight back
      if (tt < bestTurn) { bestTurn = tt; best = k; }
    }
    if (best == null) break;
    const p = pt.get(at), q = pt.get(best), l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    dir = [(q[0] - p[0]) / l, (q[1] - p[1]) / l]; from = at; at = best; path.push(at);
  }
  const P = path.map(k => pt.get(k));
  // Cut the outline into hulls at high points between dips.
  const pieces = []; let s0 = 0;
  for (let i = 1; i < P.length - 1; i++) {
    let j = i; while (j + 1 < P.length - 1 && Math.abs(P[j + 1][1] - P[i][1]) < 0.001) j++;
    const y = P[i][1];
    if (P[i - 1][1] < y - 0.001 && P[j + 1][1] < y - 0.001) {
      const leftLow = Math.min(...P.slice(s0, i + 1).map(p => p[1])), rightLow = Math.min(...P.slice(j).map(p => p[1]));
      if (y - leftLow >= SPLIT_RISE && y - rightLow >= SPLIT_RISE) { pieces.push(P.slice(s0, i + 1)); s0 = j; }
    }
    i = j;
  }
  pieces.push(P.slice(s0));
  // Where a piece stops at a beam partway up a wall, the skin carries on up that
  // wall to its top: follow any stick that continues straight on, upward.
  const extend = (h, end) => {
    for (let n = 0; n < 50; n++) {
      const e = end ? h.length - 1 : 0, last = h[e], prev = h[end ? e - 1 : 1];
      if (!prev) return h;
      const d = [last[0] - prev[0], last[1] - prev[1]], l = Math.hypot(d[0], d[1]);
      const nx = [...adj.get(K(last))].map(k => pt.get(k)).find(q => {
        const e2 = [q[0] - last[0], q[1] - last[1]], l2 = Math.hypot(e2[0], e2[1]);
        return e2[1] > 0.001 && Math.abs(d[0] * e2[1] - d[1] * e2[0]) < 1e-6 * l * l2 + 1e-9 && d[0] * e2[0] + d[1] * e2[1] > 0;
      });
      if (!nx) return h;
      h = end ? h.concat([nx]) : [nx].concat(h);
    }
    return h;
  };
  const hulls = [];
  for (let h0 of pieces) {
    let h = h0;
    if (h.length >= 2 && h[h.length - 1][1] > h[h.length - 2][1]) h = extend(h, true);
    if (h.length >= 2 && h[0][1] > h[1][1]) h = extend(h, false);
    // A flat run at either end (an arm sticking out past the hull) isn't skinned.
    while (h.length > 2 && Math.abs(h[0][1] - h[1][1]) < 0.001 && h[1][1] > Math.min(...h.map(p => p[1])) + 0.001) h = h.slice(1);
    while (h.length > 2 && Math.abs(h[h.length - 1][1] - h[h.length - 2][1]) < 0.001 && h[h.length - 2][1] > Math.min(...h.map(p => p[1])) + 0.001) h = h.slice(0, -1);
    // Corners only: a straight run of several sticks is one fold in the skin.
    const c = [h[0]];
    for (let i = 1; i < h.length - 1; i++) {
      const a = c[c.length - 1], b = h[i], n = h[i + 1];
      if (Math.abs((b[0] - a[0]) * (n[1] - a[1]) - (b[1] - a[1]) * (n[0] - a[0])) > 1e-7 || (b[0] - a[0]) * (n[0] - b[0]) + (b[1] - a[1]) * (n[1] - b[1]) < 0) c.push(b);
    }
    c.push(h[h.length - 1]);
    const low = Math.min(...c.map(p => p[1]));
    if (c.length >= 3 && c[0][1] > low + 0.01 && c[c.length - 1][1] > low + 0.01) hulls.push(c);
  }
  return { hulls, path: P };
}

if (typeof module !== 'undefined') module.exports = { SAIL, sailSkin, clothOverlap, inPoly, sailAnalyze, sailWood, sailGeom, splicedPieces, packSticks, ribCount };
