// world.js — camera, tile/biome rendering, decor, buildings, interior room definitions and furniture, player object, and movement/collision helpers.

const TILE_NATIVE = 16;
const SCALE = 3;
const TILE = TILE_NATIVE * SCALE; // 48
const mapCanvas = document.getElementById('mapCanvas');
const mapCtx = mapCanvas.getContext('2d');
mapCtx.imageSmoothingEnabled = false;
const VIEWPORT_COLS = mapCanvas.width / TILE;
const VIEWPORT_ROWS = mapCanvas.height / TILE;

// The world is much bigger than the screen now, so the camera follows the player.
// The original town (built when the world WAS the whole screen) keeps every one of its
// existing tile coordinates — it's just placed inside the bigger world at this offset,
// which every town coordinate below gets shifted by in one pass rather than by hand.
const WORLD_COLS = 55, WORLD_ROWS = 30;
const TOWN_OFFSET_COL = 15, TOWN_OFFSET_ROW = 10;
const TOWN_COLS = 15, TOWN_ROWS = 10; // the original town's own footprint, for biome zoning

const camera = { x: 0, y: 0 };
function updateCamera() {
  const spriteSize = FRAME * SCALE;
  const targetX = player.x + spriteSize / 2 - mapCanvas.width / 2;
  const targetY = player.y + spriteSize / 2 - mapCanvas.height / 2;
  camera.x = Math.max(0, Math.min(WORLD_COLS * TILE - mapCanvas.width, targetX));
  camera.y = Math.max(0, Math.min(WORLD_ROWS * TILE - mapCanvas.height, targetY));
}

const grassImg = loadImage('tiles/grass.png');
const pathImg = loadImage('tiles/path.png');
const floorImg = loadImage('tiles/floor_interior.png');
const workbenchImg = loadImage('tiles/workbench.png');
const bedImg = loadImage('tiles/home/bed.png');
const closetImg = loadImage('tiles/home/closet.png');
const mirrorImg = loadImage('tiles/home/mirror.png');
const kitchenImg = loadImage('tiles/home/kitchen_counter.png');
const backpackImg = loadImage('tiles/home/backpack_stub.png');
const caveFloorImg = loadImage('tiles/cave_floor.png');
const sealedDoorImg = loadImage('tiles/sealed_door.png');
const chestImg = loadImage('tiles/chest.png');
const waterImg = loadImage('tiles/water.png');
const rockyGroundImg = loadImage('tiles/rocky_ground.png');
const boulderImg = loadImage('tiles/decor/boulder.png');

// A connected path: a vertical spine from the entrance up to a junction,
// with branches running to each house's door-approach tile.
const pathTiles = new Set();
function addPathLine(c0, r0, c1, r1) {
  if (c0 === c1) {
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) pathTiles.add(`${c0},${r}`);
  } else {
    for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) pathTiles.add(`${c},${r0}`);
  }
}
addPathLine(7, 4, 7, 9);   // vertical spine: entrance (7,9) up to the top junction
addPathLine(4, 4, 7, 4);   // branch west to the red house approach (4,4)
addPathLine(7, 8, 11, 8);  // branch east to the blue house approach (11,8)
addPathLine(2, 9, 7, 9);   // branch west along the bottom row to the home approach (2,9)

// ---------- Decoration (trees, plants, rocks) ----------
// Each sits on one "base" tile for collision; the art can be taller/wider and overhangs visually.
const DECOR_DEFS = [
  { img: loadImage('tiles/decor/tree_pine.png'), baseCol: 12, baseRow: 1, solid: true },
  { img: loadImage('tiles/decor/tree_round.png'), baseCol: 2, baseRow: 0, solid: true },
  { img: loadImage('tiles/decor/tree_round.png'), baseCol: 13, baseRow: 3, solid: true },
  { img: loadImage('tiles/decor/tree_round.png'), baseCol: 8, baseRow: 1, solid: true },
  { img: loadImage('tiles/decor/tree_round.png'), baseCol: 0, baseRow: 2, solid: true },
  { img: loadImage('tiles/decor/tree_thin.png'), baseCol: 6, baseRow: 1, solid: true },
  { img: loadImage('tiles/decor/tree_thin.png'), baseCol: 9, baseRow: 2, solid: true },
  { img: loadImage('tiles/decor/tree_thin.png'), baseCol: 1, baseRow: 9, solid: true },
  { img: loadImage('tiles/decor/rock.png'), baseCol: 6, baseRow: 6, solid: false },
  { img: loadImage('tiles/decor/rock.png'), baseCol: 13, baseRow: 9, solid: false },
  { img: loadImage('tiles/decor/flowers.png'), baseCol: 9, baseRow: 9, solid: false },
  { img: loadImage('tiles/decor/flowers.png'), baseCol: 2, baseRow: 9, solid: false },
  { img: loadImage('tiles/decor/hedge.png'), baseCol: 0, baseRow: 9, solid: false },
  { img: loadImage('tiles/decor/hedge.png'), baseCol: 14, baseRow: 6, solid: false },
];

// Shift every town coordinate (paths, decor, buildings below) from the original
// self-contained 15x10 layout into its place inside the bigger world, in one pass.
(function shiftTownIntoWorld() {
  const shiftedPath = new Set();
  pathTiles.forEach(key => {
    const [c, r] = key.split(',').map(Number);
    shiftedPath.add(`${c + TOWN_OFFSET_COL},${r + TOWN_OFFSET_ROW}`);
  });
  pathTiles.clear();
  shiftedPath.forEach(k => pathTiles.add(k));
  for (const d of DECOR_DEFS) { d.baseCol += TOWN_OFFSET_COL; d.baseRow += TOWN_OFFSET_ROW; }
})();

// Outskirt decoration for the forest / rocky / grassland biomes, placed directly in
// world coordinates (they're outside the town, so they don't go through the shift
// above). A simple fixed-stride scatter, nudged with a small deterministic offset per
// tile so it doesn't look like a grid.
function nudge(i, amount) { return (i * 37) % amount; }
// Tree circle clearing for the Potion Master — center at (46, 15), radius 4 tiles.
// Auto-scatter skips this zone; the ring of trees is placed manually below.
const CLEARING_COL = 46, CLEARING_ROW = 15, CLEARING_R = 4;
function inClearing(c, r) {
  const dx = c - CLEARING_COL, dy = r - CLEARING_ROW;
  return dx * dx + dy * dy <= (CLEARING_R + 1) * (CLEARING_R + 1);
}
for (let r = 0; r < WORLD_ROWS; r += 3) {
  for (let c = TOWN_OFFSET_COL + TOWN_COLS + 1; c < WORLD_COLS; c += 3) {
    const cc = c + nudge(r, 2), rr = r + nudge(c, 2);
    if (cc >= WORLD_COLS || rr >= WORLD_ROWS) continue;
    if (inClearing(cc, rr)) continue;
    const kind = (c + r) % 3 === 0 ? 'tree_pine' : (c + r) % 3 === 1 ? 'tree_round' : 'tree_thin';
    DECOR_DEFS.push({ img: loadImage(`tiles/decor/${kind}.png`), baseCol: cc, baseRow: rr, solid: true });
  }
}
// Ring of trees around the clearing
[
  [CLEARING_COL - 3, CLEARING_ROW - 2],
  [CLEARING_COL,     CLEARING_ROW - 3],
  [CLEARING_COL + 3, CLEARING_ROW - 2],
  [CLEARING_COL + 4, CLEARING_ROW],
  [CLEARING_COL + 3, CLEARING_ROW + 2],
  [CLEARING_COL,     CLEARING_ROW + 3],
  [CLEARING_COL - 3, CLEARING_ROW + 2],
  [CLEARING_COL - 4, CLEARING_ROW],
].forEach(([c, r], i) => {
  const kind = i % 3 === 0 ? 'tree_pine' : i % 3 === 1 ? 'tree_round' : 'tree_thin';
  DECOR_DEFS.push({ img: loadImage(`tiles/decor/${kind}.png`), baseCol: c, baseRow: r, solid: true });
});
for (let r = 0; r < WORLD_ROWS; r += 3) {
  for (let c = 0; c < TOWN_OFFSET_COL - 1; c += 3) {
    const cc = c + nudge(r, 2), rr = r + nudge(c, 2);
    if (cc < 0 || rr >= WORLD_ROWS) continue;
    const solid = (c + r) % 2 === 0;
    DECOR_DEFS.push({
      img: loadImage(solid ? 'tiles/decor/boulder.png' : 'tiles/decor/rock.png'),
      baseCol: cc, baseRow: rr, solid,
    });
  }
}
for (let c = TOWN_OFFSET_COL; c < TOWN_OFFSET_COL + TOWN_COLS; c += 3) {
  for (let r = TOWN_OFFSET_ROW + TOWN_ROWS + 1; r < WORLD_ROWS; r += 3) {
    const cc = c + nudge(r, 2), rr = r + nudge(c, 2);
    DECOR_DEFS.push({ img: loadImage('tiles/decor/flowers.png'), baseCol: cc, baseRow: rr, solid: false });
  }
}

// A couple of short dirt walkways out into the wilds, signposting the route to where
// the wandering monsters roam (forest to the east, grassland to the south). These are
// already in world coordinates, so — like the outskirt decor scatter above — they don't
// go through the town shift.
(function addWildWalkways() {
  const forestRow = TOWN_OFFSET_ROW + Math.floor(TOWN_ROWS / 2);
  for (let c = TOWN_OFFSET_COL + TOWN_COLS; c < CLEARING_COL; c++) {
    pathTiles.add(`${c},${forestRow}`);
  }
  const grassCol = TOWN_OFFSET_COL + Math.floor(TOWN_COLS / 2);
  for (let r = TOWN_OFFSET_ROW + TOWN_ROWS; r < TOWN_OFFSET_ROW + TOWN_ROWS + 7; r++) {
    pathTiles.add(`${grassCol},${r}`);
  }
  // Clear any auto-scattered solid decor (trees/boulders) that landed on the new walkways.
  for (let i = DECOR_DEFS.length - 1; i >= 0; i--) {
    if (pathTiles.has(`${DECOR_DEFS[i].baseCol},${DECOR_DEFS[i].baseRow}`)) DECOR_DEFS.splice(i, 1);
  }
})();

function decorSolidTiles() {
  const set = new Set();
  for (const d of DECOR_DEFS) if (d.solid) set.add(`${d.baseCol},${d.baseRow}`);
  return set;
}
// NOTE: DECOR_SOLID itself is computed further below, AFTER the cave/dojo decor-clearing
// splices — it has to be, since it's a snapshot of whatever's left in DECOR_DEFS at the
// moment it runs; computing it here (before those splices) would freeze in decor that
// later gets removed, leaving stale "solid" tiles outside those buildings that nothing
// ever clears (this was a real bug: it silently blocked the tile just past the Dojo's
// exit until fixed).

// ---------- Buildings ----------
// Each building sprite is (roofRows + wallRows) tiles tall, tilesWide tiles wide, at TILE_NATIVE=16px/tile.
// doorCol/doorRow are tile-local coordinates (0-indexed) of the walkable door tile (the bottom-most door cell).
const BUILDING_DEFS = [
  {
    id: 'red', img: loadImage('tiles/building_red.png'),
    tileX: 2, tileY: 1, tilesWide: 4, tilesTall: 3, doorCol: 2, doorRow: 2,
    name: 'Measure Distance Workshop', label: 'Measure Distance Workshop',
  },
  {
    id: 'blue', img: loadImage('tiles/building_blue.png'),
    tileX: 9, tileY: 5, tilesWide: 5, tilesTall: 3, doorCol: 2, doorRow: 2,
    name: 'Place Value Workshop', label: 'Place Value Workshop',
  },
  {
    id: 'home', img: loadImage('tiles/building_home.png'),
    tileX: 0, tileY: 5, tilesWide: 4, tilesTall: 4, doorCol: 2, doorRow: 3,
    name: 'Home', label: 'Home',
  },
];
for (const b of BUILDING_DEFS) { b.tileX += TOWN_OFFSET_COL; b.tileY += TOWN_OFFSET_ROW; }

// The cave sits out in the rocky west biome, so its coordinates are already in world
// space and don't go through the town shift above.
const CAVE_COL = 6, CAVE_ROW = 14;
BUILDING_DEFS.push({
  id: 'cave', img: loadImage('tiles/building_cave.png'),
  tileX: CAVE_COL, tileY: CAVE_ROW, tilesWide: 4, tilesTall: 3, doorCol: 2, doorRow: 2,
  name: 'Cave', label: 'Mystic Cave',
});
// Clear out any auto-scattered rocky decor that would overlap the cave or its approach.
for (let i = DECOR_DEFS.length - 1; i >= 0; i--) {
  const d = DECOR_DEFS[i];
  if (d.baseCol >= CAVE_COL - 1 && d.baseCol <= CAVE_COL + 4 && d.baseRow >= CAVE_ROW - 1 && d.baseRow <= CAVE_ROW + 4) {
    DECOR_DEFS.splice(i, 1);
  }
}

// The Dojo sits in the grassland southeast of town, near where the wandering monsters
// roam, so a walk out to train doubles as a walk toward a possible duel. No dedicated
// Dojo sprite exists in the licensed asset pack, so this reuses the Red House building
// image — same placeholder approach taken with the monster art before real sprites were
// sourced; swap DOJO_IMG's path below for a real asset later and nothing else changes.
const DOJO_COL = TOWN_OFFSET_COL + TOWN_COLS + 3, DOJO_ROW = TOWN_OFFSET_ROW + TOWN_ROWS + 3;
const DOJO_IMG = loadImage('tiles/building_red.png');
BUILDING_DEFS.push({
  id: 'dojo', img: DOJO_IMG,
  tileX: DOJO_COL, tileY: DOJO_ROW, tilesWide: 4, tilesTall: 3, doorCol: 2, doorRow: 2,
  name: 'Dojo', label: 'Dojo',
});
for (let i = DECOR_DEFS.length - 1; i >= 0; i--) {
  const d = DECOR_DEFS[i];
  if (d.baseCol >= DOJO_COL - 1 && d.baseCol <= DOJO_COL + 4 && d.baseRow >= DOJO_ROW - 1 && d.baseRow <= DOJO_ROW + 4) {
    DECOR_DEFS.splice(i, 1);
  }
}

// The Elapsed Time Workshop sits in the grassland southwest of town, near the south path.
const ELAPSED_COL = TOWN_OFFSET_COL + 1, ELAPSED_ROW = TOWN_OFFSET_ROW + TOWN_ROWS + 3;
BUILDING_DEFS.push({
  id: 'elapsed', img: loadImage('tiles/building_blue.png'),
  tileX: ELAPSED_COL, tileY: ELAPSED_ROW, tilesWide: 5, tilesTall: 3, doorCol: 2, doorRow: 2,
  name: 'Elapsed Time Workshop', label: 'Elapsed Time Workshop',
});
// Path branch from the south grassland spine over to this building's door approach.
const elapsedDoorCol = ELAPSED_COL + 2;
const grasslandSpine = TOWN_OFFSET_COL + Math.floor(TOWN_COLS / 2);
const elapsedDoorRow = ELAPSED_ROW + 2;
addPathLine(elapsedDoorCol, elapsedDoorRow, grasslandSpine, elapsedDoorRow);
for (let i = DECOR_DEFS.length - 1; i >= 0; i--) {
  const d = DECOR_DEFS[i];
  const inBuilding = d.baseCol >= ELAPSED_COL - 1 && d.baseCol <= ELAPSED_COL + 5 && d.baseRow >= ELAPSED_ROW - 1 && d.baseRow <= ELAPSED_ROW + 4;
  const onPath = d.baseRow === elapsedDoorRow && d.baseCol >= elapsedDoorCol && d.baseCol <= grasslandSpine;
  if (inBuilding || onPath) DECOR_DEFS.splice(i, 1);
}

// Computed here, after every decor-clearing pass above, so it correctly reflects what's
// actually left in DECOR_DEFS (see the note by decorSolidTiles()'s definition).
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
  if (isWaterTile(c, r)) return true;
  return false;
}
function doorAt(c, r) {
  for (const b of BUILDING_DEFS) {
    const door = buildingDoorTile(b);
    if (door.c === c && door.r === r) return b;
  }
  return null;
}

// ---------- Biomes ----------
// Column bands split the world into west (rocky) / town-middle / east (forest); within
// the middle band, row picks lake (north) / town / grassland (south).
function biomeAt(c, r) {
  if (c < TOWN_OFFSET_COL) return 'rocky';
  if (c >= TOWN_OFFSET_COL + TOWN_COLS) return 'forest';
  if (r >= 2 && r < TOWN_OFFSET_ROW - 2) return 'lake'; // rows 0-1 and just above town stay as grass "shore"
  if (r >= TOWN_OFFSET_ROW + TOWN_ROWS) return 'grassland';
  return 'town';
}
function groundImageFor(c, r) {
  if (pathTiles.has(`${c},${r}`)) return pathImg;
  const biome = biomeAt(c, r);
  if (biome === 'lake') return waterImg;
  if (biome === 'rocky') return rockyGroundImg;
  return grassImg; // town, forest, and grassland all use the grass floor
}
function isWaterTile(c, r) {
  return biomeAt(c, r) === 'lake';
}

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
  red: { cols: 25, rows: 10 },
  blue: { cols: 9, rows: 7 },
  home: { cols: 13, rows: 10 },
  cave: { cols: 11, rows: 9 },
  caveDeep: { cols: 11, rows: 9 },
  dojo: { cols: 13, rows: 10 },
  elapsed: { cols: 9, rows: 7 },
};
const INTERIOR_FLOORS = { red: floorImg, blue: floorImg, home: floorImg, cave: caveFloorImg, caveDeep: caveFloorImg, dojo: floorImg, elapsed: floorImg };
// A light, warm overlay tinting the normal floor texture toward a boxing-mat look for the
// Dojo — there's no dedicated light-colored floor tile in the licensed art pack, so this
// tints the same floor_interior.png tile everything else uses rather than needing new art.
const INTERIOR_FLOOR_TINT = { dojo: 'rgba(232,201,138,0.4)' };
const INTERIOR_BG = { cave: '#050608', caveDeep: '#050608' }; // darker than the default room background
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
const INTERIOR_OBJECTS = {
  // Seven stations in a wide 25×10 scrolling room. The camera follows the player
  // like the overworld when the room is wider than the viewport. All benches along
  // the top wall with 4 tiles between each — plenty of space, no crowding.
  red: [
    { id: 'unitBench',     kind: 'workbench', img: workbenchImg, col: 2,  row: 2, label: 'Choose the Right Unit Work Bench',       shortLabel: 'Choose the Unit', src: 'measure-bench.html', messageType: 'mb-login', bench: 'unit' },
    { id: 'mmBench',       kind: 'workbench', img: workbenchImg, col: 6,  row: 2, label: 'Measure to the Millimeter Work Bench',   shortLabel: 'Millimeter',      src: 'measure-bench.html', messageType: 'mb-login', bench: 'mm' },
    { id: 'cmBench',       kind: 'workbench', img: workbenchImg, col: 10, row: 2, label: 'Measure to the Centimeter Work Bench',   shortLabel: 'Centimeter',      src: 'measure-bench.html', messageType: 'mb-login', bench: 'cm' },
    { id: 'mBench',        kind: 'workbench', img: workbenchImg, col: 14, row: 2, label: 'Measure to the Meter Work Bench',        shortLabel: 'Meter',           src: 'measure-bench.html', messageType: 'mb-login', bench: 'm' },
    { id: 'mixedBench',    kind: 'workbench', img: workbenchImg, col: 18, row: 2, label: 'Mixed Practice Work Bench',              shortLabel: 'Mixed Practice',  src: 'measure-bench.html', messageType: 'mb-login', bench: 'mixed' },
    { id: 'roundingBench', kind: 'workbench', img: workbenchImg, col: 22, row: 2, label: 'Rounding to Hundredths Work Bench',      shortLabel: 'Rounding',        src: 'rounding-bench.html', messageType: 'rb-login' },
    { id: 'averageBench',  kind: 'workbench', img: workbenchImg, col: 18, row: 6, label: 'Average Distance Work Bench',              shortLabel: 'Avg Distance',    src: 'average-bench.html', messageType: 'ab-login' },
    { id: 'measAvgBench',  kind: 'workbench', img: workbenchImg, col: 22, row: 6, label: 'Measure & Average Distance Work Bench',    shortLabel: 'Measure & Avg',   src: 'measure-average-bench.html', messageType: 'mab-login' },
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
    // area stays a safe place to come back and stock up.
    { id: 'blockedDoor', kind: 'caveDoor', img: sealedDoorImg, col: 5, row: 1 },
    { id: 'boulder1', kind: 'decor', img: boulderImg, col: 4, row: 2 },
    { id: 'boulder2', kind: 'decor', img: boulderImg, col: 5, row: 2 },
    { id: 'boulder3', kind: 'decor', img: boulderImg, col: 6, row: 2 },
    {
      id: 'swordChest', kind: 'chest', img: chestImg, col: 8, row: 5, label: 'Old Chest', claimed: false,
      reward: {
        name: 'Dagger', equipType: 'weapon', manifestKey: 'weapon',
        manifestIndex: MANIFEST.weapon.findIndex(e => e.id === 'sword1'), variantIndex: 0,
      },
    },
  ],
  // The deeper cave room — monsters wander here (see battle.js's CAVE_MONSTER_DEFS), not
  // in the chest room. A few scattered boulders for atmosphere; none block the room's
  // middle, where the monsters roam and the exit path runs.
  caveDeep: [
    { id: 'deepBoulder1', kind: 'decor', img: boulderImg, col: 1, row: 1 },
    { id: 'deepBoulder2', kind: 'decor', img: boulderImg, col: 9, row: 1 },
    { id: 'deepBoulder3', kind: 'decor', img: boulderImg, col: 1, row: 7 },
    { id: 'deepBoulder4', kind: 'decor', img: boulderImg, col: 9, row: 7 },
  ],
  elapsed: [
    { id: 'simpleBench', kind: 'workbench', img: workbenchImg, col: 2, row: 1, label: 'Simple Elapsed Time Work Bench', shortLabel: 'Simple Elapsed', src: 'elapsed-time-bench.html', messageType: 'etb-login', bench: 'simple' },
    { id: 'startstopBench', kind: 'workbench', img: workbenchImg, col: 6, row: 1, label: 'Start & Stop Time Work Bench', shortLabel: 'Start & Stop', src: 'elapsed-time-bench.html', messageType: 'etb-login', bench: 'startstop' },
  ],
  dojo: [],
};
// The cave's boulder pile physically blocks the approach to the sealed door (its solid
// footprint sits right on the door's trigger tile) until the dagger chest is claimed,
// at which point the rubble clears and the door becomes reachable/usable. Filtering it
// out of the returned list (rather than a separate "removed" flag) keeps collision,
// rendering, and the trigger check all in sync automatically.
function objectsFor(buildingId) {
  const list = INTERIOR_OBJECTS[buildingId] || [];
  if (buildingId === 'cave') {
    const chest = list.find(o => o.id === 'swordChest');
    if (chest && chest.claimed) return list.filter(o => !o.id.startsWith('boulder'));
  }
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
  return {
    dx, dy, dw, dh, colStart, colEnd, rowStart, rowEnd,
    triggerCol: obj.triggerC !== undefined ? obj.triggerC : Math.round((colStart + colEnd) / 2),
    triggerRow: obj.triggerR !== undefined ? obj.triggerR : rowEnd + 1,
  };
}

const player = {
  x: TOWN_OFFSET_COL * TILE + TOWN_COLS * TILE / 2 - FRAME * SCALE / 2,
  y: TOWN_OFFSET_ROW * TILE + TOWN_ROWS * TILE / 2 - FRAME * SCALE / 2,
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
  // Land clearly SOUTH of the door's own trigger tile (row 2), not on it — landing right
  // back on the trigger tile immediately re-fired the door and bounced the player straight
  // back into caveDeep.
  const spawn = placeFeetAtTile(5, 3);
  player.x = spawn.x;
  player.y = spawn.y;
  player.dir = 'south';
}
