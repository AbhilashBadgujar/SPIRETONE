import type { Bonuses, Evaluation } from '../sim/evaluate';
import { columnId, type ColumnId, type Grid } from '../sim/grid';
import { isDroppable, previewDrop, type Island } from '../sim/island';

// Column selection for both control modes (GDD §4). No rendering here.

export interface CursorContext {
  island: Island;
  evaluation: Evaluation;
  bonuses: Readonly<Bonuses>;
  /** NODE_O5: skip capped / plaza-locked columns instead of visiting them greyed out. */
  skipBlocked: boolean;
  /** Tree multiplier on K_CURSOR_STEP (NODE_O1, O2, O4). Defaults to 1. */
  stepMult?: number;
}

/**
 * Orbit mode: visits columns in spiral order (ring 0 index 0→11, then ring 1,
 * then ring 2, looping), K_CURSOR_STEP each, plus K_SMART_PAUSE where a drop
 * would add a missing structure type, a bridge or a lighthouse.
 */
export class OrbitCursor {
  column: ColumnId = 0;
  /** True while dwelling on a smart-pause column. */
  smart = false;
  private remaining = 0;

  constructor(private readonly grid: Grid) {}

  /** Restart from the first visitable column (new island, mode switch). */
  reset(ctx: CursorContext, from: ColumnId = 0): void {
    const n = this.grid.columnCount;
    for (let step = 0; step < n; step++) {
      const c = (from + step) % n;
      if (this.visitable(c, ctx)) {
        this.enter(c, ctx);
        return;
      }
    }
    this.enter(from, ctx);
  }

  /** Returns true if the cursor moved to another column. */
  update(dt: number, ctx: CursorContext): boolean {
    this.remaining -= dt;
    let moved = false;
    while (this.remaining <= 0) {
      const overshoot = this.remaining;
      const next = this.next(ctx);
      if (next === null) {
        // Nothing visitable: hold still and check again next step.
        this.remaining = overshoot + this.grid.k.K_CURSOR_STEP;
        continue;
      }
      this.enter(next, ctx);
      this.remaining += overshoot;
      moved = true;
    }
    return moved;
  }

  private next(ctx: CursorContext): ColumnId | null {
    const n = this.grid.columnCount;
    for (let step = 1; step <= n; step++) {
      const c = (this.column + step) % n;
      if (this.visitable(c, ctx)) return c;
    }
    return null;
  }

  private visitable(c: ColumnId, ctx: CursorContext): boolean {
    return !ctx.skipBlocked || isDroppable(this.grid, ctx.island, c);
  }

  /** Moves onto c with a fresh dwell. */
  private enter(c: ColumnId, ctx: CursorContext): void {
    const { k } = this.grid;
    this.column = c;
    const p = previewDrop(this.grid, ctx.island, c, ctx.bonuses, ctx.evaluation);
    this.smart = p !== null && (p.newType || p.newBridge || p.newLighthouse);
    this.remaining = k.K_CURSOR_STEP * (ctx.stepMult ?? 1) + (this.smart ? k.K_SMART_PAUSE : 0);
  }
}

/** Direct mode step: index wraps around the ring, ring clamps at inner/outer. */
export function moveSelection(grid: Grid, c: ColumnId, dIndex: number, dRing: number): ColumnId {
  const ring = Math.min(grid.k.K_RINGS - 1, Math.max(0, grid.ring[c] + dRing));
  return columnId(grid.k, ring, grid.index[c] + dIndex);
}
