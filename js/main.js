/* =========================================================
   main.js — bootstrap, render loop, HUD binding.
   Wires the modules together and owns the single game loop.
   ========================================================= */
window.GAME = window.GAME || {};

// ---------- Lightweight UI helper (used by story + engine) ----------
GAME.UI = (function () {
  function showObjective(title, text) {
    const el = document.getElementById('objective');
    el.innerHTML = `<div class="obj-title">${title}</div><div class="obj-text">${text}</div>`;
    el.classList.remove('hidden');
  }
  function hideObjective() { document.getElementById('objective').classList.add('hidden'); }

  /* ---------- Dialogue box (story layer drives this) ---------- */
  function showDialogue(speaker, text) {
    document.getElementById('dlg-speaker').textContent = speaker || 'Stranger';
    document.getElementById('dlg-text').textContent = text || '';
    document.getElementById('dialogue-box').classList.remove('hidden');
  }
  function hideDialogue() { document.getElementById('dialogue-box').classList.add('hidden'); }
  function isDialogueOpen() { return !document.getElementById('dialogue-box').classList.contains('hidden'); }

  let _toastStack = null;
  function ensureToastStack() {
    if (_toastStack) return _toastStack;
    _toastStack = document.createElement('div');
    _toastStack.id = 'toast-stack';
    Object.assign(_toastStack.style, {
      position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)',
      zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: '6px', pointerEvents: 'none',
    });
    document.body.appendChild(_toastStack);
    return _toastStack;
  }
  function toast(message) {
    const stack = ensureToastStack();
    const t = document.createElement('div');
    t.textContent = message;
    Object.assign(t.style, {
      background: 'rgba(13,17,23,.85)', border: '1px solid #4ea1ff', color: '#e6edf3',
      padding: '10px 18px', borderRadius: '8px', fontSize: '14px',
      transition: 'opacity .4s', pointerEvents: 'none', whiteSpace: 'nowrap',
    });
    stack.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; }, 1800);
    setTimeout(() => t.remove(), 2400);
  }

  function buildHotbar() {
    const bar = document.getElementById('hotbar');
    bar.innerHTML = '';
    for (let i = 0; i < GAME.Config.hotbarSlots; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot' + (i === 0 ? ' active' : '');
      slot.innerHTML = `<span class="slot-num">${i === 9 ? '0' : i + 1}</span>`;
      slot.dataset.index = i;
      bar.appendChild(slot);
    }
  }
  function setActiveSlot(i) {
    document.querySelectorAll('#hotbar .slot').forEach((s) =>
      s.classList.toggle('active', +s.dataset.index === i));
  }

  /* Repaint the hotbar from GAME.State.hotbar + inventory counts.
     Shows the resource icon and its stack count, Minecraft-style. */
  function refreshHotbar() {
    const slots = document.querySelectorAll('#hotbar .slot');
    slots.forEach((slot, i) => {
      const resId = GAME.State.hotbar[i];
      if (resId) {
        const def = GAME.State.itemDef(resId);
        const count = GAME.State.getResourceCount(resId);
        slot.innerHTML =
          `<span class="slot-num">${i === 9 ? '0' : i + 1}</span>` +
          `<span class="slot-icon">${def ? def.icon : '?'}</span>` +
          `<span class="slot-count">${count}</span>`;
      } else {
        slot.innerHTML = `<span class="slot-num">${i === 9 ? '0' : i + 1}</span>`;
      }
    });
  }

  /* ---------- Crafting panel ---------- */
  let craftOpen = false;
  function toggleCraft(force) {
    craftOpen = (typeof force === 'boolean') ? force : !craftOpen;
    const panel = document.getElementById('craft-panel');
    panel.classList.toggle('hidden', !craftOpen);
    if (craftOpen) renderCraft();
    return craftOpen;
  }
  function isCraftOpen() { return craftOpen; }

  function renderCraft() {
    const list = document.getElementById('craft-list');
    list.innerHTML = '';
    (GAME.Config.recipes || []).forEach((r) => {
      // Weapons live in GAME.Config.weapons (not the item catalogs), so fall
      // back to that so weapon recipes show a proper icon + name.
      const outDef = GAME.State.itemDef(r.output)
        || (r.weapon && GAME.Config.weapons ? GAME.Config.weapons[r.output] : null);
      const can = GAME.State.canCraft(r.id);
      const unlocked = GAME.State.isRecipeUnlocked(r.id);
      const owned = r.weapon && GAME.State.unlockedWeapons.includes(r.output);
      const equipped = r.weapon && GAME.State.weapon === r.output;

      // Build the cost line, coloring each input by whether we have enough.
      const cost = Object.entries(r.inputs).map(([id, n]) => {
        const def = GAME.State.itemDef(id);
        const have = GAME.State.getResourceCount(id);
        const cls = have >= n ? 'have' : 'lack';
        return `<span class="${cls}">${def ? def.icon : ''}${def ? def.name : id} ${have}/${n}</span>`;
      }).join('  ·  ');

      const row = document.createElement('div');
      row.className = 'craft-recipe' + (unlocked ? '' : ' locked');
      row.innerHTML =
        `<div class="r-icon">${outDef ? outDef.icon : '?'}</div>` +
        `<div class="r-body">` +
          `<div class="r-name">${outDef ? outDef.name : r.output} ×${r.amount}` +
            `${outDef && outDef.placeable ? ' <span style="font-size:10px;color:var(--accent)">placeable</span>' : ''}` +
            `${r.weapon ? ' <span style="font-size:10px;color:#ffcf6b">weapon</span>' : ''}</div>` +
          `<div class="r-cost">${cost}</div>` +
        `</div>`;
      const btn = document.createElement('button');
      btn.className = 'craft-btn';
      btn.textContent = equipped ? 'Equipped' : (owned ? 'Owned' : (unlocked ? 'Craft' : 'Locked'));
      btn.disabled = !can;
      if (owned && !equipped) {
        // Already crafted but not equipped → let the button equip it.
        btn.textContent = 'Equip';
        btn.disabled = false;
        btn.addEventListener('click', () => { GAME.State.equipWeapon(r.output); renderCraft(); });
        row.appendChild(btn); list.appendChild(row); return;
      }
      btn.addEventListener('click', () => {
        if (GAME.State.craft(r.id)) { refreshHotbar(); renderCraft(); }
      });
      row.appendChild(btn);
      list.appendChild(row);
    });
  }

  /* ---------- RPG stage tracker ---------- */
  function renderStage() {
    const st = GAME.State.currentStage && GAME.State.currentStage();
    const el = document.getElementById('stage-tracker');
    if (!el) return;
    if (!st || GAME.State.won) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const objs = st.objectives.map((o) => {
      const p = GAME.State.objectiveProgress(o);
      const cls = p.done ? 'obj-done' : '';
      const check = p.done ? '✅' : '▫️';
      return `<div class="stage-obj ${cls}">${check} ${p.label} — ${Math.min(p.have, p.need)}/${p.need}</div>`;
    }).join('');
    el.innerHTML =
      `<div class="stage-title">Stage ${st.id}: ${st.name}</div>` +
      `<div class="stage-objs">${objs}</div>`;
  }

  /* ---------- Victory screen ---------- */
  function showWin() {
    let el = document.getElementById('win-screen');
    if (!el) {
      el = document.createElement('div');
      el.id = 'win-screen';
      el.className = 'overlay death-overlay';
      document.getElementById('game-screen').appendChild(el);
    }
    el.innerHTML =
      `<div class="overlay-card win-card">` +
      `<h2>🚀 Beyond the Stars</h2>` +
      `<p class="death-sub">You boarded the rocket and escaped Xylos! The stars await.</p>` +
      `<button class="primary-btn" id="win-restart">Play Again</button>` +
      `</div>`;
    el.classList.remove('hidden');
    document.exitPointerLock && document.exitPointerLock();
    document.getElementById('win-restart').addEventListener('click', () => {
      GAME.State.clearSave();
      location.reload();
    });
  }

  function showGameOver(reason) {
    let el = document.getElementById('gameover-screen');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gameover-screen';
      el.className = 'overlay death-overlay';
      document.getElementById('game-screen').appendChild(el);
    }
    const oxygen = reason === 'oxygen';
    el.innerHTML =
      `<div class="overlay-card ${oxygen ? 'death-oxygen' : 'death-alien'}">` +
      `<h2>${oxygen ? '💨 Oxygen Depleted' : '👽 Fallen to Invaders'}</h2>` +
      `<p class="death-sub">${oxygen
        ? 'Your suit ran out of oxygen on Xylos. The planet claimed another wanderer.'
        : 'Alien invaders overwhelmed your suit. Xylos remains unconquered.'}</p>` +
      `<button class="primary-btn" id="gameover-restart">Try Again</button>` +
      `</div>`;
    el.classList.remove('hidden');
    document.exitPointerLock && document.exitPointerLock();
    document.getElementById('gameover-restart').addEventListener('click', () => {
      GAME.State.clearSave();
      location.reload();
    });
  }

  return {
    showObjective, hideObjective, toast, buildHotbar, setActiveSlot, refreshHotbar,
    toggleCraft, isCraftOpen, renderCraft,
    showDialogue, hideDialogue, isDialogueOpen,
    renderStage, showWin, showGameOver,
  };
})();

// ---------- Main game controller ----------
(function () {
  let scene, camera, renderer;
  let last = performance.now();
  let running = false;
  let pendingSave = null;   // set when continuing from a saved game

  function boot() {
    // If a save exists, offer to continue (skips character creation).
    if (GAME.State.hasSave && GAME.State.hasSave()) {
      const cont = window.confirm('A saved game was found.\n\nOK = Continue your save\nCancel = Start a new game');
      if (cont) {
        const data = GAME.State.load();
        if (data && GAME.State.character) {
          pendingSave = data;
          onCharacterReady(GAME.State.character);
          return;
        }
      } else {
        GAME.State.clearSave();
      }
    }
    // Otherwise start on the creation screen. When done, enter the world.
    GAME.Customization.init(onCharacterReady);
  }

  function onCharacterReady(character) {
    document.getElementById('creation-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    initGame(character);
  }

  function initGame(character) {
    const canvas = document.getElementById('game-canvas');
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 1000);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    // Build map + player
    GAME.World.build(scene);
    // Add the camera to the scene so camera-attached viewmodels (the axe)
    // render. Without this, children of the camera are never drawn.
    scene.add(camera);
    // Pass the full World module (has groundHeight + colliders/interactables
    // getters) — NOT the build() return value, which omits groundHeight.
    GAME.Player.init(camera, GAME.World, canvas);

    // HUD
    GAME.UI.buildHotbar();
    document.getElementById('hud-name').textContent = character.name;
    bindHudEvents();

    // Story layer initializes last, after everything exists.
    GAME.Story.init();

    // If we're continuing from a save, restore world blocks + refresh HUD.
    if (pendingSave) {
      if (pendingSave.blocks && GAME.World.restoreBlocks) GAME.World.restoreBlocks(pendingSave.blocks);
      GAME.UI.refreshHotbar();
      GAME.UI.toast('Save loaded — welcome back');
      pendingSave = null;
    }

    // Autosave on a timer.
    setInterval(() => { if (running) GAME.State.save(); }, GAME.Config.save.autosaveInterval * 1000);

    // Clicking the dialogue box dismisses it.
    document.getElementById('dialogue-box')
      .addEventListener('click', () => GAME.UI.hideDialogue());

    window.addEventListener('resize', onResize);

    // Signal readiness, then start.
    GAME.Events.emit('game:ready', {});
    GAME.Events.emit('game:start', { character });

    // Reflect the equipped weapon in the HUD at start.
    const w0 = GAME.State.activeWeapon();
    const wEl = document.getElementById('hud-weapon');
    if (wEl && w0) wEl.textContent = w0.icon + ' ' + w0.name;

    running = true;
    last = performance.now();
    requestAnimationFrame(loop);
  }

  function bindHudEvents() {
    const hpBar = document.getElementById('bar-hp');
    const oxyBar = document.getElementById('bar-hunger');

    const refreshStats = () => {
      const s = GAME.State.stats, p = GAME.Config.progression;
      const maxHP = GAME.State.character?.maxHP || p.maxHP;
      hpBar.style.width = Math.min(100, s.hp / maxHP * 100) + '%';
      oxyBar.style.width = Math.min(100, s.hunger / GAME.Config.survival.maxHunger * 100) + '%';
    };
    GAME.Events.on('player:damage', refreshStats);
    GAME.Events.on('player:heal', refreshStats);
    GAME.Events.on('survival:update', refreshStats);
    GAME.Events.on('resource:select', ({ slot }) => GAME.UI.setActiveSlot(slot));

    // Resource harvested → repaint the bottom bar + toast.
    GAME.Events.on('resource:pickup', ({ id, total }) => {
      const def = GAME.State.itemDef(id);
      GAME.UI.refreshHotbar();
      GAME.UI.toast(`+1 ${def ? def.name : id}  (${total})`);
    });

    // Crafting outcomes.
    GAME.Events.on('craft:success', ({ output, amount, weapon }) => {
      const def = GAME.State.itemDef(output)
        || (weapon && GAME.Config.weapons ? GAME.Config.weapons[output] : null);
      GAME.UI.refreshHotbar();
      if (weapon) {
        GAME.UI.toast(`⚔️ Crafted & equipped ${def ? def.icon + ' ' + def.name : output}`);
        const wEl = document.getElementById('hud-weapon');
        if (wEl && def) wEl.textContent = def.icon + ' ' + def.name;
      } else {
        GAME.UI.toast(`Crafted ${def ? def.icon + ' ' + def.name : output} ×${amount}`);
      }
    });
    GAME.Events.on('craft:fail', () => {
      GAME.UI.toast('Not enough materials');
    });

    // Block placed in the world.
    GAME.Events.on('build:place', ({ item }) => {
      const def = GAME.State.itemDef(item);
      GAME.UI.refreshHotbar();
      GAME.UI.toast(`Placed ${def ? def.name : item}`);
    });

    // Block deconstructed → refunded.
    GAME.Events.on('build:remove', ({ item }) => {
      const def = GAME.State.itemDef(item);
      GAME.UI.refreshHotbar();
      GAME.UI.toast(`Recovered ${def ? def.name : item}`);
    });

    // Foraged a loose pickup off the ground.
    GAME.Events.on('forage:collect', ({ resource, label }) => {
      const def = GAME.State.itemDef(resource);
      GAME.UI.refreshHotbar();
      GAME.UI.toast(`Picked up ${label || (def ? def.name : resource)}`);
    });

    // Ate food → hunger restored; refresh bar + hotbar (stack may be gone).
    GAME.Events.on('item:eat', ({ name, restored }) => {
      document.getElementById('bar-hunger').style.width =
        Math.min(100, GAME.State.stats.hunger / GAME.Config.survival.maxHunger * 100) + '%';
      GAME.UI.refreshHotbar();
      GAME.UI.toast(`Ate ${name} (+${Math.round(restored)} food)`);
    });

    // Cooking heal feedback: eating near a campfire restores health.
    GAME.Events.on('player:heal', ({ amount, cooked }) => {
      refreshStats();
      if (cooked && amount > 0) GAME.UI.toast(`🍳 +${Math.round(amount)} HP (cooked by campfire)`);
    });

    // Eating raw food that made you sick.
    GAME.Events.on('item:eat', ({ sick }) => {
      if (sick) { refreshStats(); GAME.UI.toast('🤢 That was raw — you feel sick!'); }
    });

    // Enemy combat feedback.
    GAME.Events.on('enemy:hit', () => { refreshStats(); GAME.UI.toast('👽 An alien invader struck you!'); });
    GAME.Events.on('enemy:killed', () => GAME.UI.toast('💀 Alien invader defeated'));

    GAME.Events.on('daynight:dusk', () => GAME.UI.toast('🌑 Night approaches — alien invaders are coming!'));
    GAME.Events.on('daynight:night', () => GAME.UI.toast('🌑 Night — hostile aliens roam Xylos!'));
    GAME.Events.on('daynight:day', () => {
      if (GAME.UI.isDialogueOpen && GAME.UI.isDialogueOpen()) GAME.UI.hideDialogue();
      GAME.UI.toast('☀️ Dawn — the invaders retreat.');
    });

    GAME.Events.on('game:saved', () => GAME.UI.toast('💾 Game saved'));
    GAME.Events.on('game:loaded', () => { refreshStats(); GAME.UI.refreshHotbar(); });
    GAME.Events.on('survival:update', () => refreshStats());
    GAME.Events.on('weapon:unlock', ({ name }) => GAME.UI.toast('🗡️ New tool: ' + name));
    GAME.Events.on('weapon:equip', ({ weapon }) => {
      const el = document.getElementById('hud-weapon');
      if (el && weapon) el.textContent = weapon.icon + ' ' + weapon.name;
    });
    GAME.Events.on('game:win', () => GAME.UI.showWin());
    GAME.Events.on('player:death', ({ reason }) => {
      running = false;
      GAME.UI.showGameOver(reason || GAME.State.deathReason);
    });

    refreshStats();
  }

  function onResize() {
    if (!camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); // clamp for stability
    last = now;
    const t = now / 1000;

    GAME.Player.update(dt);
    GAME.World.update(dt, t);

    const pp = GAME.Player.getPosition();
    const tod = GAME.World.timeOfDay ? GAME.World.timeOfDay() : null;
    const clk = tod ? (tod.isNight ? '🌑 Night' : '☀️ Day') : '';
    document.getElementById('hud-coords').textContent =
      `${clk}   x ${pp.x.toFixed(0)}  z ${pp.z.toFixed(0)}`;

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  // Go.
  window.addEventListener('DOMContentLoaded', boot);
})();
