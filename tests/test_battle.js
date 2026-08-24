const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dir = require('path').join(__dirname, '..', 'game');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

const dom = new JSDOM(html, {
  url: 'http://localhost/index.html',
  runScripts: 'outside-only',
  resources: 'usable',
  pretendToBeVisual: true,
});
const { window } = dom;

const noop = () => {};
const fakeCtx = new Proxy({}, {
  get(target, prop) {
    if (prop === 'canvas') return undefined;
    if (prop === 'measureText') return () => ({ width: 0 });
    if (prop === 'createImageData' || prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    if (prop === 'putImageData') return noop;
    if (typeof prop === 'string') return noop;
    return undefined;
  },
  set() { return true; },
});
window.HTMLCanvasElement.prototype.getContext = () => fakeCtx;
window.requestAnimationFrame = () => 0;
// A fuller in-memory Firebase stand-in (matching test_dojo_matchmaking.js's) so the dojo
// matchmaking UI tests below can create/join/watch a real match, not just a stub that
// always returns empty.
function makeFakeBackend() {
  const store = {};
  const listeners = {};
  function snapFor(path) {
    const val = store[path];
    return {
      exists: () => val !== undefined,
      val: () => val,
      forEach: (cb) => { if (val && typeof val === 'object') { for (const k in val) cb({ exists: () => true, val: () => val[k] }); } },
    };
  }
  function notify(path) { const ls = listeners[path]; if (ls) for (const h of ls) h(snapFor(path)); }
  function makeRef(path) {
    return {
      once: async () => snapFor(path),
      set: async (val) => { store[path] = JSON.parse(JSON.stringify(val)); notify(path); },
      update: async (partial) => { store[path] = Object.assign({}, store[path] || {}, JSON.parse(JSON.stringify(partial))); notify(path); },
      remove: async () => { delete store[path]; notify(path); },
      on: (event, handler) => { if (!listeners[path]) listeners[path] = new Set(); listeners[path].add(handler); handler(snapFor(path)); },
      off: (event, handler) => { const ls = listeners[path]; if (ls) ls.delete(handler); },
    };
  }
  return { ref: makeRef, _store: store };
}
const fakeBackend = makeFakeBackend();
const fakeDatabaseFn = () => fakeBackend;
fakeDatabaseFn.ServerValue = { TIMESTAMP: 'SERVER_TIMESTAMP' };
window.firebase = {
  initializeApp: noop,
  database: fakeDatabaseFn,
};

const scripts = [
  'shared-student.js', 'manifest.js', 'assets_data.js', 'monster_assets.js', 'character.js',
  'world.js', 'placevalue.js', 'quests.js', 'battle.js', 'pvp.js', 'items.js', 'gameplay.js', 'npcs.js', 'dojo.js', 'session.js',
];
const gameCode = scripts.map(s => fs.readFileSync(path.join(dir, s), 'utf8')).join('\n;\n');

const driver = `
(async () => {
try {
function q(sel) { return document.querySelector(sel); }
function textOf(sel) { const el = q(sel); return el ? el.textContent : '(missing element)'; }
function hiddenClass(sel) { const el = q(sel); return el ? el.classList.contains('hidden') : null; }
function clickByText(text) {
  const btn = [...q('#battleBody').querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
  if (!btn) return false;
  btn.dispatchEvent(new Event('click'));
  return true;
}
function wbClickByText(text) {
  const btn = [...q('#wbBody').querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
  if (!btn) return false;
  btn.dispatchEvent(new Event('click'));
  return true;
}
function statusText() {
  const el = q('#battleBody .wb-modal-title');
  return el ? el.textContent : '(no status heading)';
}
function leaveBattle() { q('#battleLeaveBtn').dispatchEvent(new Event('click')); }

console.log('=== Demo login ===');
q('#demoMode').checked = true;
q('#demoMode').dispatchEvent(new Event('change'));
q('#btnEnter').dispatchEvent(new Event('click'));
console.log('Town screen hidden:', hiddenClass('#screenTown'));
console.log('HUD HP:', textOf('#hudHp'));
console.log('playerStats:', JSON.stringify(playerStats));

console.log();
console.log('=== Zero-guarantee: generatePVDigits() always has an interior zero, never all-zero ===');
{
  let missingZero = 0, allZero = 0;
  for (let i = 0; i < 500; i++) {
    const { active, digits } = generatePVDigits();
    const inner = active.slice(1, -1);
    if (inner.length && !inner.some(idx => digits[idx] === 0)) missingZero++;
    if (active.every(idx => digits[idx] === 0)) allZero++;
  }
  console.log('Trials missing an interior zero over 500 runs (expect 0):', missingZero);
  console.log('Trials that were all-zero over 500 runs (expect 0):', allZero);
}

console.log();
console.log('=== Round-type mix: pickRoundKey() weighted distribution over many trials ===');
{
  const counts = { 'place-value-read': 0, 'place-value-build': 0, 'place-value-point': 0 };
  for (let i = 0; i < 4000; i++) counts[pickRoundKey()]++;
  console.log('read/build/point counts (expect roughly 1000/1000/2000):', counts);
}

console.log();
function textOfEl(root, sel) { const el = root.querySelector(sel); return el ? el.textContent : ''; }
console.log('=== Read It always shows all 6 boxes; out-of-scope ones accept blank OR 0; in-scope ones need the real digit ===');
{
  // $76.56 (tens through hundredths) has no hundreds or thousandths digit at all. The
  // student shouldn't have to figure out WHICH boxes matter from the box count alone
  // (all 6 always render) — but shouldn't have to do anything to the ones that don't.
  const pile = { active: [1, 2, 3, 4], digits: [0, 7, 6, 5, 6, 0] };

  const host = document.createElement('div');
  let correctCalled = false;
  QUESTION_MODULES['place-value-read'].render(host, {
    presetPile: pile, onCorrect: () => { correctCalled = true; }, onWrong: () => {},
  });
  const boxes = [...host.querySelectorAll('.pv-box')];
  console.log('Read It always shows 6 boxes, even for a 4-place number:', boxes.length === 6);
  boxes[0].value = ''; boxes[1].value = '7'; boxes[2].value = '6'; boxes[3].value = '5'; boxes[4].value = '6'; boxes[5].value = '';
  const checkBtn = () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Check it');
  checkBtn().dispatchEvent(new Event('click'));
  console.log('Leaving out-of-scope boxes BLANK is accepted as correct:', correctCalled);

  const host2 = document.createElement('div');
  let correct2 = false;
  QUESTION_MODULES['place-value-read'].render(host2, {
    presetPile: pile, onCorrect: () => { correct2 = true; }, onWrong: () => {},
  });
  const boxes2 = [...host2.querySelectorAll('.pv-box')];
  boxes2[0].value = '0'; boxes2[1].value = '7'; boxes2[2].value = '6'; boxes2[3].value = '5'; boxes2[4].value = '6'; boxes2[5].value = '0';
  [...host2.querySelectorAll('button')].find(b => b.textContent === 'Check it').dispatchEvent(new Event('click'));
  console.log('Typing an explicit 0 in out-of-scope boxes is ALSO accepted as correct:', correct2);

  const host3 = document.createElement('div');
  let wrong3 = false;
  QUESTION_MODULES['place-value-read'].render(host3, {
    presetPile: pile, onCorrect: () => {}, onWrong: () => { wrong3 = true; },
  });
  const boxes3 = [...host3.querySelectorAll('.pv-box')];
  boxes3[0].value = '9'; boxes3[1].value = '7'; boxes3[2].value = '6'; boxes3[3].value = '5'; boxes3[4].value = '6'; boxes3[5].value = '';
  [...host3.querySelectorAll('button')].find(b => b.textContent === 'Check it').dispatchEvent(new Event('click'));
  console.log('A wrong (non-zero, non-blank) digit in an out-of-scope box is still marked wrong:', wrong3);

  // An in-scope place (even an interior zero) still requires the real digit — blank is
  // NOT accepted there, unlike the out-of-scope places above.
  const host4 = document.createElement('div');
  let anyResult4 = null;
  QUESTION_MODULES['place-value-read'].render(host4, {
    presetPile: pile, onCorrect: () => { anyResult4 = 'correct'; }, onWrong: () => { anyResult4 = 'wrong'; },
  });
  const boxes4 = [...host4.querySelectorAll('.pv-box')];
  boxes4[0].value = ''; boxes4[1].value = '7'; boxes4[2].value = '6'; boxes4[3].value = ''; boxes4[4].value = '6'; boxes4[5].value = '';
  const before4 = anyResult4;
  [...host4.querySelectorAll('button')].find(b => b.textContent === 'Check it').dispatchEvent(new Event('click'));
  console.log('Leaving an IN-scope box (tenths, which is genuinely 5) blank blocks checking entirely:', anyResult4 === before4 && anyResult4 === null);

  // The old bug: a window that skips a place WITHIN its own span (hundreds+tens without
  // ones) must never be generated.
  let sawInvalidWindow = false;
  for (let i = 0; i < 2000; i++) {
    const { active } = generatePVDigits();
    const touchesWhole = active.some(i2 => i2 <= 2), touchesFrac = active.some(i2 => i2 >= 3);
    if (touchesWhole && !active.includes(2)) sawInvalidWindow = true;
    if (touchesFrac && !active.includes(3)) sawInvalidWindow = true;
  }
  console.log('2000 generated problems, zero have an invalid (place-skipping) window:', !sawInvalidWindow);
}

console.log();
console.log('=== Build It always shows all 6 stepper rows; out-of-scope ones just stay at 0 (default), no action needed ===');
{
  const host2 = document.createElement('div');
  let correct2 = null;
  QUESTION_MODULES['place-value-build'].render(host2, {
    presetPile: { active: [3, 4, 5], digits: [0, 0, 0, 4, 0, 9] }, // coins-only window
    onCorrect: () => { correct2 = true; },
    onWrong: () => { correct2 = false; },
  });
  console.log('Build It always shows 6 stepper rows, even for a coins-only window:', host2.querySelectorAll('.pv-step-row').length === 6);
  console.log('Build It target display still shows only the cents side (informational only):', textOfEl(host2, '.pv-target') === '$0.409');
  // Never touch the out-of-scope steppers at all — they should already be correct at 0.
  [...host2.querySelectorAll('button')].find(b => b.textContent === 'Check it').dispatchEvent(new Event('click'));
  console.log('Checking without ever touching out-of-scope steppers still fails (none of the real digits were set):', correct2 === false);
}

console.log();
console.log('=== Each QUESTION_MODULES entry renders its expected DOM shape ===');
{
  const host = document.createElement('div');
  QUESTION_MODULES['place-value-read'].render(host, { onCorrect: () => {}, onWrong: () => {} });
  console.log('Read It renders .pv-tray and .pv-box inputs:', !!host.querySelector('.pv-tray'), host.querySelectorAll('.pv-box').length);

  const host2 = document.createElement('div');
  QUESTION_MODULES['place-value-build'].render(host2, { onCorrect: () => {}, onWrong: () => {} });
  console.log('Build It renders a target number and stepper rows:', !!host2.querySelector('.pv-target'), host2.querySelectorAll('.pv-step-row').length);
  const incBtn = host2.querySelector('.pv-stepper button:last-child');
  console.log('Build It stepper button exists:', !!incBtn);

  const host3 = document.createElement('div');
  QUESTION_MODULES['place-value-point'].render(host3, { onCorrect: () => {}, onWrong: () => {} });
  console.log('Place the Point renders pdigits and pgaps:', host3.querySelectorAll('.pv-pdigit').length, host3.querySelectorAll('.pv-pgap').length);
}

console.log();
console.log('=== Build It correctness check (stepper counts vs digits) ===');
{
  const host = document.createElement('div');
  let result = null;
  QUESTION_MODULES['place-value-build'].render(host, {
    onCorrect: () => { result = 'correct'; },
    onWrong: () => { result = 'wrong'; },
  });
  const checkBtn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Check it');
  checkBtn.dispatchEvent(new Event('click'));
  console.log('All-zero counts against a real (non-all-zero) target is wrong (expect wrong):', result);
}

console.log();
console.log('=== Place the Point correctness check (deterministic via presetPile, plus a coins-only case) ===');
{
  const host = document.createElement('div');
  let result = null;
  QUESTION_MODULES['place-value-point'].render(host, {
    presetPile: { active: [0, 1, 2, 3, 4, 5], digits: [1, 2, 3, 4, 5, 6] },
    onCorrect: () => { result = 'correct'; },
    onWrong: () => { result = 'wrong'; },
  });
  const gaps = host.querySelectorAll('.pv-pgap');
  gaps[3].dispatchEvent(new Event('click')); // full range: 3 whole-dollar places active
  const checkBtn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Check it');
  checkBtn.dispatchEvent(new Event('click'));
  console.log('Full range: clicking the correct gap (index 3) registers correct:', result);

  const host2 = document.createElement('div');
  let result2 = null;
  QUESTION_MODULES['place-value-point'].render(host2, {
    presetPile: { active: [0, 1, 2, 3, 4, 5], digits: [1, 2, 3, 4, 5, 6] },
    onCorrect: () => { result2 = 'correct'; },
    onWrong: () => { result2 = 'wrong'; },
  });
  const gaps2 = host2.querySelectorAll('.pv-pgap');
  gaps2[0].dispatchEvent(new Event('click'));
  const checkBtn2 = [...host2.querySelectorAll('button')].find(b => b.textContent === 'Check it');
  checkBtn2.dispatchEvent(new Event('click'));
  console.log('Full range: clicking a wrong gap (index 0) registers wrong:', result2);

  // A coins-only window (the new variability) should move the correct gap to index 0 —
  // no whole-dollar places are active at all, so the point goes right at the start.
  const host3 = document.createElement('div');
  let result3 = null;
  QUESTION_MODULES['place-value-point'].render(host3, {
    presetPile: { active: [3, 4, 5], digits: [0, 0, 0, 2, 0, 7] },
    onCorrect: () => { result3 = 'correct'; },
    onWrong: () => { result3 = 'wrong'; },
  });
  const gaps3 = host3.querySelectorAll('.pv-pgap');
  console.log('Coins-only window renders the right number of gaps (expect 4):', gaps3.length);
  gaps3[0].dispatchEvent(new Event('click'));
  const checkBtn3 = [...host3.querySelectorAll('button')].find(b => b.textContent === 'Check it');
  checkBtn3.dispatchEvent(new Event('click'));
  console.log('Coins-only window: gap 0 is correct (no whole-dollar places):', result3);

  // A bills-only window should move the correct gap to the very end.
  const host4 = document.createElement('div');
  let result4 = null;
  QUESTION_MODULES['place-value-point'].render(host4, {
    presetPile: { active: [0, 1, 2], digits: [4, 0, 7, 0, 0, 0] },
    onCorrect: () => { result4 = 'correct'; },
    onWrong: () => { result4 = 'wrong'; },
  });
  const gaps4 = host4.querySelectorAll('.pv-pgap');
  gaps4[3].dispatchEvent(new Event('click'));
  const checkBtn4 = [...host4.querySelectorAll('button')].find(b => b.textContent === 'Check it');
  checkBtn4.dispatchEvent(new Event('click'));
  console.log('Bills-only window: last gap is correct (all 3 places are whole-dollar):', result4);
}

console.log();
console.log('=== Battle overlay opens with sprites/HP bars, Fight! renders a question ===');
{
  const def = { id: 'testMon', name: 'Test Monster', sprite: 'slime', maxHp: 2, exp: 15, gold: 5 };
  playerStats.hp = playerStats.maxHp;
  let endedWith = 'not-called';
  runBattle({ monsterDef: def, onEnd: (won) => { endedWith = won; } });
  console.log('battleOverlay hidden (expect false):', hiddenClass('#battleOverlay'));
  console.log('status heading:', statusText());
  console.log('monster name label:', textOf('#battleMonsterName'));
  console.log('monster sprite src set:', q('#battleMonsterSprite').src.startsWith('data:image'));
  console.log('player HP fill width set:', q('#battlePlayerHpFill').style.width);
  console.log('monster HP fill width set:', q('#battleMonsterHpFill').style.width);

  clickByText('Fight!');
  console.log('Question rendered (some pv- container present):', !!(q('#battleBody .pv-tray') || q('#battleBody .pv-pointrow')));
  console.log('battleModeTag shows a round name:', textOf('#battleModeTag'));

  leaveBattle();
  console.log('onEnd called with:', endedWith);
  console.log('battleOverlay hidden after Leave Battle (expect true):', hiddenClass('#battleOverlay'));
}

console.log();
console.log('=== Attack animation classes are applied and cleared (fake timers) ===');
{
  const realSetTimeout = window.setTimeout;
  let capturedCb = null, capturedMs = null;
  window.setTimeout = (cb, ms) => { capturedCb = cb; capturedMs = ms; return 0; };
  playAttack('player', () => { console.log('playAttack(player) callback fired'); });
  console.log('player sprite has attack-up class during animation:', q('#battlePlayerSprite').classList.contains('battle-attack-up'));
  console.log('monster sprite has hit-flash class during animation:', q('#battleMonsterSprite').classList.contains('battle-hit-flash'));
  console.log('animation duration scheduled (expect 500):', capturedMs);
  if (capturedCb) capturedCb();
  console.log('classes cleared after callback fires:', !q('#battlePlayerSprite').classList.contains('battle-attack-up') && !q('#battleMonsterSprite').classList.contains('battle-hit-flash'));
  window.setTimeout = realSetTimeout;
}

console.log();
console.log('=== Direct HP/EXP/gold math (mirrors afterAnswer/renderVictory logic) ===');
{
  const expBefore = session.record.totalEXP || 0;
  const goldBefore = session.record.coins || 0;
  playerStats.hp = 3;
  playerStats.hp -= 1;
  console.log('HP after one simulated wrong answer (3 -> expect 2):', playerStats.hp);
  session.record.totalEXP = expBefore + 15;
  session.record.coins = goldBefore + 5;
  saveSession();
  paintHud();
  console.log('EXP after simulated victory (+15):', session.record.totalEXP, 'expected', expBefore + 15);
  console.log('Gold after simulated victory (+5):', session.record.coins, 'expected', goldBefore + 5);
}

console.log();
console.log('=== Bed rest heal ===');
playerStats.hp = 2;
paintHud();
openBedRest();
console.log('playerStats.hp after sleeping (expect 5):', playerStats.hp);
q('#wbCloseBtn').dispatchEvent(new Event('click'));
openBedRest();
console.log('wbBody when already full:', textOf('#wbBody'));
q('#wbCloseBtn').dispatchEvent(new Event('click'));

console.log();
console.log('=== Cave boulder-clearing tied to chest claim ===');
{
  const chest = findInteriorObject('swordChest');
  chest.claimed = false;
  console.log('Boulders present before claim (expect 3):', objectsFor('cave').filter(o => o.id.startsWith('boulder')).length);
  hasBackpack = true;
  chest.claimed = true;
  const slot = inventory.findIndex(x => x === null);
  inventory[slot] = Object.assign({}, chest.reward);
  console.log('Boulders present after claim (expect 0):', objectsFor('cave').filter(o => o.id.startsWith('boulder')).length);
}

console.log();
console.log('=== World monster: proximity trigger via real keys[] input, wander/respawn ===');
{
  const m = WORLD_MONSTER_DEFS[0];
  scene.mode = 'world';
  scene.modalOpen = false;
  player.x = m.x; player.y = m.y;
  scene.wasOnMonsterId = null;
  keys['arrowdown'] = true;
  updatePlayer(16);
  keys['arrowdown'] = false;
  console.log('battleOverlay hidden after standing on a world monster (expect false):', hiddenClass('#battleOverlay'));
  console.log('monster name label:', textOf('#battleMonsterName'));
  closeBattle();

  m.alive = false;
  m.respawnAt = performance.now() + 20000;
  updateMonsters(16);
  console.log('Still not-alive before respawnAt (expect true):', !m.alive);
  m.respawnAt = performance.now() - 1;
  updateMonsters(16);
  console.log('Respawned once respawnAt passed (expect true):', m.alive);
  drawMonsters();
  console.log('drawMonsters() ran without throwing.');
}

console.log();
console.log('=== Cave door: separate deeper room reached through the inner door ===');
{
  const chest3 = findInteriorObject('swordChest');
  chest3.claimed = true;
  scene.mode = 'interior';
  scene.buildingId = 'cave';
  scene.modalOpen = false;
  console.log('caveDoor object exists in the cave room:', INTERIOR_OBJECTS.cave.some(o => o.kind === 'caveDoor'));

  // Walk through the inner door for real.
  const doorObj = INTERIOR_OBJECTS.cave.find(o => o.kind === 'caveDoor');
  const f = objFootprint(doorObj);
  const doorSpawn = placeFeetAtTile(f.triggerCol, f.triggerRow);
  player.x = doorSpawn.x; player.y = doorSpawn.y;
  scene.activeObjectId = null;
  keys['arrowup'] = true;
  updatePlayer(16);
  keys['arrowup'] = false;
  console.log('Entered the deeper cave room (expect true):', scene.mode === 'interior' && scene.buildingId === 'caveDeep');

  drawInterior();
  console.log('drawInterior() (with cave monsters) ran without throwing.');

  // Leaving through caveDeep's exit tile should return to 'cave', not the world.
  const interiorDeep = interiorFor('caveDeep');
  const exitSpawn = placeFeetAtTile(interiorDeep.exitCol, interiorDeep.exitRow);
  player.x = exitSpawn.x; player.y = exitSpawn.y;
  scene.wasOnExit = false;
  keys['arrowdown'] = true;
  updatePlayer(16);
  keys['arrowdown'] = false;
  console.log('Returned to the chest room, not the world (expect true):', scene.mode === 'interior' && scene.buildingId === 'cave');
  console.log('Player position finite after the round trip:', Number.isFinite(player.x) && Number.isFinite(player.y));

  // The actual reported bug: landing back in 'cave' should NOT immediately bounce the
  // player straight back into 'caveDeep' via the same door trigger.
  keys['arrowup'] = false; keys['arrowdown'] = false; keys['arrowleft'] = false; keys['arrowright'] = false;
  updatePlayer(16); // one more idle frame with no input — should not re-trigger anything
  console.log('Did NOT get bounced back into caveDeep (expect true, i.e. still in cave):', scene.buildingId === 'cave');
  console.log('Not wedged in place — can still move after returning:', (() => {
    const bx = player.x, by = player.y;
    keys['arrowleft'] = true;
    updatePlayer(16);
    keys['arrowleft'] = false;
    return player.x !== bx || player.y !== by;
  })());

  scene.mode = 'world';
  scene.buildingId = null;
}

console.log();
console.log('=== Cave monsters: live in the deeper room, wander, contactable there ===');
{
  const chest2 = findInteriorObject('swordChest');
  chest2.claimed = false;
  console.log('caveMonstersActive() before claim (expect false):', caveMonstersActive());
  console.log('nearbyCaveMonster returns null before claim (expect true):', nearbyCaveMonster(CAVE_MONSTER_DEFS[0].x, CAVE_MONSTER_DEFS[0].y) === null);
  chest2.claimed = true;
  console.log('caveMonstersActive() after claim (expect true):', caveMonstersActive());

  scene.mode = 'interior';
  scene.buildingId = 'caveDeep';
  scene.modalOpen = false;
  const cm = CAVE_MONSTER_DEFS[0];
  player.x = cm.x; player.y = cm.y;
  scene.wasOnCaveMonsterId = null;
  keys['arrowdown'] = true;
  updatePlayer(16);
  keys['arrowdown'] = false;
  console.log('battleOverlay hidden after standing on a cave monster (expect false):', hiddenClass('#battleOverlay'));
  console.log('monster name label:', textOf('#battleMonsterName'));
  closeBattle();

  cm.alive = false;
  cm.respawnAt = performance.now() + 5000;
  updateMonsters(16);
  console.log('cave monster still not-alive before respawnAt (expect true):', !cm.alive);
  cm.respawnAt = performance.now() - 1;
  updateMonsters(16);
  console.log('cave monster respawned (expect true):', cm.alive);
  drawCaveMonsters();
  console.log('drawCaveMonsters() ran without throwing.');

  scene.mode = 'world';
  scene.buildingId = null;
}

console.log();
console.log('=== Potions: grant, stack, consume ===');
{
  hasBackpack = true;
  const before = potionCount('healthPotion');
  grantConsumable('healthPotion', 1);
  grantConsumable('healthPotion', 2);
  console.log('healthPotion count after granting 3 total (expect', before + 3, '):', potionCount('healthPotion'));
  const invSlot = findConsumableSlot('healthPotion');
  console.log('Single inventory slot used for stacked potions:', invSlot >= 0);
  while (potionCount('healthPotion') > 0) consumePotion('healthPotion');
  console.log('Slot cleared to null after draining to 0:', inventory[invSlot] === null);
}

console.log();
console.log('=== Drop roll distribution (10% chance, weighted toward health) ===');
{
  let none = 0, hp = 0, hint = 0;
  for (let i = 0; i < 3000; i++) {
    const d = rollDrop();
    if (d === null) none++;
    else if (d === 'healthPotion') hp++;
    else if (d === 'hintPotion') hint++;
  }
  console.log('none/hp/hint over 3000 trials (expect roughly 90%/7%/3%):', none, hp, hint);
}

console.log();
console.log('=== Hint potion reveals a box during a real Read It battle round ===');
{
  const savedWeights = Object.assign({}, PV_ROUND_WEIGHTS);
  PV_ROUND_WEIGHTS['place-value-read'] = 1; PV_ROUND_WEIGHTS['place-value-build'] = 0; PV_ROUND_WEIGHTS['place-value-point'] = 0;
  grantConsumable('hintPotion', 1);
  playerStats.hp = playerStats.maxHp;
  const def = { id: 'hintTestMon', name: 'Hint Test Monster', sprite: 'slime', maxHp: 5, exp: 1, gold: 1 };
  runBattle({ monsterDef: def, onEnd: () => {} });
  clickByText('Fight!');
  const boxesBefore = [...q('#battleBody').querySelectorAll('.pv-box')].filter(b => b.value !== '').length;
  const hintClicked = clickByText('Use Hint Potion');
  console.log('Hint Potion button present and clicked:', hintClicked);
  const boxesAfter = [...q('#battleBody').querySelectorAll('.pv-box')].filter(b => b.value !== '').length;
  console.log('A box got filled in by the hint:', boxesAfter > boxesBefore);
  console.log('hintPotion count decremented to 0:', potionCount('hintPotion'));
  closeBattle();
  Object.assign(PV_ROUND_WEIGHTS, savedWeights);
}

console.log();
console.log('=== Health potion heals mid-battle without losing the current question ===');
{
  grantConsumable('healthPotion', 1);
  playerStats.hp = 1;
  const def = { id: 'healTestMon', name: 'Heal Test Monster', sprite: 'bat', maxHp: 5, exp: 1, gold: 1 };
  runBattle({ monsterDef: def, onEnd: () => {} });
  clickByText('Fight!');
  const before = playerStats.hp;
  const clicked = clickByText('Use Health Potion');
  console.log('Health Potion button present and clicked:', clicked);
  console.log('HP after potion (expect', Math.min(playerStats.maxHp, before + CONSUMABLE_DEFS.healthPotion.heal), '):', playerStats.hp);
  console.log('healthPotion count decremented to 0:', potionCount('healthPotion'));
  closeBattle();
}

console.log();
console.log('=== Shop: buy flow, insufficient gold, backpack requirement ===');
{
  session.record.coins = 100;
  hasBackpack = true;
  openShop();
  console.log('shopModal hidden after openShop (expect false):', hiddenClass('#shopModal'));
  const before = potionCount('healthPotion');
  buyPotion('healthPotion');
  console.log('Potion count after buy (expect', before + 1, '):', potionCount('healthPotion'));

  session.record.coins = 0;
  const beforeInsufficient = potionCount('hintPotion');
  buyPotion('hintPotion');
  console.log('No purchase when gold insufficient:', potionCount('hintPotion') === beforeInsufficient);

  session.record.coins = 100;
  hasBackpack = false;
  const beforeNoBackpack = potionCount('hintPotion');
  buyPotion('hintPotion');
  console.log('No purchase without a backpack:', potionCount('hintPotion') === beforeNoBackpack);
  hasBackpack = true;
  closeShop();
}

console.log();
console.log('=== Shopkeeper NPC routes to shop, not dialogue ===');
{
  const shopNpc = NPC_DEFS.find(n => n.isShop);
  scene.mode = 'world';
  scene.modalOpen = false;
  player.x = shopNpc.x; player.y = shopNpc.y;
  scene.wasOnNpcId = null;
  keys['arrowdown'] = true;
  updatePlayer(16);
  keys['arrowdown'] = false;
  console.log('shopModal hidden after standing on the shopkeeper (expect false):', hiddenClass('#shopModal'));
  closeShop();
}

console.log();
console.log('=== Knockout -> teleport to bed, next to it, facing it ===');
{
  const def = { id: 'koTestMon', name: 'KO Test Monster', sprite: 'skull', maxHp: 99, exp: 1, gold: 1 };
  playerStats.hp = 1;
  scene.mode = 'world';
  scene.buildingId = null;

  // playAttack() delays the actual damage/afterAnswer() behind a real 500ms setTimeout
  // (the attack animation) — fine in a real browser, but this test drives clicks
  // synchronously, so make setTimeout fire immediately for the duration of this check.
  const realSetTimeout = window.setTimeout;
  window.setTimeout = (cb) => { cb(); return 0; };

  runBattle({ monsterDef: def, onEnd: () => {} });
  clickByText('Fight!');
  // Force a wrong answer via the module's own onWrong callback path: click Check It with
  // an intentionally-wrong Build It submission (counts default to 0, which is never the
  // real target since generatePVDigits() guarantees a non-all-zero pile) is unreliable
  // across round types, so instead drive the exact same code path battle.js wires up by
  // calling QUESTION_MODULES directly isn't representative of the real UI here — simplest
  // reliable route: keep answering wrong via the rendered Check It button until defeat
  // fires, using Build It/Point's deterministic wrong case (0 counts / wrong gap) when
  // that round type shows up, and skipping (Continue) on Read It rounds we can't force.
  function tryForceWrong() {
    const checkBtn = [...q('#battleBody').querySelectorAll('button')].find(b => b.textContent === 'Check it');
    if (!checkBtn) return false;
    if (q('#battleBody .pv-tray-build')) { checkBtn.dispatchEvent(new Event('click')); return true; }
    if (q('#battleBody .pv-pointrow')) {
      const gaps = q('#battleBody').querySelectorAll('.pv-pgap');
      gaps[0].dispatchEvent(new Event('click')); // index 0 is never the correct full-range gap (3)
      checkBtn.dispatchEvent(new Event('click'));
      return true;
    }
    const boxes = q('#battleBody').querySelectorAll('.pv-box');
    if (boxes.length) {
      // Every box gets a 9; the guaranteed interior zero makes this deterministically wrong.
      boxes.forEach(b => { b.value = '9'; });
      checkBtn.dispatchEvent(new Event('click'));
      return true;
    }
    return false;
  }
  let guard = 0;
  while (hiddenClass('#battleOverlay') === false && guard < 30) {
    if (!tryForceWrong()) {
      if (!clickByText('Okay')) { clickByText('Continue') || clickByText('Fight!'); }
    }
    guard++;
  }
  console.log('battleOverlay closed after knockout (expect true):', hiddenClass('#battleOverlay'));
  console.log('scene.mode after knockout (expect interior):', scene.mode);
  console.log('scene.buildingId after knockout (expect home):', scene.buildingId);
  console.log('playerStats.hp after knockout (expect 1):', playerStats.hp);

  const bedObj = INTERIOR_OBJECTS.home.find(o => o.id === 'bed');
  const f = objFootprint(bedObj);
  const nearBed = Math.abs(player.x - placeFeetAtTile(f.triggerCol, f.triggerRow).x) < 2
    && Math.abs(player.y - placeFeetAtTile(f.triggerCol, f.triggerRow).y) < 2;
  console.log('player standing exactly on the bed trigger tile:', nearBed);
  console.log('player facing the bed (dir=north):', player.dir === 'north');
  console.log('scene.returnPos set to just outside the front door:', !!scene.returnPos);

  // Confirm walking onto the bed trigger from here actually heals (reuses openBedRest).
  playerStats.hp = 1;
  scene.modalOpen = false;
  keys['arrowup'] = true;
  updatePlayer(16);
  keys['arrowup'] = false;
  console.log('playerStats.hp after triggering the bed post-knockout (expect 5):', playerStats.hp);
  q('#wbCloseBtn').dispatchEvent(new Event('click'));

  window.setTimeout = realSetTimeout;
  scene.mode = 'world';
  scene.buildingId = null;
}

console.log();
console.log('=== Check It button cannot be re-clicked for repeat credit after a correct answer ===');
{
  // The reported bug: after answering correctly, the same Check It button stayed
  // clickable, so clicking it again and again kept calling onCorrect() — in the
  // Workbench, that meant free repeated points; in battle it could double-count damage
  // during the ~500ms attack-animation window before the screen replaces itself.
  ['place-value-read', 'place-value-build', 'place-value-point'].forEach((key) => {
    const host = document.createElement('div');
    let correctCount = 0;
    const pile = key === 'place-value-point'
      ? { active: [0, 1, 2, 3, 4, 5], digits: [1, 2, 3, 4, 5, 6] }
      : { active: [0, 1, 2], digits: [1, 2, 3, 0, 0, 0] };
    QUESTION_MODULES[key].render(host, {
      presetPile: pile,
      onCorrect: () => { correctCount++; },
      onWrong: () => {},
    });
    // Answer it correctly first.
    if (key === 'place-value-read') {
      const boxes = [...host.querySelectorAll('.pv-box')];
      [1, 2, 3, 0, 0, 0].forEach((v, i) => { boxes[i].value = String(v); });
    } else if (key === 'place-value-build') {
      const rows = host.querySelectorAll('.pv-step-row');
      [1, 2, 3, 0, 0, 0].forEach((v, i) => {
        const inc = rows[i].querySelector('.pv-stepper button:last-child');
        for (let k = 0; k < v; k++) inc.click();
      });
    } else {
      const gaps = host.querySelectorAll('.pv-pgap');
      gaps[3].dispatchEvent(new Event('click')); // full range: correct gap is index 3
    }
    const checkBtn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Check it');
    checkBtn.dispatchEvent(new Event('click'));
    checkBtn.dispatchEvent(new Event('click'));
    checkBtn.dispatchEvent(new Event('click'));
    checkBtn.dispatchEvent(new Event('click'));
    console.log(key + ': onCorrect fired exactly once despite 4 clicks (expect 1):', correctCount);
    console.log(key + ': Check It button is now disabled:', checkBtn.disabled);
  });
}

console.log();
console.log('=== PV window variability: genuinely mixes bills-only, coins-only, and mixed problems ===');
{
  let billsOnly = 0, coinsOnly = 0, mixed = 0;
  const gapCounts = {};
  for (let i = 0; i < 1000; i++) {
    const { active } = generatePVDigits();
    const hasWhole = active.some(i2 => i2 <= 2), hasFrac = active.some(i2 => i2 >= 3);
    if (hasWhole && !hasFrac) billsOnly++;
    else if (!hasWhole && hasFrac) coinsOnly++;
    else mixed++;
    const gap = active.filter(i2 => i2 <= 2).length;
    gapCounts[gap] = (gapCounts[gap] || 0) + 1;
  }
  console.log('bills-only/coins-only/mixed over 1000 trials (expect all three well represented):', { billsOnly, coinsOnly, mixed });
  console.log('Decimal-point gap position distribution (expect several different values, not just 3):', gapCounts);
  console.log('Gap position is NOT always 3 (the old bug):', Object.keys(gapCounts).length > 1);
}

console.log();
console.log('=== Place the Point magnitude bug: no window skips tenths-while-showing-cents or ones-while-showing-dollars ===');
{
  // The actual bug: a window like hundredths+thousandths-only (tenths silently skipped)
  // makes the FIRST shown digit read as if it were tenths, changing the represented value
  // by a factor of 10 (e.g. "5, 0" meant to be $0.05 gets judged against the point going
  // where it would for $0.50). The single shared PV_ACTIVE_WINDOWS pool must never
  // contain a window like that (or the mirror-image "hundreds+tens without ones").
  console.log('PV_ACTIVE_WINDOWS excludes the broken [4,5] window:', !PV_ACTIVE_WINDOWS.some(([lo, hi]) => lo === 4 && hi === 5));
  console.log('PV_ACTIVE_WINDOWS excludes the broken [0,1] window:', !PV_ACTIVE_WINDOWS.some(([lo, hi]) => lo === 0 && hi === 1));

  let sawInvalid = 0;
  for (let i = 0; i < 2000; i++) {
    const { active } = generatePVDigits();
    const touchesWhole = active.some(i2 => i2 <= 2), touchesFrac = active.some(i2 => i2 >= 3);
    if (touchesWhole && !active.includes(2)) sawInvalid++; // shows dollars but skips "ones"
    if (touchesFrac && !active.includes(3)) sawInvalid++;  // shows cents but skips "tenths"
  }
  console.log('2000 trials, zero produced an ambiguous/place-skipping window:', sawInvalid === 0);

  // Concretely reproduce the screenshot: 5 pennies, 0 mills, tenths skipped — confirm the
  // Point-mode gap math would have gotten this wrong (documenting why the window itself
  // must never be generated, rather than trying to special-case the rendering).
  const brokenPile = { active: [4, 5], digits: [0, 0, 0, 0, 5, 0] };
  const host = document.createElement('div');
  QUESTION_MODULES['place-value-point'].render(host, { presetPile: brokenPile, onCorrect: () => {}, onWrong: () => {} });
  const pdigits = [...host.querySelectorAll('.pv-pdigit')].map(el => el.textContent);
  console.log('(Reference only — this exact broken pile, if forced via presetPile, would still render 5/0 with the point at the start; the real fix is that the generator never produces it. Rendered digits:', pdigits, ')');
}

console.log();
console.log('=== HP scales with level, heals to max on level-up ===');
{
  console.log('maxHpForLevel(1) === base 5:', maxHpForLevel(1) === 5);
  console.log('maxHpForLevel(9) === base 5 (not yet 10):', maxHpForLevel(9) === 5);
  console.log('maxHpForLevel(10) === 6 (+1 at the milestone):', maxHpForLevel(10) === 6);
  console.log('maxHpForLevel(25) === 7:', maxHpForLevel(25) === 7);
  console.log('maxHpForLevel(100) === 15:', maxHpForLevel(100) === 15);

  // Simulate a student sitting just below the level-10 EXP threshold, already hurt, then
  // gaining enough EXP to cross it.
  const justBelow10 = Shared.levelThreshold(10) - 1;
  session.record.totalEXP = justBelow10;
  playerStats.maxHp = maxHpForLevel(Shared.getLevelInfo(justBelow10).level);
  playerStats.hp = 2; // hurt, well below max
  console.log('Starting level (expect 9):', Shared.getLevelInfo(session.record.totalEXP).level);
  applyExpGain(50); // enough to guarantee crossing into level 10 territory
  const afterLevel = Shared.getLevelInfo(session.record.totalEXP).level;
  console.log('Crossed into level 10+:', afterLevel >= 10);
  console.log('Max HP increased to 6:', playerStats.maxHp === 6);
  console.log('HP healed to the new max on level-up (expect 6, not 2):', playerStats.hp === 6);

  // A gain that does NOT cross a level boundary should NOT force a heal.
  session.record.totalEXP = Shared.levelThreshold(3);
  playerStats.maxHp = maxHpForLevel(3);
  playerStats.hp = 1;
  applyExpGain(1); // tiny gain, should not cross a level boundary
  console.log('No level-up -> HP NOT force-healed (expect still 1):', playerStats.hp === 1);
}

console.log();
console.log('=== Dojo building + kiosk ===');
{
  const dojoBuilding = BUILDING_DEFS.find(b => b.id === 'dojo');
  console.log('Dojo building exists:', !!dojoBuilding);
  console.log('Dojo building has a door tile:', !!dojoBuilding && typeof dojoBuilding.doorCol === 'number');

  // Walk the player into the dojo like any other building, via the real door trigger.
  scene.mode = 'world';
  scene.modalOpen = false;
  const door = buildingDoorTile(dojoBuilding);
  const spawn = placeFeetAtTile(door.c, door.r);
  player.x = spawn.x; player.y = spawn.y;
  scene.wasOnDoor = false;
  keys['arrowdown'] = true;
  updatePlayer(16);
  keys['arrowdown'] = false;
  console.log('Entered dojo interior (expect true):', scene.mode === 'interior' && scene.buildingId === 'dojo');

  // Walk up to the Dojo Master (replaces the old physical kiosk) and confirm it opens
  // the battle menu; also confirm the wall-mounted weapon decor exists and the sparring
  // pair render without throwing.
  console.log('Wall weapon decor present:', INTERIOR_OBJECTS.dojo.some(o => o.id === 'wallShield') && INTERIOR_OBJECTS.dojo.some(o => o.id === 'wallSpear'));
  console.log('No physical kiosk object remains:', !INTERIOR_OBJECTS.dojo.some(o => o.id === 'kiosk'));

  const masterSpawn = { x: DOJO_MASTER_COL * TILE, y: DOJO_MASTER_ROW * TILE };
  player.x = masterSpawn.x; player.y = masterSpawn.y;
  scene.wasOnDojoMaster = false;
  keys['arrowup'] = true;
  updatePlayer(16);
  keys['arrowup'] = false;
  console.log('wbModal hidden after approaching the Dojo Master (expect false):', hiddenClass('#workbenchModal'));
  console.log('wbTitle:', textOf('#wbTitle'));
  console.log('wbBody shows the kiosk intro:', textOf('#wbBody').includes('Challenge a classmate'));
  q('#wbCloseBtn').dispatchEvent(new Event('click'));

  drawInterior();
  console.log('drawInterior() (with Dojo Master + sparring pair) ran without throwing.');

  // Leaving through the exit tile should work exactly like any other building.
  const interior = interiorFor('dojo');
  const exitSpawn = placeFeetAtTile(interior.exitCol, interior.exitRow);
  player.x = exitSpawn.x; player.y = exitSpawn.y;
  scene.wasOnExit = false;
  keys['arrowdown'] = true;
  updatePlayer(16);
  keys['arrowdown'] = false;
  console.log('Exited back to world (expect true):', scene.mode === 'world');
  console.log('Not stuck just outside the exit:', !worldBlocked(player.x, player.y));

  scene.mode = 'world';
  scene.buildingId = null;
}

console.log();
console.log('=== Dojo matchmaking UI: host flow, code display, live duel starts via a simulated second student ===');
{
  scene.mode = 'world';
  scene.modalOpen = false;
  openDojoKiosk();
  console.log('wbModal hidden after opening kiosk (expect false):', hiddenClass('#workbenchModal'));

  wbClickByText('Start a Battle');
  await new Promise(r => setTimeout(r, 0)); // let the async createMatch() resolve
  const codeShown = q('#wbBody .pv-target') ? q('#wbBody .pv-target').textContent : null;
  console.log('A 4-character code is displayed:', !!codeShown && codeShown.length === 4);
  console.log('Waiting message shown:', textOf('#wbBody').includes('Waiting'));

  // Simulate a second student (not this window) joining that exact code directly through
  // the same Shared API a real second browser would use — this is the cross-window
  // handshake already proven in test_dojo_matchmaking.js/test_pvp_duel.js; here we're
  // confirming THIS window's live watcher correctly reacts and jumps straight into the
  // live duel overlay (dojo.js no longer shows an intermediate "matched" screen).
  const joinResult = await Shared.joinMatch(codeShown, 'buddy', 'Buddy');
  console.log('Simulated classmate joined successfully:', joinResult.ok);
  // Also simulate Buddy's own client reporting itself ready (a real second browser would
  // do this automatically inside its own startPvpDuel() call) — otherwise nothing ever
  // shows an opponent name or lets round 1 begin, since the host is still only seeing its
  // own side of the battle node.
  await Shared.reportBattleReady(codeShown, 'guest', 5, 5, 'Buddy', 0);
  await new Promise(r => setTimeout(r, 0));
  console.log('wbModal closed once matched:', hiddenClass('#workbenchModal'));
  console.log('Kiosk auto-advanced straight into a live duel:', hiddenClass('#battleOverlay') === false);
  console.log('Opponent name shown is Buddy:', textOf('#battleMonsterName') === 'Buddy');

  q('#battleLeaveBtn').dispatchEvent(new Event('click')); // forfeit to clean up
  await new Promise(r => setTimeout(r, 0));
  // Forfeiting counts as a loss, so it shows the same Defeated screen knockout does — the
  // overlay itself only closes once "Okay" is clicked (matching how knockout behaves).
  console.log('Forfeiting shows the Defeated screen:', textOf('#battleBody').includes('Defeated'));
  const okayBtn1 = [...q('#battleBody').querySelectorAll('button')].find(b => b.textContent === 'Okay');
  okayBtn1.dispatchEvent(new Event('click'));
  console.log('battleOverlay closed after Okay (expect true):', hiddenClass('#battleOverlay'));
}

console.log();
console.log('=== Dojo matchmaking UI: join flow with a real code, and error cases ===');
{
  const hostResult = await Shared.createMatch('otherhost', 'OtherHost', session.period);
  // Simulate the host's own client reporting itself ready too (a real second browser
  // would do this inside its own startPvpDuel() call).
  await Shared.reportBattleReady(hostResult.code, 'host', 5, 5, 'OtherHost', 0);
  scene.modalOpen = false;
  openDojoKiosk();
  wbClickByText('Join with a Code');
  const input = q('#wbBody input');
  console.log('Code input field present:', !!input);
  input.value = hostResult.code.toLowerCase(); // lowercase on purpose — should be normalized
  wbClickByText('Join');
  await new Promise(r => setTimeout(r, 0));
  console.log('Kiosk closed and a live duel opened after joining:', hiddenClass('#battleOverlay') === false);
  console.log('Opponent name shown is OtherHost:', textOf('#battleMonsterName') === 'OtherHost');
  q('#battleLeaveBtn').dispatchEvent(new Event('click')); // forfeit to clean up
  await new Promise(r => setTimeout(r, 0));
  const okayBtn2 = [...q('#battleBody').querySelectorAll('button')].find(b => b.textContent === 'Okay');
  if (okayBtn2) okayBtn2.dispatchEvent(new Event('click'));
  await new Promise(r => setTimeout(r, 0));

  // Bad code
  openDojoKiosk();
  wbClickByText('Join with a Code');
  q('#wbBody input').value = 'ZZZZ';
  wbClickByText('Join');
  await new Promise(r => setTimeout(r, 0));
  console.log('Bad code shows an error, stays on the join screen:', textOf('#wbBody').includes('No battle found'));
  wbClickByText('Back');
}

console.log();
console.log('=== Dojo leaderboard: empty state, then populated + sorted, with "me" highlighted ===');
{
  scene.modalOpen = false;
  openDojoKiosk();
  wbClickByText('View Leaderboard');
  await new Promise(r => setTimeout(r, 0));
  console.log('Empty-state message shown when nobody has PvP wins yet:', textOf('#wbBody').includes('be the first'));
  wbClickByText('Back');

  // Seed some student records (mirrors what saveSession() writes) under the same period
  // this session is logged in as, so the leaderboard has real rows to rank.
  await Shared.DB.ref('students').set({
    demo: { name: session.name, lastPeriod: session.period, pvpWins: 3, totalEXP: 0, coins: 0 },
    rival: { name: 'Rival', lastPeriod: session.period, pvpWins: 7, totalEXP: 0, coins: 0 },
    other: { name: 'OtherPeriod', lastPeriod: 'zzz-different', pvpWins: 20, totalEXP: 0, coins: 0 },
  });

  openDojoKiosk();
  wbClickByText('View Leaderboard');
  await new Promise(r => setTimeout(r, 0));
  const lbText = textOf('#wbBody');
  console.log('Shows the higher-win student first:', lbText.indexOf('Rival') < lbText.indexOf(session.name || 'Demo'));
  console.log('Excludes the different-period student:', !lbText.includes('OtherPeriod'));
  wbClickByText('Back');
}

console.log();
console.log('=== Dojo matchmaking: closing the modal while waiting cancels the match ===');
{
  scene.modalOpen = false;
  openDojoKiosk();
  wbClickByText('Start a Battle');
  await new Promise(r => setTimeout(r, 0));
  const code = q('#wbBody .pv-target').textContent;
  const existsBefore = await Shared.DB.ref('pvpMatches/' + code).once('value');
  console.log('Match exists in the backend before closing:', existsBefore.exists());
  q('#wbCloseBtn').dispatchEvent(new Event('click'));
  await new Promise(r => setTimeout(r, 0));
  const existsAfter = await Shared.DB.ref('pvpMatches/' + code).once('value');
  console.log('Match removed from the backend after closing via the X:', !existsAfter.exists());
}

console.log();
console.log('=== DONE - no uncaught errors reached the harness ===');
} catch (e) {
  console.log('DRIVER FAILED:', e.message);
  console.log(e.stack);
}
})();
`;

try {
  window.eval(gameCode + '\n;\n' + driver);
} catch (e) {
  console.log('FAILED:', e.message);
  console.log(e.stack);
  process.exit(1);
}
