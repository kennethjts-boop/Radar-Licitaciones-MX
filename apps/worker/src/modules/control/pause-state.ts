import {
  getState,
  setStateStrict,
  STATE_KEYS,
} from "../../core/system-state";

export type PauseScope = "all" | "watchdog" | "collector";

export interface PauseEntry {
  pausedAt: string;
  resumeAt: string | null;
  reason: string;
  pausedBy: string;
}

export interface RadarPauseState {
  scopes: Partial<Record<PauseScope, PauseEntry>>;
}

export interface EffectivePause {
  paused: boolean;
  requestedScope: PauseScope;
  effectiveScope: PauseScope | null;
  entry: PauseEntry | null;
  msUntilResume: number | null;
}

const EMPTY_PAUSE_STATE: RadarPauseState = { scopes: {} };
let mutationQueue: Promise<void> = Promise.resolve();

function isPauseEntry(value: unknown): value is PauseEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<PauseEntry>;
  return typeof candidate.pausedAt === "string" &&
    (typeof candidate.resumeAt === "string" || candidate.resumeAt === null) &&
    typeof candidate.reason === "string" &&
    typeof candidate.pausedBy === "string";
}

function normalizePauseState(value: unknown): RadarPauseState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return EMPTY_PAUSE_STATE;
  }
  const rawScopes = (value as { scopes?: unknown }).scopes;
  if (
    typeof rawScopes !== "object" ||
    rawScopes === null ||
    Array.isArray(rawScopes)
  ) {
    return EMPTY_PAUSE_STATE;
  }

  const scopes: Partial<Record<PauseScope, PauseEntry>> = {};
  for (const scope of ["all", "watchdog", "collector"] as const) {
    const entry = (rawScopes as Record<string, unknown>)[scope];
    if (isPauseEntry(entry)) scopes[scope] = entry;
  }
  return { scopes };
}

async function readPauseState(): Promise<RadarPauseState> {
  return normalizePauseState(
    await getState<unknown>(STATE_KEYS.RADAR_PAUSE_STATE),
  );
}

async function writePauseState(state: RadarPauseState): Promise<void> {
  await setStateStrict(STATE_KEYS.RADAR_PAUSE_STATE, {
    scopes: state.scopes,
  });
}

async function serializeMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const previous = mutationQueue;
  let release: () => void = () => undefined;
  mutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await mutation();
  } finally {
    release();
  }
}

function pruneExpired(
  state: RadarPauseState,
  nowMs: number,
): { state: RadarPauseState; changed: boolean } {
  const scopes = { ...state.scopes };
  let changed = false;
  for (const scope of ["all", "watchdog", "collector"] as const) {
    const entry = scopes[scope];
    if (
      entry?.resumeAt !== null &&
      entry !== undefined &&
      Date.parse(entry.resumeAt) <= nowMs
    ) {
      delete scopes[scope];
      changed = true;
    }
  }
  return { state: { scopes }, changed };
}

export async function getPauseState(
  now = new Date(),
): Promise<RadarPauseState> {
  return serializeMutation(async () => {
    const current = await readPauseState();
    const pruned = pruneExpired(current, now.getTime());
    if (pruned.changed) await writePauseState(pruned.state);
    return pruned.state;
  });
}

export async function getEffectivePause(
  scope: PauseScope,
  now = new Date(),
): Promise<EffectivePause> {
  const state = await getPauseState(now);
  const effectiveScope = state.scopes.all
    ? "all"
    : state.scopes[scope]
      ? scope
      : null;
  const entry = effectiveScope ? state.scopes[effectiveScope] ?? null : null;
  const msUntilResume = entry?.resumeAt
    ? Math.max(0, Date.parse(entry.resumeAt) - now.getTime())
    : null;
  return {
    paused: entry !== null,
    requestedScope: scope,
    effectiveScope,
    entry,
    msUntilResume,
  };
}

export async function isPaused(
  scope: PauseScope,
  now = new Date(),
): Promise<boolean> {
  return (await getEffectivePause(scope, now)).paused;
}

export async function pauseScope(input: {
  scope: PauseScope;
  minutes: number | null;
  reason: string;
  pausedBy: string;
  now?: Date;
}): Promise<RadarPauseState> {
  return serializeMutation(async () => {
    const now = input.now ?? new Date();
    const state = pruneExpired(await readPauseState(), now.getTime()).state;
    const entry: PauseEntry = {
      pausedAt: now.toISOString(),
      resumeAt: input.minutes === null
        ? null
        : new Date(now.getTime() + input.minutes * 60_000).toISOString(),
      reason: input.reason,
      pausedBy: input.pausedBy,
    };
    const next: RadarPauseState = {
      scopes: {
        ...state.scopes,
        [input.scope]: entry,
      },
    };
    await writePauseState(next);
    return next;
  });
}

export async function resumeScopes(
  scope?: PauseScope,
): Promise<RadarPauseState> {
  return serializeMutation(async () => {
    const state = await readPauseState();
    const scopes = { ...state.scopes };
    if (scope === undefined) {
      for (const key of ["all", "watchdog", "collector"] as const) {
        delete scopes[key];
      }
    } else {
      delete scopes[scope];
    }
    const next = { scopes };
    await writePauseState(next);
    return next;
  });
}

export function resetPauseMutationQueueForTests(): void {
  mutationQueue = Promise.resolve();
}
