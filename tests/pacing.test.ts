import { describe, expect, it } from 'vitest';
import { simulateRun, TARGETS } from '../tools/pacing';

// GDD §11: the shipped constants and tree must keep every §5 milestone
// within ±10%. Retune with `npm run pacing` when this fails.

describe('GDD §11 pacing', () => {
  it('hits every milestone within ±10%', { timeout: 120_000 }, () => {
    const r = simulateRun();
    expect(r.stuck).toBe(false);
    for (const key of Object.keys(TARGETS) as (keyof typeof TARGETS)[]) {
      const [lo, hi] = TARGETS[key];
      const v = r.milestones[key];
      expect(v, key).toBeDefined();
      expect(v!, key).toBeGreaterThanOrEqual(lo * 0.9);
      expect(v!, key).toBeLessThanOrEqual(hi * 1.1);
    }
  });
});
