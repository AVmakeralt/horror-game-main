function toInt(v, fallback = 0) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function registerConsoleCommands(game) {
  if (!game) return null;

  const api = {
    help() {
      return [
        "help",
        "freeze",
        "unfreeze",
        "teleport stalker <x> <y>",
        "teleport player <x> <y>",
        "teleport object <fromX> <fromY> <toX> <toY>",
        "place <x> <y> <tile>",
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
    run(input = "") {
      const parts = String(input).trim().split(/\s+/);
      const cmd = parts[0]?.toLowerCase();
      if (!cmd) return this.help();

      if (cmd === "help") return this.help();
      if (cmd === "freeze") return this.freeze();
      if (cmd === "unfreeze" || cmd === "resume") return this.unfreeze();
      if (cmd === "place") return this.place(parts[1], parts[2], parts[3]);

      if (cmd === "teleport") {
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
