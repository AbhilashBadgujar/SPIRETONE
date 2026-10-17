import type { ColumnId, Grid } from './grid';
import { cloneIsland, dropBlock, isDroppable } from './island';
import { bonusesFor, tryDrop, type DropAttempt, type GameState } from './run';
import { effectsOf, flockInterval } from './tree';

// Gulls (GDD §8): auto-builders bought on the tree. The flock drops one
// block every K_GULL_INTERVAL × interval multipliers / Gull count seconds,
// paying the normal block cost; a drop the player can't afford is skipped.

/**
 * Where a Gull drops: the droppable column whose drop raises income the
 * most, ties to the earlier column in spiral order. Null when no drop would
 * raise income, so Gulls never make the island worse.
 */
export function gullTarget(grid: Grid, state: GameState): ColumnId | null {
  const { run, meta } = state;
  const bonuses = bonusesFor(meta);
  let best: ColumnId | null = null;
  let bestGain = 1e-9;
  for (let c = 0; c < grid.columnCount; c++) {
    if (!isDroppable(grid, run.island, c)) continue;
    const trial = cloneIsland(run.island);
    const out = dropBlock(grid, trial, c, { bonuses, random: () => 1 }, run.evaluation);
    const gain = out.evaluation.income - run.evaluation.income;
    if (gain > bestGain) {
      best = c;
      bestGain = gain;
    }
  }
  return best;
}

export interface GullDrop {
  column: ColumnId;
  attempt: Extract<DropAttempt, { ok: true }>;
  incomeBefore: number;
}

/** Runs the flock for dt seconds and returns the drops it made. */
export function advanceGulls(grid: Grid, state: GameState, dt: number): GullDrop[] {
  const interval = flockInterval(grid.k, effectsOf(state.meta.nodes));
  if (!Number.isFinite(interval)) return [];
  const { run } = state;
  run.gullCarry += dt;
  const drops: GullDrop[] = [];
  while (run.gullCarry >= interval) {
    run.gullCarry -= interval;
    const c = gullTarget(grid, state);
    if (c === null) continue;
    const incomeBefore = run.evaluation.income;
    const attempt = tryDrop(grid, state, c);
    if (!attempt.ok) continue;
    state.meta.stats.gullDrops += 1;
    drops.push({ column: c, attempt, incomeBefore });
  }
  return drops;
}
