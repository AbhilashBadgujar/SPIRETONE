import { describe, expect, it } from 'vitest';
import { ACH_BY_ID, ACHIEVEMENTS, MAX_GAMERSCORE } from '../src/data/achievements';
import { TREE } from '../src/data/tree';
import { checkAchievements, gamerscore, met } from '../src/sim/achievements';
import { evaluate, NO_BONUSES } from '../src/sim/evaluate';
import { advanceGulls } from '../src/sim/gulls';
import { ascend, newGame, tryDrop, type GameState } from '../src/sim/run';
import { deserialize, serialize } from '../src/sim/save';
import { grid, id, islandWith, k } from './helpers';

/** A new game whose current island is `cells`, evaluated. */
function onIsland(era: 0 | 1 | 2 | 3, cells: Record<string, number>): GameState {
  const s = newGame(grid, 1);
  s.run.island = islandWith(era, cells);
  s.run.evaluation = evaluate(grid, s.run.island, NO_BONUSES);
  return s;
}

describe('GDD §9 achievement table', () => {
  it('has 34 unique achievements worth exactly 1000G', () => {
    expect(ACHIEVEMENTS).toHaveLength(34);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(34);
    expect(gamerscore(ACHIEVEMENTS.map((a) => a.id))).toBe(MAX_GAMERSCORE);
    for (const a of ACHIEVEMENTS) expect(a.points % 5, a.id).toBe(0);
  });
});

describe('lifetime stats', () => {
  it('count every placed block, golden roll and Cascade', () => {
    const s = newGame(grid, 1);
    s.run.resonance = 1e9;
    tryDrop(grid, s, id(0, 0));
    expect(s.meta.stats.blocks).toBe(1);
    expect(s.meta.stats.cascades).toBe(0);

    // Era IV: a column reaching 4 becomes a Lighthouse and cascades.
    const e4 = onIsland(3, { '0,0': 3 });
    e4.run.resonance = 1e15;
    const out = tryDrop(grid, e4, id(0, 0));
    expect(out.ok && out.outcome.placed.length).toBeGreaterThan(1);
    expect(e4.meta.stats.cascades).toBe(1);
    expect(e4.meta.stats.cascadeBlocks).toBe(e4.meta.stats.blocks - 1);
  });

  it('count Gull drops', () => {
    const s = newGame(grid, 1);
    s.meta.nodes = ['NODE_Y1', 'NODE_C1', 'NODE_G1'];
    s.run.resonance = 1e9;
    advanceGulls(grid, s, k.K_GULL_INTERVAL * 3 + 0.01);
    expect(s.meta.stats.gullDrops).toBe(3);
    expect(s.meta.stats.blocks).toBe(3);
  });

  it('keep the best single Ascension', () => {
    const s = newGame(grid, 1);
    for (let c = 0; c < 36; c++) s.run.island.heights[c] = grid.caps[0][c];
    s.run.earned = 500 * 49;
    expect(ascend(grid, s)).toBe(7);
    expect(s.meta.stats.bestAscend).toBe(7);
  });
});

describe('unlocking', () => {
  it('unlocks once, in table order, and only what is met', () => {
    const s = newGame(grid, 1);
    s.run.resonance = 1e9;
    expect(checkAchievements(s)).toEqual([]);
    tryDrop(grid, s, id(2, 0)); // an outer-ring block is a Pier
    expect(checkAchievements(s)).toEqual(['ACH_FIRST_DROP', 'ACH_PIER']);
    expect(checkAchievements(s)).toEqual([]);
    expect(s.meta.achievements).toEqual(['ACH_FIRST_DROP', 'ACH_PIER']);
  });

  it('reads the island for structures and modifiers', () => {
    const c = ACH_BY_ID;
    // Two Lighthouses either side of one column: that column gets Beacon twice.
    const beacon = onIsland(1, { '0,0': 4, '0,1': 1, '0,2': 4 });
    expect(met(c.ACH_LIGHTHOUSE.condition, beacon)).toBe(true);
    expect(met(c.ACH_BEACON.condition, beacon)).toBe(true);
    // Era III bridge between two towers: Overclock.
    const oc = onIsland(2, { '0,0': 3, '0,1': 3 });
    expect(met(c.ACH_BRIDGE.condition, oc)).toBe(true);
    expect(met(c.ACH_OVERCLOCK.condition, oc)).toBe(true);
    // The same bridge in Era I doesn't overclock.
    expect(met(c.ACH_OVERCLOCK.condition, onIsland(0, { '0,0': 3, '0,1': 3 }))).toBe(false);
    expect(met(c.ACH_BALCONY.condition, onIsland(0, { '0,0': 3 }))).toBe(true);
  });

  it('completes a branch only when every node in it is owned', () => {
    const s = newGame(grid, 1);
    s.meta.nodes = ['NODE_S1'];
    expect(met(ACH_BY_ID.ACH_BRANCH_START.condition, s)).toBe(false);
    s.meta.nodes.push('NODE_S2');
    expect(met(ACH_BY_ID.ACH_BRANCH_START.condition, s)).toBe(true);
    expect(met(ACH_BY_ID.ACH_TREE_FULL.condition, s)).toBe(false);
    s.meta.nodes = TREE.map((n) => n.id);
    expect(met(ACH_BY_ID.ACH_TREE_FULL.condition, s)).toBe(true);
  });
});

describe('save v3', () => {
  it('keeps stats and unlocked achievements', () => {
    const s = newGame(grid, 1);
    s.meta.stats.gullDrops = 42;
    s.meta.achievements.push('ACH_GULL_1');
    const loaded = deserialize(grid, JSON.parse(JSON.stringify(serialize(s))))!;
    expect(loaded.meta.stats.gullDrops).toBe(42);
    expect(loaded.meta.achievements).toEqual(['ACH_GULL_1']);
  });

  it('loads a v2 save with zero stats and back-fills what it already earned', () => {
    const s = newGame(grid, 1);
    s.meta.ascensions = 6;
    s.meta.nodes = ['NODE_Y1', 'NODE_C1'];
    s.meta.highestEra = 1;
    const data = JSON.parse(JSON.stringify(serialize(s)));
    data.v = 2;
    delete data.meta.stats;
    delete data.meta.achievements;
    const loaded = deserialize(grid, data)!;
    expect(loaded.meta.stats.blocks).toBe(0);
    expect(loaded.meta.achievements).toEqual([]);
    expect(checkAchievements(loaded)).toEqual(['ACH_ASCEND_1', 'ACH_ASCEND_5', 'ACH_ERA_2', 'ACH_NODE_1']);
  });

  it('drops unknown achievement ids and zeroes bad counters', () => {
    const data = JSON.parse(JSON.stringify(serialize(newGame(grid, 1))));
    data.meta.achievements = ['ACH_PIER', 'ACH_NOPE', 'ACH_PIER'];
    data.meta.stats.blocks = -3;
    const loaded = deserialize(grid, data)!;
    expect(loaded.meta.achievements).toEqual(['ACH_PIER']);
    expect(loaded.meta.stats.blocks).toBe(0);
  });
});
