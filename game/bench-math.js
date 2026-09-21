/* ================================================================
   bench-math.js — exact grading arithmetic for the workbenches.

   Every bench that grades an answer "to the nearest hundredth" used to do
   `Math.round(x * 100) / 100` on a float and compare with
   `Math.abs(a - b) <= 0.01`. Both are wrong in ways that cost students marks:

     • Math.round(x*100)/100 disagrees with the half-up rule taught in class
       for 5.7% of values whose third decimal is 5, because x*100 lands just
       below the .5 boundary. The bench showed 0.565, the student correctly
       answered 0.57, and the bench insisted the answer was 0.56 — and since
       the displayed "correct answer" came from the same expression, both
       agreed with each other and the fault was invisible on screen.

     • Math.abs(a - b) <= 0.01 is asymmetric in binary: |3.48-3.47| is
       0.00999999999999979 (passes) but |3.46-3.47| is 0.0100000000000002
       (fails). It accepted the NEIGHBOURING hundredth in 54% of cases, and
       accepted an unrounded three-decimal answer every time — on benches
       whose whole task is to round.

   So: never scale a float to grade it. Every caller has an exact integer
   source available (a displayed decimal string, or a sum of tenths /
   hundredths / thousandths), and everything here works in integers.

   Consumed by: rounding-bench.html, average-bench.html,
   measure-average-bench.html, elapsed-time-bench.html
   ================================================================ */

// eslint-disable-next-line no-unused-vars
const BenchMath = (function () {
  'use strict';

  // ── Round n/d to hundredths, half-up, in integers ──────────────
  // round_half_up(x) is floor(x + 1/2); with x = 100n/d that is
  // floor((200n + d) / 2d), which never leaves the integers.
  //
  //   hundredthsFromFraction(361, 40)  ->  903   (36.1 / 4 = 9.025 -> 9.03)
  //
  // Callers pass the sum in its own smallest unit and d = scale * count:
  // four values in tenths summing to 361 tenths is n=361, d=10*4.
  function hundredthsFromFraction(n, d) {
    if (!Number.isInteger(n) || !Number.isInteger(d) || d <= 0) {
      throw new Error('hundredthsFromFraction: needs integer n and integer d > 0');
    }
    if (n < 0) return -Math.floor((-200 * n + d) / (2 * d));
    return Math.floor((200 * n + d) / (2 * d));
  }

  // ── Round a decimal STRING to hundredths, half-up ──────────────
  // For a value the student is reading off the screen, the string they can
  // see is the source of truth — not the float it was formatted from.
  //
  // Only the thousandths digit is consulted, which is exactly the school
  // rule and exactly right: if it is 4 or less the remainder is below a
  // half-hundredth however many digits follow, and if it is 5 or more the
  // remainder is at least a half-hundredth.
  //
  //   hundredthsFromString('0.565') -> 57      hundredthsFromString('12.345') -> 1235
  function hundredthsFromString(str) {
    const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(String(str).trim());
    if (!m) return null;
    const neg = m[1] === '-';
    const dec = (m[3] || '') + '000';
    const whole = parseInt(m[2], 10) * 100 + parseInt(dec.slice(0, 2), 10);
    const h = whole + (dec.charCodeAt(2) >= 53 ? 1 : 0); // '5' is 53
    return neg ? -h : h;
  }

  // ── A student's typed answer, as integer hundredths ────────────
  // Returns { ok, hundredths } or { ok:false, reason }.
  //
  // More than two decimal places is refused rather than graded: on every
  // bench that calls this, rounding to hundredths IS the task, so "1.234"
  // is not a near-miss to be scored, it is an answer that has not been
  // rounded yet. Callers show `reason` and let the student try again
  // without spending an attempt.
  function parseHundredths(raw) {
    const s = String(raw).trim();
    if (s === '') return { ok: false, reason: 'empty' };
    if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, reason: 'notANumber' };
    const dot = s.indexOf('.');
    if (dot !== -1 && s.length - dot - 1 > 2) {
      return { ok: false, reason: 'tooManyDecimals' };
    }
    const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(s);
    const dec = ((m[3] || '') + '00').slice(0, 2);
    const h = parseInt(m[2], 10) * 100 + parseInt(dec, 10);
    return { ok: true, hundredths: m[1] === '-' ? -h : h };
  }

  // ── Display ───────────────────────────────────────────────────
  // fmt2(903) -> '9.03'.  Built by string surgery so it can never reintroduce
  // the float error this file exists to remove.
  function fmt2(hundredths) {
    const neg = hundredths < 0;
    const h = Math.abs(hundredths);
    return (neg ? '-' : '') + Math.floor(h / 100) + '.' + String(h % 100).padStart(2, '0');
  }

  // ── "You haven't rounded yet" nudge ───────────────────────────
  // Shown next to the input instead of grading the answer, so it costs the
  // student nothing. Deliberately not the feedback panel: that belongs to
  // answer-review.js and showing a review there would look like a verdict.
  function nudge(inputEl, msg) {
    if (!inputEl) return;
    inputEl.style.borderColor = '#c1443a';
    setTimeout(function () { inputEl.style.borderColor = ''; }, 1600);
    const row = inputEl.parentElement;
    if (!row) return;
    let tip = row.querySelector('.bench-nudge');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'bench-nudge';
      tip.style.cssText = 'flex-basis:100%;width:100%;text-align:center;font-size:0.85rem;'
        + 'font-weight:700;color:#c1443a;margin-top:6px;';
      row.appendChild(tip);
    }
    tip.textContent = msg;
    clearTimeout(tip._clear);
    tip._clear = setTimeout(function () { tip.textContent = ''; }, 2600);
  }

  // The message every bench shows for an answer that has not been rounded.
  const TOO_MANY_DECIMALS = 'Round your answer to two decimal places.';

  return {
    nudge,
    hundredthsFromFraction,
    hundredthsFromString,
    parseHundredths,
    fmt2,
    TOO_MANY_DECIMALS,
  };
})();
