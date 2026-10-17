import type { Grid } from '../sim/grid';
import type { GameState } from '../sim/run';
import { deserialize, serialize } from '../sim/save';

// localStorage wrapper. Every access is guarded: storage can be missing or
// throw (private windows, blocked site data), and the game must still run.

const KEY = 'spiretone.save.v1';
/** A save that failed to load is kept here instead of being overwritten. */
const QUARANTINE_KEY = 'spiretone.save.v1.unreadable';

export function loadGame(grid: Grid): GameState | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let state: GameState | null = null;
  try {
    state = deserialize(grid, JSON.parse(raw));
  } catch {
    state = null;
  }
  if (!state) {
    try {
      localStorage.setItem(QUARANTINE_KEY, raw);
      localStorage.removeItem(KEY);
    } catch {
      // Nothing more to do; a fresh game starts either way.
    }
  }
  return state;
}

export function saveGame(state: GameState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(serialize(state)));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: there is nothing saved to clear.
  }
}
