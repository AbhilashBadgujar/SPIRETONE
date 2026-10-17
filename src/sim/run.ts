import type { EraIndex } from '../data/ids';
import { nextRandom } from '../lib/rng';
import { evaluate, NO_BONUSES, type Bonuses, type Evaluation } from './evaluate';
import type { ColumnId, Grid } from './grid';
import {
  ascendThreshold,
  blockCost,
  createIsland,
  dropBlock,
  placementRejection,
  totalBlocks,
  type DropOutcome,
  type DropRejection,
  type Island,
} from './island';

// Run + meta state: Resonance, ticks, paid drops and Ascension (GDD §5).

/** Survives Ascension. */
export interface Meta {
  shards: number;
  /** New islands always start in this era (GDD §5 rules). */
  highestEra: EraIndex;
  ascensions: number;
  lifetimeResonance: number;
}

/** Reset by Ascension. */
export interface Run {
  island: Island;
  resonance: number;
  /** islandLifetimeResonance: earned income only, excludes K_START_RES. */
  earned: number;
  /** Seconds not yet converted into a whole K_TICK. */
  tickCarry: number;
  rngSeed: number;
  evaluation: Evaluation;
}

export interface GameState {
  meta: Meta;
  run: Run;
}

export type DropAttempt =
  | { ok: false; reason: DropRejection | 'CANT_AFFORD' }
  | { ok: true; cost: number; outcome: DropOutcome };

/** Upgrade-tree effects. The tree isn't specced yet (GDD §7+ missing), so nothing applies. */
export function bonusesFor(_meta: Meta): Readonly<Bonuses> {
  return NO_BONUSES;
}

export function startIsland(grid: Grid, meta: Meta, rngSeed: number): Run {
  const island = createIsland(grid, meta.highestEra);
  return {
    island,
    resonance: grid.k.K_START_RES,
    earned: 0,
    tickCarry: 0,
    rngSeed,
    evaluation: evaluate(grid, island, bonusesFor(meta)),
  };
}

export function newGame(grid: Grid, seed: number): GameState {
  const meta: Meta = { shards: 0, highestEra: 0, ascensions: 0, lifetimeResonance: 0 };
  return { meta, run: startIsland(grid, meta, seed) };
}

export function currentCost(grid: Grid, run: Run): number {
  return blockCost(grid.k, run.island.paidBlocks, run.island.era);
}

/** Full placement rule. A rejected drop changes nothing and charges nothing. */
export function tryDrop(grid: Grid, state: GameState, c: ColumnId): DropAttempt {
  const { run } = state;
  const rejection = placementRejection(grid, run.island, c);
  if (rejection) return { ok: false, reason: rejection };
  const cost = currentCost(grid, run);
  if (run.resonance < cost) return { ok: false, reason: 'CANT_AFFORD' };

  run.resonance -= cost;
  const outcome = dropBlock(
    grid,
    run.island,
    c,
    { bonuses: bonusesFor(state.meta), random: () => nextRandom(run) },
    run.evaluation,
  );
  run.evaluation = outcome.evaluation;
  return { ok: true, cost, outcome };
}

/** Credits income in whole K_TICK steps. Returns Resonance gained. */
export function advance(grid: Grid, state: GameState, dt: number): number {
  const { k } = grid;
  const { run } = state;
  run.tickCarry += dt;
  const ticks = Math.floor((run.tickCarry + 1e-9) / k.K_TICK);
  if (ticks <= 0) return 0;
  run.tickCarry = Math.max(0, run.tickCarry - ticks * k.K_TICK);
  const gain = run.evaluation.income * k.K_TICK * ticks;
  run.resonance += gain;
  run.earned += gain;
  state.meta.lifetimeResonance += gain;
  return gain;
}

export function canAscend(grid: Grid, run: Run): boolean {
  return totalBlocks(run.island) >= ascendThreshold(grid, run.island);
}

export function shardsOnAscend(grid: Grid, run: Run): number {
  return Math.floor(Math.sqrt(run.earned / grid.k.K_SHARD_DIV));
}

/** Ends the island and banks Shards. Returns Shards gained, or null if below the fill threshold. */
export function ascend(grid: Grid, state: GameState): number | null {
  if (!canAscend(grid, state.run)) return null;
  const shards = shardsOnAscend(grid, state.run);
  state.meta.shards += shards;
  state.meta.ascensions += 1;
  const seed = Math.floor(nextRandom(state.run) * 4294967296) | 0;
  state.run = startIsland(grid, state.meta, seed);
  return shards;
}
