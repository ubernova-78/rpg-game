// measure.js — measurement question types for the battle/PvP system.
// Extracts "Choose the Unit", "Millimeter Ruler", and "Millimeter Caliper"
// from measure-bench.html into QUESTION_MODULES entries so they can appear
// alongside the place-value rounds in monster battles and PvP duels.
//
// Each module implements:
//   render(container, { onCorrect, onWrong, presetPile }) — build the
//     question UI, call onCorrect/onWrong when the student answers.
//   generate() — return a preset data object that, when passed back as
//     presetPile, reproduces the exact same question. Used by PvP so both
//     players see the identical problem.
//
// To add or remove measurement question types from battles, edit the
// BATTLE_QUESTION_POOL object in battle.js — that's the single place that
// controls which skills are live.

(function () {
  // ---------- Shared helpers ----------
  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pick = arr => arr[randInt(0, arr.length - 1)];
  const round2 = v => Math.round(v * 100) / 100;

  const UNIT_TO_MM = { mm: 1, cm: 10, m: 1000 };
  function fromMM(vmm, u) { return vmm / UNIT_TO_MM[u]; }
  function formatMM(mm, unit) {
    unit = unit || (mm < 10 ? 'mm' : mm < 1000 ? 'cm' : 'm');
    return `${round2(fromMM(mm, unit))} ${unit}`;
  }

  // ---------- Benchmarks for "Choose the Right Unit" ----------
  const BENCHMARKS = [
    { name: 'a grain of rice', mm: 6, unit: 'mm' },
    { name: 'a fingernail width', mm: 12, unit: 'mm' },
    { name: 'a paperclip', mm: 30, unit: 'mm' },
    { name: 'an AA battery', mm: 50, unit: 'mm' },
    { name: 'a credit card (long side)', mm: 86, unit: 'cm' },
    { name: 'a smartphone', mm: 150, unit: 'cm' },
    { name: 'a sheet of paper (long side)', mm: 280, unit: 'cm' },
    { name: 'a school ruler', mm: 300, unit: 'cm' },
    { name: 'a skateboard', mm: 800, unit: 'cm' },
    { name: 'a bike wheel across', mm: 660, unit: 'cm' },
    { name: 'a classroom door height', mm: 2000, unit: 'm' },
    { name: 'a dinner table length', mm: 1500, unit: 'm' },
    { name: 'a car length', mm: 4500, unit: 'm' },
    { name: 'a school bus length', mm: 12000, unit: 'm' },
    { name: 'a basketball court length', mm: 28000, unit: 'm' },
    { name: 'a football field length', mm: 91000, unit: 'm' },
    { name: 'a football field including end zones', mm: 110000, unit: 'm' },
    { name: 'a city block', mm: 80000, unit: 'm' },
  ];

  // ---------- Shared rendering (from measure-shared.js) ----------
  const { buildRulerDOM, buildCaliperSVG } = MeasureShared;
  const BATTLE_OPTS = { cssPrefix: 'mq-' };

  // ============================================================
  // QUESTION_MODULES entries
  // ============================================================

  // --- Choose the Right Unit ---
  QUESTION_MODULES['measure-unit'] = {
    name: 'Choose the Unit',
    generate() {
      const idx = randInt(0, BENCHMARKS.length - 1);
      return { benchmarkIdx: idx };
    },
    render(container, { onCorrect, onWrong, presetPile }) {
      const preset = presetPile || this.generate();
      const correct = BENCHMARKS[preset.benchmarkIdx];
      container.innerHTML = '';

      const prompt = document.createElement('div');
      prompt.className = 'wb-modal-body';
      prompt.textContent = `Which unit makes the most sense for measuring ${correct.name}?`;
      container.appendChild(prompt);

      const grid = document.createElement('div');
      grid.className = 'mq-options-grid';
      const opts = ['mm', 'cm', 'm'].sort(() => Math.random() - 0.5);
      let answered = false;
      opts.forEach(u => {
        const btn = document.createElement('button');
        btn.className = 'mq-optbtn';
        btn.textContent = u;
        btn.addEventListener('click', () => {
          if (answered) return;
          answered = true;
          grid.querySelectorAll('.mq-optbtn').forEach(b => b.disabled = true);
          if (u === correct.unit) {
            btn.classList.add('correct');
            onCorrect();
          } else {
            btn.classList.add('wrong');
            grid.querySelectorAll('.mq-optbtn').forEach(b => {
              if (b.textContent === correct.unit) b.classList.add('correct');
            });
            onWrong();
          }
        });
        grid.appendChild(btn);
      });
      container.appendChild(grid);
    },
  };

  // --- Millimeter Ruler ---
  QUESTION_MODULES['measure-mm-read'] = {
    name: 'Millimeter (Ruler)',
    generate() {
      const valueMM = randInt(5, 80);
      return { valueMM };
    },
    render(container, { onCorrect, onWrong, presetPile }) {
      const preset = presetPile || this.generate();
      const valueMM = preset.valueMM;
      container.innerHTML = '';

      const prompt = document.createElement('div');
      prompt.className = 'wb-modal-body';
      prompt.textContent = 'Read the length of the bar against the ruler.';
      container.appendChild(prompt);

      buildRulerDOM(container, valueMM, BATTLE_OPTS);

      // Answer row
      const answerRow = document.createElement('div');
      answerRow.className = 'mq-answer-row';
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.placeholder = 'Your reading';
      input.className = 'mq-answer-input';
      const unitLabel = document.createElement('span');
      unitLabel.className = 'mq-unit-label';
      unitLabel.textContent = 'mm';
      answerRow.appendChild(input);
      answerRow.appendChild(unitLabel);
      container.appendChild(answerRow);

      let answered = false;
      const submitBtn = gateButton('Submit', () => {
        if (answered) return;
        const raw = parseFloat(input.value);
        if (isNaN(raw)) { input.style.borderColor = '#c1443a'; setTimeout(() => input.style.borderColor = '', 500); return; }
        answered = true;
        const diff = Math.abs(raw - valueMM);
        if (diff <= 0.5) onCorrect(); else onWrong();
      });
      container.appendChild(submitBtn);

      setTimeout(() => input.focus(), 30);
    },
  };

  // --- Millimeter Caliper ---
  QUESTION_MODULES['measure-mm-caliper'] = {
    name: 'Millimeter (Caliper)',
    generate() {
      const valueMM = randInt(5, 80);
      return { valueMM };
    },
    render(container, { onCorrect, onWrong, presetPile }) {
      const preset = presetPile || this.generate();
      const valueMM = preset.valueMM;
      container.innerHTML = '';

      const prompt = document.createElement('div');
      prompt.className = 'wb-modal-body';
      prompt.textContent = 'Read the calipers\u2019 scale to find the length.';
      container.appendChild(prompt);

      // Caliper SVG
      const caliperWrap = document.createElement('div');
      caliperWrap.className = 'mq-caliper-wrap';
      caliperWrap.innerHTML = buildCaliperSVG(valueMM, 80, BATTLE_OPTS);
      const badge = document.createElement('div');
      badge.className = 'mq-unit-badge';
      badge.textContent = 'mm';
      caliperWrap.appendChild(badge);
      container.appendChild(caliperWrap);

      // Answer row
      const answerRow = document.createElement('div');
      answerRow.className = 'mq-answer-row';
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.placeholder = 'Your reading';
      input.className = 'mq-answer-input';
      const unitLabel = document.createElement('span');
      unitLabel.className = 'mq-unit-label';
      unitLabel.textContent = 'mm';
      answerRow.appendChild(input);
      answerRow.appendChild(unitLabel);
      container.appendChild(answerRow);

      let answered = false;
      const submitBtn = gateButton('Submit', () => {
        if (answered) return;
        const raw = parseFloat(input.value);
        if (isNaN(raw)) { input.style.borderColor = '#c1443a'; setTimeout(() => input.style.borderColor = '', 500); return; }
        answered = true;
        const diff = Math.abs(raw - valueMM);
        if (diff <= 0.5) onCorrect(); else onWrong();
      });
      container.appendChild(submitBtn);

      setTimeout(() => input.focus(), 30);
    },
  };

  // --- Add generate() to the existing place-value modules ---
  // These weren't needed before (battle generated its own pile, PvP called
  // generatePVDigits directly), but now PvP uses a uniform module.generate()
  // interface so it works with any question type.
  QUESTION_MODULES['place-value-read'].generate = function (bound) {
    return generatePVDigits(bound);
  };
  QUESTION_MODULES['place-value-build'].generate = function (bound) {
    return generatePVDigits(bound);
  };
  QUESTION_MODULES['place-value-point'].generate = function (bound) {
    return generatePVDigits(bound);
  };
})();
