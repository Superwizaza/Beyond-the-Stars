/* =========================================================
   customization.js — SCREEN 1 logic.
   Builds the option UI, renders a live rotating 3D preview,
   and hands the finished character to gameState + main.
   ========================================================= */
window.GAME = window.GAME || {};

GAME.Customization = (function () {
  const C = GAME.Character;
  let def = C.createDefault();

  // Preview 3D
  let scene, camera, renderer, meshGroup, raf;
  let dragging = false, lastX = 0, yaw = 0.6;

  function init(onDone) {
    buildUI();
    initPreview();
    refreshPreviewMesh();
    animate();

    document.getElementById('start-btn').addEventListener('click', () => {
      def.name = (document.getElementById('char-name').value || 'Wanderer').trim();
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      // Persist the finished character into global state.
      GAME.State.character = JSON.parse(JSON.stringify(def));
      applyArchetypeToStats(def);
      onDone(def);
    });
  }

  function applyArchetypeToStats(d) {
    const arch = C.OPTIONS.archetypes.find((a) => a.id === d.archetype);
    if (!arch) return;
    const p = GAME.Config.progression;
    const maxHP = Math.round(p.maxHP * arch.mods.hp);
    GAME.State.stats.hp = maxHP;
    GAME.State.character.maxHP = maxHP;
    GAME.State.character.speedMod = arch.mods.speed;
    GAME.State.character.hpMod = arch.mods.hp;
  }

  // ---------- UI construction ----------
  function buildUI() {
    // Body types
    const bt = document.getElementById('bodytype-options');
    C.OPTIONS.bodyTypes.forEach((o) => {
      bt.appendChild(chip(o.label, def.bodyType === o.id, () => {
        def.bodyType = o.id; select(bt, o.label); refreshPreviewMesh();
      }));
    });

    // Skin tone swatches (head/face)
    const skin = document.getElementById('skin-swatches');
    C.OPTIONS.skinTones.forEach((o) => {
      skin.appendChild(swatch(o.hex, def.skinColor === o.hex, (el) => {
        def.skinColor = o.hex; selectSwatch(skin, el); refreshPreviewMesh();
      }));
    });

    // Suit swatches (torso + arms)
    const suit = document.getElementById('suit-swatches');
    C.OPTIONS.suitColors.forEach((o) => {
      suit.appendChild(swatch(o.hex, def.suitColor === o.hex, (el) => {
        def.suitColor = o.hex; selectSwatch(suit, el); refreshPreviewMesh();
      }));
    });

    // Accent swatches
    const acc = document.getElementById('accent-swatches');
    C.OPTIONS.accentColors.forEach((o) => {
      acc.appendChild(swatch(o.hex, def.accentColor === o.hex, (el) => {
        def.accentColor = o.hex; selectSwatch(acc, el); refreshPreviewMesh();
      }));
    });

    // Head gear
    const hg = document.getElementById('headgear-options');
    C.OPTIONS.headGear.forEach((o) => {
      hg.appendChild(chip(o.label, def.headGear === o.id, () => {
        def.headGear = o.id; select(hg, o.label); refreshPreviewMesh();
      }));
    });

    // Hair type
    const hair = document.getElementById('hairstyle-options');
    C.OPTIONS.hairStyles.forEach((o) => {
      hair.appendChild(chip(o.label, def.hairStyle === o.id, () => {
        def.hairStyle = o.id; select(hair, o.label); refreshPreviewMesh();
      }));
    });

    // Hair color
    const hairCol = document.getElementById('haircolor-swatches');
    C.OPTIONS.hairColors.forEach((o) => {
      hairCol.appendChild(swatch(o.hex, def.hairColor === o.hex, (el) => {
        def.hairColor = o.hex; selectSwatch(hairCol, el); refreshPreviewMesh();
      }));
    });

    // Height slider
    const hs = document.getElementById('height-slider');
    const hr = document.getElementById('height-readout');
    hr.textContent = def.height + ' cm';
    hs.value = def.height;
    hs.addEventListener('input', () => {
      def.height = parseInt(hs.value, 10);
      hr.textContent = def.height + ' cm';
      refreshPreviewMesh();
    });

    // Archetype select
    const sel = document.getElementById('class-select');
    const desc = document.getElementById('class-desc');
    C.OPTIONS.archetypes.forEach((a) => {
      const opt = document.createElement('option');
      opt.value = a.id; opt.textContent = a.label; sel.appendChild(opt);
    });
    sel.value = def.archetype;
    const showDesc = () => {
      const a = C.OPTIONS.archetypes.find((x) => x.id === sel.value);
      desc.textContent = a ? a.desc : '';
    };
    sel.addEventListener('change', () => { def.archetype = sel.value; showDesc(); });
    showDesc();
  }

  function chip(label, selected, onClick) {
    const el = document.createElement('div');
    el.className = 'option-chip' + (selected ? ' selected' : '');
    el.textContent = label;
    el.addEventListener('click', onClick);
    return el;
  }
  function swatch(hex, selected, onClick) {
    const el = document.createElement('div');
    el.className = 'swatch' + (selected ? ' selected' : '');
    el.style.background = '#' + hex.toString(16).padStart(6, '0');
    el.addEventListener('click', () => onClick(el));
    return el;
  }
  function select(container, label) {
    [...container.children].forEach((c) =>
      c.classList.toggle('selected', c.textContent === label));
  }
  function selectSwatch(container, el) {
    [...container.children].forEach((c) => c.classList.remove('selected'));
    el.classList.add('selected');
  }

  // ---------- 3D preview ----------
  function initPreview() {
    const canvas = document.getElementById('preview-canvas');
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 2.4, 7);
    camera.lookAt(0, 2.2, 0);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(4, 8, 6); scene.add(key);
    const rim = new THREE.DirectionalLight(0x4ea1ff, 0.5);
    rim.position.set(-5, 3, -4); scene.add(rim);

    // Rotating platform
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.4, 0.25, 32),
      new THREE.MeshStandardMaterial({ color: 0x1f2733, roughness: 0.6 }));
    disc.position.y = 0.12; scene.add(disc);

    // Drag-to-rotate
    canvas.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; });
    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      yaw += (e.clientX - lastX) * 0.01; lastX = e.clientX;
    });

    window.addEventListener('resize', onResize);
    onResize();
  }

  function onResize() {
    const pane = document.getElementById('preview-pane');
    if (!pane) return;
    const w = pane.clientWidth, h = pane.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function refreshPreviewMesh() {
    if (meshGroup) scene.remove(meshGroup);
    meshGroup = C.buildMesh(def);
    scene.add(meshGroup);
  }

  function animate() {
    raf = requestAnimationFrame(animate);
    if (meshGroup) meshGroup.rotation.y = yaw + (dragging ? 0 : Math.sin(Date.now() * 0.0004) * 0.25);
    renderer.render(scene, camera);
  }

  return { init };
})();
