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
      { id: 'suit-blue',  hex: 0x3b6ea5 },
      { id: 'suit-teal',  hex: 0x2f8f8f },
      { id: 'suit-red',   hex: 0xb5453b },
      { id: 'suit-slate', hex: 0x5a6472 },
      { id: 'suit-gold',  hex: 0xc9a227 },
      { id: 'suit-plum',  hex: 0x7d4a8f },
    ],
    accentColors: [
      { id: 'acc-cyan',   hex: 0x4ea1ff },
      { id: 'acc-lime',   hex: 0x7ee787 },
      { id: 'acc-orange', hex: 0xff9f45 },
      { id: 'acc-pink',   hex: 0xff6ec7 },
      { id: 'acc-white',  hex: 0xf0f0f0 },
    ],
    headGear: [
      { id: 'none',    label: 'None' },
      { id: 'helmet',  label: 'Helmet' },
      { id: 'visor',   label: 'Visor' },
      { id: 'antenna', label: 'Antenna' },
    ],
    // Hair styles (procedural — no assets). 'bald' = no hair mesh.
    hairStyles: [
      { id: 'bald',     label: 'Bald' },
      { id: 'short',    label: 'Short' },
      { id: 'long',     label: 'Long' },
      { id: 'mohawk',   label: 'Mohawk' },
      { id: 'afro',     label: 'Afro' },
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
      { id: 'scout',    label: 'Scout',    desc: 'Fast and light. +Stamina, +Speed.',    mods: { speed: 1.15, stamina: 1.2, hp: 0.9 } },
      { id: 'ranger',   label: 'Ranger',   desc: 'Balanced survivor. No weaknesses.',      mods: { speed: 1.0,  stamina: 1.0, hp: 1.0 } },
      { id: 'engineer', label: 'Engineer', desc: 'Tough builder. +HP, slower.',           mods: { speed: 0.9,  stamina: 1.0, hp: 1.25 } },
    ],
  };

  // ---- Default character definition ----
  function createDefault() {
    return {
      name: 'Wanderer',
      bodyType: 'average',
      skinColor: OPTIONS.skinTones[1].hex,    // face/head skin
      suitColor: OPTIONS.suitColors[0].hex,   // torso + arms
      accentColor: OPTIONS.accentColors[0].hex,
      headGear: 'none',
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
    const suitMat   = new THREE.MeshStandardMaterial({ color: def.suitColor, roughness: 0.7, metalness: 0.1 });
    const accentMat = new THREE.MeshStandardMaterial({ color: def.accentColor, roughness: 0.5, metalness: 0.3 });
    const skinMat   = new THREE.MeshStandardMaterial({ color: def.skinColor, roughness: 0.8 });

    const g = new THREE.Group();
    const heightScale = def.height / 180; // 1.0 at 180cm

    // Torso (suit)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.1 * sx, 1.5 * sy, 0.6 * sz), suitMat);
    torso.position.y = 2.15;
    torso.castShadow = true;
    g.add(torso);

    // Accent chest stripe
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.12 * sx, 0.28, 0.62 * sz), accentMat);
    stripe.position.y = 2.35;
    g.add(stripe);

    // Head (skin tone)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), skinMat);
    head.position.y = 3.25;
    head.castShadow = true;
    g.add(head);

    // Face features, parented to the head so they scale/track with it.
    addFace(head, def);

    // Hair, parented to the head as well.
    addHair(head, def);

    // Arms (suit)
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3 * sx, 1.35 * sy, 0.3 * sz), suitMat);
      arm.position.set(side * (0.75 * sx), 2.1, 0);
      arm.castShadow = true;
      g.add(arm);
    }

    // Hands (skin tone) — small touch that reads as "person"
    for (const side of [-1, 1]) {
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.32 * sx, 0.3, 0.32 * sz), skinMat);
      hand.position.set(side * (0.75 * sx), 1.42 * sy + 0.6, 0);
      g.add(hand);
    }

    // Legs (accent)
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.38 * sx, 1.4 * sy, 0.4 * sz), accentMat);
      leg.position.set(side * 0.28 * sx, 0.85, 0);
      leg.castShadow = true;
      g.add(leg);
    }

    // Head gear
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
    }
  }

  function addHeadGear(group, def, accentMat) {
    if (def.headGear === 'helmet') {
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10, 0, Math.PI * 2, 0, Math.PI / 1.7), accentMat);
      helmet.position.y = 3.4;
      group.add(helmet);
    } else if (def.headGear === 'visor') {
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.16, 0.66),
        new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.2, metalness: 0.6 }));
      visor.position.set(0, 3.32, 0.02);
      group.add(visor);
    } else if (def.headGear === 'antenna') {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7), accentMat);
      rod.position.set(0.18, 3.85, 0);
      group.add(rod);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09), accentMat);
      ball.position.set(0.18, 4.2, 0);
      group.add(ball);
    }
  }

  return { OPTIONS, createDefault, buildMesh };
})();
