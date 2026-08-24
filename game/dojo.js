// dojo.js — the Dojo's Battle Kiosk: real matchmaking (host a battle and get a shareable
// code, or join with a code a classmate gave you) that leads straight into a live duel
// (pvp.js) the moment both students are ready, plus a per-period leaderboard ranked by
// PvP win count. Backed by Shared's match/battle/leaderboard functions in
// shared-student.js, the same Firebase project every other save already uses.

let dojoActiveMatchCode = null;
let dojoUnwatch = null;

// The Dojo Master stands to the left, away from the sparring area — walk up to them to
// open the battle menu (same flow as before, just triggered by an NPC instead of a
// physical kiosk). Reuses the same character compositor NPCs use (buildStaticSheet).
const DOJO_MASTER_SPEC = { head: 'head3', hair: 'hair7', top: 'top8', bottom: 'bottom6', skinTone: 1 };
const DOJO_MASTER_SHEET = buildStaticSheet(DOJO_MASTER_SPEC);
const DOJO_MASTER_COL = 3, DOJO_MASTER_ROW = 3;
function drawDojoMaster() {
  const size = FRAME * SCALE;
  const x = DOJO_MASTER_COL * TILE, y = DOJO_MASTER_ROW * TILE;
  mapCtx.drawImage(DOJO_MASTER_SHEET, WALK_COLS[1] * FRAME, DIR_ROW.south * FRAME, FRAME, FRAME, x, y, size, size);
}
function nearbyDojoMaster(x, y) {
  const spriteSize = FRAME * SCALE;
  const cx = x + spriteSize / 2, cy = y + spriteSize / 2;
  const mcx = DOJO_MASTER_COL * TILE + spriteSize / 2, mcy = DOJO_MASTER_ROW * TILE + spriteSize / 2;
  return Math.hypot(cx - mcx, cy - mcy) < spriteSize * 0.32;
}

// Four purely decorative sparring students — two pairs, grouped off to the right so they
// don't crowd the path to the Dojo Master. Each one is a genuinely equipped character
// (random look, holding a real weapon through the SAME layered compositor the player's
// own equipped gear uses — see ORDER_DEFAULT's 'weapon' slot in character.js) rather than
// a separate image rotated on top, which is what made the weapon look disconnected from
// the hand before: the weapon art is drawn as just another per-direction layer, already
// aligned to the hand by the same artists who made the rest of the outfit layers, so it's
// correctly attached in every frame for free.
function dojoRandomLook(weaponId) {
  return {
    head: 'head' + (1 + Math.floor(Math.random() * 8)),
    hair: 'hair' + (1 + Math.floor(Math.random() * 12)),
    top: 'top' + Math.floor(Math.random() * 13),
    bottom: 'bottom' + Math.floor(Math.random() * 9),
    skinTone: Math.floor(Math.random() * 4),
    weapon: weaponId,
  };
}
const DOJO_SPARRERS = [
  // pair 1 — swords
  { sheet: buildStaticSheet(dojoRandomLook('sword1')), col: 7, row: 3 },
  { sheet: buildStaticSheet(dojoRandomLook('sword1')), col: 13, row: 3 },
  // pair 2 — spears
  { sheet: buildStaticSheet(dojoRandomLook('spear1')), col: 7, row: 6 },
  { sheet: buildStaticSheet(dojoRandomLook('spear1')), col: 13, row: 6 },
];
const DOJO_SPAR_CYCLE_MS = 2000; // one full exchange within a pair: A's turn, then B's turn
// This sheet's column layout has real attack-lunge frames beyond the plain 3-frame walk
// cycle (confirmed by rendering the sheet directly) — column 1 is the neutral standing
// pose, 10 is a wind-up with the arm/weapon drawn back, and 11 is the full lunging strike.
// Cycling through those (instead of just sliding the neutral pose left and right, or
// rotating a separate weapon image with no real anchor to the hand) is what actually
// reads as a swing/jab instead of a shuffle.
const DOJO_ATTACK_COLS = [1, 1, 10, 11, 11, 1];
function dojoAttackFrame(progress) {
  const idx = Math.min(DOJO_ATTACK_COLS.length - 1, Math.floor(progress * DOJO_ATTACK_COLS.length));
  return DOJO_ATTACK_COLS[idx];
}
function drawDojoSparrers() {
  const size = FRAME * SCALE;
  const LUNGE = 7, RECOIL = 4;

  // Each pair runs on its own independent clock (pair 2 offset by half a cycle) so the
  // two duels don't move in lockstep — without this they visibly mirrored each other,
  // which read as "everyone shuffling back and forth together" rather than two separate
  // fights.
  for (let p = 0; p < DOJO_SPARRERS.length; p += 2) {
    const pairPhase = p === 0 ? 0 : DOJO_SPAR_CYCLE_MS * 0.5;
    const a = DOJO_SPARRERS[p], b = DOJO_SPARRERS[p + 1];
    const baseAx = a.col * TILE, baseAy = a.row * TILE;
    const baseBx = b.col * TILE - size, baseBy = b.row * TILE;

    const half = DOJO_SPAR_CYCLE_MS / 2;
    const t = (performance.now() + pairPhase) % DOJO_SPAR_CYCLE_MS;
    const aTurn = t < half;
    const turnT = (aTurn ? t : t - half) / half; // 0 -> 1 across whoever's turn this is
    const swingProgress = Math.sin(turnT * Math.PI); // 0 -> 1 -> 0, peaks mid-exchange

    const ax = baseAx + (aTurn ? swingProgress * LUNGE : -swingProgress * RECOIL);
    const bx = baseBx - (!aTurn ? swingProgress * LUNGE : -swingProgress * RECOIL);
    const aCol = aTurn ? dojoAttackFrame(turnT) : WALK_COLS[1];
    const bCol = !aTurn ? dojoAttackFrame(turnT) : WALK_COLS[1];

    // a is on the left, facing east (right, toward b); b is on the right, facing west
    // (left, toward a) — confirmed against the actual sprite art that DIR_ROW.east really
    // does face right and DIR_ROW.west really does face left, so this puts them face to
    // face rather than back to back.
    mapCtx.drawImage(a.sheet, aCol * FRAME, DIR_ROW.east * FRAME, FRAME, FRAME, ax, baseAy, size, size);
    mapCtx.drawImage(b.sheet, bCol * FRAME, DIR_ROW.west * FRAME, FRAME, FRAME, bx, baseBy, size, size);
  }
}

function dojoStopWatching() {
  if (dojoUnwatch) { dojoUnwatch(); dojoUnwatch = null; }
}

function dojoErrorBox() {
  const box = document.createElement('div');
  box.className = 'wb-modal-body';
  box.style.color = '#d1553c';
  return box;
}

function renderKioskHome() {
  dojoStopWatching();
  dojoActiveMatchCode = null;
  wbModalCloseHook = null;
  scene.modalOpen = true;
  wbTitle.textContent = 'Battle Kiosk';
  wbBody.innerHTML = '';
  const intro = document.createElement('div');
  intro.className = 'wb-modal-body';
  intro.textContent = 'Challenge a classmate to a live duel! Start a battle to get a code to share, or join with a code a friend gave you.';
  wbBody.appendChild(intro);
  wbBody.appendChild(gateButton('Start a Battle', renderHostFlow));
  wbBody.appendChild(gateButton('Join with a Code', renderJoinFlow));
  wbBody.appendChild(gateButton('View Leaderboard', renderLeaderboard));
  wbModal.classList.remove('hidden');
}

async function renderLeaderboard() {
  wbModalCloseHook = null;
  wbTitle.textContent = 'Dojo Leaderboard';
  wbBody.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'wb-modal-body';
  msg.textContent = `Loading Period ${session.period}\u2026`;
  wbBody.appendChild(msg);

  const rows = await Shared.loadPvpLeaderboardByPeriod(session.period);

  wbBody.innerHTML = '';
  const heading = document.createElement('div');
  heading.className = 'wb-modal-body';
  heading.textContent = `Period ${session.period} \u2014 most PvP wins`;
  wbBody.appendChild(heading);

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'wb-modal-body';
    empty.textContent = 'No duels won yet this period \u2014 be the first!';
    wbBody.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.style.cssText = 'margin:8px 0;';
    rows.slice(0, 10).forEach((r, i) => {
      const isMe = session.nameKey && r.name && Shared.normalizeName(r.name) === session.nameKey;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;padding:6px 4px;'
        + 'font-family:monospace;'
        + (isMe ? 'background:rgba(214,160,60,0.16);border-radius:4px;' : '');
      const label = document.createElement('span');
      label.textContent = `${i + 1}. ${r.name}`;
      const wins = document.createElement('span');
      wins.textContent = `${r.pvpWins} win${r.pvpWins === 1 ? '' : 's'}`;
      row.appendChild(label);
      row.appendChild(wins);
      list.appendChild(row);
    });
    wbBody.appendChild(list);
  }
  wbBody.appendChild(gateButton('Back', renderKioskHome));
}

async function renderHostFlow() {
  wbBody.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'wb-modal-body';
  msg.textContent = 'Getting a code\u2026';
  wbBody.appendChild(msg);

  const result = await Shared.createMatch(session.nameKey, session.name, session.period);
  if (!result.ok) {
    wbBody.innerHTML = '';
    const err = dojoErrorBox();
    err.textContent = result.error;
    wbBody.appendChild(err);
    wbBody.appendChild(gateButton('Back', renderKioskHome));
    return;
  }
  dojoActiveMatchCode = result.code;
  renderWaitingScreen();
}

function renderWaitingScreen() {
  wbBody.innerHTML = '';
  const codeEl = document.createElement('div');
  codeEl.className = 'pv-target'; // reuses the bench's big monospace number display
  codeEl.textContent = dojoActiveMatchCode;
  wbBody.appendChild(codeEl);
  const msg = document.createElement('div');
  msg.className = 'wb-modal-body';
  msg.textContent = 'Share this code with a classmate. Waiting for them to join\u2026';
  wbBody.appendChild(msg);
  wbBody.appendChild(gateButton('Cancel', async () => {
    dojoStopWatching();
    wbModalCloseHook = null;
    await Shared.cancelMatch(dojoActiveMatchCode);
    renderKioskHome();
  }));

  // Closing the modal outright (the X) while waiting should still clean up the match —
  // otherwise it lingers in Firebase forever with no one able to join it.
  wbModalCloseHook = () => {
    dojoStopWatching();
    Shared.cancelMatch(dojoActiveMatchCode);
    dojoActiveMatchCode = null;
  };

  dojoUnwatch = Shared.watchMatch(dojoActiveMatchCode, (match) => {
    if (match && match.status === 'ready' && match.guest) {
      dojoStopWatching();
      wbModalCloseHook = null;
      closeWorkbench();
      startPvpDuel(dojoActiveMatchCode, 'host');
    }
  });
}

function renderJoinFlow() {
  wbModalCloseHook = null;
  wbBody.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'wb-modal-body';
  label.textContent = 'Enter the code your classmate shared:';
  wbBody.appendChild(label);

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 4;
  input.autocomplete = 'off';
  input.style.cssText = 'width:100%;padding:10px;font-size:20px;text-align:center;'
    + 'text-transform:uppercase;letter-spacing:0.2em;font-family:monospace;border-radius:4px;'
    + 'border:2px solid #27424c;background:#0f1c22;color:#dbe5de;margin-bottom:10px;';
  wbBody.appendChild(input);
  setTimeout(() => input.focus(), 30);

  const errMsg = dojoErrorBox();
  wbBody.appendChild(errMsg);

  wbBody.appendChild(gateButton('Join', async () => {
    const code = input.value.trim().toUpperCase();
    if (!code) { errMsg.textContent = 'Type in a code first.'; return; }
    const result = await Shared.joinMatch(code, session.nameKey, session.name);
    if (!result.ok) { errMsg.textContent = result.error; return; }
    dojoActiveMatchCode = result.code;
    closeWorkbench();
    startPvpDuel(dojoActiveMatchCode, 'guest');
  }));
  wbBody.appendChild(gateButton('Back', renderKioskHome));
}

function openDojoKiosk() {
  renderKioskHome();
}
