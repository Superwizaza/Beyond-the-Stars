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

  function toast(message) {
    const t = document.createElement('div');
    t.textContent = message;
    Object.assign(t.style, {
      position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(13,17,23,.85)', border: '1px solid #4ea1ff', color: '#e6edf3',
      padding: '10px 18px', borderRadius: '8px', fontSize: '14px', zIndex: 50,
      transition: 'opacity .4s', pointerEvents: 'none',
    });
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; }, 1800);
    setTimeout(() => t.remove(), 2400);
  }

  function buildHotbar() {
    const bar = document.getElementById('hotbar');
    bar.innerHTML = '';
    for (let i = 0; i < GAME.Config.hotbarSlots; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot' + (i === 0 ? ' active' : '');
      slot.innerHTML = `<span class="slot-num">${i + 1}</span>`;
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
          `<span class="slot-num">${i + 1}</span>` +
          `<span class="slot-icon">${def ? def.icon : '?'}</span>` +
          `<span class="slot-count">${count}</span>`;
      } else {
        slot.innerHTML = `<span class="slot-num">${i + 1}</span>`;
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
      const outDef = GAME.State.itemDef(r.output);
      const can = GAME.State.canCraft(r.id);
      const unlocked = GAME.State.isRecipeUnlocked(r.id);

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
            `${outDef && outDef.placeable ? ' <span style="font-size:10px;color:var(--accent)">placeable</span>' : ''}</div>` +
          `<div class="r-cost">${unlocked ? cost : '🔒 Unlocks at Level ' + (r.unlockLevel || 1)}</div>` +
        `</div>`;
      const btn = document.createElement('button');
      btn.className = 'craft-btn';
      btn.textContent = unlocked ? 'Craft' : 'Locked';
      btn.disabled = !can;
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
      el.className = 'overlay';
      document.getElementById('game-screen').appendChild(el);
    }
    el.innerHTML =
      `<div class="overlay-card">` +
      `<h2>🏆 Victory!</h2>` +
      `<p style="color:var(--muted);margin-bottom:16px">You cleared every stage of Untitled Quest.</p>` +
      `<button class="primary-btn" id="win-restart">Play Again</button>` +
      `</div>`;
    el.classList.remove('hidden');
    document.exitPointerLock && document.exitPointerLock();
    document.getElementById('win-restart').addEventListener('click', () => {
      GAME.State.clearSave();
      location.reload();
    });
  }

  return {
    showObjective, hideObjective, toast, buildHotbar, setActiveSlot, refreshHotbar,
    toggleCraft, isCraftOpen, renderCraft,
    showDialogue, hideDialogue, isDialogueOpen,
    renderStage, showWin,
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

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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

    // Initialize the RPG stage tracker + show the current stage intro.
    const st0 = GAME.State.currentStage && GAME.State.currentStage();
    if (st0 && !GAME.State.won) {
      GAME.UI.renderStage();
      GAME.UI.showObjective('Stage ' + st0.id + ': ' + st0.name, st0.intro);
    }
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
    const staBar = document.getElementById('bar-sta');
    const lvl = document.getElementById('hud-level');
    const xp = document.getElementById('hud-xp');

    const refreshStats = () => {
      const s = GAME.State.stats, p = GAME.Config.progression;
      const maxHP = GAME.State.character?.maxHP || p.maxHP;
      hpBar.style.width = Math.min(100, s.hp / maxHP * 100) + '%';
      lvl.textContent = 'Lv ' + s.level;
      // Show progress toward the next level (threshold = xpPerLevel × level).
      const need = p.xpPerLevel * s.level;
      xp.textContent = 'XP ' + Math.round(s.xp) + '/' + need;
    };
    GAME.Events.on('player:damage', refreshStats);
    GAME.Events.on('player:heal', refreshStats);
    GAME.Events.on('stat:xp', refreshStats);
    GAME.Events.on('stat:levelup', ({ level, unlocked }) => {
      refreshStats();
      GAME.UI.toast('Level Up! → Lv ' + level);
      // Announce any recipes that just became available.
      if (unlocked && unlocked.length) {
        unlocked.forEach((out) => {
          const def = GAME.State.itemDef(out);
          setTimeout(() => GAME.UI.toast(`🔓 Unlocked: ${def ? def.icon + ' ' + def.name : out}`), 400);
        });
      }
      // Keep the crafting panel current if it's open.
      if (GAME.UI.isCraftOpen && GAME.UI.isCraftOpen()) GAME.UI.renderCraft();
    });
    GAME.Events.on('resource:select', ({ slot }) => GAME.UI.setActiveSlot(slot));

    // Resource harvested → repaint the bottom bar + toast.
    GAME.Events.on('resource:pickup', ({ id, total }) => {
      const def = GAME.State.itemDef(id);
      GAME.UI.refreshHotbar();
      GAME.UI.toast(`+1 ${def ? def.name : id}  (${total})`);
    });

    // Crafting outcomes.
    GAME.Events.on('craft:success', ({ output, amount }) => {
      const def = GAME.State.itemDef(output);
      GAME.UI.refreshHotbar();
      GAME.UI.toast(`Crafted ${def ? def.icon + ' ' + def.name : output} ×${amount}`);
    });
    GAME.Events.on('craft:fail', ({ locked, unlockLevel }) => {
      if (locked) GAME.UI.toast(`🔒 Reach Level ${unlockLevel} to craft this`);
      else GAME.UI.toast('Not enough materials');
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

    // Eating raw food that made you sick.
    GAME.Events.on('item:eat', ({ sick }) => {
      if (sick) { refreshStats(); GAME.UI.toast('🤢 That was raw — you feel sick!'); }
    });

    // Enemy combat feedback.
    GAME.Events.on('enemy:hit', () => { refreshStats(); GAME.UI.toast('⚔️ An enemy struck you!'); });
    GAME.Events.on('enemy:killed', () => GAME.UI.toast('💀 Enemy slain (+XP)'));

    // Save / load toasts.
    GAME.Events.on('game:saved', () => GAME.UI.toast('💾 Game saved'));
    GAME.Events.on('game:loaded', () => { refreshStats(); GAME.UI.refreshHotbar(); });

    // Survival: live hunger bar + warmth indicator.
    const hungerBar = document.getElementById('bar-hunger');
    const warmthEl = document.getElementById('hud-warmth');
    GAME.Events.on('survival:update', ({ hunger, warm, night }) => {
      hungerBar.style.width = Math.min(100, hunger / GAME.Config.survival.maxHunger * 100) + '%';
      refreshStats(); // HP may be changing from starve/cold/warmth
      if (warm) warmthEl.textContent = '🔥 Warm';
      else if (night) warmthEl.textContent = '🥶 Cold';
      else warmthEl.textContent = '';
    });

    // RPG stage tracker: repaint the objective panel on any progress.
    GAME.Events.on('stage:progress', () => GAME.UI.renderStage());
    GAME.Events.on('resource:pickup', () => GAME.UI.renderStage());

    // Stage advanced → announce + refresh tracker.
    GAME.Events.on('stage:advance', ({ to, stage }) => {
      GAME.UI.renderStage();
      if (stage) {
        GAME.UI.showObjective('Stage ' + stage.id + ': ' + stage.name, stage.intro);
        GAME.UI.toast('🏆 Stage ' + to + ' — ' + stage.name);
      }
    });

    // Weapon unlocked / equipped feedback.
    GAME.Events.on('weapon:unlock', ({ name }) => GAME.UI.toast('🗡️ New weapon: ' + name));
    GAME.Events.on('weapon:equip', ({ weapon }) => {
      const el = document.getElementById('hud-weapon');
      if (el && weapon) el.textContent = weapon.icon + ' ' + weapon.name;
    });

    // Victory.
    GAME.Events.on('game:win', () => GAME.UI.showWin());

    // NPC dialogue (placeholder; the story layer can override the text).
    GAME.Events.on('npc:talk', ({ name }) => {
      GAME.UI.showDialogue(name,
        `Hello, traveler. I'm ${name}. There's no tale to tell yet — ` +
        `but when the story arrives, I'll have much to say.`);
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

    // Live HUD: stamina + coordinates
    const maxSta = GAME.State.character?.maxStamina || GAME.Config.progression.maxStamina;
    document.getElementById('bar-sta').style.width =
      Math.min(100, GAME.State.stats.stamina / maxSta * 100) + '%';
    const pp = GAME.Player.getPosition();
    document.getElementById('hud-coords').textContent =
      `x ${pp.x.toFixed(0)}  z ${pp.z.toFixed(0)}`;

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  // Go.
  window.addEventListener('DOMContentLoaded', boot);
})();
