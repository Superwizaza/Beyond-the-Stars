/* =========================================================
   eventBus.js — the STORY SEAM.

   Everything in the game emits events through here. The story
   builder AI can subscribe to any of these in story.js WITHOUT
   modifying engine code. This is the single most important file
   for making the story "easily addable later".

   Usage:
     GAME.Events.on('player:move', (data) => { ... });
     GAME.Events.emit('player:move', { x, z });
   ========================================================= */
window.GAME = window.GAME || {};

GAME.Events = (function () {
  const listeners = {};

  function on(event, cb) {
    (listeners[event] = listeners[event] || []).push(cb);
    return () => off(event, cb); // returns an unsubscribe fn
  }

  function once(event, cb) {
    const unsub = on(event, (data) => { unsub(); cb(data); });
    return unsub;
  }

  function off(event, cb) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter((f) => f !== cb);
  }

  function emit(event, data) {
    (listeners[event] || []).forEach((cb) => {
      try { cb(data); }
      catch (e) { console.error(`[EventBus] listener for "${event}" threw:`, e); }
    });
    // Wildcard listeners receive (eventName, data) — handy for debugging/story logging
    (listeners['*'] || []).forEach((cb) => {
      try { cb(event, data); } catch (e) { console.error(e); }
    });
  }

  return { on, once, off, emit };
})();

/* -----------------------------------------------------------
   CANONICAL EVENT CATALOG (the contract for the story builder)
   -----------------------------------------------------------
   game:ready          {}                        world + player initialized
   game:start          { character }             player entered the world
   player:spawn        { position }
   player:move         { x, y, z }               throttled (~4/sec)
   player:jump         {}
   player:sprint       { active:bool }
   player:interact     { target|null, position } pressed E
   player:damage       { amount, hp }
   player:heal         { amount, hp }
   player:death        {}
   stat:xp             { xp, level }
   stat:levelup        { level }
   player:attack       { targetId, resource, destroyed }  swung the axe & hit something
   resource:pickup     { id, amount, total }   harvested a resource (wood/stone…)
   resource:select     { slot }                changed active hotbar slot
   craft:success       { recipeId, output, amount }
   craft:fail          { recipeId, locked, unlockLevel }
   build:place         { item, x, z }           placed a block
   build:remove        { item }                 deconstructed a block (refunded)
   forage:collect      { resource, label }       grabbed a loose ground pickup (E)
   item:eat            { id, name, restored, hunger }  ate food to restore hunger (F)
   item:eat            { …, raw, sick }           raw food may cause sickness (HP loss)
   enemy:hit           { damage }                 an enemy struck the player
   enemy:killed        { id }                     player killed an enemy (grants XP)
   game:saved          { at }                     game saved to localStorage (P/autosave)
   game:loaded         { at }                     save restored on launch
   survival:update     { hunger, hp, night, warm }  per-frame survival
   stage:progress      { stage }                  objective progress changed
   stage:advance       { from, to, stage }        advanced to a new RPG stage
   game:win            { stage }                   cleared the final stage
   weapon:unlock       { id, name }                a new weapon became available
   weapon:equip        { id, weapon }              player switched weapons
   npc:talk            { id, name }              interacted with an NPC
   craft:success       { recipeId, output, amount }  crafted an item
   craft:fail          { recipeId }             tried to craft without materials
   build:place         { item, x, z }           placed a block in the world
   resource:use        { slot, id }
   world:enterZone      { zoneId }               reserved for story zones
   ----------------------------------------------------------- */
