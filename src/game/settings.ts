import type { ControlMode } from './game';

// Player settings (GDD §4 "Toggle mode: Settings"; §10). Kept apart from the
// save, so resetting progress keeps them.

export type Quality = 'auto' | 'high' | 'low';

export interface Settings {
  mode: ControlMode;
  quality: Quality;
}

const KEY = 'spiretone.settings';
export const DEFAULT_SETTINGS: Readonly<Settings> = { mode: 'orbit', quality: 'auto' };

export function loadSettings(): Settings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS };
    const r = raw as Record<string, unknown>;
    return {
      mode: r.mode === 'direct' ? 'direct' : 'orbit',
      quality: r.quality === 'high' || r.quality === 'low' ? r.quality : 'auto',
    };
  } catch {
    // Storage blocked or garbage: defaults, and nothing breaks.
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Unavailable storage just means settings last this session only.
  }
}
