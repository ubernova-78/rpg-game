// art.js — drawing straight from the art packs' own 16px tile sheets (tiles/packs/),
// instead of one hand-cropped PNG per thing: the sheets, "pieces" built from them,
// the RPG Maker autotile rule for ground that blends into ground, and the
// depth-sorted draw that lets the player walk behind a tree top.
//
// Sheet coordinates below are in TILES (16px) on the 1X sheets, as the packs ship
// them: ~/Documents/art-packs/<pack>/RPGMAKER/1X/. The packs' recolor_timefantasy
// copies are a different palette; the game's art is the Elements one.

const ART_SHEETS = {
  // Elements Hometown 6
  hA2: 'tiles/packs/hometown/tileA2.png',
  hA3: 'tiles/packs/hometown/tileA3.png',
  hA1: 'tiles/packs/hometown/tileA1.png',
  hOut: 'tiles/packs/hometown/tileA5_outside.png',
  hInA5: 'tiles/packs/hometown/tileA5_inside.png',
  hBOut: 'tiles/packs/hometown/tileB_outside.png',
  hBTown: 'tiles/packs/hometown/tileB_town.png',
  hDoors1a: 'tiles/packs/hometown/char_doors1a.png',
  // Elements Caves & Mines 6
  cMoss: 'tiles/packs/caves/tileA5_cave2.png',
  cStone: 'tiles/packs/caves/tileA5_cave3.png',
  cB1: 'tiles/packs/caves/tileB_cave1.png',
  cB2: 'tiles/packs/caves/tileB_cave2.png',
};
const SHEET = {};
for (const [k, path] of Object.entries(ART_SHEETS)) SHEET[k] = loadImage(path);

function sheetsReady(keys) {
  return keys.every(k => SHEET[k].complete && SHEET[k].naturalWidth > 0);
}
function whenSheetsLoad(keys, fn) {
  let left = keys.length;
  const done = () => { if (--left === 0) fn(); };
  for (const k of keys) {
    const img = SHEET[k];
    if (img.complete && img.naturalWidth > 0) done();
    // A fresh function each time: the browser drops a second identical listener on
    // the same image, so two keys sharing a file would only ever count once.
    else img.addEventListener('load', () => done(), { once: true });
  }
}

// Copy a w x h block of tiles from a sheet. sx/sy/w/h in tiles; dx/dy in pixels.
function blit(ctx, sheetKey, sx, sy, w, h, dx, dy, scale) {
  const s = scale || 1;
  ctx.drawImage(SHEET[sheetKey], sx * 16, sy * 16, w * 16, h * 16, dx, dy, w * 16 * s, h * 16 * s);
}

// A piece: something drawn from several sheet blocks, composed once into its own
// small canvas at 1x and then drawn like any image. parts are
// [sheet, sx, sy, w, h, atCol, atRow] in tiles, or a function(ctx) for anything
// else (roofs and walls, drawn as autotiles). The canvas gets img-like
// complete/naturalWidth/naturalHeight, so a piece drops in wherever an <img> was
// used (decor, interior objects, buildings) without those call sites changing.
// The size is known up front, so collision footprints are right before it loads.
function makePiece(cols, rows, parts) {
  const c = document.createElement('canvas');
  c.width = cols * 16; c.height = rows * 16;
  c.naturalWidth = c.width; c.naturalHeight = c.height;
  c.complete = false;
  // Function parts may use any sheet, so a piece with one waits for them all.
  const keys = parts.some(p => typeof p === 'function') ? Object.keys(SHEET) : [...new Set(parts.map(p => p[0]))];
  whenSheetsLoad(keys, () => {
    const ctx = c.getContext('2d');
    for (const p of parts) {
      if (typeof p === 'function') { p(ctx); continue; }
      const [k, sx, sy, w, h, ac, ar] = p;
      blit(ctx, k, sx, sy, w, h, ac * 16, ar * 16);
    }
    c.complete = true;
  });
  return c;
}
// One straight block from one sheet.
function sheetPiece(sheetKey, sx, sy, w, h) {
  return makePiece(w, h, [[sheetKey, sx, sy, w, h, 0, 0]]);
}

// ---------- Autotiles (RPG Maker VX "A2" layout) ----------
// Each autotile is a 2x3-tile block: the top-right tile holds the four inner
// corners, and the 2x2 block below is the terrain with its outside edges. Every
// 16px map tile is drawn as four 8px quarters, each picked by whether the
// neighbors on that side, above/below, and diagonally are the same terrain.
// (atCol, atRow) is the block's top-left tile on the sheet.
function drawAutotile(ctx, sheetKey, atCol, atRow, same, dx, dy) {
  // same(dc, dr) -> true if the neighbor at that offset is the same terrain
  const img = SHEET[sheetKey];
  const bx = atCol * 16, by = atRow * 16;
  for (let q = 0; q < 4; q++) {
    const qx = q & 1, qy = q >> 1;
    const hx = qx ? 1 : -1, vy = qy ? 1 : -1;
    const h = same(hx, 0), v = same(0, vy), d = same(hx, vy);
    let sx, sy;
    if (h && v && d) { sx = bx + 8 + qx * 8; sy = by + 16 + 8 + qy * 8; }        // middle
    else if (h && v) { sx = bx + 16 + qx * 8; sy = by + qy * 8; }               // inner corner
    else if (h) { sx = bx + 8 + qx * 8; sy = by + 16 + (qy ? 24 : 0); }         // top/bottom edge
    else if (v) { sx = bx + (qx ? 24 : 0); sy = by + 16 + 8 + qy * 8; }         // left/right edge
    else { sx = bx + (qx ? 24 : 0); sy = by + 16 + (qy ? 24 : 0); }             // outer corner
    ctx.drawImage(img, sx, sy, 8, 8, dx + qx * 8, dy + qy * 8, 8, 8);
  }
}

// The "A3" roof and wall autotiles are 2x2-tile blocks with no inner corners: each
// quarter only asks whether the rectangle carries on beside it and above/below it.
// Fills a w x h tile rectangle at tile (x0, y0) of the canvas.
function drawWallAutotileRect(ctx, sheetKey, atCol, atRow, x0, y0, w, h) {
  const img = SHEET[sheetKey];
  const bx = atCol * 16, by = atRow * 16;
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      for (let q = 0; q < 4; q++) {
        const qx = q & 1, qy = q >> 1;
        const hIn = tx + (qx ? 1 : -1) >= 0 && tx + (qx ? 1 : -1) < w;
        const vIn = ty + (qy ? 1 : -1) >= 0 && ty + (qy ? 1 : -1) < h;
        const cx = hIn ? 1 + qx : (qx ? 3 : 0), cy = vIn ? 1 + qy : (qy ? 3 : 0);
        ctx.drawImage(img, bx + cx * 8, by + cy * 8, 8, 8, (x0 + tx) * 16 + qx * 8, (y0 + ty) * 16 + qy * 8, 8, 8);
      }
    }
  }
}

// A fixed pseudo-random number per tile, so "pick a grass variant" gives the same
// answer every frame and on every Chromebook.
function tileHash(c, r) {
  let h = (c * 374761393 + r * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function pickVariant(list, c, r) {
  // list: [[weight, ...tile]], returns the tile
  const total = list.reduce((s, v) => s + v[0], 0);
  let x = tileHash(c, r) * total;
  for (const v of list) { if ((x -= v[0]) < 0) return v.slice(1); }
  return list[list.length - 1].slice(1);
}

// ---------- Depth-sorted drawing ----------
// Everything that stands up off the ground goes in one list with the y of its
// feet, and is drawn top of the screen first. So a tree whose trunk is south of
// the player draws over them (walking behind the canopy), and one north of them
// draws under. Collision is separate, and only ever on the base.
function drawSorted(items) {
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();
}
