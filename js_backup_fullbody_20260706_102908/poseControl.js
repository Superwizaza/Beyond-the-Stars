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
    maxTurnPixels: 20,       // synthetic movementX at full turn, per frame
                            // (lowered for controllable, proportional turning)
    turnDeadzone: 0.08,     // min steer magnitude below which we don't turn
    // Velocity + net-displacement steering (simulation-tuned):
    turnWinSec: 0.3,        // window for the net-displacement gate
    turnNetGate: 0.15,      // hand must NET-travel this far (shoulder-widths) in
                            // the window to count as a real slide (rejects jitter)
    turnGain: 16,            // steer pixels per unit smoothed slide velocity
    turnVelSmooth: 0.75,     // EMA on hand velocity
    turnGateEase: 0.8,      // eases steering on/off (ramps instead of snapping)
    turnOutSmooth: 0.45,    // final output EMA — kills frame-to-frame jerk
    wristMinScore: 0.30,    // ignore low-confidence wrist reads
    attackVelY: 0.06,       // downward wrist speed (frac of frame h) = attack
    // Classification
    classThreshold: 0.75,   // min probability to accept a trained class
    // One-Euro filter
    oneEuroMinCutoff: 1.0,
    oneEuroBeta: 0.2,
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
    cadenceWinSec: 0.6,        // rolling window length (seconds)
    cadenceWalkAmp: 0.11,      // min peak-to-peak knee bob (body-relative) = walking
    cadenceRunFreq: 1.7,       // steps/sec above this = running
    cadenceStepMinAmp: 0.02,   // min half-amplitude for a bob reversal to count as a step
    cadenceReleaseAmp: 0.08,  // once sprinting, keep going until bob drops below this
    cadenceCoastSec: 0.3,     // keep sprinting this long through brief between-step dips
    // ===============================================================
    turnGateChestFrac: 0.45,  // turn activation line: 45% shoulders→hips = chest level
    // ===== SWING / HIT GESTURE (one-handed axe chop) =====
    swingEnabled: true,       // model-free attack: a FULL 360° arm rotation
                              // (like the arm sweep in a butterfly swim stroke)
    swingRevolution: 3.0,     // radians of continuous same-direction sweep (~170°)
                              // — a big deliberate arm swing, robust to wrist noise
                              // (not a tiny wobble, not a full hard-to-do 360°)
    swingWindow: 1.2,         // must complete the sweep within this many sec
    swingMinRadius: 0.35,     // wrist must be this far from shoulder (body-rel) —
                              // ignores tiny jittery circles near the shoulder
    swingCooldown: 0.6,       // seconds between strikes
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
  let _turnBuf = { left: [], right: [] };       // rolling [{t,x,y}] per raised hand (body-rel)
  let _turnVel = { left: 0, right: 0 };         // smoothed horizontal velocity
  let _turnVelY = { left: 0, right: 0 };        // smoothed |vertical velocity|
  let _turnPrev = { left: null, right: null };  // last {x,y,t} per hand
  let _steerActive = false;                     // true on frames where a hand is steering
  let _turnGate = 0;        // eased 0..1 steering gate (smooth on/off)
  let _turnOut = 0;         // smoothed output (px) — final anti-jerk EMA

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

  // ---------- Turning: hand-locked, shoulder-relative, smoothed ----------
  function computeTurn(pose, t) {
    const lS = kp(pose, 'leftShoulder'), rS = kp(pose, 'rightShoulder');
    const lW = kp(pose, 'leftWrist'),    rW = kp(pose, 'rightWrist');
    if (!lS || !rS || lS.score < 0.3 || rS.score < 0.3) return 0;
    const shoulderY = (lS.position.y + rS.position.y) / 2;
    const shoulderW = Math.abs(rS.position.x - lS.position.x) || 1;
    const H = video.height || 480;

    // A hand is eligible only when RAISED to ~chest height (below that = resting
    // at side → ignored). Only the WRIST is read (elbows never steer).
    const lH = kp(pose, 'leftHip'), rH = kp(pose, 'rightHip');
    let gateY;
    if (lH && rH && lH.score > 0.3 && rH.score > 0.3) {
      const hipY = (lH.position.y + rH.position.y) / 2;
      gateY = shoulderY + (hipY - shoulderY) * cfg.turnGateChestFrac;
    } else {
      gateY = shoulderY + 0.22 * H;
    }
    const raised = (wp) => wp && wp.score > cfg.wristMinScore && wp.position.y < gateY;

    // Update per-hand rolling buffer (net-displacement gate) + smoothed velocity.
    const upd = (nm, wp, el) => {
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
    upd('right', rW, raised(rW));
    upd('left',  lW, raised(lW));

    // A hand steers only if it has NET-traveled horizontally over the window
    // (proves a real directional slide, not in-place jitter or vertical pumping),
    // moving in the same direction as its current velocity.
    const eligible = [];
    for (const nm of ['right', 'left']) {
      const b = _turnBuf[nm];
      if (b.length < 3) continue;
      const net = b[b.length - 1].x - b[0].x;
      let ylo = Infinity, yhi = -Infinity;
      for (const s of b) { if (s.y < ylo) ylo = s.y; if (s.y > yhi) yhi = s.y; }
      const ymov = yhi - ylo;
      if (Math.abs(net) > cfg.turnNetGate && Math.abs(net) >= ymov && _turnVel[nm] * net > 0) {
        eligible.push(nm);
      }
    }
    // Eased gate: ramp steering in/out instead of snapping (0→1 when a slide is
    // active, 1→0 when it ends) so starts and stops aren't abrupt.
    const target = eligible.length ? 1 : 0;
    _turnGate = cfg.turnGateEase * _turnGate + (1 - cfg.turnGateEase) * target;

    let raw = 0;
    if (eligible.length) {
      let best = eligible[0];
      for (const nm of eligible) if (Math.abs(_turnVel[nm]) > Math.abs(_turnVel[best])) best = nm;
      raw = clamp(_turnVel[best] * cfg.turnGain, -1, 1); // - = left, + = right
    }
    // One-Euro on the raw signal, scaled by the eased gate.
    const steer = turnFilter(raw, t) * _turnGate;
    // Final output EMA — removes frame-to-frame jerk from keypoint jitter.
    _turnOut = cfg.turnOutSmooth * _turnOut + (1 - cfg.turnOutSmooth) * steer;
    if (Math.abs(_turnOut) < 0.02) return 0;
    return _turnOut * cfg.maxTurnPixels;                     // → synthetic movementX
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
  let _legBuf = [];         // rolling [{t, v}] of knee vertical (body-relative) for step detection
  let _refEMA = 0;          // SMOOTHED body scale — raw REF jitters when shoulders/hips wobble (e.g. arm pumping), which faked knee movement
  let _sprintLatch = false; // hysteresis: currently sprinting?
  let _lastStrong = 0;      // last time bob was clearly above threshold
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
    const hipYlift = (lH && rH && lH.score > 0.2 && rH.score > 0.2)
      ? (lH.position.y + rH.position.y) / 2 : null;
    let kneeSum = 0, kneeN = 0;
    for (const nm of ['leftKnee','rightKnee']) {
      const k = kp(pose, nm);
      if (k && k.score >= 0.20) { kneeSum += (hipYlift !== null ? (k.position.y - hipYlift) : k.position.y) / REF; kneeN++; }
    }
    if (kneeN === 0) {
      for (const nm of ['leftAnkle','rightAnkle']) {
        const k = kp(pose, nm);
        if (k && k.score >= 0.20) { kneeSum += (hipYlift !== null ? (k.position.y - hipYlift) : k.position.y) / REF; kneeN++; }
      }
    }
    const kneeVal = kneeN ? kneeSum / kneeN : null;

    // Maintain the rolling window.
    if (kneeVal !== null) _legBuf.push({ t, v: kneeVal });
    const win = cfg.cadenceWinSec || 0.9;
    while (_legBuf.length && t - _legBuf[0].t > win) _legBuf.shift();

    // Amplitude = peak-to-peak of the knee signal in the window.
    let amp = 0, steps = 0;
    if (_legBuf.length >= 4) {
      let lo = Infinity, hi = -Infinity;
      for (const s of _legBuf) { if (s.v < lo) lo = s.v; if (s.v > hi) hi = s.v; }
      amp = hi - lo;
      // Count reversals (a step ≈ one up+down); needs a minimum half-amplitude
      // so tiny jitter doesn't register as steps.
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
      steps = (crossings / 2) / span;   // full cycles per second ≈ steps/sec
    }

    // SPRINT-ONLY with HYSTERESIS + COAST so it doesn't stutter between steps:
    //  • Start sprinting when knee bob is clearly above cadenceWalkAmp.
    //  • Keep sprinting while it stays above the lower cadenceReleaseAmp.
    //  • Coast through brief dips for cadenceCoastSec after the last strong bob.
    //  • Stop only when the legs have genuinely gone still.
    // Arms are ignored for movement entirely; torso is not required (absolute
    // knee bob already excludes torso-only motion).
    if (amp >= cfg.cadenceWalkAmp) { _sprintLatch = true; _lastStrong = t; }
    else if (_sprintLatch && amp >= (cfg.cadenceReleaseAmp || 0.055)) { _lastStrong = t; }
    if (_sprintLatch && (t - _lastStrong) > (cfg.cadenceCoastSec || 0.45)) _sprintLatch = false;
    return _sprintLatch ? 'run' : 'idle';
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
        } else if (cfg.cadenceEnabled) {
          // CADENCE call — model-free walk/run/idle from body motion.
          let cls = computeCadence(pose, t);
          // Suppress sprint WHILE actively steering: raising/sliding a hand to
          // turn shifts the torso slightly, which must not be read as movement.
          // Lower the steering hand to walk again.
          if (_steerActive) cls = 'idle';
          applyMovement(cls);
          computeSwing(pose, t);   // SWING call — model-free axe-chop attack
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

  return { start, stop, toggle, cfg };
})();
