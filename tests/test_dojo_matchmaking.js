const fs = require('fs');
const { JSDOM } = require('jsdom');

// A minimal in-memory stand-in for the Firebase Realtime Database's ref/once/set/update/
// remove/on/off surface — enough to exercise real async round-trips between two
// independent realms without a real network connection. Both "student" windows below
// share this SAME object, exactly as two real browsers would share the same live
// Firebase project.
function makeSharedBackend() {
  const store = {};
  const listeners = {}; // path -> Set<handler>

  function snapFor(path) {
    const val = store[path];
    return {
      exists: () => val !== undefined,
      val: () => val,
      // Matches real Firebase's DataSnapshot.forEach — used by leaderboard-style queries
      // that read a whole collection (e.g. ref('students')) and iterate its children.
      forEach: (cb) => { if (val && typeof val === 'object') { for (const k in val) cb({ exists: () => true, val: () => val[k] }); } },
    };
  }
  function notify(path) {
    const ls = listeners[path];
    if (!ls) return;
    for (const handler of ls) handler(snapFor(path));
  }
  function makeRef(path) {
    return {
      once: async () => snapFor(path),
      set: async (val) => { store[path] = JSON.parse(JSON.stringify(val)); notify(path); },
      update: async (partial) => {
        store[path] = Object.assign({}, store[path] || {}, JSON.parse(JSON.stringify(partial)));
        notify(path);
      },
      remove: async () => { delete store[path]; notify(path); },
      on: (event, handler) => {
        if (!listeners[path]) listeners[path] = new Set();
        listeners[path].add(handler);
        handler(snapFor(path)); // real Firebase .on('value') fires immediately too
      },
      off: (event, handler) => {
        const ls = listeners[path];
        if (ls) ls.delete(handler);
      },
    };
  }
  return { ref: makeRef, _store: store };
}

function makeStudentWindow(backend) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  const { window } = dom;
  const databaseFn = () => backend;
  databaseFn.ServerValue = { TIMESTAMP: 'SERVER_TIMESTAMP' };
  window.firebase = { initializeApp: () => {}, database: databaseFn };
  const code = fs.readFileSync(require('path').join(__dirname, '..', 'game', 'shared-student.js'), 'utf8');
  window.eval(code);
  return window;
}

async function main() {
  const backend = makeSharedBackend();
  const hostWindow = makeStudentWindow(backend);
  const guestWindow = makeStudentWindow(backend);
  const spoilerWindow = makeStudentWindow(backend); // a third student, to test "already matched"

  console.log('=== DB_OK true in both windows (fake Firebase connected) ===');
  console.log('host DB_OK:', hostWindow.Shared.DB_OK, 'guest DB_OK:', guestWindow.Shared.DB_OK);

  console.log();
  console.log('=== Host creates a match ===');
  const created = await hostWindow.Shared.createMatch('alice', 'Alice', '3');
  console.log('createMatch ok:', created.ok, 'code length 4:', created.ok && created.code.length === 4);
  const code = created.code;

  console.log();
  console.log('=== Host watches the match; nothing has happened yet ===');
  let hostSeen = [];
  const unwatch = hostWindow.Shared.watchMatch(code, (match) => hostSeen.push(match));
  console.log('Initial watch fire captured the waiting match:', hostSeen.length === 1 && hostSeen[0].status === 'waiting');

  console.log();
  console.log('=== A third student tries to join their OWN... wait, a stranger joins first ===');
  const joined = await guestWindow.Shared.joinMatch(code, 'bob', 'Bob');
  console.log('joinMatch ok:', joined.ok, 'returned hostName:', joined.hostName);

  console.log();
  console.log("=== Host's live watcher fired automatically the moment Bob joined ===");
  console.log('Host saw a second update:', hostSeen.length === 2);
  console.log('Second update status is ready:', hostSeen[1] && hostSeen[1].status === 'ready');
  console.log('Second update includes guest name Bob:', hostSeen[1] && hostSeen[1].guest && hostSeen[1].guest.name === 'Bob');

  console.log();
  console.log('=== A second student trying the same code now gets rejected (already matched) ===');
  const secondJoin = await spoilerWindow.Shared.joinMatch(code, 'carol', 'Carol');
  console.log('Second join rejected:', !secondJoin.ok);
  console.log('Rejection message:', secondJoin.error);

  console.log();
  console.log('=== Joining a code that was never created fails cleanly ===');
  const badJoin = await guestWindow.Shared.joinMatch('ZZZZ', 'dave', 'Dave');
  console.log('Bad code rejected:', !badJoin.ok);
  console.log('Rejection message:', badJoin.error);

  console.log();
  console.log('=== A host cannot join their own open match ===');
  const created2 = await hostWindow.Shared.createMatch('erin', 'Erin', '3');
  const selfJoin = await hostWindow.Shared.joinMatch(created2.code, 'erin', 'Erin');
  console.log('Self-join rejected:', !selfJoin.ok);
  console.log('Rejection message:', selfJoin.error);
  await hostWindow.Shared.cancelMatch(created2.code);

  console.log();
  console.log('=== Cancelling a match removes it and notifies watchers ===');
  let cancelSeen = null;
  const unwatch2 = hostWindow.Shared.watchMatch(code, (match) => { cancelSeen = match; });
  await hostWindow.Shared.cancelMatch(code);
  console.log('Watcher notified of removal (null):', cancelSeen === null);
  unwatch2();

  console.log();
  console.log('=== unwatch() actually stops future notifications ===');
  const created3 = await guestWindow.Shared.createMatch('finn', 'Finn', '3');
  let watchCount = 0;
  const unwatch3 = guestWindow.Shared.watchMatch(created3.code, () => { watchCount++; });
  unwatch3(); // stop watching immediately
  await hostWindow.Shared.joinMatch(created3.code, 'gina', 'Gina'); // triggers a change
  console.log('No notification received after unwatch (expect 1, just the initial fire):', watchCount === 1);
  await hostWindow.Shared.cancelMatch(created3.code);

  unwatch();

  console.log();
  console.log('=== PvP leaderboard: filters by period, sorted by wins, ignores 0-win students ===');
  {
    // Seed a few student records directly (mirrors what saveSession() would write) — all
    // under one 'students' node, since that's the single path loadPvpLeaderboardByPeriod
    // actually reads and iterates with .forEach().
    await backend.ref('students').set({
      alice: { name: 'Alice', lastPeriod: '3', pvpWins: 5, totalEXP: 0, coins: 0 },
      bob: { name: 'Bob', lastPeriod: '3', pvpWins: 12, totalEXP: 0, coins: 0 },
      carol: { name: 'Carol', lastPeriod: '3', pvpWins: 0, totalEXP: 0, coins: 0 },
      dave: { name: 'Dave', lastPeriod: '4', pvpWins: 99, totalEXP: 0, coins: 0 }, // wrong period
      mrsmith: { name: 'Mr. Smith', lastPeriod: '3', pvpWins: 50, totalEXP: 0, coins: 0, isTeacher: true },
    });

    const board = await hostWindow.Shared.loadPvpLeaderboardByPeriod('3');
    console.log('Correct number of eligible entries (expect 2 — Alice and Bob):', board.length === 2);
    console.log('Sorted by wins descending (Bob first):', board[0] && board[0].name === 'Bob');
    console.log('Zero-win student (Carol) excluded:', !board.some(r => r.name === 'Carol'));
    console.log('Different-period student (Dave) excluded:', !board.some(r => r.name === 'Dave'));
    console.log('Teacher account excluded even with wins:', !board.some(r => r.name === 'Mr. Smith'));
  }

  console.log();
  console.log('=== DONE - no uncaught errors ===');
}

main().catch((e) => { console.log('FAILED:', e.message); console.log(e.stack); process.exit(1); });
