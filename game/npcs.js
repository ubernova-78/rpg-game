// npcs.js — standalone NPC character sheets, wandering behavior, and dialogue.

// ---------- NPCs ----------
// A minimal standalone character compositor for NPCs — reuses the same layer order and
// frame layout as the player, but with a fixed appearance (no equipment system) baked
// once into its own canvas at boot rather than recomposited every frame.
function findManifestIndex(key, id) {
  return MANIFEST[key].findIndex(e => e.id === id);
}
function buildStaticSheet(spec) {
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_W; canvas.height = SHEET_H;
  const ctx = canvas.getContext('2d');
  const layerKeys = ['backextra', 'backhair', 'bottom', 'top', 'head', 'hair', 'frontextra', 'hat', 'weapon'];
  const files = {};
  const paths = ['assets/shadow/shadow.png'];
  for (const key of layerKeys) {
    const id = spec[key];
    if (!id) continue;
    const idx = findManifestIndex(key, id);
    if (idx < 0) continue;
    const vi = (spec.variantIndex && spec.variantIndex[key]) || 0;
    const variants = MANIFEST[key][idx].variants;
    const file = `assets/${key}/${variants[Math.min(vi, variants.length - 1)]}`;
    files[key] = file;
    paths.push(file);
  }
  const imgs = paths.map(loadImage);
  function drawLayerRow(key, row) {
    const path = key === 'shadow' ? 'assets/shadow/shadow.png' : files[key];
    if (!path) return;
    const img = imgCache[path];
    if (!img || !img.complete || img.naturalWidth === 0) return;
    const sy = row * FRAME;
    ctx.drawImage(img, 0, sy, SHEET_W, FRAME, 0, sy, SHEET_W, FRAME);
  }
  function draw() {
    ctx.clearRect(0, 0, SHEET_W, SHEET_H);
    drawLayerRow('shadow', 0); drawLayerRow('shadow', 1); drawLayerRow('shadow', 2); drawLayerRow('shadow', 3);
    for (let row = 0; row < 4; row++) {
      const order = row === DIR_ROW.north ? ORDER_NORTH : ORDER_DEFAULT;
      for (const key of order) drawLayerRow(key, row);
    }
    if (spec.skinTone) {
      const target = SKIN_RGB[spec.skinTone], base = SKIN_RGB[0];
      const data = ctx.getImageData(0, 0, SHEET_W, SHEET_H);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] === 0) continue;
        for (let c = 0; c < base.length; c++) {
          if (px[i] === base[c][0] && px[i + 1] === base[c][1] && px[i + 2] === base[c][2]) {
            px[i] = target[c][0]; px[i + 1] = target[c][1]; px[i + 2] = target[c][2];
            break;
          }
        }
      }
      ctx.putImageData(data, 0, 0);
    }
  }
  // Draw immediately if all images are ready, otherwise redraw once they arrive.
  if (imgs.every(im => im.complete && im.naturalWidth > 0)) {
    draw();
  } else {
    const onReady = () => {
      if (imgs.every(im => im.complete)) draw();
    };
    for (const im of imgs) {
      if (!im.complete) {
        im.addEventListener('load', onReady);
        im.addEventListener('error', onReady);
      }
    }
  }
  return canvas;
}

const NPC_DEFS = [
  {
    id: 'forest', name: 'Forest Ranger',
    homeCol: TOWN_OFFSET_COL + TOWN_COLS + 6, homeRow: TOWN_OFFSET_ROW + Math.floor(TOWN_ROWS / 2),
    range: 3,
    spec: { head: 'head3', hair: 'hair7', top: 'top8', bottom: 'bottom6', skinTone: 1 },
    message: "You could get much better by training at the archery range! Hit the monster to win a Hunter's Bow — but you'll need to measure your accuracy in meters.",
    game: { src: 'archery-range.html', messageType: 'archery-login', label: 'Archery Range' },
  },
  {
    id: 'lake', name: 'Lake Watcher',
    homeCol: TOWN_OFFSET_COL + 7, homeRow: TOWN_OFFSET_ROW - 2,
    range: 2,
    spec: { head: 'head5', hair: 'hair3', top: 'top4', bottom: 'bottom2', skinTone: 0 },
    message: 'The currents whisper that great challenges are coming. Keep training!',
  },
  {
    id: 'rocky', name: 'Stone Warden',
    // West of the cave's entrance (not right on top of it) — the door sits at
    // CAVE_COL+2, so this keeps the Warden's wander radius clear of anyone walking up
    // to go inside.
    homeCol: CAVE_COL - 3, homeRow: CAVE_ROW + 1,
    range: 2,
    spec: { head: 'head7', hair: 'hair10', top: 'top10', bottom: 'bottom8', skinTone: 2 },
    message: "These old stones have seen many heroes rise. Keep at your training — we'll need you soon.",
  },
  {
    id: 'grassland', name: 'Field Guide',
    homeCol: TOWN_OFFSET_COL + Math.floor(TOWN_COLS / 2), homeRow: TOWN_OFFSET_ROW + TOWN_ROWS + 5,
    range: 3,
    spec: { head: 'head1', hair: 'hair5', top: 'top3', bottom: 'bottom3', skinTone: 3 },
    message: "Follow the path south, past the flowers, to the old Rune Circle. Stand on the stake in the middle, hook your tape measure on it, and find out how far away each rune is.",
  },
  {
    id: 'shopkeeper', name: 'Potion Seller', isShop: true,
    homeCol: TOWN_OFFSET_COL + 6, homeRow: TOWN_OFFSET_ROW + 1,
    range: 1,
    spec: { head: 'head2', hair: 'hair8', top: 'top6', bottom: 'bottom4', skinTone: 1 },
  },
  {
    id: 'potionmaster', name: 'Potion Master',
    homeCol: CLEARING_COL, homeRow: CLEARING_ROW,
    range: 2,
    spec: {
      head: 'head4', hair: 'hair9', top: 'top12', bottom: 'bottom7',
      hat: 'hat5', weapon: 'spear1_c2', skinTone: 0,
      variantIndex: { top: 4 }, // dark navy robe
    },
    message: "The forest holds many secrets for those who know how to measure. Gather ingredients for my potions — but you'll need sharp eyes and a steady caliper hand.",
    game: { src: 'potion-quest.html', messageType: 'potion-login', label: 'Potion Gathering' },
  },
  {
    id: 'woodsman', name: 'Woodsman',
    homeCol: CLEARING_COL - 2, homeRow: CLEARING_ROW + 4,
    range: 2,
    spec: {
      head: 'head6', hair: 'hair2', top: 'top5', bottom: 'bottom5',
      hat: 'hat2', weapon: 'axe1', skinTone: 2,
      variantIndex: { top: 2, hat: 1 }, // earthy brown top, brown leather hat
    },
    message: "Think you've got a steady arm? Try your hand at axe throwing! Land all 4 throws within 1.5 cm of center and measure every distance right on the first try to earn a Woodsman's Axe. It hits twice as hard in battle!",
    game: { src: 'axe-throw.html', messageType: 'axe-login', label: 'Axe Throwing', buttonLabel: 'Train at Axe Throwing' },
  },
];
for (const npc of NPC_DEFS) {
  npc.sheet = buildStaticSheet(npc.spec);
  npc.x = npc.homeCol * TILE;
  npc.y = npc.homeRow * TILE;
  npc.dir = 'south';
  npc.moving = false;
  npc.walkFrame = 1;
  npc.animT = 0;
  npc.pauseT = 1500 + Math.random() * 1500;
  npc.target = null;
}

function npcPickNewTarget(npc) {
  const homeX = npc.homeCol * TILE, homeY = npc.homeRow * TILE;
  const rx = (Math.random() * 2 - 1) * npc.range * TILE;
  const ry = (Math.random() * 2 - 1) * npc.range * TILE;
  npc.target = { x: homeX + rx, y: homeY + ry };
}

function updateNPCs(dt) {
  for (const npc of NPC_DEFS) {
    if (scene.modalOpen) { npc.moving = false; continue; }
    if (!npc.target) {
      if (npc.pauseT > 0) { npc.pauseT -= dt; npc.moving = false; continue; }
      npcPickNewTarget(npc);
    }
    const dx = npc.target.x - npc.x, dy = npc.target.y - npc.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) {
      npc.target = null;
      npc.pauseT = 1200 + Math.random() * 1800;
      npc.moving = false;
      continue;
    }
    npc.moving = true;
    const speed = 50 * dt / 1000; // gentle wander pace, slower than the player
    npc.x += (dx / dist) * speed;
    npc.y += (dy / dist) * speed;
    npc.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'south' : 'north');
    npc.animT += dt;
    if (npc.animT > 180) { npc.animT = 0; npc.walkFrame = (npc.walkFrame + 1) % PING_PONG.length; }
  }
}

function drawNPCs() {
  const size = FRAME * SCALE;
  for (const npc of NPC_DEFS) {
    const col = npc.moving ? PING_PONG[npc.walkFrame] : WALK_COLS[1];
    const row = DIR_ROW[npc.dir];
    const sx = col * FRAME, sy = row * FRAME;
    const dx = npc.x - camera.x, dy = npc.y - camera.y;
    if (dx > mapCanvas.width || dx + size < 0 || dy > mapCanvas.height || dy + size < 0) continue;
    mapCtx.drawImage(npc.sheet, sx, sy, FRAME, FRAME, Math.round(dx), Math.round(dy), size, size);
  }
}

function nearbyNpc(x, y) {
  const spriteSize = FRAME * SCALE;
  const cx = x + spriteSize / 2, cy = y + spriteSize / 2;
  for (const npc of NPC_DEFS) {
    const ncx = npc.x + spriteSize / 2, ncy = npc.y + spriteSize / 2;
    // A genuine walk-into, not "nearby" — roughly one tile of overlap, not a couple of
    // tiles of proximity, so an NPC/monster is actually avoidable if you want to avoid it.
    if (Math.hypot(cx - ncx, cy - ncy) < spriteSize * 0.32) return npc;
  }
  return null;
}
function openNpcDialogue(npc) {
  scene.modalOpen = true;
  wbTitle.textContent = npc.name;
  wbBody.innerHTML = '';
  const msg = document.createElement('p');
  msg.textContent = npc.message;
  msg.style.margin = '0 0 8px';
  wbBody.appendChild(msg);
  if (npc.game) {
    wbBody.appendChild(gateButton((npc.game.buttonLabel || 'Train at the ' + npc.game.label), () => {
      closeWorkbench();
      openGameOverlay(npc.game);
    }));
  }
  wbModal.classList.remove('hidden');
}

// ---------- Boot-time content check ----------
// There is no test runner on the teacher's machine, so this is the substitute:
// it catches the content mistakes that otherwise show up as a frozen game in
// the middle of a lesson. Console only — students never see it.
//
// The specific trap: adding a building to BUILDING_DEFS without an
// INTERIOR_SIZES entry throws inside enterBuilding the instant someone steps on
// the door, and an exception anywhere in the frame loop stops every future
// frame (see the try/catch below). This turns that into one line at page load.
function validateContent() {
  const problems = [];
  const seenObjIds = new Set();

  for (const b of BUILDING_DEFS) {
    if (!INTERIOR_SIZES[b.id]) problems.push(`building "${b.id}" has no INTERIOR_SIZES entry — entering it would freeze the game`);
  }
  for (const [roomId, objs] of Object.entries(INTERIOR_OBJECTS)) {
    if (!INTERIOR_SIZES[roomId]) problems.push(`INTERIOR_OBJECTS has a room "${roomId}" with no INTERIOR_SIZES entry`);
    for (const o of objs) {
      if (seenObjIds.has(o.id)) problems.push(`duplicate object id "${o.id}" — findInteriorObject returns the first match and claimedChests is keyed by id`);
      seenObjIds.add(o.id);
      if (o.kind === 'workbench' && (!o.src || !o.messageType)) {
        problems.push(`workbench "${o.id}" is missing ${!o.src ? 'src' : 'messageType'} — it would open blank`);
      }
    }
  }
  for (const m of WORLD_MONSTER_DEFS) {
    if (m.sprite && !MONSTER_IMG[m.sprite]) problems.push(`monster "${m.id}" uses sprite "${m.sprite}", which has no MONSTER_IMG entry — it would be invisible but still start battles`);
  }
  for (const [tier, keys] of Object.entries(BATTLE_QUESTION_POOL)) {
    for (const k of (Array.isArray(keys) ? keys : [])) {
      if (!QUESTION_MODULES[k]) problems.push(`BATTLE_QUESTION_POOL.${tier} refers to question module "${k}", which does not exist — the battle would stick open`);
    }
  }

  if (problems.length) {
    console.error('[Physics Quest] content problems found at boot:');
    for (const p of problems) console.error('  • ' + p);
  }
  return problems;
}
try { validateContent(); } catch (e) { console.error('[Physics Quest] validateContent itself failed', e); }

let lastT = performance.now();
let loopErrorLogged = false;
function loop(t) {
  const dt = Math.min(50, t - lastT);
  lastT = t;
  // One thrown error used to end the game permanently: requestAnimationFrame
  // was the last statement, so nothing rescheduled and the screen simply froze
  // with only the console any the wiser. Keep drawing; log the first one.
  try {
    updatePlayer(dt);
    updateNPCs(dt);
    updateMonsters(dt);
    if (scene.mode === 'world') updateCamera();
    drawMap();
    drawPlayer();
  } catch (e) {
    if (!loopErrorLogged) { loopErrorLogged = true; console.error('[Physics Quest] error in frame loop', e); }
  }
  requestAnimationFrame(loop);
}

