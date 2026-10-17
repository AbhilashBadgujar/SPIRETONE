import { describe, expect, it } from 'vitest';
import { OrbitCursor, moveSelection, type CursorContext } from '../src/game/cursor';
import { evaluate, NO_BONUSES } from '../src/sim/evaluate';
import type { Island } from '../src/sim/island';
import { grid, id, islandWith, k } from './helpers';

function ctx(island: Island, skipBlocked = false): CursorContext {
  return { island, evaluation: evaluate(grid, island), bonuses: NO_BONUSES, skipBlocked };
}

/** Island where nothing new can appear on the inner ring, so no smart pauses there. */
function settled(): Island {
  const heights: Record<string, number> = {};
  for (let i = 0; i < 12; i++) heights[`0,${i}`] = 3;
  heights['1,3'] = 2;
  heights['2,5'] = 1;
  heights['1,8'] = 1;
  return islandWith(0, heights);
}

describe('GDD §4 orbit cursor', () => {
  it('visits columns in spiral order every K_CURSOR_STEP', () => {
    const c = ctx(settled());
    const cursor = new OrbitCursor(grid);
    cursor.reset(c);
    expect(cursor.column).toBe(id(0, 0));
    cursor.update(k.K_CURSOR_STEP - 0.01, c);
    expect(cursor.column).toBe(id(0, 0));
    cursor.update(0.02, c);
    expect(cursor.column).toBe(id(0, 1));
    for (let s = 0; s < 10; s++) cursor.update(k.K_CURSOR_STEP, c);
    expect(cursor.column).toBe(id(0, 11));
    cursor.update(k.K_CURSOR_STEP, c);
    expect(cursor.column).toBe(id(1, 0));
  });

  it('wraps from the last outer column back to ring 0 index 0', () => {
    const c = ctx(settled());
    const cursor = new OrbitCursor(grid);
    cursor.reset(c, id(2, 11));
    for (let t = 0; t < 2; t += 0.05) {
      cursor.update(0.05, c);
      if (cursor.column !== id(2, 11)) break;
    }
    expect(cursor.column).toBe(id(0, 0));
  });

  it('dwells K_SMART_PAUSE longer where a drop adds a missing type', () => {
    const c = ctx(islandWith(0, {}));
    const cursor = new OrbitCursor(grid);
    cursor.reset(c);
    expect(cursor.smart).toBe(true); // first cottage
    cursor.update(k.K_CURSOR_STEP + 0.01, c);
    expect(cursor.column).toBe(id(0, 0));
    cursor.update(k.K_SMART_PAUSE, c);
    expect(cursor.column).toBe(id(0, 1));
  });

  it('flags a new bridge as smart', () => {
    const island = islandWith(0, { '0,0': 3, '0,1': 2, '1,0': 2, '1,1': 2, '0,5': 1, '2,4': 1 });
    const cursor = new OrbitCursor(grid);
    cursor.reset(ctx(island), id(0, 1));
    expect(cursor.smart).toBe(true);
  });

  it('visits blocked columns until NODE_O5, then skips them', () => {
    const island = settled(); // whole inner ring at Era I cap
    const visiting = new OrbitCursor(grid);
    visiting.reset(ctx(island));
    expect(visiting.column).toBe(id(0, 0));

    const skipping = new OrbitCursor(grid);
    skipping.reset(ctx(island, true));
    expect(skipping.column).toBe(id(1, 0));
    skipping.update(10, ctx(island, true));
    expect(grid.ring[skipping.column]).toBeGreaterThan(0);
  });
});

describe('GDD §4 direct mode selection', () => {
  it('wraps index and clamps ring', () => {
    expect(moveSelection(grid, id(0, 0), -1, 0)).toBe(id(0, 11));
    expect(moveSelection(grid, id(1, 11), 1, 0)).toBe(id(1, 0));
    expect(moveSelection(grid, id(0, 4), 0, -1)).toBe(id(0, 4));
    expect(moveSelection(grid, id(2, 4), 0, 1)).toBe(id(2, 4));
    expect(moveSelection(grid, id(0, 4), 0, 1)).toBe(id(1, 4));
  });
});
