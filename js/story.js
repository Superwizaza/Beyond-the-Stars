/* story.js — Beyond the Stars: Xylos escape quest */
window.GAME = window.GAME || {};

GAME.Story = (function () {
  const BIOME_NAMES = { forest: 'Forest', plains: 'Plains', desert: 'Desert',
    snow: 'Snowfield', highlands: 'Highlands', swamp: 'Swamp' };

  function init() {
    if (!GAME.State.flags.materialBiomes) assignMaterialBiomes();
    if (!GAME.State.flags.materialsSpawned && GAME.World.spawnStoryMaterials) {
      GAME.World.spawnStoryMaterials();
      GAME.State.flags.materialsSpawned = true;
    }

    GAME.Events.on('game:start', ({ character }) => {
      GAME.UI.showObjective('Beyond the Stars',
        `${character.name}, your suit has 30 minutes of oxygen on Xylos. ` +
        `Find Carnelian, Onyx, and Morganite scattered randomly across the planet. ` +
        `Trade them to the Alien Merchant, then board the rocket. Beware alien invaders at night.`);
      GAME.UI.toast('🪐 Welcome to Xylos');
    });

    GAME.Events.on('npc:talk', ({ id, name }) => {
      if (id !== 'alien_merchant') return;
      if (GAME.State.flags.partsReceived) {
        GAME.UI.showDialogue(name, 'You have the ship parts. Board the rocket behind me when you are ready to escape Xylos!');
        return;
      }
      const need = GAME.Config.story.tradeNeed || 1;
      const mats = GAME.Config.story.materials;
      const haveAll = mats.every((m) => GAME.State.getResourceCount(m) >= need);
      if (!haveAll) {
        const b = GAME.State.flags.materialBiomes;
        GAME.UI.showDialogue(name,
          `Greetings, traveler. Carnelian, Onyx, and Morganite are hidden somewhere on Xylos` +
          (b ? ` — rumors point to the ${BIOME_NAMES[b.carnelian]}, ${BIOME_NAMES[b.onyx]}, and ${BIOME_NAMES[b.morganite]}.` : '.') +
          ` Bring me one of each for ship parts.`);
        return;
      }
      mats.forEach((m) => GAME.State.removeItem(m, need));
      (GAME.Config.story.shipParts || []).forEach((p) => GAME.State.addResource(p, 1));
      GAME.State.flags.partsReceived = true;
      GAME.UI.hideDialogue();
      GAME.UI.toast('🚀 Ship parts received: Engine, Wing, Spare Metal');
      GAME.UI.showObjective('Escape Xylos', 'Board the rocket behind the merchant (press E).');
    });

    GAME.Events.on('player:interact', ({ target }) => {
      if (target?.id === 'escape_rocket' && GAME.State.hasShipParts()) {
        GAME.State.won = true;
        GAME.Events.emit('game:win', { rocket: true });
      } else if (target?.id === 'escape_rocket') {
        GAME.UI.toast('Need all ship parts from the merchant first.');
      }
    });
  }

  function assignMaterialBiomes() {
    const pool = ['forest', 'plains', 'desert', 'snow', 'highlands', 'swamp'];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    GAME.State.flags.materialBiomes = {
      carnelian: pool[0], onyx: pool[1], morganite: pool[2],
    };
  }

  return { init };
})();
