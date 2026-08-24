// quests.js — workbench popups, the reusable openQuestionGate practice-gate system, and
// the cave chest. The actual place-value round logic (money art, digit generation,
// Read It / Build It / Place the Point) lives in placevalue.js now — shared with the
// standalone Workbench game, so a fix there is a fix everywhere.

const wbModal = document.getElementById('workbenchModal');
const wbTitle = document.getElementById('wbTitle');
const wbBody = document.getElementById('wbBody');
const wbCloseBtn = document.getElementById('wbCloseBtn');
// Optional cleanup hook for whatever's currently using wbModal — set it before opening a
// flow that holds a live resource (e.g. a Firebase listener), so closing via the X still
// tears it down. Consumers are responsible for clearing it back to null once they no
// longer need it (e.g. on their own explicit "Back"/"Cancel" button).
let wbModalCloseHook = null;

function openWorkbench(wb) {
  if (wb.src) { openGameOverlay(wb); return; }
  scene.modalOpen = true;
  wbTitle.textContent = wb.label;
  wbBody.textContent = `This workbench will launch the ${wb.label} mini-game once it's wired up.`;
  wbModal.classList.remove('hidden');
}
function openPickupMessage(obj) {
  scene.modalOpen = true;
  wbTitle.textContent = 'You found a backpack!';
  wbBody.textContent = 'You can now carry items. Tap the Inventory button any time to see what you\'re holding and equip gear.';
  wbModal.classList.remove('hidden');
}

// ============================================================
// Reusable "practice gate" system — the goal is that adding the NEXT
// one (a different mini-game's mode gating a different chest, a
// battle, an NPC challenge, whatever) is small and mechanical:
//   1. Wrap that mode's generator + render + check logic as one new
//      entry in QUESTION_MODULES (placevalue.js). It only has to
//      implement render(container, { onCorrect, onWrong }) — build
//      its own UI into `container`, call onCorrect()/onWrong() when
//      the player answers. Everything else (confirm step, retry
//      loop, modal show/hide) is handled generically by
//      openQuestionGate below.
//   2. Call openQuestionGate({...}) from wherever needs the gate —
//      it doesn't care if that's a chest, a battle, or anything else,
//      as long as it hands it a modal (or reuses chestModal).
// ============================================================
// One-off single-message popup (e.g. "no backpack yet", "already claimed") —
// no question involved, just an info panel with a close button.
function showSimpleMessage(modalEls, title, text) {
  scene.modalOpen = true;
  modalEls.modal.classList.remove('hidden');
  modalEls.titleEl.textContent = title;
  modalEls.bodyEl.innerHTML = `<div class="wb-modal-body">${text}</div>`;
  modalEls.bodyEl.appendChild(gateButton('Close', () => {
    scene.modalOpen = false;
    modalEls.modal.classList.add('hidden');
  }));
}

// The generic gate flow: confirm -> question (via a QUESTION_MODULES entry) ->
// retry-on-wrong -> onSuccess (caller renders its own reward/outcome screen).
function openQuestionGate({ title, introText, moduleKey, modalEls, onSuccess, onCancel }) {
  const { modal, titleEl, bodyEl } = modalEls;
  scene.modalOpen = true;
  modal.classList.remove('hidden');

  function close() {
    scene.modalOpen = false;
    modal.classList.add('hidden');
    if (onCancel) onCancel();
  }
  function showConfirm() {
    titleEl.textContent = title;
    bodyEl.innerHTML = `<div class="wb-modal-body">${introText}</div>`;
    bodyEl.appendChild(gateButton('Begin', showQuestion));
    bodyEl.appendChild(gateButton('Not now', close));
  }
  function showQuestion() {
    titleEl.textContent = title;
    QUESTION_MODULES[moduleKey].render(bodyEl, { onCorrect: showSuccess, onWrong: showRetry });
    bodyEl.appendChild(gateButton('Not now', close));
  }
  function showRetry() {
    titleEl.textContent = title;
    bodyEl.innerHTML = '<div class="wb-modal-body">Not quite \u2014 try another one?</div>';
    bodyEl.appendChild(gateButton('Try Again', showQuestion));
    bodyEl.appendChild(gateButton('Not now', close));
  }
  function showSuccess() {
    onSuccess({ bodyEl, titleEl, close, gateButton, title });
  }
  showConfirm();
}

const chestModal = document.getElementById('chestModal');
const chestTitle = document.getElementById('chestTitle');
const chestBody = document.getElementById('chestBody');
const chestModalEls = { modal: chestModal, titleEl: chestTitle, bodyEl: chestBody };
function closeChest() {
  scene.modalOpen = false;
  chestModal.classList.add('hidden');
}
function openChest(obj) {
  if (obj.claimed) { showSimpleMessage(chestModalEls, obj.label, 'The chest is empty.'); return; }
  if (!hasBackpack) {
    showSimpleMessage(chestModalEls, obj.label, 'You have no way to carry items. Head back to town and find something to hold your things first.');
    return;
  }
  openQuestionGate({
    title: obj.label,
    introText: 'This chest is protected by a place value spell. You must correctly answer the question to open the box.',
    moduleKey: 'place-value-read',
    modalEls: chestModalEls,
    onSuccess: ({ bodyEl, titleEl, close }) => {
      obj.claimed = true;
      const openSlot = inventory.findIndex(x => x === null);
      if (openSlot !== -1) inventory[openSlot] = { ...obj.reward };
      renderInventory();
      saveSession();
      titleEl.textContent = obj.label;
      bodyEl.innerHTML = `<div class="wb-modal-body">Correct! The lock springs open. You found a ${obj.reward.name}!</div>`;
      bodyEl.appendChild(gateButton('Nice!', close));
    },
  });
}

function closeWorkbench() {
  if (wbModalCloseHook) { const fn = wbModalCloseHook; wbModalCloseHook = null; fn(); }
  scene.modalOpen = false;
  wbModal.classList.add('hidden');
}
wbCloseBtn.addEventListener('click', closeWorkbench);
window.addEventListener('keydown', e => {
  if (!scene.modalOpen || e.key !== 'Escape') return;
  if (!wbModal.classList.contains('hidden')) closeWorkbench();
  else if (!chestModal.classList.contains('hidden')) closeChest();
  else if (!battleOverlay.classList.contains('hidden')) closeBattle();
  else if (!shopModal.classList.contains('hidden')) closeShop();
  else if (!creatorModal.classList.contains('hidden')) { scene.modalOpen = false; creatorModal.classList.add('hidden'); }
  else if (!inventoryModal.classList.contains('hidden')) { scene.modalOpen = false; inventoryModal.classList.add('hidden'); }
});
