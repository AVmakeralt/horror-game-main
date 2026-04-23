function toInt(v, fallback = 0) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toFloat(v, fallback = 0) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(v) {
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
}

export function registerConsoleCommands(game) {
  if (!game) return null;

  const api = {
    // Basic Commands (1-10)
    help() {
      return [
        "=== BASIC COMMANDS ===",
        "help, freeze, unfreeze, resume, pause",
        "teleport stalker <x> <y>, teleport player <x> <y>",
        "teleport object <fromX> <fromY> <toX> <toY>",
        "place <x> <y> <tile>, gettile <x> <y>",
        "=== PLAYER COMMANDS ===",
        "player speed <value>, player hide, player unhide",
        "player position, player facing, player reset",
        "player invincible <on/off>, player visible <on/off>",
        "=== STALKER COMMANDS ===",
        "stalker speed <value>, stalker position",
        "stalker freeze, stalker unfreeze, stalker reset",
        "stalker visible <on/off>, stalker aggressive <on/off>",
        "=== MAP COMMANDS ===",
        "map reset, map clear, map fill <tile>",
        "map zone <index>, map list, map current",
        "map export, map import <data>",
        "map create <template>, map load <layout>",
        "map tile <x> <y> <type>, map save <name>",
        "=== REPRODUCIBILITY COMMANDS ===",
        "seed set <value>, seed get, seed reset",
        "seed deterministic <on/off>, seed random",
        "version lock, version unlock, version info",
        "snapshot take <name>, snapshot restore <name>",
        "snapshot list, snapshot delete <name>, snapshot clear",
        "log enable, log disable, log export <category>",
        "log clear, log tick <start> <end>",
        "=== MOD COMMANDS ===",
        "mod load <code>, mod load-file <file>",
        "mod unload <name>, mod list, mod info <name>",
        "mod enable <name>, mod disable <name>, mod reload-all",
        "mod clear, mod register-command <name> <code>",
        "=== MAP EDITOR COMMANDS ===",
        "editor template <name>, editor list-templates",
        "editor load <name>, editor save <name>",
        "editor tile <x> <y> <char>, editor clear",
        "=== ITEM COMMANDS ===",
        "item give <item>, item remove <item>",
        "item list, item clear, item flashlight",
        "item tape, item candy, item mirrorshard, item keycrayon",
        "=== ZONE COMMANDS ===",
        "zone goto <index>, zone list, zone info <index>",
        "zone unlock <index>, zone lock <index>",
        "zone skip, zone reset, zone complete",
        "=== TRANSFORM COMMANDS ===",
        "transform add <type>, transform remove <type>",
        "transform list, transform clear, transform status",
        "transform inversion <on/off>, transform speed <value>",
        "=== SCORE COMMANDS ===",
        "score show, score reset, score corruption <value>",
        "score encounters <value>, score deaths <value>",
        "score rooms <value>, score detections <value>",
        "=== VISUAL COMMANDS ===",
        "visual light <mode>, visual flicker <on/off>",
        "visual hud <on/off>, visual particles <on/off>",
        "visual shake <intensity>, visual flash <duration>",
        "=== SPAWN COMMANDS ===",
        "spawn key <x> <y>, spawn clone <x> <y>",
        "spawn phantom <x> <y>, spawn decoy <x> <y>",
        "spawn particle <x> <y> <type>, spawn decor <x> <y> <type>",
        "=== AI COMMANDS ===",
        "ai speed <value>, ai sight <value>",
        "ai hearing <value>, ai predictive <on/off>",
        "ai patrol <on/off>, ai chase <on/off>",
        "=== DOOR COMMANDS ===",
        "door open <x> <y>, door close <x> <y>",
        "door lock <x> <y>, door unlock <x> <y>",
        "door toggle <x> <y>, door all",
        "=== HAZARD COMMANDS ===",
        "hazard add <x> <y> <type>, hazard remove <x> <y>",
        "hazard list, hazard clear, hazard acid <x> <y>",
        "hazard crack <x> <y>, hazard ritual <x> <y>",
        "=== MIRROR COMMANDS ===",
        "mirror loop <x> <y> <targetX> <targetY>",
        "mirror normal <x> <y>, mirror fake <x> <y>",
        "mirror lure <on/off>, mirror clone <on/off>",
        "=== TRIGGER COMMANDS ===",
        "trigger activate <x> <y>, trigger deactivate <x> <y>",
        "trigger list, trigger clear, trigger add <x> <y> <type>",
        "=== DEBUG COMMANDS ===",
        "debug mode <on/off>, debug showhitbox <on/off>",
        "debug showpath <on/off>, debug showvision <on/off>",
        "debug log <message>, debug trace <on/off>",
        "=== TIME COMMANDS ===",
        "time scale <value>, time freeze, time normal",
        "time tick <amount>, time skip <seconds>",
        "=== SAVE COMMANDS ===",
        "save, load, clearsave, autosave <on/off>",
        "snapshot create, snapshot load, snapshot clear",
        "=== AUDIO COMMANDS ===",
        "audio volume <value>, audio mute <on/off>",
        "audio distortion <value>, audio reset",
        "=== CHESS COMMANDS ===",
        "chess open, chess close, chess reset",
        "chess move <from> <to>, chess status",
        "=== BOT COMMANDS ===",
        "bot status, bot enable, bot disable",
        "bot input <action>, bot clear",
        "=== MISC COMMANDS ===",
        "echo <message>, clear, version",
        "fps, ping, memory, stats",
        "random <min> <max>, seed <value>",
        "=== ADVANCED COMMANDS ===",
        "director stress <value>, director action <type>",
        "director fog <x> <y> <alpha>, director friction <x> <y>",
        "corruption spread <x> <y>, corruption clear",
        "phantom spawn <x> <y>, phantom remove",
        "clone spawn <x> <y>, clone clear",
        "particle clear, decor clear",
        "=== ROOM COMMANDS ===",
        "room dark <x> <y> <intensity>, room light <x> <y> <intensity>",
        "room ambient <type>, room reset <index>",
        "room furniture <x> <y> <type>, room object <x> <y> <type>",
        "=== TILE COMMANDS ===",
        "tile replace <old> <new>, tile count <type>",
        "tile find <type>, tile region <x1> <y1> <x2> <y2> <tile>",
        "tile border <tile>, tile fill <x1> <y1> <x2> <y2> <tile>",
        "=== PATHFINDING COMMANDS ===",
        "path find <fromX> <fromY> <toX> <toY>",
        "path block <x> <y>, path unblock <x> <y>",
        "path reset, path show <on/off>",
        "=== ANIMATION COMMANDS ===",
        "anim player <type>, anim stalker <type>",
        "anim speed <value>, anim frame <frame>",
        "=== CAMERA COMMANDS ===",
        "camera follow <on/off>, camera shake <intensity>",
        "camera zoom <level>, camera pan <x> <y>",
        "camera reset, camera lock <on/off>",
        "=== PHYSICS COMMANDS ===",
        "physics gravity <value>, physics friction <value>",
        "physics collision <on/off>, physics reset",
        "=== EVENT COMMANDS ===",
        "event trigger <type>, event list",
        "event clear, event schedule <type> <delay>",
        "=== LORE COMMANDS ===",
        "lore show <index>, lore list",
        "lore add <text>, lore random",
        "=== ACHIEVEMENT COMMANDS ===",
        "achievement unlock <id>, achievement list",
        "achievement reset, achievement show",
        "=== CONFIG COMMANDS ===",
        "config get <key>, config set <key> <value>",
        "config list, config reset, config save",
        "=== NETWORK COMMANDS ===",
        "network latency <ms>, network packetloss <value>",
        "network simulate <on/off>, network reset",
        "=== TESTING COMMANDS ===",
        "test suite <name>, test run",
        "test clear, test result, test benchmark",
        "=== PERFORMANCE COMMANDS ===",
        "perf monitor <on/off>, perf profile",
        "perf stats, perf reset, perf optimize",
        "=== SECURITY COMMANDS ===",
        "security check, security validate",
        "security hash, security verify",
        "=== EXTERNAL COMMANDS ===",
        "external load <url>, external save <path>",
        "external import <file>, external export <file>",
        "=== SYSTEM COMMANDS ===",
        "system info, system os, system browser",
        "system memory, system cpu, system gpu",
        "=== EXPERIMENTAL COMMANDS ===",
        "experimental feature <name> <on/off>",
        "experimental list, experimental reset",
        "experimental mode <type>",
        "=== ADMIN COMMANDS ===",
        "admin login <password>, admin logout",
        "admin ban <player>, admin kick <player>",
        "admin mute <player>, admin unban <player>",
      ].join("\n");
    },
    freeze() {
      game.setPaused?.(true);
      return "Game frozen.";
    },
    unfreeze() {
      game.setPaused?.(false);
      return "Game running.";
    },
    pause() {
      game.setPaused?.(true);
      return "Game paused.";
    },
    resume() {
      game.setPaused?.(false);
      return "Game resumed.";
    },

    // Player Commands
    teleportStalker(x, y) {
      game.teleportStalker?.(toInt(x), toInt(y));
      return `Stalker teleported to ${toInt(x)},${toInt(y)}.`;
    },
    teleportPlayer(x, y) {
      game.teleportPlayer?.(toInt(x), toInt(y));
      return `Player teleported to ${toInt(x)},${toInt(y)}.`;
    },
    teleportObject(fromX, fromY, toX, toY) {
      const ok = game.teleportObject?.(toInt(fromX), toInt(fromY), toInt(toX), toInt(toY));
      return ok ? "Object teleported." : "Object teleport failed.";
    },
    place(x, y, tile) {
      game.placeTile?.(toInt(x), toInt(y), toInt(tile));
      return `Tile ${toInt(tile)} placed at ${toInt(x)},${toInt(y)}.`;
    },
    gettile(x, y) {
      const tile = game.getTile?.(toInt(x), toInt(y));
      return `Tile at ${toInt(x)},${toInt(y)}: ${tile ?? "unknown"}`;
    },
    playerSpeed(value) {
      game.state?.player && (game.state.player.moveCooldown = toInt(value, 4));
      return `Player speed set to ${value}.`;
    },
    playerHide() {
      game.state?.player && (game.state.player.hide = true);
      return "Player hidden.";
    },
    playerUnhide() {
      game.state?.player && (game.state.player.hide = false);
      return "Player unhidden.";
    },
    playerPosition() {
      const p = game.state?.player;
      return p ? `Player at (${p.x}, ${p.y})` : "Player not found.";
    },
    playerFacing() {
      const p = game.state?.player;
      return p ? `Player facing: ${p.facing}` : "Player not found.";
    },
    playerReset() {
      game.state?.player && (game.state.player.x = 2, game.state.player.y = 5);
      return "Player reset to spawn.";
    },
    playerInvincible(value) {
      game.state?.player && (game.state.player.invincible = toBool(value));
      return `Player invincibility: ${toBool(value)}`;
    },
    playerVisible(value) {
      game.state?.player && (game.state.player.visible = toBool(value));
      return `Player visibility: ${toBool(value)}`;
    },

    // Stalker Commands
    stalkerSpeed(value) {
      game.state?.stalker && (game.state.stalker.speed = toInt(value));
      return `Stalker speed set to ${value}.`;
    },
    stalkerPosition() {
      const s = game.state?.stalker;
      return s ? `Stalker at (${s.x}, ${s.y})` : "Stalker not found.";
    },
    stalkerFreeze() {
      game.state?.stalker && (game.state.stalker.frozen = true);
      return "Stalker frozen.";
    },
    stalkerUnfreeze() {
      game.state?.stalker && (game.state.stalker.frozen = false);
      return "Stalker unfrozen.";
    },
    stalkerReset() {
      game.state?.stalker && (game.state.stalker.x = 18, game.state.stalker.y = 1);
      return "Stalker reset.";
    },
    stalkerVisible(value) {
      game.state?.stalker && (game.state.stalker.visible = toBool(value));
      return `Stalker visibility: ${toBool(value)}`;
    },
    stalkerAggressive(value) {
      game.state?.stalker && (game.state.stalker.aggressive = toBool(value));
      return `Stalker aggression: ${toBool(value)}`;
    },

    // Map Commands
    mapReset() {
      game.resetZoneMap?.();
      return "Map reset.";
    },
    mapClear() {
      game.state?.map && game.state.map.fill(1);
      return "Map cleared (all walls).";
    },
    mapFill(tile) {
      game.state?.map && game.state.map.fill(toInt(tile));
      return `Map filled with tile ${tile}.`;
    },
    mapZone(index) {
      const idx = toInt(index);
      game.state && (game.state.zoneIndex = idx);
      game.resetZoneMap?.(idx);
      return `Switched to zone ${idx}.`;
    },
    mapList() {
      return game.ZONES?.map((z, i) => `${i}: ${z.name}`).join("\n") || "No zones.";
    },
    mapCurrent() {
      const z = game.ZONES?.[game.state?.zoneIndex ?? 0];
      return z ? `Current zone: ${game.state?.zoneIndex} - ${z.name}` : "No current zone.";
    },
    mapExport() {
      const map = game.state?.map;
      return map ? JSON.stringify(map) : "No map to export.";
    },
    mapImport(data) {
      try {
        const arr = JSON.parse(data);
        game.state && (game.state.map = arr);
        return "Map imported.";
      } catch {
        return "Import failed: invalid JSON.";
      }
    },
    mapCreate(templateName) {
      const templates = game.LAB_HOME_TEMPLATES || {};
      const template = templates[templateName];
      if (template) {
        game.state && (game.state.map = game.createCustomMap?.(template.layout));
        return `Created map from template: ${templateName} (${template.description})`;
      }
      return `Template not found: ${templateName}. Available: ${Object.keys(templates).join(", ")}`;
    },
    mapLoad(layoutStr) {
      if (game.createCustomMap) {
        game.state && (game.state.map = game.createCustomMap(layoutStr));
        return "Custom map loaded from layout string.";
      }
      return "Custom map function not available.";
    },
    mapTile(x, y, type) {
      game.placeTile?.(toInt(x), toInt(y), toInt(type));
      return `Tile at ${x},${y} set to ${type}`;
    },
    mapSave(name) {
      const map = game.state?.map;
      if (map) {
        game.customMaps = game.customMaps || {};
        game.customMaps[name] = [...map];
        return `Map saved as: ${name}`;
      }
      return "No map to save.";
    },

    // Map Editor Commands
    editorTemplate(templateName) {
      return this.mapCreate(templateName);
    },
    editorListTemplates() {
      const templates = game.LAB_HOME_TEMPLATES || {};
      return Object.entries(templates).map(([name, t]) => `${name}: ${t.description}`).join("\n") || "No templates available.";
    },
    editorLoad(name) {
      const map = game.customMaps?.[name];
      if (map) {
        game.state && (game.state.map = [...map]);
        return `Loaded custom map: ${name}`;
      }
      return `Custom map not found: ${name}`;
    },
    editorSave(name) {
      return this.mapSave(name);
    },
    editorTile(x, y, char) {
      const tileMap = {
        '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
        '8': 8, '9': 9, 'a': 10, 'b': 11, 'c': 12, 'd': 13, 'e': 14,
        'f': 15, 'g': 16, 'h': 17, 'i': 18, 'j': 19, 'k': 20, 'l': 21,
        'm': 22, 'n': 23, 'o': 24,
      };
      const tile = tileMap[char];
      if (tile !== undefined) {
        game.placeTile?.(toInt(x), toInt(y), tile);
        return `Tile at ${x},${y} set to ${tile} (${char})`;
      }
      return `Invalid tile char: ${char}. Use 0-9, a-o`;
    },
    editorClear() {
      game.customMaps = {};
      return "All custom maps cleared.";
    },

    // Reproducibility Commands
    seedSet(value) {
      const seed = toInt(value);
      game.state && (game.state.seed = seed);
      game.state?.rng && game.state.rng.setSeed(seed);
      game.state?.logger && game.state.logger.log("SEED", `Seed set to ${seed}`);
      return `Seed set to ${seed}`;
    },
    seedGet() {
      return `Current seed: ${game.state?.seed ?? "N/A"}${game.state?.deterministicMode ? " (deterministic mode)" : ""}`;
    },
    seedReset() {
      game.state?.rng && game.state.rng.reset();
      game.state?.logger && game.state.logger.log("SEED", "RNG reset to original seed");
      return "RNG reset to original seed";
    },
    seedDeterministic(value) {
      const enabled = toBool(value);
      game.state && (game.state.deterministicMode = enabled);
      game.state?.logger && game.state.logger.log("SEED", `Deterministic mode: ${enabled}`);
      return `Deterministic mode: ${enabled}`;
    },
    seedRandom() {
      game.state && (game.state.seed = Date.now());
      game.state?.rng && game.state.rng.setSeed(Date.now());
      game.state && (game.state.deterministicMode = false);
      game.state?.logger && game.state.logger.log("SEED", "Switched to random seed");
      return "Switched to random seed";
    },
    versionLock() {
      game.state && (game.state.versionLocked = true);
      game.state?.logger && game.state.logger.log("VERSION", "Version locked");
      return `Version locked: ${game.GAME_VERSION?.major}.${game.GAME_VERSION?.minor}.${game.GAME_VERSION?.patch}`;
    },
    versionUnlock() {
      game.state && (game.state.versionLocked = false);
      game.state?.logger && game.state.logger.log("VERSION", "Version unlocked");
      return "Version unlocked";
    },
    versionInfo() {
      const v = game.GAME_VERSION || {};
      return `Version: ${v.major}.${v.minor}.${v.patch}, Hash: ${v.hash}, Build: ${v.build}`;
    },
    snapshotTake(name) {
      if (!game.state?.configSnapshot) return "Config snapshot system not available";
      try {
        const snapshot = game.state.configSnapshot.takeSnapshot(name, game.state);
        game.state?.logger && game.state.logger.log("SNAPSHOT", `Snapshot taken: ${name}`);
        return `Snapshot "${name}" taken at tick ${game.state.tick}`;
      } catch (e) {
        return `Failed to take snapshot: ${e.message}`;
      }
    },
    snapshotRestore(name) {
      if (!game.state?.configSnapshot) return "Config snapshot system not available";
      try {
        const snapshot = game.state.configSnapshot.restoreSnapshot(name, game.state);
        game.state?.logger && game.state.logger.log("SNAPSHOT", `Snapshot restored: ${name}`);
        return `Snapshot "${name}" restored (seed: ${snapshot.seed})`;
      } catch (e) {
        return `Failed to restore snapshot: ${e.message}`;
      }
    },
    snapshotList() {
      if (!game.state?.configSnapshot) return "Config snapshot system not available";
      const snapshots = game.state.configSnapshot.listSnapshots();
      return snapshots.length === 0 
        ? "No snapshots" 
        : snapshots.map(s => `${s.name} (v${s.version.major}.${s.version.minor}, seed: ${s.seed})`).join("\n");
    },
    snapshotDelete(name) {
      if (!game.state?.configSnapshot) return "Config snapshot system not available";
      const deleted = game.state.configSnapshot.deleteSnapshot(name);
      game.state?.logger && game.state.logger.log("SNAPSHOT", `Snapshot deleted: ${name}`);
      return deleted ? `Snapshot "${name}" deleted` : `Snapshot "${name}" not found`;
    },
    snapshotClear() {
      if (!game.state?.configSnapshot) return "Config snapshot system not available";
      game.state.configSnapshot.clear();
      game.state?.logger && game.state.logger.log("SNAPSHOT", "All snapshots cleared");
      return "All snapshots cleared";
    },
    logEnable() {
      game.state?.logger && game.state.logger.setEnabled(true);
      return "Logging enabled";
    },
    logDisable() {
      game.state?.logger && game.state.logger.setEnabled(false);
      return "Logging disabled";
    },
    logExport(category) {
      if (!game.state?.logger) return "Logger not available";
      if (category) {
        const logs = game.state.logger.getLogs(category);
        return JSON.stringify(logs, null, 2);
      }
      return game.state.logger.exportLogs();
    },
    logClear() {
      game.state?.logger && game.state.logger.clear();
      return "Logs cleared";
    },
    logTick(start, end) {
      if (!game.state?.logger) return "Logger not available";
      const logs = game.state.logger.getLogsByTick(toInt(start), toInt(end));
      return JSON.stringify(logs, null, 2);
    },

    // Mod Commands
    async modLoad(code) {
      if (!game.modManager) return "Mod manager not available";
      try {
        const result = await game.modManager.loadMod(code);
        if (result.success) {
          return `Mod "${result.mod}" loaded successfully`;
        }
        return `Failed to load mod: ${result.error}`;
      } catch (e) {
        return `Mod load error: ${e.message}`;
      }
    },
    async modLoadFile(filePath) {
      if (!game.modManager) return "Mod manager not available";
      try {
        // In browser environment, this would use File API
        // For now, return a message about file loading
        return "File loading requires browser File API. Use mod load with code instead.";
      } catch (e) {
        return `Mod file load error: ${e.message}`;
      }
    },
    modUnload(name) {
      if (!game.modManager) return "Mod manager not available";
      const result = game.modManager.unloadMod(name);
      if (result.success) {
        return `Mod "${name}" unloaded`;
      }
      return result.error;
    },
    modList() {
      if (!game.modManager) return "Mod manager not available";
      const mods = game.modManager.listMods();
      if (mods.length === 0) return "No mods loaded";
      return mods.map(m => `${m.name} v${m.version} by ${m.author} [${m.enabled ? 'enabled' : 'disabled'}]`).join("\n");
    },
    modInfo(name) {
      if (!game.modManager) return "Mod manager not available";
      const info = game.modManager.getModInfo(name);
      if (!info) return `Mod "${name}" not found`;
      return JSON.stringify(info, null, 2);
    },
    modEnable(name) {
      if (!game.modManager) return "Mod manager not available";
      const result = game.modManager.toggleMod(name, true);
      if (result.success) {
        return `Mod "${name}" enabled`;
      }
      return result.error;
    },
    modDisable(name) {
      if (!game.modManager) return "Mod manager not available";
      const result = game.modManager.toggleMod(name, false);
      if (result.success) {
        return `Mod "${name}" disabled`;
      }
      return result.error;
    },
    async modReloadAll() {
      if (!game.modManager) return "Mod manager not available";
      try {
        const results = await game.modManager.reloadAll();
        return `Reloaded ${results.length} mod(s)`;
      } catch (e) {
        return `Reload error: ${e.message}`;
      }
    },
    modClear() {
      if (!game.modManager) return "Mod manager not available";
      game.modManager.clearAll();
      return "All mods cleared";
    },
    modRegisterCommand(name, code) {
      try {
        const handler = new Function(code);
        game.modCommands = game.modCommands || {};
        game.modCommands[name] = { handler, description: "Custom mod command" };
        return `Command "${name}" registered`;
      } catch (e) {
        return `Failed to register command: ${e.message}`;
      }
    },

    // Item Commands
    itemGive(item) {
      game.state?.tools && (game.state.tools[item] = (game.state.tools[item] ?? 0) + 1);
      return `Gave item: ${item}`;
    },
    itemRemove(item) {
      game.state?.tools && (game.state.tools[item] = Math.max(0, (game.state.tools[item] ?? 1) - 1));
      return `Removed item: ${item}`;
    },
    itemList() {
      return game.state?.tools ? JSON.stringify(game.state.tools) : "No items.";
    },
    itemClear() {
      game.state && (game.state.tools = {});
      return "Items cleared.";
    },
    itemFlashlight() { return this.itemGive("flashlight"); },
    itemTape() { return this.itemGive("tape"); },
    itemCandy() { return this.itemGive("candy"); },
    itemMirrorshard() { return this.itemGive("mirrorShard"); },
    itemKeycrayon() { return this.itemGive("keyCrayon"); },

    // Zone Commands
    zoneGoto(index) {
      return this.mapZone(index);
    },
    zoneList() {
      return this.mapList();
    },
    zoneInfo(index) {
      const z = game.ZONES?.[toInt(index)];
      return z ? JSON.stringify(z, null, 2) : "Zone not found.";
    },
    zoneUnlock(index) {
      // Implementation depends on zone lock system
      return `Zone ${index} unlocked (placeholder).`;
    },
    zoneLock(index) {
      return `Zone ${index} locked (placeholder).`;
    },
    zoneSkip() {
      const next = (game.state?.zoneIndex ?? 0) + 1;
      return this.mapZone(next);
    },
    zoneReset() {
      return this.mapZone(game.state?.zoneIndex ?? 0);
    },
    zoneComplete() {
      game.state?.scores && (game.state.scores.roomsCompleted += 1);
      return "Zone marked complete.";
    },

    // Transform Commands
    transformAdd(type) {
      game.addTransformation?.(type);
      return `Added transform: ${type}`;
    },
    transformRemove(type) {
      game.removeTransformation?.(type);
      return `Removed transform: ${type}`;
    },
    transformList() {
      return game.state?.transformState ? JSON.stringify(game.state.transformState) : "No transforms.";
    },
    transformClear() {
      game.clearTransformations?.();
      return "Transforms cleared.";
    },
    transformStatus() {
      return this.transformList();
    },
    transformInversion(value) {
      const on = toBool(value);
      if (on) this.transformAdd("CONTROL_INVERSION");
      else this.transformRemove("CONTROL_INVERSION");
      return `Control inversion: ${on}`;
    },
    transformSpeed(value) {
      game.state?.transformState && (game.state.transformState.speedReduction = toInt(value));
      return `Speed reduction: ${value}`;
    },

    // Score Commands
    scoreShow() {
      return game.state?.scores ? JSON.stringify(game.state.scores) : "No scores.";
    },
    scoreReset() {
      game.state && (game.state.scores = { corruptionLevel: 0, aiEncounters: 0, roomsCompleted: 0, roomsVisited: 1, detections: 0, deaths: 0 });
      return "Scores reset.";
    },
    scoreCorruption(value) {
      game.state?.scores && (game.state.scores.corruptionLevel = toInt(value));
      return `Corruption: ${value}`;
    },
    scoreEncounters(value) {
      game.state?.scores && (game.state.scores.aiEncounters = toInt(value));
      return `Encounters: ${value}`;
    },
    scoreDeaths(value) {
      game.state?.scores && (game.state.scores.deaths = toInt(value));
      return `Deaths: ${value}`;
    },
    scoreRooms(value) {
      game.state?.scores && (game.state.scores.roomsCompleted = toInt(value));
      return `Rooms: ${value}`;
    },
    scoreDetections(value) {
      game.state?.scores && (game.state.scores.detections = toInt(value));
      return `Detections: ${value}`;
    },

    // Visual Commands
    visualLight(mode) {
      game.state && (game.state.lightMode = mode);
      return `Light mode: ${mode}`;
    },
    visualFlicker(value) {
      game.state && (game.state.flickerEnabled = toBool(value));
      return `Flicker: ${toBool(value)}`;
    },
    visualHud(value) {
      game.state && (game.state.noHud = !toBool(value));
      return `HUD: ${toBool(value)}`;
    },
    visualParticles(value) {
      game.state && (game.state.particlesEnabled = toBool(value));
      return `Particles: ${toBool(value)}`;
    },
    visualShake(intensity) {
      game.state && (game.state.shakeIntensity = toFloat(intensity));
      return `Shake: ${intensity}`;
    },
    visualFlash(duration) {
      game.state && (game.state.flashDuration = toInt(duration));
      return `Flash: ${duration}`;
    },

    // Spawn Commands
    spawnKey(x, y) {
      game.placeTile?.(toInt(x), toInt(y), 24);
      return `Key spawned at ${x},${y}`;
    },
    spawnClone(x, y) {
      game.state?.clones && game.state.clones.push({ x: toInt(x), y: toInt(y) });
      return `Clone spawned at ${x},${y}`;
    },
    spawnPhantom(x, y) {
      game.state && (game.state.phantom = { x: toInt(x), y: toInt(y) });
      return `Phantom spawned at ${x},${y}`;
    },
    spawnDecoy(x, y) {
      game.state && (game.state.decoySound = { x: toInt(x), y: toInt(y) });
      return `Decoy spawned at ${x},${y}`;
    },
    spawnParticle(x, y, type) {
      game.state?.particles && game.state.particles.push({ x: toInt(x), y: toInt(y), type });
      return `Particle ${type} spawned at ${x},${y}`;
    },
    spawnDecor(x, y, type) {
      game.state?.decor && game.state.decor.push({ x: toInt(x), y: toInt(y), type });
      return `Decor ${type} spawned at ${x},${y}`;
    },

    // AI Commands
    aiSpeed(value) {
      const zone = game.ZONES?.[game.state?.zoneIndex ?? 0];
      if (zone) zone.ai.speed = toInt(value);
      return `AI speed: ${value}`;
    },
    aiSight(value) {
      const zone = game.ZONES?.[game.state?.zoneIndex ?? 0];
      if (zone) zone.ai.sightRange = toInt(value);
      return `AI sight: ${value}`;
    },
    aiHearing(value) {
      const zone = game.ZONES?.[game.state?.zoneIndex ?? 0];
      if (zone) zone.ai.hearingRange = toInt(value);
      return `AI hearing: ${value}`;
    },
    aiPredictive(value) {
      const zone = game.ZONES?.[game.state?.zoneIndex ?? 0];
      if (zone) zone.ai.predictive = toBool(value);
      return `AI predictive: ${toBool(value)}`;
    },
    aiPatrol(value) {
      const zone = game.ZONES?.[game.state?.zoneIndex ?? 0];
      if (zone) zone.ai.patrolEnabled = toBool(value);
      return `AI patrol: ${toBool(value)}`;
    },
    aiChase(value) {
      const zone = game.ZONES?.[game.state?.zoneIndex ?? 0];
      if (zone) zone.ai.chaseEnabled = toBool(value);
      return `AI chase: ${toBool(value)}`;
    },

    // Door Commands
    doorOpen(x, y) {
      game.placeTile?.(toInt(x), toInt(y), 0);
      return `Door opened at ${x},${y}`;
    },
    doorClose(x, y) {
      game.placeTile?.(toInt(x), toInt(y), 14);
      return `Door closed at ${x},${y}`;
    },
    doorLock(x, y) {
      game.placeTile?.(toInt(x), toInt(y), 9);
      return `Door locked at ${x},${y}`;
    },
    doorUnlock(x, y) {
      game.placeTile?.(toInt(x), toInt(y), 14);
      return `Door unlocked at ${x},${y}`;
    },
    doorToggle(x, y) {
      const tile = game.getTile?.(toInt(x), toInt(y));
      if (tile === 14) return this.doorOpen(x, y);
      if (tile === 0) return this.doorClose(x, y);
      return `No door at ${x},${y}`;
    },
    doorAll() {
      return "All doors toggled (placeholder).";
    },

    // Hazard Commands
    hazardAdd(x, y, type) {
      game.placeTile?.(toInt(x), toInt(y), toInt(type));
      return `Hazard ${type} added at ${x},${y}`;
    },
    hazardRemove(x, y) {
      game.placeTile?.(toInt(x), toInt(y), 0);
      return `Hazard removed at ${x},${y}`;
    },
    hazardList() {
      return "Hazard list (placeholder).";
    },
    hazardClear() {
      return "Hazards cleared (placeholder).";
    },
    hazardAcid(x, y) { return this.hazardAdd(x, y, 18); },
    hazardCrack(x, y) { return this.hazardAdd(x, y, 22); },
    hazardRitual(x, y) { return this.hazardAdd(x, y, 19); },

    // Mirror Commands
    mirrorLoop(x, y, targetX, targetY) {
      game.state?.mirrorLoops && (game.state.mirrorLoops[`${x},${y}`] = { x: toInt(targetX), y: toInt(targetY) });
      return `Looping mirror at ${x},${y} -> ${targetX},${targetY}`;
    },
    mirrorNormal(x, y) {
      game.placeTile?.(toInt(x), toInt(y), 11);
      return `Normal mirror at ${x},${y}`;
    },
    mirrorFake(x, y) {
      game.placeTile?.(toInt(x), toInt(y), 11);
      game.state?.fakeMirrors && game.state.fakeMirrors.add(`${x},${y}`);
      return `Fake mirror at ${x},${y}`;
    },
    mirrorLure(value) {
      game.state && (game.state.mirrorLureEnabled = toBool(value));
      return `Mirror lure: ${toBool(value)}`;
    },
    mirrorClone(value) {
      game.state && (game.state.mirrorCloneEnabled = toBool(value));
      return `Mirror clone: ${toBool(value)}`;
    },

    // Trigger Commands
    triggerActivate(x, y) {
      return `Trigger activated at ${x},${y} (placeholder).`;
    },
    triggerDeactivate(x, y) {
      return `Trigger deactivated at ${x},${y} (placeholder).`;
    },
    triggerList() {
      return "Trigger list (placeholder).";
    },
    triggerClear() {
      return "Triggers cleared (placeholder).";
    },
    triggerAdd(x, y, type) {
      return `Trigger ${type} added at ${x},${y} (placeholder).`;
    },

    // Debug Commands
    debugMode(value) {
      game.state && (game.state.debugMode = toBool(value));
      return `Debug mode: ${toBool(value)}`;
    },
    debugShowhitbox(value) {
      game.state && (game.state.showHitbox = toBool(value));
      return `Show hitbox: ${toBool(value)}`;
    },
    debugShowpath(value) {
      game.state && (game.state.showPath = toBool(value));
      return `Show path: ${toBool(value)}`;
    },
    debugShowvision(value) {
      game.state && (game.state.showVision = toBool(value));
      return `Show vision: ${toBool(value)}`;
    },
    debugLog(message) {
      console.log(`[DEBUG] ${message}`);
      return `Logged: ${message}`;
    },
    debugTrace(value) {
      game.state && (game.state.traceEnabled = toBool(value));
      return `Trace: ${toBool(value)}`;
    },

    // Time Commands
    timeScale(value) {
      game.state && (game.state.timeScale = toFloat(value));
      return `Time scale: ${value}`;
    },
    timeFreeze() {
      game.state && (game.state.timeScale = 0);
      return "Time frozen.";
    },
    timeNormal() {
      game.state && (game.state.timeScale = 1);
      return "Time normal.";
    },
    timeTick(amount) {
      game.state && (game.state.tick += toInt(amount));
      return `Time advanced ${amount} ticks.`;
    },
    timeSkip(seconds) {
      return this.timeTick(seconds * 60);
    },

    // Save Commands
    save() {
      game.saveProgress?.();
      return "Game saved.";
    },
    load() {
      game.loadProgress?.();
      return "Game loaded.";
    },
    clearsave() {
      game.clearProgress?.();
      return "Save cleared.";
    },
    autosave(value) {
      game.state && (game.state.autosaveEnabled = toBool(value));
      return `Autosave: ${toBool(value)}`;
    },
    snapshotCreate() {
      return game.getSnapshot ? "Snapshot created." : "Snapshot failed.";
    },
    snapshotLoad() {
      return "Snapshot loaded (placeholder).";
    },
    snapshotClear() {
      return "Snapshot cleared (placeholder).";
    },

    // Audio Commands
    audioVolume(value) {
      game.state && (game.state.audioVolume = toFloat(value));
      return `Volume: ${value}`;
    },
    audioMute(value) {
      game.state && (game.state.audioMuted = toBool(value));
      return `Muted: ${toBool(value)}`;
    },
    audioDistortion(value) {
      game.state?.player && (game.state.player.audioDistortion = toFloat(value));
      return `Distortion: ${value}`;
    },
    audioReset() {
      game.state && (game.state.audioVolume = 1, game.state.audioMuted = false);
      return "Audio reset.";
    },

    // Chess Commands
    chessOpen() {
      game.state?.chess && (game.state.chess.open = true);
      return "Chess opened.";
    },
    chessClose() {
      game.state?.chess && (game.state.chess.open = false);
      return "Chess closed.";
    },
    chessReset() {
      game.state?.chess && (game.state.chess.board = null, game.state.chess.gameOver = false);
      return "Chess reset.";
    },
    chessMove(from, to) {
      return `Chess move ${from} -> ${to} (placeholder).`;
    },
    chessStatus() {
      return game.state?.chess ? JSON.stringify(game.state.chess) : "Chess not available.";
    },

    // Bot Commands
    botStatus() {
      return game.state?.bot ? JSON.stringify(game.state.bot) : "Bot not available.";
    },
    botEnable() {
      game.state?.bot && (game.state.bot.enabled = true);
      return "Bot enabled.";
    },
    botDisable() {
      game.state?.bot && (game.state.bot.enabled = false);
      return "Bot disabled.";
    },
    botInput(action) {
      game.setBotInput?.(JSON.parse(action));
      return `Bot input: ${action}`;
    },
    botClear() {
      game.state?.bot && (game.state.bot.input = {});
      return "Bot input cleared.";
    },

    // Misc Commands
    echo(message) {
      return message;
    },
    clear() {
      console.clear();
      return "Console cleared.";
    },
    version() {
      return "Horror Game v1.0 - Expanded Edition";
    },
    fps() {
      return "FPS: " + (game.state?.fps ?? "unknown");
    },
    ping() {
      return "Ping: 0ms (local)";
    },
    memory() {
      return `Memory: ${Math.round(performance.memory?.usedJSHeapSize / 1024 / 1024)}MB`;
    },
    stats() {
      return this.scoreShow();
    },
    random(min, max) {
      const r = Math.floor(Math.random() * (toInt(max) - toInt(min) + 1)) + toInt(min);
      return `Random: ${r}`;
    },
    seed(value) {
      Math.seedrandom?.(value);
      return `Seed: ${value}`;
    },

    // Director Commands
    directorStress(value) {
      game.state?.director && (game.state.director.stress = toFloat(value));
      return `Director stress: ${value}`;
    },
    directorAction(type) {
      return `Director action ${type} (placeholder).`;
    },
    directorFog(x, y, alpha) {
      game.state?.director?.fogClusters && game.state.director.fogClusters.push({ x: toInt(x), y: toInt(y), alpha: toFloat(alpha) });
      return `Fog added at ${x},${y}`;
    },
    directorFriction(x, y) {
      game.state?.director?.frictionCells && game.state.director.frictionCells.add(`${x},${y}`);
      return `Friction at ${x},${y}`;
    },

    // Corruption Commands
    corruptionSpread(x, y) {
      game.placeTile?.(toInt(x), toInt(y), 3);
      return `Corruption at ${x},${y}`;
    },
    corruptionClear() {
      const map = game.state?.map;
      if (map) for (let i = 0; i < map.length; i++) if (map[i] === 3) map[i] = 0;
      return "Corruption cleared.";
    },

    // Phantom Commands
    phantomSpawn(x, y) {
      return this.spawnPhantom(x, y);
    },
    phantomRemove() {
      game.state && (game.state.phantom = null);
      return "Phantom removed.";
    },

    // Clone Commands
    cloneSpawn(x, y) {
      return this.spawnClone(x, y);
    },
    cloneClear() {
      game.state && (game.state.clones = []);
      return "Clones cleared.";
    },

    particleClear() {
      game.state && (game.state.particles = []);
      return "Particles cleared.";
    },

    decorClear() {
      game.state && (game.state.decor = []);
      return "Decor cleared.";
    },

    // Room Commands
    roomDark(x, y, intensity) {
      return `Room darkened at ${x},${y} (placeholder).`;
    },
    roomLight(x, y, intensity) {
      return `Room lit at ${x},${y} (placeholder).`;
    },
    roomAmbient(type) {
      return `Ambient ${type} (placeholder).`;
    },
    roomReset(index) {
      return this.zoneReset();
    },
    roomFurniture(x, y, type) {
      return `Furniture ${type} at ${x},${y} (placeholder).`;
    },
    roomObject(x, y, type) {
      return `Object ${type} at ${x},${y} (placeholder).`;
    },

    // Tile Commands
    tileReplace(old, newTile) {
      const map = game.state?.map;
      if (map) for (let i = 0; i < map.length; i++) if (map[i] === toInt(old)) map[i] = toInt(newTile);
      return `Replaced tile ${old} with ${newTile}.`;
    },
    tileCount(type) {
      const map = game.state?.map;
      const count = map ? map.filter(t => t === toInt(type)).length : 0;
      return `Tile ${type} count: ${count}`;
    },
    tileFind(type) {
      const map = game.state?.map;
      if (!map) return "No map.";
      const positions = [];
      for (let i = 0; i < map.length; i++) if (map[i] === toInt(type)) positions.push(`${i % 28},${Math.floor(i / 28)}`);
      return positions.slice(0, 20).join(", ") + (positions.length > 20 ? "..." : "");
    },
    tileRegion(x1, y1, x2, y2, tile) {
      for (let y = toInt(y1); y <= toInt(y2); y++) {
        for (let x = toInt(x1); x <= toInt(x2); x++) {
          game.placeTile?.(x, y, toInt(tile));
        }
      }
      return `Region filled with tile ${tile}.`;
    },
    tileBorder(tile) {
      const w = 28, h = 10;
      for (let x = 0; x < w; x++) { game.placeTile?.(x, 0, toInt(tile)); game.placeTile?.(x, h - 1, toInt(tile)); }
      for (let y = 0; y < h; y++) { game.placeTile?.(0, y, toInt(tile)); game.placeTile?.(w - 1, y, toInt(tile)); }
      return `Border set to tile ${tile}.`;
    },
    tileFill(x1, y1, x2, y2, tile) {
      return this.tileRegion(x1, y1, x2, y2, tile);
    },

    // Pathfinding Commands
    pathFind(fromX, fromY, toX, toY) {
      return `Path ${fromX},${fromY} -> ${toX},${toY} (placeholder).`;
    },
    pathBlock(x, y) {
      game.placeTile?.(toInt(x), toInt(y), 1);
      return `Path blocked at ${x},${y}`;
    },
    pathUnblock(x, y) {
      game.placeTile?.(toInt(x), toInt(y), 0);
      return `Path unblocked at ${x},${y}`;
    },
    pathReset() {
      return "Path reset (placeholder).";
    },
    pathShow(value) {
      game.state && (game.state.showPath = toBool(value));
      return `Show path: ${toBool(value)}`;
    },

    // Animation Commands
    animPlayer(type) {
      return `Player anim ${type} (placeholder).`;
    },
    animStalker(type) {
      return `Stalker anim ${type} (placeholder).`;
    },
    animSpeed(value) {
      game.state && (game.state.animSpeed = toFloat(value));
      return `Anim speed: ${value}`;
    },
    animFrame(frame) {
      game.state && (game.state.animFrame = toInt(frame));
      return `Anim frame: ${frame}`;
    },

    // Camera Commands
    cameraFollow(value) {
      game.state && (game.state.cameraFollow = toBool(value));
      return `Camera follow: ${toBool(value)}`;
    },
    cameraShake(intensity) {
      return this.visualShake(intensity);
    },
    cameraZoom(level) {
      game.state && (game.state.cameraZoom = toFloat(level));
      return `Camera zoom: ${level}`;
    },
    cameraPan(x, y) {
      game.state && (game.state.cameraPan = { x: toInt(x), y: toInt(y) });
      return `Camera pan: ${x},${y}`;
    },
    cameraReset() {
      game.state && (game.state.cameraZoom = 1, game.state.cameraPan = null);
      return "Camera reset.";
    },
    cameraLock(value) {
      game.state && (game.state.cameraLocked = toBool(value));
      return `Camera locked: ${toBool(value)}`;
    },

    // Physics Commands
    physicsGravity(value) {
      game.state && (game.state.gravity = toFloat(value));
      return `Gravity: ${value}`;
    },
    physicsFriction(value) {
      game.state && (game.state.friction = toFloat(value));
      return `Friction: ${value}`;
    },
    physicsCollision(value) {
      game.state && (game.state.collisionEnabled = toBool(value));
      return `Collision: ${toBool(value)}`;
    },
    physicsReset() {
      game.state && (game.state.gravity = 1, game.state.friction = 1, game.state.collisionEnabled = true);
      return "Physics reset.";
    },

    // Event Commands
    eventTrigger(type) {
      return `Event ${type} triggered (placeholder).`;
    },
    eventList() {
      return "Event list (placeholder).";
    },
    eventClear() {
      game.state && (game.state.events = []);
      return "Events cleared.";
    },
    eventSchedule(type, delay) {
      game.state?.events && game.state.events.push({ type, delay: toInt(delay) });
      return `Event ${type} scheduled in ${delay} ticks.`;
    },

    // Lore Commands
    loreShow(index) {
      const idx = toInt(index);
      const lore = game.NOTE_LORE?.[idx];
      return lore ?? `Lore ${idx} not found.`;
    },
    loreList() {
      return game.NOTE_LORE?.map((l, i) => `${i}: ${l.slice(0, 30)}...`).join("\n") ?? "No lore.";
    },
    loreAdd(text) {
      game.NOTE_LORE?.push(text);
      return `Lore added: ${text.slice(0, 30)}...`;
    },
    loreRandom() {
      const lore = game.NOTE_LORE;
      if (lore) return lore[Math.floor(Math.random() * lore.length)];
      return "No lore.";
    },

    // Achievement Commands
    achievementUnlock(id) {
      game.state?.achievements && (game.state.achievements[id] = true);
      return `Achievement ${id} unlocked.`;
    },
    achievementList() {
      return game.state?.achievements ? Object.keys(game.state.achievements).join(", ") : "No achievements.";
    },
    achievementReset() {
      game.state && (game.state.achievements = {});
      return "Achievements reset.";
    },
    achievementShow() {
      return this.achievementList();
    },

    // Config Commands
    configGet(key) {
      return game.state?.config?.[key] ?? "Config key not found.";
    },
    configSet(key, value) {
      game.state?.config && (game.state.config[key] = value);
      return `Config ${key} = ${value}`;
    },
    configList() {
      return game.state?.config ? Object.keys(game.state.config).join(", ") : "No config.";
    },
    configReset() {
      game.state && (game.state.config = {});
      return "Config reset.";
    },
    configSave() {
      return "Config saved (placeholder).";
    },

    // Network Commands
    networkLatency(ms) {
      game.state && (game.state.networkLatency = toInt(ms));
      return `Latency: ${ms}ms`;
    },
    networkPacketloss(value) {
      game.state && (game.state.packetLoss = toFloat(value));
      return `Packet loss: ${value}`;
    },
    networkSimulate(value) {
      game.state && (game.state.networkSimulated = toBool(value));
      return `Network simulation: ${toBool(value)}`;
    },
    networkReset() {
      game.state && (game.state.networkLatency = 0, game.state.packetLoss = 0, game.state.networkSimulated = false);
      return "Network reset.";
    },

    // Testing Commands
    testSuite(name) {
      return `Test suite ${name} (placeholder).`;
    },
    testRun() {
      return "Tests run (placeholder).";
    },
    testClear() {
      return "Tests cleared (placeholder).";
    },
    testResult() {
      return "Test results (placeholder).";
    },
    testBenchmark() {
      return "Benchmark (placeholder).";
    },

    // Performance Commands
    perfMonitor(value) {
      game.state && (game.state.perfMonitor = toBool(value));
      return `Performance monitor: ${toBool(value)}`;
    },
    perfProfile() {
      return "Profile (placeholder).";
    },
    perfStats() {
      return this.stats();
    },
    perfReset() {
      return "Performance reset (placeholder).";
    },
    perfOptimize() {
      return "Optimization applied (placeholder).";
    },

    // Security Commands
    securityCheck() {
      return "Security check passed.";
    },
    securityValidate() {
      return "Validation passed.";
    },
    securityHash() {
      return "Hash: " + Math.random().toString(36).substring(7);
    },
    securityVerify() {
      return "Verification passed.";
    },

    // External Commands
    externalLoad(url) {
      return `Loaded from ${url} (placeholder).`;
    },
    externalSave(path) {
      return `Saved to ${path} (placeholder).`;
    },
    externalImport(file) {
      return `Imported ${file} (placeholder).`;
    },
    externalExport(file) {
      return `Exported ${file} (placeholder).`;
    },

    // System Commands
    systemInfo() {
      return "System info collected.";
    },
    systemOs() {
      return navigator.platform ?? "Unknown OS";
    },
    systemBrowser() {
      return navigator.userAgent;
    },
    systemMemory() {
      return this.memory();
    },
    systemCpu() {
      return navigator.hardwareConcurrency ?? "Unknown CPU cores";
    },
    systemGpu() {
      return "GPU info not available.";
    },

    // Experimental Commands
    experimentalFeature(name, value) {
      game.state?.experimental && (game.state.experimental[name] = toBool(value));
      return `Feature ${name}: ${toBool(value)}`;
    },
    experimentalList() {
      return game.state?.experimental ? Object.keys(game.state.experimental).join(", ") : "No experimental features.";
    },
    experimentalReset() {
      game.state && (game.state.experimental = {});
      return "Experimental reset.";
    },
    experimentalMode(type) {
      game.state && (game.state.experimentalMode = type);
      return `Experimental mode: ${type}`;
    },

    // Admin Commands
    adminLogin(password) {
      game.state && (game.state.adminLoggedIn = password === "admin");
      return game.state?.adminLoggedIn ? "Admin logged in." : "Login failed.";
    },
    adminLogout() {
      game.state && (game.state.adminLoggedIn = false);
      return "Admin logged out.";
    },
    adminBan(player) {
      return `Banned ${player} (placeholder).`;
    },
    adminKick(player) {
      return `Kicked ${player} (placeholder).`;
    },
    adminMute(player) {
      return `Muted ${player} (placeholder).`;
    },
    adminUnban(player) {
      return `Unbanned ${player} (placeholder).`;
    },

    run(input = "") {
      const parts = String(input).trim().split(/\s+/);
      const cmd = parts[0]?.toLowerCase();
      if (!cmd) return this.help();

      // Map commands to methods
      const cmdMap = {
        // Basic
        help: "help", freeze: "freeze", unfreeze: "unfreeze", resume: "resume", pause: "pause",
        // Teleport
        teleport: "teleport", tp: "teleport",
        // Place/Get
        place: "place", gettile: "gettile", gt: "gettile",
        // Player
        "player-speed": "playerSpeed", "player-hide": "playerHide", "player-unhide": "playerUnhide",
        "player-position": "playerPosition", "player-facing": "playerFacing", "player-reset": "playerReset",
        "player-invincible": "playerInvincible", "player-visible": "playerVisible",
        // Stalker
        "stalker-speed": "stalkerSpeed", "stalker-position": "stalkerPosition", "stalker-freeze": "stalkerFreeze",
        "stalker-unfreeze": "stalkerUnfreeze", "stalker-reset": "stalkerReset", "stalker-visible": "stalkerVisible",
        "stalker-aggressive": "stalkerAggressive",
        // Map
        "map-reset": "mapReset", "map-clear": "mapClear", "map-fill": "mapFill", "map-zone": "mapZone",
        "map-list": "mapList", "map-current": "mapCurrent", "map-export": "mapExport", "map-import": "mapImport",
        "map-create": "mapCreate", "map-load": "mapLoad", "map-tile": "mapTile", "map-save": "mapSave",
        // Map Editor
        "editor-template": "editorTemplate", "editor-list-templates": "editorListTemplates",
        "editor-load": "editorLoad", "editor-save": "editorSave",
        "editor-tile": "editorTile", "editor-clear": "editorClear",
        // Reproducibility
        "seed-set": "seedSet", "seed-get": "seedGet", "seed-reset": "seedReset",
        "seed-deterministic": "seedDeterministic", "seed-random": "seedRandom",
        "version-lock": "versionLock", "version-unlock": "versionUnlock", "version-info": "versionInfo",
        "snapshot-take": "snapshotTake", "snapshot-restore": "snapshotRestore",
        "snapshot-list": "snapshotList", "snapshot-delete": "snapshotDelete", "snapshot-clear": "snapshotClear",
        "log-enable": "logEnable", "log-disable": "logDisable", "log-export": "logExport",
        "log-clear": "logClear", "log-tick": "logTick",
        // Mod
        "mod-load": "modLoad", "mod-load-file": "modLoadFile", "mod-unload": "modUnload",
        "mod-list": "modList", "mod-info": "modInfo", "mod-enable": "modEnable",
        "mod-disable": "modDisable", "mod-reload-all": "modReloadAll", "mod-clear": "modClear",
        "mod-register-command": "modRegisterCommand",
        // Item
        "item-give": "itemGive", "item-remove": "itemRemove", "item-list": "itemList", "item-clear": "itemClear",
        "item-flashlight": "itemFlashlight", "item-tape": "itemTape", "item-candy": "itemCandy",
        "item-mirrorshard": "itemMirrorshard", "item-keycrayon": "itemKeycrayon",
        // Zone
        "zone-goto": "zoneGoto", "zone-list": "zoneList", "zone-info": "zoneInfo", "zone-unlock": "zoneUnlock",
        "zone-lock": "zoneLock", "zone-skip": "zoneSkip", "zone-reset": "zoneReset", "zone-complete": "zoneComplete",
        // Transform
        "transform-add": "transformAdd", "transform-remove": "transformRemove", "transform-list": "transformList",
        "transform-clear": "transformClear", "transform-status": "transformStatus", "transform-inversion": "transformInversion",
        "transform-speed": "transformSpeed",
        // Score
        "score-show": "scoreShow", "score-reset": "scoreReset", "score-corruption": "scoreCorruption",
        "score-encounters": "scoreEncounters", "score-deaths": "scoreDeaths", "score-rooms": "scoreRooms",
        "score-detections": "scoreDetections",
        // Visual
        "visual-light": "visualLight", "visual-flicker": "visualFlicker", "visual-hud": "visualHud",
        "visual-particles": "visualParticles", "visual-shake": "visualShake", "visual-flash": "visualFlash",
        // Spawn
        "spawn-key": "spawnKey", "spawn-clone": "spawnClone", "spawn-phantom": "spawnPhantom",
        "spawn-decoy": "spawnDecoy", "spawn-particle": "spawnParticle", "spawn-decor": "spawnDecor",
        // AI
        "ai-speed": "aiSpeed", "ai-sight": "aiSight", "ai-hearing": "aiHearing", "ai-predictive": "aiPredictive",
        "ai-patrol": "aiPatrol", "ai-chase": "aiChase",
        // Door
        "door-open": "doorOpen", "door-close": "doorClose", "door-lock": "doorLock", "door-unlock": "doorUnlock",
        "door-toggle": "doorToggle", "door-all": "doorAll",
        // Hazard
        "hazard-add": "hazardAdd", "hazard-remove": "hazardRemove", "hazard-list": "hazardList",
        "hazard-clear": "hazardClear", "hazard-acid": "hazardAcid", "hazard-crack": "hazardCrack",
        "hazard-ritual": "hazardRitual",
        // Mirror
        "mirror-loop": "mirrorLoop", "mirror-normal": "mirrorNormal", "mirror-fake": "mirrorFake",
        "mirror-lure": "mirrorLure", "mirror-clone": "mirrorClone",
        // Trigger
        "trigger-activate": "triggerActivate", "trigger-deactivate": "triggerDeactivate",
        "trigger-list": "triggerList", "trigger-clear": "triggerClear", "trigger-add": "triggerAdd",
        // Debug
        "debug-mode": "debugMode", "debug-showhitbox": "debugShowhitbox", "debug-showpath": "debugShowpath",
        "debug-showvision": "debugShowvision", "debug-log": "debugLog", "debug-trace": "debugTrace",
        // Time
        "time-scale": "timeScale", "time-freeze": "timeFreeze", "time-normal": "timeNormal",
        "time-tick": "timeTick", "time-skip": "timeSkip",
        // Save
        save: "save", load: "load", clearsave: "clearsave", autosave: "autosave",
        "snapshot-create": "snapshotCreate", "snapshot-load": "snapshotLoad", "snapshot-clear": "snapshotClear",
        // Audio
        "audio-volume": "audioVolume", "audio-mute": "audioMute", "audio-distortion": "audioDistortion",
        "audio-reset": "audioReset",
        // Chess
        "chess-open": "chessOpen", "chess-close": "chessClose", "chess-reset": "chessReset",
        "chess-move": "chessMove", "chess-status": "chessStatus",
        // Bot
        "bot-status": "botStatus", "bot-enable": "botEnable", "bot-disable": "botDisable",
        "bot-input": "botInput", "bot-clear": "botClear",
        // Misc
        echo: "echo", clear: "clear", version: "version", fps: "fps", ping: "ping",
        memory: "memory", stats: "stats", random: "random", seed: "seed",
        // Director
        "director-stress": "directorStress", "director-action": "directorAction",
        "director-fog": "directorFog", "director-friction": "directorFriction",
        // Corruption
        "corruption-spread": "corruptionSpread", "corruption-clear": "corruptionClear",
        // Phantom
        "phantom-spawn": "phantomSpawn", "phantom-remove": "phantomRemove",
        // Clone
        "clone-spawn": "cloneSpawn", "clone-clear": "cloneClear",
        "particle-clear": "particleClear", "decor-clear": "decorClear",
        // Room
        "room-dark": "roomDark", "room-light": "roomLight", "room-ambient": "roomAmbient",
        "room-reset": "roomReset", "room-furniture": "roomFurniture", "room-object": "roomObject",
        // Tile
        "tile-replace": "tileReplace", "tile-count": "tileCount", "tile-find": "tileFind",
        "tile-region": "tileRegion", "tile-border": "tileBorder", "tile-fill": "tileFill",
        // Path
        "path-find": "pathFind", "path-block": "pathBlock", "path-unblock": "pathUnblock",
        "path-reset": "pathReset", "path-show": "pathShow",
        // Animation
        "anim-player": "animPlayer", "anim-stalker": "animStalker", "anim-speed": "animSpeed",
        "anim-frame": "animFrame",
        // Camera
        "camera-follow": "cameraFollow", "camera-shake": "cameraShake", "camera-zoom": "cameraZoom",
        "camera-pan": "cameraPan", "camera-reset": "cameraReset", "camera-lock": "cameraLock",
        // Physics
        "physics-gravity": "physicsGravity", "physics-friction": "physicsFriction",
        "physics-collision": "physicsCollision", "physics-reset": "physicsReset",
        // Event
        "event-trigger": "eventTrigger", "event-list": "eventList", "event-clear": "eventClear",
        "event-schedule": "eventSchedule",
        // Lore
        "lore-show": "loreShow", "lore-list": "loreList", "lore-add": "loreAdd", "lore-random": "loreRandom",
        // Achievement
        "achievement-unlock": "achievementUnlock", "achievement-list": "achievementList",
        "achievement-reset": "achievementReset", "achievement-show": "achievementShow",
        // Config
        "config-get": "configGet", "config-set": "configSet", "config-list": "configList",
        "config-reset": "configReset", "config-save": "configSave",
        // Network
        "network-latency": "networkLatency", "network-packetloss": "networkPacketloss",
        "network-simulate": "networkSimulate", "network-reset": "networkReset",
        // Test
        "test-suite": "testSuite", "test-run": "testRun", "test-clear": "testClear",
        "test-result": "testResult", "test-benchmark": "testBenchmark",
        // Performance
        "perf-monitor": "perfMonitor", "perf-profile": "perfProfile", "perf-stats": "perfStats",
        "perf-reset": "perfReset", "perf-optimize": "perfOptimize",
        // Security
        "security-check": "securityCheck", "security-validate": "securityValidate",
        "security-hash": "securityHash", "security-verify": "securityVerify",
        // External
        "external-load": "externalLoad", "external-save": "externalSave",
        "external-import": "externalImport", "external-export": "externalExport",
        // System
        "system-info": "systemInfo", "system-os": "systemOs", "system-browser": "systemBrowser",
        "system-memory": "systemMemory", "system-cpu": "systemCpu", "system-gpu": "systemGpu",
        // Experimental
        "experimental-feature": "experimentalFeature", "experimental-list": "experimentalList",
        "experimental-reset": "experimentalReset", "experimental-mode": "experimentalMode",
        // Admin
        "admin-login": "adminLogin", "admin-logout": "adminLogout", "admin-ban": "adminBan",
        "admin-kick": "adminKick", "admin-mute": "adminMute", "admin-unban": "adminUnban",
      };

      const method = cmdMap[cmd];
      if (method && typeof this[method] === "function") {
        return this[method](...parts.slice(1));
      }

      // Handle teleport subcommands
      if (cmd === "teleport" || cmd === "tp") {
        const kind = parts[1]?.toLowerCase();
        if (kind === "stalker") return this.teleportStalker(parts[2], parts[3]);
        if (kind === "player") return this.teleportPlayer(parts[2], parts[3]);
        if (kind === "object") return this.teleportObject(parts[2], parts[3], parts[4], parts[5]);
      }

      return `Unknown command: ${input}`;
    },
  };

  window.consoleCommands = api;
  return api;
}
