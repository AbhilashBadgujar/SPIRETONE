import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DELIVER_TIME, Flock, MAX_WORKERS, bezier, swoop } from '../src/render/flock';
import { LAYOUT } from '../src/render/layout';

const step = (f: Flock, seconds: number, from: number) => {
  let t = from;
  for (; t < from + seconds; t += 1 / 60) f.update(1 / 60, t);
  return t;
};

describe('flight curve', () => {
  it('starts and ends where it should and eases at both ends', () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(1, 2, 0);
    const c = new Vector3(2, 0, 0);
    expect(bezier(a, b, c, 0, new Vector3()).toArray()).toEqual([0, 0, 0]);
    expect(bezier(a, b, c, 1, new Vector3()).toArray()).toEqual([2, 0, 0]);
    expect(bezier(a, b, c, 0.5, new Vector3()).y).toBeCloseTo(1);
    expect(swoop(0)).toBe(0);
    expect(swoop(1)).toBe(1);
    expect(swoop(0.1)).toBeLessThan(0.1);
    expect(swoop(2)).toBe(1);
  });
});

describe('worker Gulls', () => {
  it('has no one to send until a Gull is owned', () => {
    const f = new Flock();
    expect(f.dispatch(new Vector3(0, 3, 2), 0)).toBeNull();
    f.setCount(9, 0);
    expect(f.size).toBe(MAX_WORKERS);
  });

  it('carries the block to the fall point, lets go, and returns to its circle', () => {
    const f = new Flock();
    f.setCount(1, 0);
    const fall = new Vector3(2.2, 3, 0);
    expect(f.dispatch(fall, 0.5)).toBe(DELIVER_TIME);
    const w = f.workers[0];
    expect(w.carrying).toBe(true);
    // Busy birds aren't sent twice.
    expect(f.dispatch(fall, 0)).toBeNull();

    let t = step(f, DELIVER_TIME - 0.05, 0);
    expect(w.carrying).toBe(true);
    t = step(f, 0.1, t);
    expect(w.carrying).toBe(false);
    // Released with the block's base on the fall point: bird above it by block + gap.
    expect(w.from.x).toBeCloseTo(fall.x);
    expect(w.from.z).toBeCloseTo(fall.z);
    expect(w.from.y).toBeGreaterThan(fall.y + LAYOUT.blockHeight);

    step(f, 1.5, t);
    expect(w.mode).toBe('circle');
    expect(f.dispatch(fall, 0)).toBe(DELIVER_TIME);
  });

  it('sends the idle bird nearest the column', () => {
    const f = new Flock();
    f.setCount(3, 0);
    const near = f.workers[2].pos.clone().setY(3);
    f.dispatch(near, 0);
    expect(f.workers.map((w) => w.mode)).toEqual(['circle', 'circle', 'deliver', 'circle', 'circle']);
  });

  it('recall drops every carry at once', () => {
    const f = new Flock();
    f.setCount(2, 0);
    f.dispatch(new Vector3(0, 3, 2.2), 0);
    f.dispatch(new Vector3(0, 3, -2.2), 0);
    f.recall();
    expect(f.workers.slice(0, 2).every((w) => !w.carrying && w.mode === 'return')).toBe(true);
  });
});
