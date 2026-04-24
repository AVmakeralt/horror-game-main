import { createGame, createCustomMap, LAB_HOME_TEMPLATES, GAME_VERSION } from "./engine.js";
import { createAntiCheatRuntime } from "./anti-cheat.js";
import { createModManager } from "./mod-system.js";
import { registerConsoleCommands } from "./console-commands.js";

const SAVE_KEY = "horror-game-save-v1";
const CRASH_KEY = "horror-game-last-crash-v1";
const MAX_BOT_SIZE = 800 * 1024 * 1024;
const BOT_TICK_MS = 100;
const BOT_BUDGET_MS = 30;

function ensureCanvas() {
  let canvas = document.getElementById("game");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "game";
    canvas.width = 1280;
    canvas.height = 448;
    canvas.setAttribute("aria-label", "game canvas");
    document.body.appendChild(canvas);
  }

  Object.assign(document.body.style, {
    margin: "0",
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    background: "#221a24",
  });

  Object.assign(canvas.style, {
    width: "min(100vw, calc(100vh * 2.8571428571))",
    maxWidth: "100vw",
    maxHeight: "100vh",
    aspectRatio: "1280 / 448",
    height: "auto",
    display: "block",
    imageRendering: "pixelated",
    background: "#221a24",
    border: "0",
  });

  return canvas;
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text) {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return toHex(digest);
}

function ensureMenuUI({ onStart, onLoadBot, onDisableBot }) {
  let menu = document.getElementById("menu-controls");
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "menu-controls";
    menu.className = "fallback";
    menu.style.bottom = "44px";
    menu.style.display = "flex";
    menu.style.gap = "8px";
    menu.style.alignItems = "center";
    menu.style.flexWrap = "wrap";
    menu.style.maxWidth = "90vw";
    menu.style.background = "rgba(0,0,0,0.45)";
    menu.style.padding = "4px 8px";
    menu.style.borderRadius = "4px";
    document.body.appendChild(menu);
  }

  menu.innerHTML = `
    <button id="start-btn" style="background:#2d7d46;color:#fff;border:0;padding:6px 12px;cursor:pointer">Start</button>
    <button id="bot-btn" style="background:#4d4d9e;color:#fff;border:0;padding:6px 12px;cursor:pointer">Load Bot (≤800MB)</button>
    <button id="bot-off-btn" style="background:#773b3b;color:#fff;border:0;padding:6px 12px;cursor:pointer">Disable Bot</button>
    <input id="bot-file-input" type="file" accept=".js,.mjs,.cjs,text/javascript,application/javascript" style="display:none" />
    <span id="bot-status" style="opacity:.55">No bot loaded</span>
  `;

  menu.querySelector("#start-btn")?.addEventListener("click", onStart);
  menu.querySelector("#bot-btn")?.addEventListener("click", () => menu.querySelector("#bot-file-input")?.click());
  menu.querySelector("#bot-off-btn")?.addEventListener("click", onDisableBot);
  menu.querySelector("#bot-file-input")?.addEventListener("change", (event) => {
    const [file] = event.target?.files ?? [];
    if (file) onLoadBot(file);
    event.target.value = "";
  });

  return {
    setBotStatus(text, active = false) {
      const status = menu.querySelector("#bot-status");
      if (status) {
        status.textContent = text;
        status.style.opacity = active ? "1" : "0.55";
      }
    },
    disableBotLoad(disabled) {
      const btn = menu.querySelector("#bot-btn");
      if (btn) {
        btn.disabled = disabled;
        btn.style.opacity = disabled ? "0.45" : "1";
        btn.style.cursor = disabled ? "not-allowed" : "pointer";
      }
    },
    hide() { menu.style.display = "none"; },
    show() { menu.style.display = "flex"; },
  };
}

function drawStartScreen(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#120d0d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#c1121f";
  ctx.font = "bold 72px monospace";
  const title = "Everyone’s Gone";
  const centerY = canvas.height * 0.42;
  ctx.fillText(title, (canvas.width - ctx.measureText(title).width) / 2, centerY);
  ctx.fillStyle = "#f6f0ea";
  ctx.font = "36px monospace";
  const sub = "Inspired by Gore in Crayon";
  ctx.fillText(sub, (canvas.width - ctx.measureText(sub).width) / 2, centerY + 52);
  ctx.font = "24px monospace";
  const prompt = "Press Enter or Start to begin";
  ctx.fillText(prompt, (canvas.width - ctx.measureText(prompt).width) / 2, centerY + 104);
  const controls = "WASD move • H hide • E interact";
  ctx.fillText(controls, (canvas.width - ctx.measureText(controls).width) / 2, centerY + 142);
}

function mountStartupNotice(message) {
  let notice = document.getElementById("startup-status");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "startup-status";
    notice.className = "fallback";
    document.body.appendChild(notice);
  }
  notice.textContent = message;
}

function clearStartupNotice() {
  const notice = document.getElementById("startup-status");
  if (notice) notice.textContent = "";
}

function saveProgress(game) {
  if (!game?.getSnapshot) return false;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(game.getSnapshot()));
    return true;
  } catch {
    return false;
  }
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearProgress() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {}
}

function registerOfflineSupport() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

async function readBotFile(file) {
  if (file.size > MAX_BOT_SIZE) throw new Error("Bot error: file exceeds 800MB limit");
  const source = await file.text();
  const hash = await sha256Hex(source);
  return { name: file.name, source, hash };
}

function bootGameWithAutoFix() {
  let game = null;
  let started = false;
  let botFrozen = false;
  let botSpec = null;
  let botRuntime = null;
  let menuUI = null;
  let softlockWatchdog = null;
  let autosaveTimer = null;

  function setStatus(text, active = false) {
    menuUI?.setBotStatus(text, active);
  }

  function teardownBotRuntime() {
    botRuntime?.stop();
    botRuntime = null;
  }

  function disableBot(permanent = false) {
    teardownBotRuntime();
    game?.clearBotController({ permanent });
    setStatus("Bot disabled", false);
  }

  function attachBotRuntime() {
    if (!botSpec || !game?.getBotObservation) return;
    teardownBotRuntime();

    botRuntime = createAntiCheatRuntime({
      source: botSpec.source,
      tickMs: BOT_TICK_MS,
      timeBudgetMs: BOT_BUDGET_MS,
      onReady: () => {
        game?.setBotController?.({ name: botSpec.name, hash: botSpec.hash });
        game?.setBotIntegrity?.("verified");
        setStatus("Bot ready", true);
      },
      onAction: (action) => {
        game?.setBotInput?.(action || {});
      },
      onViolation: (reason) => {
        game?.recordBotViolation?.(reason);
      },
      onError: (message) => {
        game?.setBotError?.(message || "init timeout");
        setStatus(`Bot error: ${message || "init timeout"}`, false);
      },
    });

    botRuntime.start(() => game?.getBotObservation?.());
  }

  async function loadBot(file) {
    if (botFrozen) {
      mountStartupNotice("One bot per run: restart to load a different bot.");
      return;
    }

    try {
      const spec = await readBotFile(file);
      botSpec = spec;
      setStatus(`Bot loaded (hash: ${spec.hash.slice(0, 8)}…)`, false);
      if (started) attachBotRuntime();
      else attachBotRuntime();
    } catch (error) {
      botSpec = null;
      setStatus("No bot loaded", false);
      mountStartupNotice(String(error?.message ?? error));
    }
  }

  function restoreProgressIfPresent() {
    const snapshot = loadProgress();
    if (!snapshot || !game?.loadSnapshot) return false;
    try {
      const recovered = game.loadSnapshot(snapshot);
      if (recovered) {
        mountStartupNotice("Recovered autosave. Press Enter to continue.");
        return true;
      }
      clearProgress();
      return false;
    } catch {
      clearProgress();
      mountStartupNotice("Corrupted autosave was removed. Press Enter to start fresh.");
      return false;
    }
  }

  function startAutosave() {
    if (autosaveTimer) window.clearInterval(autosaveTimer);
    autosaveTimer = window.setInterval(() => {
      if (!started || !game || game.state?.completed) return;
      saveProgress(game);
    }, 4000);
  }

  function startSoftlockWatchdog() {
    if (softlockWatchdog) window.clearInterval(softlockWatchdog);
    let lastTick = game?.state?.tick ?? 0;
    let stagnantChecks = 0;
    softlockWatchdog = window.setInterval(() => {
      if (!started || !game || game.state?.completed) return;
      const currentTick = game.state?.tick ?? 0;
      if (currentTick <= lastTick) stagnantChecks += 1;
      else { stagnantChecks = 0; lastTick = currentTick; }
      if (stagnantChecks >= 3) {
        game.triggerSoftlockRescue?.();
        saveProgress(game);
        stagnantChecks = 0;
      }
    }, 1200);
  }

  function initialize({ autoStart = false, notice = "" } = {}) {
    try {
      const canvas = ensureCanvas();
      game = createGame(canvas);
      game.createCustomMap = createCustomMap;
      game.LAB_HOME_TEMPLATES = LAB_HOME_TEMPLATES;
      game.GAME_VERSION = GAME_VERSION;
      game.customMaps = {};
      game.modManager = createModManager(game);
      window.__game = game;
      registerConsoleCommands(game);
      started = false;
      drawStartScreen(canvas);
      menuUI = ensureMenuUI({ onStart: startGame, onLoadBot: loadBot, onDisableBot: () => disableBot(false) });
      menuUI.show();
      setStatus("No bot loaded", false);
      restoreProgressIfPresent();

      if (autoStart) {
        started = true;
        botFrozen = true;
        game.lockBotForRun?.();
        menuUI.disableBotLoad(true);
        menuUI.hide();
        game.start();
        startSoftlockWatchdog();
        startAutosave();
      }

      if (botSpec) attachBotRuntime();

      if (notice) mountStartupNotice(notice);
      else if (!navigator.onLine) mountStartupNotice("Offline mode active. Cached assets will be used.");
      else clearStartupNotice();
    } catch {
      mountStartupNotice("Startup hiccup detected — press Enter or Ctrl+Shift+F to retry.");
    }
  }

  function startGame() {
    if (!game || started) return;
    started = true;
    botFrozen = true;
    game.lockBotForRun?.();
    menuUI?.disableBotLoad(true);
    menuUI?.hide();
    game.start();
    startSoftlockWatchdog();
    startAutosave();
    clearStartupNotice();
  }

  function forceStart(message = "Force start triggered.") {
    initialize({ autoStart: true, notice: `${message} (Ctrl+Shift+F)` });
  }

  function handleRuntimeCrash(errorLike) {
    try {
      localStorage.setItem(CRASH_KEY, JSON.stringify({ message: String(errorLike?.message ?? errorLike), at: Date.now() }));
    } catch {}
    if (game) saveProgress(game);
    forceStart("Runtime error recovered from autosave.");
  }

  initialize();
  registerOfflineSupport();

  window.addEventListener("error", (event) => handleRuntimeCrash(event.error || event.message));
  window.addEventListener("unhandledrejection", (event) => handleRuntimeCrash(event.reason));
  window.addEventListener("beforeunload", () => { if (game) saveProgress(game); teardownBotRuntime(); });
  window.addEventListener("pagehide", () => { if (game) saveProgress(game); teardownBotRuntime(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && game) saveProgress(game); });

  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      forceStart();
      return;
    }
    if (!started && event.key === "Enter") {
      startGame();
      return;
    }
    if (!started || !game) return;
    game.onKeyChange(event, true);
  });

  window.addEventListener("keyup", (event) => {
    if (!started || !game) return;
    game.onKeyChange(event, false);
  });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", bootGameWithAutoFix, { once: true });
} else {
  bootGameWithAutoFix();
}
