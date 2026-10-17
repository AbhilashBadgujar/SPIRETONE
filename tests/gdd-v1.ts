import { DEFAULT_CONSTANTS, type Constants } from '../src/data/constants';

/**
 * The GDD v1 §2–§6 tables exactly as written, before §11 tuning. Rule tests
 * use these so they check the formulas, not whatever the simulator tuned.
 */
export const GDD_V1: Readonly<Constants> = Object.freeze({
  ...DEFAULT_CONSTANTS,
  K_START_RES: [20, 20, 20, 20],
  K_COST_BASE: [10, 10, 10, 10],
  K_COST_GROWTH: [1.08, 1.07, 1.06, 1.055],
  K_ERA_YIELD_MULT: [1, 3, 10, 30],
  K_SHARD_DIV: 500,
  K_GULL_INTERVAL: 4.0,
  K_CURSOR_STEP: 0.35,
});
