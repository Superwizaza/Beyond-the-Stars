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

  const pos = new THREE.Vector3(0, 0, 14); // spawn just outside the beacon ring

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
    });
    document.addEventListener('mousemove', (e) => {
      if (!locked) return;
      yaw   -= e.movementX * cfg.mouseSensitivity;
      pitch -= e.movementY * cfg.mouseSensitivity;
      pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
    });

    // Left-click to swing the axe — only once the pointer is locked
    // (the first click is consumed by requestPointerLock above).
    document.addEventListener('mousedown', (e) => {
      if (locked && e.button === 0) swingAxe();
    });

    // Right-click to place the selected placeable block.
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
      // Hotbar selection 1..6
      if (/^Digit[1-6]$/.test(e.code)) {
        GAME.State.activeSlot = parseInt(e.code.slice(5), 10) - 1;
        GAME.Events.emit('resource:select', { slot: GAME.State.activeSlot });
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

    // The handle points UP the group's +Y; the head sits at the top. The
    // group is then tilted so the blade faces forward (−Z), which fixes the
    // old axe pointing the wrong way.
    if (w.shape === 'axe') {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.8, 8), woodMat);
      axe.add(handle);
      // Axe head near the top, blade facing forward (−Z).
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.28), metalMat);
      head.position.set(0, 0.36, -0.14);
      axe.add(head);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.1), metalMat);
      blade.position.set(0, 0.36, -0.30);
      axe.add(blade);
    } else if (w.shape === 'sword') {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.24, 8), woodMat);
      axe.add(handle);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.08), metalMat);
      guard.position.y = 0.14; axe.add(guard);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.03), metalMat);
      blade.position.y = 0.62; axe.add(blade);
    } else if (w.shape === 'spear') {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 8), woodMat);
      shaft.position.y = 0.3; axe.add(shaft);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.32, 8), metalMat);
      tip.position.y = 1.15; axe.add(tip);
    } else { // club
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.55, 8), woodMat);
      axe.add(handle);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.4, 10),
        new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 }));
      head.position.y = 0.5; axe.add(head);
      // Studs.
      for (let i = 0; i < 4; i++) {
        const stud = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), metalMat);
        stud.position.set(Math.cos(i * 1.57) * 0.15, 0.5, Math.sin(i * 1.57) * 0.15);
        axe.add(stud);
      }
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

  /* Find the nearest harvestable in front of the player within axe range
     and apply a hit. Uses camera facing to require you to look at it. */
  function resolveHit() {
    const w = GAME.State.activeWeapon();
    const range = w.range, damage = w.damage;
    const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);

    // Enemies take priority: if one is within reach, strike it and stop.
    const eRes = world.attackEnemy(pos.x, pos.z, range + 1.5, damage);
    if (eRes) {
      GAME.Events.emit('player:attack', { targetId: eRes.id, enemy: true, killed: eRes.killed });
      if (eRes.killed) {
        GAME.State.addXP(GAME.Config.enemies.xp);
        GAME.State.recordKill();
        GAME.Events.emit('enemy:killed', { id: eRes.id });
      }
      return;
    }

    // Pick the CLOSEST harvestable that is (a) within reach of its surface
    // and (b) roughly in front of us. Closest-wins fixes hits landing on a
    // far tree instead of the rock right in front of you.
    let best = null, bestDist = Infinity;
    for (const h of world.harvestables) {
      const dx = h.position.x - pos.x, dz = h.position.z - pos.z;
      const dist = Math.hypot(dx, dz);
      const reach = range + (h.radius || 2);
      if (dist > reach) continue;
      // Facing check: dot of view-forward with direction to target.
      const dot = (dx / (dist || 1)) * fwdX + (dz / (dist || 1)) * fwdZ;
      // Allow a generous ~90° cone (dot > 0); very close targets skip the
      // facing requirement so you can always chop what you're standing on.
      if (dot < 0 && dist > (h.radius || 2)) continue;
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
    if (!itemId) { GAME.UI.toast('Select a block in your hotbar (1-6)'); return; }
    const def = GAME.State.itemDef(itemId);
    if (!def || !def.placeable) { GAME.UI.toast('That item is not placeable'); return; }
    if (GAME.State.getResourceCount(itemId) < 1) return;

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
  function tryCollectPickup() {
    const range = (GAME.Config.forage && GAME.Config.forage.pickupRange) || 3.5;
    const got = world.collectNearestPickup(pos.x, pos.z, range);
    if (!got) return false;
    GAME.State.addResource(got.resource, 1);
    GAME.Events.emit('forage:collect', { resource: got.resource, label: got.label });
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
      if (Math.hypot(nx - c.x, nz - c.z) < c.r + 1.0) return true;
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

    // Axe swing animation + cooldown.
    updateSwing(dt);

    // Desired movement in camera-facing plane
    // WASD and the arrow keys are interchangeable for movement.
    const forward = ((keys['KeyW'] || keys['ArrowUp'])   ? 1 : 0) - ((keys['KeyS'] || keys['ArrowDown'])  ? 1 : 0);
    const strafe  = ((keys['KeyD'] || keys['ArrowRight']) ? 1 : 0) - ((keys['KeyA'] || keys['ArrowLeft']) ? 1 : 0);

    const sn = GAME.State.stats.stamina;
    sprinting = (keys['ShiftLeft'] || keys['ShiftRight']) && (forward !== 0 || strafe !== 0) && sn > 0;
    const speedBase = sprinting ? cfg.sprintSpeed : cfg.walkSpeed;
    const speed = speedBase * (GAME.State.character?.speedMod || 1);

    // Stamina drain/regen
    const p = GAME.Config.progression;
    const maxSta = GAME.State.character?.maxStamina || p.maxStamina;
    if (sprinting) GAME.State.stats.stamina = Math.max(0, sn - p.staminaDrain * dt);
    else GAME.State.stats.stamina = Math.min(maxSta, sn + p.staminaRegen * dt);
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

    if (forward !== 0 || strafe !== 0) {
      const nx = pos.x + dx, nz = pos.z + dz;
      if (!blocked(nx, pos.z)) pos.x = nx;
      if (!blocked(pos.x, nz)) pos.z = nz;

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
    const groundY = world.groundHeight(pos.x, pos.z) + cfg._eye;
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

    // Survival: hunger / night-cold / campfire warmth, based on where we are.
    GAME.State.survivalTick(dt, pos);

    // Night enemies: spawn/move/attack based on our position.
    world.updateEnemies(dt, pos);
  }

  function getPosition() { return pos.clone(); }

  return { init, update, getPosition };
})();
