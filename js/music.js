/* Background music — random track playlist, continuous playback. */
window.GAME = window.GAME || {};

GAME.Music = (function () {
  const TRACKS = [
    'audio/80s-rb-hip-hop-music-SBA-346773577.mp3',
    'audio/audioblocks-beneath-the-surface_master_HD9Ny_NkGl.mp3',
    'audio/dreams-SBA-347686284.mp3',
    'audio/fatal-retreat-SBA-347309004.mp3',
    'audio/infinite-motion-SBA-354724740.mp3',
    'audio/inspiring-cinematic-motivational-epic-trailer-SBA-300504712.mp3',
    'audio/last-stand-SBA-300472393.mp3',
    'audio/odious-signs-SBA-300505202.mp3',
    'audio/sunny-SBA-346430973.mp3',
    'audio/walking-on-the-beach-SBA-346430994.mp3',
  ];

  let audio = null;
  let active = false;
  let lastIdx = -1;

  function pickNext() {
    if (TRACKS.length === 1) return 0;
    let idx;
    do { idx = Math.floor(Math.random() * TRACKS.length); } while (idx === lastIdx);
    lastIdx = idx;
    return idx;
  }

  function playNext() {
    if (!active) return;
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio = null; }
    audio = new Audio(TRACKS[pickNext()]);
    audio.volume = 0.35;
    audio.addEventListener('ended', playNext);
    audio.play().catch(() => {});
  }

  function start() {
    if (active) return;
    active = true;
    playNext();
  }

  GAME.Events.on('game:start', start);
  return { start };
})();
