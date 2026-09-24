/* ================================================================
   fix-loop.js — "go back and fix it" for anything that measures a set of
   things and then averages them.

   Nick's rules (2026-09-24), the same in every game that uses this:
     • Readings are checked together once they're all in. A wrong one is
       NAMED but its value is not shown — the student measures it again.
     • The average is only asked for once every reading is right.
     • After two failed fixes of the same reading (or of the average) the
       right value is SHOWN, so nobody sits stuck at one tape all lesson,
       and the results mark it "shown" for the teacher.
     • Points are for first tries only. Fixing is for learning.

   The tracker holds that state; each game draws its own screens around it
   (the workshop re-shows the tool in place, the Rune Circle makes the
   student walk back to the rune). renderSummary draws the one results table
   they all share.

   All values are integer hundredths of the unit, as BenchMath uses.

   Consumed by: measure-average-bench.html, rune-circle.js
   ================================================================ */

// eslint-disable-next-line no-unused-vars
const FixLoop = (function () {
  'use strict';

  const MAX_FIXES = 2;

  // correct: the right value for each reading, integer hundredths.
  function create(correct) {
    const n = correct.length;
    const items = correct.map(c => ({
      correct: c, first: null, firstOK: null, final: null,
      status: null,   // 'right' (first try) | 'fixed' | 'shown' | null while open
      fixes: 0,       // failed fixes so far
    }));
    // The right average of the right readings, half-up to the hundredth.
    const avgCorrect = BenchMath.hundredthsFromFraction(correct.reduce((a, c) => a + c, 0), 100 * n);
    const avg = { correct: avgCorrect, first: null, firstOK: null, final: null, status: null, fixes: 0 };

    // First pass: record without judging (the student isn't told yet).
    function recordFirst(i, h) {
      const it = items[i];
      if (it.first !== null) return;
      it.first = h; it.final = h;
      it.firstOK = h === it.correct;
      if (it.firstOK) it.status = 'right';
    }
    function allRecorded() { return items.every(it => it.first !== null); }
    // Readings still to be fixed, in order.
    function pending() { return items.map((it, i) => i).filter(i => items[i].first !== null && items[i].status === null); }

    // A re-measure. Returns 'fixed', 'wrong' (try again) or 'shown'.
    function recordFix(i, h) {
      const it = items[i];
      it.final = h;
      if (h === it.correct) { it.status = 'fixed'; return 'fixed'; }
      it.fixes++;
      if (it.fixes >= MAX_FIXES) { it.status = 'shown'; it.final = it.correct; return 'shown'; }
      return 'wrong';
    }
    function triesLeft(i) { return MAX_FIXES - items[i].fixes; }

    // Every answer to the average goes through here. Returns 'right' (first
    // try), 'fixed', 'wrong' (try again) or 'shown'.
    function recordAverage(h) {
      if (avg.first === null) {
        avg.first = h; avg.final = h; avg.firstOK = h === avg.correct;
        if (avg.firstOK) { avg.status = 'right'; return 'right'; }
        return 'wrong';
      }
      avg.final = h;
      if (h === avg.correct) { avg.status = 'fixed'; return 'fixed'; }
      avg.fixes++;
      if (avg.fixes >= MAX_FIXES) { avg.status = 'shown'; avg.final = avg.correct; return 'shown'; }
      return 'wrong';
    }
    function avgTriesLeft() { return MAX_FIXES - avg.fixes; }

    function firstTryCount() { return items.filter(it => it.firstOK).length; }
    function allFirstTry() { return items.every(it => it.firstOK) && avg.firstOK === true; }
    function done() { return items.every(it => it.status !== null) && avg.status !== null; }

    // A plain copy for saving (Firebase-safe: no nulls inside arrays once done).
    function snapshot() {
      return {
        readings: items.map(it => it.first), readingsOK: items.map(it => !!it.firstOK),
        readingsStatus: items.map(it => it.status || ''), finalReadings: items.map(it => it.final),
        average: avg.first, averageOK: !!avg.firstOK, averageStatus: avg.status || '',
      };
    }

    return {
      items, avg, MAX_FIXES,
      recordFirst, allRecorded, pending, recordFix, triesLeft,
      recordAverage, avgTriesLeft, firstTryCount, allFirstTry, done, snapshot,
    };
  }

  // "2 more tries" / "1 more try" before the value is shown.
  function triesText(left) {
    return left === 1 ? '1 more try before the answer is shown' : left + ' more tries before the answer is shown';
  }

  // The results table: first answer, right/wrong, and what happened after.
  //   snap    – tracker.snapshot() (or a saved copy of one)
  //   opts.labels   – row names, e.g. ['Rune 1', 'Rune 2', …]
  //   opts.fmt      – hundredths -> display string, e.g. h => fmt2(h) + ' m'
  //   opts.fmtAvg   – same for the average row, if it reads to a different
  //                   precision (a whole-mm caliper still averages to hundredths)
  //   opts.avgCorrect – the right average, for "shown"/"fixed to" on that row
  //   opts.correct  – right value per reading (for rows marked shown)
  //   opts.cls      – class for the <table>
  function renderSummary(container, snap, opts) {
    const fmt = opts.fmt, fmtAvg = opts.fmtAvg || opts.fmt;
    const mark = ok => ok ? '<span class="fl-ok">✓ right</span>' : '<span class="fl-bad">✗ wrong</span>';
    const after = (ok, status, final, correct, fmt) => {
      if (ok) return '';
      if (status === 'shown') return 'answer shown: ' + fmt(correct);
      if (status === 'fixed') return 'fixed to ' + fmt(final);
      // Saved before statuses were recorded: every wrong one was fixed.
      return final != null ? 'fixed to ' + fmt(final) : '';
    };
    let rows = '<tr><th></th><th>First answer</th><th></th><th></th></tr>';
    opts.labels.forEach((label, i) => {
      const status = snap.readingsStatus ? snap.readingsStatus[i] : '';
      const correct = opts.correct ? opts.correct[i] : (snap.finalReadings ? snap.finalReadings[i] : null);
      rows += `<tr><td>${label}</td><td class="fl-num">${snap.readings[i] != null ? fmt(snap.readings[i]) : '—'}</td>` +
        `<td>${mark(snap.readingsOK[i])}</td>` +
        `<td class="fl-after">${after(snap.readingsOK[i], status, snap.finalReadings ? snap.finalReadings[i] : null, correct, fmt)}</td></tr>`;
    });
    rows += `<tr class="fl-avg"><td>Average</td><td class="fl-num">${snap.average != null ? fmtAvg(snap.average) : '—'}</td>` +
      `<td>${mark(snap.averageOK)}</td>` +
      `<td class="fl-after">${after(snap.averageOK, snap.averageStatus || 'fixed', opts.avgCorrect, opts.avgCorrect, fmtAvg)}</td></tr>`;
    const table = document.createElement('table');
    table.className = opts.cls || 'fl-table';
    table.innerHTML = rows;
    container.appendChild(table);
    return table;
  }

  return { create, renderSummary, triesText, MAX_FIXES };
})();
