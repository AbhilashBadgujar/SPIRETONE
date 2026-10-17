import { Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { pickColumn, rayCylinder } from '../src/game/picking';
import { columnTopY, columnX, columnZ } from '../src/render/layout';
import { grid, id, islandWith } from './helpers';

const down = (x: number, z: number) => new Ray(new Vector3(x, 20, z), new Vector3(0, -1, 0));

describe('column picking', () => {
  it('hits the column straight below', () => {
    const island = islandWith(0, {});
    for (const c of [id(0, 0), id(1, 5), id(2, 11)]) {
      expect(pickColumn(grid, island, down(columnX(grid, c), columnZ(grid, c)))).toBe(c);
    }
  });

  it('misses open water and the island center', () => {
    const island = islandWith(0, {});
    expect(pickColumn(grid, island, down(30, 30))).toBeNull();
    expect(pickColumn(grid, island, down(0, 0))).toBeNull();
  });

  it('lets a tall front column hide the one behind it', () => {
    // Index 0 columns sit on +z; look at them from the front, level with
    // the tall inner tower's upper floors.
    const island = islandWith(0, { '2,0': 1, '1,0': 2, '0,0': 3 });
    const y = columnTopY(1) + 0.15;
    const ray = new Ray(new Vector3(0, y, 20), new Vector3(0, 0, -1));
    expect(pickColumn(grid, island, ray)).toBe(id(2, 0));
    // Above the mid tower's roof allowance, still within the inner tower's.
    const high = new Ray(new Vector3(0, columnTopY(3) + 0.1, 20), new Vector3(0, 0, -1));
    expect(pickColumn(grid, island, high)).toBe(id(0, 0));
  });

  it('rayCylinder returns the entry distance', () => {
    const ray = new Ray(new Vector3(0, 0.5, 10), new Vector3(0, 0, -1));
    expect(rayCylinder(ray, 0, 0, 1, 0, 1)).toBeCloseTo(9);
    expect(rayCylinder(ray, 0, 0, 1, 0.6, 1)).toBeNull();
  });
});
