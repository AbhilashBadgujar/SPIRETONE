import type { Quality } from './settings';

// Render quality: a ladder of pixel-ratio and shadow-map levels. 'high' and
// 'low' pin a level; 'auto' starts at a level that suits the device and
// steps down while frames run slow. It never steps back up within a
// session, so it can't oscillate.

export interface RenderLevel {
  /** Cap on devicePixelRatio. */
  pixelRatio: number;
  shadowSize: number;
}

export const LEVELS: readonly RenderLevel[] = [
  { pixelRatio: 2, shadowSize: 2048 },
  { pixelRatio: 1.5, shadowSize: 2048 },
  { pixelRatio: 1.25, shadowSize: 1024 },
  { pixelRatio: 1, shadowSize: 1024 },
];

const LOWEST = LEVELS.length - 1;
/** Seconds of frames averaged per decision. */
const WINDOW = 2.5;
/** Average frame time that counts as slow (below ~45 fps). */
const SLOW = 1 / 45;
/** A frame longer than this is a hitch (tab switch, GC), not a trend. */
const HITCH = 0.25;

export class AdaptiveQuality {
  private current = 0;
  private sum = 0;
  private frames = 0;

  constructor(
    private quality: Quality,
    /** Phones and tablets start a step lower on 'auto'. */
    private readonly handheld: boolean,
  ) {
    this.current = this.startLevel();
  }

  get level(): number {
    return this.current;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.current = this.startLevel();
    this.sum = 0;
    this.frames = 0;
  }

  /** Feed the real frame time. Returns the new level when it changes, else null. */
  sample(frameSeconds: number): number | null {
    if (this.quality !== 'auto' || this.current === LOWEST || frameSeconds > HITCH) return null;
    this.sum += frameSeconds;
    this.frames++;
    if (this.sum < WINDOW) return null;
    const slow = this.sum / this.frames > SLOW;
    this.sum = 0;
    this.frames = 0;
    if (!slow) return null;
    this.current++;
    return this.current;
  }

  private startLevel(): number {
    if (this.quality === 'high') return 0;
    if (this.quality === 'low') return LOWEST;
    return this.handheld ? 2 : 0;
  }
}
