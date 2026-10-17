import { MODIFIER_MIN_ERA, type Constants } from '../data/constants';
import { HARMONY_TYPES, type ModifierId, type StructureId } from '../data/ids';
import { columnId, type ColumnId, type Grid } from './grid';
import type { Island } from './island';

// Structure resolution, modifiers and income (GDD §3, §5).
// Deterministic and stateless apart from rebuildPlazas, which only ever adds.

export interface Bonuses {
  /** Upgrade-tree percentage bonus, added to every column's additive term. */
  additive: number;
  /** Upgrade-tree percentage bonus for one structure type, added to its columns' additive term. */
  additiveByType: Readonly<Partial<Record<StructureId, number>>>;
  /** treeIncomeMult in income_per_sec. */
  incomeMult: number;
  /** Chance that a column's first block rolls MOD_GOLDEN. */
  goldenChance: number;
}

export const NO_BONUSES: Readonly<Bonuses> = Object.freeze({
  additive: 0,
  additiveByType: Object.freeze({}),
  incomeMult: 1,
  goldenChance: 0,
});

export interface ColumnEval {
  structure: StructureId;
  base: number;
  bridges: number;
  balconySides: number;
  beacons: number;
  plazaAura: boolean;
  golden: boolean;
  additive: number;
  overclock: number;
  yield: number;
}

export interface Evaluation {
  columns: ColumnEval[];
  /** Indexed by edge id. */
  activeBridges: boolean[];
  bridgeCount: number;
  lighthouseCount: number;
  /** Distinct Harmony-counting types currently on the island. */
  typesPresent: StructureId[];
  harmony: number;
  yieldSum: number;
  /** income_per_sec */
  income: number;
}

const EMPTY_COLUMN: Readonly<ColumnEval> = Object.freeze({
  structure: 'ST_EMPTY',
  base: 0,
  bridges: 0,
  balconySides: 0,
  beacons: 0,
  plazaAura: false,
  golden: false,
  additive: 0,
  overclock: 0,
  yield: 0,
});

/** The 4 columns of the plaza anchored at (r, i): (r, i), (r, i+1), (r+1, i), (r+1, i+1). */
export function plazaGroup(grid: Grid, anchor: ColumnId): ColumnId[] {
  const { k } = grid;
  const r = grid.ring[anchor];
  const i = grid.index[anchor];
  return [columnId(k, r, i), columnId(k, r, i + 1), columnId(k, r + 1, i), columnId(k, r + 1, i + 1)];
}

/** Greedy plaza scan in (ring, index) order. Mutates island.inPlaza/plazas; returns the groups it formed. */
export function rebuildPlazas(grid: Grid, island: Island): ColumnId[][] {
  const { k } = grid;
  const formed: ColumnId[][] = [];
  for (let r = 0; r < k.K_RINGS - 1; r++) {
    for (let i = 0; i < k.K_INDICES; i++) {
      const anchor = columnId(k, r, i);
      const group = plazaGroup(grid, anchor);
      if (group.every((c) => island.heights[c] === k.K_PLAZA_HEIGHT && !island.inPlaza[c])) {
        for (const c of group) island.inPlaza[c] = true;
        island.plazas.push(anchor);
        formed.push(group);
      }
    }
  }
  return formed;
}

/** Greedy bridge assignment over all edges in scan order. */
export function rebuildBridges(grid: Grid, heights: readonly number[]): boolean[] {
  const { k } = grid;
  const active = new Array<boolean>(grid.edges.length).fill(false);
  const perColumn = new Array<number>(grid.columnCount).fill(0);
  for (const e of grid.edges) {
    const ha = heights[e.a];
    const hb = heights[e.b];
    if (
      ha >= k.K_BRIDGE_MIN_HEIGHT &&
      hb >= k.K_BRIDGE_MIN_HEIGHT &&
      Math.abs(ha - hb) <= k.K_BRIDGE_MAX_DIFF &&
      perColumn[e.a] < k.K_BRIDGE_MAX_PER_COLUMN &&
      perColumn[e.b] < k.K_BRIDGE_MAX_PER_COLUMN
    ) {
      active[e.id] = true;
      perColumn[e.a]++;
      perColumn[e.b]++;
    }
  }
  return active;
}

export function resolve(grid: Grid, island: Island, c: ColumnId): StructureId {
  const { k } = grid;
  const h = island.heights[c];
  if (island.inPlaza[c]) return 'ST_PLAZA';
  if (h >= k.K_LIGHTHOUSE_MIN_HEIGHT) return 'ST_LIGHTHOUSE';
  if (h >= k.K_TOWER_MIN_HEIGHT) return 'ST_TOWER';
  if (h === 1 && grid.ring[c] === k.K_RINGS - 1) return 'ST_PIER';
  if (h === 1) return 'ST_COTTAGE';
  return 'ST_EMPTY';
}

export function structureYield(k: Readonly<Constants>, s: StructureId, height: number): number {
  switch (s) {
    case 'ST_PLAZA':
      return k.K_Y_PLAZA;
    case 'ST_LIGHTHOUSE':
      return k.K_Y_LIGHTHOUSE * height;
    case 'ST_TOWER':
      return k.K_Y_TOWER * height;
    case 'ST_PIER':
      return k.K_Y_PIER;
    case 'ST_COTTAGE':
      return k.K_Y_COTTAGE;
    case 'ST_EMPTY':
      return 0;
  }
}

export function evaluate(grid: Grid, island: Island, bonuses: Readonly<Bonuses> = NO_BONUSES): Evaluation {
  const { k } = grid;
  const { era, heights } = island;
  const on = (m: ModifierId): boolean => era >= MODIFIER_MIN_ERA[m];

  const structures = heights.map((_, c) => resolve(grid, island, c));
  const bases = structures.map((s, c) => structureYield(k, s, heights[c]));
  const activeBridges = on('MOD_BRIDGE')
    ? rebuildBridges(grid, heights)
    : new Array<boolean>(grid.edges.length).fill(false);

  const columns: ColumnEval[] = [];
  let yieldSum = 0;

  for (let c = 0; c < grid.columnCount; c++) {
    const structure = structures[c];
    if (structure === 'ST_EMPTY') {
      columns.push({ ...EMPTY_COLUMN });
      continue;
    }
    const h = heights[c];
    const base = bases[c];

    let bridges = 0;
    let overclock = 0;
    for (const eid of grid.edgesOf[c]) {
      if (!activeBridges[eid]) continue;
      bridges++;
      if (on('MOD_OVERCLOCK')) {
        const e = grid.edges[eid];
        overclock += k.K_OVERCLOCK_SHARE * bases[e.a === c ? e.b : e.a];
      }
    }

    let balconySides = 0;
    if (on('MOD_BALCONY')) {
      const { inner, outer } = grid.neighbors[c];
      if (inner !== null && h >= heights[inner] + k.K_BALCONY_HEIGHT_DIFF) balconySides++;
      if (outer !== null && h >= heights[outer] + k.K_BALCONY_HEIGHT_DIFF) balconySides++;
    }

    let beacons = 0;
    if (on('MOD_BEACON')) {
      for (const n of grid.neighborList[c]) if (structures[n] === 'ST_LIGHTHOUSE') beacons++;
    }

    const plazaAura =
      on('MOD_PLAZA_AURA') &&
      structure !== 'ST_PLAZA' &&
      grid.neighborList[c].some((n) => island.inPlaza[n]);

    const golden = on('MOD_GOLDEN') && island.golden[c];

    const additive =
      bridges * k.K_M_BRIDGE +
      balconySides * k.K_M_BALCONY +
      beacons * k.K_M_BEACON +
      (plazaAura ? k.K_M_PLAZA_AURA : 0) +
      bonuses.additive +
      (bonuses.additiveByType[structure] ?? 0);

    const y = (base * (1 + additive) + overclock) * (golden ? k.K_M_GOLDEN : 1);
    yieldSum += y;
    columns.push({
      structure,
      base,
      bridges,
      balconySides,
      beacons,
      plazaAura,
      golden,
      additive,
      overclock,
      yield: y,
    });
  }

  const typesPresent = HARMONY_TYPES.filter((t) => structures.includes(t));
  const bridgeCount = activeBridges.filter(Boolean).length;
  const lighthouseCount = structures.filter((s) => s === 'ST_LIGHTHOUSE').length;
  const harmony = Math.min(
    k.K_HARMONY_CAP[era],
    1 +
      k.K_HARMONY_PER_TYPE * typesPresent.length +
      k.K_HARMONY_PER_BRIDGE * bridgeCount +
      k.K_HARMONY_PER_LIGHTHOUSE * lighthouseCount,
  );
  const income = yieldSum * harmony * k.K_ERA_YIELD_MULT[era] * bonuses.incomeMult;

  return {
    columns,
    activeBridges,
    bridgeCount,
    lighthouseCount,
    typesPresent,
    harmony,
    yieldSum,
    income,
  };
}
