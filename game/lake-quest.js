// lake-quest.js — the Lake Quest (Nick, 2026-11-13): design a boat at the Boat Builder
// that carries you and 60 stones to the island in one trip, row across, build the
// altar, and learn Heal.
//
//   1. The Lake Watcher tells you about it. The drafting desk in the Boatwright's Hut
//      (north-west shore) opens boat-builder.html. When a design carries the rider
//      and 60 stones, the page posts 'boat-passed' and the boat is saved.
//   2. Your boat, drawn from your design, waits at the hut's dock. Step onto the dock
//      and row across: the boat glides along LAKE.row with its oars going.
//   3. The island: walk up to the altar's foundation and build it -> Heal is learned.
//      Heal can be cast once per battle (battle.js), restoring HEAL_HP.
//   4. The island's landing: row back.
//
// Saved on the student record as lakeQuest { boat, altar, design, stones, ts }
// (firebase-rules.json, students/$nameKey/lakeQuest). Demo and teacher progress
// lives in memory for the session, like the Rune Circle's.

const HEAL_HP = 2;
// Where everything is (LAKE, LAKE_SOLID) lives in world.js, beside the map it sits on.
const LAKE_ART = {
  pedestal: sheetPiece('cB1', 3, 3, 1, 2),
  crystal: sheetPiece('cB2', 15, 13, 1, 1),
};

let lqLocal = { boat: false, altar: false };
let lqWasOn = null;
const lqCounts = () => !session.demo && !session.teacher && !!session.nameKey;
function lqState() {
  if (lqCounts() && session.record && session.record.lakeQuest) return session.record.lakeQuest;
  return lqLocal;
}
function lqSave(patch) {
  const next = Object.assign({}, lqState(), patch, { ts: Date.now() });
  lqLocal = next;
  if (lqCounts() && session.record) {
    session.record.lakeQuest = next;
    Shared.updateStudent(session.nameKey, { lakeQuest: next });
  }
}
function lqHasHeal() { return !!lqState().altar; }

// The Boat Builder reports a design that carried the rider and all the stones.
window.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'boat-passed') return;
  const first = !lqState().boat;
  lqSave({ boat: true, design: String(e.data.design || '').slice(0, 200), stones: Math.max(0, Math.min(1000, Number(e.data.stones) || 0)) });
  if (first) console.log('[lake] boat saved');
});

// What the Lake Watcher says depends on how far along you are.
function lakeWatcherMessage() {
  const s = lqState();
  if (s.altar) return 'The altar on the island glows again, thanks to you. Remember: in battle, you can cast Heal once per fight.';
  if (s.boat) return 'Your boat is tied up at the dock by the Boatwright\'s Hut, on the west shore. Step onto the dock to row across, then build the altar on the island.';
  return 'The old altar on the island has fallen. To rebuild it, someone must carry 60 stones of 5 kg each across the lake, and themselves too, in ONE trip. The old Boatwright\'s Hut on the north-west shore still has a drafting desk. Design a boat there that can do it. Whoever rebuilds the altar learns the Heal spell.';
}

// ---------- Per-frame: triggers in the world ----------
function updateLakeQuest() {
  const fb = feetBox(player.x, player.y);
  const fx = fb.x + fb.w / 2, fy = fb.y + fb.h / 2;
  const near = (spot, r) => Math.hypot(fx - (spot.col * TILE + TILE / 2), fy - (spot.row * TILE + TILE / 2)) < TILE * r;
  let on = null;
  if (near(LAKE.dock, 0.8)) on = 'dock';
  else if (near(LAKE.landing, 0.8)) on = 'landing';
  else if (near(LAKE.altarFront, 0.8)) on = 'altar';
  if (on && on !== lqWasOn) {
    if (on === 'dock') lqAtDock();
    else if (on === 'landing') lqAtLanding();
    else lqAtAltar();
  }
  lqWasOn = on;
}

// ---------- The boat: its shape comes from the saved design ----------
// design is the builder's own text, e.g. "V bottom 1.5x1 m, walls 0.25 m, V 0.25 m,
// dividers: cross" (boat-builder.html, check()). Anything unreadable draws a 1 x 1 box.
function lqBoatSpec() {
  const m = /^(flat|V) bottom ([\d.]+)x([\d.]+) m.*dividers: (\w+)/.exec(lqState().design || '');
  const clamp = v => Math.max(0.25, Math.min(2, +v || 1));
  return m ? { v: m[1] === 'V', L: clamp(m[2]), W: clamp(m[3]), baffle: m[4] } : { v: false, L: 1, W: 1, baffle: 'none' };
}
// Drawn bigger than life so a 1 m boat isn't smaller than you: BOAT_SCALE tiles per meter.
const BOAT_SCALE = 1.5;
let lqBoatAt = 'dock';   // where it's moored: 'dock' or 'island' (this session)
let lqSail = null;       // { from, to, t0, dur, then } while rowing
const SAIL_MS = 4500;
function lqBoatSize() { const b = lqBoatSpec(); return { b, len: b.L * BOAT_SCALE * TILE, wid: b.W * BOAT_SCALE * TILE }; }
// The boat's center, world pixels, moored at either end: its side against the shore.
function lqMooring(at) {
  const { len } = lqBoatSize(), y = (LAKE.row + 0.5) * TILE;
  // The water tiles' drawn shoreline sits inside the edge tile, so moor half a tile out.
  return at === 'dock' ? { x: LAKE.shoreEdge * TILE + len / 2 + TILE * 0.5, y } : { x: LAKE.islandEdge * TILE - len / 2 - TILE * 0.5, y };
}
function lqBoatCenter() {
  if (!lqSail) return lqMooring(lqBoatAt);
  const k = Math.min(1, (performance.now() - lqSail.t0) / lqSail.dur), e = k * k * (3 - 2 * k);
  return { x: lqSail.from.x + (lqSail.to.x - lqSail.from.x) * e, y: lqSail.from.y + 3 * Math.sin(k * Math.PI * 6) };
}
// Put the player's feet at a world pixel (placeFeetAtTile does it for tile centers).
function lqFeetAt(x, y) {
  const p = placeFeetAtTile(0, 0);
  player.x = x - TILE / 2 + p.x; player.y = y - TILE / 2 + p.y;
}
function lqRow(to, arrivesOn, dir) {
  lqSail = { from: lqMooring(lqBoatAt), to: lqMooring(to), t0: performance.now(), dur: SAIL_MS, to_: to, arrivesOn, dir };
  player.dir = lqSail.to.x > lqSail.from.x ? 'east' : 'west';
}
// Called first thing in updatePlayer: while rowing, you sit in the boat (no walking,
// no battles or doors) and the camera follows. Returns true while rowing.
function updateLakeSail() {
  if (!lqSail) return false;
  const c = lqBoatCenter();
  lqFeetAt(c.x, c.y + TILE * 0.35); // feet a little below center, so you sit in the middle
  if (performance.now() - lqSail.t0 < lqSail.dur) return true;
  const { to_, arrivesOn, dir } = lqSail;
  lqSail = null; lqBoatAt = to_;
  const spot = to_ === 'island' ? LAKE.landing : LAKE.dock;
  const p = placeFeetAtTile(spot.col, spot.row);
  player.x = p.x; player.y = p.y; player.dir = dir;
  // Arriving on a trigger spot mustn't fire it: you step off and back on to use it.
  lqWasOn = arrivesOn;
  return false;
}

function lqModal(title, text, buttons) {
  scene.modalOpen = true;
  chestModalEls.modal.classList.remove('hidden');
  chestModalEls.titleEl.textContent = title;
  chestModalEls.bodyEl.innerHTML = `<div class="wb-modal-body">${text}</div>`;
  const close = () => { scene.modalOpen = false; chestModalEls.modal.classList.add('hidden'); };
  for (const [label, fn] of buttons) chestModalEls.bodyEl.appendChild(gateButton(label, () => { close(); if (fn) fn(); }));
}
function lqAtDock() {
  if (!lqState().boat) {
    lqModal('The Dock', 'A good place to launch a boat, if you had one. Design one at the drafting desk in the Boatwright\'s Hut, right here.', [['OK']]);
    return;
  }
  if (lqBoatAt !== 'dock') return; // (can't happen: you only get back here by boat)
  const s = lqState();
  lqModal('Your Boat', (s.altar ? 'Your boat bobs at the dock, empty now.' : 'Your boat is loaded with 60 stones, with room for you.') + (s.design ? `<br><small>(${s.design})</small>` : ''),
    [['🚣 Row to the island', () => lqRow('island', 'landing', 'north')], ['Not yet']]);
}
function lqAtLanding() {
  if (lqBoatAt !== 'island') return;
  lqModal('The Island', lqState().altar ? 'The altar is rebuilt. Ready to row back?' : 'The altar\'s foundation is just ahead. Rebuild it with your stones, or row back.',
    [['🚣 Row back to shore', () => lqRow('dock', 'dock', 'west')], ['Stay']]);
}
function lqAtAltar() {
  if (lqState().altar) {
    lqModal('The Altar', `The crystal hums. You know <strong>Heal</strong>: once in every battle, cast it to get back ${HEAL_HP} HP.`, [['OK']]);
    return;
  }
  if (!lqState().boat) {
    lqModal('The Altar', 'A fallen altar. It needs 60 stones to rebuild.', [['OK']]);
    return;
  }
  lqModal('The Altar', 'You unload all 60 stones from your boat. Stack them to rebuild the altar?', [
    ['Rebuild the altar', () => {
      lqSave({ altar: true });
      lqModal('✨ You learned Heal!', `The crystal lights up as the last stone goes in. In battle, you can now cast <strong>Heal</strong> once per fight to get back ${HEAL_HP} HP.`, [['Great!']]);
    }],
    ['Not yet'],
  ]);
}

// ---------- Drawing (ground level, under people and trees) ----------
function drawLakeQuest() {
  const ctx = mapCtx;
  const at = spot => ({ x: spot.col * TILE - camera.x, y: spot.row * TILE - camera.y });
  const a = at(LAKE.altar), d = at(LAKE.dock);
  if (a.x < -10 * TILE && d.x < -10 * TILE) return;
  if (d.x > mapCanvas.width + 10 * TILE || a.y > mapCanvas.height + 12 * TILE) return;
  const s = lqState();
  // A short jetty off the shore by the hut, the boat tied up beside it.
  ctx.fillStyle = '#7a5230'; ctx.fillRect(d.x + TILE * 0.55, d.y + TILE * 0.3, TILE * 1.05, TILE * 0.4);
  ctx.fillStyle = '#5e3e22';
  for (let i = 0; i < 6; i++) ctx.fillRect(d.x + TILE * (0.55 + i * 0.19), d.y + TILE * 0.3, 2, TILE * 0.4);
  ctx.fillRect(d.x + TILE * 1.52, d.y + TILE * 0.22, 5, TILE * 0.56); // post
  if (s.boat) {
    const c = lqBoatCenter();
    drawLakeBoat(ctx, c.x - camera.x, c.y - camera.y, !s.altar); // the stones stay aboard until the altar takes them
  }
  // The altar: rubble until rebuilt, then the pedestal with its crystal.
  const img = LAKE_ART.pedestal;
  if (s.altar) {
    if (img.complete !== false) ctx.drawImage(img, a.x, a.y - TILE, TILE, TILE * 2);
    const glow = 0.5 + 0.5 * Math.sin(Date.now() / 400);
    ctx.save(); ctx.globalAlpha = 0.25 + 0.25 * glow; ctx.fillStyle = '#9fe7ff';
    ctx.beginPath(); ctx.arc(a.x + TILE / 2, a.y - TILE * 0.85, TILE * 0.45, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.drawImage(LAKE_ART.crystal, a.x, a.y - TILE * 1.45, TILE, TILE);
  } else {
    ctx.fillStyle = '#8a8f94';
    for (const [ox, oy, r] of [[0.25, 0.6, 0.16], [0.55, 0.65, 0.2], [0.75, 0.45, 0.14], [0.45, 0.35, 0.15]]) {
      ctx.beginPath(); ctx.arc(a.x + TILE * ox, a.y + TILE * oy, TILE * r, 0, Math.PI * 2); ctx.fill();
    }
  }
}
// Your boat from above, its length along the crossing (east-west): the purple monster
// skin, the wooden rim and ribs, a keel line if it's a V, your dividers, and the
// stones while they're aboard. Rowing, two oars sweep out of the sides.
function drawLakeBoat(ctx, cx, cy, loaded) {
  const { b, len, wid } = lqBoatSize();
  const x0 = cx - len / 2, y0 = cy - wid / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; // wake / waterline
  ctx.fillRect(x0 - 3, y0 - 3, len + 6, wid + 6);
  ctx.fillStyle = '#6b3f7a'; ctx.fillRect(x0, y0, len, wid);
  ctx.fillStyle = '#7d4d8d'; ctx.fillRect(x0 + 5, y0 + 5, len - 10, wid - 10); // the floor, a shade lighter
  if (b.v) { ctx.fillStyle = '#4f2b5c'; ctx.fillRect(x0 + 5, cy - 1.5, len - 10, 3); }
  ctx.fillStyle = '#5e3e22';
  const ribs = Math.max(1, Math.round(b.L / 0.5));
  for (let k = 1; k < ribs; k++) { const x = x0 + len * k / ribs; ctx.fillRect(x - 1.5, y0, 3, 5); ctx.fillRect(x - 1.5, y0 + wid - 5, 3, 5); }
  ctx.fillStyle = '#a0703f';
  if (b.baffle === 'cross' || b.baffle === 'grid') for (const f of [1 / 3, 2 / 3]) ctx.fillRect(x0 + len * f - 1.5, y0 + 4, 3, wid - 8);
  if (b.baffle === 'long' || b.baffle === 'grid') for (const f of [1 / 3, 2 / 3]) ctx.fillRect(x0 + 4, y0 + wid * f - 1.5, len - 8, 3);
  if (loaded) {
    // A loose grid of stones, nudged a little each, leaving your seat clear.
    const step = TILE * 0.24, nc = Math.max(1, Math.floor((len - 10) / step)), nr = Math.max(1, Math.floor((wid - 10) / step));
    for (let i = 0; i < nc; i++) for (let j = 0; j < nr; j++) {
      const sx = x0 + 5 + (i + 0.5) * (len - 10) / nc + 2 * Math.sin(i * 7.1 + j * 3.3);
      const sy = y0 + 5 + (j + 0.5) * (wid - 10) / nr + 2 * Math.cos(i * 4.7 + j * 5.9);
      if (Math.abs(sx - cx) < TILE * 0.4 && Math.abs(sy - cy) < TILE * 0.4) continue; // your seat
      ctx.fillStyle = (i + j) % 3 ? '#8c8f93' : '#a2a5a8';
      ctx.beginPath(); ctx.arc(sx, sy, TILE * 0.085, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.strokeStyle = '#a0703f'; ctx.lineWidth = 4; ctx.strokeRect(x0, y0, len, wid); // the rim
  if (lqSail) {
    // Oars: from oarlocks either side of your seat, sweeping fore and aft; the blade
    // splashes on the stroke.
    const ph = (performance.now() - lqSail.t0) / 1000 * Math.PI * 2 * 1.1;
    const sweep = Math.sin(ph) * 0.65, reach = TILE * 1.05;
    const dir = lqSail.to.x > lqSail.from.x ? 1 : -1;
    for (const side of [-1, 1]) {
      const ox = cx, oy = cy + side * (wid / 2);
      const ex = ox - dir * Math.sin(sweep) * reach, ey = oy + side * Math.cos(sweep) * reach;
      ctx.strokeStyle = '#c99a5b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = '#c99a5b'; ctx.beginPath(); ctx.ellipse(ex, ey, 9, 5, Math.atan2(ey - oy, ex - ox), 0, Math.PI * 2); ctx.fill();
      if (Math.cos(ph) > 0.4) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ex, ey, 10 + 6 * Math.cos(ph), 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
}
