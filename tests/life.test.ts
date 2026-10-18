import { describe, expect, it } from 'vitest';
import { ERA_PRESETS } from '../src/data/eras';
import { IslandView } from '../src/render/island-view';
import { Life } from '../src/render/life';
import { Ocean } from '../src/render/ocean';
import { NO_BONUSES, evaluate } from '../src/sim/evaluate';
import { grid, id, islandWith } from './helpers';

const PIER = '2,0';
const PLAZA = { '0,3': 1, '0,4': 1, '1,3': 1, '1,4': 1 };
const BRIDGE = { '0,7': 3, '0,8': 3 };
const COTTAGE = '1,10';

function view(cells: Record<string, number>): IslandView {
  const island = islandWith(0, cells);
  const v = new IslandView(grid);
  v.applyPreset(ERA_PRESETS.ERA_1);
  v.sync(island, evaluate(grid, island, NO_BONUSES));
  return v;
}

function life(v: IslandView): Life {
  const l = new Life(new Ocean());
  l.applyPreset(ERA_PRESETS.ERA_1);
  l.sync(v.spots);
  return l;
}

describe('life spots', () => {
  it('mark piers, plazas, bridges and cottage chimneys', () => {
    const { spots } = view({ [PIER]: 1, ...PLAZA, ...BRIDGE, [COTTAGE]: 1 });
    expect(spots.piers.map((s) => s.key)).toEqual([`q${id(2, 0)}`]);
    expect(spots.plazas).toHaveLength(1);
    expect(spots.bridges).toHaveLength(1);
    expect(spots.chimneys).toHaveLength(1);
  });

  it('are empty on an empty island', () => {
    const { spots } = view({});
    expect([spots.piers, spots.plazas, spots.bridges, spots.chimneys].map((l) => l.length)).toEqual([0, 0, 0, 0]);
  });
});

describe('life', () => {
  it('has two villagers strolling round the spire from the start', () => {
    const l = life(view({}));
    expect(l.villagers).toBe(2);
    expect(l.boatCount).toBe(0);
  });

  it('adds two villagers per plaza and a boat per pier', () => {
    const l = life(view({ [PIER]: 1, ...PLAZA }));
    // Strollers, the plaza pair, and maybe a fisher on the pier.
    expect(l.villagers).toBeGreaterThanOrEqual(4);
    expect(l.villagers).toBeLessThanOrEqual(5);
    expect(l.boatCount).toBe(1);
  });

  it('caps the crowd on a crowded island', () => {
    const cells: Record<string, number> = {};
    for (let r = 0; r < 3; r++) for (let i = 0; i < 12; i++) cells[`${r},${i}`] = 3;
    const l = life(view(cells));
    expect(l.villagers).toBeLessThanOrEqual(32);
    expect(l.villagers).toBeGreaterThan(2);
  });

  it('keeps everyone through a resync and lets them walk', () => {
    const v = view({ ...PLAZA });
    const l = life(v);
    const before = l.villagers;
    l.update(0.5, 0.5, true);
    l.sync(v.spots);
    expect(l.villagers).toBe(before);
    expect(() => l.update(0.5, 1, true)).not.toThrow();
  });
});
