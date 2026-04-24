import { getTransformationStacks, TRANSFORM_TYPES } from "./transform.js";

const DEFAULT_PLAYER_X = 2;
const DEFAULT_PLAYER_Y = 5;

export function createPlayer() {
  return {
    x: DEFAULT_PLAYER_X,
    y: DEFAULT_PLAYER_Y,
    // renderX/renderY are smoothed visual coordinates so movement feels glued
    // to the floor instead of snapping/floating tile-to-tile.
    renderX: DEFAULT_PLAYER_X,
    renderY: DEFAULT_PLAYER_Y,
    hide: false,
    hideAnim: "none",
    hideAnimTick: 0,
    hidePressed: false,
    moveTick: 0,
    // Increase for slower movement, decrease for faster movement.
    moveCooldown: 4,
    visionPenalty: 0,
    audioDistortion: 0,
    silhouetteOffsetX: 0,
    silhouetteOffsetY: 0,
    facing: "right",
    lastMoveTick: 0,
  };
}

function canHideInBackgroundObject(tile, y) {
  // Objects that visually belong to the background and can conceal the player.
  return tile === 2 || tile === 6 || tile === 10 || tile === 11 || tile === 15 || tile === 17 || tile === 20 || tile === 21 || tile === 23;
}

function normalizeInput(keys, inverted) {
  const up = keys.w;
  const down = keys.s;
  const left = keys.a;
  const right = keys.d;
  if (!inverted) return { up, down, left, right };
  return { up: down, down: up, left: right, right: left };
}

export function stepPlayer({ player, keys, tileAt, transformState, tick, mapWidth = 28, mapHeight = 10 }) {
  const inversionStacks = getTransformationStacks(transformState, TRANSFORM_TYPES.CONTROL_INVERSION);
  const limbStacks = getTransformationStacks(transformState, TRANSFORM_TYPES.LIMB_ELONGATION);
  const speedStacks = getTransformationStacks(transformState, TRANSFORM_TYPES.SPEED_REDUCTION);
  const visualOffset = getTransformationStacks(transformState, TRANSFORM_TYPES.VISUAL_OFFSET);
  const scramble = getTransformationStacks(transformState, TRANSFORM_TYPES.HALLUCINATION_CLONE);

  const input = normalizeInput(keys, inversionStacks > 0);
  
  // Full 4-directional movement
  let dx = 0;
  let dy = 0;
  
  if (input.left) dx = -1;
  if (input.right) dx = 1;
  if (input.up) dy = -1;
  if (input.down) dy = 1;

  // Update facing based on primary direction
  if (dx < 0) player.facing = "left";
  else if (dx > 0) player.facing = "right";
  else if (dy < 0) player.facing = "up";
  else if (dy > 0) player.facing = "down";

  if ((dx !== 0 || dy !== 0) && scramble > 0 && Math.random() < 0.05 * scramble) {
    // Scramble direction randomly
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const randomDir = dirs[Math.floor(Math.random() * dirs.length)];
    dx = randomDir[0];
    dy = randomDir[1];
  }

  const sprinting = !!keys.shift;
  // Keep movement grounded and deliberate.
  const cooldown = Math.max(2, player.moveCooldown + limbStacks + speedStacks * 2 - (sprinting ? 2 : 0));
  let moved = false;

  if ((dx !== 0 || dy !== 0) && tick >= player.moveTick) {
    const nx = player.x + dx;
    const ny = player.y + dy;

    const outsideRoomBounds = nx < 1 || nx >= mapWidth - 1 || ny < 1 || ny >= mapHeight - 1;
    const blocked = outsideRoomBounds || tileAt(nx, ny) === 1 || tileAt(nx, ny) === 8 || tileAt(nx, ny) === 14;

    if (!blocked) {
      player.x = nx;
      player.y = ny;
      player.lastMoveTick = tick;
      moved = true;
      if (player.hide) {
        player.hide = false;
        player.hideAnim = "exit";
        player.hideAnimTick = tick;
      }
    }
    player.moveTick = tick + cooldown;
  }

  // Smoothly interpolate visual position toward logical position.
  const smoothing = 0.35;
  player.renderX += (player.x - player.renderX) * smoothing;
  player.renderY += (player.y - player.renderY) * smoothing;
  if (Math.abs(player.renderX - player.x) < 0.01) player.renderX = player.x;
  if (Math.abs(player.renderY - player.y) < 0.01) player.renderY = player.y;

  const hideJustPressed = !!keys.h && !player.hidePressed;
  player.hidePressed = !!keys.h;
  if (hideJustPressed) {
    if (player.hide) {
      player.hide = false;
      player.hideAnim = "exit";
      player.hideAnimTick = tick;
    } else {
      const tile = tileAt(player.x, player.y);
      if (canHideInBackgroundObject(tile, player.y)) {
        player.hide = true;
        player.hideAnim = "enter";
        player.hideAnimTick = tick;
      }
    }
  }

  if (player.hide) {
    if (player.hideAnim !== "enter" || tick - player.hideAnimTick > 14) {
      player.hideAnim = "idle";
    }
  } else if (player.hideAnim === "exit" && tick - player.hideAnimTick > 14) {
    player.hideAnim = "none";
  }

  player.silhouetteOffsetX = visualOffset > 0 ? ((tick % 8) - 4) * 0.15 : 0;
  player.silhouetteOffsetY = visualOffset > 0 ? ((tick % 6) - 3) * 0.15 : 0;
  player.visionPenalty = visualOffset * 0.08 + limbStacks * 0.03;
  player.audioDistortion = getTransformationStacks(transformState, TRANSFORM_TYPES.AUDIO_DISTORTION);

  return moved;
}
