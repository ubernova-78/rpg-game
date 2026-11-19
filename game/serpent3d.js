// The lake serpent in 3D, shared by the Boat Builder (the altar quest) and the
// Sail Builder, so the two can't drift apart. Styled after the pixel serpent in
// lake-quest.js and the Sail Builder's chase (Nick, 2026-11-19: "make the 3d
// monster look more like the 2d monster, a bit more scary"): dark green with
// lighter bands, an olive belly, bone-white spikes and horns, a long snout full
// of teeth with a dark red mouth, and glowing red eyes.
//
// Its own frame: +y up, the head and the lean toward -x, +x behind it. The pages
// pose it every frame through the parts returned: neckG (rotation.z = the lean),
// head (placed at the neck's tip) and jaw (rotation.z opens it, negative = open).
function buildSerpent(THREE) {
  const lam = c => new THREE.MeshLambertMaterial({ color: c });
  const DARK = lam(0x1f4d33), LIGHT = lam(0x2e6b45), BELLY = lam(0x8f9c5c), BONE = lam(0xd9d2b4), MOUTH = lam(0x4a0f14);
  const GLOW = new THREE.MeshBasicMaterial({ color: 0xff2a1a }), SLIT = new THREE.MeshBasicMaterial({ color: 0xffd34a });
  const mesh = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); return m; };
  const monster = new THREE.Group(); monster.visible = false;
  const NECK = 1.4;

  // Body: a hump at the waterline, its belly, and tail humps with water between them.
  const body = mesh(new THREE.SphereGeometry(0.5, 20, 14), DARK); body.scale.set(1.25, 0.62, 0.85); monster.add(body);
  const belly = mesh(new THREE.SphereGeometry(0.5, 16, 10), BELLY, -0.08, -0.07, 0); belly.scale.set(1.1, 0.5, 0.78); monster.add(belly);
  const humps = [[1.05, 0.0, 0.25], [1.72, -0.03, 0.17], [2.2, -0.05, 0.1]];
  humps.forEach(([x, y, r], i) => { const h = mesh(new THREE.SphereGeometry(r, 14, 10), i % 2 ? LIGHT : DARK, x, y, 0); h.scale.set(1.3, 0.9, 0.9); monster.add(h); });
  // Spikes stand ON the body and the humps (base sunk in), bone-white like the pixel one's.
  const BODY_RX = 0.5 * 1.25, BODY_RY = 0.5 * 0.62, bodyTop = x => BODY_RY * Math.sqrt(Math.max(0, 1 - (x / BODY_RX) ** 2));
  for (const x of [-0.3, -0.08, 0.14, 0.36, 0.55]) { const sp = mesh(new THREE.ConeGeometry(0.075, 0.28, 6), BONE, x, bodyTop(x) + 0.09, 0); sp.rotation.z = -0.25; monster.add(sp); }
  for (const [x, y, r] of humps) { const sp = mesh(new THREE.ConeGeometry(r * 0.32, r * 0.95, 6), BONE, x, y + r * 0.9 * 0.85 + r * 0.3, 0); sp.rotation.z = -0.3; monster.add(sp); }

  // Neck: dark, with lighter bands round it, and bone spines down its back (+x).
  const neckG = new THREE.Group(); neckG.position.set(-0.42, 0.12, 0); monster.add(neckG);
  neckG.add(mesh(new THREE.CylinderGeometry(0.14, 0.24, NECK, 14), DARK, 0, NECK / 2, 0));
  const rAt = h => 0.24 - 0.1 * h / NECK;
  for (let i = 0; i < 4; i++) { const h = 0.2 + i * 0.32; neckG.add(mesh(new THREE.CylinderGeometry(rAt(h + 0.07) + 0.012, rAt(h) + 0.012, 0.14, 14), LIGHT, 0, h + 0.07, 0)); }
  for (let i = 0; i < 5; i++) { const h = 0.15 + i * 0.28, sp = mesh(new THREE.ConeGeometry(0.055, 0.22, 6), BONE, rAt(h) + 0.07, h, 0); sp.rotation.z = -Math.PI / 2 + 0.35; neckG.add(sp); }

  // Head: a long, low snout (a crocodile's more than a dragon's), a heavy brow over
  // glowing red eyes, and two horns swept back.
  const head = new THREE.Group(); head.scale.setScalar(1.3); monster.add(head);
  const skull = mesh(new THREE.SphereGeometry(0.26, 16, 12), DARK, -0.1, 0.02, 0); skull.scale.set(1.25, 0.85, 1); head.add(skull);
  const snout = mesh(new THREE.BoxGeometry(0.62, 0.13, 0.27), DARK, -0.52, -0.01, 0); head.add(snout);
  const nose = mesh(new THREE.SphereGeometry(0.14, 12, 8), DARK, -0.83, 0.0, 0); nose.scale.set(0.8, 0.5, 1); head.add(nose);
  head.add(mesh(new THREE.BoxGeometry(0.5, 0.025, 0.24), LIGHT, -0.5, 0.06, 0)); // a lighter stripe down the snout
  for (const z of [-0.14, 0.14]) {
    const brow = mesh(new THREE.BoxGeometry(0.2, 0.07, 0.09), DARK, -0.17, 0.17, z * 1.02); brow.rotation.z = -0.25; head.add(brow);
    head.add(mesh(new THREE.SphereGeometry(0.072, 12, 10), GLOW, -0.2, 0.11, z * 1.55));
    head.add(mesh(new THREE.BoxGeometry(0.016, 0.09, 0.016), SLIT, -0.21, 0.11, z * 1.55 + Math.sign(z) * 0.066));
    const horn = mesh(new THREE.ConeGeometry(0.05, 0.36, 7), BONE, 0.12, 0.26, z * 0.8); horn.rotation.set(z > 0 ? -0.35 : 0.35, 0, -1.05); head.add(horn);
  }
  // The roof of the mouth, and the top teeth hanging down along it.
  head.add(mesh(new THREE.BoxGeometry(0.72, 0.03, 0.22), MOUTH, -0.47, -0.08, 0));
  for (let i = 0; i < 7; i++) for (const z of [-0.11, 0.11]) { const t = mesh(new THREE.ConeGeometry(0.022, 0.08, 5), BONE, -0.82 + i * 0.09, -0.12, z); t.rotation.x = Math.PI; head.add(t); }
  // The lower jaw, hinged at the back of the head: a red mouth and teeth pointing up.
  const jaw = new THREE.Group(); jaw.position.set(0.05, -0.08, 0); head.add(jaw);
  jaw.add(mesh(new THREE.BoxGeometry(0.88, 0.08, 0.27), BELLY, -0.44, -0.04, 0));
  jaw.add(mesh(new THREE.BoxGeometry(0.8, 0.02, 0.2), MOUTH, -0.46, 0.005, 0));
  for (let i = 0; i < 6; i++) for (const z of [-0.1, 0.1]) jaw.add(mesh(new THREE.ConeGeometry(0.02, 0.07, 5), BONE, -0.82 + i * 0.1, 0.04, z));

  return { monster, neckG, head, jaw, NECK };
}
if (typeof module !== 'undefined') module.exports = { buildSerpent };
