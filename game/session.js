// session.js — boot sequence, save/load to the student record, login screen, and the mini-game overlay handoff.

// ---------- Boot ----------
let suppressSave = false; // true while restoring saved data, so loading doesn't trigger a save
function pickDefaultVariety() {
  loadout.hair = 1;
  applyOutfitSet('skirt'); // starts in shirt & skirt per spec; sets loadout.top/bottom
}

// Builds the save-able snapshot of everything the town can change and writes it onto
// session.record, then persists it. No-ops for demo sessions or if not logged in yet.
function saveSession() {
  if (suppressSave || !session || session.demo || !session.nameKey) return;
  session.record.cosmetics = {
    skinTone: loadout.skinTone,
    hair: loadout.hair,
    hairVariant: variantIndex.hair,
    outfitId: currentOutfitId,
  };
  session.record.inventory = inventory;
  session.record.equipped = equipped;
  session.record.chestStorage = chestStorage;
  session.record.hasBackpack = hasBackpack;
  session.record.claimedChests = allChestIds().filter(id => findInteriorObject(id).claimed);
  session.record.hp = playerStats.hp;
  Shared.saveStudent(session.nameKey, session.record);
}

function allChestIds() {
  const ids = [];
  for (const list of Object.values(INTERIOR_OBJECTS)) {
    for (const obj of list) if (obj.kind === 'chest') ids.push(obj.id);
  }
  return ids;
}
function findInteriorObject(id) {
  for (const list of Object.values(INTERIOR_OBJECTS)) {
    const found = list.find(o => o.id === id);
    if (found) return found;
  }
  return null;
}

// Restores a returning student's look, backpack, inventory, equipped gear, and which
// chests they've already opened. Falls back to the same defaults a brand-new student
// gets for anything not yet present in their record (e.g. their very first login).
function loadSessionIntoGame() {
  suppressSave = true;
  const rec = session.record;
  const cos = rec.cosmetics;
  if (cos) {
    loadout.skinTone = cos.skinTone || 0;
    loadout.hair = cos.hair != null ? cos.hair : 1;
    variantIndex.hair = cos.hairVariant || 0;
    applyOutfitSet(cos.outfitId || 'skirt');
  } else {
    pickDefaultVariety();
  }

  inventory.fill(null);
  if (Array.isArray(rec.inventory)) {
    rec.inventory.forEach((item, i) => { if (i < inventory.length) inventory[i] = item; });
  }
  Object.assign(equipped, { helmet: null, weapon: null, cape: null, armor: null }, rec.equipped || {});
  // re-apply equipped gear's visual effect on top of the base look above
  for (const item of Object.values(equipped)) {
    if (item) { loadout[item.manifestKey] = item.manifestIndex; variantIndex[item.manifestKey] = item.variantIndex || 0; }
  }

  // Restore chest storage
  chestStorage.fill(null);
  if (Array.isArray(rec.chestStorage)) {
    rec.chestStorage.forEach((item, i) => { if (i < chestStorage.length) chestStorage[i] = item; });
  }

  hasBackpack = !!rec.hasBackpack;
  inventoryBtn.classList.toggle('hidden', !hasBackpack);

  const levelInfo = Shared.getLevelInfo(rec.totalEXP || 0);
  playerStats.maxHp = maxHpForLevel(levelInfo.level);
  playerStats.hp = rec.hp != null ? Math.min(rec.hp, playerStats.maxHp) : playerStats.maxHp;

  const claimed = new Set(rec.claimedChests || []);
  for (const list of Object.values(INTERIOR_OBJECTS)) {
    for (const obj of list) {
      if (obj.kind === 'chest' && claimed.has(obj.id)) obj.claimed = true;
      if (obj.kind === 'pickup' && hasBackpack) obj.claimed = true; // storage bench mirrors hasBackpack
    }
  }

  suppressSave = false;
  paintHud(); // HP wasn't known yet at the login-time paintHud() call above — refresh now that it's loaded
}

function startGame() {
  if (session.demo) {
    pickDefaultVariety();
    seedTestInventory(); // demo sessions get the placeholder item so the equip flow can still be shown off
  } else {
    loadSessionIntoGame();
  }
  buildCreatorModal();
  requestRecomposite();
  requestAnimationFrame(loop);
}

// ---------- Login / session (same login screen and postMessage handoff as the hub) ----------
let session = { name: '', pin: '', period: '', record: null, nameKey: '', demo: false, teacher: false };

const loginEls = {
  screenLogin: document.getElementById('screenLogin'),
  screenCreate: document.getElementById('screenCreate'),
  screenTown: document.getElementById('screenTown'),
  // Login screen
  pname: document.getElementById('pname'),
  ppin: document.getElementById('ppin'),
  demoMode: document.getElementById('demoMode'),
  err: document.getElementById('loginError'),
  btnLogin: document.getElementById('btnLogin'),
  linkToCreate: document.getElementById('linkToCreate'),
  // Create screen
  createName: document.getElementById('createName'),
  createPin: document.getElementById('createPin'),
  createPeriod: document.getElementById('createPeriod'),
  teacherMode: document.getElementById('teacherMode'),
  createErr: document.getElementById('createError'),
  btnCreate: document.getElementById('btnCreate'),
  linkToLogin: document.getElementById('linkToLogin'),
  // HUD
  welcomeText: document.getElementById('welcomeText'),
  hudLevel: document.getElementById('hudLevel'),
  hudExpFill: document.getElementById('hudExpFill'),
  hudCoins: document.getElementById('hudCoins'),
  hudHp: document.getElementById('hudHp'),
};

// --- Screen switching ---
loginEls.linkToCreate.addEventListener('click', e => {
  e.preventDefault();
  loginEls.screenLogin.classList.add('hidden');
  loginEls.screenCreate.classList.remove('hidden');
});
loginEls.linkToLogin.addEventListener('click', e => {
  e.preventDefault();
  loginEls.screenCreate.classList.add('hidden');
  loginEls.screenLogin.classList.remove('hidden');
});

// --- Login validation ---
loginEls.pname.addEventListener('input', validateLogin);
loginEls.ppin.addEventListener('input', () => {
  loginEls.ppin.value = loginEls.ppin.value.replace(/\D/g, '').slice(0, 4);
  validateLogin();
});
loginEls.demoMode.addEventListener('change', () => {
  loginEls.pname.disabled = loginEls.demoMode.checked;
  loginEls.ppin.disabled = loginEls.demoMode.checked;
  validateLogin();
});
function validateLogin() {
  if (loginEls.demoMode.checked) { loginEls.btnLogin.disabled = false; return; }
  loginEls.btnLogin.disabled = !(loginEls.pname.value.trim() && loginEls.ppin.value.length === 4);
}

// --- Create account validation ---
loginEls.createName.addEventListener('input', validateCreate);
loginEls.createPin.addEventListener('input', () => {
  loginEls.createPin.value = loginEls.createPin.value.replace(/\D/g, '').slice(0, 4);
  validateCreate();
});
loginEls.createPeriod.addEventListener('change', validateCreate);
function validateCreate() {
  loginEls.btnCreate.disabled = !(loginEls.createName.value.trim() && loginEls.createPin.value.length === 4 && loginEls.createPeriod.value);
}

// --- Login handler ---
loginEls.btnLogin.addEventListener('click', async () => {
  loginEls.err.style.display = 'none';

  if (loginEls.demoMode.checked) {
    session = {
      name: 'Demo', pin: '', period: '2', nameKey: '', demo: true, teacher: false,
      record: { name: 'Demo', totalEXP: 0, coins: 0, hp: PLAYER_MAX_HP, inventory: [], equipped: { weapon: null, armor: null } },
    };
    playerStats.maxHp = PLAYER_MAX_HP;
    playerStats.hp = PLAYER_MAX_HP;
    loginEls.welcomeText.textContent = 'Welcome, Demo! (preview mode — nothing is saved)';
    paintHud();
    enterTown();
    return;
  }

  loginEls.btnLogin.disabled = true;
  loginEls.btnLogin.textContent = 'Checking...';
  const name = loginEls.pname.value.trim(), pin = loginEls.ppin.value.trim();

  const result = await Shared.loginStudent(name, pin);
  if (!result.ok) {
    loginEls.err.textContent = result.error;
    loginEls.err.style.display = 'block';
    loginEls.btnLogin.disabled = false;
    loginEls.btnLogin.textContent = 'Log In';
    return;
  }

  const period = result.record.lastPeriod || '';
  session = { name, pin, period, record: result.record, nameKey: result.nameKey, demo: false, teacher: !!result.record.isTeacher };
  loginEls.welcomeText.textContent = session.teacher ? `Welcome, ${name}! (teacher — hidden from leaderboards)` : `Welcome, ${name}!`;
  paintHud();
  enterTown();
});

// --- Create account handler ---
loginEls.btnCreate.addEventListener('click', async () => {
  loginEls.createErr.style.display = 'none';

  loginEls.btnCreate.disabled = true;
  loginEls.btnCreate.textContent = 'Creating...';
  const name = loginEls.createName.value.trim(), pin = loginEls.createPin.value.trim(), period = loginEls.createPeriod.value;
  const teacher = loginEls.teacherMode.checked;

  const result = await Shared.createStudent(name, pin, period);
  if (!result.ok) {
    loginEls.createErr.textContent = result.error;
    loginEls.createErr.style.display = 'block';
    loginEls.btnCreate.disabled = false;
    loginEls.btnCreate.textContent = 'Create Account';
    return;
  }
  result.record.isTeacher = teacher;
  await Shared.saveStudent(result.nameKey, result.record);

  session = { name, pin, period, record: result.record, nameKey: result.nameKey, demo: false, teacher };
  loginEls.welcomeText.textContent = teacher ? `Welcome, ${name}! (teacher — hidden from leaderboards)` : `Welcome, ${name}!`;
  paintHud();
  enterTown();
});

function enterTown() {
  loginEls.screenLogin.classList.add('hidden');
  loginEls.screenCreate.classList.add('hidden');
  loginEls.screenTown.classList.remove('hidden');
  startGame();
}

function paintHud() {
  const info = Shared.getLevelInfo(session.record.totalEXP || 0);
  loginEls.hudLevel.textContent = `Lvl ${info.level}`;
  loginEls.hudExpFill.style.width = `${Math.round(info.progress * 100)}%`;
  loginEls.hudCoins.textContent = `🪙 ${session.record.coins || 0}`;
  // Safety net: keeps max HP in sync with the current level even if something someday
  // grants EXP without going through applyExpGain() — never lowers current HP below what
  // it already was, only clamps it down if maxHp somehow ended up smaller.
  playerStats.maxHp = maxHpForLevel(info.level);
  if (playerStats.hp > playerStats.maxHp) playerStats.hp = playerStats.maxHp;
  loginEls.hudHp.textContent = `❤ ${playerStats.hp}/${playerStats.maxHp}`;
}

// ---------- Mini-game overlay (opened from a workbench; same postMessage handoff as the hub) ----------
const gameOverlayEls = {
  overlay: document.getElementById('gameOverlay'),
  title: document.getElementById('overlayTitle'),
  frame: document.getElementById('gameFrame'),
  btnBack: document.getElementById('btnBackToTown'),
};
function openGameOverlay(wb) {
  scene.modalOpen = true;
  gameOverlayEls.title.textContent = wb.label + (session.demo ? ' (Demo)' : session.teacher ? ' (Teacher)' : '');
  gameOverlayEls.frame.src = wb.src;
  gameOverlayEls.overlay.classList.remove('hidden');
  gameOverlayEls.frame.onload = () => {
    gameOverlayEls.frame.contentWindow.postMessage({
      type: wb.messageType,
      name: session.name,
      pin: session.pin,
      period: session.period,
      demo: session.demo,
      teacher: session.teacher,
      bench: wb.bench, // which specific station inside a multi-bench workshop (e.g. measure-bench.html's 5 stations) — undefined for single-bench workshops like Place Value
      hintPotions: potionCount('hintPotion'),
    }, '*');
  };
}
// Listen for hint-potion consumption requests from workbench iframes
window.addEventListener('message', e => {
  if (e.data && e.data.type === 'consume-hint-potion') {
    consumePotion('hintPotion');
  }
  // Listen for equippable item grants from mini-game iframes
  if (e.data && e.data.type === 'grant-item' && e.data.item) {
    const item = e.data.item;
    if (session.demo || !item.name) return;
    // Check if already owned (don't duplicate)
    const alreadyOwned = inventory.some(x => x && x.name === item.name) ||
      Object.values(equipped).some(x => x && x.name === item.name);
    if (alreadyOwned) return;
    const openSlot = inventory.findIndex(x => x === null);
    if (openSlot !== -1) {
      inventory[openSlot] = item;
      renderInventory();
      saveSession();
    }
  }
});

gameOverlayEls.btnBack.addEventListener('click', async () => {
  gameOverlayEls.overlay.classList.add('hidden');
  gameOverlayEls.frame.src = '';
  scene.modalOpen = false;
  // NOT resetting scene.activeObjectId here — the player hasn't moved, so they're still
  // standing on the workbench's trigger tile; clearing it would let the edge-detection
  // see this as a "fresh" arrival and reopen the game immediately.
  if (session.demo) return;
  if (Shared.DB_OK) {
    try {
      const snap = await Shared.DB.ref('students/' + session.nameKey).once('value');
      if (snap.exists()) { session.record = snap.val(); paintHud(); }
    } catch (e) { /* ignore */ }
  }
});
