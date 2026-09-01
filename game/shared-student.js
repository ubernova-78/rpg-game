/*
  shared-student.js
  ------------------------------------------------------------------
  Logic shared by every mini-game in Physics Quest: the Firebase
  connection, the student record (name/PIN/EXP/coins), and the
  leveling curve. Load this ONE file in every game (and the hub)
  instead of copy-pasting this logic — changing leveling, EXP rules,
  or the Firebase project only ever needs to happen here.

  Usage in a game's HTML:
    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js"></script>
    <script src="shared-student.js"></script>
  Then call: Shared.loadOrCreateStudent(name, pin, period), Shared.saveStudent(nameKey, record),
  Shared.getLevelInfo(totalEXP), Shared.normalizeName(name), Shared.DB_OK
  ------------------------------------------------------------------
*/
window.Shared = (function(){

  const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyAJYJu8Uxf0F-Hd96hD1QOVSJzIRvqyt34",
    authDomain:        "place-value-bench.firebaseapp.com",
    databaseURL:       "https://place-value-bench-default-rtdb.firebaseio.com",
    projectId:         "place-value-bench",
    storageBucket:     "place-value-bench.firebasestorage.app",
    messagingSenderId: "669881005089",
    appId:             "1:669881005089:web:9b80b899fb44b66e469f60"
  };

  let DB = null, DB_OK = false;
  try{
    firebase.initializeApp(FIREBASE_CONFIG);
    DB = firebase.database();
    DB_OK = true;
  }catch(e){
    console.warn('Firebase off:', e);
    DB_OK = false;
  }

  function normalizeName(n){ return n.trim().toLowerCase(); }

  // Triangular EXP curve: cumulative EXP needed to REACH a level (level 1 = 0 EXP).
  // Level 2 = 100, Level 3 = 300, Level 4 = 600, Level 5 = 1000, ...
  // Change this one function to re-tune leveling for every game at once.
  function levelThreshold(level){
    return Math.round(100 * (level*(level-1))/2);
  }
  function getLevelInfo(totalEXP){
    let level = 1;
    while(levelThreshold(level+1) <= totalEXP){ level++; }
    const floor = levelThreshold(level);
    const nextReq = levelThreshold(level+1);
    const span = nextReq - floor;
    return { level, floor, nextReq, progress: span > 0 ? (totalEXP-floor)/span : 1 };
  }

  // Logs in an existing student. Returns { ok:true, record, nameKey } or { ok:false, error }.
  async function loginStudent(name, pin){
    const nameKey = normalizeName(name);
    if(!DB_OK){
      return { ok:false, error:'Database is offline. Please try again later.' };
    }
    let existing = null;
    try{
      const snap = await DB.ref('students/'+nameKey).once('value');
      if(snap.exists()) existing = snap.val();
    }catch(e){ console.warn('Student read failed', e); }

    if(!existing){
      return { ok:false, error:'No account found with that name. Check your spelling, or create a new account.' };
    }
    if(existing.pin !== pin){
      return { ok:false, error:'That name is already used with a different PIN. Double-check your PIN, or pick a different name.' };
    }
    return { ok:true, record: existing, nameKey };
  }

  // Creates a new student account. Returns { ok:true, record, nameKey } or { ok:false, error }.
  async function createStudent(name, pin, period){
    const nameKey = normalizeName(name);
    if(!DB_OK){
      return { ok:true, nameKey, offline:true,
        record: { name:name.trim(), pin, totalEXP:0, coins:0, lastPeriod:period, inventory:[], equipped:{weapon:null,armor:null} } };
    }
    let existing = null;
    try{
      const snap = await DB.ref('students/'+nameKey).once('value');
      if(snap.exists()) existing = snap.val();
    }catch(e){ console.warn('Student read failed', e); }

    if(existing){
      return { ok:false, error:'That name is already taken. Pick a different name, or log in if it\'s yours.' };
    }

    const fresh = {
      name: name.trim(), pin, totalEXP:0, coins:0, lastPeriod: period,
      inventory: [], equipped: { weapon:null, armor:null }
    };
    return { ok:true, record: fresh, nameKey };
  }

  // Backward-compatible wrapper (used by mini-games via postMessage).
  async function loadOrCreateStudent(name, pin, period){
    const login = await loginStudent(name, pin);
    if(login.ok) { login.record.lastPeriod = period; return login; }
    return createStudent(name, pin, period);
  }

  async function saveStudent(nameKey, record){
    if(!DB_OK) return false;
    try{ await DB.ref('students/'+nameKey).set(record); return true; }
    catch(e){ console.warn('Student save failed', e); return false; }
  }

  async function loadLeaderboardByPeriod(period){
    if(!DB_OK) return [];
    try{
      const snap = await DB.ref('students').once('value');
      const entries = [];
      snap.forEach(child=>{
        const d = child.val();
        if(d && d.lastPeriod === period && !d.isTeacher) entries.push(d);
      });
      entries.sort((a,b)=> (b.totalEXP||0)-(a.totalEXP||0));
      return entries;
    }catch(e){
      console.warn('Leaderboard load failed', e);
      return [];
    }
  }

  // Same shape/source as loadLeaderboardByPeriod above, just ranked by PvP win count
  // instead of EXP — used by the Dojo's leaderboard screen.
  async function loadPvpLeaderboardByPeriod(period){
    if(!DB_OK) return [];
    try{
      const snap = await DB.ref('students').once('value');
      const entries = [];
      snap.forEach(child=>{
        const d = child.val();
        if(d && d.lastPeriod === period && !d.isTeacher && (d.pvpWins||0) > 0) entries.push(d);
      });
      entries.sort((a,b)=> (b.pvpWins||0)-(a.pvpWins||0));
      return entries;
    }catch(e){
      console.warn('PvP leaderboard load failed', e);
      return [];
    }
  }

  // ---------- PvP matchmaking (the Dojo's Battle Kiosk) ----------
  // A match is a short-lived node at pvpMatches/{code}: { status, period, host, guest,
  // createdAt }. status starts 'waiting' (host only), becomes 'ready' once a guest joins.
  // Deliberately excludes 0/O/1/I so a code read aloud in a classroom is never ambiguous.
  const MATCH_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function generateMatchCode(len){
    len = len || 4;
    let code = '';
    for (let i = 0; i < len; i++) code += MATCH_CODE_CHARS[Math.floor(Math.random()*MATCH_CODE_CHARS.length)];
    return code;
  }

  async function createMatch(hostNameKey, hostName, period){
    if(!DB_OK) return { ok:false, error:'Battles need an internet connection.' };
    for (let attempt = 0; attempt < 5; attempt++){
      const code = generateMatchCode();
      try{
        const ref = DB.ref('pvpMatches/'+code);
        const snap = await ref.once('value');
        if (snap.exists()) continue; // extremely unlikely collision — just try another code
        await ref.set({
          status: 'waiting',
          period,
          host: { nameKey: hostNameKey, name: hostName },
          guest: null,
          createdAt: (typeof firebase !== 'undefined' && firebase.database && firebase.database.ServerValue)
            ? firebase.database.ServerValue.TIMESTAMP : Date.now(),
        });
        return { ok:true, code };
      }catch(e){ console.warn('createMatch failed', e); }
    }
    return { ok:false, error:'Could not start a battle right now. Try again.' };
  }

  async function joinMatch(code, guestNameKey, guestName){
    if(!DB_OK) return { ok:false, error:'Battles need an internet connection.' };
    code = (code||'').trim().toUpperCase();
    if (!code) return { ok:false, error:'Type in a code first.' };
    try{
      const ref = DB.ref('pvpMatches/'+code);
      const snap = await ref.once('value');
      if (!snap.exists()) return { ok:false, error:'No battle found with that code.' };
      const match = snap.val();
      if (match.status !== 'waiting') return { ok:false, error:'That battle already has two players.' };
      if (match.host && match.host.nameKey === guestNameKey) return { ok:false, error:"You can't join your own battle." };
      await ref.update({ guest: { nameKey: guestNameKey, name: guestName }, status: 'ready' });
      return { ok:true, code, hostName: match.host ? match.host.name : '' };
    }catch(e){
      console.warn('joinMatch failed', e);
      return { ok:false, error:'Could not join that battle. Try again.' };
    }
  }

  // Live-updates the caller on every change to a match node. Returns an unsubscribe
  // function — callers MUST call it when done watching (leaving the kiosk, matched,
  // cancelled), or the listener leaks for the rest of the page session.
  function watchMatch(code, onChange){
    if(!DB_OK) return () => {};
    const ref = DB.ref('pvpMatches/'+code);
    const handler = snap => onChange(snap.exists() ? snap.val() : null);
    ref.on('value', handler);
    return () => ref.off('value', handler);
  }

  async function cancelMatch(code){
    if(!DB_OK || !code) return;
    try{ await DB.ref('pvpMatches/'+code).remove(); }
    catch(e){ console.warn('cancelMatch failed', e); }
  }

  // ---------- Live PvP battle (once matched) ----------
  // A live duel is its own node, pvpBattles/{code}, kept separate from the matchmaking
  // node above. Both sides only ever write their OWN keys (hostHp/hostAnswer vs.
  // guestHp/guestAnswer, etc.) except for round progression, which only the host ever
  // writes — that single-writer rule is what keeps this race-free without needing a real
  // backend function: two browsers independently calling update() on DIFFERENT keys of the
  // same object can never clobber each other, only writes to the SAME key could race, and
  // there's exactly one writer for every key that matters for progression.
  async function reportBattleReady(code, side, hp, maxHp, name, gold){
    if(!DB_OK) return;
    const patch = {};
    patch[side+'Hp'] = hp; patch[side+'MaxHp'] = maxHp; patch[side+'Name'] = name; patch[side+'Gold'] = gold;
    try{ await DB.ref('pvpBattles/'+code).update(patch); }
    catch(e){ console.warn('reportBattleReady failed', e); }
  }

  // Host-only: starts round 1 (or any subsequent round) with a shared question and clears
  // both answer slots.
  async function startBattleRound(code, round, question){
    if(!DB_OK) return;
    try{
      await DB.ref('pvpBattles/'+code).update({
        status: 'question', round, question, hostAnswer: null, guestAnswer: null,
        roundStartedAt: (typeof firebase !== 'undefined' && firebase.database && firebase.database.ServerValue)
          ? firebase.database.ServerValue.TIMESTAMP : Date.now(),
      });
    }catch(e){ console.warn('startBattleRound failed', e); }
  }

  async function submitBattleAnswer(code, side, correct){
    if(!DB_OK) return;
    const patch = {};
    patch[side+'Answer'] = { correct, ts: (typeof firebase !== 'undefined' && firebase.database && firebase.database.ServerValue)
      ? firebase.database.ServerValue.TIMESTAMP : Date.now() };
    try{ await DB.ref('pvpBattles/'+code).update(patch); }
    catch(e){ console.warn('submitBattleAnswer failed', e); }
  }

  // Host-only: applies the outcome of a resolved round (HP changes, and either the next
  // round's question or a final winner) in one atomic-ish update.
  async function applyBattleResolution(code, patch){
    if(!DB_OK) return;
    try{ await DB.ref('pvpBattles/'+code).update(patch); }
    catch(e){ console.warn('applyBattleResolution failed', e); }
  }

  function watchBattle(code, onChange){
    if(!DB_OK) return () => {};
    const ref = DB.ref('pvpBattles/'+code);
    const handler = snap => onChange(snap.exists() ? snap.val() : null);
    ref.on('value', handler);
    return () => ref.off('value', handler);
  }

  // Pure decision: given both sides' answers for one round, who lands the hit? (null =
  // neither — both got it wrong, no damage this round.) Kept as a standalone pure
  // function so it's testable without the full game/DOM, and so the rule is defined in
  // exactly one place. Ties (both correct) go to whichever answer's server timestamp is
  // earlier; if either timestamp hasn't resolved yet (still a ServerValue placeholder),
  // returns null so the caller waits rather than guessing.
  function resolveRoundOutcome(hostAnswer, guestAnswer){
    const hostOk = !!(hostAnswer && hostAnswer.correct);
    const guestOk = !!(guestAnswer && guestAnswer.correct);
    if (hostOk && guestOk) {
      const hostTs = hostAnswer.ts, guestTs = guestAnswer.ts;
      if (typeof hostTs !== 'number' || typeof guestTs !== 'number') return null;
      return hostTs <= guestTs ? 'host' : 'guest';
    }
    if (hostOk) return 'host';
    if (guestOk) return 'guest';
    return null;
  }

  async function cleanupBattle(code){
    if(!DB_OK || !code) return;
    try{
      await DB.ref('pvpBattles/'+code).remove();
      await DB.ref('pvpMatches/'+code).remove();
    }catch(e){ console.warn('cleanupBattle failed', e); }
  }

  return {
    DB, DB_OK,
    normalizeName, levelThreshold, getLevelInfo,
    loginStudent, createStudent, loadOrCreateStudent, saveStudent, loadLeaderboardByPeriod, loadPvpLeaderboardByPeriod,
    generateMatchCode, createMatch, joinMatch, watchMatch, cancelMatch,
    reportBattleReady, startBattleRound, submitBattleAnswer, applyBattleResolution,
    watchBattle, resolveRoundOutcome, cleanupBattle
  };
})();
