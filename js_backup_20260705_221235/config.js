/* =========================================================
   config.js — all tunable constants live here.
   A story builder can adjust difficulty/feel without touching logic.
   ========================================================= */
window.GAME = window.GAME || {};

GAME.Config = {
  // ---- World ----
  world: {
    size: 400,            // width/depth of the ground plane
    fogNear: 60,
    fogFar: 340,
    skyColor: 0x87b7e6,
    groundColor: 0x4a7a3f,
    treeCount: 90,
    rockCount: 45,
    buildingCount: 8,
  },

  // ---- Player movement ----
  player: {
    walkSpeed: 28,
    sprintSpeed: 48,
    jumpForce: 11,
    gravity: 30,
    eyeHeight: 3.2,       // scaled at runtime by character height
    mouseSensitivity: 0.0022,
    interactRange: 6,
  },

  // ---- Progression (stubs the story can drive) ----
  progression: {
    startLevel: 1,
    startXP: 0,
    xpPerLevel: 100,
    maxHP: 100,
    maxStamina: 100,
    staminaDrain: 22,     // per second while sprinting
    staminaRegen: 15,     // per second while not sprinting
    // Level rewards: each level-up raises the caps and heals to full.
    hpPerLevel: 10,
    staminaPerLevel: 5,
  },

  // ---- Survival ----
  survival: {
    maxHunger: 100,
    hungerDrain: 1.2,      // hunger lost per second
    starveDamage: 3,       // HP/sec lost when hunger hits 0
    warmthRadius: 9,       // distance from a campfire/torch that keeps you warm
    rawEatHPPenalty: 8,    // HP lost immediately when eating raw food
    rawEatChance: 0.5,     // chance eating raw food triggers the penalty
  },

  // ---- Enemies (spawn at night) ----
  enemies: {
    maxActive: 5,          // cap of simultaneous enemies on the field
    spawnInterval: 3,      // seconds between spawns while a combat objective is active
    spawnMinDist: 22,      // spawn at least this far from the player
    spawnMaxDist: 55,      // …and at most this far
    speed: 7,              // movement speed toward the player
    hp: 3,                 // axe hits to kill
    contactDamage: 9,      // HP/hit to the player on contact
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
    axe:   { name: 'Axe',   icon: '🪓', damage: 1, range: 4.5, cooldown: 0.35, shape: 'axe',   starter: true },
    sword: { name: 'Sword', icon: '🗡️', damage: 2, range: 5.5, cooldown: 0.30, shape: 'sword', unlockStage: 2 },
    spear: { name: 'Spear', icon: '🔱', damage: 2, range: 7.5, cooldown: 0.45, shape: 'spear', unlockStage: 3 },
    club:  { name: 'War Club', icon: '🏏', damage: 3, range: 4.0, cooldown: 0.55, shape: 'club', unlockStage: 4 },
  },

  // ---- RPG stages (levels) ----
  // Each stage has objectives that must ALL be met to advance. Objective
  // kinds: 'gather' (own N of a resource, counted cumulatively as collected)
  // and 'kill' (defeat N enemies this stage). `spawnEnemies` turns on the
  // combat spawner for that stage. The story layer can rewrite these.
  stages: [
    { id: 1, name: 'Foothold',   spawnEnemies: false,
      objectives: [ { kind: 'gather', resource: 'wood', count: 5 } ],
      reward: 'Sword unlocked', intro: 'Gather 5 Wood to establish your camp.' },
    { id: 2, name: 'First Blood', spawnEnemies: true,
      objectives: [ { kind: 'kill', count: 3 }, { kind: 'gather', resource: 'stone', count: 3 } ],
      reward: 'Spear unlocked', intro: 'Defeat 3 foes and gather 3 Stone.' },
    { id: 3, name: 'The Horde',   spawnEnemies: true,
      objectives: [ { kind: 'kill', count: 8 } ],
      reward: 'War Club unlocked', intro: 'Slay 8 foes to thin the horde.' },
    { id: 4, name: 'Siege',       spawnEnemies: true,
      objectives: [ { kind: 'kill', count: 12 }, { kind: 'gather', resource: 'wood', count: 10 } ],
      reward: 'Champion', intro: 'Survive the siege: 12 kills and 10 Wood.' },
    { id: 5, name: 'Last Stand',  spawnEnemies: true,
      objectives: [ { kind: 'kill', count: 20 } ],
      reward: 'Victory', intro: 'Defeat 20 foes to win the game.', final: true },
  ],

  // ---- Hotbar / resources (stub) ----
  hotbarSlots: 6,

  // ---- Resource catalog (Minecraft-style) ----
  // The story builder can add more types here; the UI + inventory
  // pick them up automatically.
  resources: {
    wood:  { name: 'Wood',  icon: '🪵', xp: 5 },
    stone: { name: 'Stone', icon: '🪨', xp: 6 },
    // Foraged food — carry restoreHunger so they can be eaten (press F).
    berries:  { name: 'Berries',  icon: '🍓', xp: 3, restoreHunger: 18 },
    mushroom: { name: 'Mushroom', icon: '🍄', xp: 3, restoreHunger: 20 },
  },

  // ---- Foraging: loose collectibles scattered on the ground (grab with E) ----
  // Each maps a pickup type to the resource it grants + how many to scatter.
  forage: {
    scatter: [
      { resource: 'berries',  count: 30, color: 0xcc2b52, shape: 'cluster' },
      { resource: 'mushroom', count: 22, color: 0xd98a5a, shape: 'mushroom' },
      { resource: 'wood',     count: 25, color: 0x6b4a2f, shape: 'stick', label: 'Stick' },
      { resource: 'stone',    count: 20, color: 0x8a8f98, shape: 'pebble', label: 'Pebble' },
    ],
    pickupRange: 3.5,     // how close you must be to grab with E
  },

  // ---- Tools ----
  axe: { damage: 1, range: 4.5, cooldown: 0.35 }, // range in world units; cooldown in seconds

  // ---- Craftable items ----
  // `placeable:true` items can be placed in the world (right-click) and
  // become solid blocks. `color` is used for the placed cube.
  craftables: {
    plank:     { name: 'Plank',      icon: '🟫', placeable: false, xp: 4 },
    stoneblock:{ name: 'Stone Block',icon: '⬜', placeable: true,  color: 0x9098a3, xp: 6 },
    woodwall:  { name: 'Wood Wall',  icon: '🧱', placeable: true,  color: 0x8a5a2f, xp: 8 },
    campfire:  { name: 'Campfire',   icon: '🔥', placeable: true,  color: 0xff7a2f, xp: 10 },
    torch:     { name: 'Torch',      icon: '🕯️', placeable: true,  color: 0xffd23f, xp: 5 },
  },

  // ---- Crafting recipes ----
  // Each recipe: inputs (resource/item id → count) → output (id × amount).
  // `unlockLevel` gates the recipe behind a player level (default 1).
  // Order here is the order shown in the crafting panel.
  recipes: [
    { id: 'plank',      output: 'plank',      amount: 2, inputs: { wood: 1 },            unlockLevel: 1 },
    { id: 'stoneblock', output: 'stoneblock', amount: 1, inputs: { stone: 2 },           unlockLevel: 1 },
    { id: 'torch',      output: 'torch',      amount: 2, inputs: { wood: 1, plank: 1 },  unlockLevel: 2 },
    { id: 'campfire',   output: 'campfire',   amount: 1, inputs: { wood: 3, stone: 1 },  unlockLevel: 2 },
    { id: 'woodwall',   output: 'woodwall',   amount: 1, inputs: { plank: 2, wood: 1 },  unlockLevel: 3 },
  ],

  // ---- Building / placement ----
  build: { range: 8, blockSize: 2 }, // how far you can place; size of placed cube
};
