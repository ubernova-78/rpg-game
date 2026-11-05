// gameplay.js — the per-frame update/draw loop pieces: player movement+triggers, world/interior rendering.

function updatePlayer(dt) {
  if (scene.modalOpen) { player.moving = false; return; }

  let dx = 0, dy = 0;
  if (keys['arrowup'] || keys['w']) { dy -= 1; player.dir = 'north'; }
  if (keys['arrowdown'] || keys['s']) { dy += 1; player.dir = 'south'; }
  if (keys['arrowleft'] || keys['a']) { dx -= 1; player.dir = 'west'; }
  if (keys['arrowright'] || keys['d']) { dx += 1; player.dir = 'east'; }

  player.moving = dx !== 0 || dy !== 0;
  if (player.moving) {
    const len = Math.hypot(dx, dy) || 1;
    const speed = SPEED * SCALE * dt / 1000;
    const spriteSize = FRAME * SCALE;
    let nx = player.x + (dx / len) * speed;
    let ny = player.y + (dy / len) * speed;

    if (scene.mode === 'world') {
      nx = Math.max(-spriteSize * 0.3, Math.min(WORLD_COLS * TILE - spriteSize * 0.7, nx));
      // 0.94, not 0.7: the bottom of the FEET stops on the last row (feet bottom =
      // y + spriteSize*0.94, see feetBox). At 0.7 you could walk half a tile off the
      // bottom of the world -- the same fault the room clamp below had.
      ny = Math.max(-spriteSize * 0.3, Math.min(WORLD_ROWS * TILE - spriteSize * 0.94, ny));
      if (!worldBlocked(nx, player.y)) player.x = nx;
      if (!worldBlocked(player.x, ny)) player.y = ny;

      const b = worldDoorTrigger(player.x, player.y);
      const onDoor = !!b;
      if (onDoor && !scene.wasOnDoor) {
        // Closed from the teacher dashboard. Teacher accounts still go in,
        // to look round before it opens.
        if (ClassSettings.buildingClosed(b.id) && !session.teacher) {
          showSimpleMessage(chestModalEls, b.label, 'This workshop opens later. Your teacher will open it when it\'s time.');
        } else {
          enterBuilding(BUILDING_DEFS.find(bd => bd.id === b.id));
        }
      }
      scene.wasOnDoor = onDoor;

      const npc = nearbyNpc(player.x, player.y);
      const onNpc = npc ? npc.id : null;
      if (onNpc && onNpc !== scene.wasOnNpcId) {
        if (npc.isShop) openShop(); else openNpcDialogue(npc);
      }
      scene.wasOnNpcId = onNpc;

      updateRuneCircle();

      const monster = nearbyMonster(player.x, player.y);
      const onMonster = monster ? monster.id : null;
      if (onMonster && onMonster !== scene.wasOnMonsterId) openWorldMonsterBattle(monster);
      scene.wasOnMonsterId = onMonster;
    } else {
      const interior = interiorFor(scene.buildingId);
      const objects = objectsFor(scene.buildingId);
      const footprints = objects.map(objFootprint);

      const maxX = interior.cols * TILE - spriteSize * 0.7;
      // 0.94 puts the BOTTOM OF THE FEET on the last row, not the sprite's
      // middle. At 0.55 the feet cleared the floor entirely — in a 7-row room
      // they reached rows 7-8 — so you could walk out under the bottom wall and
      // stand on the page background. Worse, the exit tile is on the last row
      // and does not trigger from below it, so the way out looked broken.
      // (feet bottom = y + spriteSize*0.74 + spriteSize*0.2, see feetBox.)
      const maxY = interior.rows * TILE - spriteSize * 0.94;
      nx = Math.max(-spriteSize * 0.3, Math.min(maxX, nx));
      ny = Math.max(TILE * 0.4, Math.min(maxY, ny));
      const interiorBlocked = (px, py) => boxTiles(feetBox(px, py)).some(
        t => footprints.some(f => f.solid && t.c >= f.colStart && t.c <= f.colEnd && t.r >= f.solidRowStart && t.r <= f.rowEnd)
      );
      if (!interiorBlocked(nx, player.y)) player.x = nx;
      if (!interiorBlocked(player.x, ny)) player.y = ny;

      const tiles = boxTiles(interactBox(player.x, player.y));
      const onExit = tiles.some(t => t.c === interior.exitCol && t.r === interior.exitRow);
      let touched = null;
      objects.forEach((obj, i) => {
        if (obj.kind === 'decor') return;
        const f = footprints[i];
        if (tiles.some(t => t.c === f.triggerCol && t.r === f.triggerRow)) touched = obj;
      });

      if (onExit && !scene.wasOnExit) {
        if (scene.buildingId === 'caveDeep') exitCaveDeepRoom();
        else exitBuilding();
      } else if (touched && touched.id !== scene.activeObjectId) {
        if (touched.kind === 'workbench') openWorkbench(touched);
        else if (touched.kind === 'closet') openCloset();
        else if (touched.kind === 'chest') openChest(touched);
        else if (touched.kind === 'storageChest') openStorageChest();
        else if (touched.kind === 'bed') openBedRest(touched);
        else if (touched.kind === 'caveDoor') enterCaveDeepRoom();
        else if (touched.kind === 'pickup' && !touched.claimed) {
          touched.claimed = true;
          grantBackpack();
          openPickupMessage(touched);
        }
      }
      scene.wasOnExit = onExit;
      scene.activeObjectId = touched ? touched.id : null;

      if (scene.buildingId === 'caveDeep') {
        const caveMonster = nearbyCaveMonster(player.x, player.y);
        const onCaveMonster = caveMonster ? caveMonster.id : null;
        if (onCaveMonster && onCaveMonster !== scene.wasOnCaveMonsterId) openCaveMonsterBattle(caveMonster);
        scene.wasOnCaveMonsterId = onCaveMonster;
      }
      if (scene.buildingId === 'dojo') {
        const onDojoMaster = nearbyDojoMaster(player.x, player.y);
        if (onDojoMaster && !scene.wasOnDojoMaster) openDojoKiosk();
        scene.wasOnDojoMaster = onDojoMaster;
      }
    }

    player.animT += dt;
    if (player.animT > 140) {
      player.animT = 0;
      player.walkFrame = (player.walkFrame + 1) % PING_PONG.length;
    }
  } else {
    player.walkFrame = 0;
    player.animT = 0;
  }
}

function drawWorld() {
  mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  drawGround();
  drawRuneCircle();
  // Buildings, trees, people and monsters, back to front (see drawSorted): walk north
  // past a tree and its canopy covers you; its trunk is the only part that blocks.
  const items = [];
  for (const b of BUILDING_DEFS) {
    if (!b.img.complete || b.img.naturalWidth === 0) continue;
    const bx = b.tileX * TILE - camera.x, by = b.tileY * TILE - camera.y;
    const bw = b.tilesWide * TILE, bh = b.tilesTall * TILE;
    if (bx > mapCanvas.width || bx + bw < 0 || by > mapCanvas.height || by + bh < 0) continue;
    items.push({ y: (b.tileY + b.tilesTall - 0.5) * TILE, draw: () =>
      mapCtx.drawImage(b.img, 0, 0, b.tilesWide * TILE_NATIVE, b.tilesTall * TILE_NATIVE, bx, by, bw, bh) });
  }
  for (const d of DECOR_DEFS) {
    if (!d.img.complete || d.img.naturalWidth === 0) continue;
    const dw = d.img.naturalWidth * SCALE, dh = d.img.naturalHeight * SCALE;
    const dx = d.baseCol * TILE + TILE / 2 - dw / 2 - camera.x;
    const dy = (d.baseRow + 1) * TILE - dh - camera.y;
    if (dx > mapCanvas.width || dx + dw < 0 || dy > mapCanvas.height || dy + dh < 0) continue;
    // Flat things (flowers, pebbles) are under everyone; standing things sort by base.
    items.push({ y: d.flat ? -Infinity : (d.baseRow + 0.5) * TILE, draw: () => mapCtx.drawImage(d.img, dx, dy, dw, dh) });
  }
  items.push(...npcDrawables(), ...monsterDrawables());
  items.push({ y: playerSortY(), draw: () => drawPlayerAt(-camera.x, -camera.y) });
  drawSorted(items);

  // Labels draw last, on top of trees/buildings/NPCs, so nothing can cover the text.
  for (const b of BUILDING_DEFS) {
    if (!b.label) continue;
    const bx = b.tileX * TILE - camera.x, by = b.tileY * TILE - camera.y;
    const bw = b.tilesWide * TILE;
    if (by < -20 || by > mapCanvas.height) continue;
    const labelX = bx + bw / 2;
    mapCtx.font = 'bold 12px Trebuchet MS, sans-serif';
    mapCtx.textAlign = 'center';
    mapCtx.lineWidth = 3;
    mapCtx.strokeStyle = 'rgba(10,14,20,0.85)';
    mapCtx.strokeText(b.label, labelX, by - 6);
    mapCtx.fillStyle = '#f4f7fa';
    mapCtx.fillText(b.label, labelX, by - 6);
  }
}

let interiorOrigin = { x: 0, y: 0 };
// The player's sort y: the middle of their feet box (see feetBox), which is the
// point collision uses too, so "in front of" and "blocked by" agree.
function playerSortY() { return player.y + FRAME * SCALE * 0.84; }
function drawInterior() {
  mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  mapCtx.fillStyle = INTERIOR_BG[scene.buildingId] || '#0d1117';
  mapCtx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
  const interior = interiorFor(scene.buildingId);
  const style = ROOM_STYLE[scene.buildingId];
  const bg = style ? buildRoomBackground(scene.buildingId) : null;
  const floor = INTERIOR_FLOORS[scene.buildingId] || floorImg;
  const roomW = interior.cols * TILE, roomH = interior.rows * TILE;
  // A styled room's back wall is drawn above row 0, so what has to fit (or scroll)
  // runs from the top of the wall to the bottom of the floor.
  const topH = style ? style.wallRows * TILE : 0;
  const sideW = style ? style.side * TILE : 0;
  // If the room fits in the viewport, center it (original behavior).
  // If it's bigger, scroll with the player like the overworld camera.
  const spriteSize = FRAME * SCALE;
  let ox, oy;
  if (roomW + sideW * 2 <= mapCanvas.width) {
    ox = (mapCanvas.width - roomW) / 2;
  } else {
    const camX = player.x + spriteSize / 2 - mapCanvas.width / 2;
    ox = -Math.max(-sideW, Math.min(roomW + sideW - mapCanvas.width, camX));
  }
  const fullH = roomH + topH;
  if (fullH <= mapCanvas.height) {
    oy = (mapCanvas.height - fullH) / 2 + topH;
  } else {
    const camY = player.y + spriteSize / 2 - mapCanvas.height / 2;
    oy = -Math.max(-topH, Math.min(roomH + 24 - mapCanvas.height, camY));
  }
  interiorOrigin = { x: ox, y: oy };
  mapCtx.save();
  mapCtx.translate(ox, oy);
  if (bg) {
    mapCtx.drawImage(bg.canvas, -bg.ox * TILE, -bg.oy * TILE, bg.canvas.width * SCALE, bg.canvas.height * SCALE);
  } else if (!style) {
    for (let r = 0; r < interior.rows; r++) {
      for (let c = 0; c < interior.cols; c++) {
        if (floor.complete && floor.naturalWidth > 0) {
          mapCtx.drawImage(floor, 0, 0, TILE_NATIVE, TILE_NATIVE, c * TILE, r * TILE, TILE, TILE);
        }
      }
    }
    const floorTint = INTERIOR_FLOOR_TINT[scene.buildingId];
    if (floorTint) {
      mapCtx.fillStyle = floorTint;
      mapCtx.fillRect(0, 0, interior.cols * TILE, interior.rows * TILE);
    }
    // wall border
    mapCtx.strokeStyle = '#3d2b1f';
    mapCtx.lineWidth = 6;
    mapCtx.strokeRect(3, 3, interior.cols * TILE - 6, interior.rows * TILE - 6);
  }
  // exit marker
  mapCtx.fillStyle = 'rgba(255,255,255,0.15)';
  mapCtx.fillRect(interior.exitCol * TILE, interior.exitRow * TILE, TILE, TILE);
  // Furniture, props, monsters and the player, back to front (see drawSorted).
  const items = [];
  for (const obj of objectsFor(scene.buildingId)) {
    if (!obj.img.complete || obj.img.naturalWidth === 0) continue;
    const f = objFootprint(obj);
    // Flat floor dressing always sits under whoever walks over it.
    const y = f.solid ? (f.rowEnd + 0.5) * TILE : -Infinity;
    items.push({ y, draw: () => {
      mapCtx.drawImage(obj.img, f.dx, f.dy, f.dw, f.dh);
      // pickups show their item sitting on top until claimed, then it's just bare furniture
      if (obj.kind === 'pickup' && !obj.claimed && obj.pickupImg && obj.pickupImg.complete && obj.pickupImg.naturalWidth > 0) {
        const pw = obj.pickupImg.naturalWidth * SCALE, ph = obj.pickupImg.naturalHeight * SCALE;
        const px = obj.col * TILE + TILE / 2 - pw / 2;
        const py = f.dy + f.dh / 2 - ph / 2 - 4; // centered on the table top, nudged up slightly
        mapCtx.drawImage(obj.pickupImg, px, py, pw, ph);
      }
    } });
  }
  if (scene.buildingId === 'caveDeep') items.push(...caveMonsterDrawables());
  items.push({ y: playerSortY(), draw: () => drawPlayerAt(0, 0) });
  drawSorted(items);
  if (style && style.dark) drawRoomDarkness(style, ox, oy);
  // Floating name tags above workbench tables, same idea as the world-map building
  // labels — so a student can see which station is which without walking up and reading
  // the modal title first (handy in a room with several tables doing different things).
  // Clamped to a small positive minimum: some furniture art (like the workbench table,
  // 32px/2-tiles tall) is taller than a single tile, which can push the image's own
  // rendered top (f.dy) up to/above row 0 for anything placed close to the top wall,
  // sending a label positioned purely above that off the canvas entirely. The clamp keeps
  // it pinned just below the top edge in that case, instead of invisible or, if anchored
  // to the tile row instead, sitting deep inside the tall image.
  mapCtx.font = 'bold 11px Trebuchet MS, sans-serif';
  mapCtx.textAlign = 'center';
  for (const obj of objectsFor(scene.buildingId)) {
    if (obj.kind !== 'workbench' || !obj.shortLabel) continue;
    const f = objFootprint(obj);
    const labelX = f.dx + f.dw / 2, labelY = Math.max(12, f.dy - 6);
    mapCtx.lineWidth = 3;
    mapCtx.strokeStyle = 'rgba(10,14,20,0.85)';
    mapCtx.strokeText(obj.shortLabel, labelX, labelY);
    mapCtx.fillStyle = '#f4f7fa';
    mapCtx.fillText(obj.shortLabel, labelX, labelY);
  }
  // The Dojo's sparrers stand still in their own lanes, so the player simply goes on top
  // of them, as before depth sorting.
  if (scene.buildingId === 'dojo') { drawDojoSparrers(); drawDojoMaster(); drawPlayerAt(0, 0); }
  mapCtx.restore();

  // Scroll arrows for wide rooms — pulsing chevrons on the left/right edges hint
  // that there are more workbenches off-screen in that direction.
  if (roomW > mapCanvas.width) {
    const canScroll = { left: ox < 0, right: ox > -(roomW - mapCanvas.width) };
    const pulse = 0.45 + 0.35 * Math.sin(Date.now() / 400);
    mapCtx.save();
    mapCtx.font = 'bold 22px Trebuchet MS, sans-serif';
    mapCtx.textBaseline = 'middle';
    mapCtx.fillStyle = `rgba(244,247,250,${pulse})`;
    mapCtx.strokeStyle = `rgba(10,14,20,${pulse * 0.7})`;
    mapCtx.lineWidth = 3;
    const midY = mapCanvas.height / 2;
    if (canScroll.left) {
      mapCtx.textAlign = 'left';
      mapCtx.strokeText('◂ more', 8, midY);
      mapCtx.fillText('◂ more', 8, midY);
    }
    if (canScroll.right) {
      mapCtx.textAlign = 'right';
      mapCtx.strokeText('more ▸', mapCanvas.width - 8, midY);
      mapCtx.fillText('more ▸', mapCanvas.width - 8, midY);
    }
    mapCtx.restore();
  }

  const b = BUILDING_DEFS.find(bd => bd.id === scene.buildingId);
  mapCtx.fillStyle = '#e8ecf1';
  mapCtx.font = '13px Trebuchet MS, sans-serif';
  mapCtx.textAlign = 'center';
  mapCtx.fillText(b ? b.name + ' — interior' : (INTERIOR_NAMES[scene.buildingId] || 'Interior'), mapCanvas.width / 2, 22);
  mapCtx.fillStyle = '#9aa7b8';
  mapCtx.font = '11px Trebuchet MS, sans-serif';
  const hintY = oy + interior.rows * TILE + 18;
  // Only show the hint if the exit area is currently on screen
  if (hintY > 0 && hintY < mapCanvas.height) {
    mapCtx.fillText('Walk to the glowing tile to leave', mapCanvas.width / 2, hintY);
  }
}

// Draws the player too, in depth order with everything else.
function drawMap() {
  if (scene.mode === 'interior') {
    drawInterior();
  } else {
    drawWorld();
  }
}

function drawPlayer() {
  const offX = scene.mode === 'interior' ? interiorOrigin.x : -camera.x;
  const offY = scene.mode === 'interior' ? interiorOrigin.y : -camera.y;
  drawPlayerAt(offX, offY);
}
// offX/offY: where world (or room) pixel 0,0 is on the canvas right now.
function drawPlayerAt(offX, offY) {
  if (!sheetReady) return;
  const col = player.moving ? PING_PONG[player.walkFrame] : WALK_COLS[1];
  const row = DIR_ROW[player.dir];
  const sx = col * FRAME, sy = row * FRAME;
  const size = FRAME * SCALE;
  mapCtx.drawImage(sheetCanvas, sx, sy, FRAME, FRAME, Math.round(player.x + offX), Math.round(player.y + offY), size, size);
}

// A cave is dark except near its lamps and crystals, the way out, and the player.
// Drawn on its own canvas so the light holes can be cut out of the darkness.
const darkCanvas = document.createElement('canvas');
function drawRoomDarkness(style, ox, oy) {
  darkCanvas.width = mapCanvas.width; darkCanvas.height = mapCanvas.height;
  const d = darkCanvas.getContext('2d');
  d.fillStyle = `rgba(4,6,14,${style.dark})`;
  d.fillRect(0, 0, darkCanvas.width, darkCanvas.height);
  d.globalCompositeOperation = 'destination-out';
  const flicker = 1 + 0.04 * Math.sin(Date.now() / 160);
  const hole = (x, y, r) => {
    const g = d.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    d.fillStyle = g; d.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (const [c, r, rad] of style.lights) hole(ox + (c + 0.5) * TILE, oy + (r + 0.5) * TILE, rad * TILE * flicker);
  const size = FRAME * SCALE;
  hole(ox + player.x + size / 2, oy + player.y + size * 0.6, 3.2 * TILE);
  mapCtx.drawImage(darkCanvas, 0, 0);
}
