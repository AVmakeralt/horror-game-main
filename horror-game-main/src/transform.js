export const TRANSFORM_TYPES = {
  LIMB_ELONGATION: "limb_elongation",
  CONTROL_INVERSION: "control_inversion",
  VISUAL_OFFSET: "visual_offset",
  SPEED_REDUCTION: "speed_reduction",
  GHOST_LIMB: "ghost_limb",
  HALLUCINATION_CLONE: "hallucination_clone",
  AUDIO_DISTORTION: "audio_distortion",
};

const TRANSFORM_DEFS = {
  [TRANSFORM_TYPES.LIMB_ELONGATION]: { label: "Limb Elongation", permanent: true, maxStacks: 3, reversible: true },
  [TRANSFORM_TYPES.CONTROL_INVERSION]: { label: "Control Inversion", permanent: true, maxStacks: 2, reversible: true },
  [TRANSFORM_TYPES.VISUAL_OFFSET]: { label: "Visual Offset", permanent: false, duration: 240, maxStacks: 2, reversible: true },
  [TRANSFORM_TYPES.SPEED_REDUCTION]: { label: "Speed Reduction", permanent: true, maxStacks: 3, reversible: true },
  [TRANSFORM_TYPES.GHOST_LIMB]: { label: "Ghost Limb Overlay", permanent: true, maxStacks: 1, reversible: false },
  [TRANSFORM_TYPES.HALLUCINATION_CLONE]: { label: "Hallucination Clone", permanent: false, duration: 180, maxStacks: 2, reversible: true },
  [TRANSFORM_TYPES.AUDIO_DISTORTION]: { label: "Audio Distortion", permanent: true, maxStacks: 1, reversible: false },
};

export function createTransformState() {
  return { active: [] };
}

export function addTransformation(state, type, stacks = 1) {
  const def = TRANSFORM_DEFS[type];
  if (!def) return;

  const existing = state.active.find((f) => f.type === type);
  if (existing) {
    existing.stacks = Math.min(def.maxStacks, existing.stacks + stacks);
    if (!def.permanent) existing.timeLeft = Math.max(existing.timeLeft, def.duration ?? 0);
    return;
  }

  state.active.push({
    type,
    stacks: Math.min(def.maxStacks, stacks),
    label: def.label,
    permanent: def.permanent,
    reversible: def.reversible,
    timeLeft: def.permanent ? null : def.duration,
  });
}

export function updateTransformations(state) {
  for (const f of state.active) {
    if (!f.permanent && typeof f.timeLeft === "number") f.timeLeft -= 1;
  }
  state.active = state.active.filter((f) => f.permanent || (f.timeLeft ?? 0) > 0);
}

export function reverseReversibleTransformations(state, amount = 1) {
  for (const f of state.active) {
    const def = TRANSFORM_DEFS[f.type];
    if (def?.reversible) f.stacks = Math.max(0, f.stacks - amount);
  }
  state.active = state.active.filter((f) => f.stacks > 0);
}

export function getTransformationStacks(state, type) {
  const f = state.active.find((x) => x.type === type);
  return f ? f.stacks : 0;
}

export function hasTransformation(state, type) {
  return getTransformationStacks(state, type) > 0;
}

export function totalTransformationBurden(state) {
  return state.active.reduce((n, f) => n + f.stacks, 0);
}

export function getTransformationLabels(state) {
  if (!state.active.length) return "none";
  return state.active
    .map((f) => (f.permanent ? `${f.label} x${f.stacks}` : `${f.label} x${f.stacks} (${Math.ceil((f.timeLeft ?? 0) / 60)}s)`))
    .join(" | ");
}
