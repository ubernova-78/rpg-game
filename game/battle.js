// battle.js — monster battle system: player HP, wandering monsters (both the forest/
// grassland world monsters AND, once the dagger chest is claimed, the cave's own
// monsters), real monster art, and the question-gated battle flow. Battles open in a
// full-screen overlay (same visual weight as the Workbench mini-game overlay) with the
// question on the left and the player/monster sprites + HP bars on the right, so battles
// reuse QUESTION_MODULES/quests.js's round-rendering but drive their own turn loop and
// combat-stage animation instead of the small openQuestionGate popup.

const PLAYER_MAX_HP = 5;
const playerStats = { hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP };

// +1 max HP every 10 levels on top of the base 5 (level 10-19 -> 6, 20-29 -> 7, ...).
// Whenever a level-up actually happens (see applyExpGain below), HP is healed to the new
// max immediately, not just next time they rest or use a potion.
function maxHpForLevel(level) {
  return PLAYER_MAX_HP + Math.floor(level / 10);
}
function applyExpGain(amount) {
  const before = Shared.getLevelInfo(session.record.totalEXP || 0).level;
  bankToRecord({ totalEXP: amount });
  const after = Shared.getLevelInfo(session.record.totalEXP).level;
  playerStats.maxHp = maxHpForLevel(after);
  if (after > before) playerStats.hp = playerStats.maxHp;
  else playerStats.hp = Math.min(playerStats.hp, playerStats.maxHp);
}

// ---------- Monster art ----------
// Real sprites (cropped single frames from the licensed action_monsters_10 pack, embedded
// via monster_assets.js/ASSET_DATA — same loadImage()/ASSET_DATA convention as every other
// image in this build). Drawn contain-fit inside the monster's on-map bounding box,
// anchored to the bottom-center like the world's decor art, so it reads as "standing on
// the ground" regardless of each sprite's native aspect ratio.
const MONSTER_IMG = {
  bat: loadImage('assets/monsters/bat.png'),
  slime: loadImage('assets/monsters/slime.png'),
  skull: loadImage('assets/monsters/skull.png'),
  pinecoon: loadImage('assets/monsters/pinecoon.png'),
  wasp: loadImage('assets/monsters/wasp.png'),
  snake: loadImage('assets/monsters/snake.png'),
};
function drawMonsterShape(ctx, def, x, y, size) {
  const img = MONSTER_IMG[def.sprite];
  if (!img || !img.complete || img.naturalWidth === 0) return; // not loaded yet — skip this frame
  const rawW = img.naturalWidth * SCALE, rawH = img.naturalHeight * SCALE;
  const fit = Math.min(1, size / Math.max(rawW, rawH));
  const dw = rawW * fit, dh = rawH * fit;
  const dx = x + size / 2 - dw / 2;
  const dy = y + size - dh; // bottom-anchored within the box
  ctx.drawImage(img, dx, dy, dw, dh);
}

// ---------- Shared wander behavior ----------
// Same gentle random-walk pattern NPC_DEFS uses in npcs.js (pause, pick a random point
// within `range` tiles of home, walk to it, pause again) — reused here for both world
// monsters (world pixel coordinates) and cave monsters (interior-room pixel coordinates,
// same TILE units, just a different bounding space).
function wanderStep(m, dt, area) {
  if (!m.target) {
    if (m.pauseT > 0) { m.pauseT -= dt; return; }
    // Try a few random points; take the first whose straight walk stays out of every
    // arrival zone (see ARRIVAL_CLEAR) and inside the area. None fits -> wait and retry.
    for (let tries = 0; tries < 12 && !m.target; tries++) {
      const t = {
        x: m.homeCol * TILE + (Math.random() * 2 - 1) * m.range * TILE,
        y: m.homeRow * TILE + (Math.random() * 2 - 1) * m.range * TILE,
      };
      if (area && area.bounds) {
        const b = area.bounds;
        t.x = Math.max(b.minX, Math.min(b.maxX, t.x));
        t.y = Math.max(b.minY, Math.min(b.maxY, t.y));
      }
      if (!area || area.arrivals.every(a => segmentDist(m, t, a) > ARRIVAL_CLEAR)) m.target = t;
    }
    if (!m.target) { m.pauseT = 800; return; }
  }
  const dx = m.target.x - m.x, dy = m.target.y - m.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 4) { m.target = null; m.pauseT = 1200 + Math.random() * 1800; return; }
  const speed = 40 * dt / 1000; // gentle wander pace
  m.x += (dx / dist) * speed;
  m.y += (dy / dist) * speed;
}
// Shortest distance from point p to the segment a-b (all {x, y}).
function segmentDist(a, b, p) {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
  return Math.hypot(a.x + t * vx - p.x, a.y + t * vy - p.y);
}

// ---------- Arrival zones ----------
// Monsters keep clear of every spot a player is put down at, so nobody walks into a
// room or out of a door straight into a fight (Nick, 2026-11-12: the Deep Cave's Flame
// Skull wandered over its entrance and started a battle the moment you came through).
// Points are player positions (player.x/y, which monsters' x/y are compared with), and
// a battle fires within FRAME*SCALE*0.32 (about a tile), so 2.5 tiles leaves a
// student about a tile and a half to see the monster and choose. Any new
// spawn, door or room entrance must be added here, and boot reports a monster whose
// home sits inside a zone (checkArrivalZones).
const ARRIVAL_CLEAR = TILE * 2.5;
function worldArrivals() {
  const pts = [placeFeetAtTile(WORLD_SPOTS.spawn[0], WORLD_SPOTS.spawn[1]),
    placeFeetAtTile(LAKE.landing.col, LAKE.landing.row), placeFeetAtTile(LAKE.shoreReturn.col, LAKE.shoreReturn.row)];
  for (const b of BUILDING_DEFS) {
    // Coming out of a door lands just south of it (exitBuilding).
    const d = buildingDoorTile(b), p = placeFeetAtTile(d.c, d.r);
    pts.push({ x: p.x, y: p.y + TILE * 0.6 });
  }
  return pts;
}
function caveDeepArrivals() {
  const it = interiorFor('caveDeep');
  return [placeFeetAtTile(it.exitCol, it.spawnRow), placeFeetAtTile(it.exitCol, it.exitRow)];
}
function caveDeepBounds() {
  const it = interiorFor('caveDeep'), size = FRAME * SCALE;
  return { minX: -size * 0.3, maxX: it.cols * TILE - size * 0.7, minY: TILE * 0.4, maxY: it.rows * TILE - size * 0.94 };
}
let WORLD_AREA = null, CAVE_AREA = null; // built on first update, once every def exists
function monsterAreas() {
  if (!WORLD_AREA) {
    WORLD_AREA = { arrivals: worldArrivals(), bounds: null };
    CAVE_AREA = { arrivals: caveDeepArrivals(), bounds: caveDeepBounds() };
  }
}
function checkArrivalZones() {
  monsterAreas();
  const problems = [];
  const check = (defs, area, where) => defs.forEach(m => {
    const home = { x: m.homeCol * TILE, y: m.homeRow * TILE };
    const d = Math.min(...area.arrivals.map(a => Math.hypot(home.x - a.x, home.y - a.y)));
    if (d <= ARRIVAL_CLEAR) problems.push(`${where} monster "${m.id}" lives ${Math.round(d)}px from an arrival point; keep it over ${ARRIVAL_CLEAR}px away`);
  });
  check(WORLD_MONSTER_DEFS, WORLD_AREA, 'world');
  check(CAVE_MONSTER_DEFS, CAVE_AREA, 'Deep Cave');
  if (problems.length) {
    console.error('[Physics Quest] monsters too close to where players arrive:');
    problems.forEach(p => console.error('  • ' + p));
  }
  return problems;
}
function initWanderer(m) {
  m.x = m.homeCol * TILE;
  m.y = m.homeRow * TILE;
  m.target = null;
  m.pauseT = 800 + Math.random() * 1500;
  m.alive = true;
  m.respawnAt = 0;
}

// ---------- Monster rosters ----------
// World monsters: wander a home area out in the forest/grassland biomes, and trigger a
// battle on contact instead of dialogue.
const WORLD_MONSTER_DEFS = [
  {
    id: 'pinecoon', name: 'Pinecoon', sprite: 'pinecoon', maxHp: 2, exp: 15, gold: 5,
    homeCol: WORLD_SPOTS.pinecoon[0], homeRow: WORLD_SPOTS.pinecoon[1],
    range: WORLD_SPOTS.pinecoon[2],
  },
  {
    id: 'meadowWasp', name: 'Meadow Wasp', sprite: 'wasp', maxHp: 1, exp: 10, gold: 3,
    homeCol: WORLD_SPOTS.meadowWasp[0], homeRow: WORLD_SPOTS.meadowWasp[1],
    range: WORLD_SPOTS.meadowWasp[2],
  },
  {
    id: 'grassSnake', name: 'Grass Snake', sprite: 'snake', maxHp: 3, exp: 20, gold: 8,
    homeCol: WORLD_SPOTS.grassSnake[0], homeRow: WORLD_SPOTS.grassSnake[1],
    range: WORLD_SPOTS.grassSnake[2],
  },
];
WORLD_MONSTER_DEFS.forEach(initWanderer);

// Cave monsters: wander inside the cave's DEEPER room (reached through the inner door,
// past the chest room — see world.js's 'caveDoor'/enterCaveDeepRoom), once the chest is
// claimed and the boulder pile has cleared. Positions are in that room's own interior-
// local tile coordinates (col/row), not the chest room's.
// Homes are in monster/player position units (x = homeCol*TILE, the sprite's top-left),
// so row 0-1 is the back of the room and the entrance (bottom middle) is far from all
// three: the bat and slime in the back corners, the skull at the back in the middle.
const CAVE_MONSTER_DEFS = [
  { id: 'caveBat', name: 'Cave Bat', sprite: 'bat', maxHp: 1, exp: 10, gold: 3, homeCol: 0.5, homeRow: 1.5, range: 1.5 },
  { id: 'caveSlime', name: 'Cave Slime', sprite: 'slime', maxHp: 2, exp: 15, gold: 5, homeCol: 6.5, homeRow: 1, range: 1.5 },
  { id: 'flameSkull', name: 'Flame Skull', sprite: 'skull', maxHp: 4, exp: 30, gold: 12, homeCol: 3.5, homeRow: 0.5, range: 1.5 },
];
CAVE_MONSTER_DEFS.forEach(initWanderer);

function caveMonstersActive() {
  const chest = findInteriorObject('swordChest');
  return !!(chest && chest.claimed);
}

function updateMonsters(dt) {
  const now = performance.now();
  monsterAreas();
  // A beaten monster comes back at its home, but not while the player stands there:
  // it would reappear on top of them and start a fight they didn't walk into.
  const playerAtHome = (m, here) => here && Math.hypot(player.x - m.homeCol * TILE, player.y - m.homeRow * TILE) <= ARRIVAL_CLEAR;
  const inWorld = scene.mode === 'world', inDeep = scene.mode === 'interior' && scene.buildingId === 'caveDeep';
  for (const m of WORLD_MONSTER_DEFS) {
    if (!m.alive) { if (now >= m.respawnAt && !playerAtHome(m, inWorld)) initWanderer(m); continue; }
    if (scene.modalOpen) continue;
    wanderStep(m, dt, WORLD_AREA);
  }
  if (!caveMonstersActive()) return;
  for (const m of CAVE_MONSTER_DEFS) {
    if (!m.alive) { if (now >= m.respawnAt && !playerAtHome(m, inDeep)) initWanderer(m); continue; }
    if (scene.modalOpen) continue;
    wanderStep(m, dt, CAVE_AREA);
  }
}

function monsterDrawables() {
  const size = FRAME * SCALE * 0.7;
  const out = [];
  for (const m of WORLD_MONSTER_DEFS) {
    if (!m.alive) continue;
    const dx = m.x - camera.x, dy = m.y - camera.y;
    if (dx > mapCanvas.width || dx + size < 0 || dy > mapCanvas.height || dy + size < 0) continue;
    out.push({ y: m.y + size * 0.85, draw: () => drawMonsterShape(mapCtx, m, Math.round(dx), Math.round(dy), size) });
  }
  return out;
}
// For drawInterior() (gameplay.js), which draws these inside its translate(ox,oy), so
// coordinates here are interior-local, same as furniture/objFootprint rendering.
function caveMonsterDrawables() {
  if (!caveMonstersActive()) return [];
  const size = FRAME * SCALE * 0.7;
  return CAVE_MONSTER_DEFS.filter(m => m.alive).map(m => ({
    y: m.y + size * 0.85,
    draw: () => drawMonsterShape(mapCtx, m, Math.round(m.x), Math.round(m.y), size),
  }));
}

function nearbyMonster(x, y) {
  const spriteSize = FRAME * SCALE;
  const cx = x + spriteSize / 2, cy = y + spriteSize / 2;
  for (const m of WORLD_MONSTER_DEFS) {
    if (!m.alive) continue;
    const mcx = m.x + spriteSize / 2, mcy = m.y + spriteSize / 2;
    // A genuine walk-into, not "nearby" — see nearbyNpc's comment.
    if (Math.hypot(cx - mcx, cy - mcy) < spriteSize * 0.32) return m;
  }
  return null;
}
function nearbyCaveMonster(x, y) {
  if (!caveMonstersActive()) return null;
  const spriteSize = FRAME * SCALE;
  const cx = x + spriteSize / 2, cy = y + spriteSize / 2;
  for (const m of CAVE_MONSTER_DEFS) {
    if (!m.alive) continue;
    const mcx = m.x + spriteSize / 2, mcy = m.y + spriteSize / 2;
    if (Math.hypot(cx - mcx, cy - mcy) < spriteSize * 0.32) return m;
  }
  return null;
}

// ---------- Round-type mix ----------
// BATTLE_QUESTION_POOL controls which skills appear in monster battles and
// PvP duels.  Edit this ONE object to add or remove question types — comment
// out a line to disable that skill, or change the weight to make it show up
// more or less often.  Every key must match an entry in QUESTION_MODULES
// (defined in placevalue.js and measure.js).
const BATTLE_QUESTION_POOL = {
  'place-value-read':    1,
  'place-value-build':   1,
  'place-value-point':   2,
  'measure-unit':        1,
  'measure-mm-read':     1,
  'measure-mm-caliper':  1,
  // 'measure-cm-read':  1,   // centimeter ruler — enable when ready
  // 'measure-m-read':   1,   // meter tape — enable when ready
};
function pickRoundKey() {
  // Only the types the teacher dashboard has on for this period. If that
  // leaves none (it shouldn't -- the dashboard keeps at least one on), use
  // them all rather than stall a battle.
  const all = Object.entries(BATTLE_QUESTION_POOL);
  const on = all.filter(([key]) => ClassSettings.questionOn(key));
  const entries = on.length ? on : all;
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [key, w] of entries) {
    if (r < w) return key;
    r -= w;
  }
  return entries[entries.length - 1][0];
}

// ---------- Battle overlay ----------
const battleOverlay = document.getElementById('battleOverlay');
const battleBody = document.getElementById('battleBody');
const battleModeTag = document.getElementById('battleModeTag');
const battleMonsterName = document.getElementById('battleMonsterName');
const battleMonsterHpFill = document.getElementById('battleMonsterHpFill');
const battlePlayerHpFill = document.getElementById('battlePlayerHpFill');
const battleMonsterSprite = document.getElementById('battleMonsterSprite');
const battlePlayerSprite = document.getElementById('battlePlayerSprite');

function closeBattle() {
  scene.modalOpen = false;
  battleOverlay.classList.add('hidden');
}
// Leave Battle button is a persistent DOM element (not rebuilt per battle), so it calls
// through this reference instead of a closure — runBattle() below points it at the
// current battle's own finish() each time one starts.
let currentBattleFinish = null;
document.getElementById('battleLeaveBtn').addEventListener('click', () => {
  if (currentBattleFinish) currentBattleFinish(false);
});

function drawBattlePlayerSprite() {
  const ctx = battlePlayerSprite.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, battlePlayerSprite.width, battlePlayerSprite.height);
  if (typeof sheetReady === 'undefined' || !sheetReady) return;
  const col = WALK_COLS[1], row = DIR_ROW.south; // idle, front-facing portrait pose
  const sx = col * FRAME, sy = row * FRAME;
  ctx.drawImage(sheetCanvas, sx, sy, FRAME, FRAME, 0, 0, battlePlayerSprite.width, battlePlayerSprite.height);
}

function updateHpBars(monsterHp, monsterMaxHp) {
  const pPct = Math.max(0, Math.round((playerStats.hp / playerStats.maxHp) * 100));
  const mPct = Math.max(0, Math.round((monsterHp / monsterMaxHp) * 100));
  battlePlayerHpFill.style.width = pPct + '%';
  battlePlayerHpFill.classList.toggle('low', pPct <= 40);
  battleMonsterHpFill.style.width = mPct + '%';
  battleMonsterHpFill.classList.toggle('low', mPct <= 40);
}

// Plays the attack lunge + hit-flash CSS animations, then calls back once they finish —
// callers apply the actual HP change inside the callback, so the bar visibly still shows
// the "about to be hit" value while the animation plays, and drops only once the hit lands.
const BATTLE_ANIM_MS = 500;
function playAttack(attacker, callback) {
  if (attacker === 'player') {
    battlePlayerSprite.classList.add('battle-attack-up');
    battleMonsterSprite.classList.add('battle-hit-flash');
  } else {
    battleMonsterSprite.classList.add('battle-attack-down');
    battlePlayerSprite.classList.add('battle-hit-flash');
  }
  setTimeout(() => {
    battlePlayerSprite.classList.remove('battle-attack-up', 'battle-hit-flash');
    battleMonsterSprite.classList.remove('battle-attack-down', 'battle-hit-flash');
    callback();
  }, BATTLE_ANIM_MS);
}

function statusHeading(text) {
  const h = document.createElement('div');
  h.className = 'wb-modal-title';
  h.textContent = text;
  return h;
}

// Knockout -> respawn: puts the player back in their house, standing right next to the
// bed, regardless of where (or which building) they were defeated in. scene.returnPos is
// set to just outside the front door, so if they walk back out without sleeping first,
// they land somewhere sensible in the world rather than wherever they happened to be
// mid-battle.
function teleportToBedKnockedOut() {
  const homeBuilding = BUILDING_DEFS.find(b => b.id === 'home');
  const door = buildingDoorTile(homeBuilding);
  const doorSpawn = placeFeetAtTile(door.c, door.r);

  scene.mode = 'interior';
  scene.buildingId = 'home';
  scene.returnPos = { x: doorSpawn.x, y: doorSpawn.y };
  scene.wasOnDoor = false;
  scene.wasOnExit = false;
  scene.activeObjectId = null;
  scene.wasOnCaveMonsterId = null;

  const bedObj = INTERIOR_OBJECTS.home.find(o => o.id === 'bed');
  const f = objFootprint(bedObj);
  const spawn = placeFeetAtTile(f.triggerCol, f.triggerRow);
  player.x = spawn.x;
  player.y = spawn.y;
  player.dir = 'north'; // facing the bed
}

// The generic battle driver: intro -> question (per turn, via QUESTION_MODULES, mode
// picked fresh each turn by pickRoundKey()) -> attack animation -> damage -> repeat until
// either side is out of HP. `monsterDef` is only read, never mutated, so the same roster
// entry can be reused across many battles; a local `state` object below tracks this
// particular fight's monster HP.
function runBattle({ monsterDef, onEnd }) {
  const state = { monsterHp: monsterDef.maxHp, healUsed: false };
  let defeated = false;
  scene.modalOpen = true;
  battleOverlay.classList.remove('hidden');
  battleMonsterName.textContent = monsterDef.name;
  battleMonsterSprite.src = (MONSTER_IMG[monsterDef.sprite] || {}).src || '';
  drawBattlePlayerSprite();
  updateHpBars(state.monsterHp, monsterDef.maxHp);
  battleModeTag.textContent = '';

  let lastHintFn = null;

  function appendPotionButtons(container, onUsed) {
    container.innerHTML = '';
    const hpCount = potionCount('healthPotion');
    const hintCount = potionCount('hintPotion');
    if (hpCount > 0 && playerStats.hp < playerStats.maxHp) {
      container.appendChild(gateButton(`Use Health Potion (${hpCount} left)`, () => {
        consumePotion('healthPotion');
        playerStats.hp = Math.min(playerStats.maxHp, playerStats.hp + CONSUMABLE_DEFS.healthPotion.heal);
        paintHud();
        updateHpBars(state.monsterHp, monsterDef.maxHp);
        onUsed();
      }));
    }
    // Heal, learned at the Lake Quest's altar (lake-quest.js): once per battle.
    if (lqHasHeal() && !state.healUsed && playerStats.hp < playerStats.maxHp) {
      container.appendChild(gateButton(`✨ Cast Heal (+${HEAL_HP} HP, once per battle)`, () => {
        state.healUsed = true;
        playerStats.hp = Math.min(playerStats.maxHp, playerStats.hp + HEAL_HP);
        paintHud();
        updateHpBars(state.monsterHp, monsterDef.maxHp);
        onUsed();
      }));
    }
    if (hintCount > 0 && lastHintFn) {
      container.appendChild(gateButton(`Use Hint Potion (${hintCount} left)`, () => {
        if (!lastHintFn()) return; // no empty box left to reveal this round
        consumePotion('hintPotion');
        onUsed();
      }));
    }
  }
  function renderIntro() {
    lastHintFn = null;
    battleModeTag.textContent = '';
    battleBody.innerHTML = '';
    battleBody.appendChild(statusHeading(`A wild ${monsterDef.name} appears!`));
    battleBody.appendChild(gateButton('Fight!', renderQuestion));
    const potionHost = document.createElement('div');
    battleBody.appendChild(potionHost);
    appendPotionButtons(potionHost, renderIntro);
  }
  function renderQuestion() {
    battleBody.innerHTML = '';
    const qHost = document.createElement('div');
    battleBody.appendChild(qHost);
    const potionHost = document.createElement('div');
    battleBody.appendChild(potionHost);

    function refreshChrome() {
      updateHpBars(state.monsterHp, monsterDef.maxHp);
      appendPotionButtons(potionHost, refreshChrome);
    }
    // Render the question FIRST so onHintReady (if the module supports it) has set
    // lastHintFn before refreshChrome() decides whether a hint button has anything to
    // call — otherwise the hint button would silently be missing on every question's
    // first paint.
    lastHintFn = null;
    const roundKey = pickRoundKey();
    battleModeTag.textContent = QUESTION_MODULES[roundKey].name.replace('Place Value — ', '');
    QUESTION_MODULES[roundKey].render(qHost, {
      onCorrect: () => { const dmg = (equipped.weapon && equipped.weapon.name === "Woodsman's Axe") ? 2 : 1; playAttack('player', () => { state.monsterHp -= dmg; afterAnswer(true); }); },
      onWrong: () => playAttack('monster', () => { playerStats.hp -= 1; afterAnswer(false); }),
      onHintReady: (fn) => { lastHintFn = fn; },
    });
    refreshChrome();
  }
  function afterAnswer(correct) {
    if (state.monsterHp <= 0) { renderVictory(); return; }
    if (playerStats.hp <= 0) { renderDefeat(); return; }
    battleModeTag.textContent = '';
    battleBody.innerHTML = '';
    const hasAxe = equipped.weapon && equipped.weapon.name === "Woodsman's Axe";
    battleBody.appendChild(statusHeading(correct ? (hasAxe ? 'Double Hit!' : 'Hit!') : 'Ouch!'));
    const msg = document.createElement('div');
    msg.className = 'wb-modal-body';
    msg.textContent = correct ? (hasAxe ? 'The axe strikes twice \u2014 2 damage!' : 'Direct hit \u2014 nice work!') : 'That one got past your guard.';
    battleBody.appendChild(msg);
    updateHpBars(state.monsterHp, monsterDef.maxHp);
    battleBody.appendChild(gateButton('Continue', renderQuestion));
    const potionHost = document.createElement('div');
    battleBody.appendChild(potionHost);
    appendPotionButtons(potionHost, () => afterAnswer(correct));
  }
  function renderVictory() {
    applyExpGain(monsterDef.exp);
    bankToRecord({ coins: monsterDef.gold });
    const drop = rollDrop();
    if (drop) grantConsumable(drop, 1);
    saveSession();
    paintHud();
    battleModeTag.textContent = '';
    battleBody.innerHTML = '';
    battleBody.appendChild(statusHeading('Victory!'));
    const msg = document.createElement('div');
    msg.className = 'wb-modal-body';
    msg.textContent = `You defeated the ${monsterDef.name}! +${monsterDef.exp} EXP, +${monsterDef.gold} \uD83E\uDE99` +
      (drop ? ` You also found a ${CONSUMABLE_DEFS[drop].name}!` : '');
    battleBody.appendChild(msg);
    updateHpBars(0, monsterDef.maxHp);
    battleBody.appendChild(gateButton('Nice!', () => finish(true)));
  }
  function renderDefeat() {
    defeated = true;
    playerStats.hp = 1; // never let a loss fully strand the player — they wake up able to move
    saveSession();
    paintHud();
    battleModeTag.textContent = '';
    battleBody.innerHTML = '';
    battleBody.appendChild(statusHeading('Knocked out!'));
    const msg = document.createElement('div');
    msg.className = 'wb-modal-body';
    msg.textContent = `The ${monsterDef.name} got the better of you this time. You wake up back home with 1 HP \u2014 sleep in your bed to heal up, or visit the Potion Shop for a health potion.`;
    battleBody.appendChild(msg);
    updateHpBars(state.monsterHp, monsterDef.maxHp);
    battleBody.appendChild(gateButton('Okay', () => finish(false)));
  }
  function finish(won) {
    closeBattle();
    currentBattleFinish = null;
    if (defeated) teleportToBedKnockedOut(); // covers both the "Okay" button and the
    // persistent "Leave Battle" topbar button being clicked from the defeat screen
    if (onEnd) onEnd(won);
  }
  currentBattleFinish = finish;
  renderIntro();
}

const MONSTER_RESPAWN_MS = 20000;
function openWorldMonsterBattle(m) {
  runBattle({
    monsterDef: m,
    onEnd: (won) => { if (won) { m.alive = false; m.respawnAt = performance.now() + MONSTER_RESPAWN_MS; } },
  });
}
function openCaveMonsterBattle(m) {
  runBattle({
    monsterDef: m,
    onEnd: (won) => { if (won) { m.alive = false; m.respawnAt = performance.now() + MONSTER_RESPAWN_MS; } },
  });
}

// ---------- Home bed: sleep to fully heal ----------
function openBedRest() {
  scene.modalOpen = true;
  wbTitle.textContent = 'Home';
  if (playerStats.hp >= playerStats.maxHp) {
    wbBody.textContent = 'You feel fully rested already.';
  } else {
    playerStats.hp = playerStats.maxHp;
    saveSession();
    paintHud();
    wbBody.textContent = "You settle in for a good night's sleep and wake up fully healed!";
  }
  wbModal.classList.remove('hidden');
}
