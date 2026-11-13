// world.js — camera, tile/biome rendering, decor, buildings, interior room definitions and furniture, player object, and movement/collision helpers.

const TILE_NATIVE = 16;
const SCALE = 3;
const TILE = TILE_NATIVE * SCALE; // 48
const mapCanvas = document.getElementById('mapCanvas');
const mapCtx = mapCanvas.getContext('2d');
mapCtx.imageSmoothingEnabled = false;
const VIEWPORT_COLS = mapCanvas.width / TILE;
const VIEWPORT_ROWS = mapCanvas.height / TILE;


// The world is bigger than the screen, so the camera follows the player. It's drawn
// from WORLD_MAP below: one character per 16px tile of ground, so the layout can be
// read (and changed) at a glance. Buildings, trees and props stand on top of it.
//
// Rebuilt 2026-11-05 from the art packs (Nick asked for the town to look better and
// spread out). The old layout was a 15x10 town placed at an offset; nothing outside
// this file used its numbers except NPC and monster homes, which now come from
// WORLD_SPOTS so they move with the map.
const WORLD_COLS = 64, WORLD_ROWS = 48;

// Ground:  .  grass      d  rocky dirt (the west)    =  dirt path
//          #  cobbled street or plaza                 ~  lake
// Dirt, paths and streets blend into the grass at their edges (autotiles, art.js).
const WORLD_MAP = [
  'ddddddddddddd...................................................',
  'd...ddddddddd..............~~~~~~~~~~~~.........................',
  '.....dddddddd.........~~~~~~~~.....~~~~~~.......................',
  '.....dddddddd........~~~~~~~~.......~~~~~~~~....................',
  '.....ddddddddd......~~~~~~~~~.......~~~~~~~~~...................',
  'd...ddddddddd.......~~~~~~~~~.......~~~~~~~~~...................',
  'ddddddd...d..........~~~~~~~~~.....~~~~~~~~~....................',
  'ddddddd...d...........~~~~~~~~~~~~~~~~~~~.......................',
  'ddddddd...d...............~~~~~~~~~~~~~.........................',
  'dddddddddd......................................................',
  'dddddddddd.....................##...............................',
  'dddddddddddd...................##...............................',
  'd...ddddddddd..................##...............................',
  'd...ddddddddd.............############..........................',
  'd...ddddddddd............##############.........................',
  'dddddddddddddd...........##############.........................',
  'ddddddddddddd............##############.........................',
  'ddddddd==dd..............##############.........................',
  'ddddddd==dd..............##############.........................',
  'ddddddd==dd.........#....##############......#..................',
  'ddddddd==d..........#.....############.......#..................',
  'ddddddd======######################################======.......',
  'ddddddd======######################################======.......',
  'ddddddddddddd..................##...............................',
  'dddddddddddd...................##...............................',
  '...dddddddddd..................##...............................',
  '....dddddddddd.................##...............................',
  '....ddddd...d..................##...............................',
  '....ddddd......................##...............................',
  '...dddddd..........#.......#...##.....#........#................',
  'dddddddddddd...#####################################............',
  'dddddd.ddd.....#####################################............',
  'ddddd...dd.....................==...............................',
  'dddd.....dd....................==...............................',
  'ddddd...dddd...................==...............................',
  'dddddd.ddddd...................==...............................',
  'ddddddddddddd..................==...............................',
  'dddddddddddddd.................==...............................',
  'dddddddddddddd.................==...............................',
  'dd...ddddddd...................==...............................',
  'd.....dddddd...................==...............................',
  'd.....dddddd....................................................',
  'd.....dddd......................................................',
  'dd...ddddd......................................................',
  'dddddddd........................................................',
  'dddddddd...d....................................................',
  'dddddddd...d....................................................',
  'dddddddddddd....................................................',
];


const camera = { x: 0, y: 0 };
function updateCamera() {
  const spriteSize = FRAME * SCALE;
  // The witch's flashback pans the camera to the island and back (lake-quest.js).
  const focus = typeof lakeCutsceneFocus === 'function' ? lakeCutsceneFocus() : null;
  const targetX = (focus ? focus.x : player.x + spriteSize / 2) - mapCanvas.width / 2;
  const targetY = (focus ? focus.y : player.y + spriteSize / 2) - mapCanvas.height / 2;
  camera.x = Math.max(0, Math.min(WORLD_COLS * TILE - mapCanvas.width, targetX));
  camera.y = Math.max(0, Math.min(WORLD_ROWS * TILE - mapCanvas.height, targetY));
}

const floorImg = loadImage('tiles/floor_interior.png');
const workbenchImg = loadImage('tiles/workbench.png');
const bedImg = loadImage('tiles/home/bed.png');
const closetImg = loadImage('tiles/home/closet.png');
const mirrorImg = loadImage('tiles/home/mirror.png');
const kitchenImg = loadImage('tiles/home/kitchen_counter.png');
const backpackImg = loadImage('tiles/home/backpack_stub.png');
const caveFloorImg = loadImage('tiles/cave_floor.png');
const chestImg = loadImage('tiles/chest.png');
const boulderImg = loadImage('tiles/decor/boulder.png');

function groundAt(c, r) {
  if (r < 0 || r >= WORLD_ROWS || c < 0 || c >= WORLD_COLS) return null;
  return WORLD_MAP[r][c];
}
function isWaterTile(c, r) { return groundAt(c, r) === '~'; }
const isDirtGround = ch => ch === 'd' || ch === '=';

// Where people and monsters live, and where things that must stay clear are. NPCs and
// monsters wander a box of +/-range tiles round their spot and walk through anything,
// so the scatter below keeps trees out of every box, and no box may touch a building
// or the Rune Circle (validateWorld checks the buildings).
const WORLD_SPOTS = {
  spawn: [31, 19],                  // the plaza, just south of the statue
  witch: [33, 21, 0],               // the town square, on the paving just below the spawn (stands still; at 34,17 she stood on a bench), in view from the spawn: tells the Lake Quest's story
  ranger: [54, 18, 2], lakeWatcher: [27, 11, 2], warden: [2, 20, 2], fieldGuide: [35, 34, 2],
  shop: [27, 15, 1], potionMaster: [57, 22, 2], woodsman: [55, 26, 2],
  pinecoon: [54, 12, 3], meadowWasp: [15, 36, 3], grassSnake: [46, 37, 3],
};
const CLEARING = { col: 57, row: 23, r: 5 }; // the Potion Master's glade in the east forest
// The Lake Quest (lake-quest.js): the Boatwright's Hut on the north-west shore, where
// you design a boat at the desk; its dock just east of the hut; and the island in the
// middle of the lake with the altar. Walking can't reach the island (water is solid):
// your boat rows you across row 5, about 8 tiles of open water, from the dock to the
// island's west landing. (The first dock, on the south shore, was 2 tiles from the
// island: too short a crossing to row, 2026-11-13.)
const LAKE = {
  altar: { col: 32, row: 3 },        // the pedestal's base tile (solid)
  altarFront: { col: 32, row: 4 },
  landing: { col: 29, row: 5 },      // the island's west edge: step off / get in here
  dock: { col: 19, row: 5 },         // the west shore beside the hut: get in here
  pier: { col: 20, row: 5 },         // the pier's planks: a water tile you can walk on
  row: 5,                            // the crossing runs along this row
  shoreEdge: 21,                     // the boat moors just past the pier's end
  islandEdge: 29,                    // first island column
};
const LAKE_SOLID = new Set([`${LAKE.altar.col},${LAKE.altar.row}`]);

// ---------- Props (Hometown pack, tileB_outside / tileB_town) ----------
// solid: tiles that block, as [dc, dr] from the base tile (the bottom-middle tile the
// art stands on). Only the base -- a trunk, a lamp foot -- ever blocks, so the player
// walks behind tree tops and roofs of things. flat: drawn under everyone.
const PROP = {
  pine:     { img: sheetPiece('hBOut', 8, 7, 3, 5), solid: [[0, 0]] },
  bigTree:  { img: sheetPiece('hBOut', 11, 7, 3, 5), solid: [[-1, 0], [0, 0], [1, 0]] },
  thinTree: { img: sheetPiece('hBOut', 14, 7, 2, 3), solid: [[0, 0]] },
  sapling:  { img: sheetPiece('hBOut', 14, 10, 1, 2), solid: [[0, 0]] },
  sapling2: { img: sheetPiece('hBOut', 15, 10, 1, 2), solid: [[0, 0]] },
  bush:     { img: sheetPiece('hBOut', 0, 15, 1, 1), solid: [[0, 0]] },
  bushes:   { img: sheetPiece('hBOut', 4, 15, 2, 1), solid: [[0, 0]] },
  berryHedge: { img: sheetPiece('hBOut', 8, 0, 2, 2), solid: [[0, 0]] },
  tallGrass: { img: sheetPiece('hBOut', 14, 3, 2, 2), solid: [] },
  greyRock: { img: sheetPiece('hBOut', 4, 8, 2, 1), solid: [[0, 0]] },
  brownRock: { img: sheetPiece('hBOut', 6, 8, 2, 1), solid: [[0, 0]] },
  stump:    { img: sheetPiece('hBOut', 6, 15, 1, 1), solid: [[0, 0]] },
  pebbles:  { img: sheetPiece('hBOut', 0, 9, 1, 1), flat: true },
  pebbles2: { img: sheetPiece('hBOut', 5, 9, 1, 1), flat: true },
  flowersW: { img: sheetPiece('hBOut', 4, 6, 1, 1), flat: true },
  flowersP: { img: sheetPiece('hBOut', 8, 6, 1, 1), flat: true },
  flowersP2: { img: sheetPiece('hBOut', 9, 6, 1, 1), flat: true },
  flowersY: { img: sheetPiece('hBOut', 6, 6, 1, 1), flat: true },
  flowersB: { img: sheetPiece('hBOut', 5, 7, 1, 1), flat: true },
  fence:    { img: sheetPiece('hBOut', 0, 3, 3, 1), solid: [[-1, 0], [0, 0], [1, 0]] },
  lamp:     { img: sheetPiece('hBTown', 5, 6, 1, 3), solid: [[0, 0]] },
  statue:   { img: sheetPiece('hBTown', 8, 8, 3, 3), solid: [[-1, 0], [0, 0], [1, 0], [-1, -1], [0, -1], [1, -1]] },
  well:     { img: sheetPiece('hBTown', 11, 8, 3, 3), solid: [[-1, 0], [0, 0], [1, 0]] },
  bench:    { img: sheetPiece('hBTown', 0, 12, 3, 2), solid: [[-1, 0], [0, 0], [1, 0]] },
  planter:  { img: sheetPiece('hBTown', 4, 9, 2, 2), solid: [[0, 0]] },
  crates:   { img: sheetPiece('hBTown', 0, 6, 2, 3), solid: [[0, 0]] },
  barrel:   { img: sheetPiece('hBTown', 3, 7, 1, 2), solid: [[0, 0]] },
  signpost: { img: sheetPiece('hBOut', 0, 1, 1, 1), solid: [[0, 0]] },
};
const DECOR_DEFS = [];
function addProp(kind, c, r) {
  const p = PROP[kind];
  DECOR_DEFS.push({ img: p.img, baseCol: c, baseRow: r, kind, flat: !!p.flat, solidTiles: (p.solid || []).map(([dc, dr]) => [c + dc, r + dr]) });
}

// The town, placed by hand: lamps along the streets, the plaza's statue, well, market
// corner and benches, and planters and flowers by the doors.
[
  ['statue', 31, 17], ['well', 36, 16], ['bench', 28, 19], ['bench', 35, 19],
  ['crates', 25, 16], ['barrel', 26, 14], ['planter', 29, 13], ['planter', 34, 13],
  ['lamp', 24, 20], ['lamp', 39, 20], ['lamp', 24, 13], ['lamp', 39, 13],
  ['lamp', 14, 20], ['lamp', 30, 23], ['lamp', 33, 23], ['lamp', 49, 20],
  ['lamp', 14, 29], ['lamp', 30, 32], ['lamp', 33, 32], ['lamp', 50, 29],
  ['planter', 18, 19], ['planter', 22, 19], ['planter', 43, 19], ['planter', 47, 19],
  ['flowersP', 17, 20], ['flowersW', 23, 20], ['flowersY', 42, 20], ['flowersP2', 48, 20],
  ['berryHedge', 16, 15], ['berryHedge', 16, 17], ['thinTree', 25, 11], ['thinTree', 38, 11],
  ['fence', 18, 12], ['fence', 21, 12], ['bushes', 24, 15],
  ['flowersW', 18, 29], ['flowersP', 20, 29], ['flowersY', 26, 29], ['flowersB', 28, 29],
  ['flowersP2', 37, 29], ['flowersW', 39, 29], ['flowersY', 46, 29], ['flowersP', 48, 29],
  ['thinTree', 23, 26], ['thinTree', 43, 25], ['sapling', 33, 26], ['bush', 23, 28], ['bush', 43, 28],
  ['signpost', 30, 33], ['signpost', 9, 20], ['signpost', 50, 23],
  ['tallGrass', 12, 19], ['greyRock', 11, 24],
].forEach(([k, c, r]) => addProp(k, c, r));

// ---------- Buildings ----------
// Each is drawn from the pack: a roof and a wall (A3 autotiles), a front gable over the
// door, windows, a chimney and a shop sign. Doors face south and the door tile is the
// building's bottom-middle tile: the walkable trigger. tilesWide is always odd so the
// door sits dead center. Roof/wall/gable are sheet tiles (see buildingPiece).
const ROOF = { brown: [0, 0], yellow: [2, 0], green: [4, 0], red: [6, 0], blue: [8, 0], dark: [10, 0] };
const WALL = { stone: [0, 2], stoneTrim: [2, 2], brick: [8, 2], plaster: [0, 6], timber: [4, 6], wood: [8, 6], darkWood: [12, 6] };
const GABLE = { brown: [8, 0], yellow: [11, 0], green: [8, 3], red: [11, 3] };
const SIGN = { sword: [3, 0], shield: [4, 0], bag: [5, 0], bed: [6, 0], jug: [7, 0] };
function buildingPiece(spec) {
  const { w, roofRows: rh, wallRows: wh } = spec;
  const mid = (w - 1) / 2;
  const parts = [
    ctx => drawWallAutotileRect(ctx, 'hA3', ...ROOF[spec.roof], 0, 0, w, rh),
    ctx => drawWallAutotileRect(ctx, 'hA3', ...WALL[spec.wall], 0, rh, w, wh),
    ['hBTown', 14, 0, 1, 2, 1, 0], // chimney
  ];
  if (spec.gable) parts.push(['hBTown', ...GABLE[spec.gable], 3, 2, mid - 1, rh - 2]);
  parts.push(['hDoors1a', 1, 0, 1, 2, mid, rh + wh - 2]);
  const winRow = rh + wh - 2;
  for (const c of (w >= 9 ? [1, 2, w - 3, w - 2] : [1, w - 2])) parts.push(['hBTown', 14, 6, 1, 1, c, winRow]);
  if (spec.sign) parts.push(['hBTown', ...SIGN[spec.sign], 1, 1, mid + 1, winRow]);
  return makePiece(w, rh + wh, parts);
}
const BUILDING_DEFS = [];
function addBuilding(id, name, tileX, tileY, spec, img) {
  const tall = spec.roofRows + spec.wallRows;
  BUILDING_DEFS.push({
    id, name, label: name, img: img || buildingPiece(spec),
    tileX, tileY, tilesWide: spec.w, tilesTall: tall, doorCol: (spec.w - 1) / 2, doorRow: tall - 1,
    roofRows: spec.roofRows, // the name's signboard hangs on the wall just under the roof (gameplay.js)
  });
}
// North of the main street, doors onto it:
addBuilding('home', 'Home', 17, 14, { w: 7, roofRows: 3, wallRows: 2, roof: 'green', wall: 'plaster', gable: 'green', sign: 'bed' });
addBuilding('red', 'Measure Distance Workshop', 41, 13, { w: 9, roofRows: 3, wallRows: 3, roof: 'red', wall: 'brick', gable: 'red', sign: 'shield' });
// South of it, doors onto the south street:
addBuilding('blue', 'Place Value Workshop', 16, 24, { w: 7, roofRows: 3, wallRows: 2, roof: 'blue', wall: 'stone', sign: 'bag' });
addBuilding('elapsed', 'Elapsed Time Workshop', 24, 24, { w: 7, roofRows: 3, wallRows: 2, roof: 'yellow', wall: 'wood', gable: 'yellow' });
addBuilding('mvd', 'Mass, Volume & Density Workshop', 34, 24, { w: 9, roofRows: 3, wallRows: 2, roof: 'brown', wall: 'stoneTrim', gable: 'brown', sign: 'jug' });
addBuilding('dojo', 'Dojo', 44, 24, { w: 7, roofRows: 3, wallRows: 2, roof: 'dark', wall: 'darkWood', sign: 'sword' });
// By the lake, its dock just east: the Lake Quest's drafting desk (lake-quest.js).
addBuilding('boathouse', "Boatwright's Hut", 14, 3, { w: 5, roofRows: 3, wallRows: 2, roof: 'brown', wall: 'wood' });

// The cave sits out in the rocky west. It's a grassy hill with the cave mouth in its
// face (Hometown pack's A5 outside sheet), 7x5; the door is the bottom of the mouth.
const CAVE_COL = 4, CAVE_ROW = 12;
const CAVE_HILL_IMG = (() => {
  const parts = [];
  const row = (r, left, mid, right, mouth) => {
    parts.push(['hOut', left[0], left[1], 1, 1, 0, r]);
    for (let c = 1; c <= 5; c++) {
      const t = (mouth && c === 3) ? mouth : mid;
      parts.push(['hOut', t[0], t[1], 1, 1, c, r]);
    }
    parts.push(['hOut', right[0], right[1], 1, 1, 6, r]);
  };
  row(0, [1, 5], [2, 5], [3, 5]);
  row(1, [1, 6], [1, 0], [3, 6]);
  row(2, [1, 7], [2, 7], [3, 7]);
  row(3, [1, 8], [2, 8], [3, 8], [4, 11]);
  row(4, [1, 10], [2, 10], [3, 10], [4, 12]);
  return makePiece(7, 5, parts);
})();
addBuilding('cave', 'Mystic Cave', CAVE_COL, CAVE_ROW, { w: 7, roofRows: 3, wallRows: 2 }, CAVE_HILL_IMG);
BUILDING_DEFS.find(b => b.id === 'cave').name = 'Cave';

// ---------- Rune Circle (south meadow) ----------
// A stake with three standing stones around it. Students hook a tape on the stake,
// walk to each rune, read the tape, then average the three (rune-circle.js).
//
// Every student gets the same three distances: each is the straight-line distance
// between tile centers at 2 m per tile, rounded to the centimeter, so a rune that
// looks farther away really does read longer. From this layout:
//   Rune 1 (5 E, 2 N)  = 2*sqrt(29) = 10.77 m
//   Rune 2 (6 W, 2 N)  = 2*sqrt(40) = 12.65 m
//   Rune 3 (1 W, 3 S)  = 2*sqrt(10) =  6.32 m
//   average 29.74 / 3 = 9.9133...  ->  9.91 m
// Moving a stone changes the answer key; the comment above is the only other place
// these numbers live. Moving the whole circle (as the 2026-11-05 rebuild did) doesn't:
// only the stones' offsets from the stake count.
const RUNE_CIRCLE = {
  stake: { col: 31, row: 41 },
  metersPerTile: 2,
  runes: [
    { n: 1, col: 36, row: 39 },
    { n: 2, col: 25, row: 39 },
    { n: 3, col: 30, row: 44 },
  ],
};
for (const rune of RUNE_CIRCLE.runes) {
  const dc = rune.col - RUNE_CIRCLE.stake.col, dr = rune.row - RUNE_CIRCLE.stake.row;
  rune.hundredths = Math.round(Math.hypot(dc, dr) * RUNE_CIRCLE.metersPerTile * 100);
}
const RUNE_SOLID = new Set(RUNE_CIRCLE.runes.map(r => `${r.col},${r.row}`));

// ---------- Trees and rocks, scattered ----------
// A jittered grid, the same on every machine (tileHash), with every candidate thrown
// out if it would land on or beside ground that isn't grass (or dirt, in the west), in
// a building or the strip in front of it, in someone's wander box, in the glade, or in
// the Rune Circle. That's what keeps a tree off a path or a doorstep.
const keepClear = [];   // [c0, r0, c1, r1] tile boxes
for (const b of BUILDING_DEFS) keepClear.push([b.tileX - 1, b.tileY - 1, b.tileX + b.tilesWide, b.tileY + b.tilesTall + 1]);
for (const [c, r, range] of Object.values(WORLD_SPOTS)) { const k = (range || 0) + 1; keepClear.push([c - k, r - k, c + k, r + k]); }
keepClear.push([RUNE_CIRCLE.stake.col - 8, RUNE_CIRCLE.stake.row - 4, RUNE_CIRCLE.stake.col + 7, RUNE_CIRCLE.stake.row + 4]);
keepClear.push([13, 2, LAKE.dock.col + 1, 11], [28, 1, 36, 7]); // the hut, its dock and the walk down to them; the island
const inKeepClear = (c, r) => keepClear.some(([c0, r0, c1, r1]) => c >= c0 && c <= c1 && r >= r0 && r <= r1);
const inClearing = (c, r) => (c - CLEARING.col) ** 2 + (r - CLEARING.row) ** 2 <= CLEARING.r ** 2;
function groundAround(c, r, ok) {
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const g = groundAt(c + dc, r + dr);
    if (g !== null && !ok(g)) return false;
  }
  return true;
}
const takenBase = new Set(DECOR_DEFS.map(d => `${d.baseCol},${d.baseRow}`));
function scatter(zone, step, pick, groundOk) {
  for (let r = 0; r < WORLD_ROWS; r += step) {
    for (let c = 0; c < WORLD_COLS; c += step) {
      const cc = c + Math.floor(tileHash(c, r) * step), rr = r + Math.floor(tileHash(r + 99, c) * step);
      if (cc >= WORLD_COLS || rr >= WORLD_ROWS || !zone(cc, rr)) continue;
      if (inKeepClear(cc, rr) || inClearing(cc, rr) || takenBase.has(`${cc},${rr}`)) continue;
      if (!groundAround(cc, rr, groundOk)) continue;
      const kind = pick(tileHash(cc * 7, rr * 13));
      if (!kind) continue;
      takenBase.add(`${cc},${rr}`);
      addProp(kind, cc, rr);
    }
  }
}
const grassOnly = g => g === '.';
// The east forest, the woods north-east of the lake, and a strip north-west of it:
// dense, mostly pines, some big broad trees.
scatter((c, r) => c >= 52 || (c >= 45 && r <= 11) || (c >= 13 && c <= 19 && r <= 11),
  2, x => x < 0.62 ? 'pine' : x < 0.84 ? 'bigTree' : x < 0.94 ? 'thinTree' : 'sapling', grassOnly);
// A ring of trees round the glade, so it reads as a clearing.
for (let i = 0; i < 12; i++) {
  const a = i / 12 * Math.PI * 2;
  const c = Math.round(CLEARING.col + Math.cos(a) * (CLEARING.r + 1)), r = Math.round(CLEARING.row + Math.sin(a) * (CLEARING.r + 1));
  if (!inKeepClear(c, r) && groundAround(c, r, grassOnly) && !takenBase.has(`${c},${r}`)) { takenBase.add(`${c},${r}`); addProp(i % 3 ? 'pine' : 'bigTree', c, r); }
}
// The rocky west: boulders, a few hardy pines, loose stones.
scatter((c, r) => groundAt(c, r) === 'd', 2,
  x => x < 0.14 ? 'greyRock' : x < 0.22 ? 'brownRock' : x < 0.3 ? 'pine' : x < 0.38 ? 'stump' : x < 0.5 ? 'pebbles' : x < 0.6 ? 'pebbles2' : null, isDirtGround);
// ...and its grassy hollows: trees and bushes, so the patches read as shelter.
scatter((c, r) => c <= 13 && groundAt(c, r) === '.', 2,
  x => x < 0.3 ? 'pine' : x < 0.42 ? 'bigTree' : x < 0.6 ? 'bush' : x < 0.75 ? 'tallGrass' : null, grassOnly);
// The south meadow: flowers everywhere, the odd tree near its edges.
scatter((c, r) => r >= 33 && c >= 13, 3,
  x => x < 0.18 ? 'flowersW' : x < 0.32 ? 'flowersP' : x < 0.44 ? 'flowersY' : x < 0.52 ? 'flowersB' : x < 0.58 ? 'tallGrass' : null, grassOnly);
scatter((c, r) => (r >= 44 || c >= 49) && r >= 33 && c >= 13, 3,
  x => x < 0.4 ? 'thinTree' : x < 0.6 ? 'bigTree' : x < 0.75 ? 'bush' : null, grassOnly);
// Along the lake shore and the town's grass edges.
scatter((c, r) => r >= 9 && r <= 12 && c >= 20 && c <= 44, 3, x => x < 0.3 ? 'bush' : x < 0.5 ? 'flowersW' : null, grassOnly);

function decorSolidTiles() {
  const set = new Set();
  for (const d of DECOR_DEFS) for (const [c, r] of d.solidTiles) set.add(`${c},${r}`);
  return set;
}
const DECOR_SOLID = decorSolidTiles();

function buildingDoorTile(b) {
  return { c: b.tileX + b.doorCol, r: b.tileY + b.doorRow };
}
function isSolidBuildingTile(c, r) {
  for (const b of BUILDING_DEFS) {
    const door = buildingDoorTile(b);
    if (c === door.c && r === door.r) continue; // door tile itself isn't solid, it's a trigger
    if (c >= b.tileX && c < b.tileX + b.tilesWide && r >= b.tileY && r < b.tileY + b.tilesTall) {
      return true;
    }
  }
  if (DECOR_SOLID.has(`${c},${r}`)) return true;
  if (RUNE_SOLID.has(`${c},${r}`)) return true;
  if (LAKE_SOLID.has(`${c},${r}`)) return true;
  if (isWaterTile(c, r) && !(c === LAKE.pier.col && r === LAKE.pier.row)) return true;
  return false;
}
function doorAt(c, r) {
  for (const b of BUILDING_DEFS) {
    const door = buildingDoorTile(b);
    if (door.c === c && door.r === r) return b;
  }
  return null;
}

// ---------- Ground ----------
// The whole map's ground, drawn once into three canvases (one per frame of the lake's
// ripple) and then copied to the screen each frame: grass picked from the sheet's
// variants, with dirt, streets and water laid over it as autotiles.
const GRASS_VARIANTS = [[40, 1, 0], [30, 2, 0], [30, 3, 0], [22, 4, 0], [22, 5, 0], [12, 6, 0], [12, 7, 0],
  [2, 1, 1], [2, 3, 1], [2, 5, 1], [3, 1, 2], [2, 3, 2]];
const GROUND_SHEETS = ['hOut', 'hA2', 'hA1'];
const WATER_FRAMES = [0, 1, 2, 1];
const groundFrames = [];
function buildGround() {
  if (groundFrames.length) return groundFrames;
  if (!sheetsReady(GROUND_SHEETS)) return null;
  const sameAs = (col, r, test) => (dc, dr) => { const n = groundAt(col + dc, r + dr); return n === null || test(n); };
  for (let f = 0; f < 3; f++) {
    const cv = document.createElement('canvas');
    cv.width = WORLD_COLS * 16; cv.height = WORLD_ROWS * 16;
    const ctx = cv.getContext('2d');
    for (let r = 0; r < WORLD_ROWS; r++) {
      for (let col = 0; col < WORLD_COLS; col++) {
        const x = col * 16, y = r * 16;
        const [sx, sy] = pickVariant(GRASS_VARIANTS, col, r);
        blit(ctx, 'hOut', sx, sy, 1, 1, x, y);
        const g = WORLD_MAP[r][col];
        if (isDirtGround(g)) drawAutotile(ctx, 'hA2', 2, 0, sameAs(col, r, isDirtGround), x, y);
        else if (g === '#') drawAutotile(ctx, 'hA2', 6, 0, sameAs(col, r, n => n === '#'), x, y);
        else if (g === '~') drawAutotile(ctx, 'hA1', f * 2, 3, sameAs(col, r, n => n === '~'), x, y);
      }
    }
    groundFrames.push(cv);
  }
  return groundFrames;
}
function drawGround() {
  const frames = buildGround();
  if (!frames) return;
  const img = frames[WATER_FRAMES[Math.floor(Date.now() / 500) % WATER_FRAMES.length]];
  // Copy from a whole source pixel and shift the result, so the ground moves in step
  // with the sprites instead of snapping every 3 screen pixels.
  const sx = Math.floor(camera.x / SCALE), sy = Math.floor(camera.y / SCALE);
  const sw = Math.ceil(mapCanvas.width / SCALE) + 1, sh = Math.ceil(mapCanvas.height / SCALE) + 1;
  mapCtx.drawImage(img, sx, sy, sw, sh, sx * SCALE - camera.x, sy * SCALE - camera.y, sw * SCALE, sh * SCALE);
}

// ---------- Checks ----------
// Every door, person and the Rune Circle must be reachable on foot from the spawn, and
// no building may sit on water or another building, nor any wander box on a building.
// Failures go to the console as errors; nothing here changes the map.
(function validateWorld() {
  const key = (c, r) => `${c},${r}`;
  const seen = new Set([key(...WORLD_SPOTS.spawn)]);
  const queue = [WORLD_SPOTS.spawn];
  while (queue.length) {
    const [c, r] = queue.shift();
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= WORLD_COLS || nr >= WORLD_ROWS || seen.has(key(nc, nr))) continue;
      if (isSolidBuildingTile(nc, nr)) continue;
      seen.add(key(nc, nr)); queue.push([nc, nr]);
    }
  }
  const problems = [];
  for (const b of BUILDING_DEFS) {
    const d = buildingDoorTile(b);
    if (!seen.has(key(d.c, d.r))) problems.push(`${b.id}'s door (${d.c},${d.r}) can't be reached`);
    for (let r = b.tileY; r < b.tileY + b.tilesTall; r++) for (let c = b.tileX; c < b.tileX + b.tilesWide; c++) {
      if (isWaterTile(c, r)) problems.push(`${b.id} stands in the lake at (${c},${r})`);
      for (const o of BUILDING_DEFS) if (o !== b && c >= o.tileX && c < o.tileX + o.tilesWide && r >= o.tileY && r < o.tileY + o.tilesTall) problems.push(`${b.id} overlaps ${o.id}`);
    }
  }
  for (const [name, [c, r, range]] of Object.entries(WORLD_SPOTS)) {
    if (!seen.has(key(c, r))) problems.push(`spot ${name} (${c},${r}) can't be reached`);
    const k = range || 0;
    for (const b of BUILDING_DEFS) {
      if (c + k + 1 > b.tileX && c - k < b.tileX + b.tilesWide && r + k + 1 > b.tileY && r - k < b.tileY + b.tilesTall) problems.push(`spot ${name}'s wander box touches ${b.id}`);
    }
  }
  const st = RUNE_CIRCLE.stake;
  if (!seen.has(key(st.col, st.row + 1)) && !seen.has(key(st.col, st.row - 1))) problems.push('the Rune Circle stake can\'t be reached');
  for (const rn of RUNE_CIRCLE.runes) if (![[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dc, dr]) => seen.has(key(rn.col + dc, rn.row + dr)))) problems.push(`rune ${rn.n} can't be reached`);
  if (problems.length) console.error('[world] map problems:\n  ' + [...new Set(problems)].join('\n  '));
})();


// ---------- Scene state ----------
const scene = {
  mode: 'world',          // 'world' | 'interior'
  buildingId: null,
  returnPos: null,        // {x,y} to restore in world scene on exit
  modalOpen: false,
  wasOnDoor: false,       // edge-detection: only fire a trigger on entering the zone,
  wasOnExit: false,       // not on every frame you're still standing in it
  wasOnNpcId: null,       // same idea, for NPC dialogue proximity
  wasOnMonsterId: null,   // same idea, for wandering-monster battle triggers
  wasOnCaveMonsterId: null, // same idea, for the cave's own wandering monsters
  wasOnDojoMaster: false,   // same idea, for the Dojo Master's battle-menu prompt
  activeObjectId: null,   // id of the interactive object tile currently under the player, or null
};

// Each building's interior room size. Home is deliberately roomier than the others —
// it has to fit a bed, closet+mirror, kitchen counter, and storage bench without feeling cramped.
const INTERIOR_SIZES = {
  red: { cols: 33, rows: 10 },
  blue: { cols: 9, rows: 7 },
  home: { cols: 13, rows: 10 },
  cave: { cols: 11, rows: 9 },
  caveDeep: { cols: 11, rows: 9 },
  dojo: { cols: 13, rows: 10 },
  elapsed: { cols: 9, rows: 7 },
  mvd: { cols: 17, rows: 7 },
  boathouse: { cols: 9, rows: 7 },
};
const INTERIOR_FLOORS = { red: floorImg, blue: floorImg, home: floorImg, cave: caveFloorImg, caveDeep: caveFloorImg, dojo: floorImg, elapsed: floorImg, mvd: floorImg, boathouse: floorImg };
// A light, warm overlay tinting the normal floor texture toward a boxing-mat look for the
// Dojo — there's no dedicated light-colored floor tile in the licensed art pack, so this
// tints the same floor_interior.png tile everything else uses rather than needing new art.
const INTERIOR_FLOOR_TINT = { dojo: 'rgba(232,201,138,0.4)' };
const INTERIOR_BG = { cave: '#050608', caveDeep: '#050608' };
const INTERIOR_NAMES = { caveDeep: 'Deep Cave' }; // rooms with no building of their own // darker than the default room background
const INTERIORS = {};
for (const [id, size] of Object.entries(INTERIOR_SIZES)) {
  INTERIORS[id] = {
    cols: size.cols, rows: size.rows,
    exitCol: Math.floor(size.cols / 2),
    exitRow: size.rows - 1,
    spawnRow: size.rows - 3,
  };
}
function interiorFor(buildingId) {
  return INTERIORS[buildingId];
}

// ---------- Room art (walls and floors from the packs) ----------
// A styled room gets a back wall drawn ABOVE row 0 and its floor drawn from the
// sheet's own variants, all composed once into one canvas (buildRoomBackground).
// The wall sits outside the room's grid on purpose: every object, exit and spawn
// keeps the row it had, so nothing a student walks to moves.
//   wall:  sheet + the face, wallRows tall from sheet row `top` (cols midA..midB repeat; left/right ends curve
//          away into the dark past the floor's edges)
//   floor: weighted variants [weight, sheetCol, sheetRow]
//   wallDecor: [sheet, sx, sy, w, h, col, row] drawn onto the wall (row < 0)
//   lights: [col, row, radius in tiles] holes in the room's darkness
const ROOM_STYLE = {
  cave: {
    sheet: 'cMoss', wallRows: 3, side: 2, dark: 0.42,
    wall: { top: 10, mid: [2, 3, 4, 5], left: [0, 1], right: [6, 7] },
    floor: [[14, 1, 0], [14, 2, 0], [14, 3, 0], [10, 4, 0], [6, 5, 0], [3, 4, 1], [3, 5, 1], [2, 6, 2]],
    wallDecor: [
      ['cB1', 0, 7, 1, 2, 1, -2], ['cB1', 2, 7, 1, 2, 8, -3], ['cB1', 1, 8, 1, 2, 9, -2],
      ['cB2', 14, 14, 2, 2, -1, -2],
    ],
    lights: [[5, -0.5, 2.2], [2, 1, 3], [9, 4, 3], [5, 8.5, 3.5]],
  },
  caveDeep: {
    sheet: 'cStone', wallRows: 3, side: 2, dark: 0.55,
    wall: { top: 10, mid: [2, 3, 4, 5], left: [0, 1], right: [6, 7] },
    floor: [[14, 1, 0], [14, 2, 0], [14, 3, 0], [8, 4, 0], [5, 5, 1], [4, 4, 1], [4, 1, 1], [2, 2, 1]],
    wallDecor: [
      ['cB2', 8, 14, 2, 2, 0, -2], ['cB2', 14, 14, 2, 2, 9, -2],
      ['cB2', 13, 12, 1, 1, 3, -1], ['cB2', 15, 13, 1, 1, 7, -1],
    ],
    lights: [[0, 3, 2.5], [10, 3, 2.5], [1, 7, 2.5], [9, 7, 2.5], [5, 8.5, 3]],
  },
};

// The workshops and the home (Hometown pack's A5 inside sheet): a 3-tall wall of
// wood, plaster, brick or stone, and a plank or flagstone floor.
const WOOD_FLOOR = [[10, 1, 0], [10, 2, 0], [10, 3, 0]];
const STONE_FLOOR = [[10, 4, 1], [10, 5, 1], [6, 6, 1]];
const indoorRoom = (wallCols, floor) => ({
  sheet: 'hInA5', wallRows: 3, side: 0, frame: true,
  wall: { top: 11, mid: wallCols }, floor, wallDecor: [], lights: [],
});
Object.assign(ROOM_STYLE, {
  red: indoorRoom([2, 3], WOOD_FLOOR),
  blue: indoorRoom([0, 1], STONE_FLOOR),
  home: indoorRoom([0, 1], WOOD_FLOOR),
  dojo: indoorRoom([2, 3], [[10, 0, 1], [10, 1, 1]]),
  elapsed: indoorRoom([4, 5], WOOD_FLOOR),
  mvd: indoorRoom([6, 7], STONE_FLOOR),
  boathouse: indoorRoom([2, 3], WOOD_FLOOR),
});

const roomBackgrounds = {};
function buildRoomBackground(id) {
  if (roomBackgrounds[id]) return roomBackgrounds[id];
  const st = ROOM_STYLE[id];
  const it = INTERIORS[id];
  const keys = [st.sheet, ...st.wallDecor.map(d => d[0])];
  if (!sheetsReady(keys)) return null;
  const cols = it.cols + st.side * 2, rows = it.rows + st.wallRows;
  const c = document.createElement('canvas');
  c.width = cols * 16; c.height = rows * 16;
  const ctx = c.getContext('2d');
  const ox = st.side, oy = st.wallRows; // canvas tile of room (0,0)
  for (let r = 0; r < it.rows; r++) {
    for (let col = 0; col < it.cols; col++) {
      const [sx, sy] = pickVariant(st.floor, col, r);
      blit(ctx, st.sheet, sx, sy, 1, 1, (col + ox) * 16, (r + oy) * 16);
    }
  }
  // Back wall: the repeating middle across the floor's width, and the two curved
  // ends just past it, so the rock bends away into the dark at the corners.
  const w = st.wall;
  for (let k = 0; k < st.wallRows; k++) {
    const y = k * 16, sy = w.top + k;
    for (let col = 0; col < it.cols; col++) blit(ctx, st.sheet, w.mid[col % w.mid.length], sy, 1, 1, (col + ox) * 16, y);
    if (!w.left) continue;
    blit(ctx, st.sheet, w.left[0], sy, 1, 1, (ox - 2) * 16, y);
    blit(ctx, st.sheet, w.left[1], sy, 1, 1, (ox - 1) * 16, y);
    blit(ctx, st.sheet, w.right[0], sy, 1, 1, (ox + it.cols) * 16, y);
    blit(ctx, st.sheet, w.right[1], sy, 1, 1, (ox + it.cols + 1) * 16, y);
  }
  for (const [k, sx, sy, dw, dh, col, row] of st.wallDecor) blit(ctx, k, sx, sy, dw, dh, (col + ox) * 16, (row + oy) * 16);
  // Soft shadow where the floor meets the dark at the sides and front.
  const shade = (x0, y0, x1, y1, w0, h0) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), w0, h0);
  };
  const fx = ox * 16, fy = oy * 16, fw = it.cols * 16, fh = it.rows * 16;
  if (st.frame) {
    // A dark wooden skirting round the sides and front, where the old rooms had a border.
    ctx.fillStyle = '#3d2b1f';
    ctx.fillRect(0, 0, 2, c.height); ctx.fillRect(c.width - 2, 0, 2, c.height); ctx.fillRect(0, c.height - 2, c.width, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, fy, c.width, 3);
    roomBackgrounds[id] = { canvas: c, ox: st.side, oy: st.wallRows };
    return roomBackgrounds[id];
  }
  shade(fx, 0, fx + 12, 0, 12, fy + fh);
  shade(fx + fw, 0, fx + fw - 12, 0, 12, fy + fh);
  shade(0, fy + fh, 0, fy + fh - 10, fx * 2 + fw, 10);
  roomBackgrounds[id] = { canvas: c, ox: st.side, oy: st.wallRows };
  return roomBackgrounds[id];
}

// Every non-floor thing inside a room — workbenches, the closet, decor, pickups — is one
// of these. `col`/`row` is the tile the object's bottom-center sits on; the solid
// footprint and the interact-trigger tile (just south of it) are both derived from the
// image's actual pixel size, so differently-sized furniture collides correctly without
// hand-tuning each one. `kind` drives what happens when the player walks up to it:
//   'workbench' -> opens the mini-game placeholder panel
//   'closet'    -> opens the look-customization modal
//   'pickup'    -> one-time item grant (currently just the backpack)
//   'chest'     -> the place-value quest chest (see openChest)
//   'decor'     -> solid, but nothing happens when you approach it
// Cave props, from the Caves & Mines pack's object sheets (cB1, cB2 = tileB_cave1/2).
const CAVE_ART = {
  tunnel: sheetPiece('cMoss', 5, 13, 1, 2),
  lampPost: sheetPiece('cB2', 5, 4, 1, 1),
  crates: sheetPiece('cB1', 8, 0, 1, 3),
  barrel: sheetPiece('cB1', 10, 0, 1, 2),
  pots: sheetPiece('cB1', 15, 1, 1, 1),
  mossRock: sheetPiece('cB1', 3, 10, 2, 2),
  bigRock: sheetPiece('cB1', 4, 14, 2, 2),
  stalagmite: sheetPiece('cB1', 7, 12, 1, 2),
  mushrooms: sheetPiece('cB1', 5, 7, 1, 1),
  mushroomsRed: sheetPiece('cB1', 6, 7, 1, 1),
  fern: sheetPiece('cB1', 1, 6, 1, 1),
  pebbles: sheetPiece('cB1', 0, 12, 1, 1),
  skull: sheetPiece('cB1', 9, 7, 1, 1),
  bones: sheetPiece('cB1', 8, 7, 1, 1),
  crystalBlue: sheetPiece('cB2', 15, 13, 1, 1),
  crystalGreen: sheetPiece('cB2', 13, 13, 1, 1),
  crystalRed: sheetPiece('cB2', 11, 13, 1, 1),
  crystalSmall: sheetPiece('cB2', 9, 12, 1, 1),
  crystalSmallBlue: sheetPiece('cB2', 14, 12, 1, 1),
  oreGold: sheetPiece('cB2', 15, 10, 1, 1),
  orePile: sheetPiece('cB2', 15, 6, 1, 1),
  cartOre: sheetPiece('cB2', 12, 3, 1, 2),
  pickaxe: sheetPiece('cB2', 8, 8, 1, 1),
};

const INTERIOR_OBJECTS = {
  // Eight stations in a wide 25×10 scrolling room. The camera follows the player
  // like the overworld when the room is wider than the viewport.
  //
  // All eight benches along the top wall, 4 tiles apart, in a 33x10 scrolling room.
  // The camera follows the player like the overworld.
  //
  // They are all on one row on purpose. A bench is 3 tiles wide in collision, not 2 —
  // the 32px sprite is centered on a tile center, so it straddles and covers
  // col-1..col+1 — and a bench in rows 1-2 is approached from row 3, which is the only
  // row the player can walk along to reach it (the y-clamp stops them standing higher).
  // So any SECOND row of benches squeezes row 3 under the ones above into a one-tile
  // corridor with furniture on both sides; you end up aiming rather than walking and
  // bump the bench you were heading for. Two second-row placements were tried and both
  // did it. Widening the room instead leaves rows 4-9 completely empty, so every bench
  // is walked up to from open floor. Room needs 4 cols per bench plus a margin: adding
  // a ninth bench means cols: 37 here, not a second row.
  red: [
    { id: 'unitBench',     kind: 'workbench', img: workbenchImg, col: 2,  row: 2, label: 'Choose the Right Unit Work Bench',       shortLabel: 'Choose the Unit', src: 'measure-bench.html', messageType: 'mb-login', bench: 'unit' },
    { id: 'mmBench',       kind: 'workbench', img: workbenchImg, col: 6,  row: 2, label: 'Measure to the Millimeter Work Bench',   shortLabel: 'Millimeter',      src: 'measure-bench.html', messageType: 'mb-login', bench: 'mm' },
    { id: 'cmBench',       kind: 'workbench', img: workbenchImg, col: 10, row: 2, label: 'Measure to the Centimeter Work Bench',   shortLabel: 'Centimeter',      src: 'measure-bench.html', messageType: 'mb-login', bench: 'cm' },
    { id: 'mBench',        kind: 'workbench', img: workbenchImg, col: 14, row: 2, label: 'Measure to the Meter Work Bench',        shortLabel: 'Meter',           src: 'measure-bench.html', messageType: 'mb-login', bench: 'm' },
    { id: 'mixedBench',    kind: 'workbench', img: workbenchImg, col: 18, row: 2, label: 'Mixed Practice Work Bench',              shortLabel: 'Mixed Practice',  src: 'measure-bench.html', messageType: 'mb-login', bench: 'mixed' },
    { id: 'roundingBench', kind: 'workbench', img: workbenchImg, col: 22, row: 2, label: 'Rounding to Hundredths Work Bench',      shortLabel: 'Rounding',        src: 'rounding-bench.html', messageType: 'rb-login' },
    { id: 'averageBench',  kind: 'workbench', img: workbenchImg, col: 26, row: 2, label: 'Average Distance Work Bench',              shortLabel: 'Avg Distance',    src: 'average-bench.html', messageType: 'ab-login' },
    { id: 'measAvgBench',  kind: 'workbench', img: workbenchImg, col: 30, row: 2, label: 'Measure & Average Distance Work Bench',    shortLabel: 'Measure & Avg',   src: 'measure-average-bench.html', messageType: 'mab-login' },
  ],
  blue: [
    { id: 'placevalue', kind: 'workbench', img: workbenchImg, col: INTERIORS.blue.exitCol, row: 1, label: 'Place Value Work Bench', shortLabel: 'Place Value', src: 'place-value-bench.html', messageType: 'pvb-login' },
  ],
  home: [
    { id: 'bed', kind: 'bed', img: bedImg, col: 2, row: 1 },
    { id: 'kitchen', kind: 'decor', img: kitchenImg, col: 6, row: 1 },
    { id: 'closet', kind: 'closet', img: closetImg, col: 10, row: 1 },
    { id: 'mirror', kind: 'decor', img: mirrorImg, col: 11, row: 1 },
    { id: 'storage', kind: 'pickup', img: workbenchImg, pickupImg: backpackImg, col: 2, row: 7, label: 'Backpack', claimed: false },
    { id: 'homeChest', kind: 'storageChest', img: chestImg, col: 9, row: 7, label: 'Storage Chest' },
  ],
  cave: [
    // Once the boulders clear (see objectsFor below), this becomes a real door leading to
    // a separate cave room where the monsters actually live — not this room, so the chest
    // area stays a safe place to come back and stock up. The door is a dark tunnel in the
    // back wall (row 0); the rubble sits on its trigger tile (row 1) until then.
    // Its trigger is row 2, not the row-1 tile just south of it: no one's feet can get
    // above row 2 in any room (the y-clamp in gameplay.js), so a row-1 trigger made the
    // tunnel impossible to enter (2026-11-12). The boulders on row 1 no longer cover the
    // trigger, so the door also checks caveTunnelOpen() before it lets anyone through.
    { id: 'blockedDoor', kind: 'caveDoor', img: CAVE_ART.tunnel, col: 5, row: 0, triggerC: 5, triggerR: 2 },
    { id: 'boulder1', kind: 'decor', img: boulderImg, col: 4, row: 1 },
    { id: 'boulder2', kind: 'decor', img: boulderImg, col: 5, row: 1 },
    { id: 'boulder3', kind: 'decor', img: boulderImg, col: 6, row: 1 },
    {
      id: 'swordChest', kind: 'chest', img: chestImg, col: 8, row: 5, label: 'Old Chest', claimed: false,
      reward: {
        name: 'Dagger', equipType: 'weapon', manifestKey: 'weapon',
        manifestIndex: MANIFEST.weapon.findIndex(e => e.id === 'sword1'), variantIndex: 0,
      },
    },
    // Dressing, all around the edges: the walk from the entrance to the chest and on
    // up to the tunnel stays open floor.
    { id: 'cvLamp', kind: 'decor', img: CAVE_ART.lampPost, col: 2, row: 1, solidRows: 1 },
    { id: 'cvCrates', kind: 'decor', img: CAVE_ART.crates, col: 0, row: 2, solidRows: 1 },
    { id: 'cvBarrel', kind: 'decor', img: CAVE_ART.barrel, col: 1, row: 2, solidRows: 1 },
    { id: 'cvRock1', kind: 'decor', img: CAVE_ART.mossRock, col: 10, row: 1, solidRows: 1 },
    { id: 'cvRock2', kind: 'decor', img: CAVE_ART.bigRock, col: 0, row: 7, solidRows: 1 },
    { id: 'cvMite', kind: 'decor', img: CAVE_ART.stalagmite, col: 10, row: 7, solidRows: 1 },
    { id: 'cvPots', kind: 'decor', img: CAVE_ART.pots, col: 9, row: 5, solidRows: 1 },
    { id: 'cvShroom1', kind: 'decor', img: CAVE_ART.mushrooms, col: 1, row: 5, solid: false },
    { id: 'cvShroom2', kind: 'decor', img: CAVE_ART.mushroomsRed, col: 8, row: 2, solid: false },
    { id: 'cvVine', kind: 'decor', img: CAVE_ART.fern, col: 3, row: 7, solid: false },
    { id: 'cvPebbles', kind: 'decor', img: CAVE_ART.pebbles, col: 7, row: 7, solid: false },
  ],
  // The deeper cave room — monsters wander here (see battle.js's CAVE_MONSTER_DEFS), not
  // in the chest room. Crystals and ore in the four corners where the boulders were;
  // none block the room's middle, where the monsters roam and the exit path runs.
  caveDeep: [
    { id: 'deepBoulder1', kind: 'decor', img: CAVE_ART.crystalBlue, col: 1, row: 1, solidRows: 1 },
    { id: 'deepBoulder2', kind: 'decor', img: CAVE_ART.crystalGreen, col: 9, row: 1, solidRows: 1 },
    { id: 'deepBoulder3', kind: 'decor', img: CAVE_ART.oreGold, col: 1, row: 7, solidRows: 1 },
    { id: 'deepBoulder4', kind: 'decor', img: CAVE_ART.crystalRed, col: 9, row: 7, solidRows: 1 },
    { id: 'dpCart', kind: 'decor', img: CAVE_ART.cartOre, col: 0, row: 4, solidRows: 1 },
    { id: 'dpOre', kind: 'decor', img: CAVE_ART.orePile, col: 10, row: 4, solidRows: 1 },
    // The Minesweeper easter egg (minesweeper.html): stepping onto the old pickaxe
    // opens it. Only the Density bench's end screen hints at it. kind 'secret', not
    // 'workbench', so it carries no label on the floor and isn't on the teacher
    // dashboard. It triggers on its own tile rather than the one south of it.
    { id: 'dpPick', kind: 'secret', img: CAVE_ART.pickaxe, col: 0, row: 5, solid: false, triggerC: 0, triggerR: 5,
      label: 'The Old Mine', src: 'minesweeper.html', messageType: 'mine-login' },
    { id: 'dpSkull', kind: 'decor', img: CAVE_ART.skull, col: 3, row: 6, solid: false },
    { id: 'dpBones', kind: 'decor', img: CAVE_ART.bones, col: 7, row: 5, solid: false },
    { id: 'dpSmallC1', kind: 'decor', img: CAVE_ART.crystalSmall, col: 2, row: 8, solid: false },
    { id: 'dpSmallC2', kind: 'decor', img: CAVE_ART.crystalSmallBlue, col: 8, row: 8, solid: false },
  ],
  elapsed: [
    { id: 'simpleBench', kind: 'workbench', img: workbenchImg, col: 2, row: 1, label: 'Simple Elapsed Time Work Bench', shortLabel: 'Simple Elapsed', src: 'elapsed-time-bench.html', messageType: 'etb-login', bench: 'simple' },
    { id: 'startstopBench', kind: 'workbench', img: workbenchImg, col: 6, row: 1, label: 'Start & Stop Time Work Bench', shortLabel: 'Start & Stop', src: 'elapsed-time-bench.html', messageType: 'etb-login', bench: 'startstop' },
  ],
  // Four benches 4 tiles apart along the top wall (see the note on `red` for why one
  // row), so the room is 17 wide: 4 per bench plus a margin. Dimensions sits before
  // Volume: picking the 3 directions is the step before measuring them.
  mvd: [
    { id: 'massBench',    kind: 'workbench', img: workbenchImg, col: 2,  row: 1, label: 'Mass Work Bench',    shortLabel: 'Mass',    src: 'mass-volume-bench.html', messageType: 'mvd-login', bench: 'mass' },
    { id: 'dimsBench',    kind: 'workbench', img: workbenchImg, col: 6,  row: 1, label: 'Find the 3 Dimensions Work Bench', shortLabel: 'Dimensions', src: 'dimensions-bench.html', messageType: 'dmb-login' },
    { id: 'volumeBench',  kind: 'workbench', img: workbenchImg, col: 10, row: 1, label: 'Volume Work Bench',  shortLabel: 'Volume',  src: 'mass-volume-bench.html', messageType: 'mvd-login', bench: 'volume' },
    { id: 'densityBench', kind: 'workbench', img: workbenchImg, col: 14, row: 1, label: 'Density Work Bench', shortLabel: 'Density', src: 'mass-volume-bench.html', messageType: 'mvd-login', bench: 'density' },
  ],
  dojo: [],
  // The Boatwright's Hut: the drafting desk opens the Boat Builder (lake-quest.js).
  // Falling asleep over it is how the builder's sinking ends: it was all a dream.
  boathouse: [
    { id: 'boatDesk', kind: 'desk', img: workbenchImg, col: 4, row: 1, label: "Boatwright's Drafting Desk", src: 'boat-builder.html', messageType: 'boat-login', wide: true },
    { id: 'bhBarrel', kind: 'decor', img: PROP.barrel.img, col: 1, row: 1, solidRows: 1 },
    { id: 'bhCrates', kind: 'decor', img: PROP.crates.img, col: 7, row: 1, solidRows: 1 },
  ],
};
// The cave's boulder pile physically blocks the approach to the sealed door (its solid
// footprint sits right on the door's trigger tile) until the dagger chest is claimed,
// at which point the rubble clears and the door becomes reachable/usable. Filtering it
// out of the returned list (rather than a separate "removed" flag) keeps collision,
// rendering, and the trigger check all in sync automatically.
function caveTunnelOpen() {
  const chest = INTERIOR_OBJECTS.cave.find(o => o.id === 'swordChest');
  return !!(chest && chest.claimed);
}
function objectsFor(buildingId) {
  const list = INTERIOR_OBJECTS[buildingId] || [];
  if (buildingId === 'cave' && caveTunnelOpen()) return list.filter(o => !o.id.startsWith('boulder'));
  return list;
}

// Derive an object's solid footprint + south interact-trigger tile from where it's
// actually drawn (same bottom-center anchor math as rendering), so collision always
// matches what's on screen regardless of each image's native size.
function objFootprint(obj) {
  const iw = obj.img.naturalWidth || TILE_NATIVE, ih = obj.img.naturalHeight || TILE_NATIVE;
  const dw = iw * SCALE, dh = ih * SCALE;
  const dx = obj.col * TILE + TILE / 2 - dw / 2;
  const dy = (obj.row + 1) * TILE - dh;
  const colStart = Math.floor(dx / TILE), colEnd = Math.floor((dx + dw - 1) / TILE);
  const rowStart = Math.floor(dy / TILE), rowEnd = Math.floor((dy + dh - 1) / TILE);
  // Tall props block only at their base (solidRows), so the player can walk behind
  // the top; solid: false is floor dressing that blocks nothing.
  const solid = obj.solid !== false;
  const solidRowStart = obj.solidRows ? Math.max(rowStart, rowEnd - obj.solidRows + 1) : rowStart;
  return {
    dx, dy, dw, dh, colStart, colEnd, rowStart, rowEnd, solid, solidRowStart,
    triggerCol: obj.triggerC !== undefined ? obj.triggerC : Math.round((colStart + colEnd) / 2),
    triggerRow: obj.triggerR !== undefined ? obj.triggerR : rowEnd + 1,
  };
}

const player = {
  // Feet on the spawn tile's center (the same point placeFeetAtTile solves for).
  x: WORLD_SPOTS.spawn[0] * TILE + TILE / 2 - FRAME * SCALE / 2,
  y: WORLD_SPOTS.spawn[1] * TILE + TILE / 2 - FRAME * SCALE * 0.84,
  dir: 'south',
  moving: false,
  animT: 0,       // ms accumulator
  walkFrame: 1,   // index into ping-pong sequence
};
const PING_PONG = [0, 1, 2, 1];
const SPEED = 120; // px/sec at native... adjusted below with SCALE
const keys = {};

window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
// A keyup never arrives if focus left the window first — and every bench
// auto-focuses an input inside its iframe, which blurs the parent. The key
// stayed "down", so coming back to town the character walked off by itself
// until you tapped that key again. Clearing on blur covers the iframe case
// and alt-tab with one listener.
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// player's collision footprint: a small box at their feet (bottom-center of the sprite)
const FOOT_W_FACTOR = 0.18, FOOT_H_FACTOR = 0.2, FOOT_Y_MARGIN = 0.06;
function feetBox(x, y) {
  const spriteSize = FRAME * SCALE;
  const w = spriteSize * FOOT_W_FACTOR, h = spriteSize * FOOT_H_FACTOR;
  const offX = spriteSize / 2 - w / 2;
  const offY = spriteSize - h - spriteSize * FOOT_Y_MARGIN;
  return { x: x + offX, y: y + offY, w, h };
}
// A wider box used only for trigger detection (doors, exits, workbenches) — never for
// movement collision. It can safely be wider than one tile because the player's actual
// position was already constrained by the narrow feetBox above, so widening this just
// gives more forgiveness for "close enough" interactions without letting anyone clip
// through walls.
const INTERACT_W_FACTOR = 0.65, INTERACT_H_FACTOR = 0.28;
function interactBox(x, y) {
  const spriteSize = FRAME * SCALE;
  const w = spriteSize * INTERACT_W_FACTOR, h = spriteSize * INTERACT_H_FACTOR;
  const offX = spriteSize / 2 - w / 2;
  const offY = spriteSize - h - spriteSize * 0.04;
  return { x: x + offX, y: y + offY, w, h };
}
// Solve for player.x/y such that the feet-box center lands exactly on a tile's center.
function placeFeetAtTile(col, row) {
  const spriteSize = FRAME * SCALE;
  const w = spriteSize * FOOT_W_FACTOR, h = spriteSize * FOOT_H_FACTOR;
  const offX = spriteSize / 2 - w / 2;
  const offY = spriteSize - h - spriteSize * FOOT_Y_MARGIN;
  const cx = col * TILE + TILE / 2, cy = row * TILE + TILE / 2;
  return { x: cx - w / 2 - offX, y: cy - h / 2 - offY };
}
function boxTiles(box) {
  const c0 = Math.floor(box.x / TILE), c1 = Math.floor((box.x + box.w) / TILE);
  const r0 = Math.floor(box.y / TILE), r1 = Math.floor((box.y + box.h) / TILE);
  const tiles = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) tiles.push({ c, r });
  return tiles;
}

function worldBlocked(x, y) {
  const box = feetBox(x, y);
  for (const t of boxTiles(box)) {
    if (isSolidBuildingTile(t.c, t.r)) return true;
  }
  return false;
}
function worldDoorTrigger(x, y) {
  const box = interactBox(x, y);
  for (const t of boxTiles(box)) {
    const b = doorAt(t.c, t.r);
    if (b) return b;
  }
  return null;
}

function enterBuilding(b) {
  scene.mode = 'interior';
  document.getElementById('compassRose').style.display = 'none';
  scene.buildingId = b.id;
  scene.returnPos = { x: player.x, y: player.y };
  // spawn is well clear of every interactive object, so these should reflect that — NOT
  // be pre-set true, or a continuous walk-in-and-approach-something motion would
  // silently eat the first trigger.
  scene.wasOnDoor = false; scene.wasOnExit = false; scene.activeObjectId = null; scene.wasOnCaveMonsterId = null; scene.wasOnDojoMaster = false;
  const interior = interiorFor(b.id);
  const spawn = placeFeetAtTile(interior.exitCol, interior.spawnRow);
  player.x = spawn.x;
  player.y = spawn.y;
  player.dir = 'south';
}
function exitBuilding() {
  scene.mode = 'world';
  document.getElementById('compassRose').style.display = '';
  // landing spot is nudged only slightly south of the door, so it may still sit inside
  // the door's wide interact zone — wasOnDoor=true requires walking clear of it before
  // stepping back in can trigger again.
  scene.wasOnDoor = true; scene.wasOnExit = false; scene.activeObjectId = null;
  if (scene.returnPos) {
    player.x = scene.returnPos.x;
    player.y = scene.returnPos.y + TILE * 0.6; // nudge just south of the door
  }
  scene.buildingId = null;
}

// The cave's inner door doesn't lead back out to the world — it swaps between the two
// cave rooms while staying in 'interior' mode the whole time, so entering/leaving it
// works like any other door but never touches scene.mode or the world map at all.
function enterCaveDeepRoom() {
  scene.buildingId = 'caveDeep';
  scene.wasOnDoor = false; scene.wasOnExit = false; scene.activeObjectId = null;
  scene.wasOnCaveMonsterId = null;
  const interior = interiorFor('caveDeep');
  const spawn = placeFeetAtTile(interior.exitCol, interior.spawnRow);
  player.x = spawn.x;
  player.y = spawn.y;
  player.dir = 'north';
}
function exitCaveDeepRoom() {
  scene.buildingId = 'cave';
  scene.wasOnDoor = true; scene.wasOnExit = false; scene.activeObjectId = null;
  scene.wasOnCaveMonsterId = null;
  // Land clearly SOUTH of the door's own trigger tile (row 1), not on it — landing right
  // back on the trigger tile immediately re-fired the door and bounced the player straight
  // back into caveDeep.
  const spawn = placeFeetAtTile(5, 3);
  player.x = spawn.x;
  player.y = spawn.y;
  player.dir = 'south';
}
