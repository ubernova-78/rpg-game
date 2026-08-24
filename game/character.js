// character.js — sprite compositor, skin-tone recolor, the closet creator (hair/skin/outfit), and the inventory/equip system.

// ---------- Constants ----------
const FRAME = 48;               // native px per animation frame
const COLS = 23, ROWS = 4;      // full sheet grid
const SHEET_W = FRAME * COLS, SHEET_H = FRAME * ROWS;
const DIR_ROW = { south: 0, west: 1, east: 2, north: 3 };

// Walk/stand animation lives in columns 0-2. Column 1 is the idle/middle pose.
const WALK_COLS = [0, 1, 2];

// Layer draw order (back -> front). Shadow is always first, drawn separately.
const ORDER_DEFAULT = ['backextra', 'backhair', 'bottom', 'top', 'head', 'hair', 'frontextra', 'hat', 'weapon'];
const ORDER_NORTH   = ['bottom', 'top', 'head', 'hair', 'backhair', 'frontextra', 'backextra', 'hat', 'weapon'];

// Default (Skin Tone 0) palette baked into every asset, and the swap targets.
const SKIN_PALETTES = [
  ['#73172d', '#bb7547', '#dba463', '#f4d29c', '#faf4d6'], // 0 default
  ['#561f2d', '#9d5534', '#b4723c', '#d49149', '#f0c175'], // 1
  ['#481c0e', '#774128', '#955123', '#b97e50', '#dbaa76'], // 2
  ['#36150c', '#583322', '#7b4c2d', '#986743', '#c78e52'], // 3
];

const SLOT_DEFS = [
  { key: 'head', label: 'Head', group: 'body', allowNone: false },
  { key: 'hair', label: 'Hair', group: 'body', allowNone: false },
  { key: 'backhair', label: 'Back Hair', group: 'body', allowNone: true },
  { key: 'top', label: 'Top', group: 'body', allowNone: false },
  { key: 'bottom', label: 'Bottom', group: 'body', allowNone: false },
  { key: 'frontextra', label: 'Front Extra', group: 'gear', allowNone: true },
  { key: 'backextra', label: 'Back Extra', group: 'gear', allowNone: true },
  { key: 'hat', label: 'Hat', group: 'gear', allowNone: true },
  { key: 'weapon', label: 'Weapon', group: 'gear', allowNone: true },
];

// ---------- State ----------
const loadout = { skinTone: 0 };
for (const s of SLOT_DEFS) loadout[s.key] = s.allowNone ? null : 0; // index into MANIFEST[key]
const variantIndex = {}; // key -> chosen color-variant index (0 = base)
for (const s of SLOT_DEFS) variantIndex[s.key] = 0;

const imgCache = {};
function loadImage(path) {
  if (imgCache[path]) return imgCache[path];
  const img = new Image();
  img.src = (typeof ASSET_DATA !== 'undefined' && ASSET_DATA[path]) ? ASSET_DATA[path] : path;
  imgCache[path] = img;
  return img;
}

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const SKIN_RGB = SKIN_PALETTES.map(pal => pal.map(hexToRgb));

// ---------- Compositing ----------
const sheetCanvas = document.createElement('canvas');
sheetCanvas.width = SHEET_W;
sheetCanvas.height = SHEET_H;
const sheetCtx = sheetCanvas.getContext('2d');
let sheetReady = false;

function currentFile(key) {
  const s = SLOT_DEFS.find(s => s.key === key);
  const baseIdx = loadout[key];
  if (s.allowNone && baseIdx === null) return null;
  const entry = MANIFEST[key][baseIdx];
  if (!entry) return null;
  const vIdx = Math.min(variantIndex[key], entry.variants.length - 1);
  return `assets/${key}/${entry.variants[vIdx]}`;
}

function allAssetPaths() {
  const paths = ['assets/shadow/shadow.png'];
  for (const s of SLOT_DEFS) {
    const p = currentFile(s.key);
    if (p) paths.push(p);
  }
  return paths;
}

let pendingRecomposite = false;
function requestRecomposite() {
  if (pendingRecomposite) return;
  pendingRecomposite = true;
  requestAnimationFrame(doRecomposite);
}

function doRecomposite() {
  pendingRecomposite = false;
  const paths = allAssetPaths();
  let loaded = 0;
  const total = paths.length;
  const imgs = paths.map(loadImage);

  function checkAllLoaded() {
    return imgs.every(im => im.complete && im.naturalWidth >= 0);
  }

  function draw() {
    sheetCtx.clearRect(0, 0, SHEET_W, SHEET_H);
    // shadow always first, all rows
    drawLayerRow('shadow', 0); drawLayerRow('shadow', 1); drawLayerRow('shadow', 2); drawLayerRow('shadow', 3);
    for (let row = 0; row < 4; row++) {
      const order = row === DIR_ROW.north ? ORDER_NORTH : ORDER_DEFAULT;
      for (const key of order) drawLayerRow(key, row);
    }
    if (loadout.skinTone !== 0) applySkinRecolor(loadout.skinTone);
    sheetReady = true;
  }

  function drawLayerRow(key, row) {
    const path = key === 'shadow' ? 'assets/shadow/shadow.png' : currentFile(key);
    if (!path) return;
    const img = imgCache[path];
    if (!img || !img.complete || img.naturalWidth === 0) return;
    const sy = row * FRAME;
    sheetCtx.drawImage(img, 0, sy, SHEET_W, FRAME, 0, sy, SHEET_W, FRAME);
  }

  // wait for images (most will already be cached/loaded after first run)
  let tries = 0;
  (function poll() {
    if (checkAllLoaded() || tries > 60) { draw(); refreshPreview(); return; }
    tries++;
    requestAnimationFrame(poll);
  })();
}

function applySkinRecolor(toneIdx) {
  const target = SKIN_RGB[toneIdx];
  const base = SKIN_RGB[0];
  const data = sheetCtx.getImageData(0, 0, SHEET_W, SHEET_H);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    for (let c = 0; c < base.length; c++) {
      if (px[i] === base[c][0] && px[i + 1] === base[c][1] && px[i + 2] === base[c][2]) {
        px[i] = target[c][0]; px[i + 1] = target[c][1]; px[i + 2] = target[c][2];
        break;
      }
    }
  }
  sheetCtx.putImageData(data, 0, 0);
}

// ---------- Preview (used inside creator + inventory modals) ----------
const previewCanvas = document.getElementById('creatorPreviewCanvas');
const previewCtx = previewCanvas.getContext('2d');
previewCtx.imageSmoothingEnabled = false;
const invPreviewCanvas = document.getElementById('invPreviewCanvas');
const invPreviewCtx = invPreviewCanvas.getContext('2d');
invPreviewCtx.imageSmoothingEnabled = false;
function refreshPreview() {
  const sx = WALK_COLS[1] * FRAME, sy = DIR_ROW.south * FRAME;
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewCtx.drawImage(sheetCanvas, sx, sy, FRAME, FRAME, 0, 0, previewCanvas.width, previewCanvas.height);
  invPreviewCtx.clearRect(0, 0, invPreviewCanvas.width, invPreviewCanvas.height);
  invPreviewCtx.drawImage(sheetCanvas, sx, sy, FRAME, FRAME, 0, 0, invPreviewCanvas.width, invPreviewCanvas.height);
}

// Small reusable canvas thumbnail of a layer file's south-idle frame, used for both
// the closet's hair swatches and inventory item icons.
function makeThumb(path, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const img = loadImage(path);
  function draw() {
    ctx.clearRect(0, 0, size, size);
    const s = size / 44;
    ctx.drawImage(img, FRAME, 0, FRAME, FRAME, -22 * s, -14 * s, 88 * s, 88 * s);
  }
  if (img.complete && img.naturalWidth > 0) draw();
  else img.addEventListener('load', draw, { once: true });
  return canvas;
}

// ---------- Closet creator (hair + skin tone + starter outfit only) ----------
const OUTFIT_SETS = [
  { id: 'pants', label: 'Shirt & Pants', top: 1, bottom: 1 },
  { id: 'skirt', label: 'Shirt & Skirt', top: 1, bottom: 4 },
];
let currentOutfitId = 'skirt';
function applyOutfitSet(id) {
  const set = OUTFIT_SETS.find(s => s.id === id);
  if (!set) return;
  currentOutfitId = id;
  loadout.top = set.top; variantIndex.top = 0;
  loadout.bottom = set.bottom; variantIndex.bottom = 0;
  requestRecomposite();
  saveSession();
}

function buildCreatorModal() {
  const skinRow = document.getElementById('creatorSkinRow');
  SKIN_PALETTES.forEach((pal, idx) => {
    const btn = document.createElement('button');
    btn.className = 'skin-btn' + (idx === loadout.skinTone ? ' active' : '');
    btn.style.background = pal[2];
    btn.title = `Skin tone ${idx}`;
    btn.addEventListener('click', () => {
      loadout.skinTone = idx;
      skinRow.querySelectorAll('.skin-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      requestRecomposite();
      saveSession();
    });
    skinRow.appendChild(btn);
  });

  const hairSelect = document.createElement('select');
  MANIFEST.hair.forEach((entry, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = entry.id;
    hairSelect.appendChild(opt);
  });
  hairSelect.value = loadout.hair;
  hairSelect.addEventListener('change', () => {
    loadout.hair = parseInt(hairSelect.value, 10);
    variantIndex.hair = 0;
    renderHairSwatches();
    requestRecomposite();
    saveSession();
  });
  document.getElementById('creatorHairSelect').appendChild(hairSelect);
  renderHairSwatches();

  const outfitWrap = document.getElementById('creatorOutfitButtons');
  OUTFIT_SETS.forEach(set => {
    const btn = document.createElement('button');
    btn.className = 'outfit-btn' + (set.id === currentOutfitId ? ' active' : '');
    btn.textContent = set.label;
    btn.addEventListener('click', () => {
      applyOutfitSet(set.id);
      outfitWrap.querySelectorAll('.outfit-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    outfitWrap.appendChild(btn);
  });
}

function renderHairSwatches() {
  const wrap = document.getElementById('creatorHairSwatches');
  wrap.innerHTML = '';
  const entry = MANIFEST.hair[loadout.hair];
  if (!entry || entry.variants.length <= 1) return;
  entry.variants.forEach((file, vIdx) => {
    const btn = document.createElement('button');
    btn.className = 'swatch-btn' + (vIdx === variantIndex.hair ? ' active' : '');
    btn.appendChild(makeThumb(`assets/hair/${file}`, 44));
    btn.addEventListener('click', () => {
      variantIndex.hair = vIdx;
      wrap.querySelectorAll('.swatch-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      requestRecomposite();
      saveSession();
    });
    wrap.appendChild(btn);
  });
}

const creatorModal = document.getElementById('creatorModal');
function openCloset() {
  scene.modalOpen = true;
  creatorModal.classList.remove('hidden');
}
document.getElementById('creatorCloseBtn').addEventListener('click', () => {
  scene.modalOpen = false;
  creatorModal.classList.add('hidden');
});

// ---------- Inventory ----------
const INVENTORY_SIZE = 12;
const inventory = new Array(INVENTORY_SIZE).fill(null);
const equipped = { helmet: null, weapon: null, cape: null, armor: null }; // -> inventory slot index
let hasBackpack = false;

// item.manifestKey/manifestIndex/variantIndex tell the compositor which layer file to
// show; equipType is which equipped-slot it goes in. NOTE: these three are TEMPORARY
// seeded test items so the equip flow can be verified end-to-end before the real
// chest/dagger reward (a later pass) actually grants anything.
function seedTestInventory() {
  inventory[0] = { name: 'Traveler Cap', equipType: 'helmet', manifestKey: 'hat', manifestIndex: 0, variantIndex: 0 };
}

// nullable slots revert to "nothing equipped"; `top` (armor) isn't nullable in the
// compositor, so it reverts to the current outfit set's base shirt instead.
const EQUIP_REVERT = {
  helmet: { manifestKey: 'hat', value: null },
  weapon: { manifestKey: 'weapon', value: null },
  cape: { manifestKey: 'backextra', value: null },
  armor: { manifestKey: 'top', value: () => OUTFIT_SETS.find(s => s.id === currentOutfitId).top },
};

// Equipping moves the item out of the backpack grid entirely (into `equipped`); the
// grid slot it occupied goes back to being empty. Unequipping puts it back in the
// first open slot. If something else is already worn in that slot type, it's bumped
// back to the backpack to make room (won't ever run out of room here since a slot
// literally just freed up).
function equipItem(slotIdx) {
  const item = inventory[slotIdx];
  if (!item) return;
  const previous = equipped[item.equipType];
  if (previous) {
    const openSlot = inventory.findIndex(x => x === null);
    if (openSlot !== -1) inventory[openSlot] = previous;
  }
  inventory[slotIdx] = null;
  equipped[item.equipType] = item;
  loadout[item.manifestKey] = item.manifestIndex;
  variantIndex[item.manifestKey] = item.variantIndex || 0;
  requestRecomposite();
  renderInventory();
  saveSession();
}

function unequipItem(equipType) {
  const item = equipped[equipType];
  if (!item) return;
  const openSlot = inventory.findIndex(x => x === null);
  if (openSlot !== -1) inventory[openSlot] = item;
  equipped[equipType] = null;
  const revert = EQUIP_REVERT[equipType];
  loadout[revert.manifestKey] = typeof revert.value === 'function' ? revert.value() : revert.value;
  variantIndex[revert.manifestKey] = 0;
  requestRecomposite();
  renderInventory();
  saveSession();
}

function renderInventory() {
  const grid = document.getElementById('invGrid');
  grid.innerHTML = '';
  inventory.forEach((item, idx) => {
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    if (item && item.kind === 'consumable') {
      slot.innerHTML = `<span style="font-size:22px;line-height:44px;">${item.icon}</span><span style="position:absolute;bottom:2px;right:4px;font-size:11px;color:var(--muted);">x${item.count}</span>`;
      slot.style.position = 'relative';
      slot.title = `${item.name} x${item.count} — used during battles`;
    } else if (item) {
      const path = `assets/${item.manifestKey}/${MANIFEST[item.manifestKey][item.manifestIndex].variants[item.variantIndex || 0]}`;
      slot.appendChild(makeThumb(path, 44));
      slot.title = item.name;
      slot.addEventListener('click', () => equipItem(idx));
    } else {
      slot.innerHTML = '<span class="inv-empty">empty</span>';
    }
    grid.appendChild(slot);
  });

  const list = document.getElementById('equippedList');
  const labels = { helmet: 'Helmet', weapon: 'Weapon', cape: 'Cape', armor: 'Armor' };
  list.innerHTML = '';
  Object.entries(equipped).forEach(([type, item]) => {
    const row = document.createElement('div');
    if (item) {
      row.innerHTML = `${labels[type]}: ${item.name} <span style="color:var(--accent);cursor:pointer;text-decoration:underline;">(unequip)</span>`;
      row.querySelector('span').addEventListener('click', () => unequipItem(type));
    } else {
      row.textContent = `${labels[type]}: —`;
    }
    list.appendChild(row);
  });
}

const inventoryModal = document.getElementById('inventoryModal');
const inventoryBtn = document.getElementById('inventoryBtn');
function openInventory() {
  scene.modalOpen = true;
  renderInventory();
  inventoryModal.classList.remove('hidden');
}
document.getElementById('invCloseBtn').addEventListener('click', () => {
  scene.modalOpen = false;
  inventoryModal.classList.add('hidden');
});
inventoryBtn.addEventListener('click', openInventory);

function grantBackpack() {
  hasBackpack = true;
  inventoryBtn.classList.remove('hidden');
  saveSession();
}

