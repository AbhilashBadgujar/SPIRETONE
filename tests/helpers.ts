import type { EraIndex } from '../src/data/ids';
import { evaluate, rebuildPlazas, type Bonuses } from '../src/sim/evaluate';
import { buildGrid, columnId } from '../src/sim/grid';
import { createIsland, type Island } from '../src/sim/island';
import { GDD_V1 } from './gdd-v1';

export const k = GDD_V1;
export const grid = buildGrid(k);

/** Column id from (ring, index). */
export const id = (r: number, i: number): number => columnId(k, r, i);

/** Island with heights set directly, plazas rebuilt the way a drop would. */
export function islandWith(era: EraIndex, heights: Record<string, number>, golden: string[] = []): Island {
  const island = createIsland(grid, era);
  for (const [key, h] of Object.entries(heights)) island.heights[parse(key)] = h;
  for (const key of golden) island.golden[parse(key)] = true;
  rebuildPlazas(grid, island);
  return island;
}

export function evalWith(
  era: EraIndex,
  heights: Record<string, number>,
  opts: { golden?: string[]; bonuses?: Bonuses } = {},
) {
  const island = islandWith(era, heights, opts.golden);
  return { island, ev: evaluate(grid, island, opts.bonuses) };
}

/** "r,i" -> column id */
function parse(key: string): number {
  const [r, i] = key.split(',').map(Number);
  return id(r, i);
}
