import { describe, expect, it } from 'vitest';
import { NODE_BY_ID, TREE, type NodeId } from '../src/data/tree';
import { evaluate } from '../src/sim/evaluate';
import { advanceGulls, gullTarget } from '../src/sim/gulls';
import { ascend, bonusesFor, newGame, startIsland } from '../src/sim/run';
import { deserialize, serialize } from '../src/sim/save';
import { buyNode, buyRejection, effectsOf, nodeState } from '../src/sim/tree';
import { grid, id, islandWith, k } from './helpers';

const owner = (shards: number, nodes: NodeId[] = []) => ({ shards, nodes, highestEra: 0 as const });

describe('GDD §7 tree data', () => {
  it('references only real nodes, has no cycles, and every node is reachable', () => {
    for (const n of TREE) for (const r of n.requires) expect(NODE_BY_ID[r], `${n.id} requires ${r}`).toBeDefined();
    // Buying everything in dependency order must be possible.
    const o = owner(Infinity);
    let progress = true;
    while (progress) {
      progress = false;
      for (const n of TREE) if (nodeState(o, n.id) === 'available' && buyNode(o, n.id) === null) progress = true;
    }
    expect(o.nodes).toHaveLength(TREE.length);
  });

  it('has the GDD-named nodes doing what the GDD says', () => {
    expect(NODE_BY_ID.NODE_C1.effect).toEqual({ kind: 'era', era: 1 });
    expect(NODE_BY_ID.NODE_C2.effect).toEqual({ kind: 'era', era: 2 });
    expect(NODE_BY_ID.NODE_C3.effect).toEqual({ kind: 'era', era: 3 });
    expect(NODE_BY_ID.NODE_O3.effect.kind).toBe('rapidDrop');
    expect(NODE_BY_ID.NODE_O5.effect.kind).toBe('orbitSkip');
  });

  it('places every node at its own spot on the map', () => {
    const spots = new Set(TREE.map((n) => n.pos.join(',')));
    expect(spots.size).toBe(TREE.length);
  });
});

describe('GDD §7 buying', () => {
  it('starters are open, the rest wait on prerequisites', () => {
    const o = owner(0);
    expect(nodeState(o, 'NODE_Y1')).toBe('available');
    expect(nodeState(o, 'NODE_C1')).toBe('locked');
    expect(buyRejection(o, 'NODE_C1')).toBe('LOCKED');
  });

  it('spends Shards once and refuses repeats or short funds', () => {
    const o = owner(10);
    expect(buyRejection(o, 'NODE_Y2')).toBe('LOCKED');
    expect(buyNode(o, 'NODE_Y1')).toBeNull();
    expect(o.shards).toBe(10 - NODE_BY_ID.NODE_Y1.cost);
    expect(buyNode(o, 'NODE_Y1')).toBe('OWNED');
    o.shards = NODE_BY_ID.NODE_Y2.cost - 1;
    expect(buyNode(o, 'NODE_Y2')).toBe('CANT_AFFORD');
    expect(o.nodes).toEqual(['NODE_Y1']);
  });

  it('core nodes raise the era, which applies from the next island', () => {
    const s = newGame(grid, 1);
    s.meta.shards = 1000;
    buyNode(s.meta, 'NODE_Y1');
    buyNode(s.meta, 'NODE_C1');
    expect(s.meta.highestEra).toBe(1);
    expect(s.run.island.era).toBe(0);
    for (let i = 0; i < 12; i++) s.run.island.heights[i] = 3;
    for (let i = 12; i < 20; i++) s.run.island.heights[i] = 1;
    ascend(grid, s);
    expect(s.run.island.era).toBe(1);
  });
});

describe('GDD §7 effects', () => {
  it('folds every effect kind', () => {
    const all = TREE.map((n) => n.id);
    const e = effectsOf(all);
    expect(e.highestEra).toBe(3);
    expect(e.rapidDrop && e.orbitSkipsBlocked).toBe(true);
    expect(e.bonuses.incomeMult).toBe(2 * 3 * 5);
    expect(e.bonuses.goldenChance).toBeCloseTo(0.07);
    expect(e.bonuses.additiveByType.ST_TOWER).toBe(1);
    expect(e.gulls).toBe(5);
    expect(e.gullIntervalMult).toBeCloseTo(0.6);
    expect(e.cursorStepMult).toBeCloseTo(0.512);
    expect(e.startResMult).toBe(50);
  });

  it("a type bonus lands in that structure's additive term only", () => {
    // (1,4) keeps the tower clear of a balcony bonus.
    const island = islandWith(0, { '0,0': 1, '0,4': 2, '1,4': 1 });
    const ev = evaluate(grid, island, effectsOf(['NODE_Y1']).bonuses);
    expect(ev.columns[id(0, 0)].additive).toBe(1);
    expect(ev.columns[id(0, 4)].additive).toBe(0);
  });

  it('start Resonance scales with Head Start', () => {
    const meta = { ...newGame(grid, 1).meta, nodes: ['NODE_S1' as NodeId] };
    expect(startIsland(grid, meta, 1).resonance).toBe(k.K_START_RES[0] * 5);
  });
});

describe('GDD §8 Gulls', () => {
  it('drop on the best column every interval, paying the normal cost', () => {
    const s = newGame(grid, 1);
    s.meta.nodes = ['NODE_Y1', 'NODE_C1', 'NODE_G1'];
    s.run.resonance = 1000;
    const target = gullTarget(grid, s);
    expect(target).not.toBeNull();
    expect(advanceGulls(grid, s, k.K_GULL_INTERVAL - 0.01)).toHaveLength(0);
    const drops = advanceGulls(grid, s, 0.02);
    expect(drops).toHaveLength(1);
    expect(drops[0].column).toBe(target);
    expect(s.run.resonance).toBeCloseTo(1000 - drops[0].attempt.cost);
  });

  it('skip a drop the player cannot afford', () => {
    const s = newGame(grid, 1);
    s.meta.nodes = ['NODE_Y1', 'NODE_C1', 'NODE_G1'];
    s.run.resonance = 0;
    expect(advanceGulls(grid, s, k.K_GULL_INTERVAL + 0.01)).toHaveLength(0);
    expect(s.run.island.heights.every((h) => h === 0)).toBe(true);
  });

  it('do nothing without a Gull node', () => {
    const s = newGame(grid, 1);
    s.run.resonance = 1e6;
    expect(advanceGulls(grid, s, 60)).toHaveLength(0);
  });
});

describe('save v2', () => {
  it('keeps owned nodes and derives the era from them', () => {
    const s = newGame(grid, 1);
    s.meta.shards = 1000;
    buyNode(s.meta, 'NODE_Y1');
    buyNode(s.meta, 'NODE_C1');
    const loaded = deserialize(grid, JSON.parse(JSON.stringify(serialize(s))))!;
    expect(loaded.meta.nodes).toEqual(['NODE_Y1', 'NODE_C1']);
    expect(loaded.meta.highestEra).toBe(1);
    expect(loaded.run.evaluation).toEqual(evaluate(grid, loaded.run.island, bonusesFor(loaded.meta)));
  });

  it('loads a v1 save with an empty tree', () => {
    const data = JSON.parse(JSON.stringify(serialize(newGame(grid, 1))));
    data.v = 1;
    delete data.meta.nodes;
    const loaded = deserialize(grid, data)!;
    expect(loaded.meta.nodes).toEqual([]);
    expect(loaded.meta.highestEra).toBe(0);
  });

  it('drops unknown node ids', () => {
    const data = JSON.parse(JSON.stringify(serialize(newGame(grid, 1))));
    data.meta.nodes = ['NODE_Y1', 'NODE_NOPE', 'NODE_Y1'];
    expect(deserialize(grid, data)!.meta.nodes).toEqual(['NODE_Y1']);
  });
});
