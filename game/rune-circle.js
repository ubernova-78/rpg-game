// rune-circle.js — the Rune Circle in the south meadow: hook a metre tape on the stake,
// walk to each of three runes and read the tape, then average the three readings.
// Layout and the answer key live in world.js (RUNE_CIRCLE).
//
// Grading, as Nick set it on 2026-09-23:
//   • 10 points per reading and 10 for the average, each only if right FIRST time
//     (40 in all). Wrong answers still have to be fixed to finish.
//   • Readings are not checked one at a time. After the third, any wrong ones are
//     named — never with the right value — and the student has to walk back to that
//     rune and pull the tape again. Only then is the average asked for.
//   • Finishing pays 100 gold, the FIRST time only. After that the whole circle
//     can be replayed (Nick, 2026-09-23); the best score counts. The distances are
//     the same every time, so the saved record also keeps the first-attempt score
//     and the attempt count -- a replayed 40 isn't the same as a first-time 40.
//   • Every finish ends on a results screen (and the stake shows it again later)
//     listing each first reading and the first average as right or wrong, so a
//     teacher can check a student's work at a glance.

const RC_POINTS_EACH = 10;
const RC_GOAL = RC_POINTS_EACH * (RUNE_CIRCLE.runes.length + 1);
const RC_GOLD = 100;
const RC_DB_PATH = 'rune_circle_scores';

const runeModal = document.getElementById('runeModal');
const runeTitle = document.getElementById('runeTitle');
const runeBody = document.getElementById('runeBody');
const runeUnhookBtn = document.getElementById('runeUnhookBtn');

// phase: 'idle' -> 'measuring' <-> 'paused' -> 'average' -> 'done'
// 'paused' is the tape unhooked part-way: readings AND first-try results are kept,
// so stopping can't be used to wipe a wrong first attempt.
const rc = {
  phase: 'idle',
  readings: RUNE_CIRCLE.runes.map(() => null), // integer hundredths the student entered
  firstTry: RUNE_CIRCLE.runes.map(() => null), // was their FIRST entry right?
  firstReading: RUNE_CIRCLE.runes.map(() => null), // and what it was
  firstAverage: null,
  redo: new Set(),                             // rune indices that must be measured again
  avgFirstTry: null,
  startTime: 0,
  score: 0,
  lastRun: null,  // this session's latest finished run, for demo/teacher (not saved)
  paidGold: false, // demo/teacher: pay once per session, like a real first finish
};

function rcResetRun() {
  rc.readings = RUNE_CIRCLE.runes.map(() => null);
  rc.firstTry = RUNE_CIRCLE.runes.map(() => null);
  rc.firstReading = RUNE_CIRCLE.runes.map(() => null);
  rc.redo = new Set();
  rc.avgFirstTry = null;
  rc.firstAverage = null;
}
function rcSaved() { return (session.record && session.record.runeCircle) || null; }
let rcWasOn = null; // edge detection, same idea as scene.wasOnNpcId

// "Finished and not in the middle of a replay" -- the stake shows results, the
// runes sit quiet and glow green.
function rcAlreadyDone() {
  if (rc.phase === 'done') return true;
  return rc.phase === 'idle' && !!(rcSaved() && rcSaved().done);
}
function rcFmt(h) { return BenchMath.fmt2(h) + ' m'; }
function rcList(idxs) {
  const names = idxs.map(i => 'Rune ' + RUNE_CIRCLE.runes[i].n);
  return names.length <= 1 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}
// Which rune(s) the student should head to right now.
function rcTargets() {
  const next = rc.readings.findIndex(r => r === null);
  if (next !== -1) return [next];
  return [...rc.redo].sort();
}

// ---------- Modal ----------
function openRuneModal(title) {
  scene.modalOpen = true;
  runeTitle.textContent = title;
  runeBody.innerHTML = '';
  runeModal.classList.remove('hidden');
}
function closeRuneModal() {
  scene.modalOpen = false;
  runeModal.classList.add('hidden');
  runeBody.innerHTML = '';
}
function rcText(html, cls) {
  const d = document.createElement('div');
  d.className = 'wb-modal-body' + (cls ? ' ' + cls : '');
  d.innerHTML = html;
  runeBody.appendChild(d);
  return d;
}
function rcButton(label, fn) { const b = gateButton(label, fn); runeBody.appendChild(b); return b; }
function rcReadingsLog() {
  const log = document.createElement('div');
  log.className = 'rc-log';
  rc.readings.forEach((h, i) => {
    if (h === null) return;
    const s = document.createElement('span');
    s.textContent = `Rune ${RUNE_CIRCLE.runes[i].n}: ${rcFmt(h)}`;
    log.appendChild(s);
  });
  runeBody.appendChild(log);
}

// ---------- Triggers ----------
// Called every frame the player moves in the world (gameplay.js).
function updateRuneCircle() {
  const fb = feetBox(player.x, player.y);
  const fx = fb.x + fb.w / 2, fy = fb.y + fb.h / 2;
  const centre = (c, r) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });
  let on = null;
  const s = centre(RUNE_CIRCLE.stake.col, RUNE_CIRCLE.stake.row);
  // The stake is walked onto; runes are solid, so "at a rune" means touching it
  // from any side — about a tile from its centre.
  if (Math.hypot(fx - s.x, fy - s.y) < TILE * 0.6) on = 'stake';
  RUNE_CIRCLE.runes.forEach((r, i) => {
    const p = centre(r.col, r.row);
    if (Math.hypot(fx - p.x, fy - p.y) < TILE * 1.05) on = i;
  });
  if (on !== null && on !== rcWasOn) {
    if (on === 'stake') rcAtStake(); else rcAtRune(on);
  }
  rcWasOn = on;
}

function rcAtStake() {
  if (rcAlreadyDone()) {
    const saved = rcSaved();
    rcShowResults(rc.lastRun || (saved && saved.last), saved, {});
    return;
  }
  if (rc.phase === 'idle') { rcShowIntro(); return; }
  if (rc.phase === 'paused') { rcShowResume(); return; }
  if (rc.phase === 'average') { rcShowAverage(); return; }
  // Measuring: the tape is already hooked here, so walking over it says nothing.
}

function rcShowResume() {
  openRuneModal('Rune Circle');
  if (rc.readings.some(h => h !== null)) rcReadingsLog();
  rcText(`Your tape is unhooked. Hook it back on to carry on — next is <strong>${rcList(rcTargets())}</strong>.`);
  rcButton('Hook the tape on the stake', () => { rc.phase = 'measuring'; closeRuneModal(); });
  rcButton('Not now', closeRuneModal);
}

// The Unhook button over the map: stop measuring and put the tape away.
runeUnhookBtn.addEventListener('click', () => {
  runeUnhookBtn.blur(); // or the next Space/Enter press re-clicks it
  if (rc.phase !== 'measuring' || scene.modalOpen) return;
  openRuneModal('Unhook the tape?');
  rcText('Stop measuring for now? Your readings so far are kept. ' +
    'Come back to the stake in the Rune Circle to hook the tape on again and carry on.');
  rcButton('Unhook tape', () => { rc.phase = 'paused'; closeRuneModal(); });
  rcButton('Keep measuring', closeRuneModal);
});

function rcAtRune(i) {
  const n = RUNE_CIRCLE.runes[i].n;
  if (rcAlreadyDone()) return;
  if (rc.phase === 'idle' || rc.phase === 'paused') {
    openRuneModal(`Rune ${n}`);
    rcText(rc.phase === 'paused'
      ? 'Your tape is unhooked. Hook it back on at the <strong>stake in the middle of the circle</strong> to measure this rune.'
      : `An old standing stone, carved with a glowing <strong>${n}</strong>.<br>` +
        'To measure how far it is, start at the <strong>stake in the middle of the circle</strong>.');
    rcButton('OK', closeRuneModal);
    return;
  }
  if (rc.phase === 'average') { rcShowAverage(); return; }
  const targets = rcTargets();
  if (targets.includes(i)) { rcShowPullPrompt(i); return; }
  openRuneModal(`Rune ${n}`);
  if (rc.readings[i] !== null && !rc.redo.has(i)) {
    rcText(`You've already measured Rune ${n}. Next: <strong>${rcList(targets)}</strong> — look for the glowing rune.`);
  } else {
    rcText(`Measure <strong>${rcList(targets)}</strong> first — look for the rune glowing blue.`);
  }
  rcButton('OK', closeRuneModal);
}

// ---------- Screens ----------
function rcShowIntro() {
  const replay = rc.paidGold || !!(rcSaved() && rcSaved().done);
  openRuneModal(replay ? 'Rune Circle — measure again' : 'Rune Circle');
  rcText('Three rune stones stand around this stake. How far away is each one?' +
    '<br><br>1. Hook your metre tape on the stake.' +
    '<br>2. Walk to <strong>Rune 1</strong>, then <strong>Rune 2</strong>, then <strong>Rune 3</strong>. ' +
    'At each one, pull the tape tight and read the distance <strong>to the nearest hundredth of a metre</strong> (a whole centimetre).' +
    '<br>3. After Rune 3, work out the <strong>average</strong> of the three, rounded to the nearest hundredth.' +
    `<br><br>${RC_POINTS_EACH} points for each reading and ${RC_POINTS_EACH} for the average, if right the first time — ` +
    `${RC_GOAL} points.` + (replay
      ? ' Your best score counts. (The gold was for your first finish.)'
      : ` Finish to earn 🪙 ${RC_GOLD}.`));
  rcButton('Hook the tape on the stake', () => {
    rcResetRun();
    rc.phase = 'measuring';
    rc.startTime = Date.now();
    closeRuneModal();
  });
  rcButton('Not now', closeRuneModal);
}

function rcShowPullPrompt(i) {
  const n = RUNE_CIRCLE.runes[i].n;
  openRuneModal(`Rune ${n}`);
  rcText(rc.redo.has(i)
    ? `Your reading for Rune ${n} wasn't right. Pull the tape tight and read it again.`
    : `You've walked the tape out to Rune ${n}.`);
  rcButton(`Pull tape tight to Rune ${n}`, () => rcShowTape(i));
  rcButton('Not now', closeRuneModal);
}

function rcShowTape(i) {
  const rune = RUNE_CIRCLE.runes[i];
  openRuneModal(`Rune ${rune.n} — read the tape`);
  rcText(`Read the tape where it reaches Rune ${rune.n}, <strong>to the nearest hundredth of a metre</strong>.`);
  // The tape has to be in a visible container before it is built: buildRulerDOM sizes
  // a metre to the viewport it can see, and scrolls to the bar's end.
  const holder = document.createElement('div');
  runeBody.appendChild(holder);
  MeasureShared.buildRulerDOM(holder, rune.hundredths * 10, {
    cssPrefix: 'rc-',
    scale: 'm',
    badge: 'm',
    tapeHeight: '180px',
    scaleLabel: 'Scale: small ticks = cm · numbered ticks = 10 cm · red ticks = each meter',
  });
  const row = document.createElement('div');
  row.className = 'rc-row';
  const lbl = document.createElement('label');
  lbl.textContent = `Rune ${rune.n} (m):`;
  const inp = document.createElement('input');
  inp.className = 'rc-input'; inp.type = 'text'; inp.inputMode = 'decimal'; inp.placeholder = '0.00';
  const go = document.createElement('button');
  go.textContent = 'Record reading';
  row.append(lbl, inp, go);
  runeBody.appendChild(row);
  const submit = () => {
    const p = BenchMath.parseHundredths(inp.value);
    if (!p.ok) {
      BenchMath.nudge(inp, p.reason === 'tooManyDecimals'
        ? 'The tape reads to whole centimetres — two decimal places.' : 'Type a number, like 0.00');
      return;
    }
    rcRecord(i, p.hundredths);
  };
  go.addEventListener('click', submit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  rcButton('Not now', closeRuneModal);
  setTimeout(() => inp.focus(), 80);
}

function rcRecord(i, h) {
  const n = RUNE_CIRCLE.runes[i].n;
  const right = h === RUNE_CIRCLE.runes[i].hundredths;
  if (rc.firstTry[i] === null) { rc.firstTry[i] = right; rc.firstReading[i] = h; }
  const wasRedo = rc.redo.has(i);
  rc.readings[i] = h;

  if (wasRedo) {
    if (!right) {
      openRuneModal(`Rune ${n}`);
      rcText(`Rune ${n} still isn't right. Pull the tape again and read it carefully — ` +
        'find the last red metre mark before the end of the bar, then count on.', 'rc-msg-bad');
      rcButton(`Pull tape tight to Rune ${n} again`, () => rcShowTape(i));
      rcButton('Not now', closeRuneModal);
      return;
    }
    rc.redo.delete(i);
    if (rc.redo.size) {
      openRuneModal(`Rune ${n}`);
      rcText(`Rune ${n} is right now.`, 'rc-msg-good');
      rcText(`Still to measure again: <strong>${rcList(rcTargets())}</strong>.`);
      rcButton('OK', closeRuneModal);
      return;
    }
    rc.phase = 'average';
    rcShowAverage(`Rune ${n} is right now — all three readings are correct.`);
    return;
  }

  const next = rc.readings.findIndex(r => r === null);
  if (next !== -1) {
    openRuneModal(`Rune ${n}`);
    rcText(`Rune ${n}: <strong>${rcFmt(h)}</strong> recorded.`);
    rcText(`Now walk the tape out to <strong>Rune ${RUNE_CIRCLE.runes[next].n}</strong>.`);
    rcButton('OK', closeRuneModal);
    return;
  }

  // Third reading in: check them all, name any wrong ones, never say the right value.
  const wrong = RUNE_CIRCLE.runes.map((r, k) => k).filter(k => rc.readings[k] !== RUNE_CIRCLE.runes[k].hundredths);
  if (!wrong.length) {
    rc.phase = 'average';
    rcShowAverage('All three readings are correct.');
    return;
  }
  wrong.forEach(k => rc.redo.add(k));
  openRuneModal('Check your readings');
  rcReadingsLog();
  rcText(wrong.length === 1
    ? `Your reading for <strong>${rcList(wrong)}</strong> isn't right.`
    : `Your readings for <strong>${rcList(wrong)}</strong> aren't right.`, 'rc-msg-bad');
  rcText('Walk back and measure ' + (wrong.length === 1 ? 'it' : 'them') +
    ' again — the tape is still hooked on the stake.');
  // Standing at a rune that needs redoing already? Don't make them step away and back.
  if (rc.redo.has(i)) rcButton(`Pull tape tight to Rune ${n} again`, () => rcShowTape(i));
  rcButton('OK', closeRuneModal);
}

function rcShowAverage(lead) {
  openRuneModal('Average distance');
  if (lead) rcText(lead, 'rc-msg-good');
  rcReadingsLog();
  rcText('Work out the <strong>average</strong> of your three readings, rounded to the nearest hundredth of a metre.');
  const row = document.createElement('div');
  row.className = 'rc-row';
  const lbl = document.createElement('label');
  lbl.textContent = 'Average (m):';
  const inp = document.createElement('input');
  inp.className = 'rc-input'; inp.type = 'text'; inp.inputMode = 'decimal'; inp.placeholder = '0.00';
  const go = document.createElement('button');
  go.textContent = 'Submit average';
  row.append(lbl, inp, go);
  runeBody.appendChild(row);
  const msg = rcText('');
  const submit = () => {
    const p = BenchMath.parseHundredths(inp.value);
    if (!p.ok) {
      BenchMath.nudge(inp, p.reason === 'tooManyDecimals' ? BenchMath.TOO_MANY_DECIMALS : 'Type a number, like 0.00');
      return;
    }
    const sum = RUNE_CIRCLE.runes.reduce((a, r) => a + r.hundredths, 0);
    const right = p.hundredths === BenchMath.hundredthsFromFraction(sum, 100 * RUNE_CIRCLE.runes.length);
    if (rc.avgFirstTry === null) { rc.avgFirstTry = right; rc.firstAverage = p.hundredths; }
    if (!right) {
      msg.className = 'wb-modal-body rc-msg-bad';
      msg.textContent = "That average isn't right. Add the three readings, divide by 3, and round to the nearest hundredth.";
      inp.select();
      return;
    }
    rcComplete();
  };
  go.addEventListener('click', submit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  rcButton('Not now', closeRuneModal);
  rcText('You can hand the average in later at the stake.', '');
  setTimeout(() => inp.focus(), 80);
}

function rcComplete() {
  rc.phase = 'done';
  const readingPts = rc.firstTry.filter(Boolean).length * RC_POINTS_EACH;
  const avgPts = rc.avgFirstTry ? RC_POINTS_EACH : 0;
  rc.score = readingPts + avgPts;
  const timeSec = Math.round((Date.now() - rc.startTime) / 1000);
  const counts = !session.demo && !session.teacher && !!session.nameKey;
  const prev = counts ? rcSaved() : null;
  const prevAttempts = prev ? (prev.attempts || (prev.done ? 1 : 0)) : (rc.lastRun ? rc.lastRun.attempt : 0);

  // What the results screen shows, and what the teacher can pull up later.
  // Values are integer hundredths.
  const run = {
    attempt: prevAttempts + 1,
    readings: rc.firstReading.slice(),       // first entry at each rune
    readingsOK: rc.firstTry.map(Boolean),
    finalReadings: rc.readings.slice(),      // after any re-measuring (all right)
    average: rc.firstAverage,
    averageOK: !!rc.avgFirstTry,
    score: rc.score,
    ts: Date.now(),
  };
  rc.lastRun = run;

  // 100 gold for the first finish only; replays are for the score.
  const firstFinish = counts ? !(prev && prev.done) : !rc.paidGold;
  if (firstFinish) { bankToRecord({ coins: RC_GOLD }); rc.paidGold = true; }

  let saved = null;
  if (counts) {
    saved = {
      done: true,
      score: Math.max(rc.score, prev && prev.done ? (prev.score || 0) : 0),   // best
      firstScore: prev && prev.done ? (prev.firstScore != null ? prev.firstScore : prev.score) : rc.score,
      attempts: run.attempt,
      ts: run.ts,
      last: run,
    };
    session.record.runeCircle = saved;
    Shared.updateStudent(session.nameKey, { runeCircle: saved });
    if (Shared.DB_OK) {
      Shared.DB.ref(RC_DB_PATH).push({
        name: session.name, nameKey: session.nameKey, period: String(session.period),
        score: rc.score, timeSec, ts: run.ts, attempt: run.attempt,
        readingsFirstTry: run.readingsOK, averageFirstTry: run.averageOK,
      }).catch(e => console.warn('Rune Circle score save failed', e));
    }
  }
  paintHud();
  rcShowResults(run, saved, { complete: true, paid: firstFinish });
}

// The teacher-check screen: every first reading and the first average, right or
// wrong, with what they corrected it to. Shown at the end of each run and again
// whenever the student walks back onto the stake.
function rcShowResults(run, saved, opts) {
  openRuneModal(opts.complete ? 'Rune Circle complete!' : 'Rune Circle — results');
  if (!run) {
    // Finished before results were recorded (the first version kept only a score).
    rcText(`You've measured the Rune Circle. Best score: <strong>${saved ? saved.score : 0} of ${RC_GOAL} points</strong>.`);
  } else {
    const who = session.demo ? 'Demo' : session.name;
    const when = new Date(run.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    rcText(`<strong>${who}</strong> · attempt ${run.attempt} · ${when}`);
    const mark = ok => ok ? '<span class="rc-ok">✓ right</span>' : '<span class="rc-bad">✗ wrong</span>';
    let rows = '';
    RUNE_CIRCLE.runes.forEach((r, i) => {
      const first = run.readings[i], fin = run.finalReadings ? run.finalReadings[i] : null;
      rows += `<tr><td>Rune ${r.n}</td><td>${first != null ? rcFmt(first) : '—'}</td><td>${mark(run.readingsOK[i])}</td>` +
        `<td>${!run.readingsOK[i] && fin != null ? 'fixed to ' + rcFmt(fin) : ''}</td></tr>`;
    });
    const sum = RUNE_CIRCLE.runes.reduce((a, r) => a + r.hundredths, 0);
    const avgRight = BenchMath.hundredthsFromFraction(sum, 100 * RUNE_CIRCLE.runes.length);
    rows += `<tr class="rc-avg"><td>Average</td><td>${run.average != null ? rcFmt(run.average) : '—'}</td><td>${mark(run.averageOK)}</td>` +
      `<td>${!run.averageOK ? 'fixed to ' + rcFmt(avgRight) : ''}</td></tr>`;
    const table = document.createElement('table');
    table.className = 'rc-table';
    table.innerHTML = '<tr><th></th><th>First answer</th><th></th><th></th></tr>' + rows;
    runeBody.appendChild(table);
    rcText(`<strong>Score: ${run.score} of ${RC_GOAL} points</strong> — 10 for each answer right the first time.`);
  }
  if (saved && saved.attempts > 1) {
    rcText(`Best score: <strong>${saved.score} of ${RC_GOAL}</strong> · first attempt: ${saved.firstScore} of ${RC_GOAL} · ${saved.attempts} attempts`);
  }
  if (opts.paid) rcText(`You earned 🪙 ${RC_GOLD}!`, 'rc-msg-good');
  rcButton('Measure the circle again', () => { rc.phase = 'idle'; rcResetRun(); rcShowIntro(); });
  rcButton('Close', closeRuneModal);
}

// ---------- Drawing (called from drawWorld, under NPCs and the player) ----------
function drawRuneCircle() {
  runeUnhookBtn.classList.toggle('hidden', rc.phase !== 'measuring');
  const ctx = mapCtx;
  const toScreen = (c, r) => ({ x: c * TILE + TILE / 2 - camera.x, y: r * TILE + TILE / 2 - camera.y });
  const st = toScreen(RUNE_CIRCLE.stake.col, RUNE_CIRCLE.stake.row);
  if (st.x < -12 * TILE || st.x > mapCanvas.width + 12 * TILE || st.y < -8 * TILE || st.y > mapCanvas.height + 8 * TILE) return;
  const done = rcAlreadyDone();
  const targets = rc.phase === 'measuring' ? rcTargets() : [];
  const pulse = 0.55 + 0.45 * Math.sin(Date.now() / 300);

  // Tape lines: one to every rune with a reading, and one to the player while measuring.
  ctx.save();
  ctx.lineCap = 'round';
  if (!done) {
    rc.readings.forEach((h, i) => {
      if (h === null || rc.redo.has(i)) return;
      const p = toScreen(RUNE_CIRCLE.runes[i].col, RUNE_CIRCLE.runes[i].row);
      ctx.strokeStyle = 'rgba(246,201,14,0.55)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(st.x, st.y - 18); ctx.lineTo(p.x, p.y - 4); ctx.stroke();
    });
  }
  if (rc.phase === 'measuring') {
    // To the character's waist as drawn -- the art sits in the middle of its frame,
    // so feetBox (collision) is ~25px below the feet you can see.
    const size = FRAME * SCALE;
    ctx.strokeStyle = '#f6c90e'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(st.x, st.y - 18);
    ctx.lineTo(player.x + size / 2 - camera.x, player.y + size * 0.5 - camera.y); ctx.stroke();
  }
  ctx.restore();

  // The stake: a worn ring on the grass and a wooden post with a brass hook.
  ctx.save();
  ctx.fillStyle = 'rgba(60,45,25,0.35)';
  ctx.beginPath(); ctx.ellipse(st.x, st.y + 10, 20, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7a5230'; ctx.strokeStyle = '#3d2b1f'; ctx.lineWidth = 2;
  ctx.fillRect(st.x - 4, st.y - 18, 8, 28); ctx.strokeRect(st.x - 4, st.y - 18, 8, 28);
  ctx.fillStyle = '#e0b040';
  ctx.beginPath(); ctx.arc(st.x, st.y - 18, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Rune stones.
  RUNE_CIRCLE.runes.forEach((r, i) => {
    const p = toScreen(r.col, r.row);
    const baseY = p.y + TILE / 2 - 4;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(p.x, baseY, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8a8f98'; ctx.strokeStyle = '#3b3f46'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - 13, baseY);
    ctx.lineTo(p.x - 11, baseY - 34);
    ctx.quadraticCurveTo(p.x, baseY - 46, p.x + 11, baseY - 34);
    ctx.lineTo(p.x + 13, baseY);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    let glyph = '#4a4f58', glow = 0;
    if (done) glyph = '#6fd3a8';
    else if (targets.includes(i)) { glyph = '#7df9ff'; glow = 14 * pulse; }
    else if (rc.readings[i] !== null) glyph = '#f6c90e';
    else if (rc.phase === 'idle') { glyph = '#7df9ff'; glow = 4; }
    ctx.shadowColor = glyph; ctx.shadowBlur = glow;
    ctx.fillStyle = glyph;
    ctx.font = 'bold 20px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(r.n), p.x, baseY - 22);
    ctx.restore();
  });

  // Labels last so the stones don't cover them.
  ctx.save();
  ctx.font = 'bold 12px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;
  const label = (t, x, y) => {
    ctx.strokeStyle = 'rgba(10,14,20,0.85)'; ctx.strokeText(t, x, y);
    ctx.fillStyle = '#f4f7fa'; ctx.fillText(t, x, y);
  };
  label(done ? 'Rune Circle ✓' : 'Rune Circle', st.x, st.y - 28);
  RUNE_CIRCLE.runes.forEach(r => {
    const p = toScreen(r.col, r.row);
    label('Rune ' + r.n, p.x, p.y + TILE / 2 - 54);
  });
  ctx.restore();
}
