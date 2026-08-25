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

  // ---------- Ruler builder (mm scale only for now) ----------
  const MM_PX_PER_MM = 6;
  const RULER_REC_START = 60;

  function buildRulerDOM(container, valueMM) {
    const padMM = 20;
    const totalMM = valueMM + padMM;
    const totalWidth = RULER_REC_START + totalMM * MM_PX_PER_MM + 40;

    // Scale label
    const scaleLabel = document.createElement('p');
    scaleLabel.className = 'mq-tape-scale-label';
    scaleLabel.textContent = 'Scale: small ticks = mm';
    container.appendChild(scaleLabel);

    // Tape wrapper (scrollable)
    const tapeWrap = document.createElement('div');
    tapeWrap.className = 'mq-tape-wrap';
    const inner = document.createElement('div');
    inner.className = 'mq-tape-inner';
    inner.style.width = totalWidth + 'px';
    tapeWrap.appendChild(inner);
    container.appendChild(tapeWrap);

    // Unit badge
    const badge = document.createElement('div');
    badge.className = 'mq-unit-badge';
    badge.textContent = 'mm';
    tapeWrap.appendChild(badge);

    // Measured bar
    const bar = document.createElement('div');
    bar.className = 'mq-measure-bar';
    bar.style.left = RULER_REC_START + 'px';
    bar.style.width = (valueMM * MM_PX_PER_MM + 1) + 'px';
    inner.appendChild(bar);

    // mm sub-ticks as repeating background
    const mmBg = document.createElement('div');
    mmBg.className = 'mq-mm-bg';
    mmBg.style.left = RULER_REC_START + 'px';
    mmBg.style.width = (totalWidth - RULER_REC_START) + 'px';
    mmBg.style.backgroundImage = `repeating-linear-gradient(to right, #1e2530 0, #1e2530 1px, transparent 1px, transparent ${MM_PX_PER_MM}px)`;
    inner.appendChild(mmBg);

    const totalCM = Math.ceil(totalMM / 10);

    // Half-cm ticks
    for (let h = 1; h <= totalCM * 2; h += 2) {
      const x = RULER_REC_START + h * 5 * MM_PX_PER_MM;
      const tick = document.createElement('div');
      tick.className = 'mq-tick mq-half-cm';
      tick.style.left = x + 'px';
      tick.style.height = '21px';
      inner.appendChild(tick);
    }

    // cm ticks + labels
    for (let c = 0; c <= totalCM; c++) {
      const x = RULER_REC_START + c * 10 * MM_PX_PER_MM;
      const isBold = c > 0 && c % 10 === 0;
      const tick = document.createElement('div');
      tick.className = 'mq-tick mq-cm' + (isBold ? ' mq-bold10' : '');
      tick.style.left = x + 'px';
      tick.style.height = isBold ? '48px' : '26px';
      inner.appendChild(tick);
      if (c > 0) {
        const lbl = document.createElement('div');
        lbl.className = 'mq-tick-label' + (isBold ? ' mq-bold10' : '');
        lbl.style.left = x + 'px';
        lbl.textContent = `${c * 10}`;
        inner.appendChild(lbl);
      }
    }

    // Scroll to bar end
    requestAnimationFrame(() => {
      const wrapWidth = tapeWrap.clientWidth;
      const barEndX = RULER_REC_START + valueMM * MM_PX_PER_MM;
      tapeWrap.scrollLeft = Math.max(0, barEndX - wrapWidth * 0.6);
    });

    // Drag-to-scroll
    enableDragScroll(tapeWrap);

    return tapeWrap;
  }

  // ---------- Caliper SVG builder ----------
  function buildCaliperSVG(valueMM, maxMM) {
    const pxPerMM = 6;
    const beamX = 30, beamW = maxMM * pxPerMM;
    const railW = beamX + beamW + 30;
    const beamY = 26, beamH = 30;
    const jawH = 46, jawW = 14;
    const barY = beamY + beamH + 14, barH = 24;

    let ticks = '';
    for (let mm = 0; mm <= maxMM; mm++) {
      const x = beamX + mm * pxPerMM;
      const isCM = mm % 10 === 0;
      const isHalfCM = !isCM && mm % 5 === 0;
      const tickH = isCM ? 16 : isHalfCM ? 12 : 9;
      const tickW = isCM ? 1.4 : isHalfCM ? 1.1 : 0.8;
      ticks += `<line x1="${x}" y1="${beamY + beamH}" x2="${x}" y2="${beamY + beamH - tickH}" stroke="#fff" stroke-width="${tickW}"/>`;
      if (isCM) ticks += `<text x="${x}" y="${beamY + 10}" font-size="10" fill="#fff" text-anchor="middle" font-family="monospace">${mm}</text>`;
    }

    const fixedX = beamX, slideX = beamX + valueMM * pxPerMM;
    const H = barY + barH + 20;

    const fixedJaw = `<path d="M${fixedX - jawW / 2} ${beamY + beamH} h${jawW} l-${jawW / 2 - 1} ${jawH} h-2 Z" fill="#14171a"/>`;
    const handle = `<rect x="${slideX - 9}" y="${beamY - 20}" width="18" height="16" rx="2" fill="#2c3138" stroke="#14171a" stroke-width="1.5"/>`;
    const slideLine = `<rect x="${slideX - 1.5}" y="${beamY - 4}" width="3" height="4" fill="#2c3138"/>`;
    const slideJaw = `<path d="M${slideX - jawW / 2} ${beamY + beamH} h${jawW} l-${jawW / 2 - 1} ${jawH} h-2 Z" fill="#2c3138"/>`;
    const pointer = `<polygon points="${slideX},${beamY + beamH + 2} ${slideX - 5},${beamY + beamH + 12} ${slideX + 5},${beamY + beamH + 12}" fill="#f2c230"/>`;

    return `<svg width="${railW}" height="${H}" viewBox="0 0 ${railW} ${H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${beamX - 14}" y="${beamY - 6}" width="${beamW + 28}" height="${beamH + 12}" rx="3" fill="#1a1d21"/>
      ${ticks}
      <rect x="${Math.min(fixedX, slideX)}" y="${barY}" width="${Math.abs(slideX - fixedX)}" height="${barH}" rx="3" fill="#3f6b8a" stroke="#26445a" stroke-width="1.5"/>
      ${fixedJaw}
      ${handle}
      ${slideLine}
      ${slideJaw}
      ${pointer}
    </svg>`;
  }

  // ---------- Drag-to-scroll helper ----------
  function enableDragScroll(el) {
    let isDown = false, startX, scrollLeft;
    el.addEventListener('mousedown', e => { isDown = true; startX = e.pageX - el.offsetLeft; scrollLeft = el.scrollLeft; });
    el.addEventListener('mouseleave', () => isDown = false);
    el.addEventListener('mouseup', () => isDown = false);
    el.addEventListener('mousemove', e => {
      if (!isDown) return;
      e.preventDefault();
      el.scrollLeft = scrollLeft - ((e.pageX - el.offsetLeft) - startX);
    });
    el.addEventListener('touchstart', e => { startX = e.touches[0].pageX - el.offsetLeft; scrollLeft = el.scrollLeft; }, { passive: true });
    el.addEventListener('touchmove', e => {
      el.scrollLeft = scrollLeft - ((e.touches[0].pageX - el.offsetLeft) - startX);
    }, { passive: true });
  }

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

      buildRulerDOM(container, valueMM);

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
      caliperWrap.innerHTML = buildCaliperSVG(valueMM, 80);
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
