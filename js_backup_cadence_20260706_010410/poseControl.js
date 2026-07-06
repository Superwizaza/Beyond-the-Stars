/* =========================================================
   poseControl.js — WEBCAM POSE CONTROL (additive; no engine edits)

   Drives the character entirely through SYNTHETIC DOM EVENTS so the
   game engine needs no changes:
     • Turning  → synthetic `mousemove` with movementX (the game's
                  pointer-lock look code turns yaw from movementX).
     • Walk     → hold  KeyW      (synthetic keydown/keyup)
     • Run      → hold  KeyW + ShiftLeft
     • Idle     → release all movement keys
     • Attack   → trained "Attack" class → synthetic left `mousedown`

   TURNING (real-time, NO training — raw PoseNet keypoint math):
     Only a RAISED hand (palm-out, wrist above the shoulder line) steers;
     a lowered/resting hand is ignored entirely. Of the raised hands, the
     one you are actively MOVING drives steering (latched, so a resting
     hand's jitter can't hijack it). Slide that hand LEFT → turn left,
     RIGHT → turn right. A One-Euro filter smooths the signal.

   WALK / RUN / IDLE / ATTACK (discrete, TRAINED):
     Loads a Teachable Machine "Pose" model from ./pose-model/ if present
     (model.json + metadata.json + weights.bin). Class-name matching is
     fuzzy so labels like "Walk"/"walking"/"move" all work. If no model
     is found, turning still works on its own so you can test today.

   LAUNCH: webcam needs a secure context — serve the folder and open
     http://localhost:8000  (NOT a double-clicked file://):
       cd Game_Project && python3 -m http.server 8000

   CONTROLS: press  V  to toggle webcam pose control on/off.
   ========================================================= */
window.GAME = window.GAME || {};

GAME.PoseControl = (function () {
  // ---- Tunables (safe to tweak live via GAME.PoseControl.cfg) ----
  const cfg = {
    // Turning
    turnSpan: 1.5,          // hand distance (in shoulder-widths) past the
                            // shoulder for FULL-speed turn
    maxTurnPixels: 22,      // synthetic movementX at full turn, per frame
                            // (higher = faster spin)
    turnDeadzone: 0.02,     // ignore turn amounts below this (near-zero =
                            // captures small slides)
    wristMinScore: 0.30,    // ignore low-confidence wrist reads
    attackVelY: 0.06,       // downward wrist speed (frac of frame h) = attack
    // Classification
    classThreshold: 0.75,   // min probability to accept a trained class
    // One-Euro filter
    oneEuroMinCutoff: 1.0,
    oneEuroBeta: 0.9,
    // Hand gating
    raiseMargin: 0.10,      // wrist must be this far ABOVE the shoulder line
                            // (frac of frame height) to count as raised/palm-out
    handMoveThresh: 0.006,  // min horizontal speed (frac frame w / s) to be the
                            // "actively moving" hand — filters a resting hand's jitter
    handSwitchRatio: 1.6,   // the other hand must move this many× faster to steal control
  };

  let running = false;
  let video, net = null, tmModel = null, tmLabels = [];
  let rafId = null, lastT = 0;
  let heldKeys = new Set();
  let statusEl = null;
  let prevWristY = null, prevWristYT = 0;
  // Per-hand horizontal-motion tracking + which hand currently drives steering.
  let handPrev = { left: null, right: null };   // {x, t} last sample per hand
  let handVel  = { left: 0, right: 0 };         // smoothed |horizontal speed|
  let activeHand = null;                        // 'left' | 'right' | null (latched)

  // ---------- One-Euro filter (per-signal smoothing) ----------
  function OneEuro(minCutoff, beta) {
    let xPrev = null, dxPrev = 0, tPrev = null;
    const alpha = (cutoff, dt) => {
      const tau = 1 / (2 * Math.PI * cutoff);
      return 1 / (1 + tau / dt);
    };
    return function (x, t) {
      if (xPrev === null) { xPrev = x; tPrev = t; return x; }
      const dt = Math.max(1e-3, t - tPrev);
      const dx = (x - xPrev) / dt;
      const aD = alpha(1.0, dt);
      dxPrev = aD * dx + (1 - aD) * dxPrev;
      const cutoff = minCutoff + beta * Math.abs(dxPrev);
      const a = alpha(cutoff, dt);
      const xHat = a * x + (1 - a) * xPrev;
      xPrev = xHat; tPrev = t;
      return xHat;
    };
  }
  const turnFilter = OneEuro(cfg.oneEuroMinCutoff, cfg.oneEuroBeta);

  // ---------- Synthetic input helpers ----------
  function pressKey(code) {
    if (heldKeys.has(code)) return;
    heldKeys.add(code);
    document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  }
  function releaseKey(code) {
    if (!heldKeys.has(code)) return;
    heldKeys.delete(code);
    document.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  }
  function releaseAllKeys() { [...heldKeys].forEach(releaseKey); }
  function applyTurn(pixels) {
    if (!pixels) return;
    // The game's look handler reads e.movementX while pointer-locked.
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: pixels, movementY: 0, bubbles: true }));
  }
  let lastAttack = 0;
  function doAttack() {
    const now = performance.now();
    if (now - lastAttack < 400) return;     // debounce
    lastAttack = now;
    document.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    setTimeout(() => document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })), 40);
  }

  // ---------- Keypoint access (PoseNet index map) ----------
  const KP = { nose:0, leftShoulder:5, rightShoulder:6, leftWrist:9, rightWrist:10, leftHip:11, rightHip:12 };
  function kp(pose, name) { return pose.keypoints[KP[name]]; }

  // ---------- Turning: hand-locked, shoulder-relative, smoothed ----------
  function computeTurn(pose, t) {
    const lS = kp(pose, 'leftShoulder'), rS = kp(pose, 'rightShoulder');
    const lW = kp(pose, 'leftWrist'),    rW = kp(pose, 'rightWrist');
    if (lS.score < 0.3 || rS.score < 0.3) return 0;
    const shoulderW = Math.abs(rS.position.x - lS.position.x) || 1;
    const span = shoulderW * cfg.turnSpan;
    const centerX = (lS.position.x + rS.position.x) / 2;   // body center
    const shoulderY = (lS.position.y + rS.position.y) / 2; // shoulder line
    const H = video.height || 480, W = video.width || 640;

    // Eligibility: a hand is RAISED (palm-out) if the wrist is above the
    // shoulder→hip MIDPOINT (i.e. up around chest/shoulder height). A hand
    // resting at your side sits near the hips → below the midpoint → ignored,
    // so its jitter never steers. Falls back to a shoulder-relative line if
    // hips aren't visible.
    const lH = kp(pose, 'leftHip'), rH = kp(pose, 'rightHip');
    let gateY;
    if (lH.score > 0.3 && rH.score > 0.3) {
      const hipY = (lH.position.y + rH.position.y) / 2;
      // Activation line lowered toward the WAIST (75% of the way from
      // shoulders to hips). A relaxed palm-out at chest/waist height clears
      // it — no need to raise the arm straight up. A hand hanging at your
      // side sits at/below the hips → below the line → still ignored.
      gateY = shoulderY + (hipY - shoulderY) * 0.75;  // waist line
    } else {
      // Fallback with no hips: allow well below the shoulders.
      gateY = shoulderY + 0.22 * H;
    }
    const raised = (wp) => wp.score > cfg.wristMinScore && wp.position.y < gateY;
    const rRaised = raised(rW), lRaised = raised(lW);

    // Update smoothed horizontal speed for each hand (used to find the hand
    // you're actually MOVING vs. the one held in place).
    const updVel = (name, wp, eligible) => {
      if (!eligible) { handPrev[name] = null; handVel[name] = 0; return; }
      const prev = handPrev[name];
      if (prev) {
        const dt = Math.max(1e-3, t - prev.t);
        const v = Math.abs(wp.position.x - prev.x) / W / dt;
        handVel[name] = 0.6 * handVel[name] + 0.4 * v;   // EMA
      }
      handPrev[name] = { x: wp.position.x, t };
    };
    updVel('right', rW, rRaised);
    updVel('left',  lW, lRaised);

    // Pick the actively-moving hand, with a latch so a resting hand can't
    // hijack steering: only switch if the other raised hand is moving clearly
    // faster (handSwitchRatio) AND above the movement threshold.
    const candidates = [];
    if (rRaised) candidates.push('right');
    if (lRaised) candidates.push('left');
    if (candidates.length === 0) { activeHand = null; return 0; }

    if (activeHand && !candidates.includes(activeHand)) activeHand = null;
    if (!activeHand) {
      if (candidates.length === 1) {
        activeHand = candidates[0];    // one hand raised → it steers immediately
      } else {
        // Both raised → the one you're moving more wins (fallback: either).
        let best = candidates[0];
        for (const h of candidates) if (handVel[h] > handVel[best]) best = h;
        activeHand = best;
      }
    } else {
      // Consider stealing control if the OTHER hand moves much faster.
      const other = activeHand === 'right' ? 'left' : 'right';
      if (candidates.includes(other) &&
          handVel[other] > cfg.handMoveThresh &&
          handVel[other] > handVel[activeHand] * cfg.handSwitchRatio) {
        activeHand = other;
      }
    }
    if (!activeHand) return 0;

    const wp = (activeHand === 'right') ? rW : lW;
    let net = clamp((wp.position.x - centerX) / span, -1, 1); // - = left, + = right
    net = turnFilter(net, t);                                 // One-Euro smoothing
    if (Math.abs(net) < cfg.turnDeadzone) return 0;
    return net * cfg.maxTurnPixels;                           // → synthetic movementX
  }

  // ---------- Attack detection from vertical wrist velocity ----------
  // Attack is handled by the trained Teachable Machine "Attack" class
  // (shoulder→arm→hand chop). The old raw vertical-wrist gesture was removed
  // because it misfired during turning postures.
  function detectAttackGesture() { return false; }

  // ---------- Trained class → movement ----------
  function fuzzy(label) {
    const s = (label || '').toLowerCase();
    if (/(idle|stand|still|neutral|none)/.test(s)) return 'idle';
    if (/(run|jog|sprint|fast)/.test(s))           return 'run';
    if (/(walk|move|forward)/.test(s))             return 'walk';
    if (/(attack|hit|punch|strike|chop|swing)/.test(s)) return 'attack';
    return 'other';
  }

  async function classify(pose, posenetOutput) {
    if (!tmModel) return null;
    const preds = await tmModel.predict(posenetOutput);
    let best = preds[0];
    for (const p of preds) if (p.probability > best.probability) best = p;
    if (best.probability < cfg.classThreshold) return null;
    return fuzzy(best.className);
  }

  function applyMovement(cls) {
    // Movement (walk/run/idle). Attack handled separately via gesture.
    if (cls === 'run')      { pressKey('KeyW'); pressKey('ShiftLeft'); }
    else if (cls === 'walk'){ pressKey('KeyW'); releaseKey('ShiftLeft'); }
    else                    { releaseKey('KeyW'); releaseKey('ShiftLeft'); } // idle/other/null
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---------- Main loop ----------
  async function loop() {
    if (!running) return;
    const t = performance.now() / 1000;
    try {
      // estimatePose works for both raw PoseNet and TM's wrapped model.
      let pose = null, posenetOutput = null;
      if (tmModel && tmModel.estimatePose) {
        const r = await tmModel.estimatePose(video);
        pose = r.pose; posenetOutput = r.posenetOutput;
      } else if (net) {
        pose = await net.estimateSinglePose(video, { flipHorizontal: true });
      }
      if (pose && pose.keypoints) {
        // Turning (always available, no training needed)
        applyTurn(computeTurn(pose, t));
        // Walk/run/idle/attack (only if a trained model is loaded). Attack is
        // now handled by the trained "Attack" class — NOT by a raw gesture —
        // so it no longer misfires while turning.
        if (tmModel && posenetOutput) {
          const cls = await classify(pose, posenetOutput);
          applyMovement(cls);
          if (cls === 'attack') doAttack();
          setStatus(`pose: ${cls || '—'}  ·  turning live`);
        } else {
          setStatus('turning live · (no trained model — walk/run needs pose-model/)');
        }
      }
    } catch (e) { /* keep looping; transient inference errors are fine */ }
    rafId = requestAnimationFrame(loop);
  }

  // ---------- Setup / teardown ----------
  async function start() {
    if (running) return;
    setStatus('starting camera…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      video = document.getElementById('pose-video') || makeVideo();
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      setStatus('❌ camera blocked — serve via http://localhost:8000 (not file://)');
      return;
    }
    // Load models. Prefer a trained TM model at ./pose-model/, else raw PoseNet.
    try {
      if (window.tmPose && await modelFilesExist('pose-model/model.json')) {
        tmModel = await window.tmPose.load('pose-model/model.json', 'pose-model/metadata.json');
        tmLabels = tmModel.getClassLabels ? tmModel.getClassLabels() : [];
      }
    } catch (e) { tmModel = null; }
    try {
      if (!tmModel && window.posenet) {
        net = await window.posenet.load({ architecture: 'MobileNetV1', outputStride: 16, inputResolution: { width: 320, height: 240 }, multiplier: 0.75 });
      }
    } catch (e) { net = null; }

    if (!tmModel && !net) { setStatus('❌ pose libs failed to load (need internet for CDN)'); return; }
    running = true;
    lastT = performance.now();
    loop();
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    releaseAllKeys();
    if (video && video.srcObject) { video.srcObject.getTracks().forEach((t) => t.stop()); }
    setStatus('pose control off');
  }

  function toggle() { running ? stop() : start(); }

  async function modelFilesExist(path) {
    try { const r = await fetch(path, { method: 'HEAD' }); return r.ok; } catch (e) { return false; }
  }

  function makeVideo() {
    const v = document.createElement('video');
    v.id = 'pose-video'; v.width = 160; v.height = 120; v.autoplay = true; v.muted = true; v.playsInline = true;
    Object.assign(v.style, { position: 'fixed', bottom: '10px', right: '10px', width: '160px', height: '120px',
      border: '2px solid #4ea1ff', borderRadius: '8px', zIndex: 60, transform: 'scaleX(-1)', opacity: '0.85' });
    document.body.appendChild(v);
    return v;
  }

  function setStatus(msg) {
    if (!statusEl) {
      statusEl = document.createElement('div');
      Object.assign(statusEl.style, { position: 'fixed', bottom: '136px', right: '10px', maxWidth: '220px',
        background: 'rgba(13,17,23,.85)', border: '1px solid #4ea1ff', color: '#e6edf3', padding: '6px 10px',
        borderRadius: '6px', fontSize: '11px', zIndex: 60, pointerEvents: 'none' });
      document.body.appendChild(statusEl);
    }
    statusEl.textContent = '🎥 ' + msg;
  }

  // Toggle with V.
  document.addEventListener('keydown', (e) => { if (e.code === 'KeyV') toggle(); });

  return { start, stop, toggle, cfg };
})();
