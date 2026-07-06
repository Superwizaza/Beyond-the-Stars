/* =========================================================
   story.js  ★★★  THE STORY LAYER — WRITE HERE  ★★★

   This file is intentionally (almost) empty. It is the ONE place
   a story-builder AI needs to touch to add the narrative. The
   engine (world, player, state, UI) never needs to change.

   ---------------------------------------------------------------
   HOW THE STORY PLUGS IN
   ---------------------------------------------------------------
   The whole game broadcasts events through GAME.Events. You add
   the story purely by SUBSCRIBING to those events and REACTING —
   showing objectives, granting XP/items, setting flags, spawning
   props, gating zones, etc. You never edit engine files.

   Tools already available to you (see ARCHITECTURE.md for detail):
     • GAME.Events.on / once / off / emit      — the event bus
     • GAME.State  (flags, quests, stats,       — read/write state
                    inventory, addXP, damage,
                    heal, setFlag, getFlag)
     • GAME.UI.showObjective(title, text)       — top-right banner
     • GAME.UI.hideObjective()
     • GAME.UI.toast(message)                   — transient message
     • GAME.World.interactables                 — props to attach to
     • GAME.World.scene / GAME.Player.getPosition()

   ---------------------------------------------------------------
   MINIMAL EXAMPLE (uncomment to see it work)
   ---------------------------------------------------------------
   GAME.Events.on('game:start', ({ character }) => {
     GAME.UI.showObjective('Prologue', `Welcome, ${character.name}. Reach the glowing beacon.`);
     GAME.State.quests.reachBeacon = { state: 'active', step: 0 };
   });

   GAME.Events.on('player:interact', ({ target }) => {
     if (target && target.id === 'beacon' && GAME.State.quests.reachBeacon?.state === 'active') {
       GAME.State.quests.reachBeacon.state = 'done';
       GAME.State.addXP(50);
       GAME.UI.showObjective('Chapter 1', 'The beacon hums. A door opens to the east...');
       GAME.UI.toast('+50 XP — Beacon reached');
     }
   });
   ---------------------------------------------------------------
   ========================================================= */
window.GAME = window.GAME || {};

GAME.Story = (function () {
  function init() {
    // ┌──────────────────────────────────────────────────────┐
    // │  STORY BUILDER: register your event listeners below.  │
    // │  Nothing here yet — the game runs as a sandbox.        │
    // └──────────────────────────────────────────────────────┘

    // Optional: prove the seam works without shipping a story.
    // A tiny placeholder objective, easily deleted/replaced.
    GAME.Events.on('game:start', ({ character }) => {
      GAME.UI.showObjective(
        'Sandbox',
        `Welcome, ${character.name}. No story yet — explore freely. ` +
        `(A story will be added here at the hackathon.)`
      );
    });

    // Example of the debug wildcard listener — logs every event.
    // Comment out if noisy.
    // GAME.Events.on('*', (name, data) => console.log('[event]', name, data));
  }

  return { init };
})();
