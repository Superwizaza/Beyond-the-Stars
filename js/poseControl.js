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
    // Elbow + torso rotation steering (both elbows above chest).
    turnWinSec: 0.32,
    turnNetGate: 0.08,
    turnGain: 14,
    turnVelSmooth: 0.72,
    turnGateEase: 0.68,
    turnOutSmooth: 0.58,
    maxTurnPixels: 570,
    turnDeadzone: 0.05,
    elbowMinScore: 0.35,
    shoulderMinScore: 0.35,
    hipMinScore: 0.30,
    torsoWeight: 0.55,      // shoulder-vs-hip twist
    elbowWeight: 0.45,      // elbow midpoint shift vs shoulders
    rotHorizDom: 0.35,
    attackVelY: 0.06,       // downward wrist speed (frac of frame h) = attack
    // Classification
    classThreshold: 0.75,   // min probability to accept a trained class
    // One-Euro filter
    oneEuroMinCutoff: 0.55,
    oneEuroBeta: 0.18,
    // Hand gating
    raiseMargin: 0.10,      // wrist must be this far ABOVE the shoulder line
                            // (frac of frame height) to count as raised/palm-out
    handMoveThresh: 0.006,  // min horizontal speed (frac frame w / s) to be the
                            // "actively moving" hand — filters a resting hand's jitter
    handSwitchRatio: 1.6,   // the other hand must move this many× faster to steal control
    // ===== CADENCE (model-free walk/run/idle) — REMOVABLE BLOCK =====
    cadenceEnabled: true,   // set false (or delete block) to disable model-free movement
    // Idle tolerates small (non-significant) arm/leg movement; only clear
    // rhythmic leg motion counts as walking.
    cadenceWalkThresh: 0.024, // LEG motion (body-relative) above this = walking
    cadenceRunThresh: 0.075,  // combined leg+arm (body-relative) = running (hard cap)
    // Run is characterized by ARM PUMPING (bent elbows swinging) on top of
    // faster legs — so run needs arm energy above this AND legs walking.
    cadenceArmPumpThresh: 0.030, // wrist/elbow motion (body-relative) = arms pumping (run)
    cadenceArmWeight: 0.6,    // how much arm motion adds to the combined signal
    cadenceSmoothing: 0.65,   // EMA weight on the motion-energy signals (0..1)
    cadenceDecay: 0.25,       // LOWER = snaps to idle faster when you stop moving
                              // (asymmetric: rise uses cadenceSmoothing, fall uses this)
    cadenceTorsoThresh: 0.012, // TORSO must also be moving this much (body-relative)
                               // for walk/run — legs swinging while torso is still
                               // (e.g. seated) won't trigger movement.
    // Rolling step-detection (pedometer-style): measure knee vertical bob over
    // a short window → amplitude (are you lifting?) + step frequency (how fast).
    cadenceWinSec: 0.5,
    cadenceWalkAmp: 0.11,
    cadenceRunFreq: 1.3,
    cadenceMinSteps: 0.55,   // must be rhythmic (Hz) — blocks standing jitter
    cadenceMaxSteps: 3.5,    // reject high-freq keypoint noise
    cadenceStepMinAmp: 0.02,
    cadenceReleaseAmp: 0.07,
    cadenceCoastSec: 0.3,
    // ===============================================================
    turnGateChestFrac: 0.45,  // turn activation line: 45% shoulders→hips = chest level
    // ===== SWING / HIT GESTURE (one-handed axe chop) =====
    swingEnabled: true,       // model-free attack: a FULL 360° arm rotation
                              // (like the arm sweep in a butterfly swim stroke)
    swingRevolution: 1.6,     // ~90° arc (easier than old ~170° windmill)
    swingWindow: 1.4,
    swingMinRadius: 0.22,
    swingCooldown: 0.45,
    chopVelY: 0.045,          // fast downward wrist sweep = axe chop (when not steering)
    // Real-life jump → in-game jump (both legs airborne + upward body motion).
    jumpVelThresh: 55,
    jumpLegAirFrac: 0.58,
    jumpKneeAirFrac: 0.38,
    jumpOffGroundFrac: 0.14, // both ankles this far above tracked floor line
    jumpMinScore: 0.28,
    jumpCooldown: 0.5,
  };

  let running = false;
  let video, net = null, tmModel = null, tmLabels = [];
  let rafId = null, lastT = 0;
  let heldKeys = new Set();
  let statusEl = null;
  let prevWristY = null, prevWristYT = 0;
  // Per-hand horizontal-motion tracking + which hand currently drives steering.
  // Steering state (velocity-based, net-displacement gated — verified in
  // simulation to reject held-hand jitter AND arm pumping while passing a
  // deliberate horizontal slide).
  let _turnBuf = { left: [], right: [] };
  let _turnVel = { left: 0, right: 0 };
  let _turnVelY = { left: 0, right: 0 };
  let _turnPrev = { left: null, right: null };
  let _steerActive = false;                     // true on frames where a hand is steering
  let _turnGate = 0;        // eased 0..1 steering gate (smooth on/off)
  let _turnOut = 0;         // smoothed output (px) — final anti-jerk EMA
  let _hipJumpPrev = null, _jumpCd = 0, _ankleFloorY = null;

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
  const KP = { nose:0, leftShoulder:5, rightShoulder:6, leftElbow:7, rightElbow:8, leftWrist:9, rightWrist:10, leftHip:11, rightHip:12, leftKnee:13, rightKnee:14, leftAnkle:15, rightAnkle:16 };
  function kp(pose, name) { return pose.keypoints[KP[name]]; }

  function isPalmOut(side, pose, shoulderW, chestY, midX) {
    const s = kp(pose, side === 'left' ? 'leftShoulder' : 'rightShoulder');
    const e = kp(pose, side === 'left' ? 'leftElbow' : 'rightElbow');
    const w = kp(pose, side === 'left' ? 'leftWrist' : 'rightWrist');
    if (!s || !e || !w || s.score < 0.35 || e.score < 0.35 || w.score < 0.35) return false;
    if (w.position.y > chestY) return false;
    const scale = shoulderW || 80;
    if (Math.hypot(w.position.x - s.position.x, w.position.y - s.position.y) < scale * 0.52) return false;
    if (w.position.y > e.position.y + scale * 0.10) return false;
    const foreDx = Math.abs(w.position.x - e.position.x);
    const foreDy = Math.abs(w.position.y - e.position.y);
    if (foreDy > Math.max(foreDx, 1e-3) * 0.72) return false;
    if (Math.abs(w.position.x - midX) < Math.abs(e.position.x - midX) + scale * 0.06) return false;
    return true;
  }

  // ---------- Turning: palm-out slide left/right at chest level ----------
  function computeTurn(pose, t) {
    const lS = kp(pose, 'leftShoulder'), rS = kp(pose, 'rightShoulder');
    const lW = kp(pose, 'leftWrist'),    rW = kp(pose, 'rightWrist');
    const lH = kp(pose, 'leftHip'), rH = kp(pose, 'rightHip');
    if (!lS || !rS || lS.score < 0.3 || rS.score < 0.3) return 0;
    const shoulderY = (lS.position.y + rS.position.y) / 2;
    const shoulderW = Math.abs(rS.position.x - lS.position.x) || 1;
    const midX = (lS.position.x + rS.position.x) / 2;
    const hipY = (lH && rH && lH.score > 0.3 && rH.score > 0.3)
      ? (lH.position.y + rH.position.y) / 2 : shoulderY + (video.height || 480) * 0.22;
    const chestY = shoulderY + (hipY - shoulderY) * cfg.turnGateChestFrac;

    const upd = (nm, side, wp, el) => {
      if (!el) { _turnBuf[nm] = []; _turnPrev[nm] = null; _turnVel[nm] = 0; _turnVelY[nm] = 0; return; }
      const x = wp.position.x / shoulderW, y = wp.position.y / shoulderW;
      _turnBuf[nm].push({ t, x, y });
      while (_turnBuf[nm].length && t - _turnBuf[nm][0].t > cfg.turnWinSec) _turnBuf[nm].shift();
      const pv = _turnPrev[nm];
      if (pv) {
        const dt = Math.max(1e-3, t - pv.t);
        const s = cfg.turnVelSmooth;
        _turnVel[nm]  = s * _turnVel[nm]  + (1 - s) * ((x - pv.x) / dt);
        _turnVelY[nm] = s * _turnVelY[nm] + (1 - s) * (Math.abs(y - pv.y) / dt);
      }
      _turnPrev[nm] = { x, y, t };
    };
    upd('right', 'right', rW, rW && isPalmOut('right', pose, shoulderW, chestY, midX));
    upd('left',  'left',  lW, lW && isPalmOut('left', pose, shoulderW, chestY, midX));

    const eligible = [];
    for (const nm of ['right', 'left']) {
      const b = _turnBuf[nm];
      if (b.length < 3) continue;
      const net = b[b.length - 1].x - b[0].x;
      let ylo = Infinity, yhi = -Infinity;
      for (const s of b) { if (s.y < ylo) ylo = s.y; if (s.y > yhi) yhi = s.y; }
      const ymov = yhi - ylo;
      if (Math.abs(net) > cfg.turnNetGate && Math.abs(net) >= ymov * cfg.rotHorizDom && _turnVel[nm] * net > 0) {
        eligible.push(nm);
      }
    }
    const target = eligible.length ? 1 : 0;
    _turnGate = cfg.turnGateEase * _turnGate + (1 - cfg.turnGateEase) * target;
    _steerActive = eligible.length > 0;

    let raw = 0;
    if (eligible.length) {
      let best = eligible[0];
      for (const nm of eligible) if (Math.abs(_turnVel[nm]) > Math.abs(_turnVel[best])) best = nm;
      raw = clamp(_turnVel[best] * cfg.turnGain, -1, 1);
    }
    const steer = turnFilter(raw, t) * _turnGate;
    _turnOut = cfg.turnOutSmooth * _turnOut + (1 - cfg.turnOutSmooth) * steer;
    if (Math.abs(_turnOut) < cfg.turnDeadzone) return 0;
    return _turnOut * cfg.maxTurnPixels;
  }
  // Both legs airborne: tucked jump (ankles/knees raised) OR both feet above floor baseline.
  function bothLegsInAir(pose) {
    const lH = kp(pose, 'leftHip'), rH = kp(pose, 'rightHip');
    const lK = kp(pose, 'leftKnee'), rK = kp(pose, 'rightKnee');
    const lA = kp(pose, 'leftAnkle'), rA = kp(pose, 'rightAnkle');
    const lS = kp(pose, 'leftShoulder'), rS = kp(pose, 'rightShoulder');
    if (!lH || !rH || !lK || !rK || !lA || !rA) return false;
    const pts = [lH, rH, lK, rK, lA, rA];
    if (pts.some((p) => p.score < cfg.jumpMinScore)) return false;

    const hipY = (lH.position.y + rH.position.y) / 2;
    let scale = 90;
    if (lS && rS && lS.score > 0.2 && rS.score > 0.2) {
      scale = Math.hypot(rS.position.x - lS.position.x, rS.position.y - lS.position.y) || scale;
    }

    const ankleLiftL = hipY - lA.position.y;
    const ankleLiftR = hipY - rA.position.y;
    const kneeLiftL = hipY - lK.position.y;
    const kneeLiftR = hipY - rK.position.y;
    const tuckedJump = ankleLiftL > -scale * cfg.jumpLegAirFrac
      && ankleLiftR > -scale * cfg.jumpLegAirFrac
      && kneeLiftL > -scale * cfg.jumpKneeAirFrac
      && kneeLiftR > -scale * cfg.jumpKneeAirFrac;

    const floorSample = Math.max(lA.position.y, rA.position.y);
    if (_ankleFloorY == null) _ankleFloorY = floorSample;
    const offGround = lA.position.y < _ankleFloorY - scale * cfg.jumpOffGroundFrac
      && rA.position.y < _ankleFloorY - scale * cfg.jumpOffGroundFrac;

    if (!tuckedJump && !offGround) {
      _ankleFloorY = 0.92 * _ankleFloorY + 0.08 * floorSample;
      return false;
    }
    return true;
  }

  function detectJump(pose, t) {
    if (t < _jumpCd) return;
    const lH = kp(pose, 'leftHip'), rH = kp(pose, 'rightHip');
    if (!lH || !rH || lH.score < cfg.jumpMinScore || rH.score < cfg.jumpMinScore) return;
    if (!bothLegsInAir(pose)) return;

    const hipY = (lH.position.y + rH.position.y) / 2;
    const prev = _hipJumpPrev;
    _hipJumpPrev = { y: hipY, t };
    if (!prev) return;
    const dt = Math.max(0.016, t - prev.t);
    const vy = (hipY - prev.y) / dt;
    if (vy < -cfg.jumpVelThresh) {
      pressKey('Space');
      setTimeout(() => releaseKey('Space'), 90);
      _jumpCd = t + cfg.jumpCooldown;
    }
  }

  // Downward wrist chop — only when not steering (avoids turn misfires).
  function detectChop(pose, t) {
    if (_steerActive || _turnGate > 0.2) return;
    if (t - _lastSwing < cfg.swingCooldown) return;
    const lS = kp(pose, 'leftShoulder'), rS = kp(pose, 'rightShoulder');
    let scale = (lS && rS && lS.score > 0.2 && rS.score > 0.2)
      ? Math.hypot(rS.position.x - lS.position.x, rS.position.y - lS.position.y) : 0;
    if (!scale || scale < 1) scale = (video.height || 480) * 0.25;
    for (const nm of ['leftWrist', 'rightWrist']) {
      const k = kp(pose, nm);
      if (!k || k.score < cfg.wristMinScore) { _chopPrev[nm] = null; continue; }
      const y = k.position.y / scale;
      const prev = _chopPrev[nm];
      _chopPrev[nm] = { y, t };
      if (!prev) continue;
      const dt = Math.max(1e-3, t - prev.t);
      const vy = (y - prev.y) / dt; // screen-y down = positive
      if (vy > cfg.chopVelY) {
        _lastSwing = t;
        doAttack();
        return;
      }
    }
  }

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

  // ============================================================
  // CADENCE MOVEMENT (model-free walk/run/idle) — REMOVABLE BLOCK
  // Reads lower-body motion energy from PoseNet keypoints (no training).
  // Standing still = idle; marching in place = walk; running = run.
  // To remove: delete this block, the cfg.cadence* keys, and the single
  // call in loop() marked "CADENCE call".
  // ------------------------------------------------------------
  let _cadPrev = {};        // last {x,y} per lower-body joint
  let _cadEnergy = 0;       // smoothed LEG motion-energy signal
  let _cadArm = 0;          // smoothed ARM-pump motion-energy signal
  let _cadTorso = 0;        // smoothed TORSO motion-energy signal
  let _legBuf = [];
  let _strideBuf = [];      // |leftKnee - rightKnee| — alternating stride signal
  let _refEMA = 0;          // SMOOTHED body scale
  let _hipEMA = 0;          // SMOOTHED hip-anchor Y — arm pumping wobbles the raw hip keypoint; a stable anchor stops that leaking into knee-relative measurement at full-body distance
  let _kneeEMA = null;      // SMOOTHED knee-relative signal — crushes per-frame noise (which is amplified at far distance) while a real march oscillation survives
  let _sprintLatch = false;
  let _walkLatch = false;
  let _lastStrong = 0;
  let _chopPrev = {};       // per-wrist {y,t} for downward chop detection
  let _swingAngle = null;   // last shoulder→wrist angle (rad) for rotation tracking
  let _swingAccum = 0;      // accumulated continuous angular travel (rad)
  let _swingDir = 0;        // current rotation direction (+1/-1)
  let _swingStart = 0;      // time the current accumulation started
  let _lastSwing = 0;       // time of last swing (cooldown)
  // ============================================================
  // SWING / HIT GESTURE (model-free one-handed axe chop) — REMOVABLE.
  // Detects a fast, mostly-VERTICAL wrist motion (overhead/diagonal chop)
  // from whichever hand is moving. Vertical-dominant so a horizontal
  // turn-slide never counts as a swing. Fires a synthetic left-click.
  // To remove: delete this function, the cfg.swing* keys, the _swing*
  // state vars, and the computeSwing() call in loop().
  // ------------------------------------------------------------
  function computeSwing(pose, t) {
    if (!cfg.swingEnabled) return;
    // Fire ONLY on a full ~360° arm rotation (butterfly-stroke arc). We track
    // the angle of the shoulder→wrist vector and accumulate continuous travel
    // in ONE direction; a strike fires when it completes a full revolution
    // within swingWindow. Straight chops, side-slides, and partial arcs can
    // never accumulate a full circle, so ordinary arm motion won't trigger.
    // Elbow bend is irrelevant — we measure shoulder→wrist, not a straight arm.
    const lS = kp(pose, 'leftShoulder'), rS = kp(pose, 'rightShoulder');
    let scale = (lS && rS && lS.score > 0.2 && rS.score > 0.2)
      ? Math.hypot(rS.position.x - lS.position.x, rS.position.y - lS.position.y) : 0;
    if (!scale || scale < 1) scale = (video.height || 480) * 0.25;

    // Use whichever wrist is more confident, measured around its OWN shoulder.
    const lW = kp(pose, 'leftWrist'), rW = kp(pose, 'rightWrist');
    let w, sh;
    if (rW && (!lW || rW.score >= lW.score)) { w = rW; sh = rS; }
    else { w = lW; sh = lS; }
    if (!w || w.score < cfg.wristMinScore || !sh || sh.score < 0.2) {
      _swingAngle = null; _swingAccum = 0; _swingDir = 0; return;
    }

    const vx = (w.position.x - sh.position.x) / scale;
    const vy = (w.position.y - sh.position.y) / scale;
    const radius = Math.hypot(vx, vy);
    if (radius < cfg.swingMinRadius) {           // too close to shoulder → ignore
      _swingAngle = null; _swingAccum = 0; _swingDir = 0; return;
    }
    const ang = Math.atan2(vy, vx);

    if (_swingAngle !== null) {
      // Smallest signed angular step between frames (-π..π).
      let d = ang - _swingAngle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const dir = d >= 0 ? 1 : -1;
      // Reset accumulation if direction reversed or the window expired.
      if (dir !== _swingDir || (t - _swingStart) > cfg.swingWindow) {
        _swingDir = dir; _swingAccum = 0; _swingStart = t;
      }
      _swingAccum += Math.abs(d);
      if (_swingAccum >= cfg.swingRevolution && (t - _lastSwing) >= cfg.swingCooldown) {
        _lastSwing = t;
        _swingAccum = 0; _swingStart = t;
        doAttack();
      }
    }
    _swingAngle = ang;
  }
  // ============================================================

  function computeCadence(pose, t) {
    // BODY-SCALE normalization: normalize joint movement by the player's own
    // body size (torso), NOT the frame. Otherwise, standing back so the whole
    // body is visible makes joints move fewer pixels → everything reads idle.
    // With body-scale, the SAME physical motion gives the same energy whether
    // you're zoomed on your torso or standing far with full body in view.
    const lS = kp(pose, 'leftShoulder'), rS = kp(pose, 'rightShoulder');
    const lH = kp(pose, 'leftHip'), rH = kp(pose, 'rightHip');
    let scale = 0;
    if (lS && rS && lS.score > 0.2 && rS.score > 0.2) {
      scale = Math.hypot(rS.position.x - lS.position.x, rS.position.y - lS.position.y); // shoulder width
    }
    if (lH && rH && lH.score > 0.2 && rH.score > 0.2 && lS && rS && lS.score > 0.2) {
      const shY = (lS.position.y + rS.position.y) / 2, hpY = (lH.position.y + rH.position.y) / 2;
      scale = Math.max(scale, Math.abs(hpY - shY)); // torso height (more stable when arms move)
    }
    if (!scale || scale < 1) scale = (video.height || 480) * 0.25; // fallback
    // Heavily smooth REF so per-frame shoulder/hip keypoint jitter (which spikes
    // when the arms pump) can't swing the knee measurement and fake a step.
    _refEMA = (_refEMA === 0) ? scale : (0.9 * _refEMA + 0.1 * scale);
    const REF = _refEMA; // stable body-scale normalizer

    // Measure average body-relative displacement for a set of joints.
    const energyOf = (names, minScore) => {
      let sum = 0, seen = 0;
      for (const nm of names) {
        const k = kp(pose, nm);
        if (!k || k.score < minScore) { _cadPrev[nm] = null; continue; }
        const prev = _cadPrev[nm];
        if (prev) {
          const dx = (k.position.x - prev.x) / REF, dy = (k.position.y - prev.y) / REF;
          sum += Math.hypot(dx, dy); seen++;
        }
        _cadPrev[nm] = { x: k.position.x, y: k.position.y };
      }
      return seen ? sum / seen : 0;
    };

    // LEGS decide walk — measure VERTICAL THIGH-LIFT only. We track each knee's
    // height RELATIVE TO THE HIP line, so only up/down lifting (marching) counts
    // — sideways sway or stepping toward the camera does NOT trigger movement.
    // Works with knees alone (full legs are often out of frame).
    const hipY = (lH && rH && lH.score > 0.2 && rH.score > 0.2)
      ? (lH.position.y + rH.position.y) / 2 : null;
    const liftEnergyOf = (names, minScore) => {
      let sum = 0, seen = 0;
      for (const nm of names) {
        const k = kp(pose, nm);
        if (!k || k.score < minScore) { _cadPrev['lift_' + nm] = null; continue; }
        // Knee height above the hip line (body-relative). If no hips, use raw y.
        const rel = (hipY !== null ? (k.position.y - hipY) : k.position.y) / REF;
        const prev = _cadPrev['lift_' + nm];
        if (prev !== null && prev !== undefined) {
          sum += Math.abs(rel - prev); seen++;   // VERTICAL change only
        }
        _cadPrev['lift_' + nm] = rel;
      }
      return seen ? sum / seen : 0;
    };
    // ---- ROLLING STEP DETECTION (pedometer-style) ----
    // Track the AVERAGE KNEE vertical position (relative to hips, body-scaled)
    // in a rolling time window. Marching in place makes this oscillate; we
    // measure the oscillation AMPLITUDE (peak-to-peak) and STEP FREQUENCY
    // (reversals/sec). This responds to rhythmic lifting, not raw motion size —
    // far more robust than magnitude, and naturally ignores sway/drift.
    // Knee bob measured RELATIVE TO THE HIP line, over a SMOOTHED REF. When the
    // body jitters (arm pumping wobbles shoulder/hip keypoints), the knee and
    // hip shift together, so (knee - hip) stays stable — only a genuine knee
    // LIFT changes it. This is what stops arm movement from faking sprint.
    // Verified in simulation: arms-pumping/knees-still → idle; marching → run.
    // FULL-BODY-DISTANCE FIX: stabilize the hip anchor. Arm pumping wobbles the
    // raw hip keypoint; since knee is measured relative to the hip, at far
    // distance (small REF) that wobble was amplified into a fake step. A heavily
    // smoothed hip anchor removes it while a real knee lift still registers.
    const hipYraw = (lH && rH && lH.score > 0.2 && rH.score > 0.2)
      ? (lH.position.y + rH.position.y) / 2 : null;
    if (hipYraw !== null) _hipEMA = (_hipEMA === 0) ? hipYraw : (0.9 * _hipEMA + 0.1 * hipYraw);
    const hipAnchor = (hipYraw !== null) ? _hipEMA : null;
    let kneeSum = 0, kneeN = 0;
    for (const nm of ['leftKnee','rightKnee']) {
      const k = kp(pose, nm);
      if (k && k.score >= 0.15) { kneeSum += (hipAnchor !== null ? (k.position.y - hipAnchor) : k.position.y) / REF; kneeN++; }
    }
    if (kneeN === 0) {
      for (const nm of ['leftAnkle','rightAnkle']) {
        const k = kp(pose, nm);
        if (k && k.score >= 0.15) { kneeSum += (hipAnchor !== null ? (k.position.y - hipAnchor) : k.position.y) / REF; kneeN++; }
      }
    }
    let kneeVal = kneeN ? kneeSum / kneeN : null;
    // Smooth the knee signal so far-distance pixel noise (amplified by small REF)
    // averages out, but a real ~1.5Hz march oscillation passes.
    if (kneeVal !== null) { _kneeEMA = (_kneeEMA === null) ? kneeVal : (0.72 * _kneeEMA + 0.28 * kneeVal); kneeVal = _kneeEMA; }

    // Alternating stride: one knee up / other down (march or forward walk).
    let strideVal = null;
    const lKn = kp(pose, 'leftKnee'), rKn = kp(pose, 'rightKnee');
    if (lKn && rKn && lKn.score >= 0.15 && rKn.score >= 0.15 && hipAnchor !== null) {
      strideVal = Math.abs((lKn.position.y - hipAnchor) - (rKn.position.y - hipAnchor)) / REF;
    }

    if (kneeVal !== null) _legBuf.push({ t, v: kneeVal });
    if (strideVal !== null) _strideBuf.push({ t, v: strideVal });
    const win = cfg.cadenceWinSec || 0.5;
    while (_legBuf.length && t - _legBuf[0].t > win) _legBuf.shift();
    while (_strideBuf.length && t - _strideBuf[0].t > win) _strideBuf.shift();

    const peakToPeak = (buf) => {
      if (buf.length < 4) return 0;
      let lo = Infinity, hi = -Infinity;
      for (const s of buf) { if (s.v < lo) lo = s.v; if (s.v > hi) hi = s.v; }
      return hi - lo;
    };
    const amp = peakToPeak(_legBuf);
    const strideAmp = peakToPeak(_strideBuf);
    const effAmp = Math.max(amp, strideAmp);

    let steps = 0;
    if (_legBuf.length >= 4) {
      let lo = Infinity, hi = -Infinity;
      for (const s of _legBuf) { if (s.v < lo) lo = s.v; if (s.v > hi) hi = s.v; }
      const mid = (hi + lo) / 2, minA = cfg.cadenceStepMinAmp || 0.02;
      let lastSign = 0, crossings = 0;
      for (const s of _legBuf) {
        const d = s.v - mid;
        if (Math.abs(d) < minA * 0.5) continue;
        const sign = d > 0 ? 1 : -1;
        if (lastSign !== 0 && sign !== lastSign) crossings++;
        lastSign = sign;
      }
      const span = Math.max(0.001, _legBuf[_legBuf.length - 1].t - _legBuf[0].t);
      steps = (crossings / 2) / span;
    }

    // Farther from camera → raise threshold (more pixel noise when body is small).
    const walkTh = cfg.cadenceWalkAmp * Math.max(1, 85 / Math.max(REF, 52));
    const runTh = walkTh * 1.35;
    const minSteps = cfg.cadenceMinSteps || 0.55;
    const maxSteps = cfg.cadenceMaxSteps || 3.5;
    const stepsOk = steps >= minSteps && steps <= maxSteps;

    if (stepsOk && effAmp >= runTh && steps >= (cfg.cadenceRunFreq || 1.3)) {
      _sprintLatch = true; _walkLatch = true; _lastStrong = t;
    } else if (stepsOk && effAmp >= walkTh) {
      _walkLatch = true; _sprintLatch = false; _lastStrong = t;
    } else {
      _walkLatch = false; _sprintLatch = false;
    }
    const legsActive = stepsOk && effAmp >= walkTh;
    if (_sprintLatch && legsActive) return 'run';
    if (_walkLatch && legsActive) return 'walk';
    return 'idle';
  }
  // ============================================================

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
    const paused = !document.pointerLockElement ||
      (GAME.UI && GAME.UI.isCraftOpen && GAME.UI.isCraftOpen());
    if (paused) {
      releaseAllKeys();
      lastT = t;
      rafId = requestAnimationFrame(loop);
      return;
    }
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
        detectJump(pose, t);
        // Turning (always available, no training needed)
        applyTurn(computeTurn(pose, t));
        // Walk/run/idle/attack (only if a trained model is loaded). Attack is
        // now handled by the trained "Attack" class — NOT by a raw gesture —
        // so it no longer misfires while turning.
        if (tmModel && posenetOutput) {
          const cls = await classify(pose, posenetOutput);
          applyMovement(cls);
          setStatus(`pose: ${cls || '—'}  ·  turning live`);
        } else if (cfg.cadenceEnabled) {
          // CADENCE call — model-free walk/run/idle from body motion.
          let cls = computeCadence(pose, t);
          // Suppress sprint WHILE actively steering: raising/sliding a hand to
          // turn shifts the torso slightly, which must not be read as movement.
          // Lower the steering hand to walk again.
          if (_steerActive) cls = 'idle';
          applyMovement(cls);
          setStatus(`move: ${_steerActive ? 'turning' : cls}  ·  (model-free)`);
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
    // Status text box removed per user request — it cluttered the webcam
    // preview. Log to console instead so debugging info is still available.
    if (statusEl) { statusEl.remove(); statusEl = null; }
    try { console.log('[PoseControl] ' + msg); } catch (e) {}
  }

  // Toggle with V.
  document.addEventListener('keydown', (e) => { if (e.code === 'KeyV') toggle(); });

  return { start, stop, toggle, cfg, releaseKeys: releaseAllKeys };
})();
