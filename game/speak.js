// Read aloud, only where it matters (Nick, 2026-11-20: his students read well below
// grade level). A big 🔊 button at the start of a piece of text: press it to hear
// that text, press again to stop. Nothing is read by itself.
//
// (An earlier read-aloud on every page, 2026-11-13, was removed the same day: its
// button was a dim icon in a far corner, it read pop-ups by itself, and its sound was
// only ever tested switched off. So: a big button beside the words, only when pressed.)
//
//   Speak.attach(el)        keep a 🔊 at the start of el, whatever is written into it
//   Speak.button(getText)   a 🔊 button that reads getText()
//   Speak.say(text), Speak.stop()
const Speak = (() => {
  const ok = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  let speaking = null; // the button whose words are being read
  let voice = null;
  function pickVoice() {
    if (!ok) return;
    const vs = speechSynthesis.getVoices().filter(v => /^en(-|_|$)/i.test(v.lang));
    voice = vs.find(v => /google us english/i.test(v.name)) || vs.find(v => /en-US/i.test(v.lang) && v.localService) || vs.find(v => /en-US/i.test(v.lang)) || vs[0] || null;
  }
  if (ok) { pickVoice(); speechSynthesis.addEventListener('voiceschanged', pickVoice); }

  // Say it the way a person would: units in full, no emoji or arrows.
  function clean(t) {
    return String(t)
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, ' ')
      .replace(/[▶◀▷◁◗◖▭▯◺◿❮❯⤢↶✓⚠ℹ]/g, ' ')
      .replace(/(\d)\s*m²/g, '$1 square meters')
      .replace(/(\d)\s*kg\b/g, '$1 kilograms')
      .replace(/(\d)\s*kt\b/g, '$1 knots')
      .replace(/(\d)\s*cm\b/g, '$1 centimeters')
      .replace(/(\d)\s*m\b/g, '$1 meters')
      .replace(/(\d)\s*s\b/g, '$1 seconds')
      .replace(/(\d)\s*×\s*(\d)/g, '$1 by $2')
      .replace(/…/g, ' ')
      .replace(/\s+/g, ' ').replace(/\s+([.,!?:])/g, '$1').replace(/([.!?:])(\s*\.)+/g, '$1').replace(/^[\s.,]+/, '').trim();
  }
  function stop() {
    if (ok) speechSynthesis.cancel();
    if (speaking) { speaking.classList.remove('on'); speaking.setAttribute('aria-pressed', 'false'); }
    speaking = null;
  }
  function say(text, btn) {
    if (!ok) return;
    stop();
    const words = clean(text); if (!words) return;
    const u = new SpeechSynthesisUtterance(words);
    if (voice) u.voice = voice;
    u.lang = voice ? voice.lang : 'en-US'; u.rate = 0.9; u.pitch = 1;
    u.onend = u.onerror = () => { if (speaking === btn) stop(); };
    if (btn) { speaking = btn; btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true'); }
    speechSynthesis.speak(u);
  }
  // The words a person sees in el: not its buttons, inputs, drawings or closed "More".
  function visibleText(el) {
    const out = [];
    (function walk(n) {
      if (n.nodeType === 3) { out.push(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName;
      if (/^(BUTTON|SELECT|INPUT|CANVAS|SCRIPT|STYLE|SVG)$/.test(tag) || n.classList.contains('speak-btn')) return;
      if (tag === 'DETAILS' && !n.open) return; // (a closed 'More' isn't read)
      if (n.hidden || (n.style && n.style.display === 'none')) return;
      for (const c of n.childNodes) walk(c);
      if (/^(P|DIV|H\d|LI|BR|SUMMARY)$/.test(tag)) out.push('. ');
    })(el);
    return out.join(' ').replace(/(\.\s*){2,}/g, '. ');
  }
  function button(getText) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'speak-btn'; b.textContent = '🔊';
    b.title = 'Read it to me'; b.setAttribute('aria-label', 'Read it to me'); b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); if (speaking === b) stop(); else say(getText(), b); });
    if (!ok) b.disabled = true;
    return b;
  }
  // Keep a 🔊 at the start of el, even when its words are rewritten.
  function attach(el) {
    if (!el) return;
    const ensure = () => {
      const has = el.firstElementChild && el.firstElementChild.classList.contains('speak-btn');
      const text = visibleText(el).replace(/[.\s]/g, '');
      if (!has && text) el.insertBefore(button(() => visibleText(el)), el.firstChild);
      if (has && !text) el.firstElementChild.remove();
    };
    new MutationObserver(ensure).observe(el, { childList: true, characterData: true, subtree: false });
    ensure();
  }
  if (typeof document !== 'undefined') {
    const css = document.createElement('style');
    css.textContent = '.speak-btn{font-size:1.15rem;line-height:1;width:2.1em;height:2.1em;min-width:2.1em;border-radius:50%;border:2px solid #2f6fb5;background:#fff;color:#20313d;cursor:pointer;margin:0 8px 0 0;padding:0;vertical-align:middle;box-shadow:0 1px 3px rgba(0,0,0,0.2);flex:none;}'
      + '.speak-btn:hover{background:#e8f1fb}.speak-btn.on{background:#ffe08a;border-color:#b8860b;animation:speakpulse 1s ease-in-out infinite}.speak-btn:disabled{display:none}'
      + '@keyframes speakpulse{50%{box-shadow:0 0 0 5px rgba(212,160,23,0.35)}}';
    (document.head || document.documentElement).appendChild(css);
    window.addEventListener('pagehide', stop);
  }
  return { ok, say, stop, button, attach, clean, visibleText };
})();
if (typeof module !== 'undefined') module.exports = { Speak };
