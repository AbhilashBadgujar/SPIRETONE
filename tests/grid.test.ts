import { describe, expect, it } from 'vitest';
import { buildGrid, maxBlocks } from '../src/sim/grid';
import { grid, id, k } from './helpers';

describe('GDD §2 island grid', () => {
  it('has 36 columns', () => {
    expect(grid.columnCount).toBe(36);
  });

  it('matches the resulting caps table', () => {
    const capsByRing = (era: 0 | 1 | 2 | 3) => [0, 1, 2].map((r) => grid.caps[era][id(r, 0)]);
    expect(capsByRing(0)).toEqual([3, 2, 1]);
    expect(capsByRing(1)).toEqual([4, 3, 2]);
    expect(capsByRing(2)).toEqual([6, 5, 4]);
    expect(capsByRing(3)).toEqual([8, 7, 6]);
  });

  it('matches max blocks per era', () => {
    expect([0, 1, 2, 3].map((e) => maxBlocks(grid, e as 0 | 1 | 2 | 3))).toEqual([72, 108, 180, 252]);
  });

  it('never lets a cap fall below K_CAP_MIN', () => {
    const g = buildGrid({ ...k, K_CAP_ERA: [1, 4, 6, 8] });
    expect(g.caps[0][id(2, 0)]).toBe(1);
  });

  it('wraps left/right and only has inner/outer where rings exist', () => {
    expect(grid.neighbors[id(0, 0)]).toEqual({ left: id(0, 11), right: id(0, 1), inner: null, outer: id(1, 0) });
    expect(grid.neighbors[id(2, 11)]).toEqual({ left: id(2, 10), right: id(2, 0), inner: id(1, 11), outer: null });
    expect(grid.neighborList[id(1, 5)]).toEqual([id(1, 4), id(1, 6), id(0, 5), id(2, 5)]);
  });

  it('has 36 ring edges in scan order, wrapping 11 -> 0', () => {
    expect(grid.edges).toHaveLength(36);
    expect(grid.edges[0]).toEqual({ id: 0, a: id(0, 0), b: id(0, 1) });
    expect(grid.edges[11]).toEqual({ id: 11, a: id(0, 11), b: id(0, 0) });
    expect(grid.edges[12]).toEqual({ id: 12, a: id(1, 0), b: id(1, 1) });
    for (let c = 0; c < 36; c++) expect(grid.edgesOf[c]).toHaveLength(2);
  });

  it('rejects inconsistent K_COLUMNS', () => {
    expect(() => buildGrid({ ...k, K_COLUMNS: 40 })).toThrow();
  });
});
