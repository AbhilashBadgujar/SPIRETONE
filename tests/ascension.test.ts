import { describe, expect, it } from 'vitest';
import { ASCENSION, ASCENSION_TOTAL, ascensionPose, flashOpacity } from '../src/game/ascension';

describe('Ascension sequence motion', () => {
  it('rises from rest and is highest just before the peak', () => {
    expect(ascensionPose(0).y).toBe(0);
    expect(ascensionPose(ASCENSION.rise - 0.01).y).toBeGreaterThan(5);
  });

  it('falls back in after the peak and lands exactly at rise + descend', () => {
    expect(ascensionPose(ASCENSION.rise + 0.001).y).toBeGreaterThan(6);
    const landed = ascensionPose(ASCENSION.rise + ASCENSION.descend);
    expect(landed.y).toBe(0);
    expect(landed.squash).toBeLessThan(0.95);
  });

  it('flash is clear at the start, fully white exactly at the swap, gone by landing', () => {
    expect(flashOpacity(0)).toBe(0);
    expect(flashOpacity(ASCENSION.rise)).toBe(1);
    expect(flashOpacity(ASCENSION.rise - 0.3)).toBeLessThan(0.2);
    expect(flashOpacity(ASCENSION.rise + ASCENSION.descend)).toBe(0);
  });

  it('comes to rest by the end', () => {
    const end = ascensionPose(ASCENSION_TOTAL);
    expect(end).toMatchObject({ y: 0, spin: 0 });
    expect(Math.abs(end.squash - 1)).toBeLessThan(0.01);
  });
});
