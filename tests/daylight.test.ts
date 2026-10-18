import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { ERA_PRESETS } from '../src/data/eras';
import { ERA_IDS } from '../src/data/ids';
import { DAY, dayPhase, lightAt, newLight } from '../src/render/daylight';

const hex = (c: Color) => c.getHex();

describe('time of day', () => {
  it('starts at the era’s own look, reaches evening halfway, and comes back', () => {
    expect(dayPhase(0)).toBe(0);
    expect(dayPhase(DAY / 2)).toBe(1);
    expect(dayPhase(DAY)).toBeCloseTo(0, 6);
    expect(dayPhase(DAY / 4)).toBeGreaterThan(0);
    expect(dayPhase(DAY / 4)).toBeLessThan(1);
  });

  it('lingers at both ends', () => {
    expect(dayPhase(DAY * 0.05)).toBe(0);
    expect(dayPhase(DAY * 0.45)).toBe(1);
  });

  it('blends from each era’s own look to its evening', () => {
    for (const id of ERA_IDS) {
      const p = ERA_PRESETS[id];
      const morning = lightAt(p, 0, newLight());
      expect(hex(morning.sunColor), id).toBe(p.sun.color);
      expect(hex(morning.skyBottom), id).toBe(p.sky.bottom);
      expect(morning.sunIntensity, id).toBe(p.sun.intensity);
      const evening = lightAt(p, 1, newLight());
      expect(hex(evening.sunColor), id).toBe(p.evening.sun.color);
      expect(hex(evening.shallow), id).toBe(p.evening.water.shallow);
      expect(evening.fogDensity, id).toBe(p.evening.fog.density);
    }
  });

  it('lights the windows as the sun goes down, where they are dark by day', () => {
    ERA_IDS.forEach((id) => {
      const p = ERA_PRESETS[id];
      expect(lightAt(p, 0, newLight()).windows, id).toBe(p.litWindows ? 1 : 0);
      expect(lightAt(p, 1, newLight()).windows, id).toBe(1);
    });
    expect(ERA_PRESETS.ERA_1.litWindows).toBe(false);
  });
});
