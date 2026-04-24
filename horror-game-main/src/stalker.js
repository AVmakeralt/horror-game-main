// Backward-compatible stalker module entrypoint.
// This wraps the newer stalker-ai module with the API engine.js expects.
import {
  createStalker as createStalkerAI,
  updateStalker as updateStalkerAI,
  noteStalkerHideSpot,
  noteStalkerPathSpot,
} from "./stalker-ai.js";

export function createStalker(spawnPosition, zoneAI = null) {
  return createStalkerAI(spawnPosition, zoneAI);
}

export function getDisplayedStalkerPosition(stalker) {
  return { x: stalker.renderX ?? stalker.x, y: stalker.renderY ?? stalker.y };
}

export function noteHideSpot(stalker, player) {
  if (!stalker || !player) return;
  noteStalkerHideSpot(stalker, player.x, player.y);
}

export function notePathSpot(stalker, player) {
  if (!stalker || !player) return;
  noteStalkerPathSpot(stalker, player.x, player.y);
}

export function stepStalker({
  stalker,
  player,
  tileAt,
  zoneConfig,
  blockedTiles = [1, 8, 14],
}) {
  const zoneAI = zoneConfig?.ai ?? {};
  const result = updateStalkerAI(
    stalker,
    player,
    tileAt,
    player?.lastMoveTick ?? 0,
    zoneAI,
    blockedTiles,
  );
  return {
    caught: !!result?.caught,
    decoySound: null,
  };
}
