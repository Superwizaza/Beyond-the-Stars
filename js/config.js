/* =========================================================
   config.js — all tunable constants live here.
   A story builder can adjust difficulty/feel without touching logic.
   ========================================================= */
window.GAME = window.GAME || {};

GAME.Config = {
  // ---- World ----
  world: {
    size: 1200,           // width/depth of the ground plane (3x bigger "go big" map)
    fogNear: 120,         // scaled up so nearby terrain stays crisp
    fogFar: 900,          // scaled up so distant terrain fades naturally on the big map
    skyColor: 0x87b7e6,
    groundColor: 0x4a7a3f,
    treeCount: 420,       // density scaled to the bigger map
    rockCount: 220,       // density scaled to the bigger map
    buildingCount: 10,
  },

  // ---- Player movement ----
  player: {
    walkSpeed: 16,
    sprintSpeed: 30,
    jumpForce: 14.3,
    gravity: 14,
    eyeHeight: 3.2,       // scaled at runtime by character height
    mouseSensitivity: 0.0022,
    interactRange: 6,
    autoHitRadius: 5,     // auto-swing when a harvestable/enemy is this close
  },

  // ---- Progression (stubs the story can drive) ----
  progression: {
    startLevel: 1,
    startXP: 0,
    xpPerLevel: 100,
    maxHP: 100,
    hpPerLevel: 10,
  },

  // ---- Survival (oxygen on Xylos — 30 minute tank) ----
  survival: {
    maxHunger: 100,
    oxygenDurationSec: 1800,
    moveEpsilon: 0.02,
    warmthRadius: 9,
  },

  // ---- Day / Night cycle ----
  // A level runs across repeating day+night cycles and only ends when the
  // stage objectives are met (never on a timer). Zombies roam AT NIGHT.
  dayNight: {
    dayLength: 120,       // 2 minutes of daylight per cycle
    nightLength: 120,     // 2 minutes of night per cycle
    duskWarning: 60,      // warn the player 1 minute before night
  },

  // ---- Enemies (spawn at night) ----
  enemies: {
    maxActive: 5,          // (legacy fallback) cap of simultaneous enemies
    spawnInterval: 3,      // seconds between spawns while a combat objective is active
    spawnMinDist: 22,      // spawn at least this far from the player
    spawnMaxDist: 55,      // …and at most this far
    speed: 7,              // (legacy fallback) movement speed
    hp: 3,                 // (legacy fallback) axe hits to kill
    contactDamage: 9,      // (legacy fallback) HP/hit on contact
    // Per-stage scaling (zombies appear from stage 1 as an ambient side-threat,
    // and grow in number + power each stage — gently). Computed in world.js.
    baseMaxActive: 3,      // stage 1 cap; +1 per stage → 3..7
    baseHp: 2,             // stage 1 hits-to-kill; +1 every 2 stages → 2..4
    baseContactDamage: 6,  // stage 1 contact dmg; +1.2 per stage
    baseSpeed: 8.25,       // stage 1 speed (1.5×); +0.4 per stage
    baseSpawnInterval: 14, // stage 1: a zombie every ~14s at night (very sparse);
                           // shrinks ~2s per stage → busier nights later
    minSpawnInterval: 4,   // fastest spawn cadence (late stages)
    contactCooldown: 1.0,  // seconds between contact hits
    touchRange: 2.2,       // how close counts as "touching" the player
    xp: 15,                // XP for a kill
  },

  // ---- Save / load ----
  save: { key: 'untitledquest_save_v1', autosaveInterval: 15 }, // localStorage key; autosave seconds

  // ---- Weapons ----
  // The player can switch weapons (default key: number row via the weapon
  // wheel, or [ ] to cycle). Each has its own damage/range/cooldown + a
  // viewmodel `shape` the player builds procedurally. `starter` is equipped
  // at spawn; others are unlocked by reaching a stage (unlockStage).
  weapons: {
    // Two starters (owned from the start). The other 8 are CRAFTED in the C
    // menu (see recipes with `weapon:true`). Each has a distinct viewmodel
    // `shape` built procedurally in player.js buildWeapon().
    dagger:   { name: 'Knife',     icon: '🔪', damage: 1, range: 3.5, cooldown: 0.22, shape: 'dagger', starter: true, xp: 0 },
    axe:      { name: 'Axe',       icon: '🪓', damage: 2, range: 4.5, cooldown: 0.35, shape: 'axe',    starter: true, xp: 0 },
    spear:    { name: 'Spear',     icon: '🔱', damage: 2, range: 7.5, cooldown: 0.45, shape: 'spear',     xp: 8 },
    sword:    { name: 'Sword',     icon: '🗡️', damage: 3, range: 5.5, cooldown: 0.30, shape: 'sword',     xp: 10 },
    mace:     { name: 'Mace',      icon: '⚒️', damage: 3, range: 4.0, cooldown: 0.50, shape: 'mace',      xp: 10 },
    club:     { name: 'War Club',  icon: '🏏', damage: 4, range: 4.0, cooldown: 0.55, shape: 'club',      xp: 12 },
    battleaxe:{ name: 'Battle Axe',icon: '🪓', damage: 4, range: 5.0, cooldown: 0.50, shape: 'battleaxe', xp: 14 },
    katana:   { name: 'Katana',    icon: '⚔️', damage: 5, range: 6.0, cooldown: 0.28, shape: 'katana',    xp: 16 },
    warhammer:{ name: 'Warhammer', icon: '🔨', damage: 6, range: 4.5, cooldown: 0.70, shape: 'warhammer', xp: 18 },
    glaive:   { name: 'Glaive',    icon: '🗡️', damage: 5, range: 8.0, cooldown: 0.50, shape: 'glaive',    xp: 18 },
  },

  // ---- RPG stages (levels) ----
  // Each stage has objectives that must ALL be met to advance. Objective
  // kinds: 'gather' (own N of a resource, counted cumulatively as collected)
  // and 'kill' (defeat N enemies this stage). `spawnEnemies` turns on the
  // combat spawner for that stage. The story layer can rewrite these.
  stages: [],

  story: {
    materials: ['carnelian', 'onyx', 'morganite'],
    tradeNeed: 1,
    shipParts: ['engine', 'wing', 'spare_metal'],
  },

  // ---- Hotbar / resources (stub) ----
  hotbarSlots: 10,

  // ---- Resource catalog (Minecraft-style) ----
  // The story builder can add more types here; the UI + inventory
  // pick them up automatically.
  resources: {
    wood:  { name: 'Wood',  icon: '🪵', xp: 5 },
    stone: { name: 'Stone', icon: '🪨', xp: 6 },
    // Foraged food — carry restoreHunger so they can be eaten (press F).
    berries:  { name: 'Berries',  icon: '🍓', xp: 3, restoreHunger: 18 },
    mushroom: { name: 'Mushroom', icon: '🍄', xp: 3, restoreHunger: 20 },
    // Meat — dropped by slain enemies (their "remains"); grab with E, eat with F.
    meat: { name: 'Meat', icon: '🍖', xp: 4, restoreHunger: 35, pickupColor: 0xb5533b, pickupShape: 'cluster' },
    // Raw world materials — mined/foraged in specific biomes (see forage biome bias).
    coal: { name: 'Coal', icon: '🪨', xp: 6 },   // Rocky Highlands / Desert — smelts into charcoal
    sand: { name: 'Sand', icon: '⏳', xp: 4 },
    carnelian: { name: 'Carnelian', icon: '🔵', xp: 12, pickupColor: 0x3b82f6, pickupShape: 'cluster' },
    onyx:      { name: 'Onyx',      icon: '🔴', xp: 12, pickupColor: 0xef4444, pickupShape: 'pebble' },
    morganite: { name: 'Morganite', icon: '🟢', xp: 12, pickupColor: 0x22c55e, pickupShape: 'cluster' },
    engine:      { name: 'Engine',      icon: '🚀' },
    wing:        { name: 'Wing',        icon: '🛸' },
    spare_metal: { name: 'Spare Metal', icon: '🔩' },
  },

  // ---- Foraging: loose collectibles scattered on the ground (grab with E) ----
  // Each maps a pickup type to the resource it grants + how many to scatter.
  forage: {
    scatter: [
      { resource: 'berries',  count: 60, color: 0xcc2b52, shape: 'cluster' },
      { resource: 'mushroom', count: 48, color: 0xd98a5a, shape: 'mushroom' },
      { resource: 'wood',     count: 45, color: 0x6b4a2f, shape: 'stick', label: 'Stick' },
      { resource: 'stone',    count: 40, color: 0x8a8f98, shape: 'pebble', label: 'Pebble' },
      { resource: 'coal',     count: 60, color: 0x2b2b2b, shape: 'pebble', label: 'Coal' },
      { resource: 'sand',     count: 60, color: 0xdcc79a, shape: 'pebble', label: 'Sand' },
    ],
    pickupRange: 4.5,     // how close you must be to grab with E
  },

  // ---- Tools ----
  axe: { damage: 1, range: 4.5, cooldown: 0.35 }, // range in world units; cooldown in seconds

  // ---- Craftable items ----
  // `placeable:true` items can be placed in the world (right-click) and
  // become solid blocks. `color` is used for the placed cube.
  craftables: {
    plank:     { name: 'Plank',      icon: '🟫', placeable: true,  color: 0xc79a5b, xp: 4 },
    stoneblock:{ name: 'Stone Block',icon: '⬜', placeable: true,  color: 0x9098a3, xp: 6 },
    woodwall:  { name: 'Wood Wall',  icon: '🧱', placeable: true,  color: 0x8a5a2f, xp: 8 },
    torch:     { name: 'Torch',      icon: '🕯️', placeable: true,  color: 0xffd23f, xp: 5 },
    // ---- New crafted materials (not found as pickups — made from gathered resources) ----
    brick:     { name: 'Brick',      icon: '🧱', placeable: true,  color: 0xa8543a, xp: 7 },
    glass:     { name: 'Glass',      icon: '🪟', placeable: true,  color: 0xa9d6e5, xp: 7 },
    charcoal:  { name: 'Charcoal',   icon: '⚫', placeable: true,  color: 0x2b2b2b, xp: 6 },
    reinforcedwall: { name: 'Reinforced Wall', icon: '🛡️', placeable: true, color: 0x6b6f76, xp: 12 },
    lantern:   { name: 'Lantern',    icon: '🏮', placeable: true,  color: 0xffcf6b, xp: 11 },
  },

  // ---- Crafting recipes ----
  // Each recipe: inputs (resource/item id → count) → output (id × amount).
  // `unlockLevel` gates the recipe behind a player level (default 1).
  // Order here is the order shown in the crafting panel.
  recipes: [
    { id: 'plank',      output: 'plank',      amount: 2, inputs: { wood: 1 },            unlockLevel: 1 },
    { id: 'stoneblock', output: 'stoneblock', amount: 1, inputs: { stone: 2 },           unlockLevel: 1 },
    { id: 'torch',      output: 'torch',      amount: 2, inputs: { wood: 1, plank: 1 },  unlockLevel: 2 },
    { id: 'woodwall',   output: 'woodwall',   amount: 1, inputs: { plank: 2, wood: 1 },  unlockLevel: 3 },
    // ---- New crafted materials (from gathered resources; none of these are pickups) ----
    { id: 'brick',      output: 'brick',      amount: 2, inputs: { stone: 1 },            unlockLevel: 1 },
    { id: 'charcoal',   output: 'charcoal',   amount: 1, inputs: { wood: 1 },             unlockLevel: 1 },
    { id: 'charcoal_coal', output: 'charcoal', amount: 2, inputs: { coal: 1 },          unlockLevel: 1 },  // smelt coal into charcoal
    { id: 'glass',      output: 'glass',      amount: 1, inputs: { stone: 2 },            unlockLevel: 2 },
    { id: 'glass_sand',  output: 'glass',      amount: 2, inputs: { sand: 1 },             unlockLevel: 1 },  // melt sand into glass
    { id: 'lantern',    output: 'lantern',    amount: 1, inputs: { glass: 1, charcoal: 1 }, unlockLevel: 3 },
    { id: 'reinforcedwall', output: 'reinforcedwall', amount: 1, inputs: { plank: 2, brick: 1 }, unlockLevel: 3 },
    // ---- Weapon crafting (weapon:true → unlocks + equips the weapon; the two
    // starters, dagger & axe, are owned from the start and are not craftable) ----
    { id: 'craft_spear',     output: 'spear',     weapon: true, amount: 1, inputs: { wood: 3, stone: 1 },              unlockLevel: 1 },
    { id: 'craft_sword',     output: 'sword',     weapon: true, amount: 1, inputs: { plank: 1, stone: 2 },             unlockLevel: 1 },
    { id: 'craft_mace',      output: 'mace',      weapon: true, amount: 1, inputs: { wood: 2, brick: 1 },              unlockLevel: 2 },
    { id: 'craft_club',      output: 'club',      weapon: true, amount: 1, inputs: { wood: 4 },                        unlockLevel: 2 },
    { id: 'craft_battleaxe', output: 'battleaxe', weapon: true, amount: 1, inputs: { plank: 2, stone: 3 },            unlockLevel: 2 },
    { id: 'craft_katana',    output: 'katana',    weapon: true, amount: 1, inputs: { plank: 2, charcoal: 2 },         unlockLevel: 3 },
    { id: 'craft_warhammer', output: 'warhammer', weapon: true, amount: 1, inputs: { brick: 2, stone: 4 },            unlockLevel: 3 },
    { id: 'craft_glaive',    output: 'glaive',    weapon: true, amount: 1, inputs: { plank: 2, glass: 1, charcoal: 1 }, unlockLevel: 4 },
  ],

  // ---- Building / placement ----
  build: { range: 8, blockSize: 2 }, // how far you can place; size of placed cube
};
