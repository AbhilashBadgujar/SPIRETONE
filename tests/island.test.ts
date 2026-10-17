import { describe, expect, it } from 'vitest';
import { evaluate, NO_BONUSES } from '../src/sim/evaluate';
import {
  ascendThreshold,
  blockCost,
  createIsland,
  dropBlock,
  placementRejection,
  previewDrop,
  reachableBlocks,
} from '../src/sim/island';
import { grid, id, islandWith, k } from './helpers';

const ctx = { bonuses: NO_BONUSES, random: () => 0.5 };

describe('GDD §2 placement rule', () => {
  it('rejects columns at cap and plaza-locked columns', () => {
    const island = islandWith(0, { '2,0': 1, '0,5': 3 });
    expect(placementRejection(grid, island, id(2, 0))).toBe('AT_CAP');
    expect(placementRejection(grid, island, id(0, 5))).toBe('AT_CAP');
    expect(placementRejection(grid, island, id(0, 6))).toBeNull();

    const plaza = islandWith(0, { '0,0': 1, '0,1': 1, '1,0': 1, '1,1': 1 });
    expect(placementRejection(grid, plaza, id(0, 0))).toBe('PLAZA_LOCKED');
  });
});

describe('reachable blocks and Ascend threshold', () => {
  it('Era I: 72 reachable, 60% rounds up to 44', () => {
    const island = createIsland(grid, 0);
    expect(reachableBlocks(grid, island)).toBe(72);
    expect(ascendThreshold(grid, island)).toBe(44);
  });

  it('plazas lower the reachable total', () => {
    const island = islandWith(0, { '0,0': 1, '0,1': 1, '1,0': 1, '1,1': 1 });
    // Two inner columns lose 2 each, two mid columns lose 1 each.
    expect(reachableBlocks(grid, island)).toBe(66);
    expect(ascendThreshold(grid, island)).toBe(40);
  });
});

describe('GDD §5 block cost', () => {
  it('is K_COST_BASE * growth[era] ^ n', () => {
    expect(blockCost(k, 0, 0)).toBe(10);
    expect(blockCost(k, 1, 0)).toBeCloseTo(10.8);
    expect(blockCost(k, 10, 3)).toBeCloseTo(10 * Math.pow(1.055, 10));
  });
});

describe('dropBlock', () => {
  it('reports first-time structure types once per island', () => {
    const island = createIsland(grid, 0);
    const a = dropBlock(grid, island, id(0, 0), ctx, evaluate(grid, island));
    expect(a.newTypes).toEqual(['ST_COTTAGE']);
    const b = dropBlock(grid, island, id(0, 3), ctx, a.evaluation);
    expect(b.newTypes).toEqual([]);
    expect(island.paidBlocks).toBe(2);
  });

  it('reports new lighthouses and bridges gained and lost', () => {
    const island = islandWith(2, { '0,0': 3, '0,1': 2, '1,0': 2, '1,1': 2 });
    const a = dropBlock(grid, island, id(0, 1), ctx, evaluate(grid, island));
    expect(a.newBridges).toEqual([0]);
    const b = dropBlock(grid, island, id(0, 1), ctx, a.evaluation);
    expect(b).toMatchObject({ newBridges: [], lostBridges: [], newLighthouses: [id(0, 1)] });
    const c = dropBlock(grid, island, id(0, 1), ctx, b.evaluation);
    expect(c.lostBridges).toEqual([0]);
  });

  it('rolls golden only on a column\'s first block', () => {
    const island = createIsland(grid, 0);
    let rolls = 0;
    const gctx = {
      bonuses: { ...NO_BONUSES, goldenChance: 1 },
      random: () => {
        rolls++;
        return 0.5;
      },
    };
    const a = dropBlock(grid, island, id(0, 0), gctx, evaluate(grid, island));
    expect(a.goldenRolled).toEqual([id(0, 0)]);
    expect(island.golden[id(0, 0)]).toBe(true);
    const b = dropBlock(grid, island, id(0, 0), gctx, a.evaluation);
    expect(b.goldenRolled).toEqual([]);
    expect(rolls).toBe(1);
  });

  it('forms a plaza when the fourth column lands', () => {
    const island = islandWith(0, { '0,0': 1, '0,1': 1, '1,0': 1 });
    const out = dropBlock(grid, island, id(1, 1), ctx, evaluate(grid, island));
    expect(out.newPlazas).toEqual([[id(0, 0), id(0, 1), id(1, 0), id(1, 1)]]);
    expect(out.newTypes).toContain('ST_PLAZA');
  });
});

describe('GDD §6 Cascade', () => {
  it('drops a free block on the lowest droppable neighbor when a Lighthouse forms', () => {
    const island = islandWith(3, { '0,0': 3, '0,11': 2, '0,1': 1, '1,0': 1 });
    const out = dropBlock(grid, island, id(0, 0), ctx, evaluate(grid, island));
    // (0,1) Right and (1,0) Outer tie at 1; Right wins.
    expect(out.placed).toEqual([id(0, 0), id(0, 1)]);
    expect(island.paidBlocks).toBe(1);
  });

  it('chains at most K_CASCADE_MAX_CHAIN free blocks per drop', () => {
    const heights: Record<string, number> = {};
    for (let i = 0; i < 12; i++) {
      heights[`0,${i}`] = 3;
      heights[`1,${i}`] = 7; // at Era IV mid cap, so never droppable
    }
    const island = islandWith(3, heights);
    const out = dropBlock(grid, island, id(0, 0), ctx, evaluate(grid, island));
    expect(out.placed).toEqual([id(0, 0), id(0, 11), id(0, 10), id(0, 9), id(0, 8)]);
    expect(island.heights[id(0, 7)]).toBe(3);
    expect(island.paidBlocks).toBe(1);
  });

  it('only happens in Era IV', () => {
    const island = islandWith(2, { '0,0': 3, '0,1': 1 });
    const out = dropBlock(grid, island, id(0, 0), ctx, evaluate(grid, island));
    expect(out.placed).toEqual([id(0, 0)]);
  });
});

describe('previewDrop (K_SMART_PAUSE)', () => {
  it('flags new types, bridges and lighthouses without touching the island', () => {
    const island = islandWith(1, { '0,0': 3, '0,1': 2, '0,5': 1 });
    const ev = evaluate(grid, island);
    const snapshot = structuredClone(island);
    const p = (r: number, i: number) => previewDrop(grid, island, id(r, i), NO_BONUSES, ev);

    expect(p(0, 1)).toEqual({ newType: false, newBridge: true, newLighthouse: false });
    expect(p(0, 0)).toEqual({ newType: true, newBridge: false, newLighthouse: true });
    expect(p(0, 8)).toEqual({ newType: false, newBridge: false, newLighthouse: false });
    expect(p(2, 8)?.newType).toBe(true);
    expect(island).toEqual(snapshot);
  });

  it('returns null for columns you cannot drop on', () => {
    const island = islandWith(1, { '0,0': 4 });
    expect(previewDrop(grid, island, id(0, 0), NO_BONUSES, evaluate(grid, island))).toBeNull();
  });
});
