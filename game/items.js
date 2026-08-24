// items.js — consumable items (health/hint potions): inventory stacking, monster drop
// rolls, and the potion shop (a shopkeeper NPC in town who sells them for gold).

const CONSUMABLE_DEFS = {
  healthPotion: { id: 'healthPotion', name: 'Health Potion', kind: 'consumable', icon: '❤️', heal: 1, price: 15 },
  hintPotion: { id: 'hintPotion', name: 'Hint Potion', kind: 'consumable', icon: '💡', price: 20 },
};

// Consumables stack into a single inventory slot per type (unlike equippable gear, which
// takes one slot per item) — buying/finding a second potion just increments `count` on
// the existing slot rather than eating another of the 12 backpack slots.
function findConsumableSlot(defId) {
  return inventory.findIndex(x => x && x.kind === 'consumable' && x.defId === defId);
}
function potionCount(defId) {
  const idx = findConsumableSlot(defId);
  return idx === -1 ? 0 : inventory[idx].count;
}
function grantConsumable(defId, qty) {
  const def = CONSUMABLE_DEFS[defId];
  const existing = findConsumableSlot(defId);
  if (existing !== -1) {
    inventory[existing].count += qty;
  } else {
    const openSlot = inventory.findIndex(x => x === null);
    if (openSlot === -1) return false; // backpack full — silently drop rather than crash
    inventory[openSlot] = { kind: 'consumable', defId, name: def.name, icon: def.icon, count: qty };
  }
  renderInventory();
  return true;
}
function consumePotion(defId) {
  const idx = findConsumableSlot(defId);
  if (idx === -1) return false;
  inventory[idx].count -= 1;
  if (inventory[idx].count <= 0) inventory[idx] = null;
  saveSession();
  renderInventory();
  return true;
}

// Victory drop roll: about a third of wins also drop a potion (health more common than hint).
const DROP_CHANCE = 0.10;
const HINT_DROP_SHARE = 0.3;
function rollDrop() {
  if (Math.random() >= DROP_CHANCE) return null;
  return Math.random() < HINT_DROP_SHARE ? 'hintPotion' : 'healthPotion';
}

// ---------- Shop ----------
const shopModal = document.getElementById('shopModal');
const shopTitle = document.getElementById('shopTitle');
const shopBody = document.getElementById('shopBody');

function closeShop() {
  scene.modalOpen = false;
  shopModal.classList.add('hidden');
}
function buyPotion(defId) {
  const def = CONSUMABLE_DEFS[defId];
  const gold = session.record.coins || 0;
  if (gold < def.price) { renderShop('Not enough gold for that yet.'); return; }
  if (!hasBackpack) { renderShop('You need a backpack to carry items — find one in your house first.'); return; }
  session.record.coins = gold - def.price;
  grantConsumable(defId, 1);
  saveSession();
  paintHud();
  renderShop(`Bought a ${def.name}!`);
}
function renderShop(message) {
  shopTitle.textContent = 'Potion Shop';
  const gold = session.record.coins || 0;
  let html = `<div class="wb-modal-body">Gold: \uD83E\uDE99 ${gold}</div>`;
  if (message) html += `<div class="wb-modal-body" style="color:var(--accent);">${message}</div>`;
  shopBody.innerHTML = html;
  Object.values(CONSUMABLE_DEFS).forEach(def => {
    const owned = potionCount(def.id);
    shopBody.appendChild(gateButton(
      `${def.icon} ${def.name} — ${def.price} gold (have ${owned})`,
      () => buyPotion(def.id),
    ));
  });
  shopBody.appendChild(gateButton('Leave shop', closeShop));
}
function openShop() {
  scene.modalOpen = true;
  shopModal.classList.remove('hidden');
  renderShop();
}
