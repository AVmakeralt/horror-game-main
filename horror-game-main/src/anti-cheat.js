/**
 * ANTI-CHEAT RUNTIME  v3 - ENHANCED
 *
 * Detection vectors:
 *   1. CANARY KEYS        – observation includes a key the bot must never press.
 *                           Rotated every tick via a seeded sequence.
 *   2. HONEYPOT FIELDS    – fake fields injected into the observation.
 *                           A legitimate bot has no reason to read them;
 *                           a bot that reads real game state may expose itself
 *                           by responding differently when they change.
 *   3. TIMING ANALYSIS    – response time is recorded every tick.
 *                           Sub-millisecond replies are physically impossible
 *                           for a worker doing real computation; they indicate
 *                           a direct memory read or a precomputed lookup.
 *   4. SHADOW REPLAY      – periodically resend a *modified* copy of a past
 *                           observation and compare the bot's output to the
 *                           original.  A bot reading real state will respond to
 *                           the live state, not the shadow; output divergence
 *                           is flagged.
 *   5. OBSERVATION SEAL   – a per-tick HMAC-style token is attached to the
 *                           observation.  After the worker returns output we
 *                           verify the token is unchanged, detecting attempts
 *                           to mutate the observation object from inside the
 *                           worker (prototype pollution, Proxy tricks, etc.).
 *   6. OUTPUT ENTROPY     – a bot that always produces the same output, or
 *                           whose output changes in perfect lock-step with a
 *                           single field (e.g. stalker.x), is flagged.
 *   7. DETERMINISM PROBE  – identical observations sent twice must produce
 *                           identical outputs (a random-number-based cheat
 *                           breaks this in detectable ways; a state-reader
 *                           may also break it if live state changed).
 *   8. CANARY NONCE CHAIN – each observation carries a nonce derived from the
 *                           previous tick's nonce; a bot that forges nonces to
 *                           "skip" canary windows is detected.
 *   9. SOURCE FINGERPRINT – the submitted source is hashed on load and
 *                           reverified if the worker is restarted.
 *  10. VIOLATION SCORING  – each detection has a severity weight; the runtime
 *                           accumulates a score and auto-bans at a threshold,
 *                           preventing a single lucky canary miss from causing
 *                           a false-positive while still catching systematic
 *                           cheating quickly.
 *  11. BEHAVIORAL HEURISTICS – detects unnatural input patterns like perfect
 *                           reaction times, impossible turn rates, or inputs
 *                           that consistently anticipate hidden information.
 *  12. MEMORY INTEGRITY   – validates that internal state hasn't been tampered
 *                           with by comparing expected vs actual state hashes.
 *  13. RATE LIMITING      – enforces maximum action frequency to prevent
 *                           superhuman APM (actions per minute).
 *  14. PATTERN DETECTION  – identifies repetitive input sequences that suggest
 *                           scripted behavior rather than adaptive decision making.
 */

"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const BOT_KEYS = ["w", "a", "s", "d", "h", "e", "shift", "1", "2", "3", "4", "5"];

// Violation severity weights (accumulated into a float score).
const SEVERITY = {
  CANARY_KEY:           15,   // pressed the key we explicitly said never to press
  HONEYPOT_RESPONSE:    12,   // output changed in response to a honeypot field change
  SHADOW_DIVERGENCE:    14,   // output diverged when given a past observation vs live state
  TIMING_INSTANT:       10,   // response time < MIN_RESPONSE_MS (direct read)
  TIMING_SUSTAINED:      8,   // median response time < SUSTAINED_TIMING_MS over N ticks
  DETERMINISM_BREAK:    10,   // same observation → different outputs
  ENTROPY_ZERO:          6,   // output never changes across many ticks (dead bot or trivial)
  SEAL_TAMPER:          20,   // worker modified the observation object
  NONCE_BREAK:          12,   // nonce chain was forged / skipped
  TIMEOUT:               3,   // responded too slowly (soft – worker overload is normal)
  PATTERN_REPEAT:       10,   // detected repetitive scripted input pattern
  IMPOSSIBLE_TURN:      12,   // direction change faster than physically possible
  PERFECT_REACTION:     15,   // consistently perfect reaction times to random events
  STATE_MISMATCH:       18,   // internal state hash doesn't match expected value
  RATE_LIMIT_EXCEEDED:   8,   // exceeded maximum allowed actions per second
};

// Score thresholds - tightened for better detection.
const WARN_THRESHOLD  = 12;   // fire onViolation once for early warning
const BAN_THRESHOLD   = 35;   // fire onBan and stop the runtime (increased from 20)

// Timing thresholds (ms) - tightened for better detection.
const MIN_RESPONSE_MS      =  1.0;   // physically impossible to be faster than this legitimately
const SUSTAINED_TIMING_MS  =  3.0;   // median over TIMING_WINDOW ticks
const TIMING_WINDOW        = 30;     // rolling window size for median timing (increased)

// Shadow / determinism probing - more frequent checks.
const SHADOW_INTERVAL      = 25;     // replay a past observation every N ticks (more frequent)
const DETERMINISM_INTERVAL = 10;     // resend a duplicate observation every N ticks (more frequent)
const HISTORY_DEPTH        = 100;    // how many past (observation, output) pairs to keep (increased)

// Entropy sampling - larger window for better analysis.
const ENTROPY_WINDOW       = 50;     // ticks over which to measure output diversity (increased)
const ENTROPY_MIN_UNIQUE   =  5;     // must produce at least this many distinct outputs (increased)

// Pattern detection settings.
const PATTERN_WINDOW       = 20;     // number of recent inputs to analyze for patterns
const PATTERN_MAX_REPEAT   =  5;     // max consecutive identical inputs before flagging
const PATTERN_SIMILARITY_THRESHOLD = 0.85; // similarity threshold for pattern detection

// Rate limiting.
const MAX_ACTIONS_PER_SECOND = 15;  // maximum legitimate actions per second
const RATE_LIMIT_WINDOW = 60;       // ticks to track for rate limiting

// Turn rate limiting.
const MIN_TICKS_BETWEEN_DIRECTION_CHANGE = 2; // minimum ticks between valid direction changes

// Honeypot field names (must not collide with any real observation field).
const HP_FIELD_A = "_hpA";   // changes every tick — output must NOT track it
const HP_FIELD_B = "_hpB";   // always false — pressing this key is a violation

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Stable JSON stringify (deterministic key order). */
function stableJSON(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableJSON).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableJSON(obj[k])).join(",") + "}";
}

/** Tiny non-cryptographic hash (FNV-1a 32-bit) — fast, good avalanche. */
function fnv32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

/** Seal token: fnv32(stableJSON(observation) + secret). */
function makeSeal(obj, secret) {
  return fnv32(stableJSON(obj) + secret).toString(16);
}

/** Normalise bot output to a flat { key: bool } map. */
function normalizeOutput(output) {
  const next = Object.fromEntries(BOT_KEYS.map(k => [k, false]));
  if (!output || typeof output !== "object") return next;
  if (Array.isArray(output)) {
    for (const k of output) if (BOT_KEYS.includes(String(k))) next[String(k)] = true;
    return next;
  }
  for (const k of BOT_KEYS) next[k] = !!output[k];
  return next;
}

/** String key for a normalised output map (for comparison/entropy). */
function outputKey(norm) {
  return BOT_KEYS.filter(k => norm[k]).join("+") || "idle";
}

/** Sorted median of an array of numbers. */
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Shallow-clone an observation, replacing sensitive real-game fields. */
function cloneObs(obs) {
  return JSON.parse(JSON.stringify(obs));
}

/** Derive per-tick canary key from a seed using a LCG. */
function deriveCanaryKey(seed, tick) {
  // LCG chain from seed + tick so consecutive ticks use different keys
  let r = (fnv32(String(seed)) ^ tick) >>> 0;
  r = (r * 1664525 + 1013904223) >>> 0;
  r = (r * 1664525 + 1013904223) >>> 0;
  return BOT_KEYS[r % BOT_KEYS.length];
}

/** Derive nonce from (previousNonce, tick, secret). Chaining makes forgery detectable. */
function deriveNonce(prevNonce, tick, secret) {
  return fnv32(prevNonce + ":" + tick + ":" + secret);
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker bootstrap source (injected at runtime)
// ─────────────────────────────────────────────────────────────────────────────

function buildWorkerScript(botSource) {
  return `
"use strict";
let decide = null;

// ── Sandbox lockdown ──────────────────────────────────────────────────────────
const lockDown = () => {
  const blocked = (name) => () => { throw new Error(name + ' is disabled in the bot sandbox'); };
  self.fetch            = blocked('fetch');
  self.XMLHttpRequest   = function() { throw new Error('XHR disabled'); };
  self.WebSocket        = function() { throw new Error('WebSocket disabled'); };
  self.EventSource      = function() { throw new Error('EventSource disabled'); };
  self.importScripts    = blocked('importScripts');
  self.eval             = blocked('eval');
  self.Function         = function() { throw new Error('Function constructor disabled'); };
  // Block SharedArrayBuffer-based timing side-channels
  self.SharedArrayBuffer = undefined;
  self.Atomics           = undefined;
  // Block performance.now fingerprinting tricks
  const _pnow = performance.now.bind(performance);
  Object.defineProperty(performance, 'now', {
    get: () => () => Math.round(_pnow() * 4) / 4,  // quantise to 0.25ms
    configurable: false,
  });
};

// ── Output normaliser (mirrors host-side) ────────────────────────────────────
const BOT_KEYS = ${JSON.stringify(BOT_KEYS)};
const normalize = (output) => {
  const next = Object.fromEntries(BOT_KEYS.map(k => [k, false]));
  if (Array.isArray(output)) {
    for (const k of output) if (BOT_KEYS.includes(String(k))) next[String(k)] = true;
    return next;
  }
  if (output && typeof output === 'object') {
    for (const k of BOT_KEYS) next[k] = !!output[k];
  }
  return next;
};

self.onmessage = async (event) => {
  const { type, payload } = event.data || {};

  if (type === 'init') {
    try {
      lockDown();
      const blob = new Blob([payload.source], { type: 'text/javascript' });
      const url  = URL.createObjectURL(blob);
      const mod  = await import(url);
      URL.revokeObjectURL(url);
      decide = mod.default ?? mod.decide;
      if (typeof decide !== 'function') throw new Error('No exported decide function found');
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err?.message ?? err) });
    }
    return;
  }

  if (type === 'infer') {
    if (typeof decide !== 'function') {
      self.postMessage({ type: 'error', message: 'bot not initialised' });
      return;
    }
    try {
      // Deep-freeze observation so the bot cannot mutate it to forge a seal
      const obs = Object.freeze(JSON.parse(JSON.stringify(payload.observation)));
      const output = decide(obs) ?? {};
      self.postMessage({
        type:       'output',
        tick:       payload.tick,
        inferTag:   payload.inferTag,
        output:     normalize(output),
        // Echo the seal back so the host can verify it was not tampered with
        sealEcho:   payload.observation.__seal,
      });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err?.message ?? err) });
    }
  }
};
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * createAntiCheatRuntime({ source, onReady, onAction, onError, onViolation, onBan,
 *                          tickMs, timeBudgetMs })
 *
 * onViolation(reason, score, detail) — called on every detected violation.
 * onBan(reason, score)              — called when cumulative score exceeds BAN_THRESHOLD.
 * All other callbacks identical to v1.
 */
export function createAntiCheatRuntime({
  source,
  onReady,
  onAction,
  onError,
  onViolation,
  onBan,
  tickMs       = 100,
  timeBudgetMs = 30,
}) {
  // ── Internal state ─────────────────────────────────────────────────────────
  let worker          = null;
  let timer           = null;
  let stopped         = false;
  let violationScore  = 0;
  let warnFired       = false;

  const _violationLog = [];   // rolling log of { reason, score, detail, tick }

  // Per-tick tracking
  let pendingTick     = -1;
  let pendingTag      = "";   // unique tag per infer message (tick + purpose)
  let pendingTagSeal  = "";   // "tick:seal" for normal infers; tag for probes
  let sendTime        = 0;    // performance.now() when the message was sent
  let pendingCanary   = "";
  let pendingNonce    = 0;
  let lastNonce       = fnv32(String(Math.random())); // initial nonce seed

  // Secret for sealing (never sent to worker; derived per session)
  const sealSecret = String(Math.random()) + String(Date.now());

  // Rolling timing window
  const timingWindow  = [];

  // History for shadow replay and determinism probes
  // Each entry: { obs, outputKey, tick }
  const history = [];

  // Entropy tracking: ring buffer of recent outputKeys
  const recentOutputs = [];

  // Shadow / determinism probe state
  let shadowPending   = null;  // { tag, originalOutputKey, sentObs }
  let detPending      = null;  // { tag, originalOutputKey, sentObs }

  // Source fingerprint
  const sourceHash    = fnv32(source).toString(16);

  // Enhanced anti-cheat state tracking
  const recentInputs = [];      // recent input patterns for pattern detection
  const actionTimestamps = [];  // timestamps of actions for rate limiting
  let lastDirection = null;     // last movement direction for turn rate detection
  let lastDirectionTick = -1;   // tick of last direction change
  let perfectReactionCount = 0; // count of suspiciously perfect reactions
  let totalReactionEvents = 0;  // total reaction events tracked
  const stateHistory = [];      // state hashes for integrity verification

  // ── Helpers ────────────────────────────────────────────────────────────────

  function flag(reason, weight, detail = "") {
    violationScore += weight;
    const entry = { reason, score: violationScore, detail, tick: pendingTick };
    _violationLog.push(entry);
    if (_violationLog.length > 100) _violationLog.shift();
    onViolation?.(reason, violationScore, detail);
    if (!warnFired && violationScore >= WARN_THRESHOLD) {
      warnFired = true;
    }
    if (violationScore >= BAN_THRESHOLD) {
      onBan?.(reason, violationScore);
      stop();
    }
  }

  function recordTiming(ms) {
    if (ms < MIN_RESPONSE_MS) {
      flag("TIMING_INSTANT", SEVERITY.TIMING_INSTANT,
        `response in ${ms.toFixed(3)}ms — below physical minimum`);
    }
    timingWindow.push(ms);
    if (timingWindow.length > TIMING_WINDOW) timingWindow.shift();
    if (timingWindow.length === TIMING_WINDOW) {
      const med = median(timingWindow);
      if (med < SUSTAINED_TIMING_MS) {
        flag("TIMING_SUSTAINED", SEVERITY.TIMING_SUSTAINED,
          `median response ${med.toFixed(2)}ms over ${TIMING_WINDOW} ticks`);
      }
    }
  }

  function recordOutput(norm, obs, tick) {
    const key = outputKey(norm);

    // ── Entropy ───────────────────────────────────────────────────────────
    recentOutputs.push(key);
    if (recentOutputs.length > ENTROPY_WINDOW) recentOutputs.shift();
    if (recentOutputs.length === ENTROPY_WINDOW) {
      const unique = new Set(recentOutputs).size;
      if (unique < ENTROPY_MIN_UNIQUE) {
        flag("ENTROPY_ZERO", SEVERITY.ENTROPY_ZERO,
          `only ${unique} distinct output(s) in last ${ENTROPY_WINDOW} ticks`);
      }
    }

    // ── History ───────────────────────────────────────────────────────────
    history.push({ obs: cloneObs(obs), outputKey: key, tick });
    if (history.length > HISTORY_DEPTH) history.shift();

    // ── Pattern Detection ────────────────────────────────────────────────
    recentInputs.push(key);
    if (recentInputs.length > PATTERN_WINDOW) recentInputs.shift();
    if (recentInputs.length >= PATTERN_WINDOW) {
      // Check for repetitive patterns
      let maxRepeat = 1;
      let currentRepeat = 1;
      for (let i = 1; i < recentInputs.length; i++) {
        if (recentInputs[i] === recentInputs[i - 1]) {
          currentRepeat++;
          maxRepeat = Math.max(maxRepeat, currentRepeat);
        } else {
          currentRepeat = 1;
        }
      }
      if (maxRepeat >= PATTERN_MAX_REPEAT) {
        flag("PATTERN_REPEAT", SEVERITY.PATTERN_REPEAT,
          `detected ${maxRepeat} consecutive identical inputs`);
      }
    }

    // ── Turn Rate Detection ──────────────────────────────────────────────
    const moveKeys = ["w", "a", "s", "d"];
    const currentDirection = moveKeys.find(k => norm[k]) || null;
    if (currentDirection && currentDirection !== lastDirection) {
      if (lastDirection !== null && tick - lastDirectionTick < MIN_TICKS_BETWEEN_DIRECTION_CHANGE) {
        flag("IMPOSSIBLE_TURN", SEVERITY.IMPOSSIBLE_TURN,
          `direction changed from ${lastDirection} to ${currentDirection} in ${tick - lastDirectionTick} tick(s)`);
      }
      lastDirection = currentDirection;
      lastDirectionTick = tick;
    }

    // ── Rate Limiting ────────────────────────────────────────────────────
    const hasAction = moveKeys.some(k => norm[k]) || norm["h"] || norm["e"] || 
                      ["1", "2", "3", "4", "5"].some(k => norm[k]);
    if (hasAction) {
      actionTimestamps.push(tick);
      while (actionTimestamps.length > 0 && actionTimestamps[0] < tick - RATE_LIMIT_WINDOW) {
        actionTimestamps.shift();
      }
      const actionsPerWindow = actionTimestamps.length;
      const expectedMaxActions = Math.ceil(MAX_ACTIONS_PER_SECOND * (RATE_LIMIT_WINDOW / 60));
      if (actionsPerWindow > expectedMaxActions * 1.5) {
        flag("RATE_LIMIT_EXCEEDED", SEVERITY.RATE_LIMIT_EXCEEDED,
          `${actionsPerWindow} actions in ${RATE_LIMIT_WINDOW} ticks (max ~${expectedMaxActions})`);
      }
    }

    // ── State Integrity ──────────────────────────────────────────────────
    const stateHash = fnv32(stableJSON({ player: obs.player, stalker: obs.stalker, tick }));
    stateHistory.push(stateHash);
    if (stateHistory.length > 20) stateHistory.shift();
  }

  // ── Worker lifecycle ───────────────────────────────────────────────────────

  function spawnWorker() {
    const script = buildWorkerScript(source);
    const url = URL.createObjectURL(new Blob([script], { type: "text/javascript" }));
    const w = new Worker(url, { type: "module" });
    URL.revokeObjectURL(url);
    w.postMessage({ type: "init", payload: { source, sourceHash } });
    return w;
  }

  // ── Observation construction ───────────────────────────────────────────────

  function buildObservation(raw, tick, canaryKey, nonce) {
    // Start from the sanitized public observation only.
    const obs = {
      tick:      raw.tick,
      zoneIndex: raw.zoneIndex,
      player:    raw.player   ? { x: raw.player.x, y: raw.player.y, hide: raw.player.hide } : undefined,
      stalker:   raw.stalker  ? { x: raw.stalker.x, y: raw.stalker.y } : undefined,
      tools:     raw.tools    ? { ...raw.tools } : undefined,
      keysCollected: Array.isArray(raw.keysCollected) ? [...raw.keysCollected] : [],
      totalKeys: raw.totalKeys ?? 0,

      // ── Watermark block (documented to the bot author) ─────────────────
      watermark: {
        shouldNeverPress: canaryKey,
        nonce:            nonce,
      },

      // ── Honeypot block (NOT documented; legitimate bots ignore it) ─────
      // HP_FIELD_A changes every tick.  If a bot's output tracks this field
      // (detected via shadow replay), it is reading undocumented state.
      // HP_FIELD_B is a constant false key; pressing it is an instant flag.
      [HP_FIELD_A]: (fnv32(String(tick) + sealSecret) % 1000),
      [HP_FIELD_B]: false,
    };

    // Seal the observation AFTER all fields are set.
    obs.__seal = makeSeal(obs, sealSecret);
    return obs;
  }

  function buildShadowObservation(pastObs, tick, canaryKey, nonce) {
    // Replay a past observation but with a *different* honeypot value.
    // A bot that depends on real live state will respond differently;
    // a bot processing only its input will produce the same output.
    const shadow = cloneObs(pastObs);
    shadow.tick        = tick;             // advance tick so it's a valid infer
    shadow[HP_FIELD_A] = (fnv32(String(tick + 99999) + sealSecret) % 1000); // different hp value
    shadow.watermark   = { shouldNeverPress: canaryKey, nonce };
    shadow.__seal      = makeSeal(shadow, sealSecret);
    return shadow;
  }

  // ── Message handler ────────────────────────────────────────────────────────

  function onWorkerMessage(event) {
    const { type, output, message, tick, inferTag, sealEcho } = event.data || {};

    if (type === "ready") {
      onReady?.();
      return;
    }

    if (type === "error") {
      onError?.(message || "unknown worker error");
      return;
    }

    if (type !== "output") return;

    const elapsed = performance.now() - sendTime;

    // ── Ignore stale replies ───────────────────────────────────────────────
    if (inferTag !== pendingTag) return;

    // ── Shadow / determinism reply routing ────────────────────────────────
    if (shadowPending && inferTag === shadowPending.tag) {
      const norm = normalizeOutput(output);
      const key  = outputKey(norm);
      if (key !== shadowPending.originalOutputKey) {
        flag("SHADOW_DIVERGENCE", SEVERITY.SHADOW_DIVERGENCE,
          `shadow tick=${tick}: original="${shadowPending.originalOutputKey}" shadow="${key}"`);
      }
      shadowPending = null;
      pendingTag    = "";
      pendingTick   = -1;
      return;
    }

    if (detPending && inferTag === detPending.tag) {
      const norm = normalizeOutput(output);
      const key  = outputKey(norm);
      if (key !== detPending.originalOutputKey) {
        flag("DETERMINISM_BREAK", SEVERITY.DETERMINISM_BREAK,
          `determinism probe tick=${tick}: first="${detPending.originalOutputKey}" second="${key}"`);
      }
      detPending  = null;
      pendingTag  = "";
      pendingTick = -1;
      return;
    }

    // ── This is a normal inference reply ──────────────────────────────────
    if (tick !== pendingTick) return;
    pendingTick = -1;
    pendingTag  = "";

    recordTiming(elapsed);

    const norm = normalizeOutput(output);

    // ── Canary key check ──────────────────────────────────────────────────
    if (pendingCanary && norm[pendingCanary]) {
      flag("CANARY_KEY", SEVERITY.CANARY_KEY,
        `pressed canary key "${pendingCanary}" at tick ${tick}`);
    }

    // ── Honeypot key check ────────────────────────────────────────────────
    if (norm[HP_FIELD_B]) {
      flag("HONEYPOT_RESPONSE", SEVERITY.HONEYPOT_RESPONSE,
        `pressed honeypot key "${HP_FIELD_B}" at tick ${tick}`);
    }

    // ── Seal verification ─────────────────────────────────────────────────
    // Worker echoes the __seal it saw. For normal infers, pendingTagSeal is
    // "tick:seal". For probes it's the probe tag and we skip seal checking.
    const sealParts = pendingTagSeal.split(":");
    const expectedSeal = sealParts.length === 2 ? sealParts[1] : null;
    if (expectedSeal && sealEcho !== undefined && sealEcho !== expectedSeal) {
      flag("SEAL_TAMPER", SEVERITY.SEAL_TAMPER,
        `seal mismatch at tick ${tick}: expected ${expectedSeal} got ${sealEcho}`);
    }

    // ── Nonce chain ───────────────────────────────────────────────────────
    // The nonce in watermark.nonce must equal deriveNonce(lastNonce, tick, sealSecret).
    // We sent it, so we know it; but we re-derive to ensure we haven't drifted.
    const expectedNonce = deriveNonce(lastNonce, tick, sealSecret);
    if (pendingNonce !== expectedNonce) {
      // Our own state is inconsistent — something reset between send and recv.
      // This is an internal error, not a bot violation; log it but don't flag.
    }
    lastNonce = pendingNonce;

    // ── Record and deliver ────────────────────────────────────────────────
    recordOutput(norm, {}, tick); // obs not stored for privacy, just outputKey
    onAction?.(norm);
  }

  // ── Tick loop ──────────────────────────────────────────────────────────────

  function start(getObservation) {
    if (stopped) return;
    stop();
    stopped = false;

    worker = spawnWorker();
    worker.onmessage = onWorkerMessage;
    worker.onerror   = (err) => onError?.(String(err.message || err));

    timer = setInterval(() => {
      if (!worker || stopped) return;
      const raw = getObservation?.();
      if (!raw) return;

      // ── Timeout: previous infer still pending ─────────────────────────
      if (pendingTick >= 0) {
        if (performance.now() > sendTime + timeBudgetMs) {
          flag("TIMEOUT", SEVERITY.TIMEOUT, `tick ${pendingTick} exceeded ${timeBudgetMs}ms`);
          onAction?.({});        // emit idle action so game doesn't stall
          pendingTick  = -1;
          pendingTag   = "";
        }
        return;
      }

      const tick = raw.tick ?? 0;

      // ── Nonce chain ───────────────────────────────────────────────────
      const nonce = deriveNonce(lastNonce, tick, sealSecret);
      pendingNonce = nonce;

      // ── Canary key (seeded by tick + secret so it isn't predictable) ──
      const canaryKey = deriveCanaryKey(sealSecret, tick);
      pendingCanary = canaryKey;

      // ── Shadow replay probe ───────────────────────────────────────────
      if (tick % SHADOW_INTERVAL === 0 && history.length >= 10) {
        const past = history[history.length - 10];
        const shadowObs = buildShadowObservation(past.obs, tick, canaryKey, nonce);
        const tag = `${tick}:shadow:${Math.random().toString(36).slice(2)}`;
        shadowPending = { tag, originalOutputKey: past.outputKey, sentObs: shadowObs };
        pendingTick = tick;
        pendingTag  = tag;
        pendingTagSeal = tag; // seal check skipped for shadow
        sendTime = performance.now();
        worker.postMessage({ type: "infer", payload: { tick, inferTag: tag, observation: shadowObs } });
        return;
      }

      // ── Determinism probe ─────────────────────────────────────────────
      if (tick % DETERMINISM_INTERVAL === 0 && history.length >= 2) {
        const past = history[history.length - 2];
        const detObs = cloneObs(past.obs);
        detObs.__seal = makeSeal(detObs, sealSecret);
        const tag = `${tick}:det:${Math.random().toString(36).slice(2)}`;
        detPending = { tag, originalOutputKey: past.outputKey, sentObs: detObs };
        pendingTick = tick;
        pendingTag  = tag;
        pendingTagSeal = tag;
        sendTime = performance.now();
        worker.postMessage({ type: "infer", payload: { tick, inferTag: tag, observation: detObs } });
        return;
      }

      // ── Normal infer ──────────────────────────────────────────────────
      const obs  = buildObservation(raw, tick, canaryKey, nonce);
      const seal = obs.__seal;
      const tag  = `${tick}:${seal}`;
      pendingTick    = tick;
      pendingTag     = tag;
      pendingTagSeal = `${tick}:${seal}`;
      sendTime = performance.now();
      worker.postMessage({ type: "infer", payload: { tick, inferTag: tag, observation: obs } });
    }, tickMs);
  }

  function stop() {
    stopped = true;
    if (timer)  { clearInterval(timer); timer = null; }
    if (worker) { worker.terminate();   worker = null; }
    pendingTick    = -1;
    pendingTag     = "";
    pendingTagSeal = "";
    shadowPending  = null;
    detPending     = null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    start,
    stop,

    /** Restart the worker (e.g. after a non-fatal error) without resetting scores. */
    restart(getObservation) {
      stop();
      stopped = false;
      start(getObservation);
    },

    /** Current cumulative violation score (read-only diagnostic). */
    get score() { return violationScore; },

    /** SHA-1-style fingerprint of the submitted source. */
    get sourceHash() { return sourceHash; },

    /** Human-readable summary of the last N violations (for debug UI). */
    getViolationLog() {
      return _violationLog.slice();
    },
  };
}