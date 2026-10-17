import { CASCADE_MIN_ERA, type Constants } from '../data/constants';
import type { EraIndex, StructureId } from '../data/ids';
import { evaluate, rebuildPlazas, type Bonuses, type Evaluation } from './evaluate';
import type { ColumnId, Grid } from './grid';

// One island's grid state and the drop pipeline (GDD §2 placement, §3 OnDrop, §6 Cascade).

export interface Island {
  era: EraIndex;
  heights: number[];
  inPlaza: boolean[];
  /**
   * Anchor (r, i) of each plaza group, in formation order. The group is
   * (r, i), (r, i+1), (r+1, i), (r+1, i+1). inPlaza alone can't recover
   * groupings once plazas sit side by side.
   */
  plazas: ColumnId[];
  golden: boolean[];
  /** n in block_cost. Cascade blocks are free and don't count (GDD §6). */
  paidBlocks: number;
  /** Every structure type that has appeared on this island, for first-time effects. */
  discovered: StructureId[];
}

export type DropRejection = 'AT_CAP' | 'PLAZA_LOCKED';

export interface DropContext {
  bonuses: Readonly<Bonuses>;
  /** Uniform [0, 1). Rolled once per first block for MOD_GOLDEN. */
  random: () => number;
}

export interface DropOutcome {
  /** Columns that got a block: the dropped column first, then cascade blocks in order. */
  placed: ColumnId[];
  goldenRolled: ColumnId[];
  newPlazas: ColumnId[][];
  /** Edge ids that are bridged now but weren't before the drop. */
  newBridges: number[];
  /** Edge ids that were bridged before the drop and no longer are. */
  lostBridges: number[];
  newLighthouses: ColumnId[];
  /** Structure types appearing on this island for the first time. */
  newTypes: StructureId[];
  evaluation: Evaluation;
}

export function createIsland(grid: Grid, era: EraIndex): Island {
  const n = grid.columnCount;
  return {
    era,
    heights: new Array<number>(n).fill(0),
    inPlaza: new Array<boolean>(n).fill(false),
    plazas: [],
    golden: new Array<boolean>(n).fill(false),
    paidBlocks: 0,
    discovered: [],
  };
}

export function cloneIsland(island: Island): Island {
  return {
    era: island.era,
    heights: island.heights.slice(),
    inPlaza: island.inPlaza.slice(),
    plazas: island.plazas.slice(),
    golden: island.golden.slice(),
    paidBlocks: island.paidBlocks,
    discovered: island.discovered.slice(),
  };
}

/** Effective cap: plaza columns are locked at their plaza height. */
export function columnCap(grid: Grid, island: Island, c: ColumnId): number {
  return island.inPlaza[c] ? grid.k.K_PLAZA_HEIGHT : grid.caps[island.era][c];
}

/** Grid half of the placement rule; affordability is checked by the run. */
export function placementRejection(grid: Grid, island: Island, c: ColumnId): DropRejection | null {
  if (island.inPlaza[c]) return 'PLAZA_LOCKED';
  if (island.heights[c] >= grid.caps[island.era][c]) return 'AT_CAP';
  return null;
}

export function isDroppable(grid: Grid, island: Island, c: ColumnId): boolean {
  return placementRejection(grid, island, c) === null;
}

export function totalBlocks(island: Island): number {
  return island.heights.reduce((sum, h) => sum + h, 0);
}

/** Reachable total: sum of effective caps, lower once plazas lock columns. */
export function reachableBlocks(grid: Grid, island: Island): number {
  let sum = 0;
  for (let c = 0; c < grid.columnCount; c++) sum += columnCap(grid, island, c);
  return sum;
}

/** Blocks needed on the island before Ascend unlocks (K_ASCEND_MIN_FILL of reachable). */
export function ascendThreshold(grid: Grid, island: Island): number {
  return Math.ceil(reachableBlocks(grid, island) * grid.k.K_ASCEND_MIN_FILL - 1e-9);
}

export function blockCost(k: Readonly<Constants>, n: number, era: EraIndex): number {
  return k.K_COST_BASE * Math.pow(k.K_COST_GROWTH[era], n);
}

/** Lowest droppable neighbor; ties go Left, Right, Inner, Outer. */
export function lowestDroppableNeighbor(grid: Grid, island: Island, c: ColumnId): ColumnId | null {
  let best: ColumnId | null = null;
  for (const n of grid.neighborList[c]) {
    if (!isDroppable(grid, island, n)) continue;
    if (best === null || island.heights[n] < island.heights[best]) best = n;
  }
  return best;
}

/**
 * Applies one paid drop on a column that passed placementRejection, then any
 * Era IV cascade. Mutates the island. The caller is responsible for payment.
 */
export function dropBlock(
  grid: Grid,
  island: Island,
  c: ColumnId,
  ctx: DropContext,
  before: Evaluation,
): DropOutcome {
  const { k } = grid;
  const placed: ColumnId[] = [];
  const goldenRolled: ColumnId[] = [];
  const newPlazas: ColumnId[][] = [];

  // Returns true when this block turned the column into a Lighthouse.
  const place = (col: ColumnId): boolean => {
    island.heights[col] += 1;
    placed.push(col);
    if (island.heights[col] === 1 && ctx.random() < ctx.bonuses.goldenChance) {
      island.golden[col] = true;
      goldenRolled.push(col);
    }
    newPlazas.push(...rebuildPlazas(grid, island));
    return island.heights[col] === k.K_LIGHTHOUSE_MIN_HEIGHT && !island.inPlaza[col];
  };

  island.paidBlocks += 1;
  let source: ColumnId | null = place(c) ? c : null;

  if (island.era >= CASCADE_MIN_ERA) {
    let chain = 0;
    while (source !== null && chain < k.K_CASCADE_MAX_CHAIN) {
      const target = lowestDroppableNeighbor(grid, island, source);
      if (target === null) break;
      chain++;
      source = place(target) ? target : null;
    }
  }

  const evaluation = evaluate(grid, island, ctx.bonuses);

  const newBridges: number[] = [];
  const lostBridges: number[] = [];
  for (let e = 0; e < evaluation.activeBridges.length; e++) {
    if (evaluation.activeBridges[e] && !before.activeBridges[e]) newBridges.push(e);
    if (!evaluation.activeBridges[e] && before.activeBridges[e]) lostBridges.push(e);
  }

  const newLighthouses: ColumnId[] = [];
  for (let col = 0; col < grid.columnCount; col++) {
    if (
      evaluation.columns[col].structure === 'ST_LIGHTHOUSE' &&
      before.columns[col].structure !== 'ST_LIGHTHOUSE'
    ) {
      newLighthouses.push(col);
    }
  }

  const newTypes: StructureId[] = [];
  for (const col of evaluation.columns) {
    const s = col.structure;
    if (s !== 'ST_EMPTY' && !island.discovered.includes(s) && !newTypes.includes(s)) newTypes.push(s);
  }
  island.discovered.push(...newTypes);

  return { placed, goldenRolled, newPlazas, newBridges, lostBridges, newLighthouses, newTypes, evaluation };
}

export interface DropPreview {
  /** What the column resolves to after the drop. */
  structure: StructureId;
  /** Drop would add a Harmony type not currently present on the island. */
  newType: boolean;
  newBridge: boolean;
  newLighthouse: boolean;
}

/** What a drop on c would do, without touching the island. Drives K_SMART_PAUSE. */
export function previewDrop(
  grid: Grid,
  island: Island,
  c: ColumnId,
  bonuses: Readonly<Bonuses>,
  current: Evaluation,
): DropPreview | null {
  if (!isDroppable(grid, island, c)) return null;
  const trial = cloneIsland(island);
  const out = dropBlock(grid, trial, c, { bonuses, random: () => 1 }, current);
  return {
    structure: out.evaluation.columns[c].structure,
    newType: out.evaluation.typesPresent.some((t) => !current.typesPresent.includes(t)),
    newBridge: out.newBridges.length > 0,
    newLighthouse: out.newLighthouses.length > 0,
  };
}
