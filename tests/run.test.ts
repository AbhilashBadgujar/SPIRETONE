import { describe, expect, it } from 'vitest';
import { totalBlocks } from '../src/sim/island';
import { advance, ascend, canAscend, currentCost, newGame, startIsland, tryDrop } from '../src/sim/run';
import { grid, id } from './helpers';

describe('run economy', () => {
  it('starts with K_START_RES and no income', () => {
    const s = newGame(grid, 1);
    expect(s.run.resonance).toBe(20);
    expect(s.run.evaluation.income).toBe(0);
    expect(s.run.island.era).toBe(0);
  });

  it('charges block_cost and grows it per paid block', () => {
    const s = newGame(grid, 1);
    expect(tryDrop(grid, s, id(0, 0))).toMatchObject({ ok: true, cost: 10 });
    expect(s.run.resonance).toBe(10);
    expect(currentCost(grid, s.run)).toBeCloseTo(10.8);
  });

  it('rejects a drop without charging or changing the island', () => {
    const s = newGame(grid, 1);
    tryDrop(grid, s, id(2, 0));
    expect(tryDrop(grid, s, id(2, 0))).toEqual({ ok: false, reason: 'AT_CAP' });
    expect(s.run.resonance).toBe(10);

    s.run.resonance = 5;
    expect(tryDrop(grid, s, id(0, 0))).toEqual({ ok: false, reason: 'CANT_AFFORD' });
    expect(s.run.resonance).toBe(5);
    expect(s.run.island.heights[id(0, 0)]).toBe(0);
  });

  it('credits income in whole K_TICK steps', () => {
    const s = newGame(grid, 1);
    tryDrop(grid, s, id(0, 0)); // cottage 2/s * Harmony 1.5
    expect(s.run.evaluation.income).toBeCloseTo(3);

    advance(grid, s, 0.05);
    expect(s.run.resonance).toBe(10);
    advance(grid, s, 0.05);
    expect(s.run.resonance).toBeCloseTo(10.3);
    advance(grid, s, 1);
    expect(s.run.resonance).toBeCloseTo(13.3);
    expect(s.run.earned).toBeCloseTo(3.3);
    expect(s.meta.lifetimeResonance).toBeCloseTo(3.3);
  });

  it('does not drift over many 60 fps frames', () => {
    const s = newGame(grid, 1);
    tryDrop(grid, s, id(0, 0));
    for (let f = 0; f < 600; f++) advance(grid, s, 1 / 60);
    expect(s.run.earned).toBeGreaterThanOrEqual(29.7);
    expect(s.run.earned).toBeLessThanOrEqual(30.0001);
  });
});

describe('GDD §5 Ascension', () => {
  const fillTo44 = (s: ReturnType<typeof newGame>) => {
    for (let i = 0; i < 12; i++) s.run.island.heights[id(0, i)] = 3;
    for (let i = 0; i < 8; i++) s.run.island.heights[id(1, i)] = 1;
  };

  it('unlocks at the fill threshold and pays floor(sqrt(earned / K_SHARD_DIV))', () => {
    const s = newGame(grid, 1);
    expect(canAscend(grid, s.run)).toBe(false);
    expect(ascend(grid, s)).toBeNull();

    fillTo44(s);
    expect(canAscend(grid, s.run)).toBe(true);
    s.run.earned = 500 * 49 + 1;
    s.meta.lifetimeResonance = 777;

    expect(ascend(grid, s)).toBe(7);
    expect(s.meta).toMatchObject({ shards: 7, ascensions: 1, lifetimeResonance: 777 });
    expect(s.run.resonance).toBe(20);
    expect(s.run.earned).toBe(0);
    expect(totalBlocks(s.run.island)).toBe(0);
    expect(s.run.island.golden.some(Boolean)).toBe(false);
  });

  it('starts new islands in the highest unlocked era', () => {
    const s = newGame(grid, 1);
    s.meta.highestEra = 2;
    fillTo44(s);
    ascend(grid, s);
    expect(s.run.island.era).toBe(2);
    expect(startIsland(grid, { ...s.meta, highestEra: 3 }, 9).island.era).toBe(3);
  });

  it('is reproducible from a seed', () => {
    const a = newGame(grid, 42);
    const b = newGame(grid, 42);
    fillTo44(a);
    fillTo44(b);
    ascend(grid, a);
    ascend(grid, b);
    expect(a.run.rngSeed).toBe(b.run.rngSeed);
  });
});
