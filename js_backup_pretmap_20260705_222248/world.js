/* =========================================================
   world.js — THE MAP.
   Procedurally builds an explorable overworld: ground, hills,
   trees, rocks, simple buildings, sky + fog + lighting.

   Every notable prop is pushed to GAME.World.interactables with
   a { mesh, type, id } record so the story builder can attach
   quests/dialogue to specific objects without regenerating them.
   ========================================================= */
window.GAME = window.GAME || {};

GAME.World = (function () {
  const cfg = GAME.Config.world;
  let scene, colliders = [], interactables = [], harvestables = [];
  let pickups = [];             // { id, resource, mesh, x, z, baseY } loose collectibles
  let placedBlocks = [];        // { id, itemId, mesh, light, collider }
  let warmthSources = [];       // { x, z } of campfires/torches (for survival)
  let sun, hemi;                // lights driven by the day/night cycle
  let enemies = [];             // { id, mesh, hp, x, z, lastHit } night mobs
  let enemySpawnTimer = 0;      // accumulates dt for spawn cadence

  function build(sharedScene) {
    scene = sharedScene;
    scene.background = new THREE.Color(cfg.skyColor);
    scene.fog = new THREE.Fog(cfg.skyColor, cfg.fogNear, cfg.fogFar);

    addLights();
    addGround();
    addTrees();
    addRocks();
    addBuildings();
    addLandmark(); // central beacon — a natural first "objective" anchor for the story
    addNPC();      // placeholder villager the story layer can drive
    addForage();   // loose collectibles scattered on the ground (grab with E)

    return { colliders, interactables };
  }

  function addLights() {
    hemi = new THREE.HemisphereLight(0xbfe3ff, 0x4a7a3f, 0.7);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
    sun.position.set(80, 140, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 160;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.far = 400;
    scene.add(sun);
  }

  function addGround() {
    const size = cfg.size;
    const geo = new THREE.PlaneGeometry(size, size, 64, 64);
    // Gentle rolling hills via sine noise
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const h = Math.sin(x * 0.03) * Math.cos(y * 0.03) * 0.8
              + Math.sin(x * 0.08 + y * 0.05) * 0.35;
      pos.setZ(i, h);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: cfg.groundColor, roughness: 1, flatShading: true });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // A subtle dirt path ring for visual interest
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(28, 32, 48),
      new THREE.MeshStandardMaterial({ color: 0x7a6a4f, roughness: 1, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    scene.add(ring);
  }

  function rand(min, max) { return min + Math.random() * (max - min); }
  function scatterPos(margin = 20) {
    const half = cfg.size / 2 - margin;
    return { x: rand(-half, half), z: rand(-half, half) };
  }

  function addTrees() {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
    const leafMats = [0x2f6b34, 0x3a7d40, 0x276b2f].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
    for (let i = 0; i < cfg.treeCount; i++) {
      const p = scatterPos();
      if (Math.hypot(p.x, p.z) < 12) continue; // keep spawn clear
      const tree = new THREE.Group();
      const h = rand(4, 7);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, h, 6), trunkMat);
      trunk.position.y = h / 2; trunk.castShadow = true; tree.add(trunk);
      const foliage = new THREE.Mesh(new THREE.ConeGeometry(rand(2, 3), rand(4, 6), 7),
        leafMats[i % leafMats.length]);
      foliage.position.y = h + 1.5; foliage.castShadow = true; tree.add(foliage);
      // Sit the tree ON the terrain surface (fixes floating / walk-under).
      tree.position.set(p.x, groundHeight(p.x, p.z), p.z);
      scene.add(tree);
      const collider = { x: p.x, z: p.z, r: 1.2 };
      colliders.push(collider);
      harvestables.push({
        id: 'tree_' + i, type: 'tree',
        resource: 'wood',           // dropped when felled
        mesh: tree, collider,
        position: tree.position.clone(),
        hp: 3, maxHp: 3,       // hits to fell
        radius: 2.5,           // how close the swing must land
      });
    }
  }

  function addRocks() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 1, flatShading: true });
    for (let i = 0; i < cfg.rockCount; i++) {
      const p = scatterPos();
      if (Math.hypot(p.x, p.z) < 10) continue;
      const s = rand(0.8, 2.4);
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mat);
      // Sit the rock ON the terrain surface.
      rock.position.set(p.x, groundHeight(p.x, p.z) + s * 0.35, p.z);
      rock.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      rock.castShadow = true; rock.receiveShadow = true;
      scene.add(rock);
      const collider = { x: p.x, z: p.z, r: s };
      colliders.push(collider);
      harvestables.push({
        id: 'rock_' + i, type: 'rock', resource: 'stone',
        mesh: rock, collider,
        position: rock.position.clone(),
        hp: 4, maxHp: 4,       // stone is tougher than wood
        radius: s + 1.8,
      });
    }
  }

  function addBuildings() {
    for (let i = 0; i < cfg.buildingCount; i++) {
      const p = scatterPos(40);
      if (Math.hypot(p.x, p.z) < 24) continue;
      const w = rand(6, 12), d = rand(6, 12), h = rand(5, 11);
      const wallMat = new THREE.MeshStandardMaterial({ color: [0xcbb89d, 0xb0a08a, 0xd8c8ae][i % 3], roughness: 1 });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a3b2f, roughness: 1, flatShading: true });
      const b = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true; b.add(body);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.8, 3, 4), roofMat);
      roof.position.y = h + 1.5; roof.rotation.y = Math.PI / 4; roof.castShadow = true; b.add(roof);
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x4a3626 }));
      door.position.set(0, 1.5, d / 2 + 0.05); b.add(door);
      // Sit the building on the terrain (sink slightly so no gap under walls).
      b.position.set(p.x, groundHeight(p.x, p.z) - 0.3, p.z);
      b.rotation.y = rand(0, Math.PI * 2);
      scene.add(b);
      colliders.push({ x: p.x, z: p.z, r: Math.max(w, d) / 2 });
      interactables.push({ mesh: b, type: 'building', id: 'building_' + i, position: b.position.clone() });
    }
  }

  // Central beacon — high-visibility anchor the story can turn into a goal.
  function addLandmark() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 1.5, 12),
      new THREE.MeshStandardMaterial({ color: 0x2d3748, roughness: 0.8 }));
    base.position.y = 0.75; base.castShadow = true; g.add(base);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(2.2, 0),
      new THREE.MeshStandardMaterial({ color: 0x4ea1ff, emissive: 0x1a4d80, roughness: 0.2, metalness: 0.4 }));
    crystal.position.y = 4.5; crystal.castShadow = true; g.add(crystal);
    g.userData.spin = crystal;
    scene.add(g);
    colliders.push({ x: 0, z: 0, r: 3.5 });
    interactables.push({ mesh: g, type: 'landmark', id: 'beacon', position: new THREE.Vector3(0, 0, 0) });
    GAME.World._beacon = g;
  }

  // Ground height sampler (matches addGround formula) — for player grounding.
  function groundHeight(x, z) {
    return Math.sin(x * 0.03) * Math.cos(z * 0.03) * 0.8
         + Math.sin(x * 0.08 + z * 0.05) * 0.35;
  }

  // Called each frame from main loop for ambient animation.
  function update(dt, t) {
    if (GAME.World._beacon) GAME.World._beacon.userData.spin.rotation.y += dt * 0.6;
    // Bob + slowly spin loose pickups so they read as collectibles.
    for (const p of pickups) {
      if (!p.mesh) continue;
      p.mesh.position.y = p.baseY + Math.sin(t * 2 + p.mesh.userData.phase) * 0.15;
      p.mesh.rotation.y += dt * 1.2;
    }
  }

  /* A simple placeholder NPC near spawn — a body + head, tagged as an
     interactable of type 'npc' so the dialogue system can drive it. */
  function addNPC() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.8 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xe0b088, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 2.2, 8), bodyMat);
    body.position.y = 1.1; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 12), headMat);
    head.position.y = 2.6; head.castShadow = true; g.add(head);
    // A little marker so you can spot the NPC.
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x4ea1ff, roughness: 0.6 }));
    hat.position.y = 3.15; g.add(hat);

    const nx = 8, nz = 6;
    g.position.set(nx, groundHeight(nx, nz), nz);
    scene.add(g);
    colliders.push({ x: nx, z: nz, r: 1.0 });
    interactables.push({ mesh: g, type: 'npc', id: 'villager_elda', name: 'Elda', position: g.position.clone() });
  }

  /* Scatter loose collectibles across the terrain per GAME.Config.forage.
     Each is a small bobbing mesh you grab with E (no collider — you walk
     over them). */
  function addForage() {
    const fcfg = GAME.Config.forage;
    if (!fcfg) return;
    let idx = 0;
    fcfg.scatter.forEach((kind) => {
      for (let i = 0; i < kind.count; i++) {
        const p = scatterPos(16);
        if (Math.hypot(p.x, p.z) < 8) continue; // keep spawn tidy
        const mesh = buildPickupMesh(kind);
        const baseY = groundHeight(p.x, p.z) + 0.6;
        mesh.position.set(p.x, baseY, p.z);
        mesh.userData.phase = Math.random() * Math.PI * 2; // desync the bob
        scene.add(mesh);
        pickups.push({
          id: 'pickup_' + (idx++), resource: kind.resource,
          label: kind.label, mesh, x: p.x, z: p.z, baseY,
        });
      }
    });
  }

  /* Build a small mesh for a forage kind (berries/mushroom/stick/pebble). */
  function buildPickupMesh(kind) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: kind.color, roughness: 0.7 });
    if (kind.shape === 'cluster') {
      // A few small spheres bunched like berries.
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), mat);
        b.position.set((i - 1) * 0.18, Math.random() * 0.1, (Math.random() - 0.5) * 0.2);
        g.add(b);
      }
    } else if (kind.shape === 'mushroom') {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.28, 6),
        new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.9 }));
      g.add(stem);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      cap.position.y = 0.16; g.add(cap);
    } else if (kind.shape === 'stick') {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), mat);
      s.rotation.z = Math.PI / 2.3; g.add(s);
    } else { // pebble
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), mat);
      g.add(s);
    }
    g.castShadow = true;
    return g;
  }

  /* Grab the nearest pickup within `range` of (x,z). Removes it from the
     world and returns { resource, label } or null. */
  function collectNearestPickup(x, z, range) {
    let best = null, bestD = range;
    for (const p of pickups) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return null;
    if (best.mesh) scene.remove(best.mesh);
    pickups = pickups.filter((p) => p !== best);
    return { resource: best.resource, label: best.label };
  }

  /* Spawn a single loose pickup on the ground at (x,z). Used both for
     forage scatter and for enemy "remains" drops. Returns the record. */
  function spawnGroundPickup(resource, x, z) {
    const rdef = GAME.Config.resources[resource] || {};
    const kind = {
      resource,
      color: rdef.pickupColor || 0xb5533b,
      shape: rdef.pickupShape || 'cluster',
      label: rdef.name || resource,
    };
    const mesh = buildPickupMesh(kind);
    const baseY = groundHeight(x, z) + 0.6;
    mesh.position.set(x, baseY, z);
    mesh.userData.phase = Math.random() * Math.PI * 2;
    scene.add(mesh);
    const rec = { id: 'pickup_drop_' + Date.now() + '_' + Math.floor(Math.random()*1000),
      resource, label: kind.label, mesh, x, z, baseY };
    pickups.push(rec);
    return rec;
  }

  /* ---------- Night enemies ---------- */

  function buildEnemyMesh() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a2f4a, roughness: 0.9, emissive: 0x120a1c });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff3b3b, emissiveIntensity: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.0, 0.8), bodyMat);
    body.position.y = 1.0; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), bodyMat);
    head.position.y = 2.3; head.castShadow = true; g.add(head);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), eyeMat);
      eye.position.set(s * 0.16, 2.35, 0.36); g.add(eye);
    }
    return g;
  }

  function spawnEnemy(playerPos) {
    const ec = GAME.Config.enemies;
    const ang = Math.random() * Math.PI * 2;
    const dist = ec.spawnMinDist + Math.random() * (ec.spawnMaxDist - ec.spawnMinDist);
    let x = (playerPos ? playerPos.x : 0) + Math.cos(ang) * dist;
    let z = (playerPos ? playerPos.z : 0) + Math.sin(ang) * dist;
    const lim = cfg.size / 2 - 6;
    x = Math.max(-lim, Math.min(lim, x));
    z = Math.max(-lim, Math.min(lim, z));
    const mesh = buildEnemyMesh();
    mesh.position.set(x, groundHeight(x, z), z);
    scene.add(mesh);
    enemies.push({ id: 'enemy_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      mesh, hp: ec.hp, x, z, lastHit: 0 });
  }

  /* Advance enemies: spawn at night up to the cap, move toward the player,
     deal contact damage, and despawn all at dawn. Driven from player.update
     with the live player position. */
  /* Advance enemies: spawn (up to the cap) only while the current RPG stage
     has combat enabled, move toward the player, deal contact damage. When
     combat is off, despawn any remaining enemies. Driven from player.update
     with the live player position. */
  /* True if an enemy body of ~0.8 radius at (nx,nz) overlaps a world
     collider (trees/rocks/buildings/placed blocks). Keeps mobs from
     clipping through solid props. */
  function enemyBlocked(nx, nz) {
    const body = 0.8;
    for (const c of colliders) {
      if (Math.hypot(nx - c.x, nz - c.z) < c.r + body) return true;
    }
    return false;
  }

  function updateEnemies(dt, playerPos) {
    const ec = GAME.Config.enemies;
    const st = GAME.State.currentStage && GAME.State.currentStage();
    const combat = !!(st && st.spawnEnemies) && !GAME.State.won;

    // No combat this stage → clear the field.
    if (!combat) {
      if (enemies.length) {
        enemies.forEach((e) => { if (e.mesh) scene.remove(e.mesh); });
        enemies = [];
      }
      return;
    }

    // Spawn cadence while combat is active.
    enemySpawnTimer += dt;
    if (enemySpawnTimer >= ec.spawnInterval && enemies.length < ec.maxActive) {
      enemySpawnTimer = 0;
      spawnEnemy(playerPos);
    }

    if (!playerPos) return;
    for (const e of enemies) {
      // Move toward the player on the XZ plane.
      const dx = playerPos.x - e.x, dz = playerPos.z - e.z;
      const d = Math.hypot(dx, dz) || 1;
      // Stop pushing into the player once touching.
      if (d > ec.touchRange) {
        const stepX = (dx / d) * ec.speed * dt;
        const stepZ = (dz / d) * ec.speed * dt;
        // Collide against world props so enemies can't walk through them.
        // Try each axis independently so they slide along obstacles.
        if (!enemyBlocked(e.x + stepX, e.z)) e.x += stepX;
        if (!enemyBlocked(e.x, e.z + stepZ)) e.z += stepZ;
        e.mesh.position.set(e.x, groundHeight(e.x, e.z), e.z);
        // Face the player.
        e.mesh.rotation.y = Math.atan2(dx, dz);
      } else {
        // Contact damage on cooldown.
        e.lastHit -= dt;
        if (e.lastHit <= 0) {
          e.lastHit = ec.contactCooldown;
          GAME.State.damage(ec.contactDamage);
          GAME.Events.emit('enemy:hit', { damage: ec.contactDamage });
        }
      }
    }
  }

  /* Axe strike against enemies: damage the nearest within `range` in front.
     Returns { killed, id } or null. */
  function attackEnemy(x, z, range, damage) {
    let best = null, bestD = range;
    for (const e of enemies) {
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) return null;
    best.hp -= damage;
    // Flash: nudge upward briefly.
    if (best.mesh) best.mesh.position.y = groundHeight(best.x, best.z) + 0.3;
    if (best.hp <= 0) {
      const dropX = best.x, dropZ = best.z;
      if (best.mesh) scene.remove(best.mesh);
      enemies = enemies.filter((e) => e !== best);
      // Slain enemy leaves remains: a food pickup the player collects with E.
      spawnGroundPickup('meat', dropX, dropZ);
      return { killed: true, id: best.id };
    }
    return { killed: false, id: best.id };
  }

  function enemyCount() { return enemies.length; }

  /* ---------- Save / load helpers for placed blocks ---------- */

  function serializeBlocks() {
    return placedBlocks.map((b) => ({ itemId: b.itemId, x: b.x, z: b.z }));
  }

  /* Rebuild placed blocks from saved data (clears existing first). */
  function restoreBlocks(list) {
    // Remove current placed blocks.
    placedBlocks.slice().forEach((b) => removeNearestBlock(b.x, b.z, 0.1));
    (list || []).forEach((b) => placeBlock(b.itemId, b.x, b.z));
  }

  /* Apply one axe hit to a harvestable by id. Returns
     { resource, destroyed, hp } or null if not found/already gone. */
  function harvestHit(id, damage = 1) {
    const h = harvestables.find((x) => x.id === id);
    if (!h) return null;
    h.hp -= damage;

    // Little "shake" feedback so a hit reads even before it breaks.
    if (h.mesh) {
      h.mesh.position.x = h.position.x + (Math.random() - 0.5) * 0.15;
      h.mesh.position.z = h.position.z + (Math.random() - 0.5) * 0.15;
      setTimeout(() => { if (h.mesh) h.mesh.position.set(h.position.x, h.mesh.position.y, h.position.z); }, 80);
    }

    if (h.hp <= 0) {
      // Remove mesh from the scene and drop its collider so you can walk through.
      if (h.mesh) scene.remove(h.mesh);
      const ci = colliders.indexOf(h.collider);
      if (ci !== -1) colliders.splice(ci, 1);
      const hi = harvestables.indexOf(h);
      if (hi !== -1) harvestables.splice(hi, 1);
      return { resource: h.resource, perHitResource: h.perHitResource, destroyed: true, hp: 0 };
    }
    return { resource: h.resource, perHitResource: h.perHitResource, destroyed: false, hp: h.hp };
  }

  /* Place a crafted block at (x,z) sitting on the terrain. Adds a solid
     collider so the player can't walk through it. Returns the mesh. */
  function placeBlock(itemId, x, z) {
    // Resolve from EITHER catalog so the player can place crafted blocks
    // (stoneblock/woodwall/campfire/torch) AND raw gathered resources
    // (wood/stone/etc.) directly, Minecraft-style.
    const def = (GAME.Config.craftables && GAME.Config.craftables[itemId])
             || (GAME.Config.resources && GAME.Config.resources[itemId]) || null;
    if (!def) return null;
    const size = GAME.Config.build.blockSize;
    const gy = groundHeight(x, z);
    const isLight = (itemId === 'campfire' || itemId === 'torch');
    // Block color: explicit color for craftables, else a resource tint, else grey.
    const RESOURCE_TINT = { wood: 0x8a5a2f, stone: 0x9098a3, berries: 0xcc2b52,
                            mushroom: 0xd98a5a, meat: 0xb5533b };
    const blockColor = def.color || RESOURCE_TINT[itemId] || 0x999999;

    const mat = new THREE.MeshStandardMaterial({
      color: blockColor,
      emissive: isLight ? blockColor : 0x000000,
      emissiveIntensity: isLight ? 0.6 : 0,
      roughness: 0.8,
    });
    const block = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat);
    block.position.set(x, gy + size / 2, z);
    block.castShadow = true; block.receiveShadow = true;
    scene.add(block);

    // Light sources actually light the scene.
    let light = null;
    if (isLight) {
      light = new THREE.PointLight(blockColor || 0xffaa33, 1.2, 18);
      light.position.set(x, gy + size + 0.5, z);
      scene.add(light);
      warmthSources.push({ x, z, itemId });
    }

    // Tag as a grid block so placement logic can tile these flush.
    const collider = { x, z, r: size * 0.6, grid: true };
    colliders.push(collider);
    const blockId = itemId + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const inter = { mesh: block, type: 'block', id: blockId, position: block.position.clone() };
    interactables.push(inter);
    const record = { id: blockId, itemId, mesh: block, light, collider, x, z };
    placedBlocks.push(record);
    return block;
  }

  /* Deconstruct: find the nearest placed block within `range` of (x,z) and
     remove it (mesh, light, collider, warmth). Returns the itemId that
     should be refunded, or null if nothing was in range. */
  function removeNearestBlock(x, z, range = 3.5) {
    let best = null, bestD = range;
    for (const b of placedBlocks) {
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (!best) return null;

    if (best.mesh) scene.remove(best.mesh);
    if (best.light) scene.remove(best.light);
    const ci = colliders.indexOf(best.collider);
    if (ci !== -1) colliders.splice(ci, 1);
    const ii = interactables.findIndex((it) => it.id === best.id);
    if (ii !== -1) interactables.splice(ii, 1);
    // Drop any warmth source at this spot.
    warmthSources = warmthSources.filter((w) => !(w.x === best.x && w.z === best.z));
    placedBlocks = placedBlocks.filter((b) => b !== best);
    return best.itemId;
  }

  /* Survival: is (x,z) within warmth radius of any campfire/torch? */
  function isWarm(x, z) {
    const r = GAME.Config.survival.warmthRadius;
    return warmthSources.some((w) => Math.hypot(w.x - x, w.z - z) < r);
  }

  /* Survival: is (x,z) within range of a campfire specifically? (retained helper) */
  function nearCampfire(x, z) {
    const r = GAME.Config.survival.warmthRadius;
    return warmthSources.some((w) => w.itemId === 'campfire' && Math.hypot(w.x - x, w.z - z) < r);
  }

  return {
    build, groundHeight, update, harvestHit, placeBlock, removeNearestBlock,
    spawnGroundPickup,
    isWarm, nearCampfire, collectNearestPickup,
    updateEnemies, attackEnemy, enemyCount,
    serializeBlocks, restoreBlocks,
    get colliders() { return colliders; },
    get interactables() { return interactables; },
    get harvestables() { return harvestables; },
    get pickups() { return pickups; },
    get warmthSources() { return warmthSources; },
    get enemies() { return enemies; },
  };
})();
