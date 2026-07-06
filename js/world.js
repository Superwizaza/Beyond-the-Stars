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
  // ---- Day/Night clock ----
  let clock = 0;                // seconds elapsed in the current cycle
  let isNightNow = false;       // true during the night phase
  let cycleCount = 0;           // how many full day+night cycles have passed
  let _warnedThisCycle = false; // dusk warning fired for this day

  let _stars = null;
  let _galaxies = null;

  function build(sharedScene) {
    scene = sharedScene;
    scene.background = new THREE.Color(cfg.skyColor);
    scene.fog = new THREE.Fog(cfg.skyColor, cfg.fogNear, cfg.fogFar);

    addLights();
    addGround();
    addTrees();
    addRocks();
    addBuildings();
    addStructures();
    addMerchantAndRocket();
    addForage();
    addStars();
    addGalaxies();

    return { colliders, interactables };
  }

  function addLights() {
    hemi = new THREE.HemisphereLight(0xbfe3ff, 0x4a7a3f, 0.7);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
    sun.position.set(80, 140, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const d = 160;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.far = 400;
    scene.add(sun);
  }

  function addGround() {
    const size = cfg.size;
    const geo = new THREE.PlaneGeometry(size, size, 128, 128);
    // Gentle rolling hills via sine noise
    const pos = geo.attributes.position;
    const colorArr = new Float32Array(pos.count * 3);
    const _c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const h = Math.sin(x * 0.03) * Math.cos(y * 0.03) * 0.8
              + Math.sin(x * 0.08 + y * 0.05) * 0.35;
      pos.setZ(i, h);
      // Per-biome vertex color. The plane is rotated -90° about X at the
      // end, so a geometry point (x, y) maps to world (x, 0, -y). Sample
      // biomeAt with those world coords so the ground tint lines up with
      // the props scattered by the same function.
      const b = biomeAt(x, -y);
      _c.copy(BIOME_GROUND[b] || BIOME_GROUND.plains);
      // Subtle per-vertex variation so large biome patches aren't flat.
      const jitter = 0.92 + Math.random() * 0.12;
      colorArr[i * 3]     = _c.r * jitter;
      colorArr[i * 3 + 1] = _c.g * jitter;
      colorArr[i * 3 + 2] = _c.b * jitter;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
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

  /* ---------- Biomes ----------
     Six Minecraft-style biomes with ORGANIC borders. We build three smooth
     scalar fields (temperature, moisture, elevation) as sums of a few sines
     at different frequencies, normalize each to ~[0,1], then classify. The
     overlapping wavelengths give wavy, non-quadrant borders. A spawn
     sanctuary near the origin is forced to a walkable green biome so the
     player never wakes up in sand or a wall. */
  const BIOME_GROUND = {
    forest:    new THREE.Color(0x3a6b32), // deep green
    plains:    new THREE.Color(0x6fae4a), // light green
    desert:    new THREE.Color(0xd9c48f), // sand / tan
    snow:      new THREE.Color(0xe8eef2), // white / pale
    highlands: new THREE.Color(0x6e7860), // grey-green
    swamp:     new THREE.Color(0x3d4a2e), // dark murky green
  };

  function biomeFields(x, z) {
    // temperature: hot (high) vs cold (low)
    const tRaw = Math.sin(x * 0.0035) * Math.cos(z * 0.0041)
               + 0.5 * Math.sin(x * 0.0091 + z * 0.0072)
               + 0.25 * Math.sin((x + z) * 0.013);
    // moisture: wet (high) vs dry (low)
    const mRaw = Math.cos(x * 0.0043) * Math.sin(z * 0.0037)
               + 0.5 * Math.cos(x * 0.0083 - z * 0.0069)
               + 0.25 * Math.sin((x - z) * 0.011);
    // elevation: high (mountains/highlands) vs low
    const eRaw = Math.sin(x * 0.0026 + 1.3) * Math.cos(z * 0.0029 - 0.7)
               + 0.5 * Math.cos((x - z) * 0.0067)
               + 0.25 * Math.sin((x + z) * 0.0093 + 2.1);
    const norm = (v) => Math.max(0, Math.min(1, (v + 1.75) / 3.5));
    return { t: norm(tRaw), m: norm(mRaw), e: norm(eRaw) };
  }

  /* Returns one of: 'forest' | 'plains' | 'desert' | 'snow' |
     'highlands' | 'swamp'. */
  function biomeAt(x, z) {
    // Spawn sanctuary: keep a walkable green ring around the origin.
    if (Math.hypot(x, z) < 34) {
      const f = biomeFields(x, z);
      return f.m > 0.5 ? 'forest' : 'plains';
    }
    const { t, m, e } = biomeFields(x, z);
    if (e > 0.72) return 'highlands';         // high ground → rocky highlands
    if (t < 0.34) return 'snow';              // cold → snowfield
    if (t > 0.64 && m < 0.42) return 'desert';// hot & dry → desert
    if (m > 0.68) return 'swamp';             // very wet → swamp
    if (m > 0.50) return 'forest';            // moist → forest
    return 'plains';                          // otherwise open plains
  }

  // ---- Shared prop materials (reused across all scattered props for perf) ----
  const PROP_MATS = {
    trunk:    new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 }),
    trunkDry: new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 1 }),
    trunkDark:new THREE.MeshStandardMaterial({ color: 0x3a2e22, roughness: 1 }),
    leafForest: new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 1, flatShading: true }),
    leafPlains: new THREE.MeshStandardMaterial({ color: 0x4f9b45, roughness: 1, flatShading: true }),
    leafPine:   new THREE.MeshStandardMaterial({ color: 0x2c6b5e, roughness: 1, flatShading: true }),
    leafSwamp:  new THREE.MeshStandardMaterial({ color: 0x3a5230, roughness: 1, flatShading: true }),
    cactus:     new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 1, flatShading: true }),
    rock:       new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 1, flatShading: true }),
    rockHigh:   new THREE.MeshStandardMaterial({ color: 0x6e7860, roughness: 1, flatShading: true }),
    rockSand:   new THREE.MeshStandardMaterial({ color: 0xc2ac7a, roughness: 1, flatShading: true }),
  };

  /* Trees are biome-aware. Deserts get cacti (tall green cylinders, no
     leaves), snow gets bluish-green pines, swamp gets dark stunted trees,
     highlands get very few trees, plains sparse, forest dense. Every one
     stays a harvestable 'tree' dropping wood, with the EXACT record shape
     the engine expects. */
  function addTrees() {
    // Per-biome relative spawn probability (0 = never grows here).
    const TREE_CHANCE = { forest: 1.0, plains: 0.32, desert: 0.16,
                          snow: 0.55, highlands: 0.18, swamp: 0.7 };
    let made = 0;
    for (let i = 0; i < cfg.treeCount; i++) {
      const p = scatterPos();
      if (Math.hypot(p.x, p.z) < 12) continue; // keep spawn clear
      const biome = biomeAt(p.x, p.z);
      if (Math.random() > (TREE_CHANCE[biome] || 0)) continue; // biome density
      const tree = new THREE.Group();
      const h = rand(4, 7);
      let colR = 1.2, hp = 3;

      if (biome === 'desert') {
        // Cactus: tall green cylinder with a couple of arms, no leaves.
        const ch = rand(3, 5.5);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, ch, 7), PROP_MATS.cactus);
        stem.position.y = ch / 2; stem.castShadow = true; tree.add(stem);
        if (Math.random() < 0.7) {
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, ch * 0.5, 6), PROP_MATS.cactus);
          arm.position.set(0.5, ch * 0.55, 0); arm.rotation.z = -Math.PI / 3; tree.add(arm);
        }
        colR = 0.9;
      } else if (biome === 'snow') {
        // Pine: bluish-green stacked cones on a dark trunk.
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, h, 6), PROP_MATS.trunkDark);
        trunk.position.y = h / 2; trunk.castShadow = true; tree.add(trunk);
        for (let k = 0; k < 3; k++) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4 - k * 0.6, 2.4, 7), PROP_MATS.leafPine);
          cone.position.y = h * 0.6 + k * 1.6; cone.castShadow = true; tree.add(cone);
        }
      } else if (biome === 'swamp') {
        // Stunted dark tree with a low murky canopy.
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, h * 0.8, 6), PROP_MATS.trunkDark);
        trunk.position.y = h * 0.4; trunk.castShadow = true; tree.add(trunk);
        const foliage = new THREE.Mesh(new THREE.SphereGeometry(rand(1.8, 2.6), 7, 6), PROP_MATS.leafSwamp);
        foliage.position.y = h * 0.8 + 0.6; foliage.scale.y = 0.7; foliage.castShadow = true; tree.add(foliage);
      } else {
        // Forest / plains / highlands: classic conifer cone.
        const trunkMat = (biome === 'plains') ? PROP_MATS.trunkDry : PROP_MATS.trunk;
        const leafMat  = (biome === 'plains') ? PROP_MATS.leafPlains : PROP_MATS.leafForest;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, h, 6), trunkMat);
        trunk.position.y = h / 2; trunk.castShadow = true; tree.add(trunk);
        const foliage = new THREE.Mesh(new THREE.ConeGeometry(rand(2, 3), rand(4, 6), 7), leafMat);
        foliage.position.y = h + 1.5; foliage.castShadow = true; tree.add(foliage);
      }

      // Sit the tree ON the terrain surface (fixes floating / walk-under).
      tree.position.set(p.x, groundHeight(p.x, p.z), p.z);
      scene.add(tree);
      const collider = { x: p.x, z: p.z, r: colR };
      colliders.push(collider);
      harvestables.push({
        id: 'tree_' + i, type: 'tree',
        resource: 'wood',           // dropped when felled
        mesh: tree, collider,
        position: tree.position.clone(),
        hp: hp, maxHp: hp,     // hits to fell
        radius: 2.5,           // how close the swing must land
      });
      made++;
    }
    return made;
  }

  /* Rocks are biome-aware: dense boulders in highlands, scattered rocks in
     most biomes, tan rocks in desert, sparse in swamp/plains. Each stays a
     harvestable 'rock' dropping stone with the exact engine record shape. */
  function addRocks() {
    const ROCK_CHANCE = { forest: 0.6, plains: 0.4, desert: 0.7,
                          snow: 0.5, highlands: 1.0, swamp: 0.35 };
    for (let i = 0; i < cfg.rockCount; i++) {
      const p = scatterPos();
      if (Math.hypot(p.x, p.z) < 10) continue;
      const biome = biomeAt(p.x, p.z);
      if (Math.random() > (ROCK_CHANCE[biome] || 0)) continue;
      // Highlands get bigger boulders.
      const s = (biome === 'highlands') ? rand(1.4, 3.2) : rand(0.8, 2.4);
      const mat = (biome === 'highlands') ? PROP_MATS.rockHigh
                : (biome === 'desert')    ? PROP_MATS.rockSand
                : PROP_MATS.rock;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 1), mat);
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
      // Enterable house: hollow box with 4 walls, a floor, a DOORWAY GAP in the
      // front wall, and per-wall colliders (walls block; the doorway lets you
      // in — you can hide from night zombies). Axis-aligned so wall colliders
      // map cleanly to world space. Food depletion is unaffected by being
      // indoors (survival tick runs the same everywhere) — so you still must
      // gather food before nightfall.
      const wW = rand(8, 12), dD = rand(8, 12), hH = rand(4, 6);
      const gy = groundHeight(p.x, p.z);
      const wallMat = new THREE.MeshStandardMaterial({ color: [0xcbb89d, 0xb0a08a, 0xd8c8ae][i % 3], roughness: 1 });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a3b2f, roughness: 1, flatShading: true });
      const floorMat = new THREE.MeshStandardMaterial({ color: 0x5a4a38, roughness: 1 });
      const b = new THREE.Group();
      const th = 0.4;                    // wall thickness
      const doorW = 4.6;                 // doorway opening width (front wall)

      // Floor.
      const floor = new THREE.Mesh(new THREE.BoxGeometry(wW, 0.2, dD), floorMat);
      floor.position.y = 0.1; floor.receiveShadow = true; b.add(floor);

      // Helper: a wall panel mesh centered at (lx,lz) with given size.
      const panel = (sx, sy, sz, lx, lz) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMat);
        m.position.set(lx, sy / 2, lz); m.castShadow = true; m.receiveShadow = true; b.add(m);
      };

      // Back wall (solid) + left + right walls (solid). Front wall split into
      // two segments leaving a doorway gap in the middle.
      panel(wW, hH, th, 0, -dD / 2);                       // back (z = -d/2)
      panel(th, hH, dD, -wW / 2, 0);                       // left (x = -w/2)
      panel(th, hH, dD,  wW / 2, 0);                       // right (x = +w/2)
      const seg = (wW - doorW) / 2;                        // each front segment width
      panel(seg, hH, th, -(doorW / 2 + seg / 2), dD / 2);  // front-left
      panel(seg, hH, th,  (doorW / 2 + seg / 2), dD / 2);  // front-right
      // Lintel above the doorway so the gap reads as a door.
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW, hH - 3, th), wallMat);
      lintel.position.set(0, hH - (hH - 3) / 2, dD / 2); b.add(lintel);

      // Front door + frame in the doorway gap.
      const doorH = hH - 3;
      const frameW = 0.12;
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x3d2815, roughness: 1 });
      const doorMat = new THREE.MeshStandardMaterial({ color: 0x7a4a28, roughness: 0.85 });
      const frameSide = (sx) => {
        const f = new THREE.Mesh(new THREE.BoxGeometry(frameW, doorH, th + 0.04), frameMat);
        f.position.set(sx, doorH / 2, dD / 2); f.castShadow = true; b.add(f);
      };
      frameSide(-doorW / 2 + frameW / 2);
      frameSide(doorW / 2 - frameW / 2);
      const frameTop = new THREE.Mesh(new THREE.BoxGeometry(doorW, frameW, th + 0.04), frameMat);
      frameTop.position.set(0, doorH + frameW / 2, dD / 2); b.add(frameTop);
      const innerW = doorW - frameW * 2;
      const door = new THREE.Mesh(new THREE.BoxGeometry(innerW - 0.04, doorH - frameW - 0.04, 0.1), doorMat);
      door.position.set(0, (doorH - frameW) / 2, dD / 2 + 0.06);
      door.castShadow = true; b.add(door);

      // Interior furniture — colorful pieces.
      const tableMat = new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.85 });
      const chairMatA = new THREE.MeshStandardMaterial({ color: 0x3498db, roughness: 0.85 });
      const chairMatB = new THREE.MeshStandardMaterial({ color: 0x9b59b6, roughness: 0.85 });
      const bedMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: 0.9 });
      const pillowMat = new THREE.MeshStandardMaterial({ color: 0xf39c12, roughness: 0.95 });
      const shelfMat = new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.8 });
      const legMat = new THREE.MeshStandardMaterial({ color: 0x1abc9c, roughness: 1 });
      const table = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 1.3), tableMat);
      table.position.set(0, 1.0, -dD * 0.15); table.castShadow = true; b.add(table);
      for (const [tx, tz] of [[-0.9, -0.45], [0.9, -0.45], [-0.9, 0.45], [0.9, 0.45]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), legMat);
        leg.position.set(tx, 0.5, -dD * 0.15 + tz); b.add(leg);
      }
      const chair = (cx, cz, mat) => {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.9), mat);
        seat.position.set(cx, 0.55, cz); seat.castShadow = true; b.add(seat);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.1), mat);
        back.position.set(cx, 0.95, cz - 0.38); b.add(back);
      };
      chair(-2.2, dD * 0.1, chairMatA);
      chair(2.2, dD * 0.1, chairMatB);
      const bed = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 3.2), bedMat);
      bed.position.set(-wW * 0.25, 0.35, -dD * 0.32); bed.castShadow = true; b.add(bed);
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.7), pillowMat);
      pillow.position.set(-wW * 0.25, 0.62, -dD * 0.32 - 1.1); b.add(pillow);
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.35), shelfMat);
      shelf.position.set(wW * 0.32, 1.1, -dD * 0.35); shelf.castShadow = true; b.add(shelf);

      // Roof.
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(wW, dD) * 0.75, 3, 4), roofMat);
      roof.position.y = hH + 1.5; roof.rotation.y = Math.PI / 4; roof.castShadow = true; b.add(roof);

      b.position.set(p.x, gy, p.z);                        // axis-aligned (no rotation)
      scene.add(b);

      // Colliders: place small circular colliders along each wall in WORLD space,
      // leaving the doorway gap open. Player/enemy collision is circular {x,z,r};
      // player pads +1.0, so spacing/gap are sized to stay solid but passable.
      const cr = 0.6, step = 1.4;
      const addRun = (x0, z0, x1, z1, skipGap) => {
        const len = Math.hypot(x1 - x0, z1 - z0);
        const n = Math.max(1, Math.round(len / step));
        for (let k = 0; k <= n; k++) {
          const fx = x0 + (x1 - x0) * (k / n), fz = z0 + (z1 - z0) * (k / n);
          // Skip colliders within the doorway gap (front wall only).
          if (skipGap && Math.abs(fx - p.x) < doorW / 2) continue;
          colliders.push({ x: fx, z: fz, r: cr });
        }
      };
      const hw = wW / 2, hd = dD / 2;
      addRun(p.x - hw, p.z - hd, p.x + hw, p.z - hd, false);   // back
      addRun(p.x - hw, p.z - hd, p.x - hw, p.z + hd, false);   // left
      addRun(p.x + hw, p.z - hd, p.x + hw, p.z + hd, false);   // right
      addRun(p.x - hw, p.z + hd, p.x + hw, p.z + hd, true);    // front (with doorway gap)

      interactables.push({ mesh: b, type: 'building', id: 'building_' + i, position: b.position.clone() });
    }
  }

  /* ---------- Biome structures ----------
     Distinct multi-block low-poly landmarks placed on-terrain via
     groundHeight(), chosen by the biome at their location. Each gets a
     solid collider and a unique interactable id like 'struct_tower_0'.
     Kept lightweight (a handful of boxes/cones each). */
  const STRUCT_MATS = {
    stone:  new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.95, flatShading: true }),
    stoneD: new THREE.MeshStandardMaterial({ color: 0x6c675e, roughness: 0.95, flatShading: true }),
    sand:   new THREE.MeshStandardMaterial({ color: 0xcaa86a, roughness: 0.9, flatShading: true }),
    sandD:  new THREE.MeshStandardMaterial({ color: 0xa8844a, roughness: 0.92, flatShading: true }),
    gold:   new THREE.MeshStandardMaterial({ color: 0xd9b64e, roughness: 0.45, metalness: 0.35, flatShading: true }),
    wood:   new THREE.MeshStandardMaterial({ color: 0x7a552f, roughness: 0.95, flatShading: true }),
    woodD:  new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 1, flatShading: true }),
    roof:   new THREE.MeshStandardMaterial({ color: 0x5a3826, roughness: 1, flatShading: true }),
    moss:   new THREE.MeshStandardMaterial({ color: 0x3d5c32, roughness: 1, flatShading: true }),
    vine:   new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 1, flatShading: true }),
    ice:    new THREE.MeshStandardMaterial({ color: 0xbfe0ea, roughness: 0.35, metalness: 0.12, flatShading: true, transparent: true, opacity: 0.92 }),
    snow:   new THREE.MeshStandardMaterial({ color: 0xe8f4ff, roughness: 0.8, flatShading: true }),
    ember:  new THREE.MeshStandardMaterial({ color: 0xff7a2f, emissive: 0xff5a1f, emissiveIntensity: 0.7, roughness: 0.8 }),
    water:  new THREE.MeshStandardMaterial({ color: 0x3a6b5a, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.75 }),
    cloth:  new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 0.9, flatShading: true }),
  };

  const addBox = (g, sx, sy, sz, mat, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    if (shadow) { m.castShadow = true; m.receiveShadow = true; }
    g.add(m); return m;
  };
  const addCyl = (g, rt, rb, h, seg, mat, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z);
    if (shadow) { m.castShadow = true; m.receiveShadow = true; }
    g.add(m); return m;
  };

  // --- structure builders: each returns { group, r } (collider radius) ---
  function makeTower() {
    const g = new THREE.Group();
    const h = rand(8, 12);
    addCyl(g, 2.0, 2.4, h, 10, STRUCT_MATS.stone, 0, h / 2, 0);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      addBox(g, 0.65, rand(0.7, 1.3), 0.65, STRUCT_MATS.stoneD,
        Math.cos(a) * 1.9, h + 0.5, Math.sin(a) * 1.9);
    }
    addCyl(g, 1.3, 1.5, 1.8, 8, STRUCT_MATS.stoneD, 0, h + 1.6, 0);
    return { group: g, r: 3.0 };
  }
  function makePyramid() {          // desert obelisk on a stepped base
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 6), STRUCT_MATS.sand);
    base.position.y = 0.6; base.castShadow = true; g.add(base);
    const step = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 4), STRUCT_MATS.sand);
    step.position.y = 1.6; g.add(step);
    const ob = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 7, 4), STRUCT_MATS.sand);
    ob.position.y = 5.6; ob.rotation.y = Math.PI / 4; ob.castShadow = true; g.add(ob);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.2, 4), STRUCT_MATS.gold);
    cap.position.y = 9.6; cap.rotation.y = Math.PI / 4; g.add(cap);
    return { group: g, r: 3.6 };
  }
  function makeCabin() {            // wooden cabin (forest/plains)
    const g = new THREE.Group();
    const w = rand(4, 6), d = rand(4, 6), h = rand(3, 4.5);
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), STRUCT_MATS.wood);
    body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true; g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.8, 2.4, 4), STRUCT_MATS.roof);
    roof.position.y = h + 1.0; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
    return { group: g, r: Math.max(w, d) / 2 + 0.4 };
  }
  function makeCampsite() {         // campfire ring (forest/plains)
    const g = new THREE.Group();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4, 0), STRUCT_MATS.stone);
      stone.position.set(Math.cos(a) * 1.1, 0.3, Math.sin(a) * 1.1); g.add(stone);
    }
    const logs = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.2, 5), STRUCT_MATS.wood);
    logs.rotation.z = Math.PI / 2; logs.position.y = 0.4; g.add(logs);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.1, 6), STRUCT_MATS.ember);
    flame.position.y = 0.9; g.add(flame);
    return { group: g, r: 1.6 };
  }
  function makeFrozenRuin() {       // frozen ruins (snow)
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.8, rand(2, 5), 0.8), STRUCT_MATS.stoneD);
      col.position.set((k % 2 ? 1 : -1) * 1.6, col.geometry.parameters.height / 2, (k < 2 ? 1 : -1) * 1.6);
      col.castShadow = true; g.add(col);
    }
    const ice = new THREE.Mesh(new THREE.OctahedronGeometry(1.6, 0), STRUCT_MATS.ice);
    ice.position.y = 2.2; ice.castShadow = true; g.add(ice);
    return { group: g, r: 2.6 };
  }
  function makeRockArch() {
    const g = new THREE.Group();
    addBox(g, 1.5, 5.5, 1.5, STRUCT_MATS.stoneD, -2.4, 2.75, 0);
    addBox(g, 1.5, 5.5, 1.5, STRUCT_MATS.stoneD, 2.4, 2.75, 0);
    addBox(g, 6.8, 1.6, 1.6, STRUCT_MATS.stone, 0, 5.6, 0);
    for (let k = -2; k <= 2; k++) addBox(g, 0.9, 0.5, 0.9, STRUCT_MATS.stoneD, k * 1.1, 6.2, 0);
    return { group: g, r: 3.8 };
  }

  function makeForestShrine() {
    const g = new THREE.Group();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      addCyl(g, 0.35, 0.45, rand(3.5, 4.8), 6, STRUCT_MATS.stoneD,
        Math.cos(a) * 2.2, 2.2, Math.sin(a) * 2.2);
    }
    addBox(g, 4.8, 0.5, 4.8, STRUCT_MATS.stone, 0, 4.6, 0);
    addCyl(g, 0.5, 0.5, 1.6, 8, STRUCT_MATS.gold, 0, 5.6, 0);
    for (let k = 0; k < 5; k++) {
      const a = k * 1.2;
      addBox(g, 0.15, rand(1.5, 2.8), 0.15, STRUCT_MATS.vine,
        Math.cos(a) * 1.8, rand(1.5, 3), Math.sin(a) * 1.8);
    }
    return { group: g, r: 3.2 };
  }

  function makePlainsWindmill() {
    const g = new THREE.Group();
    addCyl(g, 1.1, 1.4, 7, 10, STRUCT_MATS.woodD, 0, 3.5, 0);
    addCyl(g, 1.5, 1.5, 0.4, 12, STRUCT_MATS.stone, 0, 7.2, 0);
    const hub = new THREE.Group();
    hub.position.y = 7.4;
    for (let k = 0; k < 4; k++) {
      const blade = addBox(hub, 0.25, 3.8, 0.12, STRUCT_MATS.cloth, 0, 1.9, 0);
      blade.rotation.z = (k / 4) * Math.PI * 2;
    }
    g.add(hub);
    addBox(g, 3.2, 0.25, 3.2, STRUCT_MATS.stoneD, 0, 0.12, 0);
    return { group: g, r: 3.0 };
  }

  function makeDesertTemple() {
    const g = new THREE.Group();
    for (let tier = 0; tier < 3; tier++) {
      const s = 7 - tier * 1.6;
      addBox(g, s, 1.1, s, tier % 2 ? STRUCT_MATS.sandD : STRUCT_MATS.sand, 0, 0.55 + tier * 1.1, 0);
    }
    for (const sx of [-2.2, 2.2]) {
      addCyl(g, 0.45, 0.55, 5.5, 6, STRUCT_MATS.sandD, sx, 4.2, 2.8);
      addBox(g, 1.1, 0.6, 1.1, STRUCT_MATS.gold, sx, 7.0, 2.8);
    }
    addCyl(g, 0.35, 0.9, 3.5, 4, STRUCT_MATS.gold, 0, 4.5, 0);
    return { group: g, r: 4.2 };
  }

  function makeSnowLodge() {
    const g = new THREE.Group();
    const w = rand(5, 7), d = rand(5, 7), h = rand(3.5, 4.5);
    addBox(g, w, h, d, STRUCT_MATS.wood, 0, h / 2, 0);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.85, 2.8, 4), STRUCT_MATS.snow);
    roof.position.y = h + 1.2; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
    addBox(g, w + 0.6, 0.35, d + 0.6, STRUCT_MATS.snow, 0, h + 0.15, 0);
    addBox(g, 1.2, 2.2, 0.2, STRUCT_MATS.ice, 0, 1.1, d / 2 + 0.1);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      addBox(g, 0.5, 0.5, 0.5, STRUCT_MATS.ice, Math.cos(a) * w * 0.45, h + 0.3, Math.sin(a) * d * 0.45);
    }
    return { group: g, r: Math.max(w, d) / 2 + 0.8 };
  }

  function makeSwampStiltHut() {
    const g = new THREE.Group();
    addBox(g, 5, 0.15, 5, STRUCT_MATS.water, 0, 0.2, 0);
    for (const [px, pz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) {
      addCyl(g, 0.18, 0.22, 3.8, 6, STRUCT_MATS.woodD, px, 2.0, pz);
    }
    addBox(g, 4.2, 0.2, 4.2, STRUCT_MATS.wood, 0, 3.9, 0);
    addBox(g, 3.6, 2.2, 3.6, STRUCT_MATS.moss, 0, 5.1, 0);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 2.0, 4), STRUCT_MATS.roof);
    roof.position.y = 6.4; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
    for (let k = 0; k < 6; k++) {
      addBox(g, 0.2, rand(1.2, 2.0), 0.2, STRUCT_MATS.vine, rand(-2, 2), rand(2, 4.5), rand(-2, 2));
    }
    return { group: g, r: 2.8 };
  }

  function makeHighlandFortress() {
    const g = new THREE.Group();
    addBox(g, 9, 1.2, 9, STRUCT_MATS.stoneD, 0, 0.6, 0);
    for (const [sx, sz] of [[-3.8, -3.8], [3.8, -3.8], [-3.8, 3.8], [3.8, 3.8]]) {
      addCyl(g, 1.0, 1.2, rand(5, 7), 8, STRUCT_MATS.stone, sx, 3.5, sz);
      addBox(g, 1.6, 0.5, 1.6, STRUCT_MATS.stoneD, sx, 7.2, sz);
    }
    addBox(g, 5, 0.8, 5, STRUCT_MATS.stone, 0, 1.2, 0);
    addCyl(g, 1.6, 1.8, 6, 10, STRUCT_MATS.stone, 0, 4.2, 0);
    return { group: g, r: 5.0 };
  }

  function addStructures() {
    // Map each biome to the structure builders that can appear there.
    const BY_BIOME = {
      highlands: [makeTower, makeRockArch, makeHighlandFortress, makeTower],
      desert:    [makePyramid, makeDesertTemple, makePyramid],
      forest:    [makeCabin, makeForestShrine, makeCampsite],
      plains:    [makeCabin, makePlainsWindmill, makeCampsite],
      snow:      [makeFrozenRuin, makeSnowLodge, makeFrozenRuin],
      swamp:     [makeSwampStiltHut, makeCabin, makeForestShrine],
    };
    const target = 30;
    let placed = 0, attempts = 0;
    while (placed < target && attempts < target * 25) {
      attempts++;
      const p = scatterPos(60);
      if (Math.hypot(p.x, p.z) < 40) continue; // keep spawn area clear
      const biome = biomeAt(p.x, p.z);
      const builders = BY_BIOME[biome];
      if (!builders) continue;
      // Avoid overlapping existing colliders.
      let clash = false;
      for (const c of colliders) { if (Math.hypot(p.x - c.x, p.z - c.z) < c.r + 4) { clash = true; break; } }
      if (clash) continue;
      const make = builders[Math.floor(Math.random() * builders.length)];
      const { group, r } = make();
      group.position.set(p.x, groundHeight(p.x, p.z), p.z);
      group.rotation.y = rand(0, Math.PI * 2);
      scene.add(group);
      colliders.push({ x: p.x, z: p.z, r });
      const kind = make.name.replace('make', '').toLowerCase();
      interactables.push({ mesh: group, type: 'structure',
        id: 'struct_' + kind + '_' + placed, biome, position: group.position.clone() });
      placed++;
    }
    return placed;
  }

  /* Advance the day/night clock and drive sky + sun lighting. A dusk warning
     dialogue fires shortly before night; night turns the world dark/cold and
     is when zombies roam. Levels are NOT timed — a stage ends only when its
     objectives are met, so cycles simply repeat until then. */
  function updateDayNight(dt) {
    const dn = GAME.Config.dayNight || { dayLength: 75, nightLength: 55, duskWarning: 10 };
    const dayLen = dn.dayLength, nightLen = dn.nightLength, cycleLen = dayLen + nightLen;
    clock += dt;
    if (clock >= cycleLen) { clock -= cycleLen; cycleCount++; _warnedThisCycle = false; }

    const wasNight = isNightNow;
    isNightNow = clock >= dayLen;

    // Dusk warning a few seconds before night begins.
    if (!isNightNow && !_warnedThisCycle && clock >= dayLen - (dn.duskWarning || 10)) {
      _warnedThisCycle = true;
      GAME.Events.emit('daynight:dusk', { secondsToNight: Math.max(0, dayLen - clock) });
    }
    if (isNightNow && !wasNight) GAME.Events.emit('daynight:night', { cycle: cycleCount });
    if (!isNightNow && wasNight) GAME.Events.emit('daynight:day', { cycle: cycleCount });

    // Smooth 0..1 "darkness": 0 full day, 1 deep night, eased around transitions.
    let dark;
    if (isNightNow) {
      const into = (clock - dayLen) / nightLen;               // 0..1 through night
      dark = Math.min(1, Math.sin(Math.min(into, 1) * Math.PI) * 1.4 + 0.35) * 0.95;
    } else {
      const into = clock / dayLen;                            // 0..1 through day
      dark = Math.max(0, (into - 0.85) / 0.15) * 0.35;        // dim only near dusk
    }

    // Sky color: day blue -> night indigo. Sun intensity + hemisphere dim.
    if (sun && hemi) {
      const dayColor = new THREE.Color(GAME.Config.world.skyColor);
      const nightColor = new THREE.Color(0x0b1030);
      const sky = dayColor.clone().lerp(nightColor, dark);
      if (scene.background && scene.background.copy) scene.background.copy(sky);
      if (scene.fog) scene.fog.color.copy(sky);
      sun.intensity = (1.1 * (1 - dark) + 0.05) * (isNightNow ? 1.05 : 1);
      hemi.intensity = (0.7 * (1 - dark * 0.85)) * (isNightNow ? 1.05 : 1);
      if (_stars) _stars.visible = isNightNow;
      if (_galaxies) _galaxies.visible = isNightNow;
      // Move the sun low at night for long shadows / darkness.
      const ang = (clock / cycleLen) * Math.PI * 2;
      sun.position.set(Math.cos(ang) * 120, Math.max(12, Math.sin(ang) * 140), 40);
    }
  }

  function isNight() { return isNightNow; }
  function timeOfDay() {
    const dn = GAME.Config.dayNight; const cyc = dn.dayLength + dn.nightLength;
    return { isNight: isNightNow, clock, cycle: cycleCount, phaseFrac: clock / cyc };
  }

  // Ground height sampler (matches addGround formula) — for player grounding.
  function groundHeight(x, z) {
    return Math.sin(x * 0.03) * Math.cos(z * 0.03) * 0.8
         + Math.sin(x * 0.08 + z * 0.05) * 0.35;
  }

  // Called each frame from main loop for ambient animation.
  function update(dt, t) {
    updateDayNight(dt);
    // Bob + slowly spin loose pickups so they read as collectibles.
    for (const p of pickups) {
      if (!p.mesh) continue;
      p.mesh.position.y = p.baseY + Math.sin(t * 2 + p.mesh.userData.phase) * 0.15;
      p.mesh.rotation.y += dt * 1.2;
    }
  }

  function addStars() {
    const verts = [];
    for (let i = 0; i < 900; i++) {
      verts.push((Math.random() - 0.5) * 800, 80 + Math.random() * 220, (Math.random() - 0.5) * 800);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    _stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, transparent: true, opacity: 0.95 }));
    _stars.visible = false;
    scene.add(_stars);
  }

  function addGalaxies() {
    _galaxies = new THREE.Group();
    const colors = [0xc9a0ff, 0x7eb8ff, 0xff9ed8, 0xa8ffe8, 0xffd67a, 0xb8a0ff];
    for (let i = 0; i < 28; i++) {
      const cluster = new THREE.Group();
      const n = 60 + Math.floor(Math.random() * 100);
      const verts = [];
      for (let j = 0; j < n; j++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.random() * 16 + Math.random() * 10;
        verts.push(Math.cos(ang) * rad, (Math.random() - 0.5) * 2.5, Math.sin(ang) * rad * 0.4);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const mat = new THREE.PointsMaterial({
        color: colors[i % colors.length], size: 2.8 + Math.random() * 1.5,
        transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      cluster.add(new THREE.Points(geo, mat));
      const az = Math.random() * Math.PI * 2;
      const el = 0.2 + Math.random() * 0.55;
      const R = 320 + Math.random() * 80;
      cluster.position.set(Math.cos(az) * R, 90 + Math.sin(el) * 140, Math.sin(az) * R);
      cluster.lookAt(0, 30, 0);
      cluster.rotation.z = Math.random() * Math.PI;
      _galaxies.add(cluster);
    }
    _galaxies.visible = false;
    scene.add(_galaxies);
  }

  /* Alien merchant (green) + escape rocket behind him. */
  function addMerchantAndRocket() {
    const g = new THREE.Group();
    const suitMat = new THREE.MeshStandardMaterial({ color: 0x3d6b8c, roughness: 0.45, metalness: 0.35 });
    const greenMat = new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.55 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.75, 2.2, 12), suitMat);
    body.position.y = 1.1; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.52, 16, 14), greenMat);
    head.position.y = 2.55; head.castShadow = true; g.add(head);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111820, emissive: 0x2244aa, emissiveIntensity: 0.4 });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), eyeMat);
      eye.position.set(s * 0.18, 2.6, 0.42); g.add(eye);
    }
    const mx = 12, mz = 10;
    g.position.set(mx, groundHeight(mx, mz), mz);
    scene.add(g);
    colliders.push({ x: mx, z: mz, r: 1.2 });
    interactables.push({ mesh: g, type: 'npc', id: 'alien_merchant', name: 'Alien Merchant', position: g.position.clone() });

    const rocket = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0xb8c4d0, roughness: 0.35, metalness: 0.75 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xff6b35, emissive: 0x331100, emissiveIntensity: 0.3 });
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 7, 16), metal);
    hull.position.y = 3.5; hull.castShadow = true; rocket.add(hull);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.5, 16), accent);
    nose.position.y = 8.2; rocket.add(nose);
    const finL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.2, 1.4), metal);
    finL.position.set(-1.5, 2, 0); finL.rotation.z = 0.25; rocket.add(finL);
    const finR = finL.clone(); finR.position.x = 1.5; finR.rotation.z = -0.25; rocket.add(finR);
    rocket.scale.set(3, 3, 3);
    const rx = mx, rz = mz + 14;
    rocket.position.set(rx, groundHeight(rx, rz), rz);
    scene.add(rocket);
    colliders.push({ x: rx, z: rz, r: 7.5 });
    interactables.push({ mesh: rocket, type: 'rocket', id: 'escape_rocket', name: 'Escape Rocket', position: rocket.position.clone() });
  }

  /* Story gems — random locations across Xylos each run. */
  function spawnStoryMaterials() {
    const COLORS = { carnelian: 0x3b82f6, onyx: 0xef4444, morganite: 0x22c55e };
    const SPAWN_CHANCE = { carnelian: 0.55, onyx: 0.5, morganite: 0.48 };
    Object.keys(COLORS).forEach((res) => {
      let placed = 0, tries = 0;
      const target = 5 + Math.floor(Math.random() * 4);
      while (placed < target && tries < 180) {
        tries++;
        if (Math.random() > SPAWN_CHANCE[res]) continue;
        const p = scatterPos(58);
        if (Math.hypot(p.x, p.z) < 35) continue;
        const s = rand(1.2, 2.2);
        const mat = new THREE.MeshStandardMaterial({
          color: COLORS[res], roughness: 0.25, metalness: 0.55,
          emissive: COLORS[res], emissiveIntensity: 0.25,
        });
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(s, 1), mat);
        const gy = groundHeight(p.x, p.z) + s * 0.5;
        crystal.position.set(p.x, gy, p.z);
        crystal.castShadow = true; scene.add(crystal);
        const collider = { x: p.x, z: p.z, r: s + 0.8 };
        colliders.push(collider);
        harvestables.push({
          id: res + '_' + placed, type: 'crystal', resource: res,
          mesh: crystal, collider, position: crystal.position.clone(),
          hp: 3, maxHp: 3, radius: s + 1.5,
        });
        placed++;
      }
    });
  }

  /* Scatter loose collectibles across the terrain per GAME.Config.forage.
     Each is a small bobbing mesh you grab with E (no collider — you walk
     over them). */
  function addForage() {
    const fcfg = GAME.Config.forage;
    if (!fcfg) return;
    // Per-biome spawn probability, split by food vs material pickups.
    // Plains & swamp are richest for food; desert & snow sparse.
    const isFood = (r) => (r === 'berries' || r === 'mushroom');
    // Medium food availability EVERYWHERE — every biome gets a solid baseline
    // so you won't starve crossing desert/snow. Mild biome flavor retained.
    const FOOD_CHANCE = { forest: 0.85, plains: 0.9, swamp: 0.85,
                          highlands: 0.7, desert: 0.6, snow: 0.65 };
    const MAT_CHANCE  = { forest: 0.8, plains: 0.6, swamp: 0.6,
                          highlands: 0.9, desert: 0.7, snow: 0.6 };
    // coal & sand are biome-specific world materials: coal in rocky highlands
    // (and some desert), sand in the desert. Elsewhere they're rare.
    const isBiomeMat = (r) => (r === 'coal' || r === 'sand');
    const MAT_BIAS = {
      coal: { highlands: 1.0, desert: 0.8, snow: 0.6, forest: 0.55, plains: 0.5, swamp: 0.5 },
      sand: { desert: 1.0, plains: 0.55, highlands: 0.5, snow: 0.45, forest: 0.45, swamp: 0.45 },
    };
    // Mushrooms strongly favor swamp/forest; berries favor plains.
    const BIAS = {
      berries:  { plains: 1.0, forest: 0.85, swamp: 0.7, highlands: 0.65, snow: 0.6, desert: 0.6 },
      mushroom: { swamp: 1.0, forest: 0.85, plains: 0.65, snow: 0.6, highlands: 0.6, desert: 0.55 },
    };
    let idx = 0;
    fcfg.scatter.forEach((kind) => {
      for (let i = 0; i < kind.count; i++) {
        const p = scatterPos(16);
        if (Math.hypot(p.x, p.z) < 8) continue; // keep spawn tidy
        const biome = biomeAt(p.x, p.z);
        let chance;
        if (isFood(kind.resource)) {
          chance = (FOOD_CHANCE[biome] || 0.3) * ((BIAS[kind.resource] && BIAS[kind.resource][biome]) || 0.5);
        } else if (isBiomeMat(kind.resource)) {
          chance = (MAT_BIAS[kind.resource] && MAT_BIAS[kind.resource][biome]) || 0.15;
        } else {
          chance = (MAT_CHANCE[biome] || 0.5);
        }
        if (Math.random() > chance) continue; // biome distribution
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
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a1a6b, roughness: 0.7, emissive: 0x1a0828, emissiveIntensity: 0.5 });
    const limbMat = new THREE.MeshStandardMaterial({ color: 0x2d1040, roughness: 0.8 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff3b3b, emissiveIntensity: 1.0 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.6, 0.7), bodyMat);
    body.position.y = 1.5; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 0.75), bodyMat);
    head.position.y = 2.55; head.castShadow = true; g.add(head);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.3, 0.28), limbMat);
      arm.position.set(s * 0.72, 1.55, 0); arm.castShadow = true; g.add(arm);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.1, 0.32), limbMat);
      leg.position.set(s * 0.28, 0.55, 0); leg.castShadow = true; g.add(leg);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), eyeMat);
      eye.position.set(s * 0.18, 2.6, 0.38); g.add(eye);
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
      mesh, hp: enemyStats().hp, x, z, lastHit: 0 });
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

  /* Per-stage enemy scaling: zombies appear from stage 1 and grow gently in
     number + power each stage. Returns the tuned stats for the current stage. */
  function enemyStats() {
    const ec = GAME.Config.enemies;
    const st = GAME.State.currentStage && GAME.State.currentStage();
    const s = st ? (st.id || 1) : 1;              // stage number, 1-based
    return {
      maxActive: (ec.baseMaxActive || 3) + (s - 1),                 // 3..7
      hp:        (ec.baseHp || 2) + Math.floor((s - 1) / 2),        // 2..4
      damage:    (ec.baseContactDamage || 6) + (s - 1) * 1.2,       // gentle ramp
      speed:     (ec.baseSpeed || 5.5) + (s - 1) * 0.4,             // slight ramp
      // Night spawn cadence: very sparse at stage 1, faster each stage.
      spawnInterval: Math.max((ec.minSpawnInterval || 4),
                              (ec.baseSpawnInterval || 14) - (s - 1) * 2),
    };
  }

  function updateEnemies(dt, playerPos) {
    const ec = GAME.Config.enemies;
    const combat = !GAME.State.won && isNightNow;

    // Freeze aliens while paused (pointer unlocked).
    if (GAME.Player && GAME.Player.isPaused && GAME.Player.isPaused()) return;

    // Daytime (or non-combat/win) → clear the field: the horde vanishes at dawn.
    if (!combat) {
      if (enemies.length) {
        enemies.forEach((e) => { if (e.mesh) scene.remove(e.mesh); });
        enemies = [];
      }
      return;
    }

    // Night spawn cadence. Sparse early, busier in later stages: the interval
    // shrinks per stage from baseSpawnInterval down to minSpawnInterval.
    const es = enemyStats();
    enemySpawnTimer += dt;
    if (enemySpawnTimer >= es.spawnInterval && enemies.length < es.maxActive) {
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
        const stepX = (dx / d) * es.speed * dt;
        const stepZ = (dz / d) * es.speed * dt;
        // Collide against world props so enemies can't walk through them.
        // Try each axis independently so they slide along obstacles.
        if (!enemyBlocked(e.x + stepX, e.z)) e.x += stepX;
        if (!enemyBlocked(e.x, e.z + stepZ)) e.z += stepZ;
        e.mesh.position.set(e.x, groundHeight(e.x, e.z), e.z);
        // Face the player.
        e.mesh.rotation.y = Math.atan2(dx, dz);
      } else {
        // Contact damage on cooldown — 50% chance to swing axe, 50% take hit.
        e.lastHit -= dt;
        if (e.lastHit <= 0) {
          e.lastHit = ec.contactCooldown;
          const defended = GAME.Player.tryDefendOnContact && !GAME.Player.tryDefendOnContact();
          if (!defended) {
            const maxHP = (GAME.State.character && GAME.State.character.maxHP) || GAME.Config.progression.maxHP;
            const hitDmg = maxHP / 12;
            GAME.State.damage(hitDmg);
            GAME.Events.emit('enemy:hit', { damage: hitDmg });
          }
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
    const isLight = (itemId === 'torch' || itemId === 'lantern');
    if (itemId === 'campfire') return null;
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
    const collider = { x, z, r: size * 0.6, grid: true, top: gy + size, half: size / 2 };
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
  /* Standing-surface height at (x,z): the top of the tallest placed block
     whose footprint covers the point, else the terrain height. Lets the
     player stand and jump on blocks they build. */
  function surfaceHeight(x, z) {
    let h = groundHeight(x, z);
    for (const b of placedBlocks) {
      const c = b.collider;
      if (!c || !c.grid) continue;
      const half = (c.half != null ? c.half : 1) + 0.05;
      if (Math.abs(x - c.x) <= half && Math.abs(z - c.z) <= half) {
        if (c.top != null && c.top > h) h = c.top;
      }
    }
    return h;
  }

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
    spawnGroundPickup, spawnStoryMaterials,
    isWarm, nearCampfire, collectNearestPickup, surfaceHeight,
    updateEnemies, attackEnemy, enemyCount, isNight, timeOfDay,
    serializeBlocks, restoreBlocks, biomeAt,
    get colliders() { return colliders; },
    get interactables() { return interactables; },
    get harvestables() { return harvestables; },
    get pickups() { return pickups; },
    get warmthSources() { return warmthSources; },
    get enemies() { return enemies; },
  };
})();
