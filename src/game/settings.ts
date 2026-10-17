import type { ControlMode } from './game';

// Player settings (GDD §4 "Toggle mode: Settings"; §10). Kept apart from the
// save, so resetting progress keeps them.
//
// The web build defaults to Direct (tap or click where to build): playtests
// found the self-moving Orbit cursor hard to follow for a new player. Orbit
// stays one tap away in Settings.

export type Quality = 'auto' | 'high' | 'low';

export interface Settings {
  mode: ControlMode;
  quality: Quality;
}

const KEY = 'spiretone.settings';
/** v2: Direct became the default. A v1 'orbit' was the old default, not a choice, so it resets. */
const VERSION = 2;
export const DEFAULT_SETTINGS: Readonly<Settings> = { mode: 'direct', quality: 'auto' };

export function loadSettings(): Settings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS };
    const r = raw as Record<string, unknown>;
    const chosen = r.v === VERSION && (r.mode === 'orbit' || r.mode === 'direct');
    return {
      mode: chosen ? (r.mode as Settings['mode']) : DEFAULT_SETTINGS.mode,
      quality: r.quality === 'high' || r.quality === 'low' ? r.quality : 'auto',
    };
  } catch {
    // Storage blocked or garbage: defaults, and nothing breaks.
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, ...s }));
  } catch {
    // Unavailable storage just means settings last this session only.
  }
}
