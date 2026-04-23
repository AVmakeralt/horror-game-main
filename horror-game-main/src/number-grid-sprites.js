const GRID = 8;
const PIXEL = 8;

function frameFromRows(rows) {
  return rows.map((row) => row.split("").map((c) => Number(c) || 0));
}

function shiftRows(frame, dx = 0, dy = 0) {
  const out = Array.from({ length: GRID }, () => Array(GRID).fill(0));
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const sx = x - dx;
      const sy = y - dy;
      if (sx >= 0 && sy >= 0 && sx < GRID && sy < GRID) out[y][x] = frame[sy][sx];
    }
  }
  return out;
}

const BASE_PLAYER = frameFromRows([
  "00111100",
  "01555510",
  "01566510",
  "01222210",
  "02222220",
  "00233200",
  "00300300",
  "03000300",
]);

const FEAR_PLAYER = frameFromRows([
  "00111100",
  "01777710",
  "01766710",
  "01222210",
  "02222220",
  "00233200",
  "00311300",
  "03000300",
]);

const BASE_STALKER = frameFromRows([
  "00111100",
  "01666610",
  "01655610",
  "01122110",
  "01222210",
  "00233200",
  "00300300",
  "03000300",
]);

const PLAYER_STEP_LEFT = frameFromRows([
  "00111100",
  "01555510",
  "01566510",
  "01222210",
  "02222220",
  "00233200",
  "03000300",
  "00300030",
]);

const PLAYER_STEP_RIGHT = frameFromRows([
  "00111100",
  "01555510",
  "01566510",
  "01222210",
  "02222220",
  "00233200",
  "00300030",
  "03000300",
]);

export const PLAYER_FRAMES = [
  BASE_PLAYER,
  PLAYER_STEP_LEFT,
  BASE_PLAYER,
  PLAYER_STEP_RIGHT,
];

export const PLAYER_FEAR_FRAMES = [
  FEAR_PLAYER,
  shiftRows(FEAR_PLAYER, 0, 1),
  FEAR_PLAYER,
  shiftRows(FEAR_PLAYER, 0, -1),
];

export const STALKER_FRAMES = [
  BASE_STALKER,
  shiftRows(BASE_STALKER, 0, 0),
  BASE_STALKER,
  shiftRows(BASE_STALKER, 0, 0),
];

export const MONSTER_FRAMES = STALKER_FRAMES;

export function pickAnimationFrame(frames, tick, sequence, speed = 8) {
  if (!frames || !frames.length) return null;
  if (!sequence || !sequence.length) {
    return frames[Math.floor(tick / speed) % frames.length];
  }
  const idx = sequence[Math.floor(tick / speed) % sequence.length] % frames.length;
  return frames[idx];
}

export function drawNumberGridSprite(ctx, frame, x, y, options = {}) {
  if (!frame) return;
  const palette = options.palette || {
    1: "#3b2a20",
    2: "#5b6bb2",
    3: "#37405e",
    4: "rgba(255,255,255,0.2)",
    5: "#8b7048",
    6: "#1e1a19",
    7: "rgba(255,245,225,0.78)",
  };
  const alpha = options.alpha == null ? 1 : options.alpha;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let gy = 0; gy < frame.length; gy += 1) {
    for (let gx = 0; gx < frame[gy].length; gx += 1) {
      const colorId = frame[gy][gx];
      if (!colorId) continue;
      ctx.fillStyle = palette[colorId] || "#000";
      ctx.fillRect(x + gx * PIXEL, y + gy * PIXEL, PIXEL, PIXEL);
    }
  }
  ctx.restore();
}