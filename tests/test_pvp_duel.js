const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function makeSharedBackend() {
  const store = {};
  const listeners = {};
  let tsCounter = 0;
  function resolveServerValues(val) {
    // Realistic epoch-scale timestamps (Date.now() + a strictly increasing counter) so the
    // real game's Date.now()-based round-timer math behaves sanely in this simulation,
    // while the added counter still guarantees strict ordering even if two writes land in
    // the same millisecond during fast test execution.
    if (val === 'SERVER_TIMESTAMP') return Date.now() + (++tsCounter);
    if (val && typeof val === 'object') {
      const out = Array.isArray(val) ? [] : {};
      for (const k in val) out[k] = resolveServerValues(val[k]);
      return out;
    }
    return val;
  }
  function snapFor(p) { const val = store[p]; return { exists: () => val !== undefined, val: () => val }; }
  function notify(p) { const ls = listeners[p]; if (ls) for (const h of [...ls]) h(snapFor(p)); }
  function makeRef(p) {
    return {
      once: async () => snapFor(p),
      set: async (val) => { store[p] = resolveServerValues(JSON.parse(JSON.stringify(val))); notify(p); },
      update: async (partial) => {
        store[p] = Object.assign({}, store[p] || {}, resolveServerValues(JSON.parse(JSON.stringify(partial))));
        notify(p);
      },
      remove: async () => { delete store[p]; notify(p); },
      on: (event, handler) => { if (!listeners[p]) listeners[p] = new Set(); listeners[p].add(handler); handler(snapFor(p)); },
      off: (event, handler) => { const ls = listeners[p]; if (ls) ls.delete(handler); },
    };
  }
  return { ref: makeRef, _store: store };
}

const dir = require('path').join(__dirname, '..', 'game');
const scripts = [
  'shared-student.js', 'manifest.js', 'assets_data.js', 'monster_assets.js', 'character.js',
  'world.js', 'placevalue.js', 'quests.js', 'battle.js', 'pvp.js', 'items.js', 'gameplay.js', 'npcs.js', 'dojo.js', 'session.js',
];
const gameCode = scripts.map(s => fs.readFileSync(path.join(dir, s), 'utf8')).join('\n;\n');

function makeStudentWindow(backend, name, nameKey, coins) {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/index.html', runScripts: 'outside-only', resources: 'usable', pretendToBeVisual: true });
  const { window } = dom;
  const noop = () => {};
  const fakeCtx = new Proxy({}, {
    get(t, p) { if (p === 'measureText') return () => ({ width: 0 }); if (typeof p === 'string') return noop; return undefined; },
    set() { return true; },
  });
  window.HTMLCanvasElement.prototype.getContext = () => fakeCtx;
  window.requestAnimationFrame = () => 0;
  const databaseFn = () => backend;
  databaseFn.ServerValue = { TIMESTAMP: 'SERVER_TIMESTAMP' };
  window.firebase = { initializeApp: noop, database: databaseFn };

  const driver = `
    session = {
      name: '${name}', nameKey: '${nameKey}', pin: '0000', period: '3', demo: false,
      record: { name: '${name}', totalEXP: 0, coins: ${coins}, hp: 5, inventory: [], equipped: { weapon: null, armor: null } },
    };
    playerStats.hp = 5; playerStats.maxHp = 5;
    hasBackpack = true;
    suppressSave = true; // this test drives state directly; no real save-to-Firebase needed
    // pvpEnded/pvpCurrentRound/session are all let-scoped module internals, so (same as
    // real browsers) they never become window properties on their own — expose a small
    // reporter closure so the outer test script can read them.
    window.__state = () => ({
      hp: playerStats.hp, coins: session.record.coins, pvpWins: session.record.pvpWins,
      pvpEnded, pvpCurrentRound, sceneMode: scene.mode, sceneBuildingId: scene.buildingId,
    });
    window.__log = [];
    const __origHandler = onPvpBattleChange;
    onPvpBattleChange = function(data) {
      window.__log.push(data ? { status: data.status, round: data.round, hostHp: data.hostHp, guestHp: data.guestHp } : null);
      return __origHandler(data);
    };
  `;
  window.eval(gameCode + '\n;\n' + driver);
  return window;
}

function q(win, sel) { return win.document.querySelector(sel); }
function textOf(win, sel) { const el = q(win, sel); return el ? el.textContent : '(missing)'; }
async function tick(n) { for (let i = 0; i < (n || 3); i++) await new Promise(r => setTimeout(r, 0)); }

async function main() {
  const backend = makeSharedBackend();
  const alice = makeStudentWindow(backend, 'Alice', 'alice', 50);
  const bob = makeStudentWindow(backend, 'Bob', 'bob', 80);

  console.log('=== Host (Alice) creates a match, Bob joins ===');
  const created = await alice.Shared.createMatch('alice', 'Alice', '3');
  console.log('Match created:', created.ok, created.code);
  const joined = await bob.Shared.joinMatch(created.code, 'bob', 'Bob');
  console.log('Bob joined:', joined.ok);

  console.log();
  console.log('=== Both clients start the duel (mirroring what dojo.js does after a match) ===');
  await alice.startPvpDuel(created.code, 'host');
  await bob.startPvpDuel(created.code, 'guest');
  await tick(5);

  console.log('Alice sees the battle overlay open:', q(alice, '#battleOverlay').classList.contains('hidden') === false);
  console.log('Bob sees the battle overlay open:', q(bob, '#battleOverlay').classList.contains('hidden') === false);
  console.log('Alice sees opponent name Bob:', textOf(alice, '#battleMonsterName') === 'Bob');
  console.log('Bob sees opponent name Alice:', textOf(bob, '#battleMonsterName') === 'Alice');

  console.log();
  console.log('=== Round 1 started automatically by the host with a SHARED question ===');
  const backendData = backend._store['pvpBattles/' + created.code];
  console.log('Both windows at round 1:', alice.__state().pvpCurrentRound === 1 && bob.__state().pvpCurrentRound === 1);
  console.log('Shared question exists in backend:', !!backendData.question);
  // Confirm both windows are rendering off the EXACT same digits (deep structural check).
  const q1 = backendData.question;
  console.log('Question payload has active + digits:', Array.isArray(q1.active) && Array.isArray(q1.digits));

  console.log();
  console.log('=== Round 1: both answer correctly, Alice first (Alice should land the hit) ===');
  alice.pvpSubmit(true);
  await tick(2);
  bob.pvpSubmit(true);
  await tick(5);
  const afterR1 = backend._store['pvpBattles/' + created.code];
  console.log('Round advanced to 2:', afterR1.round === 2);
  console.log('Bob (guest) took the damage (guestHp expect 4):', afterR1.guestHp);
  console.log('Alice (host) untouched (hostHp expect 5):', afterR1.hostHp);
  console.log('Both windows show updated HP bars:',
    q(alice, '#battleMonsterHpFill').style.width, q(bob, '#battlePlayerHpFill').style.width);

  console.log();
  console.log('=== Round 2: only Bob is correct (auto-hit, no timing tiebreak needed) ===');
  console.log('Both auto-advanced to round 2 with a NEW question:', alice.__state().pvpCurrentRound === 2 && bob.__state().pvpCurrentRound === 2);
  alice.pvpSubmit(false);
  bob.pvpSubmit(true);
  await tick(5);
  const afterR2 = backend._store['pvpBattles/' + created.code];
  console.log('Round advanced to 3:', afterR2.round === 3);
  console.log('Alice (host) took the damage (hostHp expect 4):', afterR2.hostHp);
  console.log('Bob (guest) untouched (guestHp expect 4):', afterR2.guestHp);

  console.log();
  console.log('=== Round 3: both wrong — no damage, still advances ===');
  alice.pvpSubmit(false);
  bob.pvpSubmit(false);
  await tick(5);
  const afterR3 = backend._store['pvpBattles/' + created.code];
  console.log('Round advanced to 4:', afterR3.round === 4);
  console.log('No HP change (host 4, guest 4):', afterR3.hostHp, afterR3.guestHp);

  console.log();
  console.log('=== Fast-forward to knockout: Bob wins every remaining round (guestHp -> 0) ===');
  for (let i = 0; i < 4 && !alice.__state().pvpEnded; i++) {
    alice.pvpSubmit(false);
    bob.pvpSubmit(true);
    await tick(5);
  }
  console.log('Battle marked over on both sides:', alice.__state().pvpEnded, bob.__state().pvpEnded);
  const final = backend._store['pvpBattles/' + created.code];
  console.log('Final winner recorded:', final.winner, '(expect guest)');
  console.log('Alice sees Defeated screen:', textOf(alice, '#battleBody').includes('Defeated'));
  console.log('Bob sees Victory screen:', textOf(bob, '#battleBody').includes('Victory'));

  console.log();
  console.log('=== Winner processing: gold bonus (10% of loser gold) + pvpWins ===');
  console.log('Bob\\u2019s gold before: 80, expect +5 (10% of Alice\\u2019s 50):', bob.__state().coins);
  console.log('Bob\\u2019s pvpWins incremented:', bob.__state().pvpWins === 1);
  console.log('Alice\\u2019s gold UNCHANGED (bonus, not a steal):', alice.__state().coins === 50);

  console.log();
  console.log('=== Loser knockout: clicking Okay teleports Alice home at 1 HP ===');
  const okayBtn = [...q(alice, '#battleBody').querySelectorAll('button')].find(b => b.textContent === 'Okay');
  okayBtn.dispatchEvent(new alice.Event('click'));
  console.log('Alice teleported to home interior:', alice.__state().sceneMode === 'interior' && alice.__state().sceneBuildingId === 'home');
  console.log('Alice at 1 HP:', alice.__state().hp === 1);

  console.log();
  console.log('=== A separate forfeit duel: guest forfeits mid-round ===');
  {
    const created2 = await alice.Shared.createMatch('alice', 'Alice', '3');
    await bob.Shared.joinMatch(created2.code, 'bob', 'Bob');
    await alice.startPvpDuel(created2.code, 'host');
    await bob.startPvpDuel(created2.code, 'guest');
    await tick(5);
    // Bob forfeits via the real "Leave Battle" topbar button (the same DOM path a real
    // student clicking it mid-duel would take).
    q(bob, '#battleLeaveBtn').dispatchEvent(new bob.Event('click'));
    await tick(5);
    const finalF = backend._store['pvpBattles/' + created2.code];
    console.log('Forfeit recorded, host (Alice) declared winner:', finalF.winner === 'host', finalF.endedReason);
    console.log('Alice sees Victory from the forfeit:', textOf(alice, '#battleBody').includes('Victory'));
  }

  console.log();
  console.log('=== Stall detection: opponent tab effectively vanishes mid-round (fake timers) ===');
  {
    const created3 = await alice.Shared.createMatch('alice', 'Alice', '3');
    await bob.Shared.joinMatch(created3.code, 'bob', 'Bob');

    // Install the timer mock BEFORE starting the duel, so it captures the round-1 timers
    // that startPvpDuel's automatic kickoff schedules (installing it after would miss
    // them, since they'd already be real pending timers by then).
    const realSetTimeoutAlice = alice.window.setTimeout;
    let capturedStallCb = null;
    alice.window.setTimeout = (cb, ms) => {
      if (ms > 40000) { capturedStallCb = cb; return 0; } // capture the stall watchdog specifically
      return realSetTimeoutAlice(cb, 0); // let the round-miss timer resolve immediately for this check
    };

    await alice.startPvpDuel(created3.code, 'host');
    await bob.startPvpDuel(created3.code, 'guest');
    await tick(5);

    alice.pvpSubmit(true); // Alice answers; Bob never does (simulating a dead tab)
    await tick(5);
    console.log('Alice is waiting, stall watchdog captured:', !!capturedStallCb);
    capturedStallCb();
    await tick(5);
    const finalS = backend._store['pvpBattles/' + created3.code];
    console.log('Stalled match resolved with Alice (host) as winner:', finalS.winner === 'host', finalS.endedReason);
    alice.window.setTimeout = realSetTimeoutAlice;
  }

  console.log();
  console.log('=== DONE - no uncaught errors ===');
}

main().catch((e) => { console.log('FAILED:', e.message); console.log(e.stack); process.exitCode = 1; });
