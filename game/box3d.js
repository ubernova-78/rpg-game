/* ================================================================
   box3d.js — a rectangular prism students turn and pick edges on.

   One box, drawn the same way everywhere it's used:
     • dimensions-bench.html   (pick one edge per direction)
     • mass-volume-bench.html  (pick, then measure, on Volume and Density)

   The idea it carries: a box's 12 edges are 3 groups of 4 parallel
   edges, and the 3 dimensions are ONE edge from EACH group -- any edge
   of a group, at any corner.  So a pick is right exactly when its three
   edges run three different ways.

   The box is always solid and shaded, as a real one is: back edges can't
   be seen or clicked until it's turned.  Dashed hidden edges were dropped
   (not what you see in real life; an outline box flips in the eye), and
   so was going see-through to explain an answer (Nick, 2026-11-03: "too
   confusing for my kids").  Explanations color the VISIBLE edges: a
   direction's edges in its color, SOLID where picked and DASHED over the
   black edge where not.  A thick and a thin line of one color were too
   alike to tell apart.

   Box colors are greens, teals and a light grey only -- unlike every
   edge color (black, purple pick, orange wrong, red/blue/gold answer,
   gold measuring).  A purple box once hid the purple picks.
   ================================================================ */

// eslint-disable-next-line no-unused-vars
const Box3D = (function () {
  'use strict';

  // Corner i has bit 0/1/2 set for +x/+y/+z.  An edge joins two corners
  // that differ in one bit, and that bit is its direction (0, 1 or 2).
  const EDGES = [];
  for (let axis = 0; axis < 3; axis++)
    for (let i = 0; i < 8; i++)
      if (!(i & (1 << axis))) EDGES.push({ id: EDGES.length, axis, a: i, b: i | (1 << axis) });
  const FACES = [];
  for (let axis = 0; axis < 3; axis++) for (const sign of [0, 1]) {
    const p = (axis + 1) % 3, q = (axis + 2) % 3, base = sign << axis;
    FACES.push({ axis, sign, corners: [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => base | (u << p) | (v << q)) });
  }
  // The two faces an edge lies between.
  const edgeFaces = e => FACES.filter(f => f.axis !== e.axis && (((e.a >> f.axis) & 1) === f.sign));

  const mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  const rotX = t => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
  const rotY = t => [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]];
  const rotZ = t => [[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]];
  const apply = (R, v) => [0, 1, 2].map(i => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);
  const deg = d => d * Math.PI / 180;
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  const GROUP_COLORS = ['#e63946', '#1d6fd6', '#e0a800'];
  const WRONG_COLOR = '#ff6a00', PICK_COLOR = '#6f2dbd', MEASURE_COLOR = '#f6c90e', EDGE_COLOR = '#2b2b2b';
  const BOX_COLORS = ['#b7e1a1', '#a3dcc2', '#c9dcb3', '#9ed6cf', '#cfe8c2', '#d6d6d6', '#b5d8c0', '#bfe0d6'];
  const LETTERS = ['A', 'B', 'C'];
  const LIGHT = (() => { const v = [-0.45, 0.65, 0.62], n = Math.hypot(...v); return v.map(x => x / n); })();

  // A starting view: upright, seen from a little above -- or, with odd,
  // also tipped over, so "up" stops being a clue.
  function startRotation(odd) {
    const yaw = deg(rand(25, 65)) * (Math.random() < 0.5 ? 1 : -1), pitch = deg(rand(15, 32));
    let R = mul(rotX(pitch), rotY(yaw));
    if (odd) R = mul(rotZ(deg(rand(25, 155)) * (Math.random() < 0.5 ? 1 : -1)), mul(rotX(deg(rand(-50, 50))), R));
    return R;
  }

  function shadeHex(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
    return '#' + c((n >> 16) * f) + c(((n >> 8) & 255) * f) + c((n & 255) * f);
  }

  // svg: an <svg> element (its viewBox is set here).
  // opts: dims [x,y,z] (any units, only the proportions matter), R, color,
  //   size (0-1 of the frame), letters (label picks A/B/C), width, height,
  //   onChange() after any pick change, onDismiss() when a plain click
  //   closes a 'wrong' explanation, onNudge(msg).
  //
  // Modes: 'solid' picking; 'wrong' the repeated direction (glowAxis) in
  // orange; 'groups' every direction in its color.  `pickable` false keeps
  // the box turnable but not pickable; `measuring` is an edge id drawn gold.
  function create(svg, opts) {
    const W = opts.width || 460, H = opts.height || 360;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const box = {
      dims: opts.dims, R: opts.R, color: opts.color, size: opts.size || 1, letters: !!opts.letters,
      sel: [], mode: 'solid', glowAxis: null, pickable: true, measuring: null,
    };
    const onChange = opts.onChange || function () {}, onDismiss = opts.onDismiss || function () {},
      onNudge = opts.onNudge || function () {};

    function render() {
      const [a, b, c] = box.dims, half = Math.hypot(a, b, c) / 2, s = (Math.min(W, H) * 0.5 * box.size) / half;
      const P = [], Z = [];
      for (let i = 0; i < 8; i++) {
        const v = apply(box.R, [(i & 1 ? 1 : -1) * a / 2, (i & 2 ? 1 : -1) * b / 2, (i & 4 ? 1 : -1) * c / 2]);
        P.push([W / 2 + v[0] * s, H / 2 - v[1] * s]); Z.push(v[2]);
      }
      const normal = f => { const n = [0, 0, 0]; n[f.axis] = f.sign ? 1 : -1; return apply(box.R, n); };
      const facing = FACES.map(f => normal(f)[2] > 1e-6);
      let out = '';
      FACES.forEach((f, k) => {
        if (!facing[k]) return;
        const n = normal(f), lit = 0.78 + 0.22 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
        const pts = f.corners.map(i => P[i].map(x => x.toFixed(1)).join(',')).join(' ');
        out += `<polygon class="face" points="${pts}" fill="${shadeHex(box.color, lit)}" stroke="none"/>`;
      });
      const order = EDGES.slice().sort((e1, e2) => (Z[e1.a] + Z[e1.b]) - (Z[e2.a] + Z[e2.b]));
      let labels = '';
      box.visible = new Set();
      for (const e of order) {
        if (!edgeFaces(e).some(f => facing[FACES.indexOf(f)])) continue;
        box.visible.add(e.id);
        const [x1, y1] = P[e.a], [x2, y2] = P[e.b], sel = box.sel.includes(e.id);
        const line = (cls, stroke, w, extra) => `<line class="${cls}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${w}"${extra || ''}/>`;
        // Picked: solid in the color.  Not picked: black with the color dashed over it.
        const colored = col => sel ? line('edge-vis', col, 7)
          : line('edge-vis', EDGE_COLOR, 2.5) + line('edge-vis', col, 5, ' stroke-dasharray="9 7" stroke-linecap="butt"');
        const plain = () => e.id === box.measuring ? line('edge-vis', MEASURE_COLOR, 9)
          : sel ? line('edge-vis', PICK_COLOR, 8) : line('edge-vis' + (box.pickable && box.mode === 'solid' ? ' plain' : ''), EDGE_COLOR, 2.5);
        if (box.mode === 'solid') {
          if (box.pickable) out += `<line class="edge-hit" data-e="${e.id}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
          out += plain();
        } else if (box.mode === 'wrong') {
          out += e.axis === box.glowAxis ? colored(WRONG_COLOR) : plain();
        } else {
          out += colored(GROUP_COLORS[e.axis]);
        }
        // A/B/C beside each pick, pushed out from the box's middle.
        if (sel && box.letters) {
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = mx - W / 2, dy = my - H / 2, d = Math.hypot(dx, dy) || 1;
          const lx = mx + dx / d * 18, ly = my + dy / d * 18, k = LETTERS[box.sel.indexOf(e.id)];
          const hot = e.id === box.measuring;
          labels += `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="12" fill="${hot ? MEASURE_COLOR : '#fff'}" stroke="${hot ? '#7a5b00' : PICK_COLOR}" stroke-width="2.5" pointer-events="none"/>`
            + `<text x="${lx.toFixed(1)}" y="${(ly + 5).toFixed(1)}" font-size="15" font-weight="800" text-anchor="middle" fill="#1a1a2e" font-family="Verdana" pointer-events="none">${k}</text>`;
        }
      }
      svg.innerHTML = out + labels;
    }

    // One gesture is a drag (turns the box) or a click (picks), told apart
    // by how far it moved.  Listeners live on the svg once; they act on
    // whichever box was created on it last.
    svg._box3d = { box, render, toggle, onDismiss };
    if (!svg._box3dWired) {
      svg._box3dWired = true;
      svg.style.touchAction = 'none';
      let drag = null;
      svg.addEventListener('pointerdown', e => {
        const B = svg._box3d; if (!B) return;
        // One finger / the main button only: a second finger used to take
        // over the gesture and make the box jump, and a right-click picked.
        if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const dismiss = B.box.mode === 'wrong';
        const edge = B.box.pickable && B.box.mode === 'solid' && e.target.dataset ? e.target.dataset.e : undefined;
        // A finger wobbles more than a mouse: under this many px it's still
        // a tap, so a jittery tap on a touchscreen doesn't turn into a drag
        // and silently lose the pick.
        drag = { x: e.clientX, y: e.clientY, moved: false, edge, dismiss, slop: e.pointerType === 'mouse' ? 5 : 10 };
        try { svg.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
      });
      svg.addEventListener('pointermove', e => {
        const B = svg._box3d; if (!drag || !B || !e.isPrimary) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < drag.slop) return;
        drag.moved = true; svg.classList.add('dragging');
        // About the screen's own axes, so the box follows the pointer
        // whatever way up it already is.
        B.box.R = mul(mul(rotY(dx * 0.011), rotX(dy * 0.011)), B.box.R);
        drag.x = e.clientX; drag.y = e.clientY;
        B.render();
      });
      svg.addEventListener('pointerup', e => {
        if (!e.isPrimary) return;
        const B = svg._box3d, d = drag; drag = null; svg.classList.remove('dragging');
        if (!d || !B || d.moved) return;
        if (d.dismiss) { B.onDismiss(); return; }
        if (d.edge !== undefined) B.toggle(Number(d.edge));
      });
      svg.addEventListener('pointercancel', () => { drag = null; svg.classList.remove('dragging'); });
    }

    function toggle(id) {
      const k = box.sel.indexOf(id);
      if (k !== -1) box.sel.splice(k, 1);
      else if (box.sel.length >= 3) { onNudge('You have 3 picked. Click one of them to un-pick it first.'); return; }
      else box.sel.push(id);
      render(); onChange();
    }

    const api = {
      box, render,
      clear() { box.sel = []; render(); onChange(); },
      // Right when the three picks run three different ways; otherwise the
      // direction picked most (what to explain) and whether all three match.
      check() {
        const counts = [0, 0, 0]; box.sel.forEach(id => counts[EDGES[id].axis]++);
        const most = Math.max(...counts);
        return { right: box.sel.length === 3 && most === 1, glowAxis: counts.indexOf(most), allSame: most === 3 };
      },
      setMode(mode, glowAxis) { box.mode = mode; box.glowAxis = glowAxis == null ? null : glowAxis; render(); },
      // When the answer is shown: one edge of each direction, so the
      // measuring can carry on.
      pickOnePerDirection() {
        box.sel = [0, 1, 2].map(ax => {
          const all = EDGES.filter(e => e.axis === ax);
          return (all.find(e => box.visible.has(e.id)) || all[0]).id;
        });
        render(); onChange();
      },
      axisOf: id => EDGES[id].axis,
      picks: () => box.sel.slice(),
    };
    render();
    return api;
  }

  return { create, startRotation, BOX_COLORS, GROUP_COLORS, LETTERS, EDGES };
})();
