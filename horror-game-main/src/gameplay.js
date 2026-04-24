// ── Core Gameplay System ───────────────────────────────────────────────────────
// Handles all player movement, controls, items, transformations, and game mechanics

export const GAMEPLAY_CONFIG = {
  // Movement settings
  FLOOR_ROW: 5,  // Center of the 32x10 map (rows 1-9, center is 5)
  BASE_MOVE_COOLDOWN: 4,
  MIN_MOVE_COOLDOWN: 2,
  SPRINT_BONUS: 2,
  VISUAL_SMOOTHING: 0.35,
  
  // Map bounds - optimized for MCTS (32x10)
  MIN_X: 1,
  MAX_X: 31,  // 32 wide (1-31)
  MIN_Y: 1,
  MAX_Y: 9,   // 10 tall (1-9)
  
  // Hide settings
  HIDE_ANIMATION_DURATION: 14,
  HIDE_ROW_LIMIT: 4,
  
  // Item settings
  MAX_FLASHLIGHT_DURATION: 600,
  TAPE_DECOY_DURATION: 120,
  CANDY_SPEED_REMOVAL: true,
  MIRROR_REFLECT_DURATION: 30,
  
  // Transformation settings
  CONTROL_INVERSION_CHANCE: 0.05,
  HALLUCINATION_SCATTER_CHANCE: 0.05,
  LIMB_COOLDOWN_PENALTY: 1,
  SPEED_COOLDOWN_PENALTY: 2,
  
  // Game rules
  TOTAL_KEYS: 8,
  MAX_DEATHS: 3,
  TOTAL_ZONES: 30,
};

// ── Player State ─────────────────────────────────────────────────────────────

export function createPlayerState() {
  return {
    // Position
    x: 2,
    y: GAMEPLAY_CONFIG.FLOOR_ROW,
    renderX: 2,
    renderY: GAMEPLAY_CONFIG.FLOOR_ROW,
    
    // Movement
    facing: "right",
    lastMoveTick: 0,
    moveTick: 0,
    moveCooldown: GAMEPLAY_CONFIG.BASE_MOVE_COOLDOWN,
    
    // Hide state
    hide: false,
    hideAnim: "none", // "none", "enter", "idle", "exit"
    hideAnimTick: 0,
    hidePressed: false,
    
    // Transformation effects
    silhouetteOffsetX: 0,
    silhouetteOffsetY: 0,
    visionPenalty: 0,
    audioDistortion: 0,
    
    // Tool usage
    flashlightActive: false,
    flashlightTick: 0,
    tapeCooldown: 0,
  };
}

// ── Input Handling ────────────────────────────────────────────────────────────

export function createInputState() {
  return {
    w: false,
    a: false,
    s: false,
    d: false,
    h: false,
    e: false,
    shift: false,
    "1": false,
    "2": false,
    "3": false,
    "4": false,
    "5": false,
  };
}

export function handleKeyDown(inputState, key) {
  const normalized = key.toLowerCase();
  if (inputState.hasOwnProperty(normalized)) {
    inputState[normalized] = true;
  } else if (key === "ArrowUp") inputState.w = true;
  else if (key === "ArrowDown") inputState.s = true;
  else if (key === "ArrowLeft") inputState.a = true;
  else if (key === "ArrowRight") inputState.d = true;
}

export function handleKeyUp(inputState, key) {
  const normalized = key.toLowerCase();
  if (inputState.hasOwnProperty(normalized)) {
    inputState[normalized] = false;
  } else if (key === "ArrowUp") inputState.w = false;
  else if (key === "ArrowDown") inputState.s = false;
  else if (key === "ArrowLeft") inputState.a = false;
  else if (key === "ArrowRight") inputState.d = false;
}

// ── Movement Logic ───────────────────────────────────────────────────────────

export function normalizeInput(input, inverted) {
  if (!inverted) return input;
  return {
    w: input.s,
    a: input.d,
    s: input.w,
    d: input.a,
    shift: input.shift,
    h: input.h,
    e: input.e,
    "1": input["1"],
    "2": input["2"],
    "3": input["3"],
    "4": input["4"],
    "5": input["5"],
  };
}

export function calculateMoveCooldown(player, transformState, sprinting) {
  const limbStacks = getTransformationStacks(transformState, "LIMB_ELONGATION");
  const speedStacks = getTransformationStacks(transformState, "SPEED_REDUCTION");
  
  const cooldown = Math.max(
    GAMEPLAY_CONFIG.MIN_MOVE_COOLDOWN,
    GAMEPLAY_CONFIG.BASE_MOVE_COOLDOWN + 
      (limbStacks * GAMEPLAY_CONFIG.LIMB_COOLDOWN_PENALTY) +
      (speedStacks * GAMEPLAY_CONFIG.SPEED_COOLDOWN_PENALTY) -
      (sprinting ? GAMEPLAY_CONFIG.SPRINT_BONUS : 0)
  );
  
  return cooldown;
}

export function canMoveTo(x, y, tileAt) {
  // Check bounds - now supports full 2D movement
  if (x < GAMEPLAY_CONFIG.MIN_X || x > GAMEPLAY_CONFIG.MAX_X) return false;
  if (y < GAMEPLAY_CONFIG.MIN_Y || y > GAMEPLAY_CONFIG.MAX_Y) return false;

  // Check tile collision
  const tile = tileAt(x, y);
  const blockedTiles = [1, 8, 14]; // wall, block, door
  return !blockedTiles.includes(tile);
}

export function updatePlayerPosition(player, dx, dy, tileAt) {
  const nx = player.x + dx;
  const ny = player.y + dy;

  if (canMoveTo(nx, ny, tileAt)) {
    player.x = nx;
    player.y = ny;
    return true;
  }
  return false;
}

export function smoothPlayerPosition(player) {
  const smoothing = GAMEPLAY_CONFIG.VISUAL_SMOOTHING;
  player.renderX += (player.x - player.renderX) * smoothing;
  player.renderY += (player.y - player.renderY) * smoothing;

  // Snap when close
  if (Math.abs(player.renderX - player.x) < 0.01) player.renderX = player.x;
  if (Math.abs(player.renderY - player.y) < 0.01) player.renderY = player.y;
}
// ── Hide Mechanics ───────────────────────────────────────────────────────────

export const HIDING_TILES = [2, 6, 10, 11, 15, 17, 20, 21, 23];

export function canHideAt(tile, y) {
  if (y > GAMEPLAY_CONFIG.HIDE_ROW_LIMIT) return false;
  return HIDING_TILES.includes(tile);
}

export function handleHideToggle(player, tileAt, tick) {
  const tile = tileAt(player.x, player.y);
  
  if (player.hide) {
    // Exit hide
    player.hide = false;
    player.hideAnim = "exit";
    player.hideAnimTick = tick;
  } else {
    // Enter hide
    if (canHideAt(tile, GAMEPLAY_CONFIG.FLOOR_ROW)) {
      player.hide = true;
      player.hideAnim = "enter";
      player.hideAnimTick = tick;
    }
  }
}

export function updateHideAnimation(player, tick) {
  if (player.hide) {
    if (player.hideAnim === "enter" && tick - player.hideAnimTick > GAMEPLAY_CONFIG.HIDE_ANIMATION_DURATION) {
      player.hideAnim = "idle";
    }
  } else if (player.hideAnim === "exit" && tick - player.hideAnimTick > GAMEPLAY_CONFIG.HIDE_ANIMATION_DURATION) {
    player.hideAnim = "none";
  }
}

// ── Item/Tool Usage ─────────────────────────────────────────────────────────

export function useFlashlight(player, tools) {
  if (tools.flashlight <= 0) return false;
  
  player.flashlightActive = !player.flashlightActive;
  player.flashlightTick = Date.now();
  
  return true;
}

export function useTape(player, tools, stalkerState) {
  if (tools.tape <= 0) return false;
  
  if (player.tapeCooldown > 0) return false;
  
  // Create decoy sound at player position
  stalkerState.decoySound = {
    x: player.x,
    y: player.y,
    ttl: GAMEPLAY_CONFIG.TAPE_DECOY_DURATION,
  };
  
  player.tapeCooldown = 60; // 1 second cooldown
  
  return true;
}

export function useCandy(tools, transformState) {
  if (tools.candy <= 0) return false;
  
  // Remove speed reduction and limb elongation transformations
  removeTransformation(transformState, "SPEED_REDUCTION");
  removeTransformation(transformState, "LIMB_ELONGATION");
  
  return true;
}

export function useMirrorShard(tools, stalkerState) {
  if (tools.mirrorShard <= 0) return false;
  
  // Reflect stalker - temporarily reduce detection
  stalkerState.reflectTimer = GAMEPLAY_CONFIG.MIRROR_REFLECT_DURATION;
  
  return true;
}

export function useKeyCrayon(tools, player) {
  if (tools.keyCrayon <= 0) return false;
  
  // Mark current position (visual only)
  player.markedPositions = player.markedPositions || [];
  player.markedPositions.push({
    x: player.x,
    y: player.y,
    tick: Date.now(),
  });
  
  return true;
}

// ── Transformation System ─────────────────────────────────────────────────────

export const TRANSFORMATION_TYPES = {
  CONTROL_INVERSION: "CONTROL_INVERSION",
  LIMB_ELONGATION: "LIMB_ELONGATION",
  SPEED_REDUCTION: "SPEED_REDUCTION",
  HALLUCINATION_CLONE: "HALLUCINATION_CLONE",
  VISUAL_OFFSET: "VISUAL_OFFSET",
  AUDIO_DISTORTION: "AUDIO_DISTORTION",
};

export function createTransformState() {
  return {
    active: [],
  };
}

export function addTransformation(transformState, type) {
  const existing = transformState.active.find(t => t.type === type);
  if (existing) {
    existing.stacks++;
    existing.timeLeft = null; // Permanent transformation
  } else {
    transformState.active.push({
      type,
      stacks: 1,
      permanent: true,
      timeLeft: null,
    });
  }
}

export function removeTransformation(transformState, type) {
  const index = transformState.active.findIndex(t => t.type === type);
  if (index !== -1) {
    transformState.active.splice(index, 1);
  }
}

export function getTransformationStacks(transformState, type) {
  const transform = transformState.active.find(t => t.type === type);
  return transform ? transform.stacks : 0;
}

export function updateTransformations(transformState, tick) {
  for (const transform of transformState.active) {
    if (!transform.permanent && transform.timeLeft !== null) {
      transform.timeLeft--;
      if (transform.timeLeft <= 0) {
        transform.stacks--;
        if (transform.stacks <= 0) {
          removeTransformation(transformState, transform.type);
        }
      }
    }
  }
}

// ── Main Player Update Loop ───────────────────────────────────────────────────

export function updatePlayer(player, input, tileAt, transformState, tick, tools, stalkerState) {
  const inversionStacks = getTransformationStacks(transformState, TRANSFORMATION_TYPES.CONTROL_INVERSION);
  const limbStacks = getTransformationStacks(transformState, TRANSFORMATION_TYPES.LIMB_ELONGATION);
  const speedStacks = getTransformationStacks(transformState, TRANSFORMATION_TYPES.SPEED_REDUCTION);
  const visualOffsetStacks = getTransformationStacks(transformState, TRANSFORMATION_TYPES.VISUAL_OFFSET);
  const audioDistortionStacks = getTransformationStacks(transformState, TRANSFORMATION_TYPES.AUDIO_DISTORTION);
  const hallucinationStacks = getTransformationStacks(transformState, TRANSFORMATION_TYPES.HALLUCINATION_CLONE);
  
  // Normalize input (apply control inversion)
  const normalizedInput = normalizeInput(input, inversionStacks > 0);
  
  // Calculate movement direction
  let dx = 0;
  let dy = 0;
  if (normalizedInput.a) dx = -1;  // left
  if (normalizedInput.d) dx = 1;   // right
  if (normalizedInput.w) dy = -1;  // up
  if (normalizedInput.s) dy = 1;   // down
  if (normalizedInput.a) dx = -1;
  // Update facing
  if (dx < 0) player.facing = "left";
  else if (dx > 0) player.facing = "right";
  
  // Apply hallucination scatter
  if ((dx !== 0 || dy !== 0) && hallucinationStacks > 0 && Math.random() < GAMEPLAY_CONFIG.HALLUCINATION_SCATTER_CHANCE * hallucinationStacks) {
    if (Math.random() < 0.5) dx *= -1;
    else dy *= -1;
  }
  
  // Calculate movement cooldown
  const sprinting = normalizedInput.shift;
  const cooldown = calculateMoveCooldown(player, transformState, sprinting);
  
  // Execute movement
  let moved = false;
  if ((dx !== 0 || dy !== 0) && tick >= player.moveTick) {
    const positionChanged = updatePlayerPosition(player, dx, dy, tileAt);
    
    if (positionChanged) {
      player.lastMoveTick = tick;
      moved = true;
      
      // Exit hide when moving
      if (player.hide) {
        player.hide = false;
        player.hideAnim = "exit";
        player.hideAnimTick = tick;
      }
    }
    
    player.moveTick = tick + cooldown;
  }
  
  // Smooth visual position
  smoothPlayerPosition(player);
  
  // Handle hide toggle
  const hideJustPressed = normalizedInput.h && !player.hidePressed;
  player.hidePressed = normalizedInput.h;
  
  if (hideJustPressed) {
    handleHideToggle(player, tileAt, tick);
  }
  
  // Update hide animation
  updateHideAnimation(player, tick);
  
  // Handle tool usage
  if (normalizedInput["1"]) useFlashlight(player, tools);
  if (normalizedInput["2"]) useTape(player, tools, stalkerState);
  if (normalizedInput["3"]) useCandy(tools, transformState);
  if (normalizedInput["4"]) useMirrorShard(tools, stalkerState);
  if (normalizedInput["5"]) useKeyCrayon(tools, player);
  
  // Update transformation effects on player
  player.silhouetteOffsetX = visualOffsetStacks > 0 ? ((tick % 8) - 4) * 0.15 : 0;
  player.silhouetteOffsetY = visualOffsetStacks > 0 ? ((tick % 6) - 3) * 0.15 : 0;
  player.visionPenalty = visualOffsetStacks * 0.08 + limbStacks * 0.03;
  player.audioDistortion = audioDistortionStacks;
  
  // Update cooldowns
  if (player.tapeCooldown > 0) player.tapeCooldown--;
  
  // Keep player on floor row
  player.y = GAMEPLAY_CONFIG.FLOOR_ROW;
  
  return moved;
}

// ── Game State Management ─────────────────────────────────────────────────────

export function createGameState() {
  return {
    player: createPlayerState(),
    input: createInputState(),
    transformState: createTransformState(),
    tools: {
      flashlight: 1,
      tape: 2,
      candy: 1,
      mirrorShard: 1,
      keyCrayon: 1,
    },
    keysCollected: [],
    zoneIndex: 0,
    tick: 0,
    deaths: 0,
    roomsCompleted: 0,
  };
}

export function checkWinCondition(gameState) {
  return gameState.keysCollected.length >= GAMEPLAY_CONFIG.TOTAL_KEYS;
}

export function checkLoseCondition(gameState) {
  return gameState.deaths >= GAMEPLAY_CONFIG.MAX_DEATHS;
}

export function collectKey(gameState) {
  const zone = gameState.zoneIndex;
  if (!gameState.keysCollected.includes(zone)) {
    gameState.keysCollected.push(zone);
    return true;
  }
  return false;
}

// ── Collision Detection ─────────────────────────────────────────────────────

export function isWalkableTile(tile) {
  const walkableTiles = [0, 2, 5, 6, 10, 12, 15, 17, 20, 24];
  return walkableTiles.includes(tile);
}

export function isBlockedTile(tile) {
  const blockedTiles = [1, 3, 4, 7, 8, 9, 14, 18, 19, 22, 23];
  return blockedTiles.includes(tile);
}

export function isExitTile(tile) {
  return tile === 5;
}

export function isFakeExitTile(tile) {
  return tile === 16;
}

export function isKeyTile(tile) {
  return tile === 24;
}

// ── Zone Progression ─────────────────────────────────────────────────────────

export function canProgressToNextZone(gameState) {
  return gameState.zoneIndex < GAMEPLAY_CONFIG.TOTAL_ZONES - 1;
}

export function progressToNextZone(gameState) {
  if (canProgressToNextZone(gameState)) {
    gameState.zoneIndex++;
    gameState.roomsCompleted++;
    return true;
  }
  return false;
}
