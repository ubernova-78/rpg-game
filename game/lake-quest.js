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
  if (s.altar) return 'The altar on the island glows again, thanks to you. Remember: in battle, you can cast the Heal spell once per fight.';
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
    lqModal('The Altar', `The crystal hums. You know the <strong>Heal spell</strong>: once in every battle, cast it to get back ${HEAL_HP} HP.`, [['OK']]);
    return;
  }
  if (!lqState().boat) {
    lqModal('The Altar', 'A fallen altar. It needs 60 stones to rebuild.', [['OK']]);
    return;
  }
  lqModal('The Altar', 'You unload all 60 stones from your boat. Stack them to rebuild the altar?', [
    ['Rebuild the altar', () => {
      lqSave({ altar: true });
      lqModal('✨ You learned the Heal spell!', `The crystal lights up as the last stone goes in. In battle, you can now cast the <strong>Heal spell</strong> once per fight to get back ${HEAL_HP} HP.`, [['Great!']]);
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
  if (lqCut) return; // the flashback draws the altar itself (drawLakeCutscene)
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
    ? `You did it! The altar glows again, and the crystal taught you the <strong>Heal spell</strong>. Once in every battle, it gives you back ${HEAL_HP} HP.`
    : s.boat
      ? 'You built a boat that can carry it all! It\'s tied up at the pier by the Boatwright\'s Hut. Row it to the island and rebuild the altar.'
      : 'Head north to the lake. The <strong>Boatwright\'s Hut</strong> is on the north-west shore: design your boat at the drafting desk inside.';
  witchPage(hint, [['Tell me the story again', () => witchStory(0)], ['Thanks!', closeWorkbench]]);
}
const WITCH_STORY = [
  { text: 'Ah, a new face! Come closer, dear. Do you see the island in the middle of the lake? Let me tell you what happened there.' },
  { text: 'An altar stood on that island, with a crystal that could heal any wound. Then, one stormy night, a <strong>lake serpent</strong> rose out of the water. It smashed the altar to rubble, swallowed the altar\'s keeper whole, and splintered the only boat we had.', scene: true },
  { text: 'Nobody has crossed since. We have no boat, and nobody knows how to build one strong enough. To rebuild the altar, someone must carry <strong>60 stones of 5 kg</strong> each, and themselves, across the lake in <strong>one trip</strong>.' },
  { text: `Whoever rebuilds the altar will be rewarded. The crystal will teach them the <strong>Heal spell</strong>: once in every battle, they can cast it to get back ${HEAL_HP} HP.` },
  { text: 'Where to start? Walk north to the lake. On its north-west shore is the old <strong>Boatwright\'s Hut</strong>. Use the drafting desk inside to design a boat that can carry you and all 60 stones. Good luck, dear!<br><br><em>Oh, and one more thing. No one has seen the serpent since that night, but some people think it\'s still down there. Let\'s hope it has gone back to the depths forever...</em>', last: true },
];
function witchStory(i) {
  const p = WITCH_STORY[i];
  const step = `${i + 1} of ${WITCH_STORY.length}`;
  if (p.scene) { startLakeCutscene(p.text, step, [['▶ Watch again', () => witchStory(i)], ['Next', () => witchStory(i + 1)]]); return; }
  const buttons = p.last
    ? [['I\'ll do it!', () => { lqHeardStory = true; closeWorkbench(); }]]
    : [['Next', () => witchStory(i + 1)]];
  witchPage(p.text, buttons, step);
}
function witchPage(html, buttons, step) {
  endLakeCutscene();
  scene.modalOpen = true;
  wbModal.classList.add('story');
  wbModalCloseHook = () => { endLakeCutscene(); wbModal.classList.remove('story'); };
  wbTitle.textContent = 'Witch Hazel' + (step ? ` (${step})` : '');
  wbBody.innerHTML = '';
  const p = document.createElement('p'); p.innerHTML = html; p.style.margin = '0 0 6px'; wbBody.appendChild(p);
  for (const [label, fn] of buttons) wbBody.appendChild(gateButton(label, fn));
  wbModal.classList.remove('hidden');
}

// ---------- The flashback, played in the game itself ----------
// (Nick, 2026-11-13: not a separate view; the same size as the game, as if it plays
// out there.) The camera pans from you to the island (0.8 s), the scene plays on the
// real map at night in a storm, and the witch's words sit in a caption box at the
// bottom of the game screen with Watch again / Next. Next (or the end of Watch again)
// pans back. Your controls are locked meanwhile (scene.modalOpen).
//
// Everything in the scene is drawn into a low-resolution buffer at the art's own
// 16 px tiles and scaled up 3x with no smoothing, so the serpent is pixel art like
// everything else; it's darker and scarier (near-black outline, swamp green, bone
// spines, red eyes, fangs). Scene time ts = seconds since the pan finished:
//   0.5 lightning; 1.6-2.6 the serpent rises between the old boat and the island;
//   3.4 it smashes the altar; 3.9 it swallows the keeper; 4.6 it splinters the boat;
//   5.1-6.1 it sinks.
let lqCut = null;            // { t0, html, step, buttons }
const PAN = 0.8, SCENE_END = 6.6;
// The altar's keeper: a robed elder, so they don't look like a student's default character.
const LQ_KEEPER = { spec: { head: 'head4', hair: 'hair9', top: 'top12', bottom: 'bottom7', hat: 'hat5', skinTone: 2, variantIndex: { top: 2, hat: 3 } }, sheet: null };
let captionEl = null;
function startLakeCutscene(html, step, buttons) {
  wbModal.classList.add('hidden'); wbModal.classList.remove('story');
  scene.modalOpen = true;
  lqCut = { t0: performance.now() };
  if (!captionEl) {
    captionEl = document.createElement('div'); captionEl.className = 'cut-caption';
    document.getElementById('mapWrap').appendChild(captionEl);
  }
  captionEl.innerHTML = `<div class="who">Witch Hazel (${step})</div><div class="txt">${html}</div><div class="btns"></div>`;
  const bb = captionEl.querySelector('.btns');
  for (const [label, fn] of buttons) { const b = document.createElement('button'); b.textContent = label; b.addEventListener('click', fn); bb.appendChild(b); }
  const x = document.createElement('button'); x.textContent = 'Close'; x.className = 'ghost';
  x.addEventListener('click', () => { endLakeCutscene(); scene.modalOpen = false; }); bb.appendChild(x);
  captionEl.classList.remove('hidden');
}
function endLakeCutscene() { lqCut = null; if (captionEl) captionEl.classList.add('hidden'); }

// Where the camera should centre (world px) while the flashback runs, or null.
// updateCamera (world.js) asks this each frame.
function lakeCutsceneFocus() {
  if (!lqCut) return null;
  const t = (performance.now() - lqCut.t0) / 1000;
  const ease = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const size = FRAME * SCALE, me = { x: player.x + size / 2, y: player.y + size / 2 };
  const isle = { x: 30.6 * TILE, y: 4.6 * TILE };
  const k = ease(t / PAN) * (1 - ease((t - PAN - SCENE_END) / PAN));
  if (t > PAN * 2 + SCENE_END) { /* back with you: hold until Next */ }
  return { x: me.x + (isle.x - me.x) * k, y: me.y + (isle.y - me.y) * k };
}

let cutBuf = null;
function drawLakeCutscene() {
  if (!lqCut || scene.mode !== 'world') return;
  const ts = (performance.now() - lqCut.t0) / 1000 - PAN;
  if (ts < 0 || ts > SCENE_END) { if (ts > SCENE_END + PAN) return; }
  const ease = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const hitAltar = 3.4, gulp = 3.9, hitBoat = 4.6;
  const t = Math.max(0, Math.min(ts, SCENE_END));
  const N = TILE_NATIVE; // native px per tile; the buffer is the view at 1/SCALE
  const bw = Math.ceil(mapCanvas.width / SCALE) + 2, bh = Math.ceil(mapCanvas.height / SCALE) + 2;
  if (!cutBuf || cutBuf.width !== bw || cutBuf.height !== bh) { cutBuf = document.createElement('canvas'); cutBuf.width = bw; cutBuf.height = bh; }
  const g = cutBuf.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, bw, bh);
  const ox = Math.floor(camera.x / SCALE), oy = Math.floor(camera.y / SCALE);
  const P = (c, r) => ({ x: Math.round(c * N - ox), y: Math.round(r * N - oy) }); // tile -> buffer px
  const dot = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(Math.round(x), Math.round(y), r, 0, Math.PI * 2); g.fill(); };
  const shake = Math.max(0, 1 - Math.abs(t - hitAltar) * 4) + Math.max(0, 1 - Math.abs(t - hitBoat) * 4);

  // The altar, whole (and glowing) until it's struck, then rubble and flying bits.
  const A = P(LAKE.altar.col, LAKE.altar.row);
  if (t < hitAltar) {
    if (LAKE_ART.pedestal.complete !== false) g.drawImage(LAKE_ART.pedestal, A.x, A.y - N, N, N * 2);
    g.globalAlpha = 0.35 + 0.25 * Math.sin(t * 5); dot(A.x + N / 2, A.y - N * 0.85, 7, '#9fe7ff'); g.globalAlpha = 1;
    g.drawImage(LAKE_ART.crystal, A.x, A.y - N * 1.45, N, N);
  } else {
    for (const [ox2, oy2, r] of [[0.25, 0.6, 2.6], [0.55, 0.65, 3.2], [0.75, 0.45, 2.3], [0.45, 0.35, 2.4]]) dot(A.x + N * ox2, A.y + N * oy2, r, '#8a8f94');
    const k = Math.min(1, (t - hitAltar) / 0.9);
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2 + 0.4, d = N * (0.6 + 1.6 * k) * (0.6 + (i % 3) * 0.25);
      dot(A.x + N / 2 + Math.cos(a) * d, A.y + Math.sin(a) * d * 0.6 - N * 1.2 * Math.sin(k * Math.PI) * (i % 2 ? 1 : 0.6), i % 3 ? 1.5 : 1, i % 3 ? '#8a8f94' : '#9fe7ff');
    }
  }

  // The serpent's head path (buffer px), worked out first so the keeper can be
  // swallowed into its mouth.
  const base = P(27.3, 3.6);
  const up = ease((t - 1.6) / 1.0) * (1 - ease((t - 5.1) / 1.0));
  const K = P(33.4, 4.6), B = P(LAKE.islandEdge - 1.1, LAKE.row + 0.5);
  const rear = { x: base.x + 10, y: base.y - N * 1.6 };
  const atAltar = { x: A.x - 2, y: A.y - N * 0.4 }, atKeeper = { x: K.x - 6, y: K.y - N * 0.6 }, atBoat = { x: B.x - 4, y: B.y - 4 };
  const go = (a, b, k) => ({ x: a.x + (b.x - a.x) * ease(k), y: a.y + (b.y - a.y) * ease(k) });
  let head = t < 3.0 ? rear : t < hitAltar ? go(rear, atAltar, (t - 3.0) / 0.4) : t < gulp ? go(atAltar, atKeeper, (t - hitAltar - 0.1) / 0.35)
    : t < hitBoat ? go(atKeeper, atBoat, (t - gulp - 0.15) / 0.5) : go(atBoat, rear, (t - hitBoat) / 0.5);
  head = { x: base.x + (head.x - base.x) * up, y: base.y + (head.y - base.y) * up };
  const mouth = { x: head.x + 7, y: head.y + 3 };

  // The keeper, by the altar: calm, then trembling, then snatched (gulp).
  if (!LQ_KEEPER.sheet && typeof buildStaticSheet === 'function') LQ_KEEPER.sheet = buildStaticSheet(LQ_KEEPER.spec);
  if (LQ_KEEPER.sheet && t < gulp) {
    let kx = K.x + (t > 1.9 ? Math.round(Math.sin(t * 40)) : 0), ky = K.y, sc = 1;
    if (t > gulp - 0.25) { const k = (t - (gulp - 0.25)) / 0.25; kx += (mouth.x - kx) * k; ky += (mouth.y - ky) * k - 6 * Math.sin(k * Math.PI); sc = 1 - 0.8 * k; }
    const row = t > 1.9 ? DIR_ROW.west : DIR_ROW.south, sz = Math.round(FRAME * sc);
    g.drawImage(LQ_KEEPER.sheet, WALK_COLS[1] * FRAME, row * FRAME, FRAME, FRAME, Math.round(kx - sz / 2), Math.round(ky - sz * 0.8), sz, sz);
  }

  // The old boat at the island's west landing, then planks drifting apart.
  if (t < hitBoat) {
    g.fillStyle = '#3d2814'; g.fillRect(B.x - 13, B.y - 6, 26, 12);
    g.fillStyle = '#7a5230'; g.fillRect(B.x - 12, B.y - 5, 24, 10);
    g.fillStyle = '#5e3e22'; g.fillRect(B.x - 9, B.y - 3, 18, 6);
    g.fillStyle = '#a0703f'; g.fillRect(B.x - 4, B.y - 12, 2, 9);
  } else {
    const k = Math.min(1, (t - hitBoat) / 1.5);
    for (let i = 0; i < 6; i++) {
      const a = i * 1.1, d = N * (0.2 + 1.1 * k) * (0.5 + (i % 3) * 0.3);
      g.save(); g.translate(Math.round(B.x + Math.cos(a) * d), Math.round(B.y + Math.sin(a) * d * 0.7)); g.rotate(Math.round((a + k * (i % 2 ? 1.5 : -1.2)) * 4) / 4);
      g.fillStyle = '#3d2814'; g.fillRect(-6, -2, 12, 4); g.fillStyle = '#7a5230'; g.fillRect(-5, -1, 10, 2); g.restore();
    }
  }

  // The serpent, pixel art: outline pass, then body, belly, spines; head last.
  if (up > 0.01) {
    const OUT = '#0b1410', BODY = '#1f4d33', LIGHT = '#2e6b45', BELLY = '#8f9c5c', BONE = '#d9d2b4';
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1;
    g.beginPath(); g.ellipse(base.x, base.y, 9 + 2 * Math.sin(t * 6), 3, 0, 0, Math.PI * 2); g.stroke(); // ring where it breaks the water
    for (const [dx, dy, r] of [[-12, 8, 6], [-24, 14, 4]]) { dot(base.x + dx, base.y + dy, r * up + 1, OUT); dot(base.x + dx, base.y + dy - 1, r * up, BODY); }
    const ctrl = { x: (base.x + head.x) / 2 - 8, y: Math.min(base.y, head.y) - 10 };
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const u = i / 16, iu = 1 - u;
      pts.push({ x: iu * iu * base.x + 2 * iu * u * ctrl.x + u * u * head.x, y: iu * iu * base.y + 2 * iu * u * ctrl.y + u * u * head.y, r: 6.5 - u * 2.5 });
    }
    for (const q of pts) dot(q.x, q.y, q.r + 1, OUT);
    for (const [i, q] of pts.entries()) { dot(q.x, q.y, q.r, i % 2 ? BODY : LIGHT); dot(q.x + 1, q.y + q.r * 0.5, q.r * 0.45, BELLY); }
    for (const [i, q] of pts.entries()) if (i % 2 === 1 && i < 15) {
      g.fillStyle = OUT; g.beginPath(); g.moveTo(q.x - 3, q.y - q.r + 1); g.lineTo(q.x - 1, q.y - q.r - 6); g.lineTo(q.x + 2, q.y - q.r + 1); g.fill();
      g.fillStyle = BONE; g.beginPath(); g.moveTo(q.x - 2, q.y - q.r + 1); g.lineTo(q.x - 1, q.y - q.r - 4); g.lineTo(q.x + 1, q.y - q.r + 1); g.fill();
    }
    // Head: a long wedge snout facing right, jaw dropping open on each strike.
    const open = Math.max(0, 1 - Math.abs(t - hitAltar) * 3) + Math.max(0, 1 - Math.abs(t - gulp + 0.1) * 4) + Math.max(0, 1 - Math.abs(t - hitBoat) * 3);
    const hx = Math.round(head.x), hy = Math.round(head.y), jaw = Math.round(2 + open * 4);
    // Upper head, column by column: a heavy brow at the back sloping down to a narrow snout.
    const colTop = x => Math.round(-6 + Math.max(0, x - 3) * 0.45), colLen = 18;
    for (let x = -1; x <= colLen; x++) { const top = colTop(Math.max(0, x)); g.fillStyle = OUT; g.fillRect(hx - 7 + x, hy + top - 1, 1, 4 - top); }
    for (let x = 0; x < colLen; x++) { const top = colTop(x); g.fillStyle = BODY; g.fillRect(hx - 7 + x, hy + top, 1, 2 - top); g.fillStyle = LIGHT; g.fillRect(hx - 7 + x, hy + top, 1, 1); }
    g.fillStyle = OUT; g.fillRect(hx - 6, hy + 2, colLen - 2, jaw + 3);                // jaw outline
    g.fillStyle = '#4a0f14'; g.fillRect(hx - 5, hy + 2, colLen - 4, jaw);              // mouth
    g.fillStyle = BELLY; g.fillRect(hx - 5, hy + 2 + jaw, colLen - 5, 2);              // lower jaw
    g.fillStyle = BONE; for (let x = hx - 4; x < hx + colLen - 8; x += 3) { g.fillRect(x, hy + 2, 1, 2); g.fillRect(x + 1, hy + jaw, 1, 2); } // fangs
    g.fillStyle = BONE; g.fillRect(hx + colLen - 9, hy + 2, 1, 3);                     // a long front fang
    g.fillStyle = OUT; g.fillRect(hx - 5, hy - 9, 3, 4); g.fillRect(hx - 1, hy - 8, 2, 3); // horns
    g.fillStyle = BONE; g.fillRect(hx - 4, hy - 8, 1, 3);
    g.fillStyle = OUT; g.fillRect(hx - 1, hy - 6, 6, 1);                               // brow ridge over the eye
    g.fillStyle = '#ff2a1a'; g.fillRect(hx, hy - 5, 3, 2);                              // eye
    g.fillStyle = '#ffd34a'; g.fillRect(hx + 1, hy - 5, 1, 1);
    g.globalAlpha = 0.35; dot(hx + 1, hy - 4, 4, '#ff2a1a'); g.globalAlpha = 1;          // its glow
    g.fillStyle = OUT; g.fillRect(hx + colLen - 9, hy - 3, 1, 1);                       // nostril
  }

  // Up to the screen, 3x, no smoothing (shaking on the strikes).
  const ctx = mapCtx;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const sx = Math.sin(t * 90) * 6 * shake, sy = Math.cos(t * 77) * 5 * shake;
  ctx.drawImage(cutBuf, ox * SCALE - camera.x + sx, oy * SCALE - camera.y + sy, bw * SCALE, bh * SCALE);
  // Night and storm over the whole view; rain; lightning on the strikes.
  const W = mapCanvas.width, H = mapCanvas.height;
  const dark = Math.min(1, ts / 0.4) * (ts > SCENE_END ? Math.max(0, 1 - (ts - SCENE_END) / PAN) : 1);
  ctx.fillStyle = `rgba(10,20,45,${0.42 * dark})`; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = `rgba(190,210,255,${0.35 * dark})`; ctx.lineWidth = 2;
  for (let i = 0; i < 80; i++) {
    const x = (i * 97 + ts * 300) % (W + 40) - 20, y = (i * 53 + ts * 620) % (H + 40) - 20;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 6, y + 16); ctx.stroke();
  }
  const flash = (Math.max(0, 1 - Math.abs(t - hitAltar) * 6) * 0.7 + Math.max(0, 1 - Math.abs(t - hitBoat) * 6) * 0.5 + (t > 0.5 && t < 0.62 ? 0.4 : 0)) * dark;
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, 0, W, H); }
  if (t > gulp && t < gulp + 0.7) {
    ctx.font = 'bold 40px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 6; ctx.strokeStyle = '#3a0a0a'; ctx.strokeText('GULP!', W / 2, 60);
    ctx.fillStyle = '#fff'; ctx.fillText('GULP!', W / 2, 60);
  }
  ctx.restore();
}
