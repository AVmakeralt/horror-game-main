// ── Example Mod Template ─────────────────────────────────────────────────────
// This is an example mod showing how to extend the horror game
// Copy this file and modify it to create your own mods

// First, register your mod metadata
api.registerMetadata({
  name: "Example Mod",
  version: "1.0.0",
  author: "Your Name",
  description: "An example mod that adds a new zone and custom items",
  requiredGameVersion: "1.0.0",
  dependencies: [],
  conflicts: [],
  loadPriority: 0,
});

// ── Mod Initialization Code ───────────────────────────────────────────────────

// Add a new zone to the game
const newZoneIndex = api.addZone({
  id: "custom_laboratory",
  name: "Secret Laboratory",
  stalkerSpawn: { x: 26, y: 1 },
  ai: {
    speed: 2,
    sightRange: 7,
    hearingRange: 6,
    sightCone: Math.PI / 3.2,
    catchRadius: 1,
    predictive: true,
  },
  hazards: {
    flicker: true,
    migration: true,
  },
  entryText: "You found a hidden laboratory. The experiments never stopped.",
});

// Add a custom item
api.addItem("research_notes", {
  name: "Research Notes",
  description: "Cryptic notes about the experiments",
  stackable: true,
  maxStack: 5,
});

// Register a custom console command
api.registerCommand("example-hello", function() {
  return "Hello from the Example Mod!";
}, "Prints a greeting from the mod");

// Register an event hook for when the player enters a zone
api.on("zoneEnter", function(data) {
  api.log("ZONE", `Player entered zone ${data.zoneIndex}`);
  
  // Special behavior for our custom zone
  if (data.zoneIndex === newZoneIndex) {
    api.log("MOD", "Player entered the Secret Laboratory!");
  }
});

// Register an event hook for when the player collects a key
api.on("keyCollect", function(data) {
  api.log("KEY", `Key collected in zone ${data.zoneIndex}`);
});

// ── Advanced Mod Features ─────────────────────────────────────────────────────

// Modify an existing zone
try {
  api.modifyZone(0, {
    entryText: "Modified entry text from Example Mod",
  });
} catch (e) {
  api.log("ERROR", `Failed to modify zone: ${e.message}`);
}

// Register a custom tile type (future feature)
// api.addTileType(30, {
//   name: "Custom Floor",
//   walkable: true,
//   description: "A custom floor type",
// });

// ── Mod Cleanup ─────────────────────────────────────────────────────────────
// If your mod needs cleanup when unloaded, you can register an unload hook
// api.on("modUnload", function() {
//   // Cleanup code here
// });
