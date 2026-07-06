/* =========================================================
   player.js — FIRST-PERSON controller.
   Pointer-lock mouse look + WASD movement, sprint, jump,
   gravity, collision against world colliders, and interaction.

   Emits events (player:move, player:jump, player:interact, etc.)
   so the story builder reacts to player behavior without editing
   this file.
   ========================================================= */
window.GAME = window.GAME || {};

GAME.Player = (function () {
  const cfg = GAME.Config.player;
  let camera, world, dom;
  let yaw = 0, pitch = 0;
  let velY = 0, onGround = true;
  const keys = {};
  let locked = false;
  let sprinting = false;
  let moveThrottle = 0;
  let axe = null;          // viewmodel group attached to the camera
  let swinging = false;    // is a swing animation playing
  let swingT = 0;          // swing animation clock
  let attackCooldown = 0;  // seconds until next allowed swing

  const pos = new THREE.Vector3(0, 0, 8);

  function init(sharedCamera, worldApi, domElement) {
    camera = sharedCamera;
    world = worldApi;
    dom = domElement;

    // Eye height scales with chosen character height.
    const hMod = (GAME.State.character?.height || 180) / 180;
    cfg._eye = cfg.eyeHeight * hMod;

    setupPointerLock();
    setupKeys();
    buildWeapon();
    // Rebuild the viewmodel whenever the equipped weapon changes.
    GAME.Events.on('weapon:equip', () => buildWeapon());

    pos.y = world.groundHeight(pos.x, pos.z) + cfg._eye;
    camera.position.copy(pos);
    GAME.Events.emit('player:spawn', { position: pos.clone() });
  }

  function clearMovementKeys() {
    for (const k of Object.keys(keys)) keys[k] = false;
    if (GAME.PoseControl && GAME.PoseControl.releaseKeys) GAME.PoseControl.releaseKeys();
  }

  function setupPointerLock() {
    const prompt = document.getElementById('lock-prompt');
    // Bind to BOTH the canvas and the overlay. The overlay covers the
    // canvas (inset:0), so a click lands on the overlay — without this it
    // would swallow the click and pointer-lock would never engage.
    const request = () => { if (!locked) dom.requestPointerLock(); };
    dom.addEventListener('click', request);
    prompt.addEventListener('click', request);
    document.addEventListener('pointerlockchange', () => {
      locked = document.pointerLockElement === dom;
      prompt.classList.toggle('hidden', locked);
      clearMovementKeys();
    });
    document.addEventListener('mousemove', (e) => {
      if (!locked) return;
      yaw   -= e.movementX * cfg.mouseSensitivity;
      pitch -= e.movementY * cfg.mouseSensitivity;
      pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
    });

    // Left-click swing removed — hits are automatic when near objects (see update()).
    document.addEventListener('mousedown', (e) => {
      if (locked && e.button === 2) { e.preventDefault(); placeSelectedBlock(); }
    });
    // Suppress the context menu so right-click is usable in-game.
    document.addEventListener('contextmenu', (e) => { if (locked) e.preventDefault(); });
  }

  function setupKeys() {
    document.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      // Arrow keys double as movement; stop them scrolling the page.
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown' ||
          e.code === 'ArrowLeft' || e.code === 'ArrowRight') e.preventDefault();
      if (e.code === 'KeyE') {
        // If a dialogue is open, E advances/closes it instead of re-triggering.
        if (GAME.UI.isDialogueOpen && GAME.UI.isDialogueOpen()) GAME.UI.hideDialogue();
        // Otherwise: grab a nearby loose pickup first; if none, interact/talk.
        else if (!tryCollectPickup()) tryInteract();
      }
      // Q deconstructs the nearest placed block, refunding the item.
      if (e.code === 'KeyQ') deconstructNearby();
      // F eats the selected food (or any food in inventory) to restore hunger.
      if (e.code === 'KeyF') tryEat();
      // P saves the game manually.
      if (e.code === 'KeyP') { GAME.State.save(); }
      // Weapon switching: [ and ] cycle through unlocked weapons.
      if (e.code === 'BracketLeft')  { GAME.State.cycleWeapon(-1); }
      if (e.code === 'BracketRight') { GAME.State.cycleWeapon(1); }
      // Toggle crafting panel with C. While it's open we release the
      // pointer lock so the player can click recipes with the cursor.
      if (e.code === 'KeyC') {
        const open = GAME.UI.toggleCraft();
        if (open && locked) document.exitPointerLock();
        return;
      }
      if (e.code === 'Space' && onGround) {
        velY = cfg.jumpForce; onGround = false;
        GAME.Events.emit('player:jump', {});
      }
      // Hotbar selection 1..9 and 0 for slot 10
      if (/^Digit[0-9]$/.test(e.code)) {
        const n = e.code === 'Digit0' ? 9 : parseInt(e.code.slice(5), 10) - 1;
        if (n < GAME.Config.hotbarSlots) {
          GAME.State.activeSlot = n;
          GAME.Events.emit('resource:select', { slot: GAME.State.activeSlot });
        }
      }
    });
    document.addEventListener('keyup', (e) => { keys[e.code] = false; });
  }

  function tryInteract() {
    // Find nearest interactable within range.
    let nearest = null, best = cfg.interactRange;
    for (const it of world.interactables) {
      const d = Math.hypot(it.position.x - pos.x, it.position.z - pos.z);
      if (d < best) { best = d; nearest = it; }
    }
    // Talking to an NPC opens the dialogue box (story layer can override).
    if (nearest && nearest.type === 'npc') {
      GAME.Events.emit('npc:talk', { id: nearest.id, name: nearest.name || 'Stranger' });
    } else if (nearest && nearest.type === 'rocket') {
      GAME.Events.emit('player:interact', { target: { id: nearest.id, type: nearest.type }, position: pos.clone() });
      return;
    }
    GAME.Events.emit('player:interact', {
      target: nearest ? { id: nearest.id, type: nearest.type } : null,
      position: pos.clone(),
    });
  }

  /* Build the viewmodel for the currently-equipped weapon and attach it to
     the camera (lower-right). Rebuilt whenever the weapon changes. */
  function buildWeapon() {
    if (axe) { camera.remove(axe); axe = null; }
    const w = GAME.State.activeWeapon();
    axe = new THREE.Group();
    const woodMat  = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x9098a3, roughness: 0.4, metalness: 0.7 });

    // Distinct procedural viewmodels for each weapon. Shared palette:
    const steel  = new THREE.MeshStandardMaterial({ color: 0xcfd6df, roughness: 0.3, metalness: 0.85 });
    const dark   = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.5, metalness: 0.7 });
    const gold   = new THREE.MeshStandardMaterial({ color: 0xe8c65a, roughness: 0.35, metalness: 0.8 });
    const leather= new THREE.MeshStandardMaterial({ color: 0x5a3d28, roughness: 0.9 });
    const stone  = new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.95 });
    const wrap = (mesh) => { axe.add(mesh); return mesh; };

    if (w.shape === 'dagger') {
      // Short leather-wrapped grip, small guard, tapered blade.
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.18, 8), leather); wrap(grip);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.05), gold); guard.position.y = 0.1; wrap(guard);
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.42, 4), steel);
      blade.position.y = 0.32; blade.rotation.y = Math.PI / 4; wrap(blade);
      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), gold); pommel.position.y = -0.1; wrap(pommel);

    } else if (w.shape === 'axe') {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.8, 8), woodMat); wrap(handle);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.28), metalMat);
      head.position.set(0, 0.36, -0.14); wrap(head);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.1), steel);
      blade.position.set(0, 0.36, -0.30); wrap(blade);

    } else if (w.shape === 'sword') {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.24, 8), leather); wrap(handle);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.08), gold); guard.position.y = 0.14; wrap(guard);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.92, 0.03), steel); blade.position.y = 0.63; wrap(blade);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 4), steel); tip.position.y = 1.15; tip.rotation.y = Math.PI/4; wrap(tip);
      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), gold); pommel.position.y = -0.02; wrap(pommel);

    } else if (w.shape === 'spear') {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 8), woodMat); shaft.position.y = 0.35; wrap(shaft);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), gold); collar.position.y = 1.05; wrap(collar);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.36, 8), steel); tip.position.y = 1.28; wrap(tip);

    } else if (w.shape === 'mace') {
      // Metal haft, flanged spherical head.
      const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.6, 8), dark); haft.position.y = 0.1; wrap(haft);
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), steel); ball.position.y = 0.5; wrap(ball);
      for (let i = 0; i < 6; i++) {
        const flange = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.02), steel);
        flange.position.set(Math.cos(i * 1.05) * 0.13, 0.5, Math.sin(i * 1.05) * 0.13);
        flange.lookAt(0, 0.5, 0); wrap(flange);
      }

    } else if (w.shape === 'club') {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.55, 8), woodMat); wrap(handle);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.4, 10),
        new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 })); head.position.y = 0.5; wrap(head);
      for (let i = 0; i < 6; i++) {
        const stud = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 6), steel);
        stud.position.set(Math.cos(i) * 0.15, 0.45 + (i % 2) * 0.12, Math.sin(i) * 0.15);
        stud.lookAt(0, stud.position.y, 0); wrap(stud);
      }

    } else if (w.shape === 'battleaxe') {
      // Long haft, big double-bit crescent head.
      const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 1.0, 8), woodMat); haft.position.y = 0.2; wrap(haft);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 8), dark); hub.position.y = 0.72; hub.rotation.x = Math.PI/2; wrap(hub);
      for (const s of [-1, 1]) {
        const bit = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 16, 1, false, 0, Math.PI), steel);
        bit.position.set(0, 0.72, s * 0.12); bit.rotation.set(Math.PI/2, 0, s > 0 ? 0 : Math.PI); wrap(bit);
      }

    } else if (w.shape === 'katana') {
      // Long slightly-curved single-edge blade, tsuba guard, wrapped tsuka.
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.3, 8), dark); grip.position.y = -0.05; wrap(grip);
      const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 16), gold); tsuba.position.y = 0.12; tsuba.rotation.x = Math.PI/2; wrap(tsuba);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 0.02), steel); blade.position.set(0, 0.64, 0); blade.rotation.z = 0.06; wrap(blade);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 4), steel); tip.position.set(0.075, 1.16, 0); tip.rotation.set(0, Math.PI/4, 0.4); wrap(tip);

    } else if (w.shape === 'warhammer') {
      // Heavy metal haft, big boxy hammer head with a back spike.
      const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 1.0, 8), dark); haft.position.y = 0.15; wrap(haft);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.24), steel); head.position.y = 0.68; wrap(head);
      const face = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.26), dark); face.position.set(0.17, 0.68, 0); wrap(face);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 6), steel); spike.position.set(-0.2, 0.68, 0); spike.rotation.z = Math.PI/2; wrap(spike);

    } else if (w.shape === 'glaive') {
      // Very long pole with a broad curved single-edge blade at the top.
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.6, 8), woodMat); pole.position.y = 0.4; wrap(pole);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8), gold); collar.position.y = 1.2; wrap(collar);
      const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 24, 1, false, 0, Math.PI * 0.7), steel);
      blade.position.set(0.06, 1.5, 0); blade.rotation.set(Math.PI/2, 0, -0.4); wrap(blade);

    } else { // fallback simple blade
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8), leather); wrap(handle);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.7, 0.03), steel); blade.position.y = 0.5; wrap(blade);
    }

    // Rest pose: lower-right of the view, tilted so the head reads forward.
    axe.position.set(0.42, -0.5, -0.8);
    axe.rotation.set(-0.5, 0.2, 0.15);
    axe.userData.rest = axe.rotation.clone();
    camera.add(axe);
  }

  function swingAxe() {
    if (attackCooldown > 0 || swinging) return;
    swinging = true;
    swingT = 0;
    attackCooldown = GAME.State.activeWeapon().cooldown;
  }

  // 50% chance to swing when an alien touches you; otherwise you take the hit.
  function tryDefendOnContact() {
    if (Math.random() < 0.5) {
      swingAxe();
      return false;
    }
    return true;
  }

  function isPaused() { return !locked; }

  // Advance the swing animation and, at the strike midpoint, resolve a hit.
  function updateSwing(dt) {
    if (attackCooldown > 0) attackCooldown -= dt;
    if (!axe) return;

    if (swinging) {
      swingT += dt;
      const dur = 0.28;
      const k = Math.min(1, swingT / dur);
      // Ease down then back up: a chop.
      const chop = Math.sin(k * Math.PI);
      axe.rotation.x = axe.userData.rest.x - chop * 1.3;
      axe.rotation.z = axe.userData.rest.z + chop * 0.25;

      // Resolve the hit once, at the midpoint of the swing.
      if (!axe.userData.hitDone && k >= 0.5) {
        axe.userData.hitDone = true;
        resolveHit();
      }
      if (k >= 1) { swinging = false; axe.userData.hitDone = false; axe.rotation.copy(axe.userData.rest); }
    }
  }

  /* Nearest harvestable or enemy within autoHitRadius. */
  function hasNearbyTarget() {
    const r = cfg.autoHitRadius || 5;
    if (world.enemies) {
      for (const e of world.enemies) {
        if (e.mesh && Math.hypot(e.x - pos.x, e.z - pos.z) < r) return true;
      }
    }
    for (const h of world.harvestables) {
      if (Math.hypot(h.position.x - pos.x, h.position.z - pos.z) < r + (h.radius || 2)) return true;
    }
    return false;
  }

  /* Apply a hit to the closest target within autoHitRadius (no click/gesture). */
  function resolveHit() {
    const w = GAME.State.activeWeapon();
    const damage = w.damage;
    const r = cfg.autoHitRadius || 5;

    const eRes = world.attackEnemy(pos.x, pos.z, r, damage);
    if (eRes) {
      GAME.Events.emit('player:attack', { targetId: eRes.id, enemy: true, killed: eRes.killed });
      if (eRes.killed) {
        GAME.State.addXP(GAME.Config.enemies.xp);
        GAME.State.recordKill();
        GAME.Events.emit('enemy:killed', { id: eRes.id });
      }
      return;
    }

    let best = null, bestDist = Infinity;
    for (const h of world.harvestables) {
      const dx = h.position.x - pos.x, dz = h.position.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > r + (h.radius || 2)) continue;
      if (dist < bestDist) { bestDist = dist; best = h; }
    }
    if (!best) return;

    const res = world.harvestHit(best.id, damage);
    if (!res) return;
    GAME.Events.emit('player:attack', { targetId: best.id, resource: res.resource, destroyed: res.destroyed });
    // Per-hit drop (e.g. bark from trees) on every successful strike…
    if (res.perHitResource) GAME.State.addResource(res.perHitResource, 1);
    // …and the main resource when the object is fully harvested.
    if (res.destroyed) GAME.State.addResource(res.resource, 1);
  }

  /* Place the currently-selected hotbar item, if it's a placeable block.
     Placement point is a short distance in front of the player. */
  function placeSelectedBlock() {
    const itemId = GAME.State.hotbar[GAME.State.activeSlot];
    if (!itemId) { GAME.UI.toast('Select a block in your hotbar (1-9, 0)'); return; }
    const def = GAME.State.itemDef(itemId);
    if (!def) { GAME.UI.toast('Nothing to place'); return; }
    if (GAME.State.getResourceCount(itemId) < 1) { GAME.UI.toast('You have none of that to place'); return; }

    // Aim point in front of the player along the look direction…
    const dist = Math.min(GAME.Config.build.range, 5);
    const aimX = pos.x - Math.sin(yaw) * dist;
    const aimZ = pos.z - Math.cos(yaw) * dist;

    // …then SNAP to a clean grid so blocks tile flush like Minecraft.
    const grid = GAME.Config.build.blockSize;
    const tx = Math.round(aimX / grid) * grid;
    const tz = Math.round(aimZ / grid) * grid;

    // Reject if this exact grid cell is already occupied (a placed block),
    // or if the cell would bury into a natural prop (tree/rock/building).
    const half = grid / 2;
    for (const c of world.colliders) {
      const d = Math.hypot(tx - c.x, tz - c.z);
      if (c.grid) {
        // Placed blocks tile flush — only reject an exact same-cell repeat.
        if (d < half) { GAME.UI.toast('That spot is taken'); return; }
      } else {
        // Natural props (tree/rock/building): reject if the cell would bury into them.
        if (d < c.r + half - 0.05) { GAME.UI.toast('Too close to something'); return; }
      }
    }

    // Don't drop a block on the tile you're standing in.
    if (Math.hypot(tx - pos.x, tz - pos.z) < half) { GAME.UI.toast('Step back to place here'); return; }

    const block = world.placeBlock(itemId, tx, tz);
    if (!block) return;
    GAME.State.removeItem(itemId, 1);
    GAME.Events.emit('build:place', { item: itemId, x: tx, z: tz });
  }

  /* Deconstruct the nearest placed block and refund the crafted item. */
  function deconstructNearby() {
    const itemId = world.removeNearestBlock(pos.x, pos.z, 4);
    if (!itemId) { GAME.UI.toast('No placed block nearby to break'); return; }
    GAME.State.addResource(itemId, 1);          // refund the item
    GAME.Events.emit('build:remove', { item: itemId });
  }

  /* Grab the nearest loose pickup within range. Returns true if one was
     collected (so E doesn't also fire an interact). */
  function tryCollectPickup(pickupRange) {
    const range = pickupRange ?? ((GAME.Config.forage && GAME.Config.forage.pickupRange) || 3.5);
    const got = world.collectNearestPickup(pos.x, pos.z, range);
    if (!got) return false;
    GAME.State.addResource(got.resource, 1);
    GAME.Events.emit('forage:collect', { resource: got.resource, label: got.label });
    const def = GAME.State.itemDef(got.resource);
    if (def && def.restoreHunger) GAME.State.eat(got.resource);
    return true;
  }

  /* Eat the selected hotbar food if it's edible; else the first food in
     inventory. Restores hunger via gameState. */
  function tryEat() {
    const selected = GAME.State.hotbar[GAME.State.activeSlot];
    if (selected && GAME.State.eat(selected)) return;
    // Fall back to any edible item in the inventory.
    const food = GAME.State.inventory.find((it) => GAME.State.itemDef(it.id)?.restoreHunger);
    if (food) GAME.State.eat(food.id);
    else GAME.UI.toast('No food to eat');
  }

  /* Cooking has been removed from the game. */

  function blocked(nx, nz) {
    for (const c of world.colliders) {
      if (Math.hypot(nx - c.x, nz - c.z) < c.r + 1.0) {
        // Placed blocks are climbable: if our feet are at/above the block's
        // top, don't block horizontally — we're walking on top of it.
        if (c.grid && c.top != null && (pos.y - cfg._eye) >= c.top - 0.1) continue;
        return true;
      }
    }
    return false;
  }

  function update(dt) {
    // Orientation
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;

    // Freeze movement input while the crafting panel is open (cursor is free).
    if (GAME.UI.isCraftOpen && GAME.UI.isCraftOpen()) {
      camera.position.copy(pos);
      return;
    }

    // Pause (pointer unlocked): freeze player movement and combat.
    if (!locked) {
      camera.position.copy(pos);
      return;
    }

    // Axe swing animation + cooldown.
    updateSwing(dt);
    if (!swinging && attackCooldown <= 0 && hasNearbyTarget()) swingAxe();
    tryCollectPickup(cfg.autoHitRadius || 5);

    // Desired movement in camera-facing plane
    // WASD and the arrow keys are interchangeable for movement.
    const forward = ((keys['KeyW'] || keys['ArrowUp'])   ? 1 : 0) - ((keys['KeyS'] || keys['ArrowDown'])  ? 1 : 0);
    const strafe  = ((keys['KeyD'] || keys['ArrowRight']) ? 1 : 0) - ((keys['KeyA'] || keys['ArrowLeft']) ? 1 : 0);

    // Sprint is free now — the old stamina bar has become a SHIELD that
    // absorbs damage (see GAME.State.damage) and recharges on its own in
    // survivalTick, so sprinting no longer drains it.
    sprinting = (keys['ShiftLeft'] || keys['ShiftRight']) && (forward !== 0 || strafe !== 0);
    const speedBase = sprinting ? cfg.sprintSpeed : cfg.walkSpeed;
    const speed = speedBase * (GAME.State.character?.speedMod || 1);

    if (sprinting !== GAME.Player._wasSprint) {
      GAME.Player._wasSprint = sprinting;
      GAME.Events.emit('player:sprint', { active: sprinting });
    }

    const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
    let dx = (-sinY * forward + cosY * strafe);
    let dz = (-cosY * forward - sinY * strafe);
    const len = Math.hypot(dx, dz) || 1;
    dx = dx / len * speed * dt;
    dz = dz / len * speed * dt;

    // Track motion this frame so survival can deplete hunger only when moving.
    let movedThisFrame = 0;
    if (forward !== 0 || strafe !== 0) {
      const startX = pos.x, startZ = pos.z;
      // Sub-step the motion so a fast frame can't tunnel through a thin
      // collider. Move in small increments, testing each axis so we slide
      // along walls instead of passing through them.
      const dist = Math.hypot(dx, dz);
      const maxStep = 0.4;                    // world units per sub-step
      const steps = Math.max(1, Math.ceil(dist / maxStep));
      const sx = dx / steps, sz = dz / steps;
      for (let i = 0; i < steps; i++) {
        if (!blocked(pos.x + sx, pos.z)) pos.x += sx;
        if (!blocked(pos.x, pos.z + sz)) pos.z += sz;
      }
      movedThisFrame = Math.hypot(pos.x - startX, pos.z - startZ);

      // Throttle move events (~4/sec) for the story layer.
      moveThrottle += dt;
      if (moveThrottle > 0.25) {
        moveThrottle = 0;
        GAME.Events.emit('player:move', { x: pos.x, y: pos.y, z: pos.z });
      }
    }

    // Gravity + ground
    velY -= cfg.gravity * dt;
    pos.y += velY * dt;
    const surf = world.surfaceHeight ? world.surfaceHeight(pos.x, pos.z) : world.groundHeight(pos.x, pos.z);
    const groundY = surf + cfg._eye;
    if (pos.y <= groundY) {
      // Landed (or walking on/into the ground): snap to surface.
      pos.y = groundY;
      velY = 0;
      onGround = true;
    } else {
      // Above the surface — airborne, so jumping is disallowed until we land.
      onGround = false;
    }

    // Keep inside the map bounds
    const lim = GAME.Config.world.size / 2 - 4;
    pos.x = Math.max(-lim, Math.min(lim, pos.x));
    pos.z = Math.max(-lim, Math.min(lim, pos.z));

    camera.position.copy(pos);

    // Survival: hunger depletes only while moving; warmth/HP regen by campfire.
    const eps = (GAME.Config.survival.moveEpsilon || 0.02);
    const isMoving = movedThisFrame > eps;
    GAME.State.survivalTick(dt, pos, isMoving);

    // Night enemies: spawn/move/attack based on our position.
    world.updateEnemies(dt, pos);
  }

  function getPosition() { return pos.clone(); }

  // Rotate the view by a delta (radians). Used by pose/webcam turning so an
  // external controller can steer the camera without touching internals.
  function addYaw(d) { yaw += d; }
  // Current view yaw (radians). Used by the map overlay to draw facing.
  function getYaw() { return yaw; }

  return { init, update, getPosition, addYaw, getYaw, isPaused, tryDefendOnContact };
})();
