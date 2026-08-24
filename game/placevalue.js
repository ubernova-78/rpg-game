// placevalue.js — the ONE place-value engine: money art, digit generation, and the Read
// It / Build It / Place the Point round-rendering logic. Both the battle system
// (quests.js's QUESTION_MODULES re-exports these) and the standalone Workbench game
// (place-value-bench.html) call into THIS file for all three — a bug fixed here is fixed
// everywhere, instead of needing to be found and fixed twice (which is exactly what
// happened with the Place the Point decimal-position bug before this file existed).
//
// Pull It Out (drag-and-drop supply tiles) stays implemented only in
// place-value-bench.html — it's a different interaction paradigm (pointer-drag, a "ghost"
// cursor, a small() art variant) that battle has never used, so sharing it here wouldn't
// eliminate any real duplication, just add scope.

function pvBill(v, w) {
  const h = Math.round(w * 0.44);
  return `<svg width="${w}" height="${h}" viewBox="0 0 100 44" aria-hidden="true">
    <rect x="1" y="1" width="98" height="42" rx="2" fill="#2f5c46" stroke="#1c3b2c" stroke-width="1.5"/>
    <rect x="6" y="6" width="88" height="32" rx="1" fill="none" stroke="#79a68d" stroke-width="1"/>
    <circle cx="50" cy="22" r="12" fill="#3d7358" stroke="#79a68d" stroke-width="1"/>
    <text x="50" y="22" font-family="monospace" font-size="13" font-weight="700"
      dominant-baseline="central" text-anchor="middle" style="fill:#dbeae1">${v}</text>
    <text x="12" y="14" font-family="monospace" font-size="8" style="fill:#a8c9b6">${v}</text>
    <text x="88" y="36" font-family="monospace" font-size="8" text-anchor="end" style="fill:#a8c9b6">${v}</text>
  </svg>`;
}
function pvCoin(kind, d) {
  if (kind === 'dime') return `<svg width="${d}" height="${d}" viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="18.5" fill="#9aa6ab" stroke="#6c777c" stroke-width="1.6"/>
    <circle cx="20" cy="20" r="14" fill="none" stroke="#b8c2c6" stroke-width="1"/>
    <text x="20" y="17" font-family="monospace" font-size="11" font-weight="700"
      text-anchor="middle" style="fill:#3b4448">10</text>
    <text x="20" y="28" font-family="monospace" font-size="7"
      text-anchor="middle" style="fill:#3b4448">CENT</text></svg>`;
  return `<svg width="${d}" height="${d}" viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="18.5" fill="#b5723f" stroke="#7d4a25" stroke-width="1.6"/>
    <circle cx="20" cy="20" r="14" fill="none" stroke="#d49c70" stroke-width="1"/>
    <text x="20" y="17" font-family="monospace" font-size="11" font-weight="700"
      text-anchor="middle" style="fill:#4a2c14">1</text>
    <text x="20" y="28" font-family="monospace" font-size="7"
      text-anchor="middle" style="fill:#4a2c14">CENT</text></svg>`;
}
function pvMill(d) {
  return `<svg width="${d}" height="${d}" viewBox="0 0 40 40" aria-hidden="true">
    <path d="M20 20 L20 1.5 A18.5 18.5 0 0 1 30.87 5.03 Z" fill="#b5723f" stroke="#7d4a25" stroke-width="1.4"/>
    <circle cx="20" cy="20" r="18.5" fill="none" stroke="#4a5b62" stroke-width="1" stroke-dasharray="2 3"/>
    <text x="23.5" y="10" font-family="monospace" font-size="6" font-weight="700"
      text-anchor="middle" style="fill:#3a2110">1/10</text></svg>`;
}
const PV_PLACES = [
  { key: 'hundreds', label: 'Hundreds', art: () => pvBill(100, 64) },
  { key: 'tens', label: 'Tens', art: () => pvBill(10, 58) },
  { key: 'ones', label: 'Ones', art: () => pvBill(1, 52) },
  { key: 'tenths', label: 'Tenths', art: () => pvCoin('dime', 38) },
  { key: 'hundredths', label: 'Hundredths', art: () => pvCoin('penny', 39) },
  { key: 'thousandths', label: 'Thousandths', art: () => pvMill(39) },
];
const pvRnd = n => Math.floor(Math.random() * n);
// A pool of possible "active" place-value windows to draw from each round, so a problem
// sometimes has only bills, sometimes only coins, sometimes a genuine mix — and matches
// the natural shape of an actual number (e.g. $76.56 only needs tens through hundredths;
// it has no hundreds or thousandths digit to speak of, so nothing outside that range is
// asked about). Every window here is required to be "complete" on each side it touches:
// if it includes any whole-dollar place it must reach all the way through "ones", and if
// it includes any cents place it must start at "tenths" — a window that skipped one of
// those (e.g. hundreds+tens without ones, or hundredths+thousandths without tenths) would
// either silently drop a digit that's genuinely part of the number, or make the shown
// digits ambiguous about their own magnitude in Place the Point. Everything actually in
// the pool below already satisfies this; every place WITHIN a window is still a required
// answer (including any interior zero) — this only controls which places are in scope at
// all, not whether zeros inside that scope still have to be filled in.
const PV_ACTIVE_WINDOWS = [
  [0, 2], [1, 2],             // bills only
  [3, 4], [3, 5],             // coins only
  [2, 3], [1, 3], [2, 4],     // small mixes straddling the decimal
  [1, 5], [0, 5],             // larger mixes
];
// Shared by all three round types below — every problem always has exactly one guaranteed
// interior zero when the window is long enough to have one (never the leading digit, and
// never an all-zero pile), so every round gives practice reading/placing a missing place
// value as a zero, not just some rounds.
//
// `bound` (optional {lo,hi}) restricts which windows are eligible — this is what makes
// Place the Point's correct answer actually MOVE AROUND within a difficulty level instead
// of landing in the same spot every time (the exact bug this file's header describes):
// without a bound, a window is drawn from the whole pool (battle's behavior — no fixed
// difficulty tiers to respect); with one (the Workbench's chosen level), only windows
// that fit entirely inside it are eligible, so "warmup" stays easier than "full" but still
// varies within its own range instead of being frozen at one fixed window.
function generatePVDigits(bound) {
  let windows = PV_ACTIVE_WINDOWS;
  if (bound) {
    windows = PV_ACTIVE_WINDOWS.filter(([lo, hi]) => lo >= bound.lo && hi <= bound.hi);
    if (!windows.length) windows = [[bound.lo, bound.hi]]; // no pool window fits — fall back to the bound itself
  }
  const [lo, hi] = windows[pvRnd(windows.length)];
  const active = [];
  for (let i = lo; i <= hi; i++) active.push(i);
  const digits = [0, 0, 0, 0, 0, 0];
  active.forEach(i => { digits[i] = pvRnd(10); });
  const inner = active.slice(1, -1);
  if (inner.length) digits[inner[pvRnd(inner.length)]] = 0; // guarantee an interior zero, like the real game
  if (active.every(i => digits[i] === 0)) digits[active[0]] = pvRnd(9) + 1;
  return { active, digits };
}

// Generic styled button used by every round below (and by the gate/chest/shop/dojo flows
// elsewhere, which is why it's a plain global rather than something private to this file).
function gateButton(label, onClick) {
  const btn = document.createElement('button');
  btn.className = 'gate-btn';
  btn.textContent = label;
  btn.style.display = 'block';
  btn.style.width = '100%';
  btn.style.marginTop = '8px';
  btn.addEventListener('click', onClick);
  return btn;
}

// ============================================================
// QUESTION_MODULES — the shape every round type implements:
//   render(container, { onCorrect, onWrong, onHintReady, presetPile, bound }) — build
//   this round's UI into `container`, call onCorrect()/onWrong() when the player answers.
//   `presetPile` (optional {active,digits}) lets a caller force a specific problem instead
//   of generating a random one — used for PvP (both players must see the identical
//   question) and for tests. `bound` (optional {lo,hi}) is forwarded to generatePVDigits
//   when no presetPile is given — see the comment on generatePVDigits above.
//   `onHintReady` (optional) receives a function that reveals one still-blank *required*
//   box and returns true, or returns false if nothing's left to reveal — used by the
//   battle system's hint potion.
// ============================================================
const QUESTION_MODULES = {
  'place-value-read': {
    name: 'Place Value — Read It',
    render(container, { onCorrect, onWrong, onHintReady, presetPile, bound }) {
      const pile = presetPile || generatePVDigits(bound);
      // Always show all 6 boxes — showing only the places that matter for THIS number
      // told the student the answer's shape before they even started (2 boxes = must be
      // a 2-digit bills-only problem). Every box is still real and labeled; the student
      // has to work out for themselves which ones matter. A box outside the number's
      // actual scope (pile.active) accepts either "0" or being left blank as correct —
      // a box genuinely inside the scope (including an interior zero) still needs the
      // real digit typed in; blank isn't accepted there.
      const ALL_PLACES = [0, 1, 2, 3, 4, 5];
      container.innerHTML = '';

      const prompt = document.createElement('div');
      prompt.className = 'wb-modal-body';
      prompt.textContent = 'Count what\u2019s on the bench. Type a digit into each place that needs one \u2014 leave the rest blank.';
      container.appendChild(prompt);

      const tray = document.createElement('div');
      tray.className = 'pv-tray';
      pile.active.forEach(i => {
        const n = pile.digits[i];
        if (n === 0) return;
        const row = document.createElement('div');
        row.className = 'pv-denom-row';
        for (let k = 0; k < n; k++) {
          const span = document.createElement('span');
          span.innerHTML = PV_PLACES[i].art();
          row.appendChild(span);
        }
        tray.appendChild(row);
      });
      if (!tray.children.length) {
        tray.innerHTML = '<div style="text-align:center;color:#6b7d85;font-size:12px;padding:10px;">The bench is empty. That\u2019s still a number.</div>';
      }
      container.appendChild(tray);

      const scale = document.createElement('div');
      scale.className = 'pv-scale';
      const boxes = {};
      ALL_PLACES.forEach(i => {
        if (i === 3) {
          const pt = document.createElement('div');
          pt.className = 'pv-point';
          pt.textContent = '.';
          scale.appendChild(pt);
        }
        const col = document.createElement('div');
        col.className = 'pv-col';
        const label = document.createElement('div');
        label.className = 'pv-label';
        label.innerHTML = PV_PLACES[i].label.replace('Thousandths', 'Thou-<br>sandths').replace('Hundredths', 'Hun-<br>dredths');
        const box = document.createElement('input');
        box.type = 'text'; box.inputMode = 'numeric'; box.maxLength = 1;
        box.className = 'pv-box';
        col.appendChild(box);
        col.appendChild(label);
        scale.appendChild(col);
        boxes[i] = box;
        box.addEventListener('input', () => {
          box.value = box.value.replace(/[^0-9]/g, '').slice(0, 1);
          if (box.value) {
            const next = ALL_PLACES[ALL_PLACES.indexOf(i) + 1];
            if (next !== undefined) boxes[next] && boxes[next].focus();
          }
        });
      });
      container.appendChild(scale);

      if (onHintReady) {
        onHintReady(() => {
          const empty = pile.active.filter(i => boxes[i] && boxes[i].value === '');
          if (!empty.length) return false;
          const i = empty[Math.floor(Math.random() * empty.length)];
          boxes[i].value = String(pile.digits[i]);
          return true;
        });
      }

      const checkBtn = gateButton('Check it', () => {
        // Explicit guard, not just checkBtn.disabled — some environments still dispatch
        // click listeners on a disabled button (confirmed in the test harness), so the
        // .disabled flag alone isn't reliable protection against a rapid or synthetic
        // re-click landing here a second time.
        if (checkBtn.disabled) return;
        const allFilled = pile.active.every(i => boxes[i].value !== '');
        if (!allFilled) {
          prompt.textContent = 'Fill in every place this number actually needs first \u2014 a zero counts as an answer.';
          return;
        }
        // Disable immediately, before running onCorrect/onWrong — a caller that keeps this
        // question's UI visible after answering it (like the Workbench, so the student can
        // see what they got right) would otherwise leave this same button clickable
        // forever, letting the same correct answer be re-submitted for points/damage
        // indefinitely. Wrong answers re-enable it right away so retrying still works.
        checkBtn.disabled = true;
        const correct = ALL_PLACES.every(i => {
          const v = boxes[i].value;
          if (pile.active.includes(i)) return +v === pile.digits[i];
          return v === '' || +v === 0; // outside the number's scope — blank or 0 both count
        });
        if (correct) onCorrect(); else { checkBtn.disabled = false; onWrong(); }
      });
      container.appendChild(checkBtn);

      const first = boxes[ALL_PLACES[0]];
      if (first) setTimeout(() => first.focus(), 30);
    },
  },

  'place-value-build': {
    name: 'Place Value — Build It',
    render(container, { onCorrect, onWrong, presetPile, bound }) {
      const pile = presetPile || generatePVDigits(bound);
      // Same "always all 6, no special handling needed for the extras" reasoning as Read
      // It — except here it's even simpler: a stepper's own default (0, untouched) IS the
      // correct answer for an out-of-scope place, so there's nothing extra to check.
      const ALL_PLACES = [0, 1, 2, 3, 4, 5];
      container.innerHTML = '';
      const counts = {};
      ALL_PLACES.forEach(i => { counts[i] = 0; });

      const prompt = document.createElement('div');
      prompt.className = 'wb-modal-body';
      prompt.textContent = 'Build this number on the bench. Use the buttons to set how many of each you actually need.';
      container.appendChild(prompt);

      const target = document.createElement('div');
      target.className = 'pv-target';
      // Only show digits for places that are actually active — informational display
      // only, not something the student fills in, so it stays scoped even though the
      // stepper rows below don't.
      const wholeDigits = [0, 1, 2].filter(i => pile.active.includes(i));
      const fracDigits = [3, 4, 5].filter(i => pile.active.includes(i));
      const whole = wholeDigits.length ? wholeDigits.map(i => pile.digits[i]).join('') : '0';
      target.textContent = fracDigits.length ? `$${whole}.${fracDigits.map(i => pile.digits[i]).join('')}` : `$${whole}`;
      container.appendChild(target);

      const tray = document.createElement('div');
      tray.className = 'pv-tray pv-tray-build';
      ALL_PLACES.forEach(i => {
        const row = document.createElement('div');
        row.className = 'pv-step-row';
        const art = document.createElement('div');
        art.className = 'pv-step-art';
        art.innerHTML = PV_PLACES[i].art();
        const label = document.createElement('div');
        label.className = 'pv-step-label';
        label.innerHTML = PV_PLACES[i].label;
        const stepper = document.createElement('div');
        stepper.className = 'pv-stepper';
        const dec = document.createElement('button');
        dec.type = 'button'; dec.textContent = '\u2212'; dec.disabled = true;
        const cnt = document.createElement('span');
        cnt.className = 'pv-step-cnt'; cnt.textContent = '0';
        const inc = document.createElement('button');
        inc.type = 'button'; inc.textContent = '+';
        function paint() {
          cnt.textContent = counts[i];
          dec.disabled = counts[i] === 0;
          inc.disabled = counts[i] >= 9;
        }
        dec.addEventListener('click', () => { counts[i] = Math.max(0, counts[i] - 1); paint(); });
        inc.addEventListener('click', () => { counts[i] = Math.min(9, counts[i] + 1); paint(); });
        stepper.appendChild(dec); stepper.appendChild(cnt); stepper.appendChild(inc);
        row.appendChild(art); row.appendChild(label); row.appendChild(stepper);
        tray.appendChild(row);
      });
      container.appendChild(tray);

      const checkBtn = gateButton('Check it', () => {
        if (checkBtn.disabled) return; // see the Read It checkBtn's comment above for why
        checkBtn.disabled = true;
        const correct = ALL_PLACES.every(i => counts[i] === pile.digits[i]);
        if (correct) onCorrect(); else { checkBtn.disabled = false; onWrong(); }
      });
      container.appendChild(checkBtn);
    },
  },

  // The digits shown are only the places in the chosen window (unlike Read It/Build It
  // above, which always show all 6) — that's deliberate here: it's what makes the correct
  // gap genuinely move around (bills-only windows put it at the end, coins-only windows
  // put it at the very start, mixed windows put it in between) instead of always landing
  // after "ones". No "box" to reveal for a hint, so this doesn't wire up onHintReady.
  'place-value-point': {
    name: 'Place Value — Place the Point',
    render(container, { onCorrect, onWrong, presetPile, bound }) {
      const pile = presetPile || generatePVDigits(bound);
      container.innerHTML = '';
      let pointAt = null;
      const correctGap = pile.active.filter(i => i <= 2).length;

      const prompt = document.createElement('div');
      prompt.className = 'wb-modal-body';
      prompt.textContent = 'The digits are right, but the decimal point is missing. Count the money, then tap where it belongs.';
      container.appendChild(prompt);

      const tray = document.createElement('div');
      tray.className = 'pv-tray';
      pile.active.forEach(i => {
        const n = pile.digits[i]; if (n === 0) return;
        const row = document.createElement('div');
        row.className = 'pv-denom-row';
        for (let k = 0; k < n; k++) {
          const span = document.createElement('span');
          span.innerHTML = PV_PLACES[i].art();
          row.appendChild(span);
        }
        tray.appendChild(row);
      });
      if (!tray.children.length) {
        tray.innerHTML = '<div style="text-align:center;color:#6b7d85;font-size:12px;padding:10px;">The bench is empty. That\u2019s still a number.</div>';
      }
      container.appendChild(tray);

      const row = document.createElement('div');
      row.className = 'pv-pointrow';
      const gaps = [];
      for (let g = 0; g <= pile.active.length; g++) {
        const gap = document.createElement('div');
        gap.className = 'pv-pgap';
        gap.innerHTML = '<div class="pv-slotdot"></div>';
        gap.addEventListener('click', () => selectGap(g));
        gaps.push(gap);
        row.appendChild(gap);
        if (g < pile.active.length) {
          const d = document.createElement('div');
          d.className = 'pv-pdigit';
          d.textContent = pile.digits[pile.active[g]];
          row.appendChild(d);
        }
      }
      container.appendChild(row);

      function selectGap(g) {
        pointAt = g;
        gaps.forEach((el, idx) => el.classList.toggle('filled', idx === g));
      }

      const checkBtn = gateButton('Check it', () => {
        if (checkBtn.disabled) return; // see the Read It checkBtn's comment above for why
        if (pointAt === null) {
          prompt.textContent = 'Tap a slot to place the decimal point first.';
          return;
        }
        checkBtn.disabled = true;
        const correct = pointAt === correctGap;
        if (correct) onCorrect(); else { checkBtn.disabled = false; onWrong(); }
      });
      container.appendChild(checkBtn);
    },
  },
};
