/*
  answer-review.js
  ------------------------------------------------------------------
  The "let them look at their mistake" layer, shared by every game.

  Two problems this fixes, both of which used to live in each game's
  own grade() function:

    1. A wrong answer auto-advanced on a 1.4-2.4s timer, and nextRound()
       wipes the body — so the question, the instrument AND the answer
       the student typed all vanished before they could compare them.
    2. Most games only ever showed the CORRECT answer ("the answer was
       4.57 cm"), never what the student actually put. If they misread
       the ruler there was nothing left on screen to misread again.

  So: a correct answer still flows on by itself (a good run keeps its
  pace), a wrong answer HOLDS until the student clicks Next, and every
  result names both numbers. Every answer is also logged, so the end
  screen can show the whole round back to them.

  Usage in a game's HTML:
    <script src="answer-review.js"></script>

  Then, per round:
    Review.reset();                        // at the start of a round
    Review.show(feedbackEl, {
      ok:        bool,
      yours:     '4.75 cm',                // what the student put
      correct:   '4.57 cm',                // what it should have been
      headline:  'Correct! +10 points',    // optional, correct answers
      note:      'Count the small ticks.', // optional teaching line
      autoMs:    1400,                     // correct-answer delay
      onNext:    nextRound,
    });
    Review.renderList(containerEl);        // on the end screen

  Review.show() logs the answer itself — don't also call record().
  ------------------------------------------------------------------
*/
window.Review = (function(){

  // ---------- styles ----------
  // Injected rather than copied into nine stylesheets, so the review
  // panel can't drift between games. Colours fall back to sane values
  // when a game doesn't define the variable.
  const CSS = `
  .rv-head{font-size:1.02rem;font-weight:800;margin-bottom:8px;}
  .rv-rows{display:flex;flex-direction:column;gap:5px;margin-bottom:9px;}
  .rv-row{
    display:flex;align-items:baseline;gap:8px;justify-content:center;
    flex-wrap:wrap;font-weight:600;
  }
  .rv-k{font-size:0.8rem;text-transform:uppercase;letter-spacing:0.04em;opacity:0.75;}
  .rv-v{font-size:1.05rem;font-weight:800;}
  .rv-v.rv-yours{text-decoration:line-through;text-decoration-thickness:2px;opacity:0.85;}
  .rv-note{font-size:0.88rem;font-weight:600;opacity:0.9;margin-bottom:10px;}
  .rv-next{
    display:inline-block;padding:10px 20px;border:none;border-radius:9px;
    background:#c0392b;color:#fff;font-size:1rem;font-weight:800;cursor:pointer;
    font-family:inherit;
  }
  .rv-next:hover{filter:brightness(1.1);}
  .rv-next:focus-visible{outline:3px solid #fff;outline-offset:2px;}

  /* End-of-round list */
  .rv-list{margin:18px 0;text-align:left;}
  .rv-list-title{
    font-size:0.85rem;font-weight:800;text-transform:uppercase;
    letter-spacing:0.05em;opacity:0.7;margin-bottom:8px;text-align:center;
  }
  .rv-table{width:100%;border-collapse:collapse;font-size:0.9rem;}
  .rv-table td{padding:6px 7px;border-bottom:1px solid rgba(0,0,0,0.08);vertical-align:top;}
  .rv-n{width:1.9em;opacity:0.55;font-weight:700;text-align:right;}
  .rv-mark{width:1.4em;font-weight:800;text-align:center;}
  .rv-tr-ok .rv-mark{color:#1e7e34;}
  .rv-tr-miss .rv-mark{color:#c0392b;}
  .rv-tr-miss{background:rgba(192,57,43,0.07);}
  .rv-ans{font-weight:700;}
  .rv-ans .rv-yours{text-decoration:line-through;opacity:0.7;font-weight:600;}
  .rv-arrow{opacity:0.5;margin:0 5px;}
  .rv-label{display:block;font-size:0.78rem;font-weight:600;opacity:0.6;margin-top:2px;}
  `;

  function injectCSS(){
    if(document.getElementById('rv-styles')) return;
    const s = document.createElement('style');
    s.id = 'rv-styles';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', injectCSS);
  }
  injectCSS();

  // ---------- the round log ----------
  let log = [];

  function reset(){ log = []; }
  function entries(){ return log.slice(); }

  function record(e){
    log.push({
      ok:      !!e.ok,
      yours:   e.yours   == null ? '' : String(e.yours),
      correct: e.correct == null ? '' : String(e.correct),
      label:   e.label   == null ? '' : String(e.label),
    });
  }

  // ---------- showing one result ----------
  // Correct  -> headline, then auto-advance (opts.autoMs, default 1400).
  // Wrong    -> both answers side by side, no timer, Next button.
  function show(el, opts){
    if(!el) return;
    const o = opts || {};
    const onNext = typeof o.onNext === 'function' ? o.onNext : function(){};
    const base = o.baseClass || 'feedback';

    if(o.log !== false){
      record({ ok:o.ok, yours:o.yours, correct:o.correct, label:o.label });
    }

    el.innerHTML = '';

    if(o.ok){
      el.className = base + ' ' + (o.okClass || 'show good');
      el.textContent = o.headline || 'Correct!';
      const ms = o.autoMs == null ? 1400 : o.autoMs;
      if(ms >= 0) setTimeout(onNext, ms);
      return;
    }

    el.className = base + ' ' + (o.badClass || 'show bad');

    const head = document.createElement('div');
    head.className = 'rv-head';
    head.textContent = o.headline || 'Not quite.';
    el.appendChild(head);

    const rows = document.createElement('div');
    rows.className = 'rv-rows';
    if(o.yours !== undefined && o.yours !== null && String(o.yours) !== ''){
      rows.appendChild(answerRow('Your answer', String(o.yours), 'rv-yours'));
    }
    if(o.correct !== undefined && o.correct !== null && String(o.correct) !== ''){
      rows.appendChild(answerRow('Correct answer', String(o.correct), 'rv-correct'));
    }
    el.appendChild(rows);

    const note = document.createElement('div');
    note.className = 'rv-note';
    note.textContent = o.note || 'Take your time — compare the two, then continue.';
    el.appendChild(note);

    const btn = document.createElement('button');
    btn.className = 'rv-next';
    btn.type = 'button';
    btn.textContent = o.nextLabel || 'Next question →';
    // Explicit flag, not just btn.disabled — some environments still dispatch
    // click listeners on a disabled button (the same trap placevalue.js
    // documents), and a double-tap here would skip a whole round.
    let taken = false;
    btn.addEventListener('click', function(){
      if(taken) return;
      taken = true;
      btn.disabled = true;
      onNext();
    });
    el.appendChild(btn);

    // Focus the button so Enter/Space continues — students have their
    // hands on the keyboard from typing the answer. The games' own
    // submit handlers are locked by this point, so a stray Enter can't
    // re-submit the round it just graded.
    setTimeout(function(){ try{ btn.focus(); }catch(e){} }, 60);
  }

  function answerRow(key, value, valueClass){
    const row = document.createElement('div');
    row.className = 'rv-row';
    const k = document.createElement('span');
    k.className = 'rv-k';
    k.textContent = key;
    const v = document.createElement('span');
    v.className = 'rv-v ' + (valueClass || '');
    v.textContent = value;
    row.appendChild(k); row.appendChild(v);
    return row;
  }

  // ---------- the end-of-round list ----------
  function renderList(container, opts){
    if(!container) return;
    const o = opts || {};
    container.innerHTML = '';
    if(!log.length){ container.style.display = 'none'; return; }
    container.style.display = '';

    const wrap = document.createElement('div');
    wrap.className = 'rv-list';

    const title = document.createElement('div');
    title.className = 'rv-list-title';
    const missed = log.filter(e=>!e.ok).length;
    title.textContent = o.title || (missed
      ? `Your answers — ${missed} to look back at`
      : 'Your answers — all correct');
    wrap.appendChild(title);

    const table = document.createElement('table');
    table.className = 'rv-table';
    const tbody = document.createElement('tbody');

    log.forEach(function(e, i){
      const tr = document.createElement('tr');
      tr.className = e.ok ? 'rv-tr-ok' : 'rv-tr-miss';

      const n = document.createElement('td');
      n.className = 'rv-n';
      n.textContent = (i+1);

      const mark = document.createElement('td');
      mark.className = 'rv-mark';
      mark.textContent = e.ok ? '✓' : '✗';

      const ans = document.createElement('td');
      ans.className = 'rv-ans';
      if(e.ok){
        ans.textContent = e.correct || e.yours;
      }else{
        const y = document.createElement('span');
        y.className = 'rv-yours';
        y.textContent = e.yours || '(no answer)';
        const arrow = document.createElement('span');
        arrow.className = 'rv-arrow';
        arrow.textContent = '→';
        const c = document.createElement('span');
        c.textContent = e.correct;
        ans.appendChild(y); ans.appendChild(arrow); ans.appendChild(c);
      }
      if(e.label){
        const lbl = document.createElement('span');
        lbl.className = 'rv-label';
        lbl.textContent = e.label;
        ans.appendChild(lbl);
      }

      tr.appendChild(n); tr.appendChild(mark); tr.appendChild(ans);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  return { reset, record, show, renderList, entries };
})();
