// lake-quest.js — the Lake Quest (Nick, 2026-11-13): design a boat at the Boat Builder
// (boat-builder.html, opened from the Lake Watcher) that carries you and 60 stones to
// the island in one trip, sail across, build the altar, and learn Heal.
//
//   1. Lake Watcher -> "Design a boat" -> boat-builder.html. When a design carries
//      the rider and 60 stones, the page posts 'boat-passed' and the boat is saved.
//   2. The dock on the south shore: with a boat, "Sail to the island".
//   3. The island: walk up to the altar's foundation and build it -> Heal is learned.
//      Heal can be cast once per battle (battle.js), restoring HEAL_HP.
//   4. The island's landing: "Sail back".
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
  if (s.boat) return 'Your boat is tied up at the dock, just south of the lake. Walk onto the dock to sail across, then build the altar on the island.';
  return 'The old altar on the island has fallen. To rebuild it, someone must carry 60 stones of 5 kg each across the lake, and themselves too, in ONE trip. Design a boat that can do it. Whoever rebuilds it learns the Heal spell.';
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

function lqSailTo(spot, dir, arrivesOn) {
  const p = placeFeetAtTile(spot.col, spot.row);
  player.x = p.x; player.y = p.y; player.dir = dir;
  // Arriving on a trigger spot mustn't fire it: landing on the island used to ask
  // "Sail back?" the moment you got there. You step off and back on to use it.
  lqWasOn = arrivesOn || null;
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
    lqModal('The Dock', 'A good place to launch a boat, if you had one. The Lake Watcher, by the shore, knows what it would take.', [['OK']]);
    return;
  }
  const s = lqState();
  lqModal('Your Boat', `Your boat is loaded with 60 stones, with room for you.${s.design ? `<br><small>(${s.design})</small>` : ''}`,
    [['⛵ Sail to the island', () => lqSailTo(LAKE.landing, 'north', 'landing')], ['Not yet']]);
}
function lqAtLanding() {
  lqModal('The Island', lqState().altar ? 'The altar is rebuilt. Ready to row back?' : 'The altar\'s foundation is just ahead. Rebuild it with your stones, or row back.',
    [['⛵ Sail back to shore', () => lqSailTo(LAKE.shoreReturn, 'south')], ['Stay']]);
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
  const a = at(LAKE.altar);
  if (a.x < -8 * TILE || a.x > mapCanvas.width + 8 * TILE || a.y < -8 * TILE || a.y > mapCanvas.height + 12 * TILE) return;
  const s = lqState();
  // A short wooden dock out from the shore.
  const d = at(LAKE.boatDock);
  ctx.fillStyle = '#7a5230'; ctx.fillRect(d.x - TILE * 0.55, d.y + TILE * 0.15, TILE * 0.45, TILE * 1.1);
  ctx.fillStyle = '#5e3e22';
  for (let i = 0; i < 4; i++) ctx.fillRect(d.x - TILE * 0.55, d.y + TILE * (0.15 + i * 0.27), TILE * 0.45, 2);
  // The boat: at the dock until the altar is built (it's on the island while you're there).
  if (s.boat) {
    const fb = feetBox(player.x, player.y); // feet, not the sprite's top-left
    const onIsland = scene.mode === 'world' && fb.y + fb.h / 2 < (LAKE.boatIsland.row + 0.5) * TILE;
    drawLakeBoat(ctx, at(onIsland ? LAKE.boatIsland : LAKE.boatDock), !s.altar && !onIsland);
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
function drawLakeBoat(ctx, p, loaded) {
  const x = p.x + TILE * 0.05, y = p.y + TILE * 0.2, w = TILE * 0.9, h = TILE * 0.6;
  ctx.fillStyle = '#6b3f7a'; // the monster skin
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w * 0.85, y + h); ctx.lineTo(x + w * 0.15, y + h); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#a0703f'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, 3);
  if (loaded) {
    ctx.fillStyle = '#8c8f93';
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(x + w * (0.2 + i * 0.12), y + h * 0.4, TILE * 0.07, 0, Math.PI * 2); ctx.fill(); }
  }
}
