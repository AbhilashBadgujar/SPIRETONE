import { afterEach, describe, expect, it } from 'vitest';
import { AdaptiveQuality, LEVELS } from '../src/game/quality';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/game/settings';

const LOWEST = LEVELS.length - 1;
const run = (q: AdaptiveQuality, frame: number, seconds: number) => {
  const changes: number[] = [];
  for (let t = 0; t < seconds; t += frame) {
    const level = q.sample(frame);
    if (level !== null) changes.push(level);
  }
  return changes;
};

describe('adaptive quality', () => {
  it('pins High and Low', () => {
    expect(new AdaptiveQuality('high', true).level).toBe(0);
    expect(new AdaptiveQuality('low', false).level).toBe(LOWEST);
    const high = new AdaptiveQuality('high', false);
    expect(run(high, 1 / 20, 30)).toEqual([]);
  });

  it('starts handhelds a step lower on Auto', () => {
    expect(new AdaptiveQuality('auto', false).level).toBe(0);
    expect(new AdaptiveQuality('auto', true).level).toBe(2);
  });

  it('steps down while frames are slow, one level per window, and stops at the floor', () => {
    const q = new AdaptiveQuality('auto', false);
    expect(run(q, 1 / 30, 2.4)).toEqual([]);
    expect(run(q, 1 / 30, 30)).toEqual([1, 2, 3]);
    expect(q.level).toBe(LOWEST);
  });

  it('holds steady at a smooth frame rate and ignores hitches', () => {
    const q = new AdaptiveQuality('auto', false);
    expect(run(q, 1 / 60, 30)).toEqual([]);
    expect(q.sample(2)).toBeNull();
    expect(q.level).toBe(0);
  });

  it('starts over when the setting changes', () => {
    const q = new AdaptiveQuality('auto', false);
    run(q, 1 / 20, 30);
    q.setQuality('high');
    expect(q.level).toBe(0);
    q.setQuality('auto');
    expect(q.level).toBe(0);
  });
});

describe('settings storage', () => {
  const g = globalThis as { localStorage?: unknown };
  afterEach(() => delete g.localStorage);

  it('falls back to defaults without storage', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings({ mode: 'direct', quality: 'low' })).not.toThrow();
  });

  it('defaults to Direct, and resets an Orbit saved before Direct became the default', () => {
    expect(DEFAULT_SETTINGS.mode).toBe('direct');
    const store = new Map<string, string>([['spiretone.settings', JSON.stringify({ mode: 'orbit', quality: 'low' })]]);
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
    expect(loadSettings()).toEqual({ mode: 'direct', quality: 'low' });
    saveSettings({ mode: 'orbit', quality: 'low' });
    expect(loadSettings().mode).toBe('orbit');
  });

  it('round-trips, and rejects garbage field by field', () => {
    const store = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
    saveSettings({ mode: 'direct', quality: 'low' });
    expect(loadSettings()).toEqual({ mode: 'direct', quality: 'low' });
    store.set('spiretone.settings', JSON.stringify({ v: 2, mode: 'sideways', quality: 'ultra' }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    store.set('spiretone.settings', '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
