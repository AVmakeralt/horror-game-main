// ── Modding System ─────────────────────────────────────────────────────────────
// Allows external modifications to the game while maintaining safety and stability

// Mod metadata structure
class ModMetadata {
  constructor(data) {
    this.name = data.name || "Unknown Mod";
    this.version = data.version || "1.0.0";
    this.author = data.author || "Unknown";
    this.description = data.description || "";
    this.requiredGameVersion = data.requiredGameVersion || "1.0.0";
    this.dependencies = data.dependencies || [];
    this.conflicts = data.conflicts || [];
    this.loadPriority = data.loadPriority || 0;
  }

  // Check if mod is compatible with current game version
  isCompatible(gameVersion) {
    const [modMajor, modMinor] = this.requiredGameVersion.split('.').map(Number);
    const [gameMajor, gameMinor] = gameVersion.split('.').map(Number);
    return modMajor === gameMajor && modMinor <= gameMinor;
  }

  // Check for conflicts with other mods
  hasConflicts(otherMods) {
    for (const mod of otherMods) {
      if (this.conflicts.includes(mod.metadata.name)) {
        return { conflict: mod.metadata.name, reason: "explicit conflict" };
      }
      if (mod.metadata.conflicts.includes(this.name)) {
        return { conflict: mod.metadata.name, reason: "explicit conflict" };
      }
    }
    return null;
  }
}

// Mod API - provides safe interfaces for modding
class ModAPI {
  constructor(game) {
    this.game = game;
    this.state = game.state;
    this.registeredHooks = new Map();
  }

  // Safe zone modification
  addZone(zoneData) {
    if (!this.game.ZONES) throw new Error("ZONES not available");
    const zone = {
      id: zoneData.id,
      name: zoneData.name,
      stalkerSpawn: zoneData.stalkerSpawn || { x: 26, y: 1 },
      ai: zoneData.ai || { speed: 1, sightRange: 5, hearingRange: 4, sightCone: Math.PI / 3, catchRadius: 1 },
      hazards: zoneData.hazards || {},
      entryText: zoneData.entryText || "",
    };
    this.game.ZONES.push(zone);
    return this.game.ZONES.length - 1;
  }

  // Modify existing zone
  modifyZone(zoneIndex, modifications) {
    if (!this.game.ZONES || !this.game.ZONES[zoneIndex]) {
      throw new Error(`Zone ${zoneIndex} not found`);
    }
    const zone = this.game.ZONES[zoneIndex];
    Object.assign(zone, modifications);
    return zone;
  }

  // Add custom tile type
  addTileType(tileId, properties) {
    // This would extend the tile system
    // For now, just register the metadata
    this.game.customTileTypes = this.game.customTileTypes || {};
    this.game.customTileTypes[tileId] = properties;
    return true;
  }

  // Add custom item
  addItem(itemId, itemData) {
    this.game.customItems = this.game.customItems || {};
    this.game.customItems[itemId] = {
      name: itemData.name,
      description: itemData.description,
      stackable: itemData.stackable || false,
      maxStack: itemData.maxStack || 1,
    };
    return true;
  }

  // Register event hook
  on(event, callback) {
    if (!this.registeredHooks.has(event)) {
      this.registeredHooks.set(event, []);
    }
    this.registeredHooks.get(event).push(callback);
  }

  // Trigger event hooks
  trigger(event, data) {
    const callbacks = this.registeredHooks.get(event) || [];
    for (const callback of callbacks) {
      try {
        callback(data);
      } catch (e) {
        console.error(`Mod hook error in ${event}:`, e);
      }
    }
  }

  // Safe console command registration
  registerCommand(name, handler, description = "") {
    this.game.modCommands = this.game.modCommands || {};
    this.game.modCommands[name] = { handler, description };
    return true;
  }

  // Get current game state (read-only snapshot)
  getGameState() {
    return JSON.parse(JSON.stringify({
      zoneIndex: this.state.zoneIndex,
      tick: this.state.tick,
      scores: this.state.scores,
      tools: this.state.tools,
      transformState: this.state.transformState,
    }));
  }

  // Log to game logger
  log(category, message, data = null) {
    if (this.state.logger) {
      this.state.logger.log(`MOD-${category}`, message, data);
    }
  }
}

// Loaded mod instance
class LoadedMod {
  constructor(metadata, api, initFunction) {
    this.metadata = metadata;
    this.api = api;
    this.initFunction = initFunction;
    this.enabled = true;
    this.loaded = false;
    this.errors = [];
  }

  // Initialize the mod
  async initialize() {
    if (this.loaded) return;
    try {
      await this.initFunction(this.api);
      this.loaded = true;
    } catch (e) {
      this.errors.push(e.message);
      throw e;
    }
  }

  // Enable/disable mod
  setEnabled(enabled) {
    this.enabled = enabled;
  }
}

// Mod manager
class ModManager {
  constructor(game) {
    this.game = game;
    this.loadedMods = new Map();
    this.modLoadOrder = [];
    this.gameVersion = game.GAME_VERSION || "1.0.0";
  }

  // Load a mod from code
  async loadMod(modCode) {
    try {
      // Parse mod code
      const modFunction = new Function('api', modCode);
      
      // Extract metadata from mod code (expects mod to call api.registerMetadata)
      let metadata = null;
      const tempApi = {
        registerMetadata: (data) => { metadata = new ModMetadata(data); },
      };
      
      // Execute mod to get metadata
      modFunction(tempApi);
      
      if (!metadata) {
        throw new Error("Mod did not register metadata");
      }

      // Check compatibility
      if (!metadata.isCompatible(this.gameVersion)) {
        throw new Error(`Mod requires game version ${metadata.requiredGameVersion}, current is ${this.gameVersion}`);
      }

      // Check conflicts
      const existingMods = Array.from(this.loadedMods.values());
      const conflict = metadata.hasConflicts(existingMods);
      if (conflict) {
        throw new Error(`Mod conflicts with ${conflict.conflict}: ${conflict.reason}`);
      }

      // Create actual API and load mod
      const api = new ModAPI(this.game);
      const loadedMod = new LoadedMod(metadata, api, modFunction);
      
      // Initialize mod
      await loadedMod.initialize();

      // Add to loaded mods
      this.loadedMods.set(metadata.name, loadedMod);
      this.modLoadOrder.push(metadata.name);

      return { success: true, mod: metadata.name };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Load mod from file path (browser environment)
  async loadModFromFile(file) {
    try {
      const text = await file.text();
      return await this.loadMod(text);
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Unload a mod
  unloadMod(modName) {
    const mod = this.loadedMods.get(modName);
    if (!mod) {
      return { success: false, error: "Mod not found" };
    }

    // Disable the mod
    mod.setEnabled(false);
    this.loadedMods.delete(modName);
    this.modLoadOrder = this.modLoadOrder.filter(name => name !== modName);

    return { success: true };
  }

  // Enable/disable mod
  toggleMod(modName, enabled) {
    const mod = this.loadedMods.get(modName);
    if (!mod) {
      return { success: false, error: "Mod not found" };
    }

    mod.setEnabled(enabled);
    return { success: true, enabled };
  }

  // List all loaded mods
  listMods() {
    return Array.from(this.loadedMods.values()).map(mod => ({
      name: mod.metadata.name,
      version: mod.metadata.version,
      author: mod.metadata.author,
      enabled: mod.enabled,
      loaded: mod.loaded,
      errors: mod.errors,
    }));
  }

  // Get mod info
  getModInfo(modName) {
    const mod = this.loadedMods.get(modName);
    if (!mod) {
      return null;
    }

    return {
      metadata: mod.metadata,
      enabled: mod.enabled,
      loaded: mod.loaded,
      errors: mod.errors,
    };
  }

  // Reload all mods
  async reloadAll() {
    const mods = Array.from(this.loadedMods.entries());
    this.loadedMods.clear();
    this.modLoadOrder = [];

    const results = [];
    for (const [name, mod] of mods) {
      // Re-initialize mod
      const result = await this.loadMod(mod.initFunction.toString());
      results.push({ name, result });
    }

    return results;
  }

  // Clear all mods
  clearAll() {
    this.loadedMods.clear();
    this.modLoadOrder = [];
    return { success: true };
  }
}

// Export
export { ModManager, ModAPI, ModMetadata, LoadedMod };
export function createModManager(game) {
  return new ModManager(game);
}
