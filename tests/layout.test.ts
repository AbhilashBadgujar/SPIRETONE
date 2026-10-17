import { describe, expect, it } from 'vitest';
import { LAYOUT, columnX, columnZ } from '../src/render/layout';
import { grid, id } from './helpers';

const dist = (a: number, b: number) =>
  Math.hypot(columnX(grid, a) - columnX(grid, b), columnZ(grid, a) - columnZ(grid, b));

describe('island layout', () => {
  it('leaves a visible gap between ring neighbors for bridges', () => {
    for (let r = 0; r < 3; r++) {
      expect(dist(id(r, 0), id(r, 1)) - LAYOUT.blockWidth).toBeGreaterThan(0.3);
    }
  });

  it('keeps rings from overlapping', () => {
    for (let r = 0; r < 2; r++) {
      expect(dist(id(r, 0), id(r + 1, 0))).toBeGreaterThan(LAYOUT.blockDepth);
    }
  });

  it('keeps the outer ring on the grass and piers reaching the water', () => {
    const outer = LAYOUT.ringRadius[2];
    expect(outer + LAYOUT.blockDepth / 2).toBeLessThan(LAYOUT.islandRadius - 0.25);
    expect(outer + LAYOUT.pierOffset + LAYOUT.pierLength / 2).toBeGreaterThan(LAYOUT.islandRadius + 0.3);
  });
});
