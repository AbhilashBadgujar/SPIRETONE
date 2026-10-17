import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/sim/evaluate';
import { advance, newGame, tryDrop } from '../src/sim/run';
import { deserialize, serialize, SAVE_VERSION } from '../src/sim/save';
import { grid, id } from './helpers';

function played() {
  const s = newGame(grid, 7);
  s.run.resonance = 1e6;
  for (const c of [id(0, 0), id(0, 1), id(1, 0), id(1, 1), id(0, 5), id(0, 5), id(2, 3)]) tryDrop(grid, s, c);
  advance(grid, s, 3.25);
  s.meta.shards = 12;
  s.meta.ascensions = 2;
  return s;
}

/** JSON round trip, as localStorage would do it. */
const roundTrip = (data: unknown) => JSON.parse(JSON.stringify(data));

describe('save / load', () => {
  it('round-trips a played game exactly, evaluation included', () => {
    const s = played();
    const loaded = deserialize(grid, roundTrip(serialize(s)));
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(s);
  });

  it('keeps plaza groupings', () => {
    const s = played();
    expect(s.run.island.plazas).toEqual([id(0, 0)]);
    expect(deserialize(grid, roundTrip(serialize(s)))!.run.island.inPlaza.filter(Boolean)).toHaveLength(4);
  });

  it('rejects garbage, other versions and broken shapes', () => {
    const good = serialize(played());
    expect(deserialize(grid, null)).toBeNull();
    expect(deserialize(grid, 'hello')).toBeNull();
    expect(deserialize(grid, { ...good, v: SAVE_VERSION + 1 })).toBeNull();
    const short = roundTrip(good);
    short.run.island.heights.pop();
    expect(deserialize(grid, short)).toBeNull();
    const nan = roundTrip(good);
    nan.run.resonance = 'lots';
    expect(deserialize(grid, nan)).toBeNull();
    const futureEra = roundTrip(good);
    futureEra.run.island.era = 3;
    expect(deserialize(grid, futureEra)).toBeNull();
  });

  it('clamps heights above the current caps and drops plazas that no longer fit', () => {
    const data = roundTrip(serialize(played()));
    data.run.island.heights[id(2, 7)] = 5; // outer cap in Era I is 1
    data.run.island.plazas.push(id(0, 5)); // column (0,5) is height 2: not a plaza
    const loaded = deserialize(grid, data)!;
    expect(loaded.run.island.heights[id(2, 7)]).toBe(1);
    expect(loaded.run.island.plazas).toEqual([id(0, 0)]);
    expect(loaded.run.evaluation).toEqual(evaluate(grid, loaded.run.island));
  });
});
