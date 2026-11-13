// read-aloud.js — Read Aloud for the game and every student page (Nick, 2026-11-13).
//
// A 🔊 button (bottom-right) turns it on and off. The setting is kept in
// localStorage ('pq-read-aloud'), which the game and its benches share (same
// origin), so turning it on in the game turns it on inside every workbench.
// While it's on:
//   - Click any text to hear it: the nearest paragraph, heading, list item, label
//     or cell. Buttons, inputs and canvases keep working as normal and aren't read.
//     The block that would be read gets a dashed outline on hover.
//   - Anything marked data-read-auto is read when it appears or its text changes:
//     the game's dialogue and message pop-ups, and battle questions.
// Uses the browser's own speech (speechSynthesis): on Chromebooks that's ChromeOS's
// voices, which work offline. Nothing is sent anywhere.
//
// Inside the game's overlay (an iframe) the page hides its own button: the game's
// button sits above the overlay and controls both, and a 'storage' event tells the
// page when it changes.
(function () {
  if (window.__readAloud) return;
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return; // no speech on this browser: no button
  const KEY = 'pq-read-aloud';
  const inFrame = window.parent !== window;
  const get = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
  const put = v => { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) {} };
  let on = get();

  // ---------- Turning text into something that sounds right ----------
  const UNIT = { mm: 'millimeters', cm: 'centimeters', m: 'meters', km: 'kilometers', kg: 'kilograms', g: 'grams', mg: 'milligrams',
    s: 'seconds', min: 'minutes', h: 'hours', hr: 'hours', mL: 'milliliters', ml: 'milliliters', L: 'liters' };
  function speakable(t) {
    return String(t)
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, ' ') // emoji
      .replace(/g\s*\/\s*cm³/g, ' grams per cubic centimeter').replace(/kg\s*\/\s*m³/g, ' kilograms per cubic meter')
      .replace(/(\d)\s*cm³/g, '$1 cubic centimeters').replace(/(\d)\s*m³/g, '$1 cubic meters')
      .replace(/(\d)\s*cm²/g, '$1 square centimeters').replace(/(\d)\s*m²/g, '$1 square meters')
      .replace(/cm³/g, 'cubic centimeters').replace(/m³/g, 'cubic meters')
      .replace(/(\d)\s*(mm|cm|km|kg|mg|mL|ml|min|hr|m|g|s|h|L)\b(?![\/\w])/g, (_, d, u) => `${d} ${UNIT[u]}`)
      .replace(/\b(mm|cm|km|kg|mL)\b/g, u => UNIT[u]) // unambiguous ones standing alone ("ticks = mm")
      .replace(/÷/g, ' divided by ').replace(/×/g, ' times ').replace(/−/g, ' minus ')
      .replace(/(\d)\s*°/g, '$1 degrees').replace(/≈/g, ' about ').replace(/≤/g, ' at most ').replace(/≥/g, ' at least ')
      .replace(/→/g, ' to ').replace(/[—–]/g, ', ').replace(/…/g, '...')
      .replace(/\s+/g, ' ').trim();
  }

  // ---------- Speaking ----------
  let voice = null, speakingEl = null;
  function pickVoice() {
    const vs = synth.getVoices();
    voice = vs.find(v => /en[-_]US/i.test(v.lang) && /Google|Samantha|Natural/i.test(v.name))
      || vs.find(v => /en[-_]US/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
  }
  pickVoice();
  if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', pickVoice);
  function mark(el) {
    if (speakingEl) speakingEl.classList.remove('ra-speaking');
    speakingEl = el || null;
    if (speakingEl) speakingEl.classList.add('ra-speaking');
  }
  function stop() { synth.cancel(); mark(null); }
  function say(text, el) {
    const t = speakable(text);
    if (!t) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(t);
    if (voice) u.voice = voice;
    u.lang = (voice && voice.lang) || 'en-US';
    u.rate = 0.95;
    u.onend = u.onerror = () => { if (speakingEl === el) mark(null); };
    mark(el);
    synth.speak(u);
  }

  // The words in an element, leaving out buttons, inputs and anything hidden.
  // Lines (blocks) get a pause between them, so "...the ruler." and "Scale: ..." on
  // two lines don't run together.
  function textOf(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll('button, input, select, textarea, script, style, canvas, svg, .ra-btn, [data-no-read], [hidden], .hidden').forEach(x => x.remove());
    c.querySelectorAll('div, p, li, h1, h2, h3, h4, h5, h6, td, th, tr, br, label, dt, dd').forEach(x => {
      const t = (x.textContent || '').trim();
      x.append(document.createTextNode(t && !/[.!?:;,]$/.test(t) && !x.querySelector('div, p, li') ? '. ' : ' '));
    });
    return c.textContent || '';
  }

  // ---------- Click to hear ----------
  // (A label wrapping a checkbox is a control too. :has() is new, so only if supported.)
  let hasOk = false; try { document.querySelector(':has(*)'); hasOk = true; } catch (e) {}
  const SKIP = 'button, a, input, select, textarea, canvas, svg, [role=button], [onclick], [contenteditable], .ra-btn, [data-no-read]' + (hasOk ? ', label:has(input)' : '');
  const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, td, th, label, dt, dd, figcaption, blockquote, [data-read-block]';
  function blockFor(target) {
    if (!(target instanceof Element) || target.closest(SKIP)) return null;
    let el = target.closest(BLOCK);
    if (!el) {
      // No paragraph-like element: use the nearest element with its own words.
      el = target;
      while (el && el !== document.body && ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) el = el.parentElement;
      // A bold word or a span inside a sentence: read the whole line it's in.
      while (el && el !== document.body && getComputedStyle(el).display.startsWith('inline') && el.parentElement && el.parentElement !== document.body) el = el.parentElement;
      if (!el || el === document.body) return null;
    }
    return textOf(el).trim() ? el : null;
  }
  document.addEventListener('click', e => {
    if (!on) return;
    const el = blockFor(e.target);
    if (!el) return;
    if (speakingEl === el && synth.speaking) { stop(); return; } // click again to stop
    say(textOf(el), el);
  }, true);
  let hoverEl = null;
  document.addEventListener('mouseover', e => {
    if (!on) return;
    const el = blockFor(e.target);
    if (el === hoverEl) return;
    if (hoverEl) hoverEl.classList.remove('ra-hover');
    hoverEl = el; if (el) el.classList.add('ra-hover');
  });

  // ---------- Read automatically: [data-read-auto] ----------
  // Read when it becomes visible or its words change while visible. Short pause so a
  // pop-up that's filled in a few steps is read once, complete.
  const lastSaid = new WeakMap();
  const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && !el.closest('.hidden');
  function checkAuto(el) {
    if (!on) return;
    clearTimeout(el.__raT);
    el.__raT = setTimeout(() => {
      const text = visible(el) ? textOf(el).replace(/\s+/g, ' ').trim() : '';
      if (!text) { lastSaid.set(el, ''); return; }
      if (lastSaid.get(el) === text) return;
      lastSaid.set(el, text);
      say(text, el);
    }, 180);
  }
  function watch(el) {
    if (el.__raWatched) return;
    el.__raWatched = true;
    new MutationObserver(() => checkAuto(el)).observe(el, { childList: true, subtree: true, characterData: true });
    // Pop-ups show and hide by a class on an ancestor: watch those too.
    for (let a = el; a && a !== document.body; a = a.parentElement)
      new MutationObserver(() => checkAuto(el)).observe(a, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  }
  const scan = () => document.querySelectorAll('[data-read-auto]').forEach(watch);

  // ---------- The button ----------
  const css = document.createElement('style');
  css.textContent = `
    .ra-btn{position:fixed;right:14px;bottom:14px;z-index:2147483000;width:48px;height:48px;border-radius:50%;border:3px solid #f6c90e;
      background:#20313d;color:#fff;font-size:22px;line-height:1;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:0;}
    .ra-btn.off{border-color:#7a8790;opacity:.75;}
    .ra-btn .ra-tip{position:absolute;right:56px;bottom:8px;white-space:nowrap;background:#20313d;color:#fff;font:600 12px system-ui,sans-serif;
      padding:5px 8px;border-radius:6px;opacity:0;pointer-events:none;transition:opacity .15s;}
    .ra-btn:hover .ra-tip,.ra-btn:focus-visible .ra-tip{opacity:1;}
    body.ra-on .ra-hover{outline:2px dashed #f6c90e;outline-offset:2px;cursor:pointer;}
    body.ra-on .ra-speaking{outline:3px solid #f6c90e;outline-offset:2px;background-color:rgba(246,201,14,.15);}
  `;
  document.head.appendChild(css);
  let btn = null;
  function paint() {
    document.body.classList.toggle('ra-on', on);
    if (!on && hoverEl) { hoverEl.classList.remove('ra-hover'); hoverEl = null; }
    if (!btn) return;
    btn.classList.toggle('off', !on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.firstChild.textContent = on ? '🔊' : '🔈';
    btn.querySelector('.ra-tip').textContent = on ? 'Read aloud is ON: click any words to hear them' : 'Read aloud: off';
  }
  function setOn(v, announce) {
    on = v; put(v); paint();
    if (!v) stop();
    else { scan(); if (announce) say('Read aloud is on. Click any words to hear them.'); }
  }
  function init() {
    if (!inFrame) {
      btn = document.createElement('button');
      btn.className = 'ra-btn'; btn.type = 'button';
      btn.setAttribute('aria-label', 'Read aloud');
      btn.append(document.createTextNode('🔈'));
      const tip = document.createElement('span'); tip.className = 'ra-tip'; btn.append(tip);
      btn.addEventListener('click', e => { e.stopPropagation(); setOn(!on, true); });
      document.body.appendChild(btn);
    }
    paint(); scan();
    // Pop-ups added later (a bench building its screen) get watched too.
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  }
  window.addEventListener('storage', e => { if (e.key === KEY) { on = get(); paint(); if (!on) stop(); else scan(); } });
  window.addEventListener('pagehide', stop);
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
  window.__readAloud = { say, stop, speakable, isOn: () => on };
})();
