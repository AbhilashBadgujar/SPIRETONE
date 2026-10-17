import type { Ray } from 'three';
import type { ColumnId, Grid } from '../sim/grid';
import type { Island } from '../sim/island';
import { LAYOUT, columnTopY, columnX, columnZ } from '../render/layout';

// Mouse/touch picking: each column is a vertical cylinder from the ground to
// a little above its top, so tall front columns correctly occlude back ones.

const PICK_RADIUS = 0.42;
/** Extra height above the top block so roofs and lamps count as the column. */
const PICK_HEADROOM = 0.5;
/** Empty columns still need something to aim at. */
const EMPTY_HEIGHT = 0.3;

/** `ray` must be in turntable space. */
export function pickColumn(grid: Grid, island: Island, ray: Ray): ColumnId | null {
  let best: ColumnId | null = null;
  let bestT = Infinity;
  for (let c = 0; c < grid.columnCount; c++) {
    const h = island.heights[c];
    const top = island.inPlaza[c]
      ? LAYOUT.groundY + LAYOUT.plazaHeight
      : h > 0
        ? columnTopY(h) + PICK_HEADROOM
        : LAYOUT.groundY + EMPTY_HEIGHT;
    const t = rayCylinder(ray, columnX(grid, c), columnZ(grid, c), PICK_RADIUS, LAYOUT.groundY - 0.1, top);
    if (t !== null && t < bestT) {
      bestT = t;
      best = c;
    }
  }
  return best;
}

/** Nearest positive t where the ray enters a capped vertical cylinder, or null. */
export function rayCylinder(ray: Ray, cx: number, cz: number, r: number, y0: number, y1: number): number | null {
  const { origin: o, direction: d } = ray;
  let best = Infinity;

  const ox = o.x - cx;
  const oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a > 1e-9) {
    const b = 2 * (ox * d.x + oz * d.z);
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
        const y = o.y + d.y * t;
        if (t > 0 && y >= y0 && y <= y1 && t < best) best = t;
      }
    }
  }

  if (Math.abs(d.y) > 1e-9) {
    const t = (y1 - o.y) / d.y;
    if (t > 0) {
      const px = ox + d.x * t;
      const pz = oz + d.z * t;
      if (px * px + pz * pz <= r * r && t < best) best = t;
    }
  }

  return best === Infinity ? null : best;
}
