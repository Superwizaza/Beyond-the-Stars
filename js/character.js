/* =========================================================
   character.js — the character DATA MODEL + customization options
   + a procedural mesh builder (no external 3D assets needed).

   Both the creation preview and the (future third-person / shadow)
   in-world avatar use buildMesh(). First-person hides the body,
   but the mesh + options are ready for the story builder to reuse
   for NPCs.

   COLOR MODEL (three independent channels):
     • skinColor   — the head/face skin tone
     • suitColor   — the torso + arms (the outfit)
     • accentColor — the legs + gear + trim
   ========================================================= */
window.GAME = window.GAME || {};

GAME.Character = (function () {
  // ---- Customization option sets (data-driven; extend freely) ----
  const OPTIONS = {
    bodyTypes: [
      { id: 'slim',    label: 'Slim',    scale: [0.85, 1.0, 0.85] },
      { id: 'average', label: 'Average', scale: [1.0, 1.0, 1.0] },
      { id: 'stocky',  label: 'Stocky',  scale: [1.2, 0.96, 1.2] },
    ],
    // NEW: real skin tones for the head/face.
    skinTones: [
      { id: 'skin-porcelain', hex: 0xf1c9a5 },
      { id: 'skin-light',     hex: 0xe0b088 },
      { id: 'skin-tan',       hex: 0xc68642 },
      { id: 'skin-brown',     hex: 0x8d5524 },
      { id: 'skin-deep',      hex: 0x5c3317 },
      { id: 'skin-cool',      hex: 0xd9a97e },
    ],
    // The outfit / torso color (formerly mislabeled "skin").
    suitColors: [
      { id: 'suit-white',  hex: 0xe8eef5 },
      { id: 'suit-blue',  hex: 0x3b6ea5 },
      { id: 'suit-teal',  hex: 0x2f8f8f },
      { id: 'suit-red',   hex: 0xb5453b },
      { id: 'suit-slate', hex: 0x5a6472 },
      { id: 'suit-gold',  hex: 0xc9a227 },
      { id: 'suit-plum',  hex: 0x7d4a8f },
      { id: 'suit-orange',hex: 0xe07a2f },
    ],
    accentColors: [
      { id: 'acc-cyan',   hex: 0x4ea1ff },
      { id: 'acc-lime',   hex: 0x7ee787 },
      { id: 'acc-orange', hex: 0xff9f45 },
      { id: 'acc-pink',   hex: 0xff6ec7 },
      { id: 'acc-white',  hex: 0xf0f0f0 },
    ],
    headGear: [
      { id: 'helmet',  label: 'Space Helmet' },
      { id: 'visor',   label: 'HUD Visor' },
      { id: 'none',    label: 'No Helmet' },
      { id: 'antenna', label: 'Comms Antenna' },
      { id: 'hood',    label: 'Thermal Hood' },
    ],
    hairStyles: [
      { id: 'short',    label: 'Buzz Cut' },
      { id: 'long',     label: 'Tied Back' },
      { id: 'mohawk',   label: 'Regulation' },
      { id: 'afro',     label: 'Natural' },
      { id: 'ponytail', label: 'Ponytail' },
    ],
    hairColors: [
      { id: 'hair-black',    hex: 0x1c1c1c },
      { id: 'hair-brown',    hex: 0x5a3820 },
      { id: 'hair-blonde',   hex: 0xd8b866 },
      { id: 'hair-auburn',   hex: 0x8a3324 },
      { id: 'hair-gray',     hex: 0xb8b8b8 },
      { id: 'hair-fantasy',  hex: 0x6a5acd },
    ],
    // Archetypes give the story builder ready-made starting stat hooks.
    archetypes: [
      { id: 'scout',    label: 'Scout',    desc: 'Fast recon suit. +Speed.', mods: { speed: 1.15, hp: 0.9 } },
      { id: 'ranger',   label: 'Ranger',   desc: 'Balanced explorer suit.', mods: { speed: 1.0, hp: 1.0 } },
      { id: 'engineer', label: 'Engineer', desc: 'Reinforced suit. +HP, slower.', mods: { speed: 0.9, hp: 1.25 } },
    ],
  };

  // ---- Default character definition ----
  function createDefault() {
    return {
      name: 'Astronaut',
      bodyType: 'average',
      skinColor: OPTIONS.skinTones[1].hex,
      suitColor: OPTIONS.suitColors[0].hex,
      accentColor: OPTIONS.accentColors[0].hex,
      headGear: 'helmet',
      hairStyle: 'short',
      hairColor: OPTIONS.hairColors[1].hex,   // brown
      height: 180,           // cm; scales eye height in-world
      archetype: 'ranger',
    };
  }

  /* Build a low-poly humanoid mesh from a character definition.
     Returns a THREE.Group centered at feet (y=0 at ground). */
  function buildMesh(def) {
    const bt = OPTIONS.bodyTypes.find((b) => b.id === def.bodyType) || OPTIONS.bodyTypes[1];
    const [sx, sy, sz] = bt.scale;
    const suitMat   = new THREE.MeshStandardMaterial({ color: def.suitColor, roughness: 0.45, metalness: 0.35 });
    const accentMat = new THREE.MeshStandardMaterial({ color: def.accentColor, roughness: 0.35, metalness: 0.5, emissive: def.accentColor, emissiveIntensity: 0.08 });
    const skinMat   = new THREE.MeshStandardMaterial({ color: def.skinColor, roughness: 0.75 });
    const padMat    = new THREE.MeshStandardMaterial({ color: 0x2a3544, roughness: 0.6, metalness: 0.2 });

    const g = new THREE.Group();
    const heightScale = def.height / 180;
    def.headGear = def.headGear || 'helmet';

    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.15 * sx, 1.55 * sy, 0.68 * sz), suitMat);
    torso.position.y = 2.15; torso.castShadow = true; g.add(torso);
    const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.9 * sx, 0.7, 0.15), accentMat);
    chestPlate.position.set(0, 2.35, 0.38 * sz); g.add(chestPlate);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.18 * sx, 0.22, 0.7 * sz), accentMat);
    stripe.position.y = 2.55; g.add(stripe);
    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.7 * sx, 1.0, 0.35), padMat);
    backpack.position.set(0, 2.2, -0.45 * sz); backpack.castShadow = true; g.add(backpack);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 14), skinMat);
    head.position.y = 3.2; head.castShadow = true; g.add(head);
    addHair(head, def);

    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * sx, 0.2 * sx, 1.35 * sy, 10), suitMat);
      arm.position.set(side * (0.78 * sx), 2.1, 0); arm.castShadow = true; g.add(arm);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.18 * sx, 10, 10), padMat);
      glove.position.set(side * (0.78 * sx), 1.35 * sy, 0); g.add(glove);
    }
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * sx, 0.24 * sx, 1.45 * sy, 10), accentMat);
      leg.position.set(side * 0.28 * sx, 0.85, 0); leg.castShadow = true; g.add(leg);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.42 * sx, 0.28, 0.55 * sz), padMat);
      boot.position.set(side * 0.28 * sx, 0.18, 0.08); g.add(boot);
    }
    addHeadGear(g, def, accentMat);

    g.scale.set(1, heightScale, 1);
    g.userData.definition = def;
    return g;
  }

  /* Eyes, nose, and mouth built on the +Z face of the head cube.
     Head is 0.62 wide and centered at y=3.25; its front face is at z≈0.31. */
  function addFace(head, def) {
    // Per request: no facial features at all (no eyes, nose, or lips).
    // Intentionally left blank. The head is a clean skin-toned block;
    // only hair (added separately in addHair) sits on it.
    // Kept as a stub so buildMesh's call site stays stable and a future
    // builder can reintroduce features here without touching the engine.
  }

  /* Hair, parented to the head (head-local coords: cube spans ±0.31,
     top face at y≈+0.31). 'bald' adds nothing. */
  function addHair(head, def) {
    if (!def.hairStyle || def.hairStyle === 'bald') return;
    const mat = new THREE.MeshStandardMaterial({ color: def.hairColor, roughness: 0.9 });
    const TOP = 0.31; // head half-height

    if (def.hairStyle === 'short') {
      // A thin cap hugging the crown + a little back coverage.
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.16, 0.66), mat);
      cap.position.set(0, TOP + 0.02, 0);
      head.add(cap);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.34, 0.14), mat);
      back.position.set(0, TOP - 0.16, -0.28);
      head.add(back);

    } else if (def.hairStyle === 'long') {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.18, 0.68), mat);
      cap.position.set(0, TOP + 0.02, 0);
      head.add(cap);
      // Long panels down both sides + the back.
      for (const side of [-1, 1]) {
        const strand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.5), mat);
        strand.position.set(side * 0.32, TOP - 0.34, -0.02);
        head.add(strand);
      }
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.8, 0.14), mat);
      back.position.set(0, TOP - 0.4, -0.28);
      head.add(back);

    } else if (def.hairStyle === 'mohawk') {
      // A central crest of tapered blocks along the head's front-back axis.
      for (let i = 0; i < 5; i++) {
        const h = 0.28 - Math.abs(i - 2) * 0.05;
        const seg = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, 0.12), mat);
        seg.position.set(0, TOP + h / 2, 0.2 - i * 0.1);
        head.add(seg);
      }

    } else if (def.hairStyle === 'afro') {
      // A rounded puff sitting on the crown.
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.44, 14, 12), mat);
      puff.position.set(0, TOP + 0.16, 0);
      puff.scale.set(1, 0.9, 1);
      head.add(puff);
    } else if (def.hairStyle === 'ponytail') {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      cap.position.set(0, TOP - 0.02, 0); head.add(cap);
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.55, 8), mat);
      tail.position.set(0, TOP - 0.1, -0.42); tail.rotation.x = 0.5; head.add(tail);
    }
  }

  function addHeadGear(group, def, accentMat) {
    if (def.headGear === 'none') return;
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x88ccff, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.75 });
    const shellMat = new THREE.MeshStandardMaterial({ color: def.suitColor, roughness: 0.35, metalness: 0.45 });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 14, 0, Math.PI * 2, 0, Math.PI / 1.05), shellMat);
    helmet.position.y = 3.35; helmet.castShadow = true; group.add(helmet);
    const faceVisor = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12, 0, Math.PI * 2, 0, Math.PI / 2.2), visorMat);
    faceVisor.position.set(0, 3.32, 0.08); faceVisor.rotation.x = -0.15; group.add(faceVisor);
    if (def.headGear === 'visor') {
      const hudVisor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.22),
        new THREE.MeshStandardMaterial({ color: 0x4ea1ff, emissive: 0x1a4d80, emissiveIntensity: 0.7 }));
      hudVisor.position.set(0, 3.78, 0.12); group.add(hudVisor);
    }
    if (def.headGear === 'antenna') {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 8), accentMat);
      pole.position.set(0.2, 3.85, 0); group.add(pole);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), accentMat);
      tip.position.set(0.2, 4.15, 0); group.add(tip);
    }
    if (def.headGear === 'hood') {
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.52, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.3), shellMat);
      hood.position.y = 3.3; group.add(hood);
    }
  }

  return { OPTIONS, createDefault, buildMesh };
})();
