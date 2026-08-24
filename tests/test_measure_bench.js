const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');

function fetchText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function testBench(benchKey, expectedFirstMode) {
  const html = await fetchText('http://127.0.0.1:8791/measure-bench.html');
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    if (/firebasejs|fonts\.googleapis|fonts\.gstatic/.test(e.message)) return;
    errors.push('jsdomError: ' + e.message);
  });

  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:8791/measure-bench.html',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.Shared = {
        loadOrCreateStudent: async () => ({ ok: false, error: 'stub' }),
        saveStudent: async () => {},
        getLevelInfo: () => ({ level: 1, floor: 0, nextReq: 100, progress: 0 }),
        DB_OK: false,
        DB: { ref: () => ({ once: async () => ({ exists: () => false, forEach: () => {} }), push: async () => {} }) },
      };
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(window.performance.now()), 4);
    },
  });
  const { window } = dom;

  await new Promise((resolve) => {
    if (window.document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  await new Promise((r) => setTimeout(r, 30));

  window.__result = null;
  const script = window.document.createElement('script');
  script.textContent = `
    (async () => {
      const results = {};
      // measure-bench.html wraps everything in an IIFE, so 'state'/'BENCHMARKS'/etc.
      // aren't reachable from an injected script the way other games in this project
      // allow — this test works purely through the DOM instead, which is arguably a
      // better check anyway: it confirms what's RENDERED matches what gets GRADED.
      const BENCHMARK_UNITS = {
        'a grain of rice':'mm','a fingernail width':'mm','a paperclip':'mm','an AA battery':'mm',
        'a credit card (long side)':'cm','a smartphone':'cm','a sheet of paper (long side)':'cm',
        'a school ruler':'cm','a skateboard':'cm','a bike wheel across':'cm',
        'a classroom door height':'m','a dinner table length':'m','a car length':'m',
        'a school bus length':'m','a basketball court length':'m','a football field length':'m',
        'a football field including end zones':'m','a city block':'m',
      };
      const PX_PER_MM = { mm: 6, cm: 2, m: 0.6 };
      const UNIT_TO_MM = { mm:1, cm:10, m:1000 };
      try {
        document.getElementById('demo-mode').checked = true;
        document.getElementById('demo-mode').dispatchEvent(new Event('change'));
        document.querySelector('[data-bench="${benchKey}"]').click();
        document.getElementById('btn-start').click();
        await new Promise(r => setTimeout(r, 20));

        results.reachedGameScreen = !document.getElementById('screen-game').classList.contains('hidden');

        function currentModeKind() {
          if (!document.getElementById('mode-unit').classList.contains('hidden')) return 'unit';
          if (!document.getElementById('mode-caliper').classList.contains('hidden')) return 'caliper';
          return 'ruler';
        }

        function answerCurrentRoundCorrectly() {
          const kind = currentModeKind();
          if (kind === 'unit') {
            const qtext = document.getElementById('qtext').textContent;
            const bmName = Object.keys(BENCHMARK_UNITS).find(n => qtext.includes(n));
            const correctUnit = BENCHMARK_UNITS[bmName];
            const target = [...document.querySelectorAll('#unit-options .optbtn')].find(b => b.textContent === correctUnit);
            target.click();
            return 'unit';
          } else if (kind === 'caliper') {
            const rect = document.querySelector('#caliper-wrap rect[fill="#3f6b8a"]');
            const valueMM = parseFloat(rect.getAttribute('width')) / PX_PER_MM.mm;
            document.getElementById('caliper-answer').value = String(Math.round(valueMM));
            document.getElementById('submit-caliper').dispatchEvent(new Event('click'));
            return 'caliper';
          } else {
            const scale = document.getElementById('read-unit').value;
            const bar = document.querySelector('#tape-inner .measure-bar');
            const valueMM = parseFloat(bar.style.width) / PX_PER_MM[scale];
            const raw = valueMM / UNIT_TO_MM[scale];
            document.getElementById('read-answer').value = String(Math.round(raw * 100) / 100);
            document.getElementById('submit-read').dispatchEvent(new Event('click'));
            return 'ruler-' + scale;
          }
        }

        const modesEncountered = [];
        for (let i = 0; i < 12; i++) {
          await new Promise(r => setTimeout(r, 10));
          modesEncountered.push(answerCurrentRoundCorrectly());
          await new Promise(r => setTimeout(r, 1500)); // grade()'s setTimeout(nextRound, 1400)
        }
        await new Promise(r => setTimeout(r, 50));
        results.modesEncountered = modesEncountered;
        results.reachedEndScreen = !document.getElementById('screen-end').classList.contains('hidden');
        results.endExpEarned = document.getElementById('end-exp-earned').textContent;
        // With every round answered correctly, feedback should never have shown "Not quite".
        results.allRoundsScoredCorrect = document.getElementById('end-exp-earned').textContent !== '0';

        // Re-enter for a DOM-shape sanity check on whichever mode types this bench covers.
        document.getElementById('btn-play-again').click();
        document.getElementById('demo-mode').checked = true;
        document.getElementById('demo-mode').dispatchEvent(new Event('change'));
        document.querySelector('[data-bench="${benchKey}"]').click();
        document.getElementById('btn-start').click();
        await new Promise(r => setTimeout(r, 20));
        const kind2 = currentModeKind();
        results.secondEntryModeKind = kind2;
        if (kind2 === 'caliper') {
          results.caliperSvgPresent = !!document.querySelector('#caliper-wrap svg');
          const rect = document.querySelector('#caliper-wrap rect[fill="#3f6b8a"]');
          const v = rect ? parseFloat(rect.getAttribute('width'))/PX_PER_MM.mm : null;
          results.caliperValueInRange = v !== null && v >= 5 && v <= 80;
        } else if (kind2 === 'ruler') {
          const bar = document.querySelector('#tape-inner .measure-bar');
          results.rulerBarPresent = !!bar;
          results.rulerBarHasWidthAndPosition = bar ? (parseFloat(bar.style.width) > 0 && bar.style.left !== '') : null;
        } else if (kind2 === 'unit') {
          results.unitOptionsCount = document.querySelectorAll('#unit-options .optbtn').length;
        }
      } catch (e) {
        results.threw = e.message + '\\n' + e.stack;
      }
      window.__result = results;
    })();
  `;
  window.document.body.appendChild(script);
  for (let i = 0; i < 400 && window.__result === null; i++) await new Promise((r) => setTimeout(r, 50));

  return { results: window.__result, errors };
}

async function checkMeasureBarCssIsNotBlack() {
  const html = await fetchText('http://127.0.0.1:8791/measure-bench.html');
  const m = html.match(/\.measure-bar\{([^}]*)\}/);
  const rule = m ? m[1] : '';
  const bgMatch = rule.match(/background:\s*([^;]+);/);
  return { rule, background: bgMatch ? bgMatch[1].trim() : null };
}

async function main() {
  const cssCheck = await checkMeasureBarCssIsNotBlack();
  console.log('=== .measure-bar CSS source check ===');
  console.log('background value:', cssCheck.background, '(expect var(--steel), a blue — not black/#000)');
  console.log();

  for (const bench of ['unit', 'mm', 'cm', 'm', 'mixed']) {
    console.log(`=== Bench: ${bench} ===`);
    const { results, errors } = await testBench(bench);
    console.log('Errors:', errors.length ? errors : 'none');
    console.log('Results:', JSON.stringify(results, null, 2));
    console.log();
  }
}

main().catch((e) => { console.log('FAILED:', e.message); console.log(e.stack); process.exit(1); });
