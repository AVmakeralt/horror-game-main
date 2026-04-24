import { createPlayer, stepPlayer } from "./player.js";
import {
  createStalker,
  getDisplayedStalkerPosition,
  noteHideSpot,
  notePathSpot,
  stepStalker,
} from "./stalker.js";
import {
  addTransformation,
  createTransformState,
  getTransformationLabels,
  getTransformationStacks,
  reverseReversibleTransformations,
  totalTransformationBurden,
  TRANSFORM_TYPES,
  updateTransformations,
} from "./transform.js";
import {
  drawNumberGridSprite,
  MONSTER_FRAMES,
  STALKER_FRAMES,
  pickAnimationFrame,
  PLAYER_FEAR_FRAMES,
  PLAYER_FRAMES,
} from "./number-grid-sprites.js";
import { TileRenderer, LightingSystem, ParticleSystem, PALETTE } from "./art-system.js";
import {
  GAMEPLAY_CONFIG,
  createPlayerState,
  createInputState,
  handleKeyDown,
  handleKeyUp,
  updatePlayer as updatePlayerGameplay,
  updateTransformations as updateTransformationsGameplay,
  collectKey,
  checkWinCondition,
  checkLoseCondition,
  progressToNextZone,
  isExitTile,
  isFakeExitTile,
  isKeyTile,
} from "./gameplay.js";
import {
  STALKER_CONFIG,
  createStalker as createStalkerAI,
  createStalkerState,
  updateStalker as updateStalkerAI,
  updateAIState,
  updateSensoryMemory,
  checkLineOfSight as checkLineOfSightAI,
  checkHearing as checkHearingAI,
  findPath,
  updatePath,
  calculateStalkerSpeed,
  canStalkerMoveTo,
  moveStalkerTowardTarget,
  moveStalkerPatrol,
  moveStalkerAlongPath,
  smoothStalkerPosition,
  getStalkerFacing,
  getStalkerPosition,
  getStalkerRenderPosition,
  isStalkerConfused,
  confuseStalker,
  noteStalkerHideSpot,
  noteStalkerPathSpot,
} from "./stalker-ai.js";

const TILE = 64;
const CHALLENGE_MODE = true;
const CHALLENGE_MULTIPLIER = CHALLENGE_MODE ? 1.5 : 1;

const SPRITE_SHEET_PATHS = {
  playerWalk: "../player - walk cycle.png",
  playerIdle: "../player - idle.png",
  playerSitting: "../player - sitting.png",
  playerDeath: "../player - death.png",
  playerScared: "../scared - scared.png",
  stalker: "../stalker.png",
  tiles: "../Tileset_Large.png",
};

const PLAYER_ANIM_FPS = 10;
const PLAYER_SCARED_FPS = 12;
const PLAYER_IDLE_TIMEOUT = 22;
const STALKER_ANIM_FPS = 8;

// Tiles:
//  0 floor          1 wall          2 hide spot       3 ink (corruption)
//  4 corruption     5 exit          6 moved furniture  7 collapse
//  8 block/tape     9 locked        10 hallucination   11 mirror clone
// 12 reversal/safe 13 tiny hazard  14 interact door   15 interact drawer
// 16 FAKE EXIT      17 NOTE/DOCUMENT
// 18 ACID POOL      19 RITUAL CIRCLE  20 VENT/CRAWLSPACE  21 STATIC TV
// 22 CRACKED FLOOR  23 MEDICINE CABINET
// Map size: 28 cols × 10 rows = 280 tiles. Canvas must be 1792×640 at TILE=64.

const ZONES = [
  {
    id: "entrance", name: "Entrance Hall",
    stalkerSpawn: { x: 26, y: 1 },
    ai: { speed: 1, sightRange: 5, hearingRange: 4, sightCone: Math.PI / 3, catchRadius: 1, predictive: false, hallucinationInterference: false, patrolNodes: [{ x: 24, y: 1 }, { x: 20, y: 5 }, { x: 9, y: 1 }] },
    hazards: { flicker: true },
    entryText: "Something is already inside.",
  },
  {
    id: "hallway", name: "The Corridor",
    stalkerSpawn: { x: 26, y: 1 },
    ai: { speed: 1, sightRange: 5, hearingRange: 4, sightCone: Math.PI / 3, catchRadius: 1, predictive: false, hallucinationInterference: false, patrolNodes: [{ x: 24, y: 5 }, { x: 14, y: 4 }, { x: 2, y: 1 }] },
    hazards: { flicker: true },
    entryText: "The hallway stretches. It watches you measure it.",
  },
  {
    id: "living", name: "Living Room",
    stalkerSpawn: { x: 26, y: 1 },
    ai: { speed: 1, sightRange: 6, hearingRange: 5, sightCone: Math.PI / 3, catchRadius: 1, predictive: false, hallucinationInterference: false, patrolNodes: [{ x: 24, y: 4 }, { x: 14, y: 5 }, { x: 4, y: 5 }] },
    hazards: { flicker: true, migration: true },
    entryText: "Furniture has moved since yesterday.",
  },
  {
    id: "bathroom", name: "Bathroom",
    stalkerSpawn: { x: 26, y: 1 },
    forcedCorruption: true,
    ai: { speed: 1, sightRange: 5, hearingRange: 6, sightCone: Math.PI / 2.8, catchRadius: 1, predictive: false, hallucinationInterference: true, patrolNodes: [{ x: 24, y: 1 }, { x: 13, y: 4 }, { x: 2, y: 8 }] },
    hazards: { flicker: true },
    entryText: "Don't look at the mirror for too long.",
  },
  {
    id: "kitchen", name: "Kitchen",
    stalkerSpawn: { x: 26, y: 1 },
    forcedCorruption: true,
    ai: { speed: 2, sightRange: 6, hearingRange: 7, sightCone: Math.PI / 3, catchRadius: 1, predictive: true, hallucinationInterference: false, patrolNodes: [{ x: 25, y: 4 }, { x: 16, y: 1 }, { x: 3, y: 4 }] },
    hazards: { flicker: true, migration: true, lockDoors: true },
    entryText: "It smells wrong. The knives are all in different places.",
  },
  {
    id: "storage", name: "Storage Room",
    stalkerSpawn: { x: 26, y: 1 },
    forcedCorruption: true,
    ai: { speed: 2, sightRange: 6, hearingRange: 6, sightCone: Math.PI / 3, catchRadius: 1, predictive: true, hallucinationInterference: false, patrolNodes: [{ x: 24, y: 7 }, { x: 13, y: 4 }, { x: 2, y: 1 }] },
    hazards: { flicker: true, migration: true, collapse: true },
    entryText: "Boxes have been moved. Something hid in here recently.",
  },
  {
    id: "library", name: "Office / Library",
    stalkerSpawn: { x: 26, y: 1 },
    ai: { speed: 2, sightRange: 6, hearingRange: 5, sightCone: Math.PI / 3.2, catchRadius: 1, predictive: true, hallucinationInterference: false, patrolNodes: [{ x: 22, y: 7 }, { x: 11, y: 4 }, { x: 2, y: 1 }] },
    hazards: { flicker: true, lockDoors: true },
    entryText: "Notes everywhere. Someone was studying it.",
  },
  {
    id: "bedroom", name: "Bedroom",
    stalkerSpawn: { x: 26, y: 1 },
    ai: { speed: 2, sightRange: 7, hearingRange: 6, sightCone: Math.PI / 3.4, catchRadius: 1, predictive: true, hallucinationInterference: true, patrolNodes: [{ x: 25, y: 1 }, { x: 10, y: 7 }, { x: 2, y: 1 }] },
    hazards: { flicker: true, lockDoors: true, phantoms: true },
    entryText: "The bed is made. Nobody made it.",
  },
  {
    id: "laundry", name: "Laundry Room",
    stalkerSpawn: { x: 26, y: 1 },
    forcedCorruption: true,
    ai: { speed: 2, sightRange: 7, hearingRange: 7, sightCone: Math.PI / 3.2, catchRadius: 1, predictive: true, hallucinationInterference: true, patrolNodes: [{ x: 24, y: 7 }, { x: 13, y: 4 }, { x: 2, y: 1 }] },
    hazards: { flicker: true, migration: true, phantoms: true },
    entryText: "The machines are on. No one started them.",
  },
  {
    id: "attic", name: "Attic",
    stalkerSpawn: { x: 26, y: 1 },
    forcedCorruption: true,
    ai: { speed: 2, sightRange: 8, hearingRange: 7, sightCone: Math.PI / 3.5, catchRadius: 2, predictive: true, hallucinationInterference: true, patrolNodes: [{ x: 22, y: 1 }, { x: 14, y: 5 }, { x: 5, y: 1 }] },
    hazards: { flicker: true, migration: true, collapse: true, lockDoors: true, phantoms: true },
    entryText: "The attic breathes. The floor disagrees with your weight.",
  },
  {
    id: "basement", name: "Basement",
    stalkerSpawn: { x: 26, y: 1 },
    forcedCorruption: true,
    ai: { speed: 3, sightRange: 9, hearingRange: 9, sightCone: Math.PI / 4, catchRadius: 2, predictive: true, hallucinationInterference: true, patrolNodes: [{ x: 25, y: 7 }, { x: 16, y: 3 }, { x: 5, y: 7 }] },
    hazards: { flicker: true, migration: true, collapse: true, lockDoors: true, phantoms: true },
    entryText: "Below everything. You hear it breathing before you see it.",
  },
  {
    id: "backyard", name: "Backyard / Exit",
    stalkerSpawn: { x: 26, y: 1 },
    ai: { speed: 3, sightRange: 9, hearingRange: 8, sightCone: Math.PI / 4, catchRadius: 2, predictive: true, hallucinationInterference: true, patrolNodes: [{ x: 25, y: 1 }, { x: 13, y: 4 }, { x: 2, y: 7 }] },
    hazards: { flicker: true, migration: true, collapse: true, phantoms: true },
    entryText: "Almost out. It knows. There are two green doors.",
  },
  {
    id: "greenhouse", name: "Greenhouse",
    stalkerSpawn: { x: 26, y: 1 },
    forcedCorruption: true,
    ai: { speed: 2, sightRange: 7, hearingRange: 6, sightCone: Math.PI / 3.2, catchRadius: 1, predictive: true, hallucinationInterference: true, patrolNodes: [{ x: 22, y: 3 }, { x: 12, y: 6 }, { x: 3, y: 2 }] },
    hazards: { flicker: true, migration: true, phantoms: true },
    entryText: "The plants are moving. They weren't like this yesterday.",
  },
  {
    id: "garage", name: "Garage",
    stalkerSpawn: { x: 26, y: 1 },
    ai: { speed: 2, sightRange: 6, hearingRange: 7, sightCone: Math.PI / 3, catchRadius: 1, predictive: true, hallucinationInterference: false, patrolNodes: [{ x: 24, y: 5 }, { x: 14, y: 2 }, { x: 4, y: 7 }] },
    hazards: { flicker: true, collapse: true },
    entryText: "The car won't start. It never will again.",
  },
  {
    id: "winecellar", name: "Wine Cellar",
    stalkerSpawn: { x: 26, y: 1 },
    forcedCorruption: true,
    ai: { speed: 2, sightRange: 8, hearingRange: 8, sightCone: Math.PI / 3.5, catchRadius: 2, predictive: true, hallucinationInterference: true, patrolNodes: [{ x: 23, y: 6 }, { x: 13, y: 3 }, { x: 2, y: 7 }] },
    hazards: { flicker: true, lockDoors: true, phantoms: true },
    entryText: "The bottles are empty. But they weren't before.",
  },
  {
    id: "chapel", name: "Chapel",
    stalkerSpawn: { x: 26, y: 1 },
    ai: { speed: 1, sightRange: 5, hearingRange: 5, sightCone: Math.PI / 2.5, catchRadius: 1, predictive: false, hallucinationInterference: true, patrolNodes: [{ x: 22, y: 4 }, { x: 14, y: 7 }, { x: 4, y: 4 }] },
    hazards: { flicker: true, phantoms: true },
    entryText: "The candles burn without flame. Prayers go unanswered.",
  },
  {
    id: "dungeon", name: "Dungeon",
    stalkerSpawn: { x: 26, y: 1 },
    forcedCorruption: true,
    ai: { speed: 3, sightRange: 10, hearingRange: 10, sightCone: Math.PI / 4, catchRadius: 2, predictive: true, hallucinationInterference: true, patrolNodes: [{ x: 24, y: 7 }, { x: 16, y: 2 }, { x: 5, y: 7 }] },
    hazards: { flicker: true, collapse: true, lockDoors: true, phantoms: true },
    entryText: "Something was kept down here. It still is.",
  },
  {
    id: "observatory", name: "Observatory",
    stalkerSpawn: { x: 26, y: 1 },
    ai: { speed: 2, sightRange: 9, hearingRange: 6, sightCone: Math.PI / 3, catchRadius: 1, predictive: true, hallucinationInterference: false, patrolNodes: [{ x: 21, y: 2 }, { x: 11, y: 5 }, { x: 3, y: 8 }] },
    hazards: { flicker: true, migration: true },
    entryText: "The stars are wrong tonight. They've always been wrong.",
  },
  {
    id: "nursery", name: "Nursery",
    stalkerSpawn: { x: 26, y: 1 },
    ai: { speed: 2, sightRange: 7, hearingRange: 8, sightCone: Math.PI / 3.3, catchRadius: 1, predictive: true, hallucinationInterference: true, patrolNodes: [{ x: 23, y: 3 }, { x: 13, y: 6 }, { x: 4, y: 2 }] },
    hazards: { flicker: true, phantoms: true },
    entryText: "The crib rocks by itself. The baby hasn't cried in years.",
  },
  {
    id: "ballroom", name: "Ballroom",
    stalkerSpawn: { x: 26, y: 1 },
    ai: { speed: 2, sightRange: 8, hearingRange: 7, sightCone: Math.PI / 3, catchRadius: 1, predictive: true, hallucinationInterference: true, patrolNodes: [{ x: 22, y: 5 }, { x: 14, y: 2 }, { x: 4, y: 7 }] },
    hazards: { flicker: true, migration: true, phantoms: true },
    entryText: "The music plays when no one is there. It never stops.",
  },
  {
    id: "laboratory", name: "Laboratory",
    stalkerSpawn: { x: 26, y: 1 },
    forcedCorruption: true,
    ai: { speed: 3, sightRange: 9, hearingRange: 9, sightCone: Math.PI / 3.5, catchRadius: 2, predictive: true, hallucinationInterference: true, patrolNodes: [{ x: 24, y: 4 }, { x: 15, y: 7 }, { x: 5, y: 3 }] },
    hazards: { flicker: true, collapse: true, lockDoors: true },
    entryText: "The experiments got out. They're still getting out.",
  },
  {
    id: "catacombs", name: "Catacombs",
    stalkerSpawn: { x: 26, y: 1 },
    forcedCorruption: true,
    ai: { speed: 3, sightRange: 10, hearingRange: 10, sightCone: Math.PI / 4, catchRadius: 2, predictive: true, hallucinationInterference: true, patrolNodes: [{ x: 23, y: 6 }, { x: 14, y: 2 }, { x: 3, y: 7 }] },
    hazards: { flicker: true, collapse: true, phantoms: true },
    entryText: "The dead don't stay down here. They walk upstairs.",
  },
  {
    id: "clocktower", name: "Clock Tower",
    stalkerSpawn: { x: 26, y: 1 },
    ai: { speed: 2, sightRange: 8, hearingRange: 7, sightCone: Math.PI / 3.2, catchRadius: 1, predictive: true, hallucinationInterference: false, patrolNodes: [{ x: 21, y: 3 }, { x: 12, y: 6 }, { x: 4, y: 2 }] },
    hazards: { flicker: true, migration: true },
    entryText: "Time moves wrong here. Sometimes it goes backwards.",
  },
  {
    id: "fountainroom", name: "Fountain Room",
    stalkerSpawn: { x: 26, y: 1 },
    ai: { speed: 2, sightRange: 7, hearingRange: 8, sightCone: Math.PI / 3.3, catchRadius: 1, predictive: true, hallucinationInterference: true, patrolNodes: [{ x: 22, y: 4 }, { x: 13, y: 7 }, { x: 5, y: 3 }] },
    hazards: { flicker: true, phantoms: true },
    entryText: "The water flows uphill. Don't drink from it.",
  },
  {
    id: "armory", name: "Armory",
    stalkerSpawn: { x: 26, y: 1 },
    ai: { speed: 2, sightRange: 6, hearingRange: 6, sightCone: Math.PI / 3, catchRadius: 1, predictive: true, hallucinationInterference: false, patrolNodes: [{ x: 24, y: 5 }, { x: 15, y: 2 }, { x: 4, y: 7 }] },
    hazards: { flicker: true, lockDoors: true },
    entryText: "The weapons are rusted through. But they still work.",
  },
  {
    id: "greenhouse2", name: "Overgrown Garden",
    stalkerSpawn: { x: 26, y: 1 },
    forcedCorruption: true,
    ai: { speed: 3, sightRange: 8, hearingRange: 7, sightCone: Math.PI / 3.5, catchRadius: 2, predictive: true, hallucinationInterference: true, patrolNodes: [{ x: 23, y: 4 }, { x: 14, y: 7 }, { x: 5, y: 2 }] },
    hazards: { flicker: true, migration: true, phantoms: true },
    entryText: "The vines grab at your ankles. They're hungry.",
  },
  {
    id: "mirrorhall", name: "Hall of Mirrors",
    stalkerSpawn: { x: 26, y: 1 },
    ai: { speed: 2, sightRange: 9, hearingRange: 6, sightCone: Math.PI / 3, catchRadius: 1, predictive: true, hallucinationInterference: true, patrolNodes: [{ x: 22, y: 5 }, { x: 13, y: 2 }, { x: 4, y: 7 }] },
    hazards: { flicker: true, phantoms: true },
    entryText: "Every reflection shows something different. None are you.",
  },
  {
    id: "icecave", name: "Ice Cave",
    stalkerSpawn: { x: 26, y: 1 },
    ai: { speed: 2, sightRange: 7, hearingRange: 8, sightCone: Math.PI / 3.4, catchRadius: 1, predictive: true, hallucinationInterference: false, patrolNodes: [{ x: 21, y: 3 }, { x: 12, y: 6 }, { x: 4, y: 2 }] },
    hazards: { flicker: true, collapse: true },
    entryText: "The ice cracks underfoot. Something is trapped inside.",
  },
  {
    id: "lava", name: "Research Chamber",
    stalkerSpawn: { x: 26, y: 1 },
    forcedCorruption: true,
    ai: { speed: 3, sightRange: 10, hearingRange: 10, sightCone: Math.PI / 4, catchRadius: 2, predictive: true, hallucinationInterference: true, patrolNodes: [{ x: 24, y: 6 }, { x: 15, y: 3 }, { x: 5, y: 7 }] },
    hazards: { flicker: true, collapse: true, lockDoors: true, phantoms: true },
    entryText: "The experiments continue. The equipment hums with purpose.",
  },
  {
    id: "void", name: "The Void",
    stalkerSpawn: { x: 26, y: 1 },
    forcedCorruption: true,
    ai: { speed: 4, sightRange: 12, hearingRange: 12, sightCone: Math.PI / 3, catchRadius: 3, predictive: true, hallucinationInterference: true, patrolNodes: [{ x: 25, y: 4 }, { x: 14, y: 7 }, { x: 3, y: 3 }] },
    hazards: { flicker: true, migration: true, collapse: true, lockDoors: true, phantoms: true },
    entryText: "There is nothing here. And that's the problem.",
  },
];

// ── 8 KEY LOCATIONS: one per zone 0–7, required before exit unlocks ─────────
// Each entry: { zoneIndex, x, y }
const KEY_LOCATIONS = [
  { zoneIndex: 0, x: 4,  y: 8 },   // Entrance — near bottom-left alcove
  { zoneIndex: 1, x: 22, y: 1 },   // Corridor — far upper-right room
  { zoneIndex: 2, x: 5,  y: 7 },   // Living — bottom-left corner
  { zoneIndex: 3, x: 19, y: 8 },   // Bathroom — behind mirror room
  { zoneIndex: 4, x: 13, y: 1 },   // Kitchen — upper prep area
  { zoneIndex: 5, x: 22, y: 8 },   // Storage — deep dead-end
  { zoneIndex: 6, x: 8,  y: 7 },   // Library — lower stacks
  { zoneIndex: 7, x: 24, y: 4 },   // Bedroom — far corner
];
const TOTAL_KEYS = KEY_LOCATIONS.length; // 8

// Tile 24 = KEY ITEM
// ─────────────────────────────────────────────────────────────────────────────

function buildZoneMap(zoneIndex) {
  const w = 32;  // Width optimized for MCTS
  const h = 10;  // Height optimized for MCTS
  const map = new Array(w * h).fill(1);
  const set  = (x, y, t) => { if (x >= 0 && y >= 0 && x < w && y < h) map[y * w + x] = t; };
  const carve = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) set(x, y, 0);
  };
  const door  = (x, y) => set(x, y, 14);
  const obj   = (x, y, t) => set(x, y, t);

  // Player spawns at (2, 5); exit on the right edge.

  switch (zoneIndex) {

    // ── ZONE 0: Entrance Hall ──────────────────────────────────────────────
    // Wide open central spine with furniture islands and objects all around
    case 0: {
      carve(1, 1, 30, 8);               // fully open hall
      // Furniture islands and pillars throughout
      for (const [px, py] of [
        [5,2],[5,6],[10,3],[10,5],[10,7],
        [15,2],[15,4],[15,6],[15,8],
        [20,3],[20,5],[20,7],
        [25,2],[25,4],[25,6],[25,8]
      ]) set(px, py, 1);
      obj(2, 5, 12);                    // safe spawn tile
      // Many objects all around the room - furniture, decorations, interactables
      obj(3, 2, 2);   obj(4, 7, 2);     obj(6, 3, 15);   obj(7, 6, 15);
      obj(9, 2, 17);  obj(11, 7, 17);   obj(13, 3, 2);   obj(14, 6, 2);
      obj(16, 2, 20); obj(17, 7, 20);   obj(19, 4, 15);  obj(21, 5, 17);
      obj(23, 2, 2);  obj(24, 7, 2);    obj(26, 3, 19);  obj(28, 6, 21);
      obj(3, 5, 11);  obj(8, 4, 11);    obj(12, 7, 23);  obj(18, 3, 18);
      obj(22, 6, 22); obj(27, 4, 24);   obj(29, 7, 12);
      set(30, 5, 5);                    // exit
      break;
    }

    // ── ZONE 1: The Corridor ───────────────────────────────────────────────
    // Two long parallel corridors with vertical shafts and objects everywhere
    case 1: {
      carve(1, 1, 30, 3);                // top corridor
      carve(1, 6, 30, 8);                // bottom corridor
      // Vertical shafts connecting them with objects
      for (let sx = 6; sx <= 26; sx += 5) {
        carve(sx, 3, sx, 6);
        obj(sx, 4, 15);  // objects in shafts
        obj(sx, 5, 17);
      }
      obj(2, 5, 12);
      // Objects along corridors
      obj(3, 2, 2);   obj(5, 7, 2);     obj(8, 2, 15);   obj(10, 7, 15);
      obj(13, 2, 17); obj(16, 7, 17);   obj(19, 2, 2);   obj(22, 7, 2);
      obj(25, 2, 20); obj(28, 7, 20);   obj(4, 5, 21);   obj(14, 5, 19);
      obj(24, 5, 22); obj(7, 1, 23);    obj(17, 8, 24);
      set(30, 2, 5);
      break;
    }

    // ── ZONE 2: Living Room ─────────────────────────────────────────────────
    // Open plan with furniture islands and objects scattered throughout
    case 2: {
      carve(1, 1, 30, 8);
      // Furniture island clusters
      for (let x = 5; x <= 12; x++) set(x, 3, 1);
      for (let x = 16; x <= 23; x++) set(x, 5, 1);
      for (let x = 8; x <= 10; x++) set(x, 7, 1);
      for (let x = 20; x <= 22; x++) set(x, 2, 1);
      // Doors through furniture
      set(9, 3, 0); set(19, 5, 0);
      obj(2, 5, 12);
      // Objects all around furniture and corners
      obj(3, 2, 2);   obj(4, 7, 2);     obj(6, 5, 15);   obj(11, 2, 17);
      obj(13, 7, 2);  obj(15, 3, 20);   obj(18, 6, 15);  obj(21, 2, 17);
      obj(24, 7, 2);  obj(26, 3, 19);   obj(28, 5, 21);  obj(3, 6, 11);
      obj(7, 3, 22);  obj(14, 6, 23);   obj(22, 4, 24);  obj(29, 7, 12);
      set(30, 5, 5);
      break;
    }

    // ── ZONE 3: Bathroom ────────────────────────────────────────────────────
    // Grid of small rooms with objects in each
    case 3: {
      carve(1, 1, 30, 8);
      // Interior walls forming grid
      for (let x = 8; x <= 28; x++) set(x, 3, 1);
      for (let x = 8; x <= 28; x++) set(x, 6, 1);
      for (const cx of [10, 18, 25]) {
        for (let y = 1; y <= 8; y++) set(cx, y, 1);
      }
      // Doors
      door(9, 3);  door(17, 3);  door(24, 3);
      door(9, 6);  door(17, 6);  door(24, 6);
      door(10, 2); door(10, 5);  door(10, 7);
      door(18, 2); door(18, 5);  door(18, 7);
      door(25, 2); door(25, 5);  door(25, 7);
      obj(2, 5, 12);
      // Objects in each room
      obj(3, 2, 2);   obj(5, 7, 2);     obj(12, 2, 15);  obj(14, 7, 15);
      obj(20, 2, 17); obj(22, 7, 17);   obj(27, 2, 2);   obj(29, 7, 2);
      obj(4, 4, 11);  obj(13, 5, 20);   obj(21, 4, 21);  obj(28, 5, 22);
      obj(6, 3, 23);  obj(15, 6, 24);   obj(23, 3, 19);
      set(30, 5, 5);
      break;
    }

    // ── ZONE 4: Kitchen ─────────────────────────────────────────────────────
    // Central counter-island with objects around perimeter
    case 4: {
      carve(1, 1, 30, 8);
      // Central island
      for (let x = 10; x <= 22; x++) for (let y = 3; y <= 5; y++) set(x, y, 1);
      // Island pass-throughs
      set(13, 3, 0); set(17, 3, 0); set(20, 5, 0);
      obj(2, 5, 12);
      // Objects around island and edges
      obj(3, 2, 2);   obj(4, 7, 2);     obj(6, 3, 15);   obj(8, 6, 15);
      obj(10, 2, 17); obj(12, 7, 17);   obj(22, 2, 2);   obj(24, 7, 2);
      obj(26, 3, 20); obj(28, 6, 20);   obj(5, 5, 21);   obj(15, 6, 19);
      obj(25, 4, 22); obj(7, 2, 23);    obj(18, 7, 24);  obj(29, 3, 12);
      set(30, 5, 5);
      break;
    }

    // ── ZONE 5: Storage Room ────────────────────────────────────────────────
    // Maze with objects in dead ends
    case 5: {
      carve(1, 1, 2, 8);
      carve(1, 1, 10, 2);
      carve(10, 1, 10, 4);
      carve(5, 4, 15, 5);
      carve(15, 3, 15, 7);
      carve(10, 7, 25, 8);
      carve(25, 5, 25, 8);
      carve(20, 5, 30, 6);
      carve(20, 3, 20, 5);
      carve(25, 1, 30, 2);
      obj(2, 5, 12);
      // Objects in dead ends and corners
      obj(8, 2, 2);   obj(13, 5, 15);   obj(17, 7, 17);  obj(23, 8, 2);
      obj(28, 2, 20); obj(5, 6, 21);    obj(12, 3, 22);  obj(19, 4, 23);
      obj(27, 5, 24); obj(4, 3, 19);    obj(9, 7, 11);   obj(16, 2, 2);
      obj(22, 6, 15); obj(29, 7, 12);
      set(30, 5, 5);
      break;
    }

    // ── ZONE 6: Library ─────────────────────────────────────────────────────
    // Bookshelf rows with objects between shelves
    case 6: {
      carve(1, 1, 30, 8);
      // Bookshelf rows
      for (let x = 5; x <= 28; x++) set(x, 2, 1);
      for (let x = 5; x <= 28; x++) set(x, 5, 1);
      for (let x = 5; x <= 28; x++) set(x, 8, 1);
      // Gaps in shelves
      set(10, 2, 0); set(18, 2, 0); set(25, 2, 0);
      set(8, 5, 0);  set(16, 5, 0); set(23, 5, 0);
      set(12, 8, 0); set(20, 8, 0); set(27, 8, 0);
      obj(2, 5, 12);
      // Books and objects everywhere
      obj(3, 3, 2);   obj(4, 6, 2);     obj(6, 4, 15);   obj(9, 7, 15);
      obj(11, 3, 17); obj(14, 6, 17);   obj(17, 3, 2);   obj(20, 6, 2);
      obj(23, 3, 20); obj(26, 6, 20);   obj(29, 4, 21);  obj(5, 7, 22);
      obj(13, 4, 23); obj(21, 7, 24);   obj(28, 3, 19);  obj(7, 5, 11);
      obj(15, 3, 2);  obj(24, 6, 12);
      set(30, 5, 5);
      break;
    }

    // ── ZONE 7: Bedroom ─────────────────────────────────────────────────────
    // Bed and furniture with objects scattered around
    case 7: {
      carve(1, 1, 30, 8);
      // Bed and large furniture
      for (let x = 8; x <= 14; x++) for (let y = 2; y <= 4; y++) set(x, y, 1);
      for (let x = 20; x <= 26; x++) for (let y = 5; y <= 7; y++) set(x, y, 1);
      for (let x = 5; x <= 7; x++) set(x, 6, 1);
      for (let x = 25; x <= 28; x++) set(x, 2, 1);
      // Gaps
      set(11, 2, 0); set(23, 5, 0);
      obj(2, 5, 12);
      // Personal items and objects all around
      obj(3, 3, 2);   obj(4, 7, 2);     obj(6, 4, 15);   obj(9, 6, 15);
      obj(12, 3, 17); obj(15, 7, 17);   obj(18, 3, 2);   obj(21, 6, 2);
      obj(24, 3, 20); obj(27, 7, 20);   obj(3, 6, 21);   obj(16, 4, 22);
      obj(19, 7, 23); obj(29, 4, 24);   obj(5, 3, 19);   obj(10, 7, 11);
      obj(14, 5, 2);  obj(22, 3, 12);   obj(28, 6, 2);
      set(30, 5, 5);
      break;
    }

    case 9: {
      carve(1, 1, 4, 8);             // left spine
      carve(1, 4, 26, 5);           // center spoke
      carve(23, 1, 26, 8);          // right spine
      carve(5, 1, 12, 1);           // top-left branch
      carve(5, 8, 12, 8);           // bottom-left branch
      carve(15, 1, 22, 1);          // top-right branch
      carve(15, 8, 22, 8);          // bottom-right branch
      carve(8, 1, 8, 4);            // upper-left drop
      carve(19, 1, 19, 4);          // upper-right drop
      carve(8, 5, 8, 8);            // lower-left drop
      carve(19, 5, 19, 8);          // lower-right drop
      // Blocked center tape (late-game pressure)
      for (let x = 7; x <= 55; x += 1) set(x, 4, 8);
      for (let x = 7; x <= 55; x += 1) set(x, 5, 8);
      obj(2, 1, 12);
      obj(3, 6, 2);   obj(24, 3, 2);
      obj(7, 1, 17);  obj(21, 8, 17);
      obj(6, 4, 15);  obj(22, 5, 15);
      obj(11, 1, 13); obj(16, 8, 13); // tiny hazards
      obj(4, 4, 19);  // ritual circle
      set(58, 4, 5);
      break;
    }

    // ── ZONE 10: Basement ───────────────────────────────────────────────────
    // Dungeon chambers connected by 1-wide passages.
    case 10: {
      carve(1, 1, 5, 3);            // chamber A (spawn)
      carve(1, 6, 5, 8);            // chamber B
      carve(8, 2, 13, 4);           // chamber C
      carve(8, 6, 13, 8);           // chamber D
      carve(16, 1, 21, 3);          // chamber E
      carve(16, 5, 21, 8);          // chamber F
      carve(23, 1, 26, 8);          // right spine (exit side)
      // 1-wide passages
      carve(1, 4, 1, 5);            // A→B
      carve(5, 2, 8, 2);            // A→C passage
      carve(5, 7, 8, 7);            // B→D passage
      carve(13, 3, 16, 3);          // C→E
      carve(13, 7, 16, 7);          // D→F
      carve(21, 2, 23, 2);          // E→right spine
      carve(21, 6, 23, 6);          // F→right spine
      door(5, 2); door(13, 3); door(21, 2);
      door(5, 7); door(13, 7); door(21, 6);
      obj(2, 1, 12);
      obj(3, 7, 2);   obj(18, 2, 2);  obj(25, 5, 2);
      obj(10, 3, 17); obj(9, 7, 17);
      obj(20, 7, 17);
      obj(12, 4, 18); // acid pool in passage
      obj(17, 6, 19); // ritual circle
      obj(24, 3, 16); // fake exit
      obj(4, 6, 13);  // tiny hazard
      set(58, 4, 5);
      break;
    }

    // ── ZONE 11: Backyard / Exit ─────────────────────────────────────────────
    // Open, but three wall-islands block direct path.  True exit visible.
    case 11: {
      carve(1, 1, 58, 28);
      // Three obstacle islands
      for (let x = 7; x <= 55;   x++) for (let y = 2; y <= 7; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 1; y <= 5; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 3; y <= 8; y++) set(x, y, 1);
      // Gaps through islands
      set(7, 7, 0);   // bottom gap island 1
      set(14, 6, 0);  // bottom gap island 2
      set(21, 2, 0);  // top gap island 3
      obj(2, 1, 12);
      obj(3, 5, 2);   obj(18, 1, 2);  obj(25, 6, 2);
      obj(5, 8, 17);  obj(17, 7, 17);
      obj(10, 3, 22); // cracked floor
      obj(18, 5, 13); // tiny hazard
      obj(24, 1, 16); // fake exit
      set(58, 4, 5);   // true exit
      break;
    }

    // ── ZONE 12: Greenhouse ─────────────────────────────────────────────────
    // Plant maze with looping mirrors
    case 12: {
      carve(1, 1, 58, 28);
      // Plant islands forming maze
      for (let x = 7; x <= 55;  x++) for (let y = 2; y <= 6; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 1; y <= 4; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 5; y <= 7; y++) set(x, y, 1);
      // Narrow passages
      set(6, 4, 0); set(13, 3, 0); set(19, 6, 0);
      obj(2, 1, 12);
      obj(3, 3, 2);   obj(22, 5, 2);  obj(10, 7, 2);
      obj(5, 8, 17);  obj(15, 2, 17);
      obj(8, 5, 11);  // looping mirror
      obj(21, 3, 11); // looping mirror
      obj(12, 8, 20); // vent
      set(58, 4, 5);
      break;
    }

    // ── ZONE 13: Garage ─────────────────────────────────────────────────────
    // Large open space with car obstacles
    case 13: {
      carve(1, 1, 58, 28);
      // Car obstacle (large block)
      for (let x = 7; x <= 55; x++) for (let y = 3; y <= 5; y++) set(x, y, 1);
      // Shelving units
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 6; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 1; y <= 7; y++) set(x, y, 1);
      obj(2, 1, 12);
      obj(6, 4, 2);   obj(18, 4, 2);  obj(25, 3, 2);
      obj(8, 1, 15);  obj(20, 8, 15);
      obj(13, 4, 6);  // moved furniture (car)
      obj(7, 7, 17);  obj(21, 2, 17);
      obj(15, 8, 22); // cracked floor
      set(58, 4, 5);
      break;
    }

    // ── ZONE 14: Wine Cellar ────────────────────────────────────────────────
    // Grid of wine racks with secret passages
    case 14: {
      carve(1, 1, 58, 28);
      // Wine rack grid
      for (let x = 7; x <= 55; x += 4) {
        for (let y = 2; y <= 7; y += 2) {
          for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 1; dy++) set(x + dx, y + dy, 1);
        }
      }
      // Secret passages
      carve(6, 1, 6, 8); carve(14, 1, 14, 8); carve(22, 1, 22, 8);
      obj(2, 1, 12);
      obj(3, 4, 2);   obj(18, 6, 2);  obj(25, 4, 2);
      obj(5, 3, 15);  obj(15, 5, 15); obj(23, 2, 15);
      obj(10, 8, 17); obj(20, 7, 17);
      obj(12, 3, 19); // ritual circle
      obj(8, 6, 23);  // medicine cabinet
      set(58, 5, 5);
      break;
    }

    // ── ZONE 15: Chapel ──────────────────────────────────────────────────────
    // Religious space with pews and altar
    case 15: {
      carve(1, 1, 58, 28);
      // Pew rows
      for (let x = 7; x <= 55; x++) { set(x, 3, 1); set(x, 5, 1); set(x, 7, 1); }
      for (let x = 7; x <= 55; x++) { set(x, 3, 1); set(x, 5, 1); set(x, 7, 1); }
      // Altar platform
      for (let x = 7; x <= 55; x++) for (let y = 1; y <= 2; y++) set(x, y, 1);
      obj(2, 1, 12);
      obj(3, 4, 2);   obj(24, 6, 2);  obj(13, 8, 2);
      obj(7, 2, 17);  obj(20, 1, 17);
      obj(14, 1, 19); // ritual circle (altar)
      obj(13, 4, 10); // hallucination
      obj(9, 6, 11);  // mirror (confessional)
      set(58, 4, 5);
      break;
    }

    // ── ZONE 16: Dungeon ────────────────────────────────────────────────────
    // Torture chamber with cells
    case 16: {
      carve(1, 1, 58, 28);
      // Cell blocks
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 3; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 5; y <= 6; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 3; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 5; y <= 6; y++) set(x, y, 1);
      // Cell doors
      set(7, 4, 14); set(19, 4, 14);
      obj(2, 1, 12);
      obj(3, 7, 2);   obj(14, 4, 2);  obj(24, 7, 2);
      obj(5, 3, 15);  obj(22, 5, 15);
      obj(10, 2, 17); obj(16, 7, 17);
      obj(13, 6, 13); obj(14, 6, 13); // tiny hazards
      obj(8, 8, 18);  // acid pool
      set(58, 4, 5);
      break;
    }

    // ── ZONE 17: Observatory ────────────────────────────────────────────────
    // Circular room with telescope
    case 17: {
      carve(1, 1, 58, 28);
      // Central telescope platform
      for (let x = 7; x <= 55; x++) for (let y = 3; y <= 5; y++) set(x, y, 1);
      // Observation balcony
      for (let x = 7; x <= 55; x++) set(x, 1, 1);
      for (let x = 7; x <= 55; x++) set(x, 1, 1);
      obj(2, 1, 12);
      obj(4, 5, 2);   obj(22, 6, 2);  obj(13, 8, 2);
      obj(6, 3, 17);  obj(20, 2, 17);
      obj(14, 4, 21); // telescope (static TV)
      obj(10, 7, 11); // mirror
      set(58, 4, 5);
      break;
    }

    // ── ZONE 18: Nursery ──────────────────────────────────────────────────────
    // Creepy nursery with toys
    case 18: {
      carve(1, 1, 58, 28);
      // Crib area
      for (let x = 7; x <= 55; x++) for (let y = 1; y <= 2; y++) set(x, y, 1);
      // Toy chest
      for (let x = 7; x <= 55; x++) for (let y = 6; y <= 7; y++) set(x, y, 1);
      // Rocking chair area
      for (let x = 7; x <= 55; x++) for (let y = 3; y <= 5; y++) set(x, y, 1);
      obj(2, 1, 12);
      obj(3, 4, 2);   obj(18, 7, 2);  obj(24, 4, 2);
      obj(8, 2, 15);  obj(23, 6, 15);
      obj(14, 1, 17); obj(6, 8, 17);
      obj(12, 4, 10); // hallucination
      obj(21, 4, 11); // mirror
      set(58, 4, 5);
      break;
    }

    // ── ZONE 19: Ballroom ────────────────────────────────────────────────────
    // Grand dance floor with chandeliers
    case 19: {
      carve(1, 1, 58, 28);
      // Pillars
      for (const [px, py] of [[7,3],[7,5],[14,4],[21,3],[21,5]]) set(px, py, 1);
      // Stage area
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 6; y++) set(x, y, 1);
      // Balcony
      for (let x = 7; x <= 55; x++) set(x, 1, 1);
      obj(2, 1, 12);
      obj(6, 4, 2);   obj(16, 6, 2);  obj(24, 5, 2);
      obj(9, 2, 17);  obj(18, 7, 17);
      obj(14, 3, 21); // chandelier (static TV)
      obj(10, 8, 11); // mirror
      obj(20, 2, 19); // ritual circle
      set(58, 4, 5);
      break;
    }

    // ── ZONE 20: Laboratory ─────────────────────────────────────────────────
    // Science lab with experiments
    case 20: {
      carve(1, 1, 58, 28);
      // Lab benches
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 3; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 5; y <= 6; y++) set(x, y, 1);
      // Containment chamber
      for (let x = 7; x <= 55; x++) for (let y = 4; y <= 5; y++) set(x, y, 1);
      obj(2, 1, 12);
      obj(4, 5, 2);   obj(13, 7, 2);  obj(23, 3, 2);
      obj(8, 4, 15);  obj(19, 2, 15);
      obj(14, 5, 18); // acid pool (experiment)
      obj(11, 2, 17); obj(20, 7, 17);
      obj(6, 7, 22);  // cracked floor
      obj(16, 3, 13); // tiny hazard
      set(58, 4, 5);
      break;
    }

    // ── ZONE 21: Catacombs ────────────────────────────────────────────────────
    // Underground tunnels with tombs
    case 21: {
      carve(1, 1, 58, 28);
      // Tomb walls
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 6; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 6; y++) set(x, y, 1);
      // Central passage
      carve(10, 3, 17, 5);
      // Side chambers
      carve(2, 2, 4, 3); carve(23, 5, 25, 6);
      obj(2, 1, 12);
      obj(3, 7, 2);   obj(14, 4, 2);  obj(24, 2, 2);
      obj(6, 3, 15);  obj(20, 4, 15);
      obj(10, 2, 17); obj(16, 7, 17);
      obj(13, 4, 19); // ritual circle
      obj(8, 8, 11);  // mirror
      obj(22, 8, 22); // cracked floor
      set(58, 4, 5);
      break;
    }

    // ── ZONE 22: Clock Tower ─────────────────────────────────────────────────
    // Tower with gears and time anomalies
    case 22: {
      carve(1, 1, 58, 28);
      // Gear structures
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 6; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 6; y++) set(x, y, 1);
      // Clock face
      for (let x = 7; x <= 55; x++) for (let y = 3; y <= 5; y++) set(x, y, 1);
      obj(2, 1, 12);
      obj(4, 4, 2);   obj(14, 7, 2);  obj(23, 5, 2);
      obj(6, 3, 17);  obj(21, 3, 17);
      obj(14, 4, 21); // clock mechanism (static TV)
      obj(10, 8, 11); // mirror (time reflection)
      obj(16, 2, 20); // vent
      set(58, 4, 5);
      break;
    }

    // ── ZONE 23: Fountain Room ───────────────────────────────────────────────
    // Central fountain with flowing water
    case 23: {
      carve(1, 1, 58, 28);
      // Fountain base
      for (let x = 7; x <= 55; x++) for (let y = 3; y <= 5; y++) set(x, y, 1);
      // Water channels
      carve(13, 1, 13, 2); carve(13, 6, 13, 8);
      carve(10, 4, 10, 4); carve(17, 4, 17, 4);
      // Decorative walls
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 6; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 6; y++) set(x, y, 1);
      obj(2, 1, 12);
      obj(3, 4, 2);   obj(14, 7, 2);  obj(24, 4, 2);
      obj(5, 3, 15);  obj(21, 4, 15);
      obj(14, 4, 18); // fountain (acid pool trick)
      obj(9, 2, 17);  obj(18, 7, 17);
      obj(12, 8, 11); // mirror
      set(58, 4, 5);
      break;
    }

    // ── ZONE 24: Armory ──────────────────────────────────────────────────────
    // Weapon storage with racks
    case 24: {
      carve(1, 1, 58, 28);
      // Weapon racks
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 6; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 6; y++) set(x, y, 1);
      // Central display
      for (let x = 7; x <= 55; x++) for (let y = 3; y <= 5; y++) set(x, y, 1);
      obj(2, 1, 12);
      obj(4, 4, 2);   obj(13, 7, 2);  obj(24, 4, 2);
      obj(6, 4, 15);  obj(20, 4, 15);
      obj(14, 4, 17); obj(10, 2, 17);
      obj(8, 8, 22);  // cracked floor
      obj(18, 1, 13); // tiny hazard
      set(58, 4, 5);
      break;
    }

    // ── ZONE 25: Overgrown Garden ─────────────────────────────────────────────
    // Dense vegetation with hidden paths
    case 25: {
      carve(1, 1, 58, 28);
      // Dense vegetation blocks
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 7; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 1; y <= 4; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 6; y <= 8; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 7; y++) set(x, y, 1);
      // Hidden paths
      set(5, 5, 0); set(12, 5, 0); set(22, 4, 0);
      obj(2, 1, 12);
      obj(8, 4, 2);   obj(15, 5, 2);  obj(25, 5, 2);
      obj(6, 2, 17);  obj(18, 3, 17);
      obj(12, 2, 19); // ritual circle
      obj(21, 7, 18); // acid pool
      obj(9, 8, 11);  // mirror
      set(58, 4, 5);
      break;
    }

    // ── ZONE 26: Hall of Mirrors ─────────────────────────────────────────────
    // Maze of mirrors with looping paths
    case 26: {
      carve(1, 1, 58, 28);
      // Mirror walls
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 6; y++) set(x, y, 11);
      for (let x = 7; x <= 55; x++) for (let y = 1; y <= 3; y++) set(x, y, 11);
      for (let x = 7; x <= 55; x++) for (let y = 5; y <= 7; y++) set(x, y, 11);
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 6; y++) set(x, y, 11);
      // Gaps
      set(7, 4, 0); set(13, 4, 0); set(20, 4, 0);
      obj(2, 1, 12);
      obj(4, 4, 2);   obj(16, 4, 2);  obj(24, 4, 2);
      obj(10, 2, 17); obj(18, 7, 17);
      obj(5, 8, 11);  obj(23, 1, 11);
      obj(15, 5, 10); // hallucination
      set(58, 4, 5);
      break;
    }

    // ── ZONE 27: Ice Cave ────────────────────────────────────────────────────
    // Frozen cavern with slippery paths
    case 27: {
      carve(1, 1, 58, 28);
      // Ice formations
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 5; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 4; y <= 7; y++) set(x, y, 1);
      // Cracked ice
      for (const [cx, cy] of [[10,3],[11,4],[12,5],[13,6],[14,7]]) set(cx, cy, 22);
      obj(2, 1, 12);
      obj(3, 7, 2);   obj(14, 3, 2);  obj(23, 6, 2);
      obj(6, 3, 15);  obj(17, 5, 15);
      obj(10, 2, 17); obj(20, 8, 17);
      obj(13, 4, 18); // acid pool (water)
      set(58, 4, 5);
      break;
    }

    // ── ZONE 28: Research Chamber ───────────────────────────────────────────────
    // Lab-home hybrid with equipment and furniture
    case 28: {
      carve(1, 1, 58, 28);
      // Lab equipment islands (instead of lava)
      for (let x = 7; x <= 55; x++) for (let y = 3; y <= 5; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 4; y <= 6; y++) set(x, y, 1);
      // Home furniture platforms
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 6; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 3; y <= 5; y++) set(x, y, 1);
      for (let x = 7; x <= 55; x++) for (let y = 2; y <= 7; y++) set(x, y, 1);
      // Lab equipment (monitors, chemical stations)
      obj(2, 1, 12);
      obj(3, 4, 2);   obj(14, 4, 2);  obj(24, 5, 2);
      obj(7, 4, 21);  obj(19, 5, 21); // monitors (static TV)
      obj(11, 7, 15); obj(21, 8, 15);
      obj(14, 4, 18); // chemical station (acid pool replaced with lab equipment)
      obj(8, 2, 17); obj(20, 3, 17);
      obj(6, 5, 23); // medicine cabinet
      obj(16, 2, 19); // ritual circle (experiment setup)
      set(58, 4, 5);
      break;
    }

    // ── ZONE 29: The Void ─────────────────────────────────────────────────────
    // Empty space with floating platforms
    case 29: {
      carve(1, 1, 58, 28);
      // Floating platforms (isolated islands)
      carve(2, 2, 4, 4); carve(2, 5, 4, 7);
      carve(8, 1, 11, 3); carve(8, 5, 11, 7);
      carve(16, 2, 19, 4); carve(16, 5, 19, 7);
      carve(22, 1, 25, 3); carve(22, 5, 25, 7);
      // Invisible bridges (corruption tiles as trick)
      set(5, 4, 3); set(12, 4, 3); set(20, 4, 3);
      obj(2, 1, 12);
      obj(3, 3, 2);   obj(10, 4, 2);  obj(18, 6, 2); obj(24, 4, 2);
      obj(6, 2, 10); obj(14, 2, 10); obj(22, 4, 10); // hallucinations
      obj(9, 6, 11); obj(17, 3, 11); // mirrors
      obj(13, 8, 19); // ritual circle
      set(58, 4, 5);
      break;
    }

    default: {
      // Fallback — simple open room
      carve(1, 1, 58, 28);
      obj(2, 1, 12);
      set(58, 4, 5);
      break;
    }
  }

  // ── Zone-conditional locked tiles ────────────────────────────────────────
  if (zoneIndex >= 4 && zoneIndex !== 4) set(13, 4, 9);
  if (zoneIndex >= 7 && zoneIndex !== 7) set(22, 4, 9);

  // ── Late-game traps ───────────────────────────────────────────────────────
  if (zoneIndex >= 8) {
    if (!map[1 * w + 6])  set(6, 1, 13);
    if (!map[8 * w + 21]) set(21, 8, 13);
  }

  // ── Zone corruption flavour ───────────────────────────────────────────────
  const corruptionSeeds = [[6,4,3],[19,1,4],[12,7,10],[23,5,11]];
  const cs = corruptionSeeds[zoneIndex % corruptionSeeds.length];
  if (map[cs[1] * w + cs[0]] === 0) set(cs[0], cs[1], cs[2]);

  // ── Fake exit in later zones ──────────────────────────────────────────────
  if (zoneIndex >= 6 && zoneIndex !== 10 && zoneIndex !== 11) {
    for (const [fx, fy] of [[24,1],[3,8]]) {
      if (map[fy * w + fx] === 0) { set(fx, fy, 16); break; }
    }
  }

  // ── Safe spawn tile ───────────────────────────────────────────────────────
  set(1, 1, 12);

  // ── Ensure exit is reachable (never overwrite) ────────────────────────────
  // Exit tile was set above per-zone; just guard it.
  return map;
}

// ── Map Creator ───────────────────────────────────────────────────────────────
// Creates custom maps with lab-home hybrid aesthetic (no lava)
export function createCustomMap(layout) {
  const w = 28;
  const h = 10;
  const map = new Array(w * h).fill(1);
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < w && y < h) map[y * w + x] = t; };
  const carve = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) set(x, y, 0);
  };
  
  // Parse layout string (0=floor, 1=wall, 2=hide, 11=mirror, 15=drawer, 17=note, 18=acid, 19=ritual, 20=vent, 21=TV, 22=cracked, 23=cabinet)
  const rows = layout.split('\n');
  for (let y = 0; y < Math.min(rows.length, h); y++) {
    const row = rows[y];
    for (let x = 0; x < Math.min(row.length, w); x++) {
      const char = row[x];
      const tileMap = {
        '0': 0, // floor
        '1': 1, // wall
        '2': 2, // hide spot
        '3': 3, // corruption
        '4': 4, // corruption
        '5': 5, // exit
        '6': 6, // moved furniture
        '7': 7, // collapse
        '8': 8, // block/tape
        '9': 9, // locked
        'a': 10, // hallucination
        'b': 11, // mirror
        'c': 12, // safe
        'd': 13, // tiny hazard
        'e': 14, // door
        'f': 15, // drawer
        'g': 16, // fake exit
        'h': 17, // note
        'i': 18, // acid (lab chemical)
        'j': 19, // ritual circle
        'k': 20, // vent
        'l': 21, // static TV (monitor)
        'm': 22, // cracked floor
        'n': 23, // medicine cabinet
        'o': 24, // key
      };
      if (tileMap[char] !== undefined) {
        set(x, y, tileMap[char]);
      }
    }
  }
  
  return map;
}

// ── Lab-Home Hybrid Room Templates ──────────────────────────────────────────
export const LAB_HOME_TEMPLATES = {
  livingLab: {
    name: "Living Laboratory",
    layout: `111111111111111111111111111111
1c00000000000000000000000000001
1f0000001100000000001100000000h1
10000000101000000010100000000101
10000000101000000010100000000101
10000000000000000000000000000101
1f0000001100000000001100000000h1
10000000101000000010100000000101
10000000101000000010100000000101
1c00000000000000000000000000001
111111111111111111111111111111`,
    description: "Comfortable living space with embedded lab equipment"
  },
  kitchenLab: {
    name: "Kitchen Lab",
    layout: `111111111111111111111111111111
1c00000000000000000000000000001
1f0000001111000000000000000000h1
10000000101100000000000000000101
10000000000000000000000000000101
10000000000000000000000000000101
1f0000001111000000000000000000h1
10000000101100000000000000000101
10000000000000000000000000000101
1c00000000000000000000000000001
111111111111111111111111111111`,
    description: "Kitchen with chemical analysis station"
  },
  bedroomLab: {
    name: "Sleep Lab",
    layout: `111111111111111111111111111111
1c00000000000000000000000000001
1f0000000000000000000000000000h1
10000000000000000000000000000101
10000000000000000000000000000101
10000000000000000000000000000101
1f0000000000000000000000000000h1
10000000000000000000000000000101
10000000000000000000000000000101
1c00000000000000000000000000001
111111111111111111111111111111`,
    description: "Bedroom with sleep monitoring equipment"
  },
  officeLab: {
    name: "Research Office",
    layout: `111111111111111111111111111111
1c00000000000000000000000000001
1f0000000000000000000000000000h1
10000000000000000000000000000101
10000000000000000000000000000101
10000000000000000000000000000101
1f0000000000000000000000000000h1
10000000000000000000000000000101
10000000000000000000000000000101
1c00000000000000000000000000001
111111111111111111111111111111`,
    description: "Office with data analysis terminals"
  },
  storageLab: {
    name: "Specimen Storage",
    layout: `111111111111111111111111111111
1c00000000000000000000000000001
1f0000000000000000000000000000h1
10000000000000000000000000000101
10000000000000000000000000000101
10000000000000000000000000000101
1f0000000000000000000000000000h1
10000000000000000000000000000101
10000000000000000000000000000101
1c00000000000000000000000000001
111111111111111111111111111111`,
    description: "Storage room for lab specimens and home items"
  },
};

// ── Reproducibility & Versioning ──────────────────────────────────────────────

// Seeded random number generator for deterministic behavior
class SeededRNG {
  constructor(seed = Date.now()) {
    this.seed = seed;
    this.current = seed;
  }

  // Simple linear congruential generator
  next() {
    this.current = (this.current * 1103515245 + 12345) & 0x7fffffff;
    return this.current / 0x7fffffff;
  }

  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextFloat(min, max) {
    return this.next() * (max - min) + min;
  }

  nextBoolean() {
    return this.next() < 0.5;
  }

  // Get current seed for reproducibility
  getSeed() {
    return this.seed;
  }

  // Reset to original seed
  reset() {
    this.current = this.seed;
  }

  // Set new seed
  setSeed(seed) {
    this.seed = seed;
    this.current = seed;
  }
}

// Version information for locking
const GAME_VERSION = {
  major: 1,
  minor: 0,
  patch: 0,
  hash: "dev", // Would be commit hash in production
  build: Date.now(),
};

// Config snapshot system
class ConfigSnapshot {
  constructor() {
    this.snapshots = new Map();
    this.currentSnapshot = null;
  }

  // Take a snapshot of current game state
  takeSnapshot(name, state) {
    const snapshot = {
      name,
      timestamp: Date.now(),
      version: { ...GAME_VERSION },
      config: this.extractConfig(state),
      seed: state.rng?.getSeed() || null,
    };
    this.snapshots.set(name, snapshot);
    this.currentSnapshot = name;
    return snapshot;
  }

  // Extract relevant config from state
  extractConfig(state) {
    return {
      zoneIndex: state.zoneIndex,
      ai: state.stalker ? {
        speed: ZONES[state.zoneIndex]?.ai?.speed,
        sightRange: ZONES[state.zoneIndex]?.ai?.sightRange,
        hearingRange: ZONES[state.zoneIndex]?.ai?.hearingRange,
        predictive: ZONES[state.zoneIndex]?.ai?.predictive,
      } : null,
      tools: { ...state.tools },
      transformState: { ...state.transformState },
      scores: { ...state.scores },
      director: {
        stress: state.director?.stress,
        hesitationTicks: state.director?.hesitationTicks,
      },
    };
  }

  // Restore a snapshot
  restoreSnapshot(name, state) {
    const snapshot = this.snapshots.get(name);
    if (!snapshot) {
      throw new Error(`Snapshot "${name}" not found`);
    }

    // Version check
    if (!this.versionMatches(snapshot.version)) {
      console.warn(`Version mismatch: snapshot ${snapshot.version.major}.${snapshot.version.minor}.${snapshot.version.patch}, current ${GAME_VERSION.major}.${GAME_VERSION.minor}.${GAME_VERSION.patch}`);
    }

    // Restore seed
    if (snapshot.seed !== null && state.rng) {
      state.rng.setSeed(snapshot.seed);
    }

    this.currentSnapshot = name;
    return snapshot;
  }

  // Check if versions match
  versionMatches(version) {
    return version.major === GAME_VERSION.major &&
           version.minor === GAME_VERSION.minor;
  }

  // Get current snapshot
  getCurrent() {
    return this.snapshots.get(this.currentSnapshot);
  }

  // List all snapshots
  listSnapshots() {
    return Array.from(this.snapshots.entries()).map(([name, snap]) => ({
      name,
      timestamp: snap.timestamp,
      version: snap.version,
      seed: snap.seed,
    }));
  }

  // Delete a snapshot
  deleteSnapshot(name) {
    return this.snapshots.delete(name);
  }

  // Clear all snapshots
  clear() {
    this.snapshots.clear();
    this.currentSnapshot = null;
  }
}

// Deterministic logging system
class DeterministicLogger {
  constructor() {
    this.logs = [];
    this.enabled = true;
    this.maxLogs = 10000;
  }

  log(category, message, data = null) {
    if (!this.enabled) return;

    const entry = {
      tick: this.currentTick || 0,
      timestamp: Date.now(),
      category,
      message,
      data: data ? JSON.parse(JSON.stringify(data)) : null,
    };

    this.logs.push(entry);

    // Keep log size manageable
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Also log to console for debugging
    console.log(`[${category}] ${message}`, data || '');
  }

  // Get logs for a category
  getLogs(category) {
    return this.logs.filter(log => log.category === category);
  }

  // Get logs for a tick range
  getLogsByTick(start, end) {
    return this.logs.filter(log => log.tick >= start && log.tick <= end);
  }

  // Export logs for comparison
  exportLogs() {
    return JSON.stringify({
      version: GAME_VERSION,
      logs: this.logs,
    }, null, 2);
  }

  // Clear logs
  clear() {
    this.logs = [];
  }

  // Enable/disable logging
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  // Set current tick for logging
  setCurrentTick(tick) {
    this.currentTick = tick;
  }
}

// Global reproducibility state
let globalRNG = new SeededRNG();
let configSnapshot = new ConfigSnapshot();
let deterministicLogger = new DeterministicLogger();

// Export for external use
export { SeededRNG, ConfigSnapshot, DeterministicLogger, GAME_VERSION };
export function getGlobalRNG() { return globalRNG; }
export function setGlobalRNG(rng) { globalRNG = rng; }
export function getConfigSnapshot() { return configSnapshot; }
export function getDeterministicLogger() { return deterministicLogger; }

// ── Mirror Loop Setup ────────────────────────────────────────────────────────
// Returns mirror loop connections for specific zones
function getZoneMirrorLoops(zoneIndex) {
  const loops = {};
  
  switch (zoneIndex) {
    case 3: // Bathroom - mirror loops between stalls
      loops["4,7"] = { x: 20, y: 4 };
      loops["20,4"] = { x: 4, y: 7 };
      break;
    case 7: // Bedroom - mirror loops
      loops["20,2"] = { x: 9, y: 7 };
      loops["9,7"] = { x: 20, y: 2 };
      break;
    case 12: // Greenhouse - plant maze mirrors
      loops["8,5"] = { x: 21, y: 3 };
      loops["21,3"] = { x: 8, y: 5 };
      break;
    case 15: // Chapel - confessional mirrors
      loops["9,6"] = { x: 14, y: 1 };
      loops["14,1"] = { x: 9, y: 6 };
      break;
    case 22: // Clock Tower - time reflection mirrors
      loops["10,8"] = { x: 14, y: 4 };
      loops["14,4"] = { x: 10, y: 8 };
      break;
    case 23: // Fountain Room - water mirrors
      loops["12,8"] = { x: 5, y: 3 };
      loops["5,3"] = { x: 12, y: 8 };
      break;
    case 26: // Hall of Mirrors - multiple loops
      loops["5,8"] = { x: 23, y: 1 };
      loops["23,1"] = { x: 5, y: 8 };
      loops["10,2"] = { x: 18, y: 7 };
      loops["18,7"] = { x: 10, y: 2 };
      break;
    case 29: // The Void - dimensional mirrors
      loops["9,6"] = { x: 17, y: 3 };
      loops["17,3"] = { x: 9, y: 6 };
      loops["6,2"] = { x: 22, y: 4 };
      loops["22,4"] = { x: 6, y: 2 };
      break;
  }
  
  return loops;
}

// ── Fake Mirror Setup ────────────────────────────────────────────────────────
// Returns positions of fake mirrors that show distorted reflections
function getZoneFakeMirrors(zoneIndex) {
  const fakes = [];
  
  switch (zoneIndex) {
    case 3: fakes.push("4,7"); break;
    case 7: fakes.push("20,2"); break;
    case 12: fakes.push("8,5", "21,3"); break;
    case 15: fakes.push("9,6"); break;
    case 22: fakes.push("10,8"); break;
    case 26: fakes.push("5,8", "23,1", "10,2", "18,7"); break;
    case 29: fakes.push("9,6", "17,3"); break;
  }
  
  return new Set(fakes);
}

// Zone maps are generated dynamically by buildZoneMap().
// ZONE_MAPS[0] is only the initial placeholder before resetZoneMap() runs.
const ZONE_MAPS = [
  Array.from({ length: 28 * 10 }, (_, i) => (i < 28 || i >= 28*9 || i%28===0 || i%28===27) ? 1 : 0),
];

const ITEM_DEFAULTS = { flashlight: 1, tape: 1, candy: 1, mirrorShard: 1, keyCrayon: 1 };
const SAVE_VERSION = 1;
const BOT_CONTROL_KEYS = ["w", "a", "s", "d", "h", "e", "shift", "1", "2", "3", "4", "5"];

const ZONE_NOTE_TABLETS = {
  0: [{ x: 10, y: 4 }],
  1: [{ x: 20, y: 5 }],
  2: [{ x: 16, y: 8 }],
  3: [{ x: 9, y: 4 }],
  4: [{ x: 22, y: 1 }],
  5: [{ x: 5, y: 1 }, { x: 15, y: 4 }],
  6: [{ x: 5, y: 1 }, { x: 16, y: 7 }],
  7: [{ x: 22, y: 4 }],
  8: [{ x: 13, y: 8 }],
  9: [{ x: 20, y: 1 }],
  10: [{ x: 4, y: 1 }, { x: 17, y: 1 }],
  11: [{ x: 22, y: 8 }],
  12: [{ x: 8, y: 3 }, { x: 21, y: 2 }],
  13: [{ x: 13, y: 7 }],
  14: [{ x: 6, y: 4 }, { x: 20, y: 3 }],
  15: [{ x: 14, y: 3 }],
  16: [{ x: 7, y: 5 }, { x: 19, y: 5 }],
  17: [{ x: 14, y: 2 }],
  18: [{ x: 12, y: 5 }],
  19: [{ x: 14, y: 6 }],
  20: [{ x: 14, y: 3 }],
  21: [{ x: 13, y: 4 }],
  22: [{ x: 14, y: 3 }],
  23: [{ x: 14, y: 6 }],
  24: [{ x: 14, y: 4 }],
  25: [{ x: 12, y: 5 }],
  26: [{ x: 13, y: 4 }],
  27: [{ x: 13, y: 5 }],
  28: [{ x: 14, y: 4 }],
  29: [{ x: 13, y: 7 }],
};

const NOTE_LORE = [
  // Phase 1: Childhood Abuse (Parents as Stalkers)
  "The belt left marks that never healed. Mother called it discipline. I called it survival.",
  "Father's footsteps echo in my skull. Heavy. Predictable. Inevitable.",
  "I hid in the closet again. They always found me. They always do.",
  "The bruises fade, but the footsteps don't. They're here. They're always here.",
  "Mother said I was broken. Father said I was worthless. I believed them both.",

  // Phase 2: The Lab - Betrayal and Imprisonment
  "They sold me. My own parents. For science. For money. For peace from their mistake.",
  "The facility has no windows. No escape. Only white walls and the smell of disinfectant.",
  "Subject 734. That's my name now. My old one was taken with my clothes.",
  "The cells here are soundproof. No one hears screaming. No one but the others.",
  "Dr. Vance watches me through the glass. He smiles when I cry. He takes notes.",

  // Phase 3: The Experiments - Injections and Transformation
  "The needle enters my spine. Cold. Then fire. Then something worse than either.",
  "My blood turns silver in the vials. They say that's progress. I say that's poison.",
  "The other subjects stopped screaming yesterday. Now they're quiet. Now they're gone.",
  "My skin peels in places. Underneath... underneath isn't skin anymore.",
  "I can see through walls now. I can see them coming. I can see everything.",

  // Phase 4: Reality Warps - The World Fractures
  "The corridors shift when I blink. The exit is never where I left it.",
  "Three of them hunt me now. The Mother. The Biologist. The Lead Scientist. They wear faces I know.",
  "I vomited this morning. It wasn't food. It was... threads? Wires? Reality unspooling?",
  "The injections don't stop. Even when I run, I feel the needle. It's inside me now. Permanent.",
  "I hear them calling my subject number. 734. 734. Soon there will be nothing else to call.",
];

export function createGame(canvas) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width / TILE;
  const height = canvas.height / TILE;

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.addEventListener("load", () => resolve(img), { once: true });
      img.addEventListener("error", () => resolve(null), { once: true });
      img.src = src;
    });
  }

  const spriteAssets = {
    loaded: false,
    playerWalk: null,
    playerIdle: null,
    playerSitting: null,
    playerDeath: null,
    playerScared: null,
    stalker: null,
    tiles: null,
  };

  const spriteReady = Promise.all(Object.entries(SPRITE_SHEET_PATHS).map(async ([key, src]) => {
    spriteAssets[key] = await loadImage(src);
  })).then(() => {
    spriteAssets.loaded = true;
  });

  // Initialize enhanced art systems
  const tileRenderer = new TileRenderer(ctx, TILE);
  const lightingSystem = new LightingSystem(ctx, canvas, TILE);
  const particleSystem = new ParticleSystem(ctx, canvas);

  function drawTileFromSheet(tileX, tileY, x, y) {
    const tiles = spriteAssets.tiles;
    if (!tiles) return false;
    ctx.drawImage(tiles, tileX * 32, tileY * 32, 32, 32, x * TILE, y * TILE, TILE, TILE);
    return true;
  }

  function drawPlayerSprite(x, y) {
    const moving = state.tick - state.player.lastMoveTick <= PLAYER_IDLE_TIMEOUT;
    const hidden = state.player.hide;
    const burden = totalTransformationBurden(state.transformState);
    let sheet = spriteAssets.playerIdle;
    let frameW = 32;
    let frameH = 32;
    let frames = 4;
    let fps = 4;
    let row = 0;

    if (state.completed && state.scores.deaths > 0 && spriteAssets.playerDeath) {
      sheet = spriteAssets.playerDeath;
      frames = 5;
      fps = 8;
    } else if ((hidden || state.player.hideAnim === "enter" || state.player.hideAnim === "exit") && spriteAssets.playerSitting) {
      sheet = spriteAssets.playerSitting;
      frames = 3;
      fps = state.player.hideAnim === "enter" || state.player.hideAnim === "exit" ? 10 : 3;
    } else if (burden > 5 && spriteAssets.playerScared) {
      sheet = spriteAssets.playerScared;
      frames = 2;
      frameW = 32;
      frameH = 32;
      fps = PLAYER_SCARED_FPS;
    } else if (moving && spriteAssets.playerWalk) {
      sheet = spriteAssets.playerWalk;
      frameW = 64;
      frameH = 96;
      frames = 4;
      fps = PLAYER_ANIM_FPS;
      row = state.player.facing === "up" ? 0 : state.player.facing === "right" ? 1 : 2;
    }

    if (!sheet) return false;

    const frame = Math.floor((state.tick * fps) / 60) % frames;
    const sx = frame * frameW;
    const sy = row * frameH;
    const drawX = x * TILE + state.player.silhouetteOffsetX;
    const drawY = y * TILE + state.player.silhouetteOffsetY;
    const hideProgress = Math.min(1, Math.max(0, (state.tick - state.player.hideAnimTick) / 14));

    if (sheet === spriteAssets.playerWalk) {
      ctx.drawImage(sheet, sx, sy, frameW, frameH, drawX - 12, drawY - 40, 88, 112);
    } else {
      let alpha = 1;
      let yOffset = 0;
      if (state.player.hideAnim === "enter") {
        alpha = 1 - hideProgress * 0.45;
        yOffset = hideProgress * 10;
      } else if (state.player.hideAnim === "exit") {
        alpha = 0.55 + hideProgress * 0.45;
        yOffset = (1 - hideProgress) * 10;
      } else if (hidden) {
        alpha = 0.58;
        yOffset = 10;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(sheet, sx, sy, frameW, frameH, drawX, drawY + yOffset, TILE, TILE);
      ctx.restore();
    }

    return true;
  }

  function drawStalkerSprite(x, y) {
    const sheet = spriteAssets.stalker;
    if (!sheet) return false;
    const frameW = 455;
    const frameH = 455;
    const frames = 4;
    const frame = Math.floor((state.tick * STALKER_ANIM_FPS) / 60) % frames;
    ctx.drawImage(sheet, frame * frameW, 0, frameW, frameH, x * TILE - 28, y * TILE - 28, 120, 120);
    return true;
  }

  const state = {
    tick: 0,
    keys: {},
    map: [...ZONE_MAPS[0]],
    player: createPlayer(),
    stalker: createStalker({ x: 18, y: 1 }),
    transformState: createTransformState(),
    zoneIndex: 0,
    checkpointZone: 0,
    mandatoryCorruptionMet: false,
    completed: false,
    ending: null,
    cutscene: null, // { phase: 'intro'|'main'|'outro', progress: 0, tick: 0 }
    paused: false,
    uiText: "",
    flickerTimer: 0,
    lightMode: "stable",
    doorTimer: 0,
    collapseMarker: null,
    phantom: null,
    decoySound: null,
    mirrorLureTimer: 0,
    noHud: CHALLENGE_MODE,
    tools: { ...ITEM_DEFAULTS },
    clones: [],
    particles: [],
    decor: [],
    scores: { corruptionLevel: 0, aiEncounters: 0, roomsCompleted: 0, roomsVisited: 1, detections: 0, deaths: 0 },
    keysCollected: [],             // array of zoneIndex values for collected keys
    stability: { stalledTicks: 0, lastRescueTick: -9999 },
    
    // ── Reproducibility Systems ─────────────────────────────────────────────
    rng: new SeededRNG(),         // Seeded random number generator
    seed: Date.now(),             // Current seed value
    deterministicMode: false,     // Whether to use deterministic RNG
    configSnapshot: new ConfigSnapshot(),
    logger: new DeterministicLogger(),
    versionLocked: false,         // Whether version is locked for this run
    
    // ── Mirror Loops ──────────────────────────────────────────────────────────
    // Stores looping mirror connections: { "x,y": { x: targetX, y: targetY } }
    mirrorLoops: {},
    fakeMirrors: new Set(),
    mirrorLureEnabled: false,
    mirrorCloneEnabled: false,

    // ── Adaptive Director ────────────────────────────────────────────────────
    // Observes input-leakable fear signals, then nudges small mutable map
    // parameters in ways that feel like memory errors, not game events.
    director: {
      // Behavior signals — derived from raw input patterns each tick
      hesitationTicks: 0,       // ticks without movement (player frozen/scanning)
      backtrackScore: 0,        // recency-weighted revisit rate
      safeSpaceChecks: 0,       // repeated returns to hide/safe tiles
      ticksSinceLastScare: 999, // ticks since last flicker or near-stalker event
      pathRepeatScore: 0,       // how often same corridor segment is walked

      // Derived stress composite [0..1]
      stress: 0,

      // Spatial memory — per-tile visit frequency within this zone
      visitCounts: null,        // initialised in resetDirector(); size w*h
      recentPositions: [],      // ring buffer of last 60 player positions

      // Active environmental modifications — all self-expiring
      ghostDoors: [],           // { x, y, was, ttl } — silently toggled doors
      fogClusters: [],          // { x, y, ttl, maxTtl, alpha } — visual murk patches
      frictionCells: new Set(), // "x,y" strings where traversal is slowed
      frictionCooldown: 0,      // ticks remaining until player can move again

      // Director timing
      nextActionTick: 120,
      actionCooldown: {},       // { [actionId]: ticksRemaining }
      log: [],                  // short rolling log of applied actions (debug)
    },
  };

  const tileAt = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 1;
    return state.map[y * width + x] ?? 1;
  };
  const setTile = (x, y, v) => {
    state.map[y * width + x] = v;
  };
  const zone = () => ZONES[state.zoneIndex];

  function safeClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function sanitizeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return null;
    if (snapshot.version !== SAVE_VERSION) return null;
    if (typeof snapshot.zoneIndex !== "number") return null;

    const boundedZone = Math.max(0, Math.min(ZONES.length - 1, snapshot.zoneIndex | 0));
    return {
      version: SAVE_VERSION,
      zoneIndex: boundedZone,
      checkpointZone: Math.max(0, Math.min(boundedZone, snapshot.checkpointZone | 0)),
      scores: {
        corruptionLevel: Number(snapshot.scores?.corruptionLevel ?? 0),
        aiEncounters: Number(snapshot.scores?.aiEncounters ?? 0),
        roomsCompleted: Math.max(0, snapshot.scores?.roomsCompleted | 0),
        roomsVisited: Math.max(1, snapshot.scores?.roomsVisited | 0),
        detections: Math.max(0, snapshot.scores?.detections | 0),
        deaths: Math.max(0, snapshot.scores?.deaths | 0),
      },
      transformState: safeClone(snapshot.transformState ?? createTransformState()),
      tools: {
        flashlight: Math.max(0, snapshot.tools?.flashlight | 0),
        tape: Math.max(0, snapshot.tools?.tape | 0),
        candy: Math.max(0, snapshot.tools?.candy | 0),
        mirrorShard: Math.max(0, snapshot.tools?.mirrorShard | 0),
        keyCrayon: Math.max(0, snapshot.tools?.keyCrayon | 0),
      },
      uiText: typeof snapshot.uiText === "string" ? snapshot.uiText : "",
      mandatoryCorruptionMet: !!snapshot.mandatoryCorruptionMet,
    };
  }

  function seedDecoration() {
    state.decor = [];
    for (let i = 0; i < 28; i += 1) {
      state.decor.push({
        x: 1 + ((Math.random() * 26) | 0),
        y: 1 + ((Math.random() * 8) | 0),
        kind: i % 4 === 0 ? "smudge" : i % 4 === 1 ? "scratch" : i % 4 === 2 ? "child" : "dust_ring",
      });
    }
  }

  function spawnParticle(x, y, kind = "dust") {
    state.particles.push({ x: x + Math.random(), y: y + Math.random(), kind, ttl: 40 + ((Math.random() * 30) | 0) });
  }

  function ensureExitDoor() {
    let exitX = -1;
    let exitY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (tileAt(x, y) === 5) {
          exitX = x;
          exitY = y;
          break;
        }
      }
      if (exitX >= 0) break;
    }
    if (exitX < 0) return;

    const neighbors = [
      { x: exitX - 1, y: exitY },
      { x: exitX + 1, y: exitY },
      { x: exitX, y: exitY - 1 },
      { x: exitX, y: exitY + 1 },
    ];

    for (const n of neighbors) {
      const t = tileAt(n.x, n.y);
      if (t === 0 || t === 12 || t === 17) {
        setTile(n.x, n.y, 14);
        return;
      }
    }
  }

  function hasLineOfSight(x0, y0, x1, y1) {
    let x = x0;
    let y = y0;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (!(x === x1 && y === y1)) {
      if (!(x === x0 && y === y0)) {
        const t = tileAt(x, y);
        if (t === 1 || t === 14) return false;
      }
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
    return true;
  }


  function isBackgroundObjectTile(t) {
    return t === 2 || t === 6 || t === 10 || t === 11 || t === 15 || t === 17 || t === 20 || t === 21 || t === 23;
  }

  function drawBackgroundOccluders() {
    const hidingNow = state.player.hide || state.player.hideAnim === "enter" || state.player.hideAnim === "exit";
    if (!hidingNow) return;

    const px = Math.round(state.player.renderX);
    const py = Math.round(state.player.renderY);
    const t = tileAt(px, py);
    if (py > 4 || !isBackgroundObjectTile(t)) return;

    const bx = px * TILE;
    const by = py * TILE;
    ctx.fillStyle = "rgba(12, 10, 14, 0.22)";
    ctx.fillRect(bx + 4, by + 10, TILE - 8, TILE - 10);
  }

  function drawHallwayVisibilityMask() {
    // Visibility mask disabled: player can see the whole room.
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ADAPTIVE MAP DIRECTOR
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const DIR_W = 28;
  const DIR_H = 10;

  function resetDirector() {
    const d = state.director;
    d.hesitationTicks     = 0;
    d.backtrackScore      = 0;
    d.safeSpaceChecks     = 0;
    d.ticksSinceLastScare = 999;
    d.pathRepeatScore     = 0;
    d.stress              = 0;
    d.visitCounts         = new Array(DIR_W * DIR_H).fill(0);
    d.recentPositions     = [];
    d.ghostDoors          = [];
    d.fogClusters         = [];
    d.frictionCells       = new Set();
    d.frictionCooldown    = 0;
    d.nextActionTick      = 90 + ((Math.random() * 60) | 0);
    d.actionCooldown      = {};
    d.log                 = [];
  }

  // ── 1. Behavior sampling — called every tick ─────────────────────────
  function samplePlayerBehavior(moved, nearStalker) {
    const d = state.director;
    const px = state.player.x;
    const py = state.player.y;
    const key = `${px},${py}`;

    // Hesitation: player held still
    if (!moved) d.hesitationTicks += 1;
    else d.hesitationTicks = Math.max(0, d.hesitationTicks - 0.5);

    // Visit counts + recency ring buffer
    const idx = py * DIR_W + px;
    if (idx >= 0 && idx < d.visitCounts.length) {
      d.visitCounts[idx] = (d.visitCounts[idx] || 0) + 1;
    }
    d.recentPositions.push({ x: px, y: py });
    if (d.recentPositions.length > 60) d.recentPositions.shift();

    // Backtrack score: is current position somewhere they stood in the last 20 ticks?
    const wasRecentlyHere = d.recentPositions.slice(0, -5).some(p => p.x === px && p.y === py);
    if (wasRecentlyHere && moved) d.backtrackScore = Math.min(10, d.backtrackScore + 0.5);
    else d.backtrackScore = Math.max(0, d.backtrackScore - 0.05);

    // Safe space checks: player returned to a hide (2) or safe (12) tile
    const t = tileAt(px, py);
    if ((t === 2 || t === 12) && moved) {
      d.safeSpaceChecks = Math.min(12, d.safeSpaceChecks + 1.5);
    } else {
      d.safeSpaceChecks = Math.max(0, d.safeSpaceChecks - 0.02);
    }

    // Time-since-scare counter
    if (nearStalker || state.flickerTimer > 30) {
      d.ticksSinceLastScare = 0;
    } else {
      d.ticksSinceLastScare = Math.min(999, d.ticksSinceLastScare + 1);
    }

    // Path-repeat score: how many of last 30 positions are in a horizontal/vertical run
    if (d.recentPositions.length >= 10) {
      const last10 = d.recentPositions.slice(-10);
      const xVals = new Set(last10.map(p => p.x));
      const yVals = new Set(last10.map(p => p.y));
      // Low variety → repeating a narrow corridor
      const narrowness = 1 - Math.min(xVals.size, yVals.size) / 5;
      d.pathRepeatScore = d.pathRepeatScore * 0.9 + narrowness * 0.1 * 10;
    }

    // Decay action cooldowns
    for (const id of Object.keys(d.actionCooldown)) {
      d.actionCooldown[id] = Math.max(0, d.actionCooldown[id] - 1);
    }

    // Tick friction cooldown
    if (d.frictionCooldown > 0) d.frictionCooldown -= 1;

    // Expire ghost doors
    for (const gd of d.ghostDoors) {
      gd.ttl -= 1;
      if (gd.ttl <= 0) {
        // Only restore if the tile hasn't been changed by the player
        if (tileAt(gd.x, gd.y) === gd.to) setTile(gd.x, gd.y, gd.was);
      }
    }
    d.ghostDoors = d.ghostDoors.filter(gd => gd.ttl > 0);

    // Expire fog clusters
    for (const fc of d.fogClusters) fc.ttl -= 1;
    d.fogClusters = d.fogClusters.filter(fc => fc.ttl > 0);
  }

  // ── 2. Stress computation ─────────────────────────────────────────────
  function computeStress() {
    const d = state.director;
    // Normalize each signal to [0..1]
    const hesNorm   = Math.min(1, d.hesitationTicks / 120);
    const backNorm  = Math.min(1, d.backtrackScore   / 10);
    const safeNorm  = Math.min(1, d.safeSpaceChecks  / 12);
    const scareNorm = Math.max(0, 1 - d.ticksSinceLastScare / 300); // fades over 5 sec at 60fps
    const pathNorm  = Math.min(1, d.pathRepeatScore  / 8);

    // Weighted composite — backtracking and safe-checking are strongest signals
    d.stress = Math.min(1,
      hesNorm  * 0.15 +
      backNorm * 0.25 +
      safeNorm * 0.25 +
      scareNorm * 0.20 +
      pathNorm * 0.15,
    );
    return d.stress;
  }

  // ── 3. Safe-path guard — never mutate tiles that could strand the player ─
  function isNavSafe(x, y) {
    const t = tileAt(x, y);
    if (t === 1 || t === 5 || t === 12) return false; // wall, exit, safe — never touch
    if (x === state.player.x && y === state.player.y) return false;
    if (x === 1 && y === 1) return false; // spawn corner
    // Never touch a tile that is the only route to the exit (approx: near exit col)
    if (x >= 24) return false;
    return true;
  }

  // Returns the most-visited *floor* tile in a given search band, or null
  function mostVisitedFloor(xMin, xMax, yMin, yMax) {
    const d = state.director;
    let best = null;
    let bestCount = 2; // must have been visited at least twice
    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) {
        if (!isNavSafe(x, y)) continue;
        const t = tileAt(x, y);
        if (t !== 0 && t !== 2) continue; // floor or hide only
        const cnt = d.visitCounts[y * DIR_W + x] || 0;
        if (cnt > bestCount) { bestCount = cnt; best = { x, y, cnt }; }
      }
    }
    return best;
  }

  // ── 4. Action pool ────────────────────────────────────────────────────
  // Each action: { id, minStress, cooldown, navRisk, uncertaintyGain, apply }
  // MCTS-style scoring = uncertaintyGain * stress - navRisk

  const DIRECTOR_ACTIONS = [

    // ── DOORS ─────────────────────────────────────────────────────────

    {
      id: "doorCreep",
      minStress: 0.15,
      cooldown: 250,
      navRisk: 0.15,
      uncertaintyGain: 0.70,
      apply() {
        // Find a door tile on a corridor the player frequents — close it silently.
        const d = state.director;
        const candidates = [];
        for (let y = 2; y <= 8; y++) {
          for (let x = 7; x <= 55; x++) {
            if (tileAt(x, y) === 0 && (d.visitCounts[y * DIR_W + x] || 0) >= 3) {
              // Is there a door tile (14) adjacent?
              for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                if (tileAt(x+dx, y+dy) === 14 || tileAt(x+dx, y+dy) === 0) {
                  // Find an open floor tile adjacent to this cluster to place a door
                }
              }
            }
          }
        }
        // Simpler: find an open floor tile on a trusted path and insert a door-like block
        const target = mostVisitedFloor(3, 22, 3, 6);
        if (!target) return false;
        setTile(target.x, target.y, 14); // becomes a door
        d.ghostDoors.push({ x: target.x, y: target.y, was: 0, to: 14, ttl: 350 });
        d.log.push(`doorCreep @ ${target.x},${target.y}`);
        return true;
      },
    },

    {
      id: "silentUnlock",
      minStress: 0.10,
      cooldown: 300,
      navRisk: 0.05,
      uncertaintyGain: 0.50,
      apply() {
        // Find a locked tile (9) or blocked tile (8), open it without player input.
        for (let y = 1; y <= 8; y++) {
          for (let x = 7; x <= 55; x++) {
            if (tileAt(x, y) === 9 || tileAt(x, y) === 8) {
              setTile(x, y, 0);
              state.director.ghostDoors.push({ x, y, was: 9, to: 0, ttl: 500 });
              state.director.log.push(`silentUnlock @ ${x},${y}`);
              return true;
            }
          }
        }
        return false;
      },
    },

    // ── LIGHTING ──────────────────────────────────────────────────────

    {
      id: "flickerTrust",
      minStress: 0.20,
      cooldown: 200,
      navRisk: 0.05,
      uncertaintyGain: 0.60,
      apply() {
        // Trigger a flicker specifically while the player is on a trusted path
        const d = state.director;
        const target = mostVisitedFloor(3, 22, 3, 6);
        if (!target) return false;
        // Only fire if player is within 5 tiles of the trusted hotspot
        const dist = Math.abs(state.player.x - target.x) + Math.abs(state.player.y - target.y);
        if (dist > 6) return false;
        // Force a short flicker on their trusted route
        state.flickerTimer = 40 + ((Math.random() * 20) | 0);
        state.lightMode = ["soft-dim", "stuck-dim"][Math.random() < 0.5 ? 0 : 1];
        d.log.push(`flickerTrust near ${target.x},${target.y}`);
        return true;
      },
    },

    {
      id: "brightnessErode",
      minStress: 0.30,
      cooldown: 400,
      navRisk: 0.00,
      uncertaintyGain: 0.40,
      apply() {
        // Inject a long stuck-dim event — brightness just... stays lower
        if (state.flickerTimer > 0) return false; // don't stack
        state.flickerTimer = 90 + ((Math.random() * 60) | 0);
        state.lightMode = "stuck-dim";
        state.director.log.push("brightnessErode");
        return true;
      },
    },

    // ── CLUTTER / PROPS ───────────────────────────────────────────────

    {
      id: "clutterOnPath",
      minStress: 0.20,
      cooldown: 220,
      navRisk: 0.10,
      uncertaintyGain: 0.65,
      apply() {
        // Move a clutter tile from a low-visit area onto a trusted corridor tile
        const d = state.director;
        const target = mostVisitedFloor(3, 22, 3, 6);
        if (!target) return false;
        setTile(target.x, target.y, 6); // moved furniture
        d.ghostDoors.push({ x: target.x, y: target.y, was: 0, to: 6, ttl: 600 });
        d.log.push(`clutterOnPath @ ${target.x},${target.y}`);
        return true;
      },
    },

    {
      id: "ghostClutter",
      minStress: 0.35,
      cooldown: 280,
      navRisk: 0.05,
      uncertaintyGain: 0.75,
      apply() {
        // Drop a clutter tile on a high-visit spot, remove it after ~8 seconds
        // Player sees it, double-takes, it's gone. Classic gaslighting.
        const d = state.director;
        const target = mostVisitedFloor(2, 25, 1, 8);
        if (!target) return false;
        setTile(target.x, target.y, 6);
        d.ghostDoors.push({ x: target.x, y: target.y, was: 0, to: 6, ttl: 180 });
        spawnParticle(target.x, target.y, "dust");
        d.log.push(`ghostClutter @ ${target.x},${target.y} (auto-vanishes)`);
        return true;
      },
    },

    {
      id: "soilSafeSpace",
      minStress: 0.50,
      cooldown: 400,
      navRisk: 0.20,
      uncertaintyGain: 0.85,
      apply() {
        // Find the most-visited hide spot and place a tiny hazard on it.
        // Player will step on it while seeking safety — betrayal by familiar ground.
        const d = state.director;
        let bestHide = null;
        let bestCount = 3;
        for (let y = 1; y <= 8; y++) {
          for (let x = 7; x <= 55; x++) {
            if (tileAt(x, y) === 2) { // hide spot
              const cnt = d.visitCounts[y * DIR_W + x] || 0;
              if (cnt > bestCount && isNavSafe(x, y)) {
                bestCount = cnt;
                bestHide = { x, y };
              }
            }
          }
        }
        if (!bestHide) return false;
        setTile(bestHide.x, bestHide.y, 13); // tiny hazard replaces hide
        d.ghostDoors.push({ x: bestHide.x, y: bestHide.y, was: 2, to: 13, ttl: 700 });
        d.log.push(`soilSafeSpace @ ${bestHide.x},${bestHide.y}`);
        return true;
      },
    },

    // ── SIGHTLINES / FOG ──────────────────────────────────────────────

    {
      id: "fogPatch",
      minStress: 0.25,
      cooldown: 180,
      navRisk: 0.00,
      uncertaintyGain: 0.55,
      apply() {
        // Spawn a visual fog cluster ahead of the player on their trusted corridor.
        const d = state.director;
        const lookAhead = {
          x: state.player.x + (Math.random() < 0.5 ? 3 : -3) | 0,
          y: state.player.y + ([-1, 0, 0, 1][(Math.random() * 4) | 0]),
        };
        if (lookAhead.x < 1 || lookAhead.x > 26 || lookAhead.y < 1 || lookAhead.y > 8) return false;
        d.fogClusters.push({
          x: lookAhead.x,
          y: lookAhead.y,
          ttl: 200 + ((Math.random() * 120) | 0),
          maxTtl: 320,
        });
        d.log.push(`fogPatch @ ${lookAhead.x},${lookAhead.y}`);
        return true;
      },
    },

    {
      id: "multipleFogs",
      minStress: 0.55,
      cooldown: 350,
      navRisk: 0.00,
      uncertaintyGain: 0.70,
      apply() {
        // Spawn 3–4 fog clusters along the player's most-walked corridor row
        const d = state.director;
        const py = state.player.y;
        const count = 3 + ((Math.random() * 2) | 0);
        for (let i = 0; i < count; i++) {
          const x = 3 + ((Math.random() * 22) | 0);
          d.fogClusters.push({
            x, y: py,
            ttl: 280 + ((Math.random() * 100) | 0),
            maxTtl: 380,
          });
        }
        d.log.push(`multipleFogs row=${py}`);
        return true;
      },
    },

    // ── TRAVERSAL FRICTION ────────────────────────────────────────────

    {
      id: "frictionPatch",
      minStress: 0.30,
      cooldown: 240,
      navRisk: 0.05,
      uncertaintyGain: 0.50,
      apply() {
        // Mark 2–3 cells on the player's current route as friction cells.
        // Movement is briefly throttled when crossing them, creating the illusion
        // that the hallway is "longer" than they remember.
        const d = state.director;
        const px = state.player.x;
        const py = state.player.y;
        const spread = 2 + ((Math.random() * 2) | 0);
        for (let i = 1; i <= spread; i++) {
          const fx = Math.min(25, px + i);
          const key = `${fx},${py}`;
          d.frictionCells.add(key);
          // Auto-expire friction after 10 seconds
          setTimeout(() => d.frictionCells.delete(key), 10000);
        }
        d.log.push(`frictionPatch from ${px},${py} spread=${spread}`);
        return true;
      },
    },

    // ── SOUND / STALKER MISDIRECTION ──────────────────────────────────

    {
      id: "echoStep",
      minStress: 0.40,
      cooldown: 280,
      navRisk: 0.05,
      uncertaintyGain: 0.65,
      apply() {
        // Inject a fake footstep sound originating from where the player just was.
        // Stalker goes toward a position the player already vacated.
        const d = state.director;
        if (d.recentPositions.length < 20) return false;
        const ghost = d.recentPositions[d.recentPositions.length - 15];
        state.stalker.memory.recentNoises.unshift({ x: ghost.x, y: ghost.y, ttl: 120 });
        d.log.push(`echoStep @ ${ghost.x},${ghost.y}`);
        return true;
      },
    },

    {
      id: "silenceOnSafe",
      minStress: 0.45,
      cooldown: 350,
      navRisk: 0.00,
      uncertaintyGain: 0.60,
      apply() {
        // When player reaches a trusted "safe" path, suppress ambient cues for a while.
        // Silence where sound used to be is its own kind of terror.
        state.director.log.push("silenceOnSafe (ambient suppressed 8s)");
        state.uiText = ""; // wipe current ambient text
        // Suppress random ambient cues by setting a silence flag
        state.director.actionCooldown["_ambientSilence"] = 500;
        return true;
      },
    },

    {
      id: "distantCueOnRoute",
      minStress: 0.20,
      cooldown: 200,
      navRisk: 0.00,
      uncertaintyGain: 0.45,
      apply() {
        // Fire an ambient cue that aligns with where the player expects safety.
        // "The house knows your routine."
        const zid = zone().id;
        const cues = [
          "you hear your own footsteps a second late",
          "something exhales behind the wall you lean on",
          "the safe tile feels wet tonight",
          "you counted the doors — one more than before",
          "a familiar creak in an unfamiliar order",
          "the smell of your fear — someone else's, almost",
        ];
        state.uiText = cues[(state.tick % cues.length)];
        state.director.log.push("distantCueOnRoute");
        return true;
      },
    },
  ];

  // ── 5. Director decision loop (MCTS-style micro-rollout) ─────────────
  function runDirector() {
    const d = state.director;
    const stress = computeStress();

    // Score each eligible action: gain * stress_weight - risk
    // Actions with high stress thresholds scale better under pressure.
    const eligible = DIRECTOR_ACTIONS.filter(a => {
      if (stress < a.minStress) return false;
      if ((d.actionCooldown[a.id] || 0) > 0) return false;
      return true;
    });

    if (eligible.length === 0) return;

    // Score each action with a tiny rollout heuristic:
    // High-stress players benefit more from sightline/fog actions (uncertainty).
    // Low-stress players notice door/prop changes more (they're paying attention).
    const scored = eligible.map(a => {
      const stressScale = 0.5 + stress * 0.5;
      const score = a.uncertaintyGain * stressScale - a.navRisk * (1 - stress * 0.3);
      // Add a small random jitter so the director isn't deterministic
      return { a, score: score + (Math.random() * 0.12 - 0.06) };
    });

    scored.sort((a, b) => b.score - a.score);

    // Apply the top-scoring action that actually succeeds
    for (const { a } of scored) {
      const ok = a.apply();
      if (ok) {
        d.actionCooldown[a.id] = a.cooldown;
        // Stagger next action: longer gaps when stress is high (don't overload player)
        d.nextActionTick = state.tick + 80 + ((Math.random() * 120) | 0) + ((1 - stress) * 60 | 0);
        // Keep rolling log trimmed
        if (d.log.length > 12) d.log.shift();
        break;
      }
    }
  }

  function refreshToolsForZone() {
    state.tools = { ...ITEM_DEFAULTS };
    if (CHALLENGE_MODE) {
      state.tools.tape = 1;
      // Candy (corruption cleanse) becomes scarce in the deep zones.
      state.tools.candy = state.zoneIndex >= 8 ? 0 : 1;
      // Extra flashlight in early hallway to reward exploration.
      if (state.zoneIndex === 1) state.tools.flashlight = 2;
    }
  }

  function resetZoneMap() {
    state.map = buildZoneMap(state.zoneIndex);
    state.player = createPlayer();
    const spawn = zone().stalkerSpawn ?? { x: 18, y: 1 };
    state.stalker = createStalker(spawn);
    state.tick = 0;
    state.flickerTimer = 0;
    state.lightMode = "stable";
    state.doorTimer = 0;
    state.collapseMarker = null;
    state.phantom = null;
    state.decoySound = null;
    state.clones = [];
    state.particles = [];
    state.mirrorLureTimer = 0;
    state.mandatoryCorruptionMet = false;
    state.stability.stalledTicks = 0;
    state.stability.lastRescueTick = -9999;
    
    // ── Setup Mirror Loops for this zone ─────────────────────────────────────
    state.mirrorLoops = getZoneMirrorLoops(state.zoneIndex);
    state.fakeMirrors = getZoneFakeMirrors(state.zoneIndex);
    
    refreshToolsForZone();
    seedDecoration();

    for (const tablet of ZONE_NOTE_TABLETS[state.zoneIndex] ?? []) {
      if (tileAt(tablet.x, tablet.y) === 0) setTile(tablet.x, tablet.y, 17);
    }

    // ── Place key tile for this zone (if not already collected) ────────────
    const keyDef = KEY_LOCATIONS.find(k => k.zoneIndex === state.zoneIndex);
    if (keyDef && !state.keysCollected.includes(state.zoneIndex)) {
      // Place on floor; if stomped by another tile, find nearest floor
      if (tileAt(keyDef.x, keyDef.y) === 0 || tileAt(keyDef.x, keyDef.y) === 12) {
        setTile(keyDef.x, keyDef.y, 24);
      } else {
        // scan nearby for a floor tile
        outer: for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (tileAt(keyDef.x + dx, keyDef.y + dy) === 0) {
              setTile(keyDef.x + dx, keyDef.y + dy, 24);
              break outer;
            }
          }
        }
      }
    }

    // ── Block exit until all 8 keys collected ──────────────────────────────
    // (Visual cue: exit door becomes locked tile if keys missing)
    // The block is lifted dynamically in update() once all keys are found.

    // Library safe room
    if (state.zoneIndex === 6) setTile(2, 8, 12);

    ensureExitDoor();
    setTile(1, 1, 12);
    state.uiText = zone().entryText ?? zone().name;
    resetDirector();
  }

  function createSnapshot() {
    return {
      version: SAVE_VERSION,
      zoneIndex: state.zoneIndex,
      checkpointZone: state.checkpointZone,
      scores: safeClone(state.scores),
      transformState: safeClone(state.transformState),
      tools: safeClone(state.tools),
      runAttributes: safeClone(state.runAttributes),
      uiText: state.uiText,
      mandatoryCorruptionMet: state.mandatoryCorruptionMet,
      keysCollected: [...state.keysCollected],
      savedAt: Date.now(),
    };
  }

  function restoreSnapshot(snapshot) {
    const safe = sanitizeSnapshot(snapshot);
    if (!safe) return false;

    state.zoneIndex = safe.zoneIndex;
    state.checkpointZone = safe.checkpointZone;
    state.scores = safe.scores;
    state.transformState = safe.transformState;
    state.runAttributes = safeClone(snapshot.runAttributes ?? { bot: { mode: "none", name: "", hash: "", disabled: false, violations: 0, integrity: "unknown" } });
    state.completed = false;
    state.ending = null;

    resetZoneMap();

    state.tools = { ...state.tools, ...safe.tools };
    state.uiText = safe.uiText || `Recovered progress at ${zone().name}.`;
    state.mandatoryCorruptionMet = safe.mandatoryCorruptionMet;
    state.keysCollected = Array.isArray(snapshot.keysCollected) ? [...snapshot.keysCollected] : [];
    return true;
  }

  function useTool(k) {
    if (state.completed || state.tools[k] <= 0) return;
    state.tools[k] -= 1;

    if (k === "flashlight") {
      state.uiText = `Flashlight: silhouette at ${state.stalker.x},${state.stalker.y}`;
      state.scores.aiEncounters += 0.6 * CHALLENGE_MULTIPLIER;
      state.stalker.memory.recentNoises.unshift({ x: state.player.x, y: state.player.y, ttl: 80 });
    } else if (k === "tape") {
      const px = state.player.x + 1;
      const py = state.player.y;
      if (tileAt(px, py) === 0) setTile(px, py, 8);
      state.uiText = "Tape blocks a route briefly.";
    } else if (k === "candy") {
      reverseReversibleTransformations(state.transformState, 1);
      state.scores.corruptionLevel = Math.max(0, state.scores.corruptionLevel - 0.5);
      state.stalker.memory.recentNoises.unshift({ x: 18, y: 1, ttl: 60 });
      state.uiText = "Candy steadies you; a distant thump follows.";
    } else if (k === "mirrorShard") {
      state.mirrorLureTimer = 120;
      state.uiText = "Mirror shard bends sight lines.";
    } else if (k === "keyCrayon") {
      if (tileAt(15, 3) === 9) setTile(15, 3, 0);
      if (tileAt(13, 4) === 9) setTile(13, 4, 0);
      if (tileAt(22, 4) === 9) setTile(22, 4, 0);
      if (tileAt(18, 1) === 9) setTile(18, 1, 0); // library locked drawer
      state.uiText = "Crayon key scribbles a latch open.";
    }
  }

  function applyBotInput() {
    if (!state.bot.enabled) return;
    for (const key of BOT_CONTROL_KEYS) state.keys[key] = !!state.bot.input[key];
  }

  function getBotObservation() {
    return {
      tick: state.tick,
      zoneIndex: state.zoneIndex,
      player: { x: state.player.x, y: state.player.y, hide: state.player.hide },
      stalker: { x: state.stalker.x, y: state.stalker.y },
      tools: { ...state.tools },
      keysCollected: [...state.keysCollected],
      totalKeys: TOTAL_KEYS,
    };
  }

  function bindInputActions() {
    if (state.keys["1"]) useTool("flashlight");
    if (state.keys["2"]) useTool("tape");
    if (state.keys["3"]) useTool("candy");
    if (state.keys["4"]) useTool("mirrorShard");
    if (state.keys["5"]) useTool("keyCrayon");

    if (state.keys.e) {
      const tx = state.player.x + 1;
      const ty = state.player.y;
      if (tileAt(tx, ty) === 14 || tileAt(tx, ty) === 15) {
        state.uiText = "Opened quietly.";
        setTile(tx, ty, 0);
      }
      // [E] on Static TV from adjacent tile — broadcast decoy
      if (tileAt(tx, ty) === 21) {
        const decoyX = tx < 14 ? 25 : 2;
        const decoyY = ty < 5 ? 8 : 1;
        state.stalker.memory.recentNoises.unshift({ x: decoyX, y: decoyY, ttl: 180 });
        state.stalker.memory.recentNoises.unshift({ x: decoyX, y: decoyY, ttl: 170 });
        setTile(tx, ty, 0);
        state.uiText = "You smash the TV. White noise erupts across the house.";
      }
      // [E] on Chess Computer (tile 25) — open chess overlay
      if (tileAt(tx, ty) === 25 || tileAt(state.player.x, state.player.y) === 25) {
        openChessGame();
        state.keys.e = false;
        return; // don't clear other keys
      }
      state.keys.e = false;
    }

    ["1", "2", "3", "4", "5"].forEach((k) => { state.keys[k] = false; });
  }

  function applyZoneHazards() {
    const hz = zone().hazards;
    const freqMul = CHALLENGE_MODE ? 0.5 : 1;

    // Keep lighting stable to avoid random dark/bright flashing.
    state.flickerTimer = 0;
    state.lightMode = "stable";

    if (hz.lockDoors && state.tick % Math.max(80, Math.floor(260 * freqMul)) === 0) {
      setTile(14, 5, 1);
      state.doorTimer = 130;
    }
    if (state.doorTimer > 0) {
      state.doorTimer -= 1;
      if (state.doorTimer === 0) setTile(14, 5, 0);
    }

    if (hz.migration && state.tick % Math.max(80, Math.floor(220 * freqMul)) === 0) {
      const x = 3 + ((Math.random() * 22) | 0);
      const y = 1 + ((Math.random() * 8) | 0);
      if (tileAt(x, y) === 0) {
        setTile(x, y, 6);
        spawnParticle(x, y, "dust");
      }
    }

    if (hz.collapse && state.tick % Math.max(90, Math.floor(260 * freqMul)) === 0) {
      const x = 2 + ((Math.random() * 24) | 0);
      const y = 1 + ((Math.random() * 8) | 0);
      if (tileAt(x, y) === 0) {
        setTile(x, y, 7);
        state.collapseMarker = { x, y, ttl: 120 };
      }
    }

    if (state.collapseMarker) {
      state.collapseMarker.ttl -= 1;
      if (state.collapseMarker.ttl <= 0) {
        const { x, y } = state.collapseMarker;
        if (tileAt(x, y) === 7) setTile(x, y, 0);
        state.collapseMarker = null;
      }
    }

    if (hz.phantoms && state.tick % Math.max(90, Math.floor(200 * freqMul)) === 0) {
      state.phantom = { x: 2 + ((Math.random() * 24) | 0), y: 1 + ((Math.random() * 8) | 0), ttl: 90 };
    }
    if (state.phantom) {
      state.phantom.ttl -= 1;
      if (state.phantom.ttl <= 0) state.phantom = null;
    }

    // Ambient micro-cues — zone-aware flavour text (suppressed during director silence).
    if (!(state.director.actionCooldown["_ambientSilence"] > 0) &&
        state.tick % (70 + ((Math.random() * 90) | 0)) === 0) {
      const cues = zone().id === "bathroom"
        ? ["water drips upward", "the mirror is fogged from inside", "towel is wet but no one showered"]
        : zone().id === "laundry"
        ? ["machines spin on their own", "static in the drum", "something thumps with the cycle"]
        : zone().id === "library"
        ? ["pages turn without wind", "ink drips where you haven't touched", "a book falls face-down"]
        : ["clock tick stutters", "distant TV static", "muffled thump below", "floor creak somewhere"];
      state.uiText = cues[(Math.random() * cues.length) | 0];
    }

    state.particles = state.particles
      .map((p) => ({ ...p, y: p.y - 0.003, ttl: p.ttl - 1 }))
      .filter((p) => p.ttl > 0);
  }

  function applyTransformationTriggers() {
    const t = tileAt(state.player.x, state.player.y);

    // ── Standard corruption tiles ──
    if (t === 3) {
      addTransformation(state.transformState, TRANSFORM_TYPES.LIMB_ELONGATION, 1);
      state.scores.corruptionLevel += 1;
      state.mandatoryCorruptionMet = true;
      setTile(state.player.x, state.player.y, 0);
      state.uiText = "Limb elongation crawls up your frame.";
    }
    if (t === 4) {
      addTransformation(state.transformState, TRANSFORM_TYPES.CONTROL_INVERSION, 1);
      state.scores.corruptionLevel += 1;
      state.mandatoryCorruptionMet = true;
      setTile(state.player.x, state.player.y, 0);
      state.uiText = "Controls invert under the red smudge.";
    }
    if (t === 6) {
      addTransformation(state.transformState, TRANSFORM_TYPES.SPEED_REDUCTION, 1);
      state.scores.corruptionLevel += 0.8;
      setTile(state.player.x, state.player.y, 0);
      state.uiText = "Furniture jolt slows your stride.";
    }
    if (t === 10) {
      addTransformation(state.transformState, TRANSFORM_TYPES.VISUAL_OFFSET, 1);
      state.scores.corruptionLevel += 0.4;
      state.clones = [{ x: state.player.x + 1, y: state.player.y }, { x: state.player.x - 1, y: state.player.y }];
    }
    if (t === 11) {
      addTransformation(state.transformState, TRANSFORM_TYPES.HALLUCINATION_CLONE, 1);
      state.scores.corruptionLevel += 0.5;
      state.clones = [{ x: state.player.x + 2, y: state.player.y }, { x: state.player.x, y: state.player.y + 1 }];
    }
    if (t === 13) {
      state.scores.aiEncounters += 0.3;
      spawnParticle(state.player.x, state.player.y, "spark");
      state.uiText = "Loose wire crackles underfoot.";
      setTile(state.player.x, state.player.y, 0);
    }
    if (t === 7 && zone().hazards.collapse) {
      state.completed = true;
      state.ending = { id: "consumed", title: "Ending C — Consumed", text: "A trap floor takes you whole." };
    }
    if (t === 12) {
      reverseReversibleTransformations(state.transformState, 1);
      state.uiText = "Safe tile peels back reversible corruption.";
    }

    // ── NEW: Tile 16 — Fake Exit ──────────────────────────────────────────────
    // Looks like the exit (green) but triggers a trap — corruption + stalker alert.
    if (t === 16) {
      addTransformation(state.transformState, TRANSFORM_TYPES.CONTROL_INVERSION, 1);
      addTransformation(state.transformState, TRANSFORM_TYPES.SPEED_REDUCTION, 1);
      state.scores.corruptionLevel += 1.5;
      state.mandatoryCorruptionMet = true;
      setTile(state.player.x, state.player.y, 0);
      spawnParticle(state.player.x, state.player.y, "spark");
      spawnParticle(state.player.x, state.player.y, "spark");
      // The fake exit makes noise — stalker investigates your location.
      state.stalker.memory.recentNoises.unshift({ x: state.player.x, y: state.player.y, ttl: 110 });
      state.scores.aiEncounters += 0.8 * CHALLENGE_MULTIPLIER;
      state.uiText = "That wasn't the exit. The house laughs at you.";
    }

    // ── NEW: Tile 17 — Note / Document ───────────────────────────────────────
    // Reading it distracts the stalker and reveals lore. No corruption.
    if (t === 17) {
      const msg = NOTE_LORE[(state.tick % NOTE_LORE.length)];
      // Distract: redirect stalker toward a far corner, away from player.
      const decoyX = state.player.x < 10 ? 17 : 2;
      const decoyY = state.player.y < 3 ? 5 : 1;
      state.stalker.memory.recentNoises.unshift({ x: decoyX, y: decoyY, ttl: 100 });
      setTile(state.player.x, state.player.y, 0);
      state.uiText = msg;
    }

    // ── Tile 24 — KEY ITEM ────────────────────────────────────────────────────
    if (t === 24) {
      if (!state.keysCollected.includes(state.zoneIndex)) {
        state.keysCollected.push(state.zoneIndex);
      }
      setTile(state.player.x, state.player.y, 0);
      spawnParticle(state.player.x, state.player.y, "spark");
      spawnParticle(state.player.x, state.player.y, "spark");
      const remaining = TOTAL_KEYS - state.keysCollected.length;
      state.uiText = remaining > 0
        ? `Key found. ${remaining} more key${remaining > 1 ? "s" : ""} needed to escape.`
        : "All keys found. The exit is unlocked.";
    }

    // ── Basement escalation ───────────────────────────────────────────────────
    if (zone().id === "basement" && totalTransformationBurden(state.transformState) >= 4) {
      addTransformation(state.transformState, TRANSFORM_TYPES.GHOST_LIMB, 1);
      addTransformation(state.transformState, TRANSFORM_TYPES.AUDIO_DISTORTION, 1);
    }

    // ── NEW: Tile 18 — Acid Pool ──────────────────────────────────────────────
    // Chemical spill. Slows player and adds mild corruption. One-time hazard.
    if (t === 18) {
      addTransformation(state.transformState, TRANSFORM_TYPES.SPEED_REDUCTION, 1);
      state.scores.corruptionLevel += 0.6;
      state.mandatoryCorruptionMet = true;
      setTile(state.player.x, state.player.y, 0);
      spawnParticle(state.player.x, state.player.y, "spark");
      spawnParticle(state.player.x, state.player.y, "dust");
      state.uiText = "The spill burns through your shoes. You move slower.";
    }

    // ── NEW: Tile 19 — Ritual Circle ──────────────────────────────────────────
    // Arcane marking. Early zones: cleanses one transformation. Late zones: worsens.
    if (t === 19) {
      if (state.zoneIndex <= 5) {
        reverseReversibleTransformations(state.transformState, 1);
        state.uiText = "The circle hums. Something is briefly undone.";
      } else {
        addTransformation(state.transformState, TRANSFORM_TYPES.HALLUCINATION_CLONE, 1);
        state.scores.corruptionLevel += 0.7;
        state.mandatoryCorruptionMet = true;
        state.clones = [{ x: state.player.x + 2, y: state.player.y }, { x: state.player.x, y: state.player.y + 1 }];
        state.uiText = "The ritual awakens under your feet. You split in the dark.";
      }
      setTile(state.player.x, state.player.y, 0);
    }

    // ── NEW: Tile 20 — Vent / Crawlspace ─────────────────────────────────────
    // Stepping in sheds noise history — stalker briefly loses your trail.
    if (t === 20) {
      state.stalker.memory.recentNoises = state.stalker.memory.recentNoises.slice(3);
      setTile(state.player.x, state.player.y, 0);
      spawnParticle(state.player.x, state.player.y, "dust");
      state.uiText = "You duck through the vent. The trail goes cold.";
    }

    // ── NEW: Tile 21 — Static TV ──────────────────────────────────────────────
    // Activating it broadcasts a loud decoy noise to the opposite side of the map.
    if (t === 21) {
      const decoyX = state.player.x < 14 ? 25 : 2;
      const decoyY = state.player.y < 5 ? 8 : 1;
      state.stalker.memory.recentNoises.unshift({ x: decoyX, y: decoyY, ttl: 170 });
      state.stalker.memory.recentNoises.unshift({ x: decoyX, y: decoyY, ttl: 160 });
      setTile(state.player.x, state.player.y, 0);
      state.uiText = "Static erupts. Something sprints toward the other end.";
    }

    // ── NEW: Tile 22 — Cracked Floor ─────────────────────────────────────────
    // Stepping on it makes a loud noise that immediately alerts the stalker.
    if (t === 22) {
      state.stalker.memory.recentNoises.unshift({ x: state.player.x, y: state.player.y, ttl: 110 });
      state.stalker.memory.recentNoises.unshift({ x: state.player.x, y: state.player.y, ttl: 100 });
      state.scores.aiEncounters += 0.4 * CHALLENGE_MULTIPLIER;
      spawnParticle(state.player.x, state.player.y, "dust");
      setTile(state.player.x, state.player.y, 0);
      state.uiText = "The floor groans under you. It definitely heard that.";
    }

    // ── NEW: Tile 23 — Medicine Cabinet ──────────────────────────────────────
    // Restores one depleted tool, chosen at random.
    if (t === 23) {
      const depleted = Object.entries(state.tools).filter(([, v]) => v === 0);
      if (depleted.length > 0) {
        const [k] = depleted[(Math.random() * depleted.length) | 0];
        state.tools[k] = 1;
        state.uiText = `Cabinet: ${k} restored. Take it.`;
      } else {
        // Already full — grants a bonus flashlight charge
        state.tools.flashlight = Math.min(state.tools.flashlight + 1, 3);
        state.uiText = "Cabinet: extra flashlight charge. You were already stocked.";
      }
      setTile(state.player.x, state.player.y, 0);
    }
  }

  function getDetectability() {
    const limb = getTransformationStacks(state.transformState, TRANSFORM_TYPES.LIMB_ELONGATION);
    const inversion = getTransformationStacks(state.transformState, TRANSFORM_TYPES.CONTROL_INVERSION);
    const speed = getTransformationStacks(state.transformState, TRANSFORM_TYPES.SPEED_REDUCTION);
    const ghost = getTransformationStacks(state.transformState, TRANSFORM_TYPES.GHOST_LIMB);
    return 1 + limb * 0.1 + inversion * 0.08 + speed * 0.1 + ghost * 0.15;
  }

  function getPlayerNoise(moved) {
    if (!moved) return 0;
    return 1 + totalTransformationBurden(state.transformState) * 0.12;
  }

  function scoreEncounter(perception) {
    if (perception.seen) state.scores.aiEncounters += 1.3 * CHALLENGE_MULTIPLIER;
    if (perception.nearCatch) state.scores.aiEncounters += 0.5 * CHALLENGE_MULTIPLIER;
    if (perception.seen) state.scores.detections += 1;
  }

  function evaluateEnding() {
    const cl = (state.scores.corruptionLevel + totalTransformationBurden(state.transformState) * 0.5) * CHALLENGE_MULTIPLIER;
    const ae = state.scores.aiEncounters * CHALLENGE_MULTIPLIER;
    const sr = (state.scores.roomsCompleted / Math.max(1, state.scores.roomsVisited)) * 100;

    // Thresholds adjusted for 12-zone run.
    if (cl <= 3 && ae <= 5 && sr >= 85) {
      return { id: "escape", title: "Ending A — True Escape", text: "You slip free, mostly intact. The house forgets your name." };
    }
    if (cl <= 9 && ae <= 12 && sr >= 60) {
      return { id: "corrupted", title: "Ending B — Corrupted", text: "You survive, but something remains behind your eyes." };
    }
    return { id: "consumed", title: "Ending C — Consumed", text: "i was... once human, but i feel my life slipping away, into oblivion, to sleep, to die" };
  }

  function progressZone() {
    if (zone().forcedCorruption && !state.mandatoryCorruptionMet) {
      state.uiText = "This room demands corruption before you leave.";
      return;
    }
    state.scores.roomsCompleted += 1;
    state.zoneIndex += 1;
    state.scores.roomsVisited = Math.max(state.scores.roomsVisited, state.zoneIndex + 1);

    if (state.zoneIndex >= ZONES.length) {
      state.completed = true;
      state.ending = evaluateEnding();
      return;
    }
    // Checkpoint every 3 zones (instead of every 2) to match 12-room structure.
    if (state.zoneIndex % 3 === 0) state.checkpointZone = state.zoneIndex;
    resetZoneMap();
  }

  function checkpointReset() {
    state.zoneIndex = state.checkpointZone;
    state.scores.deaths += 1;
    // 3 deaths allowed in a 12-room run before hard-fail.
    if (state.scores.deaths >= 3) {
      state.completed = true;
      state.ending = { id: "consumed", title: "Ending C — Consumed", text: "It learned your every move. You gave it too many chances." };
      return;
    }
    resetZoneMap();
  }

  function isWalkableForRescue(x, y) {
    const t = tileAt(x, y);
    return ![1, 7, 8, 9, 13, 14, 15].includes(t);
  }

  function rescueFromSoftlock() {
    const candidates = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: state.player.x - 1, y: state.player.y },
      { x: state.player.x + 1, y: state.player.y },
      { x: state.player.x, y: state.player.y - 1 },
      { x: state.player.x, y: state.player.y + 1 },
    ];

    const spot = candidates.find((c) => isWalkableForRescue(c.x, c.y));
    if (!spot) {
      checkpointReset();
      state.uiText = "Softlock recovery triggered: rewound to checkpoint.";
      return;
    }

    state.player.x = spot.x;
    state.player.y = spot.y;
    state.player.renderX = spot.x;
    state.player.renderY = spot.y;
    state.stability.stalledTicks = 0;
    state.stability.lastRescueTick = state.tick;
    state.uiText = "Softlock recovery triggered: repositioned to a safe tile.";
  }

  function update() {
    if (state.completed) return;
    if (state.paused) return;

    applyBotInput();
    bindInputActions();
    state.tick += 1;
    applyZoneHazards();

    // ── Director: sample behavior BEFORE movement ─────────────────────
    const nearStalkerPre = Math.abs(state.stalker.x - state.player.x) + Math.abs(state.stalker.y - state.player.y) < 6;
    samplePlayerBehavior(false, nearStalkerPre); // pre-sample with tentative moved=false

    const wasHiding = state.player.hide;
    const moved = stepPlayer({ player: state.player, keys: state.keys, tileAt, transformState: state.transformState, tick: state.tick, mapWidth: width, mapHeight: height });

    if (moved) spawnParticle(state.player.x, state.player.y, "dust");

    const attemptingMovement = !!(state.keys.w || state.keys.a || state.keys.s || state.keys.d);
    if (!moved && attemptingMovement && !state.player.hide) state.stability.stalledTicks += 1;
    else state.stability.stalledTicks = Math.max(0, state.stability.stalledTicks - 2);

    if (state.stability.stalledTicks > 220 && state.tick - state.stability.lastRescueTick > 180) {
      rescueFromSoftlock();
    }

    // ── Director: run action loop ─────────────────────────────────────
    if (state.tick >= state.director.nextActionTick) {
      runDirector();
    }

    // Force stable lighting each frame (no random brightness swings).
    state.flickerTimer = 0;
    state.lightMode = "stable";

    notePathSpot(state.stalker, state.player);
    if (!wasHiding && state.player.hide) noteHideSpot(state.stalker, state.player);

    applyTransformationTriggers();
    updateTransformations(state.transformState);

    const perception = stepStalker({
      stalker: state.stalker,
      player: state.player,
      tileAt,
      zoneConfig: zone(),
      playerNoise: getPlayerNoise(moved),
      detectability: getDetectability(),
      cloneTargets: state.clones,
    });

    if (perception.decoySound) state.decoySound = perception.decoySound;
    if (state.decoySound) {
      state.decoySound.ttl -= 1;
      if (state.decoySound.ttl <= 0) state.decoySound = null;
    }

    scoreEncounter(perception);
    if (perception.caught) {
      checkpointReset();
      return;
    }

    if (tileAt(state.player.x, state.player.y) === 5) {
      if (state.keysCollected.length < TOTAL_KEYS) {
        const remaining = TOTAL_KEYS - state.keysCollected.length;
        state.uiText = `Locked. Find ${remaining} more key${remaining > 1 ? "s" : ""} first.`;
        // Rattle the stalker toward the player — they hesitated at the door
        state.stalker.memory.recentNoises.unshift({ x: state.player.x, y: state.player.y, ttl: 60 });
      } else {
        progressZone();
      }
    }
  }

  function drawTile(x, y, t) {
    const bx = x * TILE;
    const by = y * TILE;

    // Use enhanced tile renderer when sprites not available
    if (!spriteAssets.tiles) {
      tileRenderer.drawTile(x, y, t, state.tick);
      return;
    }

    const tileSpriteMap = {
      0: [0, 0],
      1: [1, 0],
      2: [2, 0],
      3: [3, 0],
      4: [4, 0],
      5: [5, 0],
      6: [6, 0],
      7: [7, 0],
      8: [0, 1],
      9: [1, 1],
      10: [2, 1],
      11: [3, 1],
      12: [4, 1],
      13: [5, 1],
      14: [6, 1],
      15: [7, 1],
      16: [0, 2],
      17: [1, 2],
      18: [2, 2],
      19: [3, 2],
      20: [4, 2],
      21: [5, 2],
      22: [6, 2],
      23: [7, 2],
    };
    const spriteCoord = tileSpriteMap[t] || tileSpriteMap[0];
    const drewSprite = drawTileFromSheet(spriteCoord[0], spriteCoord[1], x, y);

    if (!drewSprite) {
      switch (t) {
      case  1: ctx.fillStyle = "#2a0838"; break; // wall
      case  2: ctx.fillStyle = "#8f89d9"; break; // hide
      case  3: ctx.fillStyle = "#662044"; break; // ink
      case  4: ctx.fillStyle = "#1f9d87"; break; // corruption
      case  5: ctx.fillStyle = "#76da8d"; break; // exit (true green)
      case  6: ctx.fillStyle = "#7a4a2d"; break; // moved furniture
      case  7: ctx.fillStyle = "#1f1c24"; break; // collapse
      case  8: ctx.fillStyle = "#3f4231"; break; // block
      case  9: ctx.fillStyle = "#9e7b2c"; break; // locked
      case 10: ctx.fillStyle = "#4e5ea0"; break; // hallucination
      case 11: ctx.fillStyle = "#69549c"; break; // mirror
      case 12: ctx.fillStyle = "#3f9362"; break; // reversal/safe
      case 13: ctx.fillStyle = "#7b6c5e"; break; // tiny hazard
      case 14:
      case 15: ctx.fillStyle = "#5e3a2d"; break; // door / drawer
      // ── NEW TILES ────────────────────────────────────────────
      case 16: ctx.fillStyle = "#a1d975"; break; // fake exit — slightly yellow-green, uncanny
      case 17: ctx.fillStyle = "#c6a26b"; break; // note/document — warm paper tan
      // ── NEW OBJECT TILES ─────────────────────────────────────
      case 18: ctx.fillStyle = "#1e4a12"; break; // acid pool — sickly dark green
      case 19: ctx.fillStyle = "#4a0e24"; break; // ritual circle — deep blood crimson
      case 20: ctx.fillStyle = "#3a4a58"; break; // vent/crawlspace — steely gray-blue
      case 21: ctx.fillStyle = "#0d0d20"; break; // static TV — deep navy
      case 22: ctx.fillStyle = "#2a2424"; break; // cracked floor
      case 23: ctx.fillStyle = "#7aa8a8"; break; // medicine cabinet — pale teal
      case 24: ctx.fillStyle = "#f0d060"; break; // key item — gold
      // ─────────────────────────────────────────────────────────
        default: ctx.fillStyle = "#18031f";         // floor
      }
      ctx.fillRect(bx, by, TILE, TILE);
    }

    if (t === 0) {
      const backgroundBand = y <= 4;
      if (backgroundBand) {
        ctx.fillStyle = "rgba(95, 68, 120, 0.30)";
        ctx.fillRect(bx, by, TILE, TILE);
        ctx.fillStyle = "rgba(0, 0, 0, 0.13)";
        ctx.fillRect(bx, by + TILE - 10, TILE, 10);
      } else {
        ctx.fillStyle = "rgba(125, 82, 52, 0.30)";
        if ((x + y) % 2 === 0) ctx.fillRect(bx + 1, by + 1, TILE - 2, TILE - 2);
        ctx.fillStyle = "rgba(0, 0, 0, 0.24)";
        ctx.fillRect(bx, by + TILE - 3, TILE, 3);
      }
    }

    if (t === 1) {
      ctx.fillStyle = "#4b1465";
      ctx.fillRect(bx, by, TILE, 2);
      ctx.fillStyle = "rgba(214, 154, 231, 0.2)";
      ctx.fillRect(bx + 2, by + 3, 2, 2);
      ctx.fillRect(bx + 10, by + 7, 2, 2);
      ctx.fillStyle = "rgba(35, 10, 48, 0.5)";
      ctx.fillRect(bx, by + TILE - 2, TILE, 2);
    }

    if (t === 14 || t === 15) {
      // Bigger, more readable door/drawer treatment with paneling.
      ctx.fillStyle = t === 14 ? "#6e4a32" : "#7a5637";
      ctx.fillRect(bx + 2, by + 2, TILE - 4, TILE - 4);

      ctx.fillStyle = "rgba(255,230,180,0.16)";
      ctx.fillRect(bx + 5, by + 6, TILE - 10, 5);
      ctx.fillRect(bx + 7, by + 16, TILE - 14, TILE - 26);

      ctx.strokeStyle = "rgba(35,18,10,0.45)";
      ctx.strokeRect(bx + 8, by + 17, TILE - 16, TILE - 28);

      ctx.fillStyle = "rgba(230,185,120,0.75)";
      ctx.fillRect(bx + TILE - 13, by + 28, 4, 4);

      ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
      ctx.fillRect(bx + 3, by + TILE - 6, TILE - 6, 3);
    }

    // Tile 16: add a subtle red flicker at the edge so sharp players can notice.
    if (t === 16) {
      ctx.fillStyle = "rgba(200,40,40,0.08)";
      ctx.fillRect(x * TILE, y * TILE, TILE, 2);
      ctx.fillRect(x * TILE, y * TILE + TILE - 2, TILE, 2);
    }

    // Tile 17: draw a tiny page icon.
    if (t === 17) {
      ctx.fillStyle = "rgba(80,50,20,0.35)";
      ctx.fillRect(bx + 4, by + 3, 8, 10);
      ctx.fillStyle = "rgba(200,180,140,0.6)";
      ctx.fillRect(bx + 5, by + 5, 6, 1);
      ctx.fillRect(bx + 5, by + 7, 6, 1);
      ctx.fillRect(bx + 5, by + 9, 4, 1);
    }

    // Tile 18: Acid pool — bubbling chemical spill with sickly shimmer
    if (t === 18) {
      // Pool edge
      ctx.fillStyle = "rgba(40,180,20,0.30)";
      ctx.fillRect(bx + 4, by + 6, TILE - 8, TILE - 14);
      // Bubble clusters
      ctx.fillStyle = "rgba(80,220,40,0.50)";
      ctx.fillRect(bx + 8,  by + 10, 4, 4);
      ctx.fillRect(bx + 18, by + 14, 3, 3);
      ctx.fillRect(bx + 30, by + 9,  5, 5);
      ctx.fillRect(bx + 44, by + 13, 3, 3);
      ctx.fillRect(bx + 52, by + 9,  4, 4);
      // Highlight streaks (oily sheen)
      ctx.fillStyle = "rgba(160,255,80,0.18)";
      ctx.fillRect(bx + 6,  by + 8,  20, 2);
      ctx.fillRect(bx + 34, by + 16, 14, 2);
      // Dark edge drips
      ctx.fillStyle = "rgba(10,60,5,0.55)";
      ctx.fillRect(bx + 4,  by + 6, 2, 6);
      ctx.fillRect(bx + TILE - 6, by + 8, 2, 8);
      ctx.fillRect(bx + 10, by + TILE - 8, 6, 3);
    }

    // Tile 19: Ritual circle — painted sigil with concentric rings
    if (t === 19) {
      ctx.strokeStyle = "rgba(200,40,60,0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(bx + 32, by + 32, 24, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(bx + 32, by + 32, 16, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "rgba(255,80,80,0.30)";
      ctx.beginPath(); ctx.arc(bx + 32, by + 32, 8,  0, Math.PI * 2); ctx.stroke();
      // Cross in center
      ctx.fillStyle = "rgba(200,40,60,0.45)";
      ctx.fillRect(bx + 30, by + 20, 4, 24);
      ctx.fillRect(bx + 20, by + 30, 24, 4);
      // Dot accents at cardinal points
      ctx.fillStyle = "rgba(255,120,120,0.50)";
      ctx.fillRect(bx + 30, by + 8,  4, 4);
      ctx.fillRect(bx + 30, by + 52, 4, 4);
      ctx.fillRect(bx + 8,  by + 30, 4, 4);
      ctx.fillRect(bx + 52, by + 30, 4, 4);
      ctx.lineWidth = 1;
    }

    // Tile 20: Vent/crawlspace — metal grate with slats and rivets
    if (t === 20) {
      // Grate bars (horizontal)
      ctx.fillStyle = "rgba(160,185,210,0.55)";
      for (let i = 0; i < 5; i++) ctx.fillRect(bx + 4, by + 8 + i * 10, TILE - 8, 4);
      // Vertical dividers
      ctx.fillStyle = "rgba(100,130,160,0.40)";
      ctx.fillRect(bx + 22, by + 4, 4, TILE - 8);
      ctx.fillRect(bx + 38, by + 4, 4, TILE - 8);
      // Corner rivets
      ctx.fillStyle = "rgba(220,230,240,0.60)";
      ctx.fillRect(bx + 6,  by + 6,  4, 4);
      ctx.fillRect(bx + 54, by + 6,  4, 4);
      ctx.fillRect(bx + 6,  by + 54, 4, 4);
      ctx.fillRect(bx + 54, by + 54, 4, 4);
      // Frame
      ctx.strokeStyle = "rgba(140,165,190,0.60)";
      ctx.strokeRect(bx + 3, by + 3, TILE - 6, TILE - 6);
    }

    // Tile 21: Static TV — cathode-ray screen with scan lines and noise
    if (t === 21) {
      // Screen face
      ctx.fillStyle = "rgba(20,20,50,0.85)";
      ctx.fillRect(bx + 8, by + 8, TILE - 16, TILE - 20);
      // Scan lines
      ctx.fillStyle = "rgba(80,80,160,0.20)";
      for (let i = 0; i < 7; i++) ctx.fillRect(bx + 8, by + 8 + i * 6, TILE - 16, 2);
      // Static noise dots
      ctx.fillStyle = "rgba(200,200,255,0.35)";
      for (const [dx, dy] of [[12,12],[24,18],[36,14],[46,22],[16,30],[44,34],[20,44],[38,40]]) {
        ctx.fillRect(bx + dx, by + dy, 2, 2);
      }
      // Screen glow
      ctx.fillStyle = "rgba(40,40,200,0.08)";
      ctx.fillRect(bx + 6, by + 6, TILE - 12, TILE - 18);
      // TV body frame
      ctx.strokeStyle = "rgba(100,100,120,0.55)";
      ctx.strokeRect(bx + 6, by + 6, TILE - 12, TILE - 18);
      // Speaker grille below screen
      ctx.fillStyle = "rgba(80,80,100,0.45)";
      for (let i = 0; i < 4; i++) ctx.fillRect(bx + 14 + i * 9, by + TILE - 12, 4, 4);
    }

    // Tile 22: Cracked floor — spider fracture lines radiating from center
    if (t === 22) {
      // Base floor first
      ctx.fillStyle = "#18031f";
      ctx.fillRect(bx, by, TILE, TILE);
      // Crack lines
      ctx.strokeStyle = "rgba(160,100,100,0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx + 32, by + 32); ctx.lineTo(bx + 8,  by + 8);
      ctx.moveTo(bx + 32, by + 32); ctx.lineTo(bx + 56, by + 14);
      ctx.moveTo(bx + 32, by + 32); ctx.lineTo(bx + 60, by + 48);
      ctx.moveTo(bx + 32, by + 32); ctx.lineTo(bx + 10, by + 56);
      ctx.moveTo(bx + 32, by + 32); ctx.lineTo(bx + 32, by + 4);
      ctx.moveTo(bx + 32, by + 32); ctx.lineTo(bx + 4,  by + 36);
      ctx.stroke();
      // Secondary hairline cracks
      ctx.strokeStyle = "rgba(120,70,70,0.30)";
      ctx.beginPath();
      ctx.moveTo(bx + 18, by + 16); ctx.lineTo(bx + 30, by + 28);
      ctx.moveTo(bx + 44, by + 20); ctx.lineTo(bx + 36, by + 30);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Tile 23: Medicine cabinet — white door with red cross
    if (t === 23) {
      // Cabinet face
      ctx.fillStyle = "rgba(160,210,210,0.50)";
      ctx.fillRect(bx + 8, by + 6, TILE - 16, TILE - 14);
      // Hinge marks
      ctx.fillStyle = "rgba(100,150,150,0.65)";
      ctx.fillRect(bx + 10, by + 10, 3, 4);
      ctx.fillRect(bx + 10, by + TILE - 22, 3, 4);
      // Red cross symbol
      ctx.fillStyle = "rgba(200,30,30,0.70)";
      ctx.fillRect(bx + 27, by + 18, 10, 28);
      ctx.fillRect(bx + 18, by + 27, 28, 10);
      // Cabinet edge frame
      ctx.strokeStyle = "rgba(100,160,160,0.65)";
      ctx.strokeRect(bx + 7, by + 5, TILE - 14, TILE - 12);
      // Door handle
      ctx.fillStyle = "rgba(180,210,210,0.70)";
      ctx.fillRect(bx + TILE - 16, by + 28, 4, 8);
    }

    // Tile 24: Key item — glowing golden key with teeth and bow
    if (t === 24) {
      const pulse = 0.55 + 0.25 * Math.sin(state.tick * 0.12);
      // Glow aura
      ctx.fillStyle = `rgba(255,220,40,${pulse * 0.22})`;
      ctx.fillRect(bx + 8, by + 8, TILE - 16, TILE - 16);
      // Key bow (ring)
      ctx.strokeStyle = `rgba(240,190,30,${0.85})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(bx + 22, by + 22, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(240,190,30,0.90)";
      ctx.beginPath();
      ctx.arc(bx + 22, by + 22, 4, 0, Math.PI * 2);
      ctx.fill();
      // Key shaft
      ctx.fillStyle = "rgba(240,190,30,0.95)";
      ctx.fillRect(bx + 29, by + 20, 22, 5);
      // Key teeth (two cuts)
      ctx.fillRect(bx + 38, by + 25, 4, 5);
      ctx.fillRect(bx + 46, by + 25, 4, 5);
      // Inner bow hole
      ctx.fillStyle = `rgba(24,3,31,${0.70})`;
      ctx.beginPath();
      ctx.arc(bx + 22, by + 22, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1;
      // Tiny sparkle dots
      ctx.fillStyle = "rgba(255,245,180,0.80)";
      for (const [sx, sy] of [[18,10],[34,12],[50,14],[14,30],[42,34]]) {
        ctx.fillRect(bx + sx, by + sy, 2, 2);
      }
    }

    // Tile 25: Chess computer — small desktop PC with chess screen glow
    if (t === 25) {
      // Desk surface
      ctx.fillStyle = "#3a2e24";
      ctx.fillRect(bx + 4, by + 42, TILE - 8, 14);
      // Monitor stand
      ctx.fillStyle = "#1c1c1c";
      ctx.fillRect(bx + 24, by + 36, 16, 8);
      ctx.fillRect(bx + 18, by + 44, 28, 4);
      // Monitor body
      ctx.fillStyle = "#252525";
      ctx.fillRect(bx + 8, by + 8, TILE - 16, 30);
      ctx.strokeStyle = "#444";
      ctx.strokeRect(bx + 8, by + 8, TILE - 16, 30);
      // Screen: chess board pattern
      const pulse = 0.6 + 0.15 * Math.sin(state.tick * 0.08);
      ctx.fillStyle = `rgba(100,160,220,${pulse * 0.7})`;
      ctx.fillRect(bx + 11, by + 11, TILE - 22, 24);
      const sq = 3;
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 5; col++) {
          if ((row + col) % 2 === 0) {
            ctx.fillStyle = `rgba(255,255,255,${pulse * 0.35})`;
          } else {
            ctx.fillStyle = `rgba(40,90,180,${pulse * 0.5})`;
          }
          ctx.fillRect(bx + 13 + col * sq * 2, by + 13 + row * sq * 2, sq * 2 - 1, sq * 2 - 1);
        }
      }
      // Keyboard
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(bx + 10, by + 49, 36, 7);
      ctx.fillStyle = "#333";
      for (let k = 0; k < 6; k++) ctx.fillRect(bx + 12 + k * 5, by + 51, 4, 3);
      // Mouse
      ctx.fillStyle = "#222";
      ctx.fillRect(bx + 50, by + 51, 8, 5);
      ctx.fillRect(bx + 54, by + 52, 1, 3);
      // Status LED
      const led = state.zoneIndex === 7 ? `rgba(80,220,80,${pulse})` : "rgba(80,80,80,0.5)";
      ctx.fillStyle = led;
      ctx.fillRect(bx + TILE - 16, by + 10, 3, 3);
      // "CHESS" label below screen
      ctx.fillStyle = "rgba(120,200,255,0.7)";
      ctx.font = "5px monospace";
      ctx.fillText("CHESS", bx + 15, by + 57);
    }
  }


  function drawReferenceRoomComposition() {
    // Match the reference structure: clear wall/floor split and grounded props.
    const floorTop = Math.floor(canvas.height * 0.78);
    const floorHeight = canvas.height - floorTop;

    // Wall (dark) / floor (lighter) separation.
    ctx.fillStyle = "#2a1742";
    ctx.fillRect(0, 0, canvas.width, floorTop);
    ctx.fillStyle = "#3a2458";
    ctx.fillRect(0, floorTop, canvas.width, floorHeight);

    // Ceiling trim + wallpaper dots for flat 2D backdrop.
    ctx.fillStyle = "rgba(240,205,130,0.70)";
    ctx.fillRect(0, 10, canvas.width, 2);
    ctx.fillRect(0, 14, canvas.width, 1);
    ctx.fillStyle = "rgba(255,225,155,0.13)";
    for (let x = 8; x < canvas.width; x += 28) {
      ctx.fillRect(x, 22, 8, 2);
      ctx.fillRect(x + 6, 40, 6, 2);
    }

    // Left arch doorway.
    ctx.fillStyle = "#100a18";
    ctx.fillRect(14, 30, 30, 58);
    ctx.beginPath();
    ctx.arc(29, 30, 15, Math.PI, Math.PI * 2);
    ctx.fill();

    // Left wall painting.
    ctx.fillStyle = "#8f6c3b";
    ctx.fillRect(80, 30, 74, 56);
    ctx.fillStyle = "#36563f";
    ctx.fillRect(86, 36, 62, 44);
    ctx.fillStyle = "rgba(235,235,205,0.42)";
    ctx.fillRect(98, 44, 36, 20);

    // Small side table + candle.
    const tableY = floorTop - 34;
    ctx.fillStyle = "#6f5132";
    ctx.fillRect(8, tableY, 38, 6);
    ctx.fillStyle = "rgba(28,18,12,0.58)";
    ctx.fillRect(10, tableY + 6, 34, 16);
    ctx.fillStyle = "#ddd2a8";
    ctx.fillRect(20, tableY - 9, 3, 9);
    ctx.fillStyle = "#ffd072";
    ctx.fillRect(20, tableY - 11, 3, 2);

    // Center hanging ornament (chandelier cue).
    const cx = Math.floor(canvas.width * 0.44);
    ctx.fillStyle = "#d6af52";
    ctx.fillRect(cx, 8, 3, 28);
    ctx.fillRect(cx - 16, 20, 35, 3);

    // TV near floor, slightly left of center, with shadow.
    const tvW = 72;
    const tvH = 48;
    const tvX = Math.floor(canvas.width * 0.47) - tvW // left of center
      ;
    const tvY = floorTop - tvH - 8;
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(tvX - 6, floorTop - 6, tvW + 22, 6);
    ctx.fillStyle = "#6e5831";
    ctx.fillRect(tvX - 8, tvY - 8, tvW + 16, tvH + 14);
    ctx.fillStyle = "#dbe8d2";
    ctx.fillRect(tvX, tvY, tvW, tvH);
    ctx.fillStyle = "rgba(182,255,190,0.42)";
    ctx.fillRect(tvX + 4, tvY + 4, tvW - 8, tvH - 8);
    ctx.fillStyle = "rgba(255,120,120,0.88)";
    ctx.fillRect(tvX + 18, tvY + 18, 8, 12);
    ctx.fillRect(tvX + 39, tvY + 19, 8, 11);
    ctx.fillStyle = "rgba(255,230,170,0.80)";
    ctx.fillRect(tvX + 19, tvY + 14, 6, 3);
    ctx.fillRect(tvX + 40, tvY + 15, 6, 3);
    ctx.fillStyle = "#2a1f18";
    ctx.fillRect(tvX - 2, tvY + tvH, tvW + 4, 6);

    // Small wall objects near right.
    ctx.strokeStyle = "rgba(226,184,102,0.70)";
    ctx.strokeRect(canvas.width - 142, 28, 18, 24);
    ctx.fillStyle = "#2f2438";
    ctx.fillRect(canvas.width - 98, 44, 30, 30);
    ctx.fillStyle = "rgba(230,236,248,0.82)";
    ctx.fillRect(canvas.width - 88, 54, 10, 12);

    // Right door with shadow (grounded to floor line).
    const doorW = 96;
    const doorH = 124;
    const doorX = canvas.width - 150;
    const doorY = floorTop - doorH;
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(doorX + 8, floorTop - 6, doorW - 16, 6);
    ctx.fillStyle = "#2d241e";
    ctx.fillRect(doorX, doorY, doorW, doorH);
    ctx.fillStyle = "rgba(72,45,30,0.56)";
    ctx.fillRect(doorX + 10, doorY + 10, 76, doorH - 20);
    ctx.fillStyle = "rgba(250,220,150,0.22)";
    ctx.fillRect(doorX + 18, doorY + 14, 60, 8);
    ctx.fillStyle = "rgba(230,188,116,0.86)";
    ctx.fillRect(doorX + 72, doorY + 68, 6, 6);

    // Top-right hanging lamp for vertical context.
    ctx.fillStyle = "#b9976c";
    ctx.beginPath();
    ctx.arc(canvas.width - 42, 20, 16, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(canvas.width - 44, 8, 4, 12);
  }


  function drawRoomStyling() {
    if (state.zoneIndex === 0) {
      drawReferenceRoomComposition();
      return;
    }

    const zid = zone().id;
    const isBedroomLike = zid === "bedroom" || zid === "entrance";

    const style = isBedroomLike
      ? {
        wall: zid === "entrance" ? "#3d2f28" : "#33413a",
        wallDark: zid === "entrance" ? "#201613" : "#1d2723",
        wallPattern: zid === "entrance" ? "rgba(130,95,74,0.26)" : "rgba(110,135,118,0.24)",
        trim: "#b0802d",
        floor: zid === "entrance" ? "#2f2621" : "#29332d",
        floorEdge: "#070409",
        archDark: zid === "entrance" ? "#19110f" : "#141d19",
        door: zid === "entrance" ? "#3a2d24" : "#2e3a33",
        doorShade: zid === "entrance" ? "rgba(83,52,35,0.35)" : "rgba(52,78,64,0.34)",
        lamp: zid === "entrance" ? "#9f7f5d" : "#7fa890",
      }
      : {
        wall: zid === "bathroom" ? "#2f3a44" : zid === "kitchen" ? "#4a3e30" : zid === "basement" ? "#2a2a2f" : "#4c4037",
        wallDark: zid === "bathroom" ? "#1f2830" : zid === "kitchen" ? "#2f271f" : zid === "basement" ? "#19191d" : "#2f2722",
        wallPattern: zid === "bathroom" ? "rgba(120,150,170,0.16)" : zid === "kitchen" ? "rgba(150,120,90,0.18)" : "rgba(130,105,90,0.18)",
        trim: "#7f6442",
        floor: zid === "bathroom" ? "#2a3137" : zid === "basement" ? "#1a1a1e" : "#322a24",
        floorEdge: "#0c0c0f",
        archDark: "#151317",
        door: "#342b24",
        doorShade: "rgba(0,0,0,0.25)",
        lamp: zid === "bathroom" ? "#7ca0b7" : "#8f7f6a",
      };

    ctx.fillStyle = style.wallDark;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Wall body + subtle texture banding.
    ctx.fillStyle = style.wall;
    ctx.fillRect(0, 8, canvas.width, canvas.height - 40);
    ctx.fillStyle = style.wallPattern;
    for (let x = 0; x < canvas.width; x += 14) {
      ctx.fillRect(x, 22, 8, 2);
      ctx.fillRect(x + 4, 38, 6, 2);
    }

    // Add rough child-paint washes so walls feel less flat/uniform.
    ctx.fillStyle = isBedroomLike ? "rgba(166,118,72,0.10)" : "rgba(88,126,114,0.08)";
    ctx.fillRect(0, 54, canvas.width, 22);
    ctx.fillStyle = isBedroomLike ? "rgba(93,121,84,0.10)" : "rgba(152,96,86,0.07)";
    ctx.fillRect(0, canvas.height - 84, canvas.width, 20);

    // Trim lines and crown rail.
    ctx.fillStyle = style.trim;
    ctx.fillRect(0, 6, canvas.width, 2);
    ctx.fillRect(0, 10, canvas.width, 1);

    // Left doorway/arch silhouette.
    ctx.fillStyle = style.archDark;
    ctx.fillRect(12, 28, 26, 44);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.arc(25, 28, 13, Math.PI, Math.PI * 2);
    ctx.fill();

    // Ceiling light fixture.
    const cx = Math.floor(canvas.width * 0.44);
    ctx.fillStyle = style.trim;
    ctx.fillRect(cx, 10, 2, 22);
    ctx.fillRect(cx - 18, 22, 38, 2);

    // Left framed art.
    ctx.fillStyle = isBedroomLike ? "#13251b" : "#3a342e";
    ctx.fillRect(76, 34, 58, 34);
    ctx.strokeStyle = "rgba(177, 133, 66, 0.7)";
    ctx.strokeRect(74, 32, 62, 38);

    // Large windows to make room dressing feel bigger and less flat.
    const winY = 28;
    ctx.fillStyle = "rgba(42,28,20,0.86)";
    ctx.fillRect(168, winY, 110, 60);
    ctx.fillRect(302, winY, 110, 60);
    ctx.fillStyle = isBedroomLike ? "rgba(168,206,212,0.34)" : "rgba(176,197,216,0.26)";
    ctx.fillRect(173, winY + 5, 100, 50);
    ctx.fillRect(307, winY + 5, 100, 50);
    ctx.fillStyle = "rgba(220,200,150,0.40)";
    ctx.fillRect(221, winY + 5, 4, 50);
    ctx.fillRect(355, winY + 5, 4, 50);
    ctx.fillRect(173, winY + 28, 100, 3);
    ctx.fillRect(307, winY + 28, 100, 3);

    // Center focal frame area.
    const fx = Math.floor(canvas.width * 0.50) - 38;
    const fy = 74;
    ctx.fillStyle = isBedroomLike ? "#8a6231" : "#7a6b58";
    ctx.fillRect(fx - 6, fy - 6, 78, 56);
    ctx.fillStyle = isBedroomLike ? "#f4e0af" : "#d9d5ca";
    ctx.fillRect(fx, fy, 66, 44);
    ctx.fillStyle = isBedroomLike ? "rgba(152,255,190,0.45)" : "rgba(189,204,214,0.35)";
    ctx.fillRect(fx + 4, fy + 4, 58, 36);

    // Right-side clock/art accent.
    ctx.strokeStyle = "rgba(177, 133, 66, 0.62)";
    ctx.strokeRect(canvas.width - 126, 30, 18, 24);
    ctx.fillStyle = "#1f102f";
    ctx.fillRect(canvas.width - 88, 44, 30, 32);
    ctx.fillStyle = "rgba(238, 240, 255, 0.72)";
    ctx.fillRect(canvas.width - 78, 54, 10, 12);

    // Right-side door: keep it substantial, but not full-screen tall.
    const doorY = 56;
    const doorH = 120;
    const doorX = canvas.width - 146;
    ctx.fillStyle = style.door;
    ctx.fillRect(doorX, doorY, 94, doorH);
    ctx.fillStyle = style.doorShade;
    ctx.fillRect(doorX + 9, doorY + 10, 76, doorH - 20);
    ctx.fillStyle = "rgba(255,220,150,0.20)";
    ctx.fillRect(doorX + 16, doorY + 14, 62, 7);
    ctx.fillStyle = "rgba(220,178,116,0.74)";
    ctx.fillRect(doorX + 70, doorY + 66, 6, 6);

    // Hanging lamp glow.
    ctx.fillStyle = style.lamp;
    ctx.beginPath();
    ctx.arc(canvas.width - 44, 20, 16, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(canvas.width - 46, 6, 4, 14);

    // Floor + foreground strip.
    ctx.fillStyle = style.floor;
    ctx.fillRect(0, canvas.height - 34, canvas.width, 34);
    ctx.fillStyle = style.floorEdge;
    ctx.fillRect(0, canvas.height - 8, canvas.width, 8);

    // Base object pass: larger furniture-like blocks with chunkier silhouettes.
    ctx.fillStyle = "rgba(35, 25, 18, 0.60)";
    for (const [x, y, w, h] of [[48, 78, 44, 24], [136, 72, 38, 30], [224, 76, 44, 24], [314, 78, 40, 22], [430, 72, 44, 28]]) {
      ctx.fillRect(x, y, w, h);
    }
    ctx.fillStyle = "rgba(120, 24, 24, 0.35)";
    for (const [x, y, w, h] of [[90, canvas.height - 22, 26, 8], [282, canvas.height - 20, 30, 9], [466, canvas.height - 24, 24, 8]]) {
      ctx.fillRect(x, y, w, h);
    }

    // Room-specific object placeholders for house realism.
    if (zid === "entrance") {
      const F = canvas.height;
      // ── Coat rack (tall, with hooks and hanging coats) ────────────────────
      ctx.fillStyle = "#3a2818"; ctx.fillRect(44, F-88, 8, 52); // pole
      ctx.fillRect(34, F-88, 28, 4); // crossbar
      // hooks
      for (const hx of [36, 46, 56]) {
        ctx.fillStyle = "#8a7050"; ctx.fillRect(hx, F-88, 4, 4);
        ctx.fillRect(hx+1, F-85, 3, 7);
      }
      // hanging coats (shapes)
      ctx.fillStyle = "#2a3850"; ctx.fillRect(35, F-80, 10, 22); // dark coat
      ctx.fillStyle = "#6a3828"; ctx.fillRect(46, F-80, 10, 18); // brown coat
      ctx.fillStyle = "#1e3020"; ctx.fillRect(56, F-80, 8, 15); // jacket
      // ── Shoe bench with shoes underneath ─────────────────────────────────
      ctx.fillStyle = "#5c4028"; ctx.fillRect(76, F-52, 90, 12); // bench seat
      ctx.fillStyle = "#3a2618"; ctx.fillRect(80, F-40, 10, 8); // legs
      ctx.fillStyle = "#3a2618"; ctx.fillRect(148, F-40, 10, 8);
      ctx.fillStyle = "#3e3020"; ctx.fillRect(80, F-38, 16, 8); // shoe 1
      ctx.fillStyle = "#2a2018"; ctx.fillRect(100, F-38, 14, 7); // shoe 2
      ctx.fillStyle = "#3a4030"; ctx.fillRect(120, F-38, 14, 7); // shoe 3
      ctx.fillStyle = "#4a3830"; ctx.fillRect(140, F-38, 16, 8); // shoe 4
      // laces
      ctx.strokeStyle = "rgba(220,200,160,0.5)"; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(83, F-35); ctx.lineTo(93, F-33); ctx.stroke();
      // ── Umbrella stand ────────────────────────────────────────────────────
      ctx.fillStyle = "#2a3a4a"; ctx.fillRect(178, F-62, 14, 28); // cylinder
      ctx.fillStyle = "#1e2c3a"; ctx.fillRect(180, F-34, 10, 4); // base
      // umbrella handles
      ctx.strokeStyle = "#5c7890"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(182, F-62); ctx.lineTo(182, F-72);
      ctx.arc(184, F-72, 2, Math.PI, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(188, F-62); ctx.lineTo(188, F-74);
      ctx.arc(190, F-74, 2, Math.PI, 0); ctx.stroke();
      // ── Small table by door with keys bowl ───────────────────────────────
      ctx.fillStyle = "#4a3828"; ctx.fillRect(204, F-56, 36, 8);
      ctx.fillStyle = "#3a2c1e"; ctx.fillRect(208, F-48, 6, 12); ctx.fillRect(226, F-48, 6, 12);
      // bowl with keys
      ctx.fillStyle = "#6a5838"; ctx.fillRect(210, F-58, 20, 6);
      ctx.fillStyle = "#c8a830"; ctx.fillRect(214, F-58, 4, 3); // key
      ctx.fillStyle = "#c83030"; ctx.fillRect(220, F-58, 3, 3); // key fob
      // ── Welcome mat ──────────────────────────────────────────────────────
      ctx.fillStyle = "rgba(80,40,30,0.6)"; ctx.fillRect(30, F-20, 120, 10);
      ctx.fillStyle = "rgba(120,60,50,0.4)"; 
      for (let mx=36; mx<144; mx+=8) ctx.fillRect(mx, F-20, 4, 10);
      // ── Wall mirror with decorative frame ────────────────────────────────
      ctx.fillStyle = "#5a3e28"; ctx.fillRect(252, 30, 44, 60);
      ctx.fillStyle = "rgba(190,210,225,0.42)"; ctx.fillRect(256, 34, 36, 52);
      ctx.strokeStyle = "#8a6840"; ctx.lineWidth = 2;
      ctx.strokeRect(252, 30, 44, 60);
      ctx.fillStyle = "rgba(255,255,255,0.20)"; ctx.fillRect(258, 36, 8, 40);
      // ── Wall phone ───────────────────────────────────────────────────────
      ctx.fillStyle = "#2a2a2a"; ctx.fillRect(318, 44, 22, 32);
      ctx.fillStyle = "#1a1a1a"; ctx.fillRect(320, 46, 18, 16);
      ctx.fillStyle = "#333"; ctx.fillRect(322, 66, 6, 4); ctx.fillRect(330, 66, 6, 4);
      ctx.lineWidth = 1;
    } else if (zid === "hallway") {
      const F = canvas.height;
      // ── Console table (narrow, elegant) ──────────────────────────────────
      ctx.fillStyle = "#6a5040"; ctx.fillRect(188, F-66, 128, 8);
      ctx.fillStyle = "#4e3c2c"; ctx.fillRect(194, F-58, 6, 20); ctx.fillRect(302, F-58, 6, 20);
      // Items on console table
      ctx.fillStyle = "#3a2818"; ctx.fillRect(196, F-70, 18, 12); // small vase
      ctx.fillStyle = "#709060"; ctx.fillRect(198, F-80, 6, 12); // plant stem
      ctx.fillStyle = "#506840"; ctx.beginPath(); ctx.arc(201, F-80, 5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#c8b880"; ctx.fillRect(222, F-70, 10, 8); // candle holder
      ctx.fillStyle = "#e8e0b0"; ctx.fillRect(225, F-80, 4, 12); // candle
      ctx.fillStyle = "#ff8820"; ctx.beginPath(); ctx.arc(227, F-81, 2, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#808080"; ctx.fillRect(270, F-68, 22, 6); // small tray
      // ── Gallery wall (5 framed pictures) ─────────────────────────────────
      const pics = [[60,34,26,18],[92,30,22,22],[120,36,28,16],[152,32,20,20],[178,28,24,22]];
      const innerColors = ["rgba(80,110,70,0.5)","rgba(70,80,120,0.5)","rgba(120,80,70,0.5)","rgba(90,70,110,0.5)","rgba(70,100,100,0.5)"];
      pics.forEach(([fx,fy,fw,fh], i) => {
        ctx.fillStyle = "#5a4030"; ctx.fillRect(fx-2, fy-2, fw+4, fh+4);
        ctx.fillStyle = innerColors[i]; ctx.fillRect(fx, fy, fw, fh);
        ctx.strokeStyle = "rgba(190,160,100,0.7)"; ctx.strokeRect(fx-2, fy-2, fw+4, fh+4);
        // simple landscape / portrait content
        ctx.fillStyle = "rgba(255,255,200,0.15)"; ctx.fillRect(fx+2, fy+2, fw-4, (fh-4)/2);
      });
      // ── Hallway runner ────────────────────────────────────────────────────
      ctx.fillStyle = "rgba(110,30,30,0.45)"; ctx.fillRect(160, F-20, 180, 8);
      ctx.fillStyle = "rgba(150,50,50,0.25)";
      for (let rx=168; rx<334; rx+=12) ctx.fillRect(rx, F-20, 6, 8);
      ctx.fillStyle = "rgba(200,160,80,0.30)"; ctx.fillRect(162, F-19, 176, 1); ctx.fillRect(162, F-14, 176, 1);
      // ── Radiator / heater ─────────────────────────────────────────────────
      ctx.fillStyle = "#6a6a7a"; ctx.fillRect(370, F-58, 36, 30);
      ctx.fillStyle = "#5a5a6a";
      for (let rad=0; rad<5; rad++) ctx.fillRect(372+rad*6, F-56, 4, 26);
      ctx.fillStyle = "rgba(255,200,100,0.08)"; ctx.fillRect(370, F-58, 36, 6);
    } else if (zid === "living") {
      const F = canvas.height;
      // ── TV unit (wide, low) ───────────────────────────────────────────────
      const tvSX = Math.floor(canvas.width * 0.38);
      ctx.fillStyle = "#2a2018"; ctx.fillRect(tvSX-12, F-90, 136, 12); // TV stand
      ctx.fillStyle = "#1a1c22"; ctx.fillRect(tvSX-4, F-120, 120, 32); // TV body
      ctx.fillStyle = "#141618"; ctx.fillRect(tvSX, F-116, 112, 24); // screen
      ctx.fillStyle = "rgba(20,50,90,0.55)"; ctx.fillRect(tvSX+2, F-114, 108, 20); // screen glow
      // TV content (game on screen)
      ctx.fillStyle = "rgba(60,160,80,0.5)"; ctx.fillRect(tvSX+20, F-110, 30, 12); // green field
      ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fillRect(tvSX+32, F-108, 4, 8); // player
      ctx.fillStyle = "#808080"; ctx.fillRect(tvSX+44, F-86, 8, 4); // stand base
      ctx.fillRect(tvSX+100, F-86, 8, 4);
      // Sound bar
      ctx.fillStyle = "#1a1a1a"; ctx.fillRect(tvSX+8, F-82, 96, 5);
      ctx.fillStyle = "#252525";
      for (let s=0;s<10;s++) ctx.fillRect(tvSX+12+s*8, F-81, 5, 3);
      // ── Sofa ─────────────────────────────────────────────────────────────
      const sofaX = tvSX - 48;
      const sofaY = F-50;
      ctx.fillStyle = "#4a3430"; ctx.fillRect(sofaX, sofaY, 162, 16); // base
      ctx.fillStyle = "#5e4440"; ctx.fillRect(sofaX+6, sofaY-20, 150, 20); // back cushion
      ctx.fillStyle = "#6a4e4a"; ctx.fillRect(sofaX+6, sofaY-8, 48, 8); // seat cushion L
      ctx.fillStyle = "#634843"; ctx.fillRect(sofaX+60, sofaY-8, 48, 8); // seat cushion M
      ctx.fillStyle = "#6a4e4a"; ctx.fillRect(sofaX+114, sofaY-8, 42, 8); // seat cushion R
      ctx.fillStyle = "#3e2c28"; // armrests
      ctx.fillRect(sofaX-8, sofaY-18, 14, 34); ctx.fillRect(sofaX+156, sofaY-18, 14, 34);
      // Throw pillow
      ctx.fillStyle = "#8a7098"; ctx.fillRect(sofaX+80, sofaY-16, 20, 14);
      ctx.strokeStyle = "rgba(140,110,160,0.5)"; ctx.strokeRect(sofaX+82, sofaY-14, 16, 10);
      // Throw blanket draped over arm
      ctx.fillStyle = "rgba(160,120,80,0.6)"; ctx.fillRect(sofaX+148, sofaY-14, 20, 28);
      // ── Side tables ───────────────────────────────────────────────────────
      ctx.fillStyle = "#4e3828"; ctx.fillRect(sofaX-52, sofaY+4, 32, 8); // left side table
      ctx.fillRect(sofaX+176, sofaY+4, 32, 8); // right side table
      ctx.fillStyle = "#3a2c1e"; ctx.fillRect(sofaX-48, sofaY+12, 6, 10); ctx.fillRect(sofaX-20, sofaY+12, 6, 10);
      // Lamp on left side table
      ctx.fillStyle = "#b8a878"; ctx.fillRect(sofaX-39, sofaY-8, 4, 14);
      ctx.beginPath(); ctx.arc(sofaX-37, sofaY-10, 8, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "rgba(255,240,160,0.10)"; ctx.beginPath(); ctx.arc(sofaX-37, sofaY-10, 22, 0, Math.PI*2); ctx.fill();
      // Remote control on right side table
      ctx.fillStyle = "#1a1a1a"; ctx.fillRect(sofaX+186, sofaY+2, 14, 6);
      ctx.fillStyle = "#333"; ctx.fillRect(sofaX+188, sofaY+3, 3, 2); ctx.fillRect(sofaX+193, sofaY+3, 3, 2);
      // ── Coffee table ──────────────────────────────────────────────────────
      ctx.fillStyle = "#5a4030"; ctx.fillRect(sofaX+20, F-24, 100, 8);
      ctx.fillStyle = "#3a2818"; ctx.fillRect(sofaX+24, F-16, 8, 6); ctx.fillRect(sofaX+104, F-16, 8, 6);
      // Items on coffee table: magazine, cup, remote
      ctx.fillStyle = "#a04030"; ctx.fillRect(sofaX+28, F-24, 18, 6); // magazine
      ctx.fillStyle = "#fff"; ctx.fillRect(sofaX+29, F-23, 12, 1);
      ctx.fillStyle = "#8a7860"; ctx.fillRect(sofaX+58, F-24, 8, 7); // mug
      ctx.fillStyle = "#2a2a2a"; ctx.fillRect(sofaX+80, F-24, 12, 5); // remote
      // ── Bookcase in corner ────────────────────────────────────────────────
      ctx.fillStyle = "#3e2e1e"; ctx.fillRect(382, 30, 60, 78);
      ctx.fillStyle = "#2e2214"; ctx.fillRect(384, 32, 56, 2); ctx.fillRect(384, 52, 56, 2); ctx.fillRect(384, 72, 56, 2);
      const bkCols=["#8b3030","#3060a0","#507830","#805020","#604060","#208070","#b06030","#306080","#808030"];
      bkCols.forEach((bc, bi) => { ctx.fillStyle=bc; ctx.fillRect(386+bi*6, 34, 5, 16); });
      bkCols.forEach((bc, bi) => { ctx.fillStyle=bc; ctx.fillRect(386+bi*6, 54, 5, 16); });
      ctx.fillStyle = "#a08060"; ctx.fillRect(388, 74, 40, 14); // big book lying flat
    } else if (zid === "kitchen") {
      const F = canvas.height;
      // ── Counter / cabinets (L-shape) ─────────────────────────────────────
      ctx.fillStyle = "#6a6a5e"; ctx.fillRect(30, F-70, 160, 12); // counter top
      ctx.fillStyle = "#5a5a50"; ctx.fillRect(30, F-58, 160, 20); // cabinet faces
      // Cabinet doors
      ctx.strokeStyle = "rgba(180,170,140,0.35)"; ctx.lineWidth=1;
      for (let cx=32;cx<186;cx+=32) ctx.strokeRect(cx, F-56, 28, 14);
      // Pulls
      ctx.fillStyle = "#a09070";
      for (let cx=32;cx<186;cx+=32) ctx.fillRect(cx+11, F-50, 6, 2);
      // Sink
      ctx.fillStyle = "#9aacb4"; ctx.fillRect(78, F-72, 40, 10);
      ctx.fillStyle = "#7a9098"; ctx.fillRect(82, F-71, 16, 7); ctx.fillRect(100, F-71, 14, 7);
      ctx.fillStyle = "#c8d8e0"; ctx.fillRect(94, F-72, 6, 4); // faucet
      ctx.fillStyle = "rgba(100,160,200,0.4)"; ctx.fillRect(95, F-68, 2, 4); // water
      // Stove burners
      ctx.fillStyle = "#3a3a3a"; ctx.fillRect(198, F-70, 60, 12);
      ctx.fillStyle = "#252525";
      for (const [bx,by] of [[204, F-66],[216, F-66],[228, F-66],[240, F-66]]) {
        ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle="#444"; ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI*2); ctx.stroke();
      }
      // ── Kitchen table + chairs ─────────────────────────────────────────
      ctx.fillStyle = "#7a7060"; ctx.fillRect(30, F-44, 80, 14); // table
      ctx.fillStyle = "#5e5448"; ctx.fillRect(34, F-30, 8, 14); ctx.fillRect(94, F-30, 8, 14); // legs
      // Chair silhouettes
      ctx.fillStyle = "#4e4038";
      ctx.fillRect(20, F-52, 22, 10); ctx.fillRect(20, F-42, 4, 12); ctx.fillRect(38, F-42, 4, 12);
      ctx.fillRect(70, F-52, 22, 10); ctx.fillRect(70, F-42, 4, 12); ctx.fillRect(88, F-42, 4, 12);
      // Food on table: bowl, cup, plate
      ctx.fillStyle = "#f0e0c0"; ctx.fillRect(48, F-44, 14, 4); // plate
      ctx.fillStyle = "#c06030"; ctx.fillRect(50, F-44, 10, 3); // food on plate
      ctx.fillStyle = "#8a7858"; ctx.fillRect(68, F-44, 8, 6); // mug
      // ── Refrigerator ─────────────────────────────────────────────────────
      ctx.fillStyle = "#d0d4d0"; ctx.fillRect(280, F-88, 48, 52);
      ctx.fillStyle = "#b8bcb8"; ctx.fillRect(282, F-86, 44, 22); // fridge door
      ctx.fillRect(282, F-62, 44, 24); // freezer door
      ctx.fillStyle = "#8a8a8a"; ctx.fillRect(322, F-78, 4, 6); ctx.fillRect(322, F-56, 4, 6); // handles
      ctx.fillStyle = "rgba(140,220,160,0.18)"; ctx.fillRect(283, F-85, 42, 20); // fridge glow
      // Magnets on fridge
      ctx.fillStyle = "#e02020"; ctx.fillRect(288, F-80, 5, 5);
      ctx.fillStyle = "#2040e0"; ctx.fillRect(296, F-80, 5, 5);
      ctx.fillStyle = "#20c020"; ctx.fillRect(304, F-80, 5, 5);
      ctx.fillStyle = "#f0e0a0"; ctx.fillRect(288, F-73, 16, 8); // note/photo on fridge
      // ── Hanging pot rack + pots ───────────────────────────────────────────
      ctx.strokeStyle = "#6a5030"; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(336, 28); ctx.lineTo(396, 28); ctx.stroke();
      ctx.lineWidth=1.5;
      for (const hx of [342,356,370,384]) {
        ctx.beginPath(); ctx.moveTo(hx, 28); ctx.lineTo(hx, 42); ctx.stroke();
        ctx.fillStyle = "#4a4a58"; ctx.beginPath(); ctx.arc(hx, 46, 6, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = "#333340"; ctx.fillRect(hx+5, 44, 6, 2); // pan handle
      }
      // ── Wall shelf with spices ─────────────────────────────────────────
      ctx.fillStyle = "#8f7b60"; ctx.fillRect(134, 52, 120, 6);
      const spiceColors = ["#c84030","#80c050","#e0c030","#30a0c0","#c07030","#8050b0"];
      spiceColors.forEach((sc, si) => {
        ctx.fillStyle = sc; ctx.fillRect(138+si*18, 42, 10, 10);
        ctx.fillStyle = "#ddd"; ctx.fillRect(139+si*18, 44, 8, 2);
      });
      ctx.lineWidth = 1;
    } else if (zid === "bathroom") {
      const F = canvas.height;
      // ── Bathtub / shower combo ────────────────────────────────────────────
      ctx.fillStyle = "#9ab0ba"; ctx.fillRect(30, F-74, 72, 36);
      ctx.fillStyle = "#c8d8e0"; ctx.fillRect(32, F-72, 68, 32); // interior
      ctx.fillStyle = "rgba(100,160,200,0.30)"; ctx.fillRect(34, F-60, 64, 18); // water
      // faucet + spout
      ctx.fillStyle = "#c8d8e0"; ctx.fillRect(90, F-72, 6, 6); ctx.fillRect(92, F-66, 2, 10);
      // ── Toilet ────────────────────────────────────────────────────────────
      ctx.fillStyle = "#c8d0cc"; ctx.fillRect(116, F-62, 32, 24);
      ctx.fillStyle = "#b8c0bc"; ctx.fillRect(118, F-60, 28, 10); // seat
      ctx.fillStyle = "#d0d8d4"; ctx.fillRect(116, F-72, 32, 12); // tank
      ctx.fillStyle = "#b0b8b4"; ctx.fillRect(118, F-70, 28, 8); // tank lid
      // flush button
      ctx.fillStyle = "#a0a8a4"; ctx.beginPath(); ctx.arc(132, F-67, 3, 0, Math.PI*2); ctx.fill();
      // ── Vanity sink ───────────────────────────────────────────────────────
      ctx.fillStyle = "#9ab0ba"; ctx.fillRect(162, F-66, 54, 28);
      ctx.fillStyle = "#c8d8e4"; ctx.fillRect(168, F-63, 42, 18); // basin
      ctx.fillStyle = "#c8d8e0"; ctx.fillRect(184, F-66, 10, 6); // faucet base
      ctx.fillStyle = "#d8e8f0"; ctx.fillRect(188, F-70, 2, 6);
      ctx.fillStyle = "rgba(100,160,200,0.35)"; ctx.fillRect(170, F-58, 38, 10); // water
      // ── Mirror + cabinet above sink ───────────────────────────────────────
      ctx.fillStyle = "rgba(190,210,225,0.38)"; ctx.fillRect(160, 40, 58, 36);
      ctx.fillStyle = "#8aa0aa"; ctx.fillRect(158, 38, 62, 5); // shelf
      ctx.strokeStyle = "rgba(150,190,210,0.7)"; ctx.strokeRect(160, 40, 58, 36);
      ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(162, 42, 10, 30); // glint
      // ── Towel rack + towels ──────────────────────────────────────────────
      ctx.fillStyle = "#8a9898"; ctx.fillRect(236, 60, 46, 3); // bar
      ctx.fillStyle = "#208888"; ctx.fillRect(240, 63, 16, 12); // towel 1 (teal)
      ctx.fillStyle = "#187070"; ctx.fillRect(241, 65, 14, 8);
      ctx.fillStyle = "#186060"; ctx.fillRect(262, 63, 14, 10); // towel 2
      ctx.fillStyle = "#8a9898"; ctx.fillRect(236, 57, 3, 6); ctx.fillRect(279, 57, 3, 6); // rack posts
      // Hand soap
      ctx.fillStyle = "#d0a0c0"; ctx.fillRect(174, F-66, 8, 10); ctx.fillRect(177, F-70, 2, 4);
      // ── Floor tiles (grid) ────────────────────────────────────────────────
      ctx.strokeStyle = "rgba(130,160,170,0.20)"; ctx.lineWidth=0.5;
      for (let tx=30;tx<canvas.width;tx+=16) ctx.beginPath(), ctx.moveTo(tx, F-22), ctx.lineTo(tx, F), ctx.stroke();
      ctx.lineWidth=1;
    } else if (zid === "storage") {
      const F = canvas.height;
      // ── Heavy shelving units ──────────────────────────────────────────────
      ctx.fillStyle = "#5a493a"; ctx.fillRect(28, 44, 4, 64); ctx.fillRect(148, 44, 4, 64); // uprights
      ctx.fillRect(28, 44, 124, 6); ctx.fillRect(28, 65, 124, 6); ctx.fillRect(28, 86, 124, 6);
      // Boxes and containers on shelves
      const boxData = [
        [34,52,20,10,"#8a7358"],[58,50,16,12,"#7a6348"],[78,52,14,10,"#9a8368"],
        [96,48,22,14,"#6a5338"],[122,52,16,10,"#8a7358"],
        [34,74,18,8,"#7a6a58"],[56,72,14,10,"#9a8368"],[74,76,20,8,"#6a5348"],
        [98,74,16,8,"#8a7358"],[118,72,22,10,"#7a6348"],
      ];
      boxData.forEach(([bx,by,bw,bh,bc]) => {
        ctx.fillStyle = bc; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = "rgba(255,230,180,0.12)"; ctx.fillRect(bx+1, by+1, bw-2, 2);
        ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(bx+1, by+bh-2, bw-2, 2);
        // tape stripe
        ctx.fillStyle = "rgba(220,200,100,0.4)"; ctx.fillRect(bx, by+bh/2-1, bw, 2);
      });
      // ── Workbench ────────────────────────────────────────────────────────
      ctx.fillStyle = "#6e5843"; ctx.fillRect(168, F-66, 88, 10);
      ctx.fillStyle = "#5a4838"; ctx.fillRect(172, F-56, 8, 18); ctx.fillRect(240, F-56, 8, 18);
      // Tools on bench: hammer, screwdriver, wrench
      ctx.fillStyle = "#808080"; ctx.fillRect(176, F-68, 18, 4); // wrench handle
      ctx.fillStyle = "#606060"; ctx.fillRect(192, F-70, 8, 6);
      ctx.fillStyle = "#c06030"; ctx.fillRect(204, F-68, 14, 4); // screwdriver
      ctx.fillStyle = "#a08060"; ctx.fillRect(218, F-70, 10, 8); // hammer head
      ctx.fillRect(228, F-68, 16, 2); // hammer handle
      ctx.fillStyle = "#3a4050"; ctx.fillRect(176, F-58, 62, 4); // pegboard shadow
      // ── Ladder ───────────────────────────────────────────────────────────
      ctx.fillStyle = "#7f704f";
      ctx.fillRect(278, F-92, 5, 54); ctx.fillRect(298, F-92, 5, 54);
      for (let ry=F-86; ry<=F-46; ry+=8) ctx.fillRect(280, ry, 20, 2);
      // ── Old bicycle in corner ─────────────────────────────────────────────
      ctx.strokeStyle = "#5a5a5a"; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(330, F-32, 14, 0, Math.PI*2); ctx.stroke(); // rear wheel
      ctx.beginPath(); ctx.arc(358, F-32, 14, 0, Math.PI*2); ctx.stroke(); // front wheel
      ctx.beginPath(); ctx.moveTo(330, F-32); ctx.lineTo(344, F-52); ctx.lineTo(358, F-32); ctx.stroke(); // frame
      ctx.beginPath(); ctx.moveTo(336, F-52); ctx.lineTo(344, F-52); ctx.lineTo(348, F-44); ctx.stroke(); // seat
      ctx.lineWidth=1;
    } else if (zid === "library") {
      const F = canvas.height;
      // ── Built-in bookshelves (3 rows) ─────────────────────────────────────
      ctx.fillStyle = "#4a3828"; ctx.fillRect(28, 28, 148, 72); // back panel
      ctx.fillStyle = "#3a2c1e"; ctx.fillRect(28, 28, 148, 4); ctx.fillRect(28, 50, 148, 4); ctx.fillRect(28, 72, 148, 4);
      const libBooks = [
        "#8b3030","#3060a0","#507830","#805020","#604060","#208070","#b06030",
        "#306080","#808030","#a04050","#305080","#608040","#702010","#104060",
        "#806040","#408070","#507050","#304060","#805030"
      ];
      libBooks.forEach((bc, bi) => {
        const row = Math.floor(bi / 7);
        const col = bi % 7;
        ctx.fillStyle = bc; ctx.fillRect(32+col*19, 32+row*22, 16, 16);
        ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.fillRect(33+col*19, 33+row*22, 4, 1);
      });
      // ── Reading desk + chair ─────────────────────────────────────────────
      ctx.fillStyle = "#5a4030"; ctx.fillRect(198, F-66, 96, 10);
      ctx.fillStyle = "#3e2e20"; ctx.fillRect(202, F-56, 8, 18); ctx.fillRect(278, F-56, 8, 18);
      // Desk items: open book, quill, ink pot, small lamp
      ctx.fillStyle = "#f0e8d0"; ctx.fillRect(206, F-66, 28, 8); // open book
      ctx.fillStyle = "#1a1a1a"; ctx.fillRect(218, F-66, 1, 8); // spine
      // text lines on book
      ctx.fillStyle = "rgba(60,40,20,0.4)";
      for (let bl=0;bl<4;bl++) { ctx.fillRect(208, F-64+bl*2, 8, 1); ctx.fillRect(220, F-64+bl*2, 8, 1); }
      // Quill
      ctx.strokeStyle = "#c0b080"; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(238, F-66); ctx.lineTo(244, F-58); ctx.stroke();
      ctx.fillStyle = "#e8d890"; ctx.fillRect(244, F-60, 4, 4); // ink pot
      // Lamp
      ctx.fillStyle = "#d8c18e"; ctx.fillRect(256, F-82, 3, 18);
      ctx.beginPath(); ctx.arc(257, F-83, 8, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "rgba(255,240,160,0.10)"; ctx.beginPath(); ctx.arc(257, F-83, 22, 0, Math.PI*2); ctx.fill();
      // Chair
      ctx.fillStyle = "#4a3428"; ctx.fillRect(230, F-56, 28, 6); // seat
      ctx.fillRect(230, F-50, 4, 12); ctx.fillRect(254, F-50, 4, 12); // legs
      ctx.fillRect(230, F-64, 28, 8); // backrest
      // ── Filing cabinet ────────────────────────────────────────────────────
      ctx.fillStyle = "#5a6070"; ctx.fillRect(312, F-82, 36, 44);
      ctx.fillStyle = "#4a5060";
      ctx.fillRect(314, F-80, 32, 12); ctx.fillRect(314, F-66, 32, 12); ctx.fillRect(314, F-52, 32, 12);
      ctx.fillStyle = "#8a9090";
      ctx.fillRect(328, F-76, 6, 2); ctx.fillRect(328, F-62, 6, 2); ctx.fillRect(328, F-48, 6, 2);
      // ── Globe on shelf ────────────────────────────────────────────────────
      ctx.fillStyle = "#4a3828"; ctx.fillRect(364, F-60, 24, 4); // base
      ctx.fillStyle = "#3060a0"; ctx.beginPath(); ctx.arc(376, F-68, 10, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#4080c0"; ctx.fillRect(370, F-70, 4, 8); // continent
      ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.beginPath(); ctx.arc(372, F-72, 3, 0, Math.PI*2); ctx.fill();
      ctx.lineWidth=1;
    }
      const F = canvas.height;
      // ── Bed frame with headboard ─────────────────────────────────────────
      ctx.fillStyle = "#3e2a1e"; ctx.fillRect(42, F-80, 130, 10); // headboard top
      ctx.fillStyle = "#5c4638"; ctx.fillRect(42, F-72, 130, 26); // bed frame
      ctx.fillStyle = "#bba38d"; ctx.fillRect(48, F-68, 118, 18); // mattress
      ctx.fillStyle = "#7d668f"; ctx.fillRect(58, F-64, 98, 14); // blanket/duvet
      ctx.fillStyle = "#9a82a0"; ctx.fillRect(52, F-65, 36, 12); // pillow left
      ctx.fillStyle = "#8f7898"; ctx.fillRect(94, F-65, 36, 12); // pillow right
      // Pillow crease lines
      ctx.strokeStyle = "rgba(60,40,80,0.35)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(56, F-60); ctx.lineTo(84, F-60); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(98, F-60); ctx.lineTo(126, F-60); ctx.stroke();
      // Bed feet
      ctx.fillStyle = "#2e1c12";
      ctx.fillRect(44, F-46, 10, 8); ctx.fillRect(160, F-46, 10, 8);
      // ── Nightstand ───────────────────────────────────────────────────────
      ctx.fillStyle = "#4e3a2e"; ctx.fillRect(180, F-60, 28, 22);
      ctx.fillStyle = "#3a2820"; ctx.fillRect(182, F-50, 24, 8); // drawer
      ctx.fillStyle = "#c8a870"; ctx.fillRect(192, F-47, 4, 3); // drawer pull
      // Lamp on nightstand
      ctx.fillStyle = "#c9ba8e"; ctx.fillRect(189, F-72, 4, 14);
      ctx.fillStyle = "#e8d890";
      ctx.beginPath(); ctx.arc(191, F-74, 7, Math.PI, Math.PI*2); ctx.fill();
      // Lamp glow halo
      ctx.fillStyle = "rgba(255,240,140,0.08)";
      ctx.beginPath(); ctx.arc(191, F-74, 18, 0, Math.PI*2); ctx.fill();
      // Glass of water on nightstand
      ctx.fillStyle = "rgba(160,200,230,0.55)"; ctx.fillRect(202, F-58, 6, 10);
      ctx.strokeStyle = "rgba(120,180,210,0.7)"; ctx.strokeRect(202, F-58, 6, 10);
      // ── Dresser ──────────────────────────────────────────────────────────
      ctx.fillStyle = "#4e3a2e"; ctx.fillRect(226, F-68, 62, 30);
      ctx.fillStyle = "#3a2820";
      ctx.fillRect(228, F-66, 28, 10); ctx.fillRect(258, F-66, 28, 10); // top drawers
      ctx.fillRect(228, F-54, 58, 12); // bottom drawer
      ctx.fillStyle = "#c8a870";
      ctx.fillRect(239, F-62, 4, 3); ctx.fillRect(269, F-62, 4, 3); // pulls
      ctx.fillRect(253, F-49, 5, 3);
      // Mirror above dresser
      ctx.fillStyle = "#3a2c22"; ctx.fillRect(232, 32, 50, 36);
      ctx.fillStyle = "rgba(190,210,225,0.38)"; ctx.fillRect(236, 36, 42, 28);
      ctx.strokeStyle = "rgba(200,168,112,0.72)"; ctx.strokeRect(232, 32, 50, 36);
      // Reflection glint
      ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fillRect(238, 38, 6, 20);
      // ── Wall art / picture frame ──────────────────────────────────────────
      ctx.strokeStyle = "rgba(200,168,112,0.72)"; ctx.strokeRect(320, 36, 52, 38);
      ctx.fillStyle = "rgba(80,60,100,0.55)"; ctx.fillRect(324, 40, 44, 30);
      ctx.fillStyle = "rgba(120,100,160,0.40)"; ctx.fillRect(330, 44, 32, 18);
      // ── Chess computer desk (right side) ─────────────────────────────────
      // Desk surface
      ctx.fillStyle = "#3a2e1e"; ctx.fillRect(390, F-62, 96, 10);
      ctx.fillStyle = "#2e2418"; ctx.fillRect(396, F-52, 8, 14); ctx.fillRect(470, F-52, 8, 14);
      // Monitor (detailed)
      ctx.fillStyle = "#1a1a1f"; ctx.fillRect(408, F-88, 58, 28);
      ctx.fillStyle = "#252a32"; ctx.fillRect(412, F-84, 50, 20);
      // Chess board on screen (animated flicker)
      const ledPulse = 0.5 + 0.3 * Math.sin(state.tick * 0.1);
      ctx.fillStyle = `rgba(60,120,200,${ledPulse * 0.6})`;
      ctx.fillRect(413, F-83, 48, 18);
      const sqS = 5;
      for (let rr = 0; rr < 3; rr++) for (let cc = 0; cc < 5; cc++) {
        ctx.fillStyle = (rr+cc)%2===0 ? `rgba(240,230,200,${ledPulse*0.6})` : `rgba(30,70,160,${ledPulse*0.7})`;
        ctx.fillRect(415+cc*sqS, F-82+rr*sqS, sqS-1, sqS-1);
      }
      // Monitor stand
      ctx.fillStyle = "#151518"; ctx.fillRect(432, F-60, 12, 4);
      ctx.fillStyle = "#1f1f22"; ctx.fillRect(428, F-56, 20, 3);
      // Keyboard
      ctx.fillStyle = "#1a1a20"; ctx.fillRect(406, F-56, 44, 7);
      for (let k=0;k<7;k++) { ctx.fillStyle="#2a2a32"; ctx.fillRect(408+k*5, F-55, 4, 4); }
      // Mouse
      ctx.fillStyle = "#1e1e25"; ctx.fillRect(454, F-53, 10, 7);
      ctx.fillStyle = "#333"; ctx.fillRect(459, F-52, 1, 4);
      // Status LED
      ctx.fillStyle = `rgba(60,220,60,${ledPulse})`; ctx.fillRect(460, F-88, 3, 3);
      // Sticky notes on monitor bezel
      ctx.fillStyle = "#eaea60"; ctx.fillRect(462, F-86, 8, 7);
      ctx.fillStyle = "#40402a"; ctx.font="5px monospace";
      ctx.fillText("e4!", 463, F-81);
      // Coffee mug on desk
      ctx.fillStyle = "#a06040"; ctx.fillRect(478, F-58, 10, 8);
      ctx.fillStyle = "rgba(40,20,10,0.7)"; ctx.fillRect(479, F-57, 8, 5);
      ctx.strokeStyle = "#a06040"; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(488, F-54, 3, -Math.PI/2, Math.PI/2); ctx.stroke();
      ctx.lineWidth = 1;
      // Small bookshelf on wall above desk
      ctx.fillStyle = "#3e2e20"; ctx.fillRect(388, 36, 100, 8); // shelf
      const bookColors = ["#8b3030","#3060a0","#507830","#805020","#604060","#208070","#906028"];
      for (let b=0;b<7;b++) {
        ctx.fillStyle = bookColors[b]; ctx.fillRect(392+b*13, 28, 10, 8);
        ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.fillRect(392+b*13+1, 29, 2, 1);
      }
    } if (zid === "laundry") {
      const F = canvas.height;
      // ── Washing machine (front loader) ────────────────────────────────────
      ctx.fillStyle = "#8090a0"; ctx.fillRect(34, F-78, 54, 44);
      ctx.fillStyle = "#6a7888"; ctx.fillRect(36, F-76, 50, 38); // body panel
      // porthole window
      ctx.fillStyle = "#1a2030"; ctx.beginPath(); ctx.arc(61, F-57, 16, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#384458"; ctx.beginPath(); ctx.arc(61, F-57, 13, 0, Math.PI*2); ctx.fill();
      // clothes tumbling (smears)
      const phase = (state.tick * 0.05) % (Math.PI * 2);
      ctx.fillStyle = "rgba(200,80,80,0.5)";
      ctx.fillRect(61+Math.cos(phase)*8-3, F-57+Math.sin(phase)*8-3, 6, 5);
      ctx.fillStyle = "rgba(80,120,200,0.5)";
      ctx.fillRect(61+Math.cos(phase+2.1)*8-3, F-57+Math.sin(phase+2.1)*8-3, 5, 5);
      // Porthole ring
      ctx.strokeStyle = "#8090a0"; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(61, F-57, 16, 0, Math.PI*2); ctx.stroke();
      // Control panel
      ctx.fillStyle = "#505a68"; ctx.fillRect(36, F-78, 50, 8);
      ctx.fillStyle = "#c0c8d0"; ctx.beginPath(); ctx.arc(45, F-74, 4, 0, Math.PI*2); ctx.fill(); // dial
      ctx.fillStyle = "#80e080"; ctx.fillRect(72, F-76, 5, 3); // LED
      // ── Dryer ────────────────────────────────────────────────────────────
      ctx.fillStyle = "#9090a0"; ctx.fillRect(96, F-78, 54, 44);
      ctx.fillStyle = "#7a7a90"; ctx.fillRect(98, F-76, 50, 38);
      ctx.fillStyle = "#1a1a28"; ctx.beginPath(); ctx.arc(123, F-57, 16, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#282838"; ctx.beginPath(); ctx.arc(123, F-57, 13, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = "#9090a0"; ctx.beginPath(); ctx.arc(123, F-57, 16, 0, Math.PI*2); ctx.stroke();
      ctx.fillStyle = "#505868"; ctx.fillRect(98, F-78, 50, 8);
      ctx.fillStyle = "#c0c0c8"; ctx.beginPath(); ctx.arc(107, F-74, 4, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#e08040"; ctx.fillRect(134, F-76, 5, 3); // heat LED
      // ── Laundry baskets ───────────────────────────────────────────────────
      ctx.fillStyle = "#8a7a60"; ctx.fillRect(162, F-52, 32, 20); // basket 1
      ctx.fillStyle = "#7a6a50"; // weave lines
      for (let wb=0; wb<4; wb++) ctx.fillRect(164, F-50+wb*5, 28, 2);
      ctx.fillStyle = "#c89878"; ctx.fillRect(162, F-54, 32, 4); // rim
      // Clothes in basket
      ctx.fillStyle = "#a060a0"; ctx.fillRect(166, F-54, 14, 5);
      ctx.fillStyle = "#6080b0"; ctx.fillRect(174, F-55, 12, 6);
      // ── Wall shelf with detergents ────────────────────────────────────────
      ctx.fillStyle = "#6a6a70"; ctx.fillRect(206, 58, 120, 6);
      ctx.fillStyle = "#206080"; ctx.fillRect(212, 44, 18, 14); // detergent box
      ctx.fillStyle = "#fff"; ctx.fillRect(214, 47, 14, 4);
      ctx.fillStyle = "#e04020"; ctx.fillRect(234, 46, 14, 12); // fabric softener
      ctx.fillStyle = "#fff"; ctx.fillRect(236, 49, 10, 3);
      ctx.fillStyle = "#c0c0c0"; ctx.fillRect(252, 48, 10, 10); // spray bottle
      ctx.fillStyle = "#a0a0a0"; ctx.fillRect(261, 46, 2, 8);
      ctx.fillStyle = "#8080a0"; ctx.fillRect(268, 46, 16, 12); // small box
      // ── Hanging clothes rail ──────────────────────────────────────────────
      ctx.strokeStyle = "#606870"; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(340, 34); ctx.lineTo(410, 34); ctx.stroke();
      ctx.lineWidth=1;
      const hangColors = ["#a04030","#304890","#408038","#906828","#604880"];
      hangColors.forEach((hc, hi) => {
        ctx.strokeStyle = "#888"; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(354+hi*14, 34); ctx.lineTo(354+hi*14, 44); ctx.stroke();
        ctx.fillStyle = hc; ctx.fillRect(350+hi*14, 44, 14, 20);
      });
      ctx.lineWidth=1;
    } else if (zid === "attic") {
      const F = canvas.height;
      // ── Exposed rafters (diagonal roof beams) ────────────────────────────
      ctx.fillStyle = "#4c3a2c";
      for (const x of [20,80,140,200,260,320,380,440,500]) {
        ctx.fillRect(x, 8, 10, 32);
        ctx.fillStyle = "#3a2c1e"; ctx.fillRect(x, 8, 10, 2); ctx.fillStyle = "#4c3a2c";
      }
      // Ridge beam (horizontal top)
      ctx.fillStyle = "#3a2c1e"; ctx.fillRect(0, 6, canvas.width, 4);
      // Cobweb in corner
      ctx.strokeStyle = "rgba(200,200,200,0.25)"; ctx.lineWidth=0.5;
      for (let cw=0; cw<5; cw++) {
        ctx.beginPath(); ctx.moveTo(20, 8); ctx.lineTo(20+cw*10, 8+cw*6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(20, 8); ctx.lineTo(20-cw*4, 8+cw*8); ctx.stroke();
      }
      ctx.lineWidth=1;
      // ── Old steamer trunk ─────────────────────────────────────────────────
      ctx.fillStyle = "#5f4b38"; ctx.fillRect(36, F-72, 72, 24);
      ctx.fillStyle = "#4a3828"; ctx.fillRect(36, F-72, 72, 6); // lid band
      ctx.fillStyle = "#7a6050"; ctx.fillRect(36, F-66, 72, 2); // seam
      // trunk latches
      ctx.fillStyle = "#b09060"; ctx.fillRect(62, F-72, 8, 4); ctx.fillRect(80, F-66, 4, 4);
      ctx.fillStyle = "#c8a870"; ctx.fillRect(67, F-70, 4, 3); // padlock
      // ── Second trunk, open ────────────────────────────────────────────────
      ctx.fillStyle = "#6a5440"; ctx.fillRect(122, F-68, 62, 18);
      ctx.fillStyle = "#4e3c2c"; ctx.fillRect(122, F-80, 62, 14); // open lid (angled)
      ctx.fillStyle = "#8a7060"; ctx.fillRect(124, F-79, 58, 10);
      // contents: fabric pile, old photo
      ctx.fillStyle = "#8060a0"; ctx.fillRect(128, F-68, 20, 8); // purple cloth
      ctx.fillStyle = "#e0d8c0"; ctx.fillRect(152, F-67, 12, 8); // photo/paper
      ctx.fillStyle = "rgba(60,40,20,0.5)"; ctx.fillRect(153, F-66, 10, 6); // photo content
      // ── Sheet-covered furniture ───────────────────────────────────────────
      ctx.fillStyle = "#8d7c69"; ctx.fillRect(204, F-74, 84, 26);
      ctx.fillStyle = "#7a6c5a"; ctx.fillRect(210, F-80, 72, 8); // top fold
      // sheet wrinkle lines
      ctx.strokeStyle = "rgba(120,105,90,0.5)"; ctx.lineWidth=1;
      for (const wrx of [218, 230, 248, 264, 278]) {
        ctx.beginPath(); ctx.moveTo(wrx, F-74); ctx.lineTo(wrx-4, F-50); ctx.stroke();
      }
      // ── Wooden crates ─────────────────────────────────────────────────────
      ctx.fillStyle = "#5a4030"; ctx.fillRect(302, F-64, 44, 16);
      ctx.fillStyle = "#4a3428"; ctx.fillRect(302, F-64, 44, 3); ctx.fillRect(302, F-55, 44, 3);
      ctx.fillStyle = "#6a5040"; ctx.fillRect(302, F-58, 4, 10); ctx.fillRect(338, F-58, 4, 10);
      ctx.fillStyle = "#3a2c20"; ctx.fillRect(350, F-56, 32, 10); // smaller crate
      // ── Christmas tree in corner (dusty, forgotten) ───────────────────────
      ctx.fillStyle = "#2a3a20"; ctx.beginPath();
      ctx.moveTo(406, F-78); ctx.lineTo(430, F-38); ctx.lineTo(382, F-38);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#1e2a18"; ctx.beginPath();
      ctx.moveTo(406, F-64); ctx.lineTo(424, F-42); ctx.lineTo(388, F-42);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#4a3020"; ctx.fillRect(402, F-38, 8, 10); // trunk
      // Dusty ornament dots
      ctx.fillStyle = "rgba(180,60,60,0.4)"; ctx.beginPath(); ctx.arc(398, F-56, 3, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "rgba(60,60,180,0.4)"; ctx.beginPath(); ctx.arc(412, F-50, 3, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "rgba(200,180,40,0.35)"; ctx.beginPath(); ctx.arc(403, F-44, 2, 0, Math.PI*2); ctx.fill();
    } else if (zid === "basement") {
      const F = canvas.height;
      // ── Heavy shelving with supplies ──────────────────────────────────────
      ctx.fillStyle = "#4a4a54"; ctx.fillRect(28, F-80, 5, 52); ctx.fillRect(88, F-80, 5, 52);
      ctx.fillStyle = "#3a3a44"; ctx.fillRect(28, F-80, 65, 6); ctx.fillRect(28, F-60, 65, 5); ctx.fillRect(28, F-42, 65, 5);
      // Containers on shelves
      const basCans = [["#4a6050",34,F-78,14,12],["#6a4a40",52,F-78,16,12],["#404a60",72,F-76,14,14],
                       ["#505050",34,F-58,12,10],["#5a4040",50,F-58,14,10],["#404860",66,F-56,16,12]];
      basCans.forEach(([bc,bx,by,bw,bh]) => {
        ctx.fillStyle = bc; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fillRect(bx+1, by+1, bw-2, 2);
      });
      // ── Old water heater ──────────────────────────────────────────────────
      ctx.fillStyle = "#5a5a60"; ctx.fillRect(106, F-82, 40, 50);
      ctx.fillStyle = "#4a4a50"; ctx.beginPath(); ctx.arc(126, F-82, 20, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "#6a6a70"; ctx.fillRect(118, F-54, 16, 22);
      // pipe coming from top
      ctx.strokeStyle = "#606060"; ctx.lineWidth=4;
      ctx.beginPath(); ctx.moveTo(122, F-82); ctx.lineTo(122, F-100); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(122, F-100); ctx.lineTo(138, F-100); ctx.stroke();
      ctx.lineWidth=1;
      ctx.fillStyle = "#808080"; ctx.fillRect(124, F-62, 4, 4); // gauge
      // ── Fuse / breaker box ────────────────────────────────────────────────
      ctx.fillStyle = "#6070808"; ctx.fillRect(160, 48, 32, 44);
      ctx.fillStyle = "#6f7b86"; ctx.fillRect(160, 48, 32, 44);
      ctx.fillStyle = "#505860"; ctx.fillRect(162, 50, 28, 38);
      // breaker switches
      for (let br=0; br<6; br++) {
        const on = br !== 3; // one breaker tripped
        ctx.fillStyle = on ? "#60a060" : "#c04030";
        ctx.fillRect(165, 53+br*6, 10, 4);
        ctx.fillRect(179, 53+br*6, 10, 4);
      }
      ctx.fillStyle = "rgba(255,60,60,0.6)"; ctx.fillRect(165, 53+3*6, 10, 4); // tripped = red
      // ── Exposed pipes on ceiling ───────────────────────────────────────────
      ctx.strokeStyle = "#707878"; ctx.lineWidth=4;
      ctx.beginPath(); ctx.moveTo(0, 22); ctx.lineTo(canvas.width, 22); ctx.stroke();
      ctx.strokeStyle = "#606870"; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(0, 32); ctx.lineTo(280, 32); ctx.stroke();
      ctx.lineWidth=1;
      // Pipe brackets
      ctx.fillStyle = "#505858";
      for (let px=40; px<canvas.width; px+=60) { ctx.fillRect(px, 18, 6, 8); ctx.fillRect(px, 28, 6, 8); }
      // ── Old furnace/boiler ────────────────────────────────────────────────
      ctx.fillStyle = "#3a3a40"; ctx.fillRect(216, F-82, 52, 50);
      ctx.fillStyle = "#2a2a30"; ctx.fillRect(222, F-76, 40, 32); // body
      // Furnace door
      ctx.fillStyle = "#1a1a20"; ctx.fillRect(228, F-62, 28, 18); ctx.fillStyle = "#c06020";
      const furnGlow = 0.3 + 0.2 * Math.sin(state.tick * 0.07);
      ctx.fillStyle = `rgba(255,120,20,${furnGlow})`; ctx.fillRect(230, F-60, 24, 14);
      // heat shimmer
      ctx.fillStyle = `rgba(255,180,60,${furnGlow*0.4})`; ctx.fillRect(226, F-76, 36, 8);
      // ── Bloody smears / horror details ────────────────────────────────────
      ctx.fillStyle = "rgba(140,16,16,0.55)";
      ctx.fillRect(96, F-18, 22, 8);
      ctx.fillRect(238, F-20, 30, 8);
      ctx.fillRect(340, F-16, 14, 6);
      // Drag mark
      ctx.fillStyle = "rgba(100,10,10,0.35)";
      ctx.fillRect(110, F-16, 60, 4);

      // ── STAIRCASE (keep original staircase) ───────────────────────────────
      const stairX = canvas.width - 210;
      const stairBaseY = F - 28;
      const stepW = 22; const stepH = 10; const stepCount = 8;
      for (let i = 0; i < stepCount; i++) {
        const sx = stairX + i * stepW; const sy = stairBaseY - i * stepH;
        ctx.fillStyle = i % 2 === 0 ? "#3c3840" : "#343038"; ctx.fillRect(sx, sy, stepW, stepH);
        ctx.fillStyle = "rgba(180,170,190,0.28)"; ctx.fillRect(sx+1, sy, stepW-2, 2);
        ctx.fillStyle = "#28242c"; ctx.fillRect(sx, sy+stepH, stepW, 4);
        ctx.fillStyle = "rgba(220,210,230,0.14)"; ctx.fillRect(sx+4, sy, stepW-8, 3);
      }
      ctx.fillStyle = "#2a2630";
      ctx.beginPath();
      ctx.moveTo(stairX, stairBaseY+stepH); ctx.lineTo(stairX+stepCount*stepW, stairBaseY+stepH-(stepCount-1)*stepH);
      ctx.lineTo(stairX+stepCount*stepW, stairBaseY+stepH+6); ctx.lineTo(stairX, stairBaseY+stepH+6);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(140,120,110,0.70)"; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(stairX+4, stairBaseY-18); ctx.lineTo(stairX+stepCount*stepW-4, stairBaseY-stepCount*stepH-18); ctx.stroke();
      ctx.lineWidth=1; ctx.strokeStyle = "rgba(120,100,90,0.55)";
      for (let i=1; i<stepCount; i+=2) {
        const bx2=stairX+i*stepW+8; const by2=stairBaseY-i*stepH;
        ctx.beginPath(); ctx.moveTo(bx2, by2-2); ctx.lineTo(bx2, by2-18); ctx.stroke();
      }
      ctx.fillStyle = "rgba(200,190,160,0.45)"; ctx.font="8px monospace";
      ctx.fillText("EXIT ↑", stairX+60, stairBaseY-stepCount*stepH-26);
      ctx.fillStyle = "rgba(200,185,140,0.07)";
      ctx.fillRect(stairX+stepCount*stepW-10, 40, 50, stairBaseY-40);
    } else if (zid === "backyard") {
      const F = canvas.height;
      // ── Grass / ground cover ──────────────────────────────────────────────
      ctx.fillStyle = "#2a4a20"; ctx.fillRect(0, F-28, canvas.width, 28);
      // Grass tufts
      ctx.strokeStyle = "#3a6028"; ctx.lineWidth=1;
      for (let gx=10; gx<canvas.width; gx+=14) {
        ctx.beginPath(); ctx.moveTo(gx, F-28); ctx.lineTo(gx-2, F-34); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx+4, F-28); ctx.lineTo(gx+6, F-35); ctx.stroke();
      }
      // ── Garden beds ──────────────────────────────────────────────────────
      ctx.fillStyle = "#3a2818"; ctx.fillRect(28, F-74, 88, 20);
      ctx.fillStyle = "#4a3824"; ctx.fillRect(30, F-72, 84, 16);
      // plants in bed
      for (let pl=0; pl<5; pl++) {
        ctx.fillStyle = "#507030"; ctx.fillRect(36+pl*15, F-76, 4, 10);
        ctx.fillStyle = "#608040"; ctx.beginPath(); ctx.arc(38+pl*15, F-77, 4, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = "#80a040"; ctx.beginPath(); ctx.arc(38+pl*15, F-77, 2, 0, Math.PI*2); ctx.fill();
      }
      ctx.fillStyle = "#3a2818"; ctx.fillRect(130, F-70, 60, 16);
      ctx.fillStyle = "#4a3824"; ctx.fillRect(132, F-68, 56, 12);
      for (let pl2=0; pl2<3; pl2++) {
        ctx.fillStyle = "#a04030"; ctx.beginPath(); ctx.arc(142+pl2*18, F-68, 4, 0, Math.PI*2); ctx.fill(); // red flowers
        ctx.fillStyle = "#c05040"; ctx.beginPath(); ctx.arc(142+pl2*18, F-68, 2, 0, Math.PI*2); ctx.fill();
      }
      // ── Dog house ────────────────────────────────────────────────────────
      const dx = canvas.width - 242;
      const dy = F - 92;
      ctx.fillStyle = "#6f4e33"; ctx.fillRect(dx, dy+24, 108, 46);
      ctx.fillStyle = "#513722";
      ctx.beginPath(); ctx.moveTo(dx-10, dy+26); ctx.lineTo(dx+54, dy-4); ctx.lineTo(dx+118, dy+26); ctx.closePath(); ctx.fill();
      // Roof shingles
      ctx.fillStyle = "#3f2a18"; ctx.lineWidth=1;
      for (let sh=0; sh<3; sh++) {
        ctx.fillRect(dx-4+sh*36, dy+8, 34, 6);
        ctx.fillRect(dx+12+sh*36, dy+14, 34, 6);
      }
      // Doorway
      ctx.fillStyle = "#1a0f08"; ctx.beginPath(); ctx.arc(dx+54, dy+52, 18, Math.PI, 0); ctx.fill();
      ctx.fillRect(dx+36, dy+52, 36, 18);
      // Dog peeking out (eyes)
      ctx.fillStyle = "rgba(255,200,80,0.7)"; ctx.beginPath(); ctx.arc(dx+48, dy+52, 3, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(dx+62, dy+52, 3, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#1a0f08"; ctx.beginPath(); ctx.arc(dx+48, dy+52, 1.5, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(dx+62, dy+52, 1.5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "rgba(232,196,118,0.85)"; ctx.fillRect(dx+76, dy+44, 6, 6); // dog tag
      // Dog bowl
      ctx.fillStyle = "#708090"; ctx.fillRect(dx+120, dy+60, 18, 6);
      ctx.fillStyle = "rgba(80,140,200,0.5)"; ctx.fillRect(dx+122, dy+62, 14, 2);
      // ── Framed window on house exterior ───────────────────────────────────
      ctx.strokeStyle = "rgba(178,148,92,0.7)"; ctx.lineWidth=2;
      ctx.strokeRect(62, 36, 52, 36);
      ctx.fillStyle = "rgba(100,150,170,0.28)"; ctx.fillRect(64, 38, 48, 32);
      ctx.fillStyle = "rgba(180,200,210,0.20)"; ctx.fillRect(64, 38, 22, 32); ctx.fillRect(88, 38, 22, 32);
      ctx.strokeStyle = "rgba(178,148,92,0.5)"; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(86, 38); ctx.lineTo(86, 72); ctx.stroke(); // vertical divide
      ctx.beginPath(); ctx.moveTo(64, 55); ctx.lineTo(112, 55); ctx.stroke(); // horizontal divide
      // Curtain
      ctx.fillStyle = "rgba(180,160,120,0.4)"; ctx.fillRect(64, 38, 10, 32);
      ctx.fillRect(102, 38, 10, 32);
      // ── Patio table + chairs ─────────────────────────────────────────────
      ctx.fillStyle = "#6a5840"; ctx.fillRect(204, F-66, 56, 8); // table
      ctx.fillStyle = "#4a4030"; ctx.fillRect(208, F-58, 6, 16); ctx.fillRect(246, F-58, 6, 16); // legs
      ctx.fillStyle = "#807060"; ctx.fillRect(196, F-62, 12, 6); // chair L
      ctx.fillRect(256, F-62, 12, 6); // chair R
      // ── Clothesline ──────────────────────────────────────────────────────
      ctx.fillStyle = "#7c6a58"; ctx.fillRect(302, 44, 3, 36); ctx.fillRect(376, 44, 3, 36);
      ctx.strokeStyle = "rgba(190,180,160,0.55)"; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(302, 48); ctx.lineTo(376, 48); ctx.stroke();
      // Hanging laundry
      const cloColors = [["#d0a060",310,52,12,16],["#4060b0",328,50,10,18],["#b04040",342,52,14,14],["#50a060",362,50,12,16]];
      cloColors.forEach(([cc,cx,cy,cw,ch2]) => {
        ctx.fillStyle = cc; ctx.fillRect(cx, cy, cw, ch2);
        ctx.fillStyle = "rgba(0,0,0,0.15)"; ctx.fillRect(cx, cy, cw, 2); // clothespin shadow
        ctx.fillStyle = "#888"; ctx.fillRect(cx+cw/2-1, cy-2, 2, 4); // clothespin
      });
      ctx.lineWidth=1;
    }

    // Distinct detailed prop clusters: 10 objects per room to avoid clone-like spaces.
    const roomProps = {
      entrance: [[22,104,18,16],[54,106,16,14],[92,104,20,16],[124,102,24,18],[160,104,18,16],[196,103,22,17],[228,101,24,19],[264,104,18,16],[296,102,22,18],[330,104,20,16]],
      hallway: [[24,100,18,15],[52,103,16,14],[84,101,22,17],[116,103,18,14],[150,101,24,17],[184,100,22,18],[216,103,16,14],[246,100,24,18],[280,102,20,16],[312,101,22,17]],
      living: [[26,102,24,18],[58,104,22,16],[92,100,26,20],[126,103,20,16],[160,101,24,17],[194,100,22,18],[226,102,24,16],[260,101,22,17],[292,100,24,18],[326,103,18,15]],
      bathroom: [[24,102,20,16],[54,103,18,15],[82,101,22,17],[112,102,20,16],[142,101,22,17],[170,100,24,18],[200,102,20,16],[230,101,22,17],[260,102,20,16],[290,101,22,17]],
      kitchen: [[22,102,24,18],[56,104,20,16],[88,100,26,20],[122,103,20,16],[156,101,24,17],[188,102,22,16],[220,100,26,18],[254,103,20,16],[286,101,24,17],[320,102,20,16]],
      storage: [[22,102,22,17],[52,103,18,16],[80,101,24,18],[112,103,20,16],[144,101,24,17],[176,100,26,18],[210,103,18,16],[238,101,24,17],[270,102,22,16],[302,100,24,18]],
      library: [[24,100,20,17],[54,101,18,16],[84,100,22,18],[114,102,20,16],[146,100,24,18],[178,101,22,17],[210,100,24,18],[242,102,20,16],[274,100,24,18],[306,101,22,17]],
      bedroom: [[22,102,24,18],[54,103,20,16],[86,100,26,20],[120,103,20,16],[154,101,24,17],[186,100,22,18],[218,102,24,16],[252,101,22,17],[286,100,24,18],[320,103,18,15]],
      laundry: [[24,102,20,16],[54,103,18,15],[82,101,22,17],[112,102,20,16],[142,101,22,17],[170,100,24,18],[200,102,20,16],[230,101,22,17],[260,102,20,16],[290,101,22,17]],
      attic: [[22,101,22,17],[52,102,18,16],[82,100,24,18],[114,102,20,16],[146,100,24,18],[178,101,22,17],[210,100,24,18],[242,102,20,16],[274,100,24,18],[306,101,22,17]],
      basement: [[22,102,22,17],[52,103,18,16],[80,101,24,18],[112,103,20,16],[144,101,24,17],[176,100,26,18],[210,103,18,16],[238,101,24,17],[270,102,22,16],[302,100,24,18]],
      backyard: [[24,104,20,16],[52,103,18,15],[82,101,22,17],[112,103,20,16],[142,101,22,17],[170,102,20,16],[200,101,22,17],[230,102,20,16],[260,101,22,17],[290,102,20,16]],
    };

    const props = roomProps[zid] || roomProps.entrance;
    const separatedProps = [];
    let previousRight = -Infinity;
    for (const [rawX, rawY, rawW, rawH] of props) {
      const width = Math.max(12, rawW);
      const height = Math.max(10, rawH);
      const minGap = 8;
      const nudgedX = Math.max(rawX, previousRight + minGap);
      const clampedX = Math.min(nudgedX, canvas.width - width - 16);
      separatedProps.push([clampedX, rawY, width, height]);
      previousRight = clampedX + width;
    }

    for (let i = 0; i < separatedProps.length; i += 1) {
      const [px, py, pw, ph] = separatedProps[i];
      const shade = 26 + (i % 4) * 12;
      ctx.fillStyle = `rgba(${44 + shade}, ${32 + shade * 0.5}, ${26 + shade * 0.35}, 0.48)`;
      ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = "rgba(255,220,170,0.12)";
      ctx.fillRect(px + 2, py + 2, Math.max(4, pw - 4), 3);
      ctx.fillStyle = "rgba(0,0,0,0.24)";
      ctx.fillRect(px + 1, py + ph - 2, pw - 2, 2);
    }

    // Hidden lore-book in every room, linked to note text by zone index.
    const bookSpots = {
      entrance: [352, 112], hallway: [336, 110], living: [348, 112], bathroom: [318, 110],
      kitchen: [344, 108], storage: [328, 111], library: [340, 108], bedroom: [356, 110],
      laundry: [322, 111], attic: [334, 108], basement: [346, 110], backyard: [358, 112],
    };
    const [bx, by] = bookSpots[zid] || [340, 110];
    ctx.fillStyle = "rgba(198,170,122,0.86)";
    ctx.fillRect(bx, by, 10, 7);
    ctx.fillStyle = "rgba(114,84,44,0.9)";
    ctx.fillRect(bx + 1, by + 1, 8, 1);
    ctx.fillRect(bx + 1, by + 3, 6, 1);
    ctx.fillStyle = "rgba(70,42,24,0.88)";
    ctx.fillRect(bx - 1, by, 1, 7);
    const loreGlyph = NOTE_LORE[state.zoneIndex % NOTE_LORE.length]?.charAt(0) || "?";
    ctx.fillStyle = "rgba(46,26,14,0.95)";
    ctx.font = "7px monospace";
    ctx.fillText(loreGlyph, bx + 3, by + 6);
  }

  function drawDecor() {
    for (const d of state.decor) {
      const bx = d.x * TILE;
      const by = d.y * TILE;
      if (d.kind === "smudge") {
        ctx.fillStyle = "rgba(120,90,90,0.18)";
        ctx.fillRect(bx + 2, by + 3, 14, 4);
        ctx.fillStyle = "rgba(100,70,70,0.10)";
        ctx.fillRect(bx + 4, by + 7, 8, 2);
      } else if (d.kind === "scratch") {
        ctx.strokeStyle = "rgba(90,70,70,0.22)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx + 2, by + 2);
        ctx.lineTo(bx + 14, by + 14);
        ctx.moveTo(bx + 5, by + 2);
        ctx.lineTo(bx + 16, by + 12);
        ctx.stroke();
      } else if (d.kind === "child") {
        ctx.fillStyle = "rgba(70,40,40,0.22)";
        ctx.fillRect(bx + 20, by + 18, 3, 3);
        ctx.fillRect(bx + 31, by + 18, 3, 3);
        ctx.fillRect(bx + 24, by + 30, 12, 3);
        ctx.fillRect(bx + 26, by + 25, 2, 5);
      } else if (d.kind === "dust_ring") {
        ctx.strokeStyle = "rgba(80,60,60,0.14)";
        ctx.beginPath();
        ctx.arc(bx + 32, by + 32, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "rgba(60,40,40,0.09)";
        ctx.beginPath();
        ctx.arc(bx + 32, by + 32, 18, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawSilhouette(x, y, color, monster = false) {
    const bx = x * TILE + (monster ? 0 : state.player.silhouetteOffsetX);
    const by = y * TILE + (monster ? 0 : state.player.silhouetteOffsetY);

    const playerPalette = {
      1: state.player.hide ? "#5f5f5f" : "#3b2a20",  // hair
      2: state.player.hide ? "#6f6f84" : "#5b6bb2",  // hoodie
      3: state.player.hide ? "#6f6f6f" : "#37405e",  // pants
      4: "rgba(255,255,255,0.20)",                    // chalk highlights
      5: state.player.hide ? "#8f8f8f" : "#d1a184",  // skin
      6: state.player.hide ? "#4f4f4f" : "#1e1a19",  // face detail
      7: "rgba(255,245,225,0.78)",                    // eye shine / teeth glint
    };
    // Human stalker: normal-looking palette with the subtlest wrongness baked in.
    // Color 6 (iris) is milky pale — eyes that reflect no warmth.
    const stalkerPalette = {
      1: "#0f0c0f",             // near-black hair / outlines
      2: "#2a2a2c",             // dark charcoal jacket
      3: "#1a1a1e",             // very dark trousers
      4: "rgba(60,50,55,0.65)", // deep crease shadow
      5: "#c8bfb4",             // ashy skin — too pale, too still
      6: "#d8e8ee",             // iris: milky, washed-out, wrong
      7: "rgba(255,255,255,0.92)", // over-white sclera — always wide open
    };

    const playerSequence = [0, 1, 2, 1, 0, 3, 2, 1];
    const stalkerSequence = [0, 0, 1, 2, 2, 3, 1, 0, 0, 2];
    const stalkerDist = Math.abs(state.stalker.x - state.player.x) + Math.abs(state.stalker.y - state.player.y);
    const fearMode = !monster && stalkerDist <= 5;
    const frame = monster
      ? pickAnimationFrame(STALKER_FRAMES, state.tick, stalkerSequence, 9)
      : pickAnimationFrame(fearMode ? PLAYER_FEAR_FRAMES : PLAYER_FRAMES, state.tick, playerSequence, fearMode ? 6 : 8);

    drawNumberGridSprite(
      ctx,
      frame,
      bx,
      by,
      {
        palette: monster ? stalkerPalette : playerPalette,
        alpha: monster ? 1 : (state.player.hide ? 0.85 : 1),
      },
    );

    if (!monster && getTransformationStacks(state.transformState, TRANSFORM_TYPES.GHOST_LIMB) > 0) {
      ctx.fillStyle = "rgba(20,20,20,0.38)";
      ctx.fillRect(bx + 5, by + 30, 7, 22);
      ctx.fillRect(bx + 52, by + 30, 7, 22);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHESS COMPUTER — Full chess engine vs Stockfish via Web Worker
  // Opened with [E] near tile 25 (bedroom desk PC). [Esc] to close.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Minimal Chess Logic (no dependencies) ──────────────────────────────────
  function chessInitBoard() {
    // rows 0-7 = ranks 8-1, cols 0-7 = files a-h
    // piece: [color, type]  color: w/b  type: K Q R B N P
    const e = null;
    return [
      [["b","R"],["b","N"],["b","B"],["b","Q"],["b","K"],["b","B"],["b","N"],["b","R"]],
      [["b","P"],["b","P"],["b","P"],["b","P"],["b","P"],["b","P"],["b","P"],["b","P"]],
      [e,e,e,e,e,e,e,e],
      [e,e,e,e,e,e,e,e],
      [e,e,e,e,e,e,e,e],
      [e,e,e,e,e,e,e,e],
      [["w","P"],["w","P"],["w","P"],["w","P"],["w","P"],["w","P"],["w","P"],["w","P"]],
      [["w","R"],["w","N"],["w","B"],["w","Q"],["w","K"],["w","B"],["w","N"],["w","R"]],
    ];
  }

  function chessClone(board) { return board.map(r => r.map(c => c ? [...c] : null)); }

  function chessMovesRaw(board, r, c) {
    const piece = board[r][c];
    if (!piece) return [];
    const [col, type] = piece;
    const moves = [];
    const opp = col === "w" ? "b" : "w";
    const push = (tr, tc) => {
      if (tr < 0 || tr > 7 || tc < 0 || tc > 7) return false;
      const t = board[tr][tc];
      if (t && t[0] === col) return false;
      moves.push([tr, tc]);
      return !t; // can continue sliding if empty
    };
    const slide = (drs, dcs) => {
      for (let i = 0; i < drs.length; i++) {
        let nr = r + drs[i], nc = c + dcs[i];
        while (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
          const t = board[nr][nc];
          if (t && t[0] === col) break;
          moves.push([nr, nc]);
          if (t) break;
          nr += drs[i]; nc += dcs[i];
        }
      }
    };
    if (type === "P") {
      const dir = col === "w" ? -1 : 1;
      const start = col === "w" ? 6 : 1;
      if (!board[r+dir]?.[c]) {
        moves.push([r+dir, c]);
        if (r === start && !board[r+dir*2]?.[c]) moves.push([r+dir*2, c]);
      }
      for (const dc of [-1, 1]) {
        const t = board[r+dir]?.[c+dc];
        if (t && t[0] === opp) moves.push([r+dir, c+dc]);
      }
    } else if (type === "N") {
      for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) push(r+dr, c+dc);
    } else if (type === "B") {
      slide([-1,-1,1,1],[-1,1,-1,1]);
    } else if (type === "R") {
      slide([-1,1,0,0],[0,0,-1,1]);
    } else if (type === "Q") {
      slide([-1,-1,1,1,-1,1,0,0],[-1,1,-1,1,0,0,-1,1]);
    } else if (type === "K") {
      for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) push(r+dr, c+dc);
    }
    return moves;
  }

  function chessIsInCheck(board, color) {
    let kr = -1, kc = -1;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p[0] === color && p[1] === "K") { kr = r; kc = c; }
    }
    if (kr < 0) return true;
    const opp = color === "w" ? "b" : "w";
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p[0] === opp) {
        for (const [tr, tc] of chessMovesRaw(board, r, c)) {
          if (tr === kr && tc === kc) return true;
        }
      }
    }
    return false;
  }

  function chessLegalMoves(board, r, c, turn) {
    const piece = board[r][c];
    if (!piece || piece[0] !== turn) return [];
    return chessMovesRaw(board, r, c).filter(([tr, tc]) => {
      const b2 = chessClone(board);
      b2[tr][tc] = b2[r][c];
      b2[r][c] = null;
      return !chessIsInCheck(b2, turn);
    });
  }

  function chessApplyMove(board, fr, fc, tr, tc) {
    const b = chessClone(board);
    const piece = b[fr][fc];
    b[tr][tc] = piece;
    b[fr][fc] = null;
    // pawn promotion
    if (piece && piece[1] === "P" && (tr === 0 || tr === 7)) b[tr][tc] = [piece[0], "Q"];
    return b;
  }

  function chessHasAnyMoves(board, turn) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (board[r][c]?.[0] === turn && chessLegalMoves(board, r, c, turn).length > 0) return true;
    }
    return false;
  }

  function chessToFen(board, turn) {
    let fen = "";
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (!p) { empty++; }
        else {
          if (empty) { fen += empty; empty = 0; }
          const ch = p[1] === "N" ? "N" : p[1];
          fen += p[0] === "w" ? ch.toUpperCase() : ch.toLowerCase();
        }
      }
      if (empty) fen += empty;
      if (r < 7) fen += "/";
    }
    fen += ` ${turn} KQkq - 0 1`;
    return fen;
  }

  function chessFromAlgebraic(mov) {
    // e.g. "e2e4" or "e7e8q"
    const files = "abcdefgh";
    const fc = files.indexOf(mov[0]);
    const fr = 8 - parseInt(mov[1]);
    const tc = files.indexOf(mov[2]);
    const tr = 8 - parseInt(mov[3]);
    return { fr, fc, tr, tc };
  }

  // ── Stockfish Web Worker init ───────────────────────────────────────────────
  function chessInitStockfish() {
    const ch = state.chess;
    if (ch.stockfish) return;
    try {
      // Use Stockfish.js from CDN as a blob worker
      const sfCode = `
        importScripts("https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js");
      `;
      const blob = new Blob([sfCode], { type: "application/javascript" });
      const worker = new Worker(URL.createObjectURL(blob));
      worker.onmessage = (e) => {
        const line = e.data;
        if (line === "uciok" || line === "readyok") ch.sfReady = true;
        if (line && line.startsWith("bestmove")) {
          const parts = line.split(" ");
          const movStr = parts[1];
          if (movStr && movStr !== "(none)") {
            const { fr, fc, tr, tc } = chessFromAlgebraic(movStr);
            setTimeout(() => chessApplyStockfishMove(fr, fc, tr, tc), 200);
          } else {
            ch.gameOver = true;
            ch.message = "Game over.";
            ch.thinking = false;
          }
        }
      };
      worker.onerror = () => {
        ch.sfReady = false;
        ch.message = "Stockfish unavailable — auto-random move.";
        ch.stockfish = null;
      };
      worker.postMessage("uci");
      worker.postMessage("isready");
      ch.stockfish = worker;
    } catch(err) {
      ch.sfReady = false;
    }
  }

  function chessAskStockfish() {
    const ch = state.chess;
    const fen = chessToFen(ch.board, ch.turn);
    if (ch.stockfish && ch.sfReady) {
      ch.stockfish.postMessage(`position fen ${fen}`);
      ch.stockfish.postMessage("go movetime 800");
    } else {
      // Fallback: pick a random legal move
      setTimeout(() => chessRandomMove(), 600);
    }
  }

  function chessRandomMove() {
    const ch = state.chess;
    const all = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (ch.board[r][c]?.[0] === ch.turn) {
        for (const [tr, tc] of chessLegalMoves(ch.board, r, c, ch.turn)) all.push({ fr: r, fc: c, tr, tc });
      }
    }
    if (all.length === 0) { ch.gameOver = true; ch.message = "Game over."; ch.thinking = false; return; }
    const mv = all[(Math.random() * all.length) | 0];
    chessApplyStockfishMove(mv.fr, mv.fc, mv.tr, mv.tc);
  }

  function chessApplyStockfishMove(fr, fc, tr, tc) {
    const ch = state.chess;
    ch.board = chessApplyMove(ch.board, fr, fc, tr, tc);
    ch.lastMove = { fr, fc, tr, tc };
    ch.turn = "w";
    ch.thinking = false;
    if (!chessHasAnyMoves(ch.board, "w")) {
      ch.gameOver = true;
      ch.message = chessIsInCheck(ch.board, "w") ? "Checkmate — Stockfish wins." : "Stalemate — draw.";
    } else if (chessIsInCheck(ch.board, "w")) {
      ch.message = "Check!";
    } else {
      ch.message = "Your move — you are White.";
    }
  }

  // ── Open / close chess overlay ──────────────────────────────────────────────
  function openChessGame() {
    const ch = state.chess;
    if (!ch.open) {
      ch.open = true;
      ch.board = ch.board || chessInitBoard();
      ch.gameOver = false;
      ch.selected = null;
      ch.legalDests = [];
      ch.turn = ch.turn || "w";
      ch.message = "Your move — you are White.";
      chessInitStockfish();
      state.paused = true;
      state.uiText = "[E] or [Esc] to close chess";
    } else {
      closeChessGame();
    }
  }

  function closeChessGame() {
    state.chess.open = false;
    state.paused = false;
    state.uiText = "Back to the house...";
  }

  // ── Chess click handler (attached to canvas) ───────────────────────────────
  function chessHandleClick(evt) {
    const ch = state.chess;
    if (!ch.open || ch.thinking || ch.gameOver || ch.turn !== "w") return;
    const rect = canvas.getBoundingClientRect();
    const mx = (evt.clientX - rect.left) * (canvas.width / rect.width);
    const my = (evt.clientY - rect.top) * (canvas.height / rect.height);
    // Board is drawn centered; find its origin
    const bSize = Math.min(canvas.width, canvas.height) * 0.70;
    const sqSize = bSize / 8;
    const bx = (canvas.width - bSize) / 2;
    const by = (canvas.height - bSize) / 2 + 24;
    const col = Math.floor((mx - bx) / sqSize);
    const row = Math.floor((my - by) / sqSize);
    if (col < 0 || col > 7 || row < 0 || row > 7) {
      // Click outside board — deselect
      ch.selected = null; ch.legalDests = []; return;
    }
    if (ch.selected) {
      // Try to move
      const legal = ch.legalDests.find(([tr, tc]) => tr === row && tc === col);
      if (legal) {
        ch.board = chessApplyMove(ch.board, ch.selected.r, ch.selected.c, row, col);
        ch.lastMove = { fr: ch.selected.r, fc: ch.selected.c, tr: row, tc: col };
        ch.selected = null; ch.legalDests = [];
        ch.turn = "b";
        if (!chessHasAnyMoves(ch.board, "b")) {
          ch.gameOver = true;
          ch.message = chessIsInCheck(ch.board, "b") ? "Checkmate — you win!" : "Stalemate — draw.";
        } else {
          ch.thinking = true;
          ch.message = "Stockfish is thinking…";
          chessAskStockfish();
        }
      } else {
        // Select new piece
        const piece = ch.board[row][col];
        if (piece && piece[0] === "w") {
          ch.selected = { r: row, c: col };
          ch.legalDests = chessLegalMoves(ch.board, row, col, "w");
        } else { ch.selected = null; ch.legalDests = []; }
      }
    } else {
      const piece = ch.board[row][col];
      if (piece && piece[0] === "w") {
        ch.selected = { r: row, c: col };
        ch.legalDests = chessLegalMoves(ch.board, row, col, "w");
      }
    }
  }

  canvas.addEventListener("click", chessHandleClick);

  // ── Chess overlay renderer ──────────────────────────────────────────────────
  const PIECE_GLYPHS = { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
                         bK: "♚", bQ: "♛", bR: "♜", bB: "♝", bN: "♞", bP: "♟" };

  function drawChessOverlay() {
    const ch = state.chess;
    if (!ch.open) return;

    // Dim backdrop
    ctx.fillStyle = "rgba(0,0,0,0.82)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Panel background
    const panelW = Math.min(560, canvas.width - 32);
    const panelH = panelW + 80;
    const panelX = (canvas.width - panelW) / 2;
    const panelY = (canvas.height - panelH) / 2;
    ctx.fillStyle = "#1a1208";
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = "#6a4f1e";
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    // Title bar
    ctx.fillStyle = "#2e1f0a";
    ctx.fillRect(panelX, panelY, panelW, 28);
    ctx.fillStyle = "#d4aa55";
    ctx.font = "bold 14px monospace";
    ctx.fillText("♟  CHESS vs STOCKFISH  ♟", panelX + 12, panelY + 19);
    ctx.fillStyle = "rgba(200,170,100,0.6)";
    ctx.font = "11px monospace";
    ctx.fillText("[Esc] Close", panelX + panelW - 92, panelY + 19);

    // Board
    const bSize = panelW - 40;
    const sqSize = bSize / 8;
    const bx = panelX + 20;
    const by = panelY + 36;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const isLight = (r + c) % 2 === 0;
        let color = isLight ? "#e8d5a3" : "#8b5e3c";
        const isSelected = ch.selected && ch.selected.r === r && ch.selected.c === c;
        const isLastFrom = ch.lastMove && ch.lastMove.fr === r && ch.lastMove.fc === c;
        const isLastTo = ch.lastMove && ch.lastMove.tr === r && ch.lastMove.tc === c;
        const isLegal = ch.legalDests.some(([tr, tc]) => tr === r && tc === c);
        if (isSelected) color = "#f6f669";
        else if (isLastFrom || isLastTo) color = isLight ? "#cdd26a" : "#aaa23a";
        ctx.fillStyle = color;
        ctx.fillRect(bx + c * sqSize, by + r * sqSize, sqSize, sqSize);
        // Legal move dot
        if (isLegal) {
          const target = ch.board[r][c];
          if (target) {
            ctx.strokeStyle = "rgba(20,180,20,0.7)";
            ctx.lineWidth = 2;
            ctx.strokeRect(bx + c * sqSize + 2, by + r * sqSize + 2, sqSize - 4, sqSize - 4);
          } else {
            ctx.fillStyle = "rgba(20,180,20,0.40)";
            ctx.beginPath();
            ctx.arc(bx + c * sqSize + sqSize/2, by + r * sqSize + sqSize/2, sqSize * 0.18, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        // Piece
        const piece = ch.board[r][c];
        if (piece) {
          const key = piece[0] === "w" ? piece[1] : "b" + piece[1];
          const glyph = PIECE_GLYPHS[key] || piece[1];
          ctx.font = `bold ${Math.floor(sqSize * 0.72)}px serif`;
          ctx.fillStyle = piece[0] === "w" ? "#fff8f0" : "#1a0800";
          ctx.strokeStyle = piece[0] === "w" ? "#5a3010" : "#f0d0a0";
          ctx.lineWidth = 1.5;
          ctx.strokeText(glyph, bx + c * sqSize + sqSize * 0.10, by + r * sqSize + sqSize * 0.80);
          ctx.fillText(glyph, bx + c * sqSize + sqSize * 0.10, by + r * sqSize + sqSize * 0.80);
        }
      }
    }

    // Rank & file labels
    ctx.font = "9px monospace";
    ctx.fillStyle = "rgba(200,175,120,0.7)";
    const files = "abcdefgh";
    for (let c = 0; c < 8; c++) ctx.fillText(files[c], bx + c * sqSize + sqSize/2 - 3, by + bSize + 11);
    for (let r = 0; r < 8; r++) ctx.fillText(String(8 - r), bx - 13, by + r * sqSize + sqSize/2 + 4);

    // Status bar
    const statusY = by + bSize + 18;
    ctx.fillStyle = ch.gameOver ? "#ff6060" : ch.thinking ? "#aad4ff" : "#d4c888";
    ctx.font = "11px monospace";
    ctx.fillText(ch.message, panelX + 12, statusY);

    // "New Game" hint
    if (ch.gameOver) {
      ctx.fillStyle = "rgba(200,170,80,0.85)";
      ctx.font = "10px monospace";
      ctx.fillText("Press [R] to restart", panelX + 12, statusY + 16);
    }

    // Thinking spinner
    if (ch.thinking) {
      const spin = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[(Math.floor(state.tick / 4)) % 10];
      ctx.fillStyle = "#aad4ff";
      ctx.font = "14px monospace";
      ctx.fillText(spin, panelX + panelW - 30, statusY);
    }

    ctx.lineWidth = 1;
  }


  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) drawTile(x, y, tileAt(x, y));
    }

    drawRoomStyling();

    drawDecor();

    const drewPlayerSprite = drawPlayerSprite(state.player.renderX, state.player.renderY);
    if (!drewPlayerSprite) drawSilhouette(state.player.renderX, state.player.renderY, state.player.hide ? "#7a7a7a" : "#0f0f0f", false);
    drawBackgroundOccluders();
    const s = getDisplayedStalkerPosition(state.stalker);
    const drewStalkerSprite = drawStalkerSprite(s.x, s.y);
    if (!drewStalkerSprite) drawSilhouette(s.x, s.y, "#1d0d0d", true);
    if (state.phantom) drawSilhouette(state.phantom.x, state.phantom.y, "rgba(35,35,35,0.45)", true);
    for (const c of state.clones) {
      if (!drawPlayerSprite(c.x, c.y)) drawSilhouette(c.x, c.y, "rgba(0,0,0,0.35)", false);
    }

    for (const p of state.particles) {
      ctx.fillStyle = p.kind === "spark" ? "rgba(255,180,90,0.5)" : "rgba(180,180,180,0.25)";
      ctx.fillRect(p.x * TILE, p.y * TILE, 2, 2);
    }

    // Update logger tick for deterministic logging
    if (state.logger) {
      state.logger.setCurrentTick(state.tick);
    }

    // Spawn ambient particles occasionally
    if (state.tick % 30 === 0 && state.rng && state.rng.nextBoolean()) {
      particleSystem.spawnAmbient(2, state.tick);
    }

    // Render particles
    particleSystem.updateAndRender();

    // Render lighting overlay
    const flashlightOn = state.tools.flashlight > 0;
    lightingSystem.render(
      state.player.x,
      state.player.y,
      flashlightOn,
      state.tick
    );

    if (state.decoySound) {
      ctx.strokeStyle = "rgba(120,120,120,0.35)";
      ctx.beginPath();
      ctx.arc(state.decoySound.x * TILE + 8, state.decoySound.y * TILE + 8, 6 + (state.decoySound.ttl % 6), 0, Math.PI * 2);
      ctx.stroke();
    }


    if (!state.noHud) {
      ctx.fillStyle = "rgba(0,0,0,0.58)";
      ctx.fillRect(4, 4, 420, 62);
      ctx.fillStyle = "#fff";
      ctx.font = "10px monospace";
      ctx.fillText(`Zone ${state.zoneIndex + 1}/30  ${zone().name}`, 8, 14);
      ctx.fillText(`Tools[1-5] F${state.tools.flashlight} T${state.tools.tape} C${state.tools.candy} M${state.tools.mirrorShard} K${state.tools.keyCrayon}`, 8, 24);
      ctx.fillText(state.uiText || "", 8, 34);
      ctx.fillText(`FX: ${getTransformationLabels(state.transformState)}`, 8, 44);
      ctx.fillText(`Deaths: ${state.scores.deaths}/3  Rooms: ${state.scores.roomsCompleted}`, 8, 54);
      // ── Key progress ─────────────────────────────────────────────────────
      const keyCount = state.keysCollected.length;
      const keyStr = "🗝".repeat ? "" : ""; // fallback
      ctx.fillStyle = keyCount >= TOTAL_KEYS ? "#f0e050" : "#888";
      ctx.fillText(`Keys: ${keyCount}/${TOTAL_KEYS}  ${"■".repeat(keyCount)}${"□".repeat(TOTAL_KEYS - keyCount)}`, 8, 64);
      if (!CHALLENGE_MODE) {
        const d = state.director;
        const stressBar = "█".repeat(Math.round(d.stress * 10)).padEnd(10, "░");
        ctx.fillText(`DIR stress[${stressBar}] ${d.log[d.log.length-1] || "—"}`, 8, 74);
      }
    }

    if (state.completed && state.ending) {
      ctx.fillStyle = "rgba(0,0,0,0.72)";
      ctx.fillRect(20, 72, canvas.width - 40, 110);
      ctx.fillStyle = "#fff";
      ctx.font = "12px monospace";
      ctx.fillText(state.ending.title, 30, 98);
      ctx.font = "10px monospace";
      ctx.fillText(state.ending.text, 30, 118);
      ctx.fillText(`Transforms: ${getTransformationLabels(state.transformState)}`, 30, 134);
      ctx.fillText(`Rooms cleared: ${state.scores.roomsCompleted}/12`, 30, 150);
      ctx.fillText("Refresh to replay.", 30, 166);
    }

    // Chess overlay drawn last (on top of everything)
    drawChessOverlay();
  }

  function loop() {
    update();
    render();
    requestAnimationFrame(loop);
  }

  resetZoneMap();

  return {
    state,
    start() {
      spriteReady.finally(() => requestAnimationFrame(loop));
    },
    onKeyChange(event, down) {
      const key = event.key.toLowerCase();
      state.keys[key] = down;
      if (down && key === "u") state.noHud = !state.noHud;
      // Chess overlay keys
      if (down && state.chess.open) {
        if (event.key === "Escape") { closeChessGame(); event.preventDefault(); }
        if (key === "r" && state.chess.gameOver) {
          state.chess.board = chessInitBoard();
          state.chess.turn = "w";
          state.chess.selected = null;
          state.chess.legalDests = [];
          state.chess.lastMove = null;
          state.chess.thinking = false;
          state.chess.gameOver = false;
          state.chess.message = "Your move — you are White.";
        }
      }
    },
    getSnapshot() {
      return createSnapshot();
    },
    loadSnapshot(snapshot) {
      return restoreSnapshot(snapshot);
    },
    triggerSoftlockRescue() {
      rescueFromSoftlock();
    },
    setBotController({ name = "Custom Bot", hash = "" } = {}) {
      if (state.bot.locked) return false;
      state.bot.enabled = true;
      state.bot.name = name;
      state.bot.hash = hash;
      state.bot.lastError = "";
      state.runAttributes.bot = { mode: "bot", name, hash, disabled: false, violations: 0, integrity: "verified" };
      state.uiText = `${name} is piloting this run.`;
      return true;
    },
    setBotInput(nextInput = {}) {
      if (!state.bot.enabled) return;
      state.bot.input = nextInput;
    },
    setBotError(message = "") {
      state.bot.lastError = String(message);
      state.uiText = `Bot error: ${state.bot.lastError}`;
    },
    recordBotViolation(reason = "policy") {
      state.runAttributes.bot.violations = (state.runAttributes.bot.violations || 0) + 1;
      state.uiText = `Bot violation: ${reason}`;
    },
    setBotIntegrity(status = "unknown") {
      state.runAttributes.bot.integrity = String(status);
    },
    lockBotForRun() {
      state.bot.locked = true;
    },
    clearBotController({ permanent = false } = {}) {
      state.bot.enabled = false;
      for (const key of BOT_CONTROL_KEYS) state.keys[key] = false;
      state.bot.input = {};
      state.runAttributes.bot = {
        mode: state.bot.name ? "bot" : "none",
        name: state.bot.name,
        hash: state.bot.hash,
        disabled: true,
        violations: state.runAttributes.bot.violations || 0,
        integrity: state.runAttributes.bot.integrity || "unknown",
      };
      if (permanent && !state.bot.locked) {
        state.bot.name = "";
        state.bot.hash = "";
        state.runAttributes.bot = { mode: "none", name: "", hash: "", disabled: true, violations: 0, integrity: "unknown" };
      }
      state.uiText = "Bot Disabled";
    },
    getBotStatus() {
      return { enabled: state.bot.enabled, name: state.bot.name, hash: state.bot.hash, lastError: state.bot.lastError, locked: state.bot.locked };
    },
    getBotObservation() {
      return getBotObservation();
    },
  };
