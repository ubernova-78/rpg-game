const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let html = fs.readFileSync(require('path').join(__dirname, '..', 'game', 'place-value-bench.html'), 'utf8');
const placevalueJs = fs.readFileSync(require('path').join(__dirname, '..', 'game', 'placevalue.js'), 'utf8');
html = html
  .replace(/<link[^>]*fonts\.googleapis[^>]*>/g, '')
  .replace(/<link[^>]*fonts\.gstatic[^>]*>/g, '')
  .replace(/<script[^>]*gstatic\.com[^>]*><\/script>/g, '')
  .replace(/<link rel="stylesheet" href="placevalue\.css">/, '') // resources:undefined below never fetches this anyway
  .replace(/<script src="shared-student\.js"><\/script>/, '')
  // resources:undefined (below) never fetches external <script src> tags either — inline
  // the REAL placevalue.js content in its place so this test exercises the actual shared
  // engine, not a stub.
  .replace(/<script src="placevalue\.js"><\/script>/, `<script>${placevalueJs}</script>`);

const verifyScript = `
<script>
let missingZero = 0, allZero = 0;
for (let i = 0; i < 500; i++) {
  S.round = i + 1;
  newProblem();
  const a = S.digits;
  const act = active();
  const inner = act.slice(1, -1);
  if (inner.length && !inner.some(idx => a[idx] === 0)) missingZero++;
  if (act.every(idx => a[idx] === 0)) allZero++;
}
window.__result = { missingZero, allZero, roundsChecked: 500 };

// 'warmup' level (lo:2,hi:4) only asks about ones/tenths/hundredths — but Read It/Build
// It/Pull It Out should always show all 6 boxes/rows/tiles regardless, so the count
// itself never tells the student which places are actually in play this round.
S.level = 'warmup';
// newProblem() itself sets S.mode from S.round (cycling read/build/pull/point) — set
// S.round to land on the mode being tested rather than assigning S.mode directly, or
// newProblem() immediately overwrites it back.
S.round = 1; // -> 'read' (now renders through #pvEngineHost via the shared engine)
newProblem();
const readBoxes = document.querySelectorAll('#pvEngineHost .pv-box');
window.__readAllSixEnabled = readBoxes.length === 6 && [...readBoxes].every(b => !b.disabled);

S.round = 2; // -> 'build' (also through #pvEngineHost)
newProblem();
const buildRows = document.querySelectorAll('#pvEngineHost .pv-step-row');
window.__buildAllSixRows = buildRows.length === 6;

S.round = 3; // -> 'pull' (still the legacy #tray path, untouched by the shared-engine work)
newProblem();
const supplyTiles = document.querySelectorAll('#tray .supply-tile');
window.__pullAllSixTiles = supplyTiles.length === 6;

// Leaving the out-of-scope boxes blank (hundreds/tens/thousandths at 'warmup') should
// still be accepted — only the in-scope ones (ones/tenths/hundredths) need real digits.
// Read It's Check It button is created fresh by the shared engine each render, so look
// it up after newProblem() rather than assuming a fixed id.
function pvCheckBtn() {
  return [...document.querySelectorAll('#pvEngineHost button')].find(b => b.textContent === 'Check it');
}
S.round = 1; // -> 'read'
newProblem();
[...document.querySelectorAll('#pvEngineHost .pv-box')].forEach((box, i) => { box.value = String(S.digits[i]); });
pvCheckBtn().dispatchEvent(new Event('click'));
window.__readAcceptsBlankOutOfScope = S.solved === true;

// Typing a wrong non-zero digit into an out-of-scope box should still be rejected.
S.round = 1;
newProblem();
const boxes2 = [...document.querySelectorAll('#pvEngineHost .pv-box')];
boxes2.forEach((box, i) => { box.value = String(S.digits[i]); });
const outOfScope = [0,1,2,3,4,5].find(i => !S.active.includes(i));
boxes2[outOfScope].value = '9';
pvCheckBtn().dispatchEvent(new Event('click'));
window.__readRejectsWrongDigitOutOfScope = S.solved !== true;
</script>
`;
html = html + verifyScript;

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => { console.log('JSDOM ERROR:', e.message); });

const dom = new JSDOM(html, {
  url: 'http://localhost/place-value-bench.html',
  runScripts: 'dangerously',
  resources: undefined,
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) {
    window.Shared = {
      loadOrCreateStudent: async () => ({ ok: false, error: 'stub' }),
      saveStudent: async () => {},
      getLevelInfo: () => ({ level: 1, floor: 0, nextReq: 100, progress: 0 }),
      loadLeaderboardByPeriod: async () => [],
      DB_OK: false,
    };
    window.requestAnimationFrame = () => 0;
  },
});

const result = dom.window.__result;
if (!result) {
  console.log('FAILED: verification script did not run (window.__result is undefined)');
  process.exit(1);
}
console.log('Workbench: rounds missing an interior zero over', result.roundsChecked, 'runs (expect 0):', result.missingZero);
console.log('Workbench: rounds that were all-zero over', result.roundsChecked, 'runs (expect 0):', result.allZero);

console.log();
console.log('Workbench: Read It always shows 6 boxes, all enabled, even at "warmup" level:', dom.window.__readAllSixEnabled);
console.log('Workbench: Build It always shows 6 stepper rows, even at "warmup" level:', dom.window.__buildAllSixRows);
console.log('Workbench: Pull It Out always offers 6 supply tiles, even at "warmup" level:', dom.window.__pullAllSixTiles);
console.log('Workbench: leaving out-of-scope Read It boxes blank is accepted as correct:', dom.window.__readAcceptsBlankOutOfScope);
console.log('Workbench: a wrong non-zero digit in an out-of-scope box is still rejected:', dom.window.__readRejectsWrongDigitOutOfScope);
