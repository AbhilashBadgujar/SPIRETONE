import { describe, expect, it } from 'vitest';
import { evaluate, plazaGroup, rebuildPlazas } from '../src/sim/evaluate';
import { evalWith, grid, id, islandWith } from './helpers';

describe('GDD §3 structure resolution', () => {
  it('resolves by priority and yields per the table', () => {
    const { ev } = evalWith(3, { '0,0': 1, '2,3': 1, '0,2': 2, '0,4': 3, '0,6': 4, '0,8': 8 });
    const s = (r: number, i: number) => ev.columns[id(r, i)];
    expect(s(0, 0)).toMatchObject({ structure: 'ST_COTTAGE', base: 2 });
    expect(s(2, 3)).toMatchObject({ structure: 'ST_PIER', base: 3 });
    expect(s(0, 2)).toMatchObject({ structure: 'ST_TOWER', base: 8 });
    expect(s(0, 4)).toMatchObject({ structure: 'ST_TOWER', base: 12 });
    expect(s(0, 6)).toMatchObject({ structure: 'ST_LIGHTHOUSE', base: 32 });
    expect(s(0, 8)).toMatchObject({ structure: 'ST_LIGHTHOUSE', base: 64 });
    expect(s(1, 1)).toMatchObject({ structure: 'ST_EMPTY', yield: 0 });
  });

  it('is deterministic', () => {
    const island = islandWith(2, { '0,0': 3, '0,1': 3, '0,2': 1, '1,2': 1, '2,5': 1 });
    expect(evaluate(grid, island)).toEqual(evaluate(grid, island));
  });
});

describe('GDD §3 plazas', () => {
  it('forms from a 2x2 of height-1 columns across rings and overrides Pier', () => {
    const { island, ev } = evalWith(0, { '1,4': 1, '1,5': 1, '2,4': 1, '2,5': 1 });
    for (const c of [id(1, 4), id(1, 5), id(2, 4), id(2, 5)]) {
      expect(island.inPlaza[c]).toBe(true);
      expect(ev.columns[c]).toMatchObject({ structure: 'ST_PLAZA', base: 12 });
    }
  });

  it('wraps around index 11 -> 0', () => {
    const { island } = evalWith(0, { '0,11': 1, '0,0': 1, '1,11': 1, '1,0': 1 });
    expect(island.inPlaza[id(0, 11)] && island.inPlaza[id(1, 0)]).toBe(true);
  });

  it('forms greedily in scan order with no overlaps', () => {
    const { island } = evalWith(0, { '0,0': 1, '0,1': 1, '0,2': 1, '1,0': 1, '1,1': 1, '1,2': 1 });
    expect(island.inPlaza.filter(Boolean)).toHaveLength(4);
    expect(island.inPlaza[id(0, 2)]).toBe(false);
  });

  it('ignores columns that are not exactly height 1', () => {
    const { island } = evalWith(0, { '0,0': 2, '0,1': 1, '1,0': 1, '1,1': 1 });
    expect(island.inPlaza.some(Boolean)).toBe(false);
  });

  it('records each plaza anchor so side-by-side plazas keep their own groups', () => {
    // Plaza at i=1 forms first; the one wrapping 11 -> 0 forms later. The flags
    // alone would also fit a group anchored at i=0.
    const island = islandWith(0, { '0,1': 1, '0,2': 1, '1,1': 1, '1,2': 1 });
    for (const key of ['0,0', '1,0', '0,11', '1,11']) {
      const [r, i] = key.split(',').map(Number);
      island.heights[id(r, i)] = 1;
    }
    rebuildPlazas(grid, island);
    expect(island.plazas).toEqual([id(0, 1), id(0, 11)]);
    expect(plazaGroup(grid, id(0, 11))).toEqual([id(0, 11), id(0, 0), id(1, 11), id(1, 0)]);
  });

  it('never re-forms or breaks on a later scan', () => {
    const island = islandWith(0, { '0,0': 1, '0,1': 1, '1,0': 1, '1,1': 1 });
    expect(rebuildPlazas(grid, island)).toEqual([]);
    expect(island.inPlaza.filter(Boolean)).toHaveLength(4);
  });
});

describe('GDD §3 modifiers', () => {
  it('MOD_BRIDGE: heights >= 3 within 1 of each other, +50% to both ends', () => {
    // Mid ring at 2 keeps balcony out of the picture.
    const { ev } = evalWith(0, { '0,0': 3, '0,1': 3, '1,0': 2, '1,1': 2 });
    expect(ev.bridgeCount).toBe(1);
    expect(ev.columns[id(0, 0)]).toMatchObject({ bridges: 1, yield: 12 * 1.5 });
    expect(ev.columns[id(0, 1)]).toMatchObject({ bridges: 1, yield: 12 * 1.5 });
    expect(evalWith(1, { '0,0': 3, '0,1': 4 }).ev.bridgeCount).toBe(1);
  });

  it('MOD_BRIDGE: no bridge if too short or too uneven', () => {
    expect(evalWith(0, { '0,0': 2, '0,1': 2 }).ev.bridgeCount).toBe(0);
    expect(evalWith(2, { '0,0': 3, '0,1': 5 }).ev.bridgeCount).toBe(0);
  });

  it('MOD_BRIDGE: a full inner ring of towers bridges all 12 edges, 2 per column', () => {
    const heights: Record<string, number> = {};
    for (let i = 0; i < 12; i++) heights[`0,${i}`] = 3;
    const { ev } = evalWith(0, heights);
    expect(ev.bridgeCount).toBe(12);
    expect(ev.columns[id(0, 0)].bridges).toBe(2);
  });

  it('MOD_BALCONY: +25% per inner/outer side at least 2 lower', () => {
    expect(evalWith(0, { '0,0': 3, '1,0': 1 }).ev.columns[id(0, 0)].balconySides).toBe(1);
    expect(evalWith(1, { '1,0': 3, '0,0': 1 }).ev.columns[id(1, 0)]).toMatchObject({
      balconySides: 2,
      additive: 0.5,
    });
    // Empty left/right neighbors don't count; outer is only 1 lower.
    expect(evalWith(0, { '0,0': 3, '1,0': 2 }).ev.columns[id(0, 0)].balconySides).toBe(0);
  });

  it('MOD_BEACON: +20% per adjacent Lighthouse, Era II+ only', () => {
    const era2 = evalWith(1, { '0,0': 4, '0,1': 1, '0,2': 4 });
    expect(era2.ev.columns[id(0, 1)]).toMatchObject({ beacons: 2, additive: 0.4 });
    const era1 = evalWith(0, { '0,0': 4, '0,1': 1 });
    expect(era1.ev.columns[id(0, 1)].beacons).toBe(0);
  });

  it('MOD_PLAZA_AURA: +30% once for non-plaza neighbors of a plaza', () => {
    // (0,2) sits between two plazas but only gets the aura once.
    const plazas = { '0,0': 1, '0,1': 1, '1,0': 1, '1,1': 1, '0,3': 1, '0,4': 1, '1,3': 1, '1,4': 1 };
    const { ev } = evalWith(0, { ...plazas, '0,2': 1, '0,11': 2 });
    expect(ev.columns[id(0, 2)]).toMatchObject({ structure: 'ST_COTTAGE', plazaAura: true, additive: 0.3 });
    expect(ev.columns[id(0, 11)].plazaAura).toBe(true);
    expect(ev.columns[id(0, 0)].plazaAura).toBe(false);
  });

  it('MOD_GOLDEN: x10 on the whole column yield', () => {
    const { ev } = evalWith(0, { '0,0': 1 }, { golden: ['0,0'] });
    expect(ev.columns[id(0, 0)].yield).toBe(20);
  });

  it('MOD_OVERCLOCK: Era III+ adds 50% of the other end base, flat', () => {
    const heights = { '0,0': 3, '0,1': 3, '1,0': 2, '1,1': 2 };
    const era3 = evalWith(2, heights);
    expect(era3.ev.columns[id(0, 0)]).toMatchObject({ overclock: 6, yield: 12 * 1.5 + 6 });
    const era2 = evalWith(1, heights);
    expect(era2.ev.columns[id(0, 0)].overclock).toBe(0);
  });

  it('column_yield = (base * (1 + additive) + overclock) * golden', () => {
    const { ev } = evalWith(2, { '0,0': 4, '0,1': 4, '1,0': 1 }, { golden: ['0,0'] });
    // base 32, bridge 0.5 + balcony 0.25 + beacon 0.2, overclock 0.5 * 32, golden x10
    const c = ev.columns[id(0, 0)];
    expect(c.additive).toBeCloseTo(0.95);
    expect(c.yield).toBeCloseTo((32 * 1.95 + 16) * 10);
  });

  it('adds tree bonuses to the additive term', () => {
    const { ev } = evalWith(0, { '0,0': 1 }, { bonuses: { additive: 1, incomeMult: 1, goldenChance: 0 } });
    expect(ev.columns[id(0, 0)].yield).toBe(4);
  });
});

describe('GDD §5 Harmony and income', () => {
  it('starts at 1 on an empty island', () => {
    expect(evalWith(0, {}).ev).toMatchObject({ harmony: 1, income: 0 });
  });

  it('counts distinct types, bridges and lighthouses', () => {
    const { ev } = evalWith(1, { '0,0': 4, '0,1': 4, '0,3': 1, '2,6': 1 });
    // types: lighthouse, cottage, pier = 3; bridges 1; lighthouses 2
    expect(ev.typesPresent).toEqual(['ST_COTTAGE', 'ST_PIER', 'ST_LIGHTHOUSE']);
    expect(ev.harmony).toBeCloseTo(1 + 1.5 + 0.1 + 0.4);
  });

  it('caps Harmony per era', () => {
    const heights: Record<string, number> = {};
    for (let i = 0; i < 12; i++) heights[`0,${i}`] = 3;
    heights['2,0'] = 1;
    heights['1,5'] = 1;
    // Era I: 1 + 3 types * 0.5 + 12 bridges * 0.1 = 3.7 (under cap 4)
    expect(evalWith(0, heights).ev.harmony).toBeCloseTo(3.7);

    // 12 lighthouses: 1 + 0.5 + 12 * 0.1 + 12 * 0.2 = 5.1
    const tall: Record<string, number> = {};
    for (let i = 0; i < 12; i++) tall[`0,${i}`] = 4;
    expect(evalWith(0, tall).ev.harmony).toBe(4);
    expect(evalWith(1, tall).ev.harmony).toBeCloseTo(5.1);
  });

  it('income = sum(yield) * harmony * era mult * tree mult', () => {
    const one = evalWith(1, { '0,0': 1 }, { bonuses: { additive: 0, incomeMult: 2, goldenChance: 0 } }).ev;
    expect(one.income).toBeCloseTo(2 * 1.5 * 3 * 2);
  });
});
