/* ================================================================
   measure-shared.js — Single source of truth for measurement tool
   rendering (rulers, calipers, drag-to-scroll).

   Every view that shows a ruler or caliper loads this file and calls
   the same functions, so changes here propagate everywhere at once.

   Consumed by:
     • index.html  (battle / PvP via measure.js)
     • measure-bench.html          (practice workbench)
     • measure-average-bench.html  (measure & average workshop)
     • potion-quest.html           (potion gathering mini-game)
   ================================================================ */

// eslint-disable-next-line no-unused-vars
const MeasureShared = (function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────
  const PX_PER_MM = 6;       // pixel width of 1 mm on mm/cm rulers & calipers
  const RULER_PAD_LEFT = 60; // px of blank space before the zero mark
  const METRE_PX_PER_MM = 0.9; // metre tape: 9 px per cm, room for each cm's digit

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

  // ── Meter-tape tick builder ───────────────────────────────────
  // Draws the tick marks for a meter tape into an existing `.tape-inner`
  // element.  Shared by the meter bench and the measure-and-average
  // workshop so the two tapes cannot drift apart.
  //
  // Labels: every metre (red), every 10 cm, and every single cm near the
  // bar's end as its digit within the decimetre (1 2 3 4 5 6 7 8 9) — the
  // same scheme as the archery tape.  An earlier attempt that printed the
  // full cm number (11, 12, 13 …) smeared at 9 px apart; single digits fit,
  // but ONLY at 9 px per cm, which is why the tape is no longer shrunk to
  // fit a metre on screen (see buildRulerDOM / attachMetreMarker).  The
  // decimetre and metre numbers sit in higher rows than the cm digits so
  // "10" and its neighbouring "1" / "9" don't overlap.
  //
  //   opts.cssPrefix – class-name prefix (default '')
  //   opts.pxPerMM   – pixel scale (default 0.9)
  //   opts.padLeft   – px before the zero mark (default 60)
  //   opts.totalMM   – full length of tape to draw (default valueMM + 1000)
  //
  function buildMeterTicks(inner, valueMM, opts) {
    opts = opts || {};
    const p     = opts.cssPrefix || '';
    const pxMM  = opts.pxPerMM != null ? opts.pxPerMM : 0.9;
    const padL  = opts.padLeft != null ? opts.padLeft : RULER_PAD_LEFT;
    const totalMM = opts.totalMM != null ? opts.totalMM : valueMM + 1000;

    function addTick(x, cls) {
      const el = document.createElement('div');
      el.className = p + 'tick ' + p + cls;
      el.style.left = x + 'px';
      inner.appendChild(el);
    }
    function addLabel(x, cls, text) {
      const el = document.createElement('div');
      el.className = p + 'tick-label ' + p + cls;
      el.style.left = x + 'px';
      el.textContent = text;
      inner.appendChild(el);
    }

    const PX_PER_M    = pxMM * 1000;
    const totalMeters = Math.ceil(totalMM / 1000) + 1;
    // Individual cm ticks only near the bar's end, where they get read.
    const barMeter    = Math.floor(valueMM / 1000);
    const detailStart = Math.max(0, barMeter - 1);
    const detailEnd   = Math.min(totalMeters, barMeter + 2);

    for (let m = 0; m <= totalMeters; m++) {
      const mx = padL + m * PX_PER_M;
      addTick(mx, 'meter');
      addLabel(mx, 'meter', m + 'm');
      if (m >= totalMeters) continue;

      // 10 cm (decimetre) marks — numbered 10 … 90
      for (let d = 1; d < 10; d++) {
        const dx = padL + (m + d / 10) * PX_PER_M;
        addTick(dx, 'cm10');
        addLabel(dx, 'cm10', String(d * 10));
      }

      // Single cm ticks in the detail zone, with a "5" at each half-decimetre
      // so leftover centimetres can be counted without squinting.
      if (m >= detailStart && m < detailEnd) {
        for (let c = 1; c < 100; c++) {
          if (c % 10 === 0) continue;
          const cx = padL + (m + c / 100) * PX_PER_M;
          if (c % 5 === 0) {
            addTick(cx, 'cm5');
            addLabel(cx, 'cm5', '5');
          } else {
            addTick(cx, 'cm');
            addLabel(cx, 'cm5', String(c % 10));
          }
        }
      }
    }
  }

  // ── "Which metre am I in?" marker ─────────────────────────────
  // A metre is 900 px, wider than most tape viewports, so the red metre mark a
  // reading counts from can be scrolled off the left edge — and then 12.65 m
  // looks like 65 cm.  While that metre's own label is off screen, this pins
  // "◂ 12m" to the tape's left edge, in the metre labels' row and colour.
  // `host` must be the positioned box around the scroller (not the scroller
  // itself, or the marker scrolls away with the tape).
  function attachMetreMarker(tapeWrap, host, opts) {
    opts = opts || {};
    const p    = opts.cssPrefix || '';
    const pxMM = opts.pxPerMM || METRE_PX_PER_MM;
    const padL = opts.padLeft != null ? opts.padLeft : RULER_PAD_LEFT;
    let el = host.querySelector('.' + p + 'metre-marker');
    if (!el) {
      el = document.createElement('div');
      el.className = p + 'metre-marker';
      el.style.cssText = 'position:absolute;left:4px;bottom:98px;z-index:6;pointer-events:none;'
        + 'font-size:1.1rem;font-weight:900;color:#e94560;background:rgba(250,248,242,0.92);'
        + 'border-radius:4px;padding:0 5px;';
      host.appendChild(el);
    }
    function update() {
      const left = tapeWrap.scrollLeft;
      // The metre the tape is in just right of the marker itself (~60 px in).
      const m = Math.max(0, Math.floor((left + 60 - padL) / (1000 * pxMM)));
      const markX = padL + m * 1000 * pxMM;
      // Its own "12m" label is centred on the mark and ~32 px wide.
      const labelVisible = markX - 16 >= left;
      el.textContent = '\u25C2 ' + m + 'm';
      el.style.display = labelVisible ? 'none' : '';
    }
    tapeWrap.addEventListener('scroll', update, { passive: true });
    update();
    return update;
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
  //   opts.scale      – 'mm' | 'cm' | 'm'.  'm' draws a metre tape
  //                     (red metre marks + 10 cm marks) instead of a
  //                     cm ruler with mm sub-ticks (default 'cm')
  //
  // Returns the tape-wrap element (already appended to container).
  function buildRulerDOM(container, valueMM, opts) {
    opts = opts || {};
    const p      = opts.cssPrefix || '';
    const scale  = opts.scale     || 'cm';
    const isM    = scale === 'm';
    const padMM  = opts.padMM     || (isM ? 100 : 20);
    const padL   = opts.padLeft   || RULER_PAD_LEFT;
    const badge  = opts.badge != null ? opts.badge : 'cm';
    const label  = opts.scaleLabel || 'Scale: small ticks = mm \u00b7 numbered ticks = cm';

    // Scale label
    const scaleLabel = document.createElement('p');
    scaleLabel.className = p + 'tape-scale-label';
    scaleLabel.textContent = label;
    container.appendChild(scaleLabel);

    // Tape wrapper (scrollable), inside a positioned outer box.  The unit badge
    // has to sit in the OUTER box, not the scroller: parked inside the scroller
    // it slid off with the tape, so a 32 m reading lost the "m" telling the
    // student which unit they were reading.  Same structure the meter bench uses.
    const outer = document.createElement('div');
    outer.className = p + 'tape-wrap-outer';
    outer.style.position = 'relative';

    const tapeWrap = document.createElement('div');
    tapeWrap.className = p + 'tape-wrap';
    const tapeHeight = opts.tapeHeight || (isM ? '180px' : '');
    if (tapeHeight) tapeWrap.style.height = tapeHeight;
    const inner = document.createElement('div');
    // The scale modifier lets a stylesheet position the metre tape's ticks
    // separately: `.tick.cm` is drawn at two different heights (inline here
    // for the cm ruler, from CSS for the metre tape), so the two need
    // different offsets to hang from the same line.
    inner.className = p + 'tape-inner' + (isM ? ' ' + p + 'tape-inner-m' : '');
    tapeWrap.appendChild(inner);
    outer.appendChild(tapeWrap);
    container.appendChild(outer);

    // The metre tape is drawn at a fixed 9 px per cm, the archery tape's scale,
    // so every centimetre can carry its digit.  It used to shrink to fit a whole
    // metre on screen (down to 5.5 px per cm) so that the metre mark and the
    // bar's end were visible together; that squeezed the cm digits into a
    // smear.  When the metre mark is scrolled off, attachMetreMarker shows
    // which metre you're in instead.
    const pxMM = opts.pxPerMM || (isM ? METRE_PX_PER_MM : PX_PER_MM);

    const totalMM    = valueMM + padMM;
    const totalWidth = padL + totalMM * pxMM + 40;
    inner.style.width = totalWidth + 'px';

    // Unit badge
    const badgeEl = document.createElement('div');
    badgeEl.className = p + 'unit-badge';
    badgeEl.textContent = badge;
    outer.appendChild(badgeEl);

    // Measured bar
    const bar = document.createElement('div');
    bar.className = p + 'measure-bar';
    bar.style.left = padL + 'px';
    bar.style.width = (valueMM * pxMM + 1) + 'px';
    inner.appendChild(bar);

    if (isM) {
      // Metre tape — red metre marks, numbered 10 cm marks, cm detail near
      // the bar's end.  Shared with the meter bench (see buildMeterTicks).
      buildMeterTicks(inner, valueMM, { cssPrefix: p, pxPerMM: pxMM, padLeft: padL, totalMM });
      attachMetreMarker(tapeWrap, outer, { cssPrefix: p, pxPerMM: pxMM, padLeft: padL });
      finishRuler();
      return tapeWrap;
    }

    // mm sub-ticks as repeating background
    const mmBg = document.createElement('div');
    mmBg.className = p + 'mm-bg';
    mmBg.style.left = padL + 'px';
    mmBg.style.width = (totalWidth - padL) + 'px';
    // Fallback matters: a page without --charcoal defined would make the whole
    // repeating-linear-gradient invalid, and the mm sub-ticks would vanish.
    const lineColor = p ? '#1e2530' : 'var(--charcoal, #262b31)';
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

    finishRuler();
    return tapeWrap;

    // Scroll the bar's end into view, then make the tape draggable.
    function finishRuler() {
      requestAnimationFrame(() => {
        const wrapWidth = tapeWrap.clientWidth;
        const barEndX = padL + valueMM * pxMM;
        // Bar's end at 60% across.  The metre tape used to hold its metre
        // mark on screen instead, which at 9 px/cm pushed the end of a
        // x.77 m bar off the right edge; attachMetreMarker covers the metre.
        const target = barEndX - wrapWidth * 0.6;
        tapeWrap.scrollLeft = Math.max(0, target);
        tapeWrap.dispatchEvent(new Event('scroll')); // refresh the metre marker
      });
      enableDragScroll(tapeWrap);
    }
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
      // The half-centimetre tick is the one that makes a reading countable:
      // labels are only every 10 mm, so "35, then one more" beats counting
      // six identical ticks from the 30.  It used to be 3px taller than a mm
      // tick, which is invisible at this size — it is now clearly a midpoint
      // mark, and every mm tick is a little shorter to widen the gap.
      const tickH = isCM ? 19 : isHalfCM ? 14 : 8;
      const tickW = isCM ? 1.6 : isHalfCM ? 1.3 : 0.8;
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
    // Reading pointer.  Its apex sits exactly on `slideX` — the same x the
    // tick marks are drawn at — so it lands on a tick, never between two.
    // Outlined because it otherwise disappears into the dark slide jaw.
    const pointer  = `<polygon points="${slideX},${beamY + beamH} ${slideX - 5},${beamY + beamH + 12} ${slideX + 5},${beamY + beamH + 12}" fill="#f2c230" stroke="#14171a" stroke-width="0.8" stroke-linejoin="round"/>`;

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
    buildMeterTicks,
    attachMetreMarker,
    buildCaliperSVG,
  };
})();
