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

async function main() {
  const html = await fetchText('http://127.0.0.1:8791/index.html');

  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    // Ignore the two expected offline-CDN failures (firebase compat scripts) — everything
    // else is a real error worth failing on.
    if (/firebasejs/.test(e.message)) return;
    errors.push('jsdomError: ' + e.message);
  });

  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:8791/index.html',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      const noop = () => {};
      const fakeCtx = new Proxy({}, {
        get(t, p) {
          if (p === 'measureText') return () => ({ width: 0 });
          if (p === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4) });
          if (typeof p === 'string') return noop;
          return undefined;
        },
        set() { return true; },
      });
      window.HTMLCanvasElement.prototype.getContext = () => fakeCtx;
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(window.performance.now()), 4);
      window.firebase = { initializeApp: noop, database: () => ({ ref: () => ({ once: async () => ({ exists: () => false, val: () => null }) }) }) };
    },
  });
  const { window } = dom;

  await new Promise((resolve) => {
    if (window.document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  await new Promise((r) => setTimeout(r, 40));

  function q(sel) { return window.document.querySelector(sel); }

  console.log('=== Script-boundary smoke test (real <script> tag execution, true document order) ===');
  console.log('Errors after initial load:', errors.length ? errors : 'none');
  console.log('typeof buildStaticSheet:', typeof window.buildStaticSheet);
  console.log('typeof openDojoKiosk:', typeof window.openDojoKiosk);
  console.log('typeof drawDojoMaster:', typeof window.drawDojoMaster);

  // Inject the rest of the driver as a real <script> tag so it shares the page's actual
  // top-level let/const scope (session, scene, player, keys, BUILDING_DEFS, etc. are all
  // real browser semantics — never window properties — same as every prior lesson here).
  window.__smokeResult = null;
  const script = window.document.createElement('script');
  script.textContent = `
    (async () => {
      const results = {};
      const q = (sel) => document.querySelector(sel);
      try {
        q('#demoMode').checked = true;
        q('#demoMode').dispatchEvent(new Event('change'));
        q('#btnEnter').dispatchEvent(new Event('click'));
        await new Promise(r => setTimeout(r, 20));
        results.townScreenHidden = q('#screenTown').classList.contains('hidden');

        const dojoBuilding = BUILDING_DEFS.find(b => b.id === 'dojo');
        const door = buildingDoorTile(dojoBuilding);
        const spawn = placeFeetAtTile(door.c, door.r + 1);
        player.x = spawn.x; player.y = spawn.y;
        scene.mode = 'world'; scene.wasOnDoor = false; scene.buildingId = null;
        keys['arrowup'] = true;
        await new Promise(r => setTimeout(r, 40));
        keys['arrowup'] = false;
        results.enteredDojo = scene.mode === 'interior' && scene.buildingId === 'dojo';

        await new Promise(r => setTimeout(r, 80)); // let several real animation frames run inside the dojo
        results.playerPositionFinite = Number.isFinite(player.x) && Number.isFinite(player.y);

        const beforeX = player.x, beforeY = player.y;
        keys['arrowup'] = true;
        await new Promise(r => setTimeout(r, 120));
        keys['arrowup'] = false;
        results.playerActuallyMoved = player.x !== beforeX || player.y !== beforeY;
        results.wbModalHidden = q('#workbenchModal').classList.contains('hidden');
        results.dojoMasterName = q('#wbTitle') ? q('#wbTitle').textContent : null;
      } catch (e) {
        results.driverThrew = e.message;
      }
      window.__smokeResult = results;
    })();
  `;
  window.document.body.appendChild(script);
  for (let i = 0; i < 60 && window.__smokeResult === null; i++) await new Promise((r) => setTimeout(r, 20));

  console.log('Injected-driver results:', JSON.stringify(window.__smokeResult, null, 2));
  console.log('Errors after the full walk-in-and-approach sequence:', errors.length ? errors : 'none');

  console.log();
  console.log('Final error tally:', errors.length);
  if (errors.length || !window.__smokeResult || window.__smokeResult.driverThrew) {
    console.log(errors);
    process.exitCode = 1;
  } else {
    console.log('=== CLEAN — no script-boundary or runtime errors ===');
  }
  process.exit(process.exitCode || 0);
}

main().catch((e) => { console.log('FAILED:', e.message); console.log(e.stack); process.exitCode = 1; });
