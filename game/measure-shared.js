/* ================================================================
   measure-shared.js — Single source of truth for measurement tool
   rendering (rulers, calipers, drag-to-scroll).

   Every view that shows a ruler or caliper loads this file and calls
   the same functions, so changes here propagate everywhere at once.

   Consumed by:
     • index.html  (battle / PvP via measure.js)
     • measure-bench.html  (practice workbench)
     • potion-quest.html   (potion gathering mini-game)
   ================================================================ */

// eslint-disable-next-line no-unused-vars
const MeasureShared = (function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────
  const PX_PER_MM = 6;       // pixel width of 1 mm on mm/cm rulers & calipers
  const RULER_PAD_LEFT = 60; // px of blank space before the zero mark

  // ── Drag-to-scroll helper ─────────────────────────────────────
  function enableDragScroll(el) {
    let isDown = false, startX, scrollLeft;
    el.addEventListener('mousedown', e => {
      isDown = true; startX = e.pageX - el.offsetLeft; scrollLeft = el.scrollLeft;
    });
    el.addEventListener('mouseleave', () => isDown = false);
    el.addEventListener('mouseup',    () => isDown = false);
    el.addEventListener('mousemove', e => {
      if (!isDown) return;
      e.preventDefault();
      el.scrollLeft = scrollLeft - ((e.pageX - el.offsetLeft) - startX);
    });
    el.addEventListener('touchstart', e => {
      startX = e.touches[0].pageX - el.offsetLeft; scrollLeft = el.scrollLeft;
    }, { passive: true });
    el.addEventListener('touchmove', e => {
      el.scrollLeft = scrollLeft - ((e.touches[0].pageX - el.offsetLeft) - startX);
    }, { passive: true });
  }

  // ── Ruler builder ─────────────────────────────────────────────
  // Builds a scrollable cm ruler with mm sub-ticks into `container`.
  //
  //   opts.cssPrefix  – class-name prefix, e.g. 'mq-' for battle or '' for bench
  //   opts.pxPerMM    – override pixel scale (default 6)
  //   opts.padMM      – mm of extra tape past the bar (default 20)
  //   opts.padLeft    – px before the zero mark (default 60)
  //   opts.badge      – text for the unit badge (default 'cm')
  //   opts.scaleLabel – text above the ruler (default auto)
  //   opts.tapeHeight – CSS height of the tape wrapper (default '150px')
  //
  // Returns the tape-wrap element (already appended to container).
  function buildRulerDOM(container, valueMM, opts) {
    opts = opts || {};
    const p      = opts.cssPrefix || '';
    const pxMM   = opts.pxPerMM   || PX_PER_MM;
    const padMM  = opts.padMM     || 20;
    const padL   = opts.padLeft   || RULER_PAD_LEFT;
    const badge  = opts.badge != null ? opts.badge : 'cm';
    const label  = opts.scaleLabel || 'Scale: small ticks = mm \u00b7 numbered ticks = cm';

    const totalMM   = valueMM + padMM;
    const totalWidth = padL + totalMM * pxMM + 40;

    // Scale label
    const scaleLabel = document.createElement('p');
    scaleLabel.className = p + 'tape-scale-label';
    scaleLabel.textContent = label;
    container.appendChild(scaleLabel);

    // Tape wrapper (scrollable)
    const tapeWrap = document.createElement('div');
    tapeWrap.className = p + 'tape-wrap';
    if (opts.tapeHeight) tapeWrap.style.height = opts.tapeHeight;
    const inner = document.createElement('div');
    inner.className = p + 'tape-inner';
    inner.style.width = totalWidth + 'px';
    tapeWrap.appendChild(inner);
    container.appendChild(tapeWrap);

    // Unit badge
    const badgeEl = document.createElement('div');
    badgeEl.className = p + 'unit-badge';
    badgeEl.textContent = badge;
    tapeWrap.appendChild(badgeEl);

    // Measured bar
    const bar = document.createElement('div');
    bar.className = p + 'measure-bar';
    bar.style.left = padL + 'px';
    bar.style.width = (valueMM * pxMM + 1) + 'px';
    inner.appendChild(bar);

    // mm sub-ticks as repeating background
    const mmBg = document.createElement('div');
    mmBg.className = p + 'mm-bg';
    mmBg.style.left = padL + 'px';
    mmBg.style.width = (totalWidth - padL) + 'px';
    const lineColor = p ? '#1e2530' : 'var(--charcoal)';
    mmBg.style.backgroundImage =
      `repeating-linear-gradient(to right, ${lineColor} 0, ${lineColor} 1px, transparent 1px, transparent ${pxMM}px)`;
    inner.appendChild(mmBg);

    const totalCM = Math.ceil(totalMM / 10);

    // Half-cm ticks
    for (let h = 1; h <= totalCM * 2; h += 2) {
      const x = padL + h * 5 * pxMM;
      const tick = document.createElement('div');
      tick.className = p + 'tick ' + p + 'half-cm';
      tick.style.left = x + 'px';
      tick.style.height = '21px';
      inner.appendChild(tick);
    }

    // cm ticks + labels (1, 2, 3 …)
    for (let c = 0; c <= totalCM; c++) {
      const x = padL + c * 10 * pxMM;
      const tick = document.createElement('div');
      tick.className = p + 'tick ' + p + 'cm';
      tick.style.left = x + 'px';
      tick.style.height = '26px';
      inner.appendChild(tick);
      if (c > 0) {
        const lbl = document.createElement('div');
        lbl.className = p + 'tick-label';
        lbl.style.left = x + 'px';
        lbl.textContent = '' + c;
        inner.appendChild(lbl);
      }
    }

    // Scroll to bar end
    requestAnimationFrame(() => {
      const wrapWidth = tapeWrap.clientWidth;
      const barEndX = padL + valueMM * pxMM;
      tapeWrap.scrollLeft = Math.max(0, barEndX - wrapWidth * 0.6);
    });

    // Drag-to-scroll
    enableDragScroll(tapeWrap);

    return tapeWrap;
  }

  // ── Caliper SVG builder ───────────────────────────────────────
  // Returns an SVG string.
  //
  //   opts.specimenSVG – custom SVG content to draw between the jaws
  //                      instead of the default blue bar.  Receives
  //                      { x, y, w, h } with the bar's bounding box.
  //   opts.extraH      – extra px below the bar for legs/stems (default 0)
  //
  function buildCaliperSVG(valueMM, maxMM, opts) {
    opts = opts || {};
    const pxPerMM = PX_PER_MM;
    const beamX = 30, beamW = maxMM * pxPerMM;
    const railW = beamX + beamW + 30;
    const beamY = 26, beamH = 30;
    const jawH = 46, jawW = 14;
    const barY = beamY + beamH + 14, barH = 24;

    // Ticks + labels
    let ticks = '';
    for (let mm = 0; mm <= maxMM; mm++) {
      const x = beamX + mm * pxPerMM;
      const isCM     = mm % 10 === 0;
      const isHalfCM = !isCM && mm % 5 === 0;
      const tickH = isCM ? 16 : isHalfCM ? 12 : 9;
      const tickW = isCM ? 1.4 : isHalfCM ? 1.1 : 0.8;
      ticks += `<line x1="${x}" y1="${beamY + beamH}" x2="${x}" y2="${beamY + beamH - tickH}" stroke="#fff" stroke-width="${tickW}"/>`;
      if (isCM) {
        ticks += `<text x="${x}" y="${beamY + 10}" font-size="10" fill="#fff" text-anchor="middle" font-family="monospace">${mm}</text>`;
      }
    }

    const fixedX = beamX;
    const slideX = beamX + valueMM * pxPerMM;
    const barW   = Math.abs(slideX - fixedX);
    const barX   = Math.min(fixedX, slideX);

    // Specimen (custom shape or default blue bar)
    let specimen;
    if (opts.specimenSVG) {
      specimen = opts.specimenSVG({ x: barX, y: barY, w: barW, h: barH });
    } else {
      specimen = `<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="3" fill="#3f6b8a" stroke="#26445a" stroke-width="1.5"/>`;
    }

    const extraH = opts.extraH || 0;
    const H = barY + barH + extraH + 20;

    const fixedJaw = `<path d="M${fixedX - jawW / 2} ${beamY + beamH} h${jawW} l-${jawW / 2 - 1} ${jawH} h-2 Z" fill="#14171a"/>`;
    const handle   = `<rect x="${slideX - 9}" y="${beamY - 20}" width="18" height="16" rx="2" fill="#2c3138" stroke="#14171a" stroke-width="1.5"/>`;
    const slideLine = `<rect x="${slideX - 1.5}" y="${beamY - 4}" width="3" height="4" fill="#2c3138"/>`;
    const slideJaw = `<path d="M${slideX - jawW / 2} ${beamY + beamH} h${jawW} l-${jawW / 2 - 1} ${jawH} h-2 Z" fill="#2c3138"/>`;
    const pointer  = `<polygon points="${slideX},${beamY + beamH + 2} ${slideX - 5},${beamY + beamH + 12} ${slideX + 5},${beamY + beamH + 12}" fill="#f2c230"/>`;

    return `<svg width="${railW}" height="${H}" viewBox="0 0 ${railW} ${H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${beamX - 14}" y="${beamY - 6}" width="${beamW + 28}" height="${beamH + 12}" rx="3" fill="#1a1d21"/>
      ${ticks}
      ${specimen}
      ${fixedJaw}
      ${handle}
      ${slideLine}
      ${slideJaw}
      ${pointer}
    </svg>`;
  }

  // ── Public API ────────────────────────────────────────────────
  return {
    PX_PER_MM,
    RULER_PAD_LEFT,
    enableDragScroll,
    buildRulerDOM,
    buildCaliperSVG,
  };
})();
