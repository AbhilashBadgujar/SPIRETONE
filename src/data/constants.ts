import type { EraIndex, ModifierId } from './ids';

// Single data source for every tunable number (GDD §0 rule 2).
// Sim code takes a `Constants` object instead of importing values, so the
// pacing simulator can run with tuned copies.
//
// Keys match GDD IDs exactly. Entries under "Unnamed in GDD" are literal
// numbers from GDD tables that have no K_* ID there yet.

export interface Constants {
  // §2 Grid
  K_RINGS: number;
  K_INDICES: number;
  K_COLUMNS: number;
  K_CAP_ERA: readonly number[];
  K_RING_CAP_OFFSET: readonly number[];
  K_CAP_MIN: number;

  // §3 Structure yields (Resonance/s)
  K_Y_PLAZA: number;
  K_Y_LIGHTHOUSE: number;
  K_Y_TOWER: number;
  K_Y_PIER: number;
  K_Y_COTTAGE: number;

  // §3 Modifiers
  K_M_BRIDGE: number;
  K_M_BALCONY: number;
  K_M_BEACON: number;
  K_M_PLAZA_AURA: number;
  K_M_GOLDEN: number;

  // §4 Controls
  K_RAPID_INTERVAL: number;
  K_ASCEND_HOLD: number;
  K_CURSOR_STEP: number;
  K_SMART_PAUSE: number;

  // §5 Economy
  K_START_RES: number;
  K_COST_BASE: number;
  K_COST_GROWTH: readonly number[];
  K_ERA_YIELD_MULT: readonly number[];
  K_HARMONY_PER_TYPE: number;
  K_HARMONY_PER_BRIDGE: number;
  K_HARMONY_PER_LIGHTHOUSE: number;
  K_HARMONY_CAP: readonly number[];
  K_SHARD_DIV: number;
  K_ASCEND_MIN_FILL: number;
  K_GULL_INTERVAL: number;
  K_TICK: number;

  // §6 Eras
  K_CASCADE_MAX_CHAIN: number;

  // Unnamed in GDD
  K_TOWER_MIN_HEIGHT: number;
  K_LIGHTHOUSE_MIN_HEIGHT: number;
  K_PLAZA_HEIGHT: number;
  K_BRIDGE_MIN_HEIGHT: number;
  K_BRIDGE_MAX_DIFF: number;
  K_BRIDGE_MAX_PER_COLUMN: number;
  K_OVERCLOCK_SHARE: number;
  K_BALCONY_HEIGHT_DIFF: number;
}

export const DEFAULT_CONSTANTS: Readonly<Constants> = Object.freeze({
  K_RINGS: 3,
  K_INDICES: 12,
  K_COLUMNS: 36,
  K_CAP_ERA: [3, 4, 6, 8],
  K_RING_CAP_OFFSET: [0, 1, 2],
  K_CAP_MIN: 1,

  K_Y_PLAZA: 12,
  K_Y_LIGHTHOUSE: 8,
  K_Y_TOWER: 4,
  K_Y_PIER: 3,
  K_Y_COTTAGE: 2,

  K_M_BRIDGE: 0.5,
  K_M_BALCONY: 0.25,
  K_M_BEACON: 0.2,
  K_M_PLAZA_AURA: 0.3,
  K_M_GOLDEN: 10,

  K_RAPID_INTERVAL: 0.15,
  K_ASCEND_HOLD: 1.2,
  K_CURSOR_STEP: 0.35,
  K_SMART_PAUSE: 0.3,

  K_START_RES: 20,
  K_COST_BASE: 10,
  K_COST_GROWTH: [1.08, 1.07, 1.06, 1.055],
  K_ERA_YIELD_MULT: [1, 3, 10, 30],
  K_HARMONY_PER_TYPE: 0.5,
  K_HARMONY_PER_BRIDGE: 0.1,
  K_HARMONY_PER_LIGHTHOUSE: 0.2,
  K_HARMONY_CAP: [4, 6, 10, 15],
  K_SHARD_DIV: 500,
  K_ASCEND_MIN_FILL: 0.6,
  K_GULL_INTERVAL: 4.0,
  K_TICK: 0.1,

  K_CASCADE_MAX_CHAIN: 4,

  K_TOWER_MIN_HEIGHT: 2,
  K_LIGHTHOUSE_MIN_HEIGHT: 4,
  K_PLAZA_HEIGHT: 1,
  K_BRIDGE_MIN_HEIGHT: 3,
  K_BRIDGE_MAX_DIFF: 1,
  K_BRIDGE_MAX_PER_COLUMN: 2,
  K_OVERCLOCK_SHARE: 0.5,
  K_BALCONY_HEIGHT_DIFF: 2,
});

/** First era in which each modifier applies (GDD §3 modifiers table, "Era" column). */
export const MODIFIER_MIN_ERA: Readonly<Record<ModifierId, EraIndex>> = Object.freeze({
  MOD_BRIDGE: 0,
  MOD_OVERCLOCK: 2,
  MOD_BALCONY: 0,
  MOD_BEACON: 1,
  MOD_PLAZA_AURA: 0,
  MOD_GOLDEN: 0,
});

/** Cascade is Era IV's signature mechanic (GDD §6). */
export const CASCADE_MIN_ERA: EraIndex = 3;
