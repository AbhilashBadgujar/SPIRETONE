import type { Constants } from '../data/constants';
import type { EraIndex } from '../data/ids';

// Island topology (GDD §2). Built once per Constants and shared read-only.

/** Column address flattened to ring * K_INDICES + index. */
export type ColumnId = number;

export interface Neighbors {
  left: ColumnId;
  right: ColumnId;
  inner: ColumnId | null;
  outer: ColumnId | null;
}

/** Ring-adjacent pair (r, i)–(r, i+1 mod K_INDICES). Bridges live here. */
export interface Edge {
  id: number;
  a: ColumnId;
  b: ColumnId;
}

export interface Grid {
  k: Readonly<Constants>;
  columnCount: number;
  ring: readonly number[];
  index: readonly number[];
  neighbors: readonly Neighbors[];
  /** Existing neighbors in cascade tie order: Left, Right, Inner, Outer. */
  neighborList: readonly (readonly ColumnId[])[];
  /** Edges in scan order (ring ascending, then index ascending). */
  edges: readonly Edge[];
  /** Edge ids touching each column. */
  edgesOf: readonly (readonly number[])[];
  /** caps[era][column] */
  caps: readonly (readonly number[])[];
}

const mod = (n: number, m: number): number => ((n % m) + m) % m;

export function columnId(k: Readonly<Constants>, ring: number, index: number): ColumnId {
  return ring * k.K_INDICES + mod(index, k.K_INDICES);
}

export function capFor(k: Readonly<Constants>, ring: number, era: EraIndex): number {
  return Math.max(k.K_CAP_MIN, k.K_CAP_ERA[era] - k.K_RING_CAP_OFFSET[ring]);
}

export function buildGrid(k: Readonly<Constants>): Grid {
  const columnCount = k.K_RINGS * k.K_INDICES;
  if (columnCount !== k.K_COLUMNS) {
    throw new Error(`K_COLUMNS (${k.K_COLUMNS}) must equal K_RINGS * K_INDICES (${columnCount})`);
  }

  const ring: number[] = [];
  const index: number[] = [];
  const neighbors: Neighbors[] = [];
  const neighborList: ColumnId[][] = [];

  for (let r = 0; r < k.K_RINGS; r++) {
    for (let i = 0; i < k.K_INDICES; i++) {
      ring.push(r);
      index.push(i);
      const n: Neighbors = {
        left: columnId(k, r, i - 1),
        right: columnId(k, r, i + 1),
        inner: r > 0 ? columnId(k, r - 1, i) : null,
        outer: r < k.K_RINGS - 1 ? columnId(k, r + 1, i) : null,
      };
      neighbors.push(n);
      const list = [n.left, n.right];
      if (n.inner !== null) list.push(n.inner);
      if (n.outer !== null) list.push(n.outer);
      neighborList.push(list);
    }
  }

  const edges: Edge[] = [];
  const edgesOf: number[][] = Array.from({ length: columnCount }, () => []);
  for (let r = 0; r < k.K_RINGS; r++) {
    for (let i = 0; i < k.K_INDICES; i++) {
      const e: Edge = { id: edges.length, a: columnId(k, r, i), b: columnId(k, r, i + 1) };
      edges.push(e);
      edgesOf[e.a].push(e.id);
      edgesOf[e.b].push(e.id);
    }
  }

  const caps: number[][] = [];
  for (let era = 0; era < k.K_CAP_ERA.length; era++) {
    caps.push(ring.map((r) => capFor(k, r, era as EraIndex)));
  }

  return { k, columnCount, ring, index, neighbors, neighborList, edges, edgesOf, caps };
}

/** 12 × (sum of ring caps): the island's block ceiling before plazas lock anything. */
export function maxBlocks(grid: Grid, era: EraIndex): number {
  return grid.caps[era].reduce((sum, c) => sum + c, 0);
}
