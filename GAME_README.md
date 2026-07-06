# Beyond the stars — Game Overview

A first-person 3D survival sandbox built with **Three.js r128** (loaded from a CDN).
It runs in any modern browser — double-click `index.html` for keyboard play, or serve
it locally for **webcam pose control** (move your body to control the character).

---

## What the game is

- **First-person survival sandbox** on a large (1200-unit) procedurally generated map.
- **6 biomes** (Forest, Plains, Desert, Snowfield, Rocky Highlands, Swamp) with distinct
  ground colors, vegetation, and structures (towers, obelisks, cabins, ruins, arches).
- **Day/Night cycle** (2 min day, 2 min night). Zombies roam **at night** and scale up
  gently each stage; they drop 🍖 **meat** when slain. A dusk toast warns you night is coming.
- **Survival**: a hunger bar drains as you move (0 when still). Food restores hunger;
  eating **near a campfire** heals 5% HP per item. Starvation damages HP directly.
- **Shield + Health**: a rechargeable SHIELD absorbs combat damage before HP. HP hitting
  0 ends the game (Game Over screen).
- **Gathering / crafting / building**: chop trees for wood, mine rocks for stone, forage
  berries/mushrooms, gather coal & sand. Craft planks, bricks, glass, charcoal, walls,
  campfires, torches, lanterns — and **10 weapons** (2 starters + 8 craftable). Place any
  item as a block (1:1); press **Q** to deconstruct. Blocks are climbable — build & jump up.
- **Houses** are enterable (walk through the doorway) to shelter from zombies — but hunger
  still drains at the normal rate inside, so stock food before nightfall.
- **World map** (press **M**): a large biome map with place names, your position, and facing.

---

## Controls

| Input | Action |
|---|---|
| **WASD / Arrow keys** | Move |
| **Mouse** | Look |
| **Shift** | Sprint |
| **Space** | Jump |
| **Left-click** | Swing weapon |
| **Right-click** | Place selected block |
| **E** | Grab pickup / interact |
| **Q** | Break nearest placed block |
| **F** | Eat food |
| **C** | Crafting panel |
| **1–6** | Hotbar slot |
| **[ / ]** | Cycle weapons |
| **M** | World map |
| **P** | Save |
| **V** | Toggle webcam pose control (needs local server — see below) |

**Webcam pose control** (when enabled with **V**): march your knees to sprint, slide a
raised hand at chest level to turn, swing your arm in a full circle to strike. See
`POSE_CAMERA_NOTES.md` for how this works and its current tuning.

---

## File map

| File / folder | What it does |
|---|---|
| `index.html` | Entry point. Loads Three.js + all `js/` scripts, defines both screens (character creation + game), and contains the inline **world-map (M)** overlay + the **V** pose-control toggle. |
| `css/style.css` | All UI styling (HUD, menus, crafting panel, overlays). |
| `js/config.js` | **All tunable constants** — world size, player speed, survival rates, enemies, day/night, resources, craftables, recipes, weapons, RPG stages. Start here to change game balance. |
| `js/eventBus.js` | Pub/sub event bus. The engine emits events; other modules listen. Decouples systems. |
| `js/gameState.js` | Single source of truth for runtime state — stats (HP/shield/hunger), inventory, hotbar, crafting, weapons, stage progression, save/load. |
| `js/character.js` | Character data model + procedural mesh (body type, colors, height, archetype). |
| `js/customization.js` | Character-creation screen UI + live 3D preview. |
| `js/world.js` | **The map.** Terrain, biomes (`biomeAt`), trees/rocks/forage, structures, buildings (enterable houses), placed blocks, day/night lighting, enemies (spawn/move/collide/meat drop), pickups. |
| `js/player.js` | First-person controller — look, move, jump, gravity, collision, block-climbing, interact, weapon viewmodels, attack. Exposes `getPosition`, `getYaw`, `addYaw`. |
| `js/poseControl.js` | **Webcam body control** (optional). Uses PoseNet (TF.js) keypoints — no training. Detects sprint (knee march), turning (hand slide), and strike (arm circle), and feeds synthetic key/mouse events to the engine. Toggle with **V**. |
| `js/story.js` | Story layer — currently a **no-op** (the game is a pure sandbox). Reserved for future scripted quests. |
| `js/main.js` | Bootstrap + render loop + HUD binding. Wires modules together, owns the game loop, renders each frame, drives the HUD and day/night dialogue. |

### Launchers & packaging
| File / folder | What it does |
|---|---|
| `Play Game (Mac).command` | Double-click on Mac to auto-start a local server + open the browser (for webcam mode). Needs Python. |
| `Play Game (Windows).bat` | Same, for Windows. Needs Python. |
| `electron-main.js`, `package.json` | Electron desktop-app wrapper — build a true standalone `.app`/`.exe` (webcam, no server, no setup for end users). See `BUILD_APP.md`. |
| `desktop/` | Additional Electron build scaffolding/instructions. |
| `BUILD_APP.md` | One-time build steps for the standalone app. |
| `WINDOWS_SETUP_FOR_AI_BUILDER.md` | How to set up & distribute the app on Windows, free — written for another AI/developer. |
| `POSE_CAMERA_NOTES.md` | Full history of the webcam-control tuning: what was tried, what failed, what worked, and the current known issue. |
| `ARCHITECTURE.md` | Original engine architecture guide (event-bus + story seam). |
| `js_backup_*` / `html_backup_*` | Timestamped safety snapshots from each edit. **Not needed to run** — safe to delete before sharing. |

---

## How to run

- **Keyboard/mouse only:** double-click `index.html`. Works instantly, any OS. (No webcam —
  browsers block the camera on `file://`.)
- **Webcam pose control:** run a local server and open `http://localhost:8000`:
  - Mac: double-click `Play Game (Mac).command`
  - Windows: double-click `Play Game (Windows).bat`
  - Or manually: `python3 -m http.server 8000` in this folder, then open `http://localhost:8000`.
- **Standalone app (no setup for end users):** see `BUILD_APP.md` / `WINDOWS_SETUP_FOR_AI_BUILDER.md`.
