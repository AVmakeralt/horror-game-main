// ── Stalker AI System ─────────────────────────────────────────────────────────
// Complete AI movement, pathfinding, and behavior system for the stalker enemy

export const STALKER_CONFIG = {
  // Movement settings
  BASE_SPEED: 1,
  BASE_SIGHT_RANGE: 5,
  BASE_HEARING_RANGE: 4,
  BASE_SIGHT_CONE: Math.PI / 3,
  CATCH_RADIUS: 1,
  
  // Pathfinding
  PATH_UPDATE_INTERVAL: 30,
  MAX_PATH_LENGTH: 100,
  REPATH_ON_BLOCKED: true,
  
  // Behavior
  PATROL_SPEED_MULTIPLIER: 0.5,
  CHASE_SPEED_MULTIPLIER: 1.5,
  SEARCH_SPEED_MULTIPLIER: 0.8,
  
  // Memory
  NOISE_MEMORY_DURATION: 120,
  SIGHT_MEMORY_DURATION: 60,
  MAX_MEMORY_ENTRIES: 10,
  
  // State transitions
  CHASE_SIGHT_THRESHOLD: 0.8,
  SEARCH_DURATION: 180,
  PATROL_NODE_SWITCH_INTERVAL: 240,
  
  // Map bounds
  MIN_X: 0,
  MAX_X: 27,
  MIN_Y: 0,
  MAX_Y: 9,
};

// ── Stalker State ─────────────────────────────────────────────────────────────

export function createStalkerState(spawnPosition) {
  return {
    // Position
    x: spawnPosition.x,
    y: spawnPosition.y,
    renderX: spawnPosition.x,
    renderY: spawnPosition.y,
    
    // Movement
    facing: "left",
    lastMoveTick: 0,
    moveTick: 0,
    speed: STALKER_CONFIG.BASE_SPEED,
    
    // AI State
    state: "patrol", // "patrol", "chase", "search", "wait"
    targetX: null,
    targetY: null,
    path: [],
    pathIndex: 0,
    
    // Memory
    recentNoises: [],
    lastPlayerSighting: null,
    knownPlayerPosition: null,
    
    // Patrol
    patrolNodeIndex: 0,
    patrolNodes: [],
    
    // Detection
    hasLineOfSight: false,
    canHearPlayer: false,
    detectionConfidence: 0,
    
    // Effects
    reflectTimer: 0,
    confused: false,
    confusedTimer: 0,
    
    // Zone-specific parameters
    zoneSpeed: STALKER_CONFIG.BASE_SPEED,
    zoneSightRange: STALKER_CONFIG.BASE_SIGHT_RANGE,
    zoneHearingRange: STALKER_CONFIG.BASE_HEARING_RANGE,
    zoneSightCone: STALKER_CONFIG.BASE_SIGHT_CONE,
    zonePredictive: false,
  };
}

// ── Pathfinding System ───────────────────────────────────────────────────────

export function findPath(startX, startY, endX, endY, tileAt, blockedTiles) {
  const path = [];
  const visited = new Set();
  const queue = [{ x: startX, y: startY, path: [] }];
  
  while (queue.length > 0) {
    const current = queue.shift();
    const key = `${current.x},${current.y}`;
    
    if (visited.has(key)) continue;
    visited.add(key);
    
    // Check if reached target
    if (current.x === endX && current.y === endY) {
      return current.path;
    }
    
    // Check path length limit
    if (current.path.length > STALKER_CONFIG.MAX_PATH_LENGTH) continue;
    
    // Explore neighbors
    const neighbors = [
      { x: current.x - 1, y: current.y },
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y - 1 },
      { x: current.x, y: current.y + 1 },
    ];
    
    for (const neighbor of neighbors) {
      const nKey = `${neighbor.x},${neighbor.y}`;
      if (visited.has(nKey)) continue;
      
      // Check bounds
      if (neighbor.x < STALKER_CONFIG.MIN_X || neighbor.x > STALKER_CONFIG.MAX_X) continue;
      if (neighbor.y < STALKER_CONFIG.MIN_Y || neighbor.y > STALKER_CONFIG.MAX_Y) continue;
      
      // Check blocked tiles
      const tile = tileAt(neighbor.x, neighbor.y);
      if (blockedTiles.includes(tile)) continue;
      
      // Add to queue
      queue.push({
        x: neighbor.x,
        y: neighbor.y,
        path: [...current.path, neighbor],
      });
    }
  }
  
  return null; // No path found
}

export function updatePath(stalker, player, tileAt, blockedTiles) {
  if (stalker.knownPlayerPosition) {
    const path = findPath(
      Math.round(stalker.x),
      Math.round(stalker.y),
      stalker.knownPlayerPosition.x,
      stalker.knownPlayerPosition.y,
      tileAt,
      blockedTiles
    );
    
    if (path) {
      stalker.path = path;
      stalker.pathIndex = 0;
      return true;
    }
  }
  return false;
}

// ── Sensory Perception ───────────────────────────────────────────────────────

export function checkLineOfSight(stalker, player, tileAt) {
  const dx = player.x - stalker.x;
  const dy = player.y - stalker.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  // Check distance
  if (distance > stalker.zoneSightRange) return false;
  
  // Check sight cone
  const angle = Math.atan2(dy, dx);
  const facingAngle = stalker.facing === "left" ? Math.PI : 0;
  const angleDiff = Math.abs(angle - facingAngle);
  
  if (angleDiff > stalker.zoneSightCone) return false;
  
  // Check line of sight (raycast)
  const steps = Math.ceil(distance);
  for (let i = 1; i < steps; i++) {
    const checkX = stalker.x + (dx / steps) * i;
    const checkY = stalker.y + (dy / steps) * i;
    const tile = tileAt(Math.round(checkX), Math.round(checkY));
    
    // Walls block sight
    if (tile === 1) return false;
  }
  
  return true;
}

export function checkHearing(stalker, player, playerMoved) {
  const dx = player.x - stalker.x;
  const dy = player.y - stalker.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  if (distance > stalker.zoneHearingRange) return false;
  
  // Player must have moved to make noise
  if (!playerMoved) return false;
  
  return true;
}

export function updateSensoryMemory(stalker, player, tick, playerMoved) {
  // Update noise memory
  if (checkHearing(stalker, player, playerMoved)) {
    stalker.recentNoises.unshift({
      x: player.x,
      y: player.y,
      ttl: STALKER_CONFIG.NOISE_MEMORY_DURATION,
    });
    
    // Limit memory size
    if (stalker.recentNoises.length > STALKER_CONFIG.MAX_MEMORY_ENTRIES) {
      stalker.recentNoises.pop();
    }
  }
  
  // Update sight memory
  if (stalker.hasLineOfSight) {
    stalker.lastPlayerSighting = {
      x: player.x,
      y: player.y,
      tick: tick,
      ttl: STALKER_CONFIG.SIGHT_MEMORY_DURATION,
    };
    stalker.knownPlayerPosition = { x: player.x, y: player.y };
  }
  
  // Decay noise memory
  for (const noise of stalker.recentNoises) {
    noise.ttl--;
  }
  stalker.recentNoises = stalker.recentNoises.filter(n => n.ttl > 0);
  
  // Decay sight memory
  if (stalker.lastPlayerSighting) {
    stalker.lastPlayerSighting.ttl--;
    if (stalker.lastPlayerSighting.ttl <= 0) {
      stalker.lastPlayerSighting = null;
    }
  }
}

// ── AI State Machine ─────────────────────────────────────────────────────────

export function updateAIState(stalker, player, tick) {
  const hasSight = stalker.hasLineOfSight;
  const hasNoise = stalker.recentNoises.length > 0;
  const hasSighting = stalker.lastPlayerSighting !== null;
  
  // State transitions
  switch (stalker.state) {
    case "patrol":
      if (hasSight && stalker.detectionConfidence > STALKER_CONFIG.CHASE_SIGHT_THRESHOLD) {
        stalker.state = "chase";
      } else if (hasNoise || hasSighting) {
        stalker.state = "search";
      }
      break;
      
    case "chase":
      if (!hasSight && !hasSighting) {
        stalker.state = "search";
        stalker.searchTimer = STALKER_CONFIG.SEARCH_DURATION;
      }
      break;
      
    case "search":
      if (hasSight && stalker.detectionConfidence > STALKER_CONFIG.CHASE_SIGHT_THRESHOLD) {
        stalker.state = "chase";
      } else if (stalker.searchTimer <= 0) {
        stalker.state = "patrol";
      }
      stalker.searchTimer--;
      break;
      
    case "wait":
      if (stalker.waitTimer <= 0) {
        stalker.state = "patrol";
      }
      stalker.waitTimer--;
      break;
  }
}

// ── Movement Logic ───────────────────────────────────────────────────────────

export function calculateStalkerSpeed(stalker, state) {
  const baseSpeed = stalker.zoneSpeed;
  
  switch (state) {
    case "patrol":
      return baseSpeed * STALKER_CONFIG.PATROL_SPEED_MULTIPLIER;
    case "chase":
      return baseSpeed * STALKER_CONFIG.CHASE_SPEED_MULTIPLIER;
    case "search":
      return baseSpeed * STALKER_CONFIG.SEARCH_SPEED_MULTIPLIER;
    default:
      return baseSpeed;
  }
}

export function canStalkerMoveTo(x, y, tileAt) {
  // Stalker can walk on floor and hide spots
  const walkableTiles = [0, 2, 5, 6, 10, 12, 15, 17, 20, 24];
  const tile = tileAt(x, y);
  
  // Check bounds
  if (x < STALKER_CONFIG.MIN_X || x > STALKER_CONFIG.MAX_X) return false;
  if (y < STALKER_CONFIG.MIN_Y || y > STALKER_CONFIG.MAX_Y) return false;
  
  return walkableTiles.includes(tile);
}

export function moveStalkerAlongPath(stalker, tileAt) {
  if (stalker.path.length === 0 || stalker.pathIndex >= stalker.path.length) {
    return false;
  }
  
  const nextNode = stalker.path[stalker.pathIndex];
  
  if (canStalkerMoveTo(nextNode.x, nextNode.y, tileAt)) {
    stalker.x = nextNode.x;
    stalker.y = nextNode.y;
    stalker.pathIndex++;
    return true;
  }
  
  // Path blocked, try to recompute
  return false;
}

export function moveStalkerTowardTarget(stalker, targetX, targetY, tileAt) {
  const dx = Math.sign(targetX - stalker.x);
  const dy = Math.sign(targetY - stalker.y);
  
  // Prefer horizontal movement
  if (dx !== 0 && canStalkerMoveTo(stalker.x + dx, stalker.y, tileAt)) {
    stalker.x += dx;
    stalker.facing = dx > 0 ? "right" : "left";
    return true;
  }
  
  // Try vertical
  if (dy !== 0 && canStalkerMoveTo(stalker.x, stalker.y + dy, tileAt)) {
    stalker.y += dy;
    return true;
  }
  
  return false;
}

export function moveStalkerPatrol(stalker, tileAt) {
  if (stalker.patrolNodes.length === 0) return false;
  
  const targetNode = stalker.patrolNodes[stalker.patrolNodeIndex];
  
  // Check if reached patrol node
  const dx = targetNode.x - stalker.x;
  const dy = targetNode.y - stalker.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  if (distance < 0.5) {
    // Move to next patrol node
    stalker.patrolNodeIndex = (stalker.patrolNodeIndex + 1) % stalker.patrolNodes.length;
    return false;
  }
  
  return moveStalkerTowardTarget(stalker, targetNode.x, targetNode.y, tileAt);
}

export function smoothStalkerPosition(stalker) {
  const smoothing = 0.2;
  stalker.renderX += (stalker.x - stalker.renderX) * smoothing;
  stalker.renderY += (stalker.y - stalker.renderY) * smoothing;
  
  // Snap when close
  if (Math.abs(stalker.renderX - stalker.x) < 0.01) stalker.renderX = stalker.x;
  if (Math.abs(stalker.renderY - stalker.y) < 0.01) stalker.renderY = stalker.y;
}

// ── Main Stalker Update Loop ─────────────────────────────────────────────────

export function updateStalker(stalker, player, tileAt, tick, zoneAI, blockedTiles) {
  // Update zone-specific parameters
  stalker.zoneSpeed = zoneAI.speed || STALKER_CONFIG.BASE_SPEED;
  stalker.zoneSightRange = zoneAI.sightRange || STALKER_CONFIG.BASE_SIGHT_RANGE;
  stalker.zoneHearingRange = zoneAI.hearingRange || STALKER_CONFIG.BASE_HEARING_RANGE;
  stalker.zoneSightCone = zoneAI.sightCone || STALKER_CONFIG.BASE_SIGHT_CONE;
  stalker.zonePredictive = zoneAI.predictive || false;
  stalker.patrolNodes = zoneAI.patrolNodes || [];
  
  // Update sensory perception
  stalker.hasLineOfSight = checkLineOfSight(stalker, player, tileAt);
  stalker.canHearPlayer = checkHearing(stalker, player, player.lastMoveTick > tick - 10);
  
  // Update detection confidence
  if (stalker.hasLineOfSight) {
    stalker.detectionConfidence = Math.min(1, stalker.detectionConfidence + 0.1);
  } else {
    stalker.detectionConfidence = Math.max(0, stalker.detectionConfidence - 0.02);
  }
  
  // Update sensory memory
  updateSensoryMemory(stalker, player, tick, player.lastMoveTick > tick - 10);
  
  // Update AI state
  updateAIState(stalker, player, tick);
  
  // Calculate movement speed based on state
  const speed = calculateStalkerSpeed(stalker, stalker.state);
  stalker.speed = speed;
  
  // Movement based on state
  let moved = false;
  const blockedTileList = blockedTiles || [1, 8, 14];
  
  switch (stalker.state) {
    case "chase":
      // Update path to player
      if (tick % STALKER_CONFIG.PATH_UPDATE_INTERVAL === 0) {
        updatePath(stalker, player, tileAt, blockedTileList);
      }
      
      // Move along path or directly toward player
      if (stalker.path.length > 0) {
        moved = moveStalkerAlongPath(stalker, tileAt);
      } else if (stalker.knownPlayerPosition) {
        moved = moveStalkerTowardTarget(stalker, stalker.knownPlayerPosition.x, stalker.knownPlayerPosition.y, tileAt);
      }
      break;
      
    case "search":
      // Move toward last known player position or noise
      if (stalker.knownPlayerPosition) {
        moved = moveStalkerTowardTarget(stalker, stalker.knownPlayerPosition.x, stalker.knownPlayerPosition.y, tileAt);
      } else if (stalker.recentNoises.length > 0) {
        const noise = stalker.recentNoises[0];
        moved = moveStalkerTowardTarget(stalker, noise.x, noise.y, tileAt);
      }
      break;
      
    case "patrol":
      // Follow patrol nodes
      moved = moveStalkerPatrol(stalker, tileAt);
      break;
      
    case "wait":
      // Don't move
      break;
  }
  
  // Smooth visual position
  smoothStalkerPosition(stalker);
  
  // Update effects
  if (stalker.reflectTimer > 0) stalker.reflectTimer--;
  if (stalker.confused) {
    stalker.confusedTimer--;
    if (stalker.confusedTimer <= 0) stalker.confused = false;
  }
  
  // Check if caught player
  const dx = player.x - stalker.x;
  const dy = player.y - stalker.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  if (distance < STALKER_CONFIG.CATCH_RADIUS && !player.hide) {
    return { caught: true };
  }
  
  return { caught: false };
}

// ── Stalker Creation ─────────────────────────────────────────────────────────

export function createStalker(spawnPosition, zoneAI) {
  const stalker = createStalkerState(spawnPosition);
  
  // Apply zone-specific parameters
  if (zoneAI) {
    stalker.zoneSpeed = zoneAI.speed || STALKER_CONFIG.BASE_SPEED;
    stalker.zoneSightRange = zoneAI.sightRange || STALKER_CONFIG.BASE_SIGHT_RANGE;
    stalker.zoneHearingRange = zoneAI.hearingRange || STALKER_CONFIG.BASE_HEARING_RANGE;
    stalker.zoneSightCone = zoneAI.sightCone || STALKER_CONFIG.BASE_SIGHT_CONE;
    stalker.zonePredictive = zoneAI.predictive || false;
    stalker.patrolNodes = zoneAI.patrolNodes || [];
  }
  
  return stalker;
}

// ── Helper Functions ───────────────────────────────────────────────────────────

export function getStalkerFacing(stalker) {
  return stalker.facing;
}

export function getStalkerPosition(stalker) {
  return { x: stalker.x, y: stalker.y };
}

export function getStalkerRenderPosition(stalker) {
  return { x: stalker.renderX, y: stalker.renderY };
}

export function isStalkerConfused(stalker) {
  return stalker.confused;
}

export function confuseStalker(stalker, duration) {
  stalker.confused = true;
  stalker.confusedTimer = duration;
  stalker.knownPlayerPosition = null;
  stalker.path = [];
}

export function noteStalkerHideSpot(stalker, x, y) {
  // Stalker remembers where player can hide
  stalker.knownHideSpots = stalker.knownHideSpots || [];
  const key = `${x},${y}`;
  if (!stalker.knownHideSpots.includes(key)) {
    stalker.knownHideSpots.push(key);
  }
}

export function noteStalkerPathSpot(stalker, x, y) {
  // Stalker remembers where player has walked
  stalker.knownPathSpots = stalker.knownPathSpots || [];
  const key = `${x},${y}`;
  if (!stalker.knownPathSpots.includes(key)) {
    stalker.knownPathSpots.push(key);
  }
}
