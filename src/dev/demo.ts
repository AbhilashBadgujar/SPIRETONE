import type { EraIndex } from '../data/ids';
import { nextRandom } from '../lib/rng';
import { rebuildPlazas } from '../sim/evaluate';
import { columnId, type Grid } from '../sim/grid';
import { createIsland, type Island } from '../sim/island';

/**
 * A filled showcase island for ?demo=1..4: a plaza, a bridged run of
 * full-height inner columns, a golden cottage, and random fill elsewhere.
 * Every height respects the era's caps.
 */
export function demoIsland(grid: Grid, era: EraIndex): Island {
  const { k } = grid;
  const island = createIsland(grid, era);
  const rng = { rngSeed: 1234 + era };
  const set = (r: number, i: number, h: number) => {
    const c = columnId(k, r, i);
    island.heights[c] = Math.min(h, grid.caps[era][c]);
  };

  for (const [r, i] of [
    [1, 6],
    [1, 7],
    [2, 6],
    [2, 7],
  ]) {
    set(r, i, 1);
  }
  rebuildPlazas(grid, island);
  for (let i = 0; i < 4; i++) set(0, i, Infinity);

  for (let c = 0; c < grid.columnCount; c++) {
    if (island.heights[c] > 0) continue;
    if (nextRandom(rng) < 0.2) continue;
    island.heights[c] = 1 + Math.floor(nextRandom(rng) * grid.caps[era][c]);
  }
  rebuildPlazas(grid, island);

  const golden = island.heights.findIndex((h, c) => h === 1 && !island.inPlaza[c] && grid.ring[c] < k.K_RINGS - 1);
  if (golden >= 0) island.golden[golden] = true;
  return island;
}
