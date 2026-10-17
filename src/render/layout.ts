import type { ColumnId, Grid } from '../sim/grid';

// Where columns sit in turntable space. Art spacing only: gameplay numbers
// stay in data/constants.ts.
//
// Column (r, i) sits at angle i * 2π / K_INDICES on ring r, with local +z
// pointing away from the island center and +x toward index i+1.

export const LAYOUT = {
  ringRadius: [2.2, 3.35, 4.5],
  blockWidth: 0.72,
  blockDepth: 0.72,
  blockHeight: 0.5,
  /** Top of the grass layer; blocks stand on it. */
  groundY: 0.08,
  islandRadius: 5.2,
  waterLevel: -0.45,
  /** How far outward the pier deck's center sits from its column center. */
  pierOffset: 0.45,
  pierLength: 1.75,
  /** Radians per second. */
  turntableSpeed: 0.05,
} as const;

export function columnAngle(grid: Grid, c: ColumnId): number {
  return (grid.index[c] / grid.k.K_INDICES) * Math.PI * 2;
}

export function columnRadius(grid: Grid, c: ColumnId): number {
  return LAYOUT.ringRadius[grid.ring[c]];
}

/** Turntable-space x/z of a column's center. */
export function columnX(grid: Grid, c: ColumnId): number {
  return Math.sin(columnAngle(grid, c)) * columnRadius(grid, c);
}

export function columnZ(grid: Grid, c: ColumnId): number {
  return Math.cos(columnAngle(grid, c)) * columnRadius(grid, c);
}

/** y of the top face of a column of the given height. */
export function columnTopY(height: number): number {
  return LAYOUT.groundY + height * LAYOUT.blockHeight;
}
