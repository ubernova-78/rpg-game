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

// The Boat Builder's "Use this boat" (a design that carried the rider and all the
// stones): save it, close the builder, and say where the boat is.
window.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'boat-passed') return;
  const first = !lqState().boat;
  lqSave({ boat: true, design: String(e.data.design || '').slice(0, 200), stones: Math.max(0, Math.min(1000, Number(e.data.stones) || 0)) });
  if (first) console.log('[lake] boat saved');
  gameOverlayEls.btnBack.click();
  lqModal(first ? '⛵ Your boat is built!' : '⛵ Boat swapped',
    'It\'s tied up at the dock just outside, on the east side of the hut' + (lqState().altar ? '.' : ', loaded with 60 stones.') + ' Step onto the dock to row across to the island.', [['OK']]);
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
  // The dock's trigger covers the shore spot and the whole pier out to the boat
  // (Nick, 2026-11-13: a circle round the pier's end was too fiddly to find).
  const onDock = fx > (LAKE.dock.col - 0.4) * TILE && fx < (LAKE.pier.col + 1) * TILE && fy > (LAKE.row - 0.3) * TILE && fy < (LAKE.row + 1.3) * TILE;
  let on = null;
  if (onDock) on = 'dock';
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
  return at === 'dock' ? { x: LAKE.shoreEdge * TILE + len / 2 + TILE * 0.05, y } : { x: LAKE.islandEdge * TILE - len / 2 - TILE * 0.5, y };
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
  // The pier off the shore by the hut, one tile out over the water (you can walk
  // on it), the boat tied up at its end.
  ctx.fillStyle = '#7a5230'; ctx.fillRect(d.x + TILE * 0.55, d.y + TILE * 0.15, TILE * 1.45, TILE * 0.7);
  ctx.fillStyle = '#5e3e22';
  for (let i = 0; i < 8; i++) ctx.fillRect(d.x + TILE * (0.55 + i * 0.185), d.y + TILE * 0.15, 2, TILE * 0.7);
  ctx.fillRect(d.x + TILE * 1.9, d.y + TILE * 0.05, 5, TILE * 0.9); // posts at the end
  ctx.fillRect(d.x + TILE * 1.9, d.y + TILE * 0.05, 5, 5);
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

// ---------- Witch Hazel: the quest's story (Nick, 2026-11-13) ----------
// In the town square. The first time you talk to her she tells the whole story,
// a page at a time: the altar and its healing crystal, a flashback of the lake
// serpent wrecking the altar and the only boat, why nobody has crossed since, the
// prize (Heal, once per battle), and where to start (the Boatwright's Hut). After
// that she gives a hint for where you are, and will tell the story again.
let lqHeardStory = false; // this session only: not saved
function witchTalk() {
  const s = lqState();
  if (!lqHeardStory && !s.boat && !s.altar) { witchStory(0); return; }
  const hint = s.altar
    ? `You did it! The altar glows again, and the crystal taught you <strong>Heal</strong>. Once in every battle, it gives you back ${HEAL_HP} HP.`
    : s.boat
      ? 'You built a boat that can carry it all! It\'s tied up at the pier by the Boatwright\'s Hut. Row it to the island and rebuild the altar.'
      : 'Head north to the lake. The <strong>Boatwright\'s Hut</strong> is on the north-west shore: design your boat at the drafting desk inside.';
  witchPage(hint, [['Tell me the story again', () => witchStory(0)], ['Thanks!', closeWorkbench]]);
}
const WITCH_STORY = [
  { text: 'Ah, a new face! Come closer, dear. Do you see the island in the middle of the lake? Let me tell you what happened there.' },
  { text: 'An altar stood on that island, with a crystal that could heal any wound. Then, one stormy night, a <strong>lake serpent</strong> rose out of the water. It smashed the altar to rubble, and it splintered the only boat we had.', scene: true },
  { text: 'Nobody has crossed since. We have no boat, and nobody knows how to build one strong enough. To rebuild the altar, someone must carry <strong>60 stones of 5 kg</strong> each, and themselves, across the lake in <strong>one trip</strong>.' },
  { text: `Whoever rebuilds the altar will be rewarded. The crystal will teach them <strong>Heal</strong>: once in every battle, they can cast it to get back ${HEAL_HP} HP.` },
  { text: 'Where to start? Walk north to the lake. On its north-west shore is the old <strong>Boatwright\'s Hut</strong>. Use the drafting desk inside to design a boat that can carry you and all 60 stones. Good luck, dear!', last: true },
];
function witchStory(i) {
  const p = WITCH_STORY[i];
  const buttons = p.last
    ? [['I\'ll do it!', () => { lqHeardStory = true; closeWorkbench(); }]]
    : [['Next', () => witchStory(i + 1)]];
  if (p.scene) buttons.unshift(['▶ Watch again', () => witchStory(i)]);
  witchPage(p.text, buttons, p.scene, `${i + 1} of ${WITCH_STORY.length}`);
}
function witchPage(html, buttons, withScene, step) {
  stopFlashback();
  storyOpen();
  wbTitle.textContent = 'Witch Hazel' + (step ? ` (${step})` : '');
  wbBody.innerHTML = '';
  if (withScene) {
    const cv = document.createElement('canvas');
    cv.width = 480; cv.height = 270; cv.className = 'story-scene';
    wbBody.appendChild(cv);
    playFlashback(cv);
  }
  const p = document.createElement('p'); p.innerHTML = html; p.style.margin = '0 0 6px'; wbBody.appendChild(p);
  for (const [label, fn] of buttons) wbBody.appendChild(gateButton(label, fn));
  wbModal.classList.remove('hidden');
}
function storyOpen() {
  scene.modalOpen = true;
  wbModal.classList.add('story');
  wbModalCloseHook = () => { stopFlashback(); wbModal.classList.remove('story'); };
}

// ---------- The flashback ----------
// The real island, cut from the game's own ground (buildGround), at night in a
// storm. The altar glows on it, the old boat is tied at its west landing. The
// serpent rises south of the island, smashes the altar (flash, shake, stones and
// crystal shards fly), sweeps round and splinters the boat, and sinks back. About
// 6 s; everything is worked out from t, so it can be replayed from any moment.
let flashRAF = 0;
function stopFlashback() { cancelAnimationFrame(flashRAF); flashRAF = 0; }
function playFlashback(cv) {
  stopFlashback();
  const ctx = cv.getContext('2d'), t0 = performance.now();
  const step = () => {
    if (!cv.isConnected) { flashRAF = 0; return; }
    drawFlashback(ctx, (performance.now() - t0) / 1000);
    flashRAF = requestAnimationFrame(step);
  };
  step();
}
function drawFlashback(ctx, t) {
  const W = 480, H = 270, C0 = 24.5, R0 = 0, PX = 32; // 15 x 8.4 tiles at 2x
  const X = c => (c - C0) * PX, Y = r => (r - R0) * PX;
  const ease = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const hitAltar = 3.4, hitBoat = 4.15;
  // Camera shake on each strike.
  const shake = Math.max(0, 1 - Math.abs(t - hitAltar) * 4) + Math.max(0, 1 - Math.abs(t - hitBoat) * 4);
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.translate(Math.sin(t * 90) * 5 * shake, Math.cos(t * 77) * 4 * shake);
  ctx.imageSmoothingEnabled = false;
  const frames = buildGround();
  if (frames) ctx.drawImage(frames[Math.floor(t * 2) % frames.length], C0 * 16, R0 * 16, W / 2, H / 2, 0, 0, W, H);
  else { ctx.fillStyle = '#2f6fb5'; ctx.fillRect(0, 0, W, H); }

  // The altar: whole and glowing, then rubble.
  const ax = X(LAKE.altar.col), ay = Y(LAKE.altar.row);
  if (t < hitAltar) {
    if (LAKE_ART.pedestal.complete !== false) ctx.drawImage(LAKE_ART.pedestal, ax, ay - PX, PX, PX * 2);
    const glow = 0.55 + 0.45 * Math.sin(t * 5);
    ctx.globalAlpha = 0.35 + 0.3 * glow; ctx.fillStyle = '#9fe7ff';
    ctx.beginPath(); ctx.arc(ax + PX / 2, ay - PX * 0.85, PX * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    ctx.drawImage(LAKE_ART.crystal, ax, ay - PX * 1.45, PX, PX);
  } else {
    ctx.fillStyle = '#8a8f94';
    for (const [ox, oy, r] of [[0.25, 0.6, 0.16], [0.55, 0.65, 0.2], [0.75, 0.45, 0.14], [0.45, 0.35, 0.15]]) {
      ctx.beginPath(); ctx.arc(ax + PX * ox, ay + PX * oy, PX * r, 0, Math.PI * 2); ctx.fill();
    }
    // Stones and crystal shards flying out, then landing.
    const k = Math.min(1, (t - hitAltar) / 0.9);
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2 + 0.4, d = PX * (0.6 + 1.6 * k) * (0.6 + (i % 3) * 0.25);
      const x = ax + PX / 2 + Math.cos(a) * d, y = ay + Math.sin(a) * d * 0.6 - PX * 1.2 * Math.sin(k * Math.PI) * (i % 2 ? 1 : 0.6);
      ctx.fillStyle = i % 3 ? '#8a8f94' : '#9fe7ff';
      ctx.beginPath(); ctx.arc(x, y, i % 3 ? 4 : 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  // The old boat at the island's west landing: whole, then planks drifting apart.
  const bx = X(LAKE.islandEdge - 1.1), by = Y(LAKE.row + 0.5);
  if (t < hitBoat) {
    ctx.fillStyle = '#7a5230'; ctx.beginPath(); ctx.ellipse(bx, by, PX * 0.8, PX * 0.38, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5e3e22'; ctx.beginPath(); ctx.ellipse(bx, by, PX * 0.62, PX * 0.24, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a0703f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(bx - PX * 0.2, by - PX * 0.25); ctx.lineTo(bx - PX * 0.5, by - PX * 0.75); ctx.stroke();
  } else {
    const k = Math.min(1, (t - hitBoat) / 1.5);
    ctx.fillStyle = '#7a5230';
    for (let i = 0; i < 6; i++) {
      const a = i * 1.1, d = PX * (0.2 + 1.1 * k) * (0.5 + (i % 3) * 0.3);
      ctx.save(); ctx.translate(bx + Math.cos(a) * d, by + Math.sin(a) * d * 0.7); ctx.rotate(a + k * (i % 2 ? 1.5 : -1.2));
      ctx.fillRect(-PX * 0.3, -3, PX * 0.6, 6); ctx.restore();
    }
  }

  // The serpent: comes up in the water north-west of the island, between the old
  // boat and the altar, its neck a chain of green discs from where it breaks the
  // water to its head. Rises 1.6-2.6 s, rears up, strikes the altar (3.4 s), swings
  // to the boat (4.15 s), sinks 4.6-5.6 s.
  const base = { x: X(27.3), y: Y(3.2) };
  const up = ease((t - 1.6) / 1.0) * (1 - ease((t - 4.6) / 1.0));
  if (up > 0.01) {
    const rear = { x: base.x + 30, y: base.y - PX * 1.5 }; // reared up, head still in frame
    const atAltar = { x: ax + PX / 2 - 16, y: ay - PX * 0.4 }, atBoat = { x: bx - 12, y: by - 10 }; // (mouth on target)
    let head;
    if (t < 3.0) head = rear;
    else if (t < hitAltar) { const k = ease((t - 3.0) / 0.4); head = { x: rear.x + (atAltar.x - rear.x) * k, y: rear.y + (atAltar.y - rear.y) * k }; }
    else if (t < hitBoat) { const k = ease((t - hitAltar - 0.25) / 0.5); head = { x: atAltar.x + (atBoat.x - atAltar.x) * k, y: atAltar.y + (atBoat.y - atAltar.y) * k }; }
    else head = { x: atBoat.x + (rear.x - atBoat.x) * ease((t - hitBoat) / 0.5), y: atBoat.y + (rear.y - atBoat.y) * ease((t - hitBoat) / 0.5) };
    head = { x: base.x + (head.x - base.x) * up, y: base.y + (head.y - base.y) * up };
    // Water ring where it comes up, and two humps behind.
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(base.x, base.y, 22 + 6 * Math.sin(t * 6), 8, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#2f7a3c';
    for (const [dx, dy, r] of [[-30, 22, 16], [-62, 40, 11]]) { ctx.beginPath(); ctx.ellipse(base.x + dx, base.y + dy, r * up + 1, r * 0.6 * up + 1, 0, Math.PI, 0); ctx.fill(); }
    const ctrl = { x: (base.x + head.x) / 2 - 20, y: Math.min(base.y, head.y) - 30 };
    for (let i = 0; i <= 14; i++) {
      const u = i / 14, iu = 1 - u;
      const x = iu * iu * base.x + 2 * iu * u * ctrl.x + u * u * head.x, y = iu * iu * base.y + 2 * iu * u * ctrl.y + u * u * head.y;
      ctx.fillStyle = i % 2 ? '#3f9a4d' : '#368a43';
      ctx.beginPath(); ctx.arc(x, y, 17 - u * 5, 0, Math.PI * 2); ctx.fill();
      if (i % 3 === 1) { ctx.fillStyle = '#b8d98a'; ctx.beginPath(); ctx.moveTo(x - 4, y - 14); ctx.lineTo(x + 2, y - 24); ctx.lineTo(x + 6, y - 12); ctx.fill(); }
    }
    // Head, mouth open on the strikes.
    const open = Math.max(0, 1 - Math.abs(t - hitAltar) * 3) + Math.max(0, 1 - Math.abs(t - hitBoat) * 3);
    // (It faces right, toward the altar.)
    ctx.fillStyle = '#3f9a4d'; ctx.beginPath(); ctx.ellipse(head.x + 6, head.y, 27, 17, 0.15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b8d98a'; ctx.beginPath(); ctx.ellipse(head.x + 12, head.y + 10 + open * 9, 20, 7, 0.15, 0, Math.PI * 2); ctx.fill();
    if (open > 0.1) { ctx.fillStyle = '#5a1020'; ctx.beginPath(); ctx.ellipse(head.x + 14, head.y + 5 + open * 4, 14, 4 + open * 5, 0.15, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(head.x + 2, head.y - 9, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(head.x + 4, head.y - 9, 3.4, 0, Math.PI * 2); ctx.fill();
  }

  // Night and storm over everything: dark blue, rain, lightning on the strikes.
  ctx.fillStyle = 'rgba(10,20,45,0.38)'; ctx.fillRect(-10, -10, W + 20, H + 20);
  ctx.strokeStyle = 'rgba(190,210,255,0.35)'; ctx.lineWidth = 1;
  for (let i = 0; i < 70; i++) {
    const x = (i * 97 + t * 260) % (W + 40) - 20, y = (i * 53 + t * 520) % (H + 40) - 20;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 5, y + 13); ctx.stroke();
  }
  const flash = Math.max(0, 1 - Math.abs(t - hitAltar) * 6) * 0.7 + Math.max(0, 1 - Math.abs(t - hitBoat) * 6) * 0.5 + (t > 0.5 && t < 0.62 ? 0.4 : 0);
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(-10, -10, W + 20, H + 20); }
  ctx.restore();
}
