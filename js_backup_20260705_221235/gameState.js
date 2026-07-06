/* =========================================================
   gameState.js — the single source of truth for runtime state.

   The story builder reads/writes here to gate content, track
   quest flags, grant items, etc. `flags` and `quests` are
   intentionally empty containers reserved for the story.
   ========================================================= */
window.GAME = window.GAME || {};

GAME.State = {
  character: null,        // set by customization.js on "Enter the World"

  stats: {
    level: GAME.Config.progression.startLevel,
    xp: GAME.Config.progression.startXP,
    hp: GAME.Config.progression.maxHP,
    stamina: GAME.Config.progression.maxStamina,
    hunger: GAME.Config.survival.maxHunger,
  },

  inventory: [],          // [{ id, name, icon, amount }]
  hotbar: new Array(GAME.Config.hotbarSlots).fill(null),
  activeSlot: 0,

  // ---- RPG stage progression ----
  stageIndex: 0,          // index into GAME.Config.stages
  stageKills: 0,          // enemies killed during the current stage
  gathered: {},           // cumulative resources gathered this stage {wood:3,...}
  won: false,             // set true after the final stage

  // ---- Weapons ----
  weapon: 'axe',          // currently equipped weapon id
  unlockedWeapons: ['axe'],

  // ---- Reserved for the STORY builder ----
  flags: {},              // arbitrary boolean/story flags, e.g. flags.metElder = true
  quests: {},             // { questId: { state:'active'|'done', step:0 } }
  zone: 'overworld',

  // ---- Helpers used by engine + story ----
  addXP(amount) {
    this.stats.xp += amount;
    const per = GAME.Config.progression.xpPerLevel;
    while (this.stats.xp >= per * this.stats.level) {
      this.stats.xp -= per * this.stats.level;
      this.stats.level++;
      this.applyLevelReward(this.stats.level);
      GAME.Events.emit('stat:levelup', {
        level: this.stats.level,
        unlocked: this.recipesUnlockedAt(this.stats.level),
      });
    }
    GAME.Events.emit('stat:xp', { xp: this.stats.xp, level: this.stats.level });
  },

  /* Raise HP/stamina caps on level-up and heal to full. Caps live on the
     character (the HUD reads character.maxHP/maxStamina). */
  applyLevelReward(level) {
    const p = GAME.Config.progression;
    const c = this.character;
    if (!c) return;
    c.maxHP = (c.maxHP || p.maxHP) + p.hpPerLevel;
    c.maxStamina = (c.maxStamina || p.maxStamina) + p.staminaPerLevel;
    this.stats.hp = c.maxHP;            // heal to full on level-up
    this.stats.stamina = c.maxStamina;
  },

  /* Which recipes have exactly this unlockLevel (newly available). */
  recipesUnlockedAt(level) {
    return (GAME.Config.recipes || [])
      .filter((r) => (r.unlockLevel || 1) === level)
      .map((r) => r.output);
  },

  damage(amount) {
    this.stats.hp = Math.max(0, this.stats.hp - amount);
    GAME.Events.emit('player:damage', { amount, hp: this.stats.hp });
    if (this.stats.hp === 0) GAME.Events.emit('player:death', {});
  },

  heal(amount) {
    const max = (this.character && this.character.maxHP) || GAME.Config.progression.maxHP;
    this.stats.hp = Math.min(max, this.stats.hp + amount);
    GAME.Events.emit('player:heal', { amount, hp: this.stats.hp });
  },

  /* Eat an edible item: consume one, restore hunger (capped). Returns true
     if something was eaten. Emits item:eat. */
  eat(itemId) {
    const def = this.itemDef(itemId);
    if (!def || !def.restoreHunger) return false;
    if (this.getResourceCount(itemId) < 1) return false;
    this.removeItem(itemId, 1);
    const sv = GAME.Config.survival;
    const before = this.stats.hunger;
    this.stats.hunger = Math.min(sv.maxHunger, this.stats.hunger + def.restoreHunger);

    // Eating RAW food is risky: a chance to take an HP penalty (food poisoning).
    let sick = false;
    if (def.raw && Math.random() < sv.rawEatChance) {
      sick = true;
      this.stats.hp = Math.max(0, this.stats.hp - sv.rawEatHPPenalty);
      GAME.Events.emit('player:damage', { amount: sv.rawEatHPPenalty, hp: this.stats.hp });
      if (this.stats.hp === 0) GAME.Events.emit('player:death', {});
    }
    GAME.Events.emit('item:eat', {
      id: itemId, name: def.name,
      restored: this.stats.hunger - before, hunger: this.stats.hunger,
      raw: !!def.raw, sick,
    });
    return true;
  },

  /* Per-frame survival update. Driven from the main loop with the player's
     position so we can check warmth against world light sources.
     Handles: hunger drain, starvation damage, campfire warmth (HP regen).
     Emits survival:update each tick. */
  survivalTick(dt, pos) {
    const sv = GAME.Config.survival;
    const s = this.stats;
    const warm = pos && GAME.World.isWarm(pos.x, pos.z);

    // Hunger: drains over time.
    s.hunger = Math.max(0, s.hunger - sv.hungerDrain * dt);

    // Damage sources.
    let dmg = 0;
    if (s.hunger <= 0) dmg += sv.starveDamage * dt;         // starving
    if (dmg > 0) {
      s.hp = Math.max(0, s.hp - dmg);
      if (s.hp === 0) GAME.Events.emit('player:death', {});
    }

    // Resting by a campfire slowly regenerates HP.
    if (warm && s.hp > 0) {
      const max = (this.character && this.character.maxHP) || GAME.Config.progression.maxHP;
      s.hp = Math.min(max, s.hp + 1.5 * dt);
    }

    GAME.Events.emit('survival:update', {
      hunger: s.hunger, hp: s.hp, warm,
    });
  },

  setFlag(key, value = true) { this.flags[key] = value; },
  getFlag(key) { return !!this.flags[key]; },

  /* Resolve an item definition from EITHER catalog (resources or
     craftables), so inventory/hotbar work uniformly for both. */
  itemDef(id) {
    return (GAME.Config.resources && GAME.Config.resources[id])
        || (GAME.Config.craftables && GAME.Config.craftables[id])
        || null;
  },

  /* Add a harvested resource to the inventory (stacking by id) and
     mirror it into the hotbar. Emits resource:pickup for the story. */
  addResource(resourceId, amount = 1) {
    const def = this.itemDef(resourceId);
    if (!def) return;

    // Stack in inventory.
    let entry = this.inventory.find((it) => it.id === resourceId);
    if (entry) {
      entry.amount += amount;
    } else {
      entry = { id: resourceId, name: def.name, icon: def.icon, amount };
      this.inventory.push(entry);
      // Place into the first empty hotbar slot.
      const slot = this.hotbar.findIndex((s) => s === null);
      if (slot !== -1) this.hotbar[slot] = resourceId;
    }

    if (def.xp) this.addXP(def.xp);
    GAME.Events.emit('resource:pickup', { id: resourceId, amount, total: entry.amount });
    // Count toward the current RPG stage's gather objectives.
    if (this.recordGather) this.recordGather(resourceId, amount);
  },

  getResourceCount(resourceId) {
    const entry = this.inventory.find((it) => it.id === resourceId);
    return entry ? entry.amount : 0;
  },

  /* Remove `amount` of an item; returns true if it had enough. */
  removeItem(id, amount = 1) {
    const entry = this.inventory.find((it) => it.id === id);
    if (!entry || entry.amount < amount) return false;
    entry.amount -= amount;
    if (entry.amount <= 0) {
      // Clear from inventory + any hotbar slot referencing it.
      this.inventory = this.inventory.filter((it) => it !== entry);
      const slot = this.hotbar.indexOf(id);
      if (slot !== -1) this.hotbar[slot] = null;
    }
    return true;
  },

  /* Look up a recipe by its id. */
  getRecipe(recipeId) {
    return (GAME.Config.recipes || []).find((r) => r.id === recipeId) || null;
  },

  /* Do we have every input for this recipe? */
  /* Is this recipe unlocked at the player's current level? */
  isRecipeUnlocked(recipeId) {
    const r = this.getRecipe(recipeId);
    if (!r) return false;
    return this.stats.level >= (r.unlockLevel || 1);
  },

  canCraft(recipeId) {
    const r = this.getRecipe(recipeId);
    if (!r) return false;
    if (!this.isRecipeUnlocked(recipeId)) return false;
    return Object.entries(r.inputs).every(([id, n]) => this.getResourceCount(id) >= n);
  },

  /* Attempt to craft. Consumes inputs, produces output, grants XP,
     and emits craft:success. Returns true on success. */
  craft(recipeId) {
    const r = this.getRecipe(recipeId);
    if (!r || !this.canCraft(recipeId)) {
      const locked = r && !this.isRecipeUnlocked(recipeId);
      GAME.Events.emit('craft:fail', { recipeId, locked, unlockLevel: r ? r.unlockLevel : null });
      return false;
    }
    // Consume inputs.
    for (const [id, n] of Object.entries(r.inputs)) this.removeItem(id, n);
    // Produce output (addResource handles either catalog + hotbar + XP).
    this.addResource(r.output, r.amount);
    GAME.Events.emit('craft:success', { recipeId, output: r.output, amount: r.amount });
    return true;
  },

  /* ---------- RPG stages ---------- */

  currentStage() {
    return GAME.Config.stages[this.stageIndex] || null;
  },

  /* Progress for one objective: { done, have, need, label }. */
  objectiveProgress(obj) {
    if (obj.kind === 'kill') {
      const have = this.stageKills;
      return { done: have >= obj.count, have, need: obj.count, label: `Defeat foes` };
    }
    // gather
    const have = this.gathered[obj.resource] || 0;
    const def = this.itemDef(obj.resource);
    return { done: have >= obj.count, have, need: obj.count,
             label: `Gather ${def ? def.name : obj.resource}` };
  },

  /* Is every objective in the current stage complete? */
  stageComplete() {
    const st = this.currentStage();
    if (!st) return false;
    return st.objectives.every((o) => this.objectiveProgress(o).done);
  },

  /* Record a resource gather toward stage objectives (called from addResource). */
  recordGather(resourceId, amount) {
    this.gathered[resourceId] = (this.gathered[resourceId] || 0) + amount;
    this.checkStageAdvance();
  },

  /* Record an enemy kill toward stage objectives. */
  recordKill() {
    this.stageKills += 1;
    GAME.Events.emit('stage:progress', { stage: this.currentStageId() });
    this.checkStageAdvance();
  },

  currentStageId() {
    const st = this.currentStage();
    return st ? st.id : null;
  },

  /* If all objectives are met, advance to the next stage (or win). */
  checkStageAdvance() {
    if (this.won) return;
    if (!this.stageComplete()) {
      GAME.Events.emit('stage:progress', { stage: this.currentStageId() });
      return;
    }
    const finished = this.currentStage();
    // Final stage → win.
    if (finished && finished.final) {
      this.won = true;
      GAME.Events.emit('game:win', { stage: finished.id });
      return;
    }
    // Advance.
    this.stageIndex += 1;
    this.stageKills = 0;
    this.gathered = {};
    const next = this.currentStage();
    // Unlock any weapon whose unlockStage matches the new stage id.
    this.unlockWeaponsForStage(next ? next.id : 0);
    GAME.Events.emit('stage:advance', {
      from: finished ? finished.id : null,
      to: next ? next.id : null,
      stage: next,
    });
  },

  /* Unlock weapons gated on reaching this stage id. */
  unlockWeaponsForStage(stageId) {
    Object.entries(GAME.Config.weapons).forEach(([id, w]) => {
      if (w.unlockStage && w.unlockStage <= stageId && !this.unlockedWeapons.includes(id)) {
        this.unlockedWeapons.push(id);
        GAME.Events.emit('weapon:unlock', { id, name: w.name });
      }
    });
  },

  /* ---------- Weapons ---------- */

  equipWeapon(id) {
    if (!GAME.Config.weapons[id]) return false;
    if (!this.unlockedWeapons.includes(id)) return false;
    this.weapon = id;
    GAME.Events.emit('weapon:equip', { id, weapon: GAME.Config.weapons[id] });
    return true;
  },

  activeWeapon() {
    return GAME.Config.weapons[this.weapon] || GAME.Config.weapons.axe;
  },

  /* Cycle to the next/prev unlocked weapon (dir = +1 or -1). */
  cycleWeapon(dir) {
    const list = this.unlockedWeapons;
    if (!list.length) return;
    let i = list.indexOf(this.weapon);
    i = (i + dir + list.length) % list.length;
    this.equipWeapon(list[i]);
  },

  /* ---------- Save / load (localStorage) ---------- */

  /* Serialize the run into a plain object. World state (placed blocks) is
     asked of GAME.World so this module stays the single save entry point. */
  serialize() {
    return {
      version: 1,
      savedAt: Date.now(),
      character: this.character,
      stats: this.stats,
      inventory: this.inventory,
      hotbar: this.hotbar,
      activeSlot: this.activeSlot,
      flags: this.flags,
      quests: this.quests,
      stageIndex: this.stageIndex,
      stageKills: this.stageKills,
      gathered: this.gathered,
      won: this.won,
      weapon: this.weapon,
      unlockedWeapons: this.unlockedWeapons,
      blocks: (GAME.World && GAME.World.serializeBlocks) ? GAME.World.serializeBlocks() : [],
    };
  },

  save() {
    try {
      localStorage.setItem(GAME.Config.save.key, JSON.stringify(this.serialize()));
      GAME.Events.emit('game:saved', { at: Date.now() });
      return true;
    } catch (e) {
      console.error('[save] failed', e);
      return false;
    }
  },

  hasSave() {
    try { return !!localStorage.getItem(GAME.Config.save.key); }
    catch (e) { return false; }
  },

  /* Load saved data into state. Returns the parsed save (so main can restore
     world blocks + time) or null. Does NOT rebuild the world itself. */
  load() {
    try {
      const raw = localStorage.getItem(GAME.Config.save.key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data.character) this.character = data.character;
      if (data.stats) this.stats = data.stats;
      if (data.inventory) this.inventory = data.inventory;
      if (data.hotbar) this.hotbar = data.hotbar;
      if (typeof data.activeSlot === 'number') this.activeSlot = data.activeSlot;
      if (data.flags) this.flags = data.flags;
      if (data.quests) this.quests = data.quests;
      if (typeof data.stageIndex === 'number') this.stageIndex = data.stageIndex;
      if (typeof data.stageKills === 'number') this.stageKills = data.stageKills;
      if (data.gathered) this.gathered = data.gathered;
      if (typeof data.won === 'boolean') this.won = data.won;
      if (data.weapon) this.weapon = data.weapon;
      if (data.unlockedWeapons) this.unlockedWeapons = data.unlockedWeapons;
      GAME.Events.emit('game:loaded', { at: data.savedAt });
      return data;
    } catch (e) {
      console.error('[load] failed', e);
      return null;
    }
  },

  clearSave() {
    try { localStorage.removeItem(GAME.Config.save.key); } catch (e) {}
  },
};
