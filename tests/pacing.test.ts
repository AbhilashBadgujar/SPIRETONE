import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '../src/data/achievements';
import { simulateRun, TARGETS } from '../tools/pacing';

// GDD §11: the shipped constants, tree and achievement thresholds must keep
// every §5 milestone, 1000G included, within ±10%. Retune with
// `npm run pacing` when this fails.

describe('GDD §11 pacing', () => {
  const r = simulateRun();

  it('hits every milestone within ±10%', () => {
    expect(r.stuck).toBe(false);
    for (const key of Object.keys(TARGETS) as (keyof typeof TARGETS)[]) {
      const [lo, hi] = TARGETS[key];
      const v = r.milestones[key];
      expect(v, key).toBeDefined();
      expect(v!, key).toBeGreaterThanOrEqual(lo * 0.9);
      expect(v!, key).toBeLessThanOrEqual(hi * 1.1);
    }
  });

  it('unlocks every achievement in one natural playthrough (GDD §9: nothing missable)', () => {
    expect(r.achievements.map((a) => a.id).sort()).toEqual(ACHIEVEMENTS.map((a) => a.id).sort());
  });
});
