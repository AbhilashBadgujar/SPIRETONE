// Timing and motion of the Ascension sequence. Pure, so the HUD, sound and
// tests share one timeline:
//
//   rise     the island lifts out of the sea, spinning faster; a flash builds
//   (peak)   the flash covers the swap: Shards banked, new island built
//   descend  the new island falls in from above
//   settle   it lands with a squash; controls come back after this

export const ASCENSION = { rise: 1.3, descend: 0.9, settle: 0.6 } as const;
export const ASCENSION_TOTAL = ASCENSION.rise + ASCENSION.descend + ASCENSION.settle;

const RISE_HEIGHT = 6;
const DROP_FROM = 7;

export interface AscensionPose {
  /** Island root height above its rest position. */
  y: number;
  /** Island root y-scale (landing squash). */
  squash: number;
  /** Extra turntable spin, radians per second. */
  spin: number;
}

/** Full-screen flash opacity: builds through the rise, peaks at the swap, fades fast. */
export function flashOpacity(t: number): number {
  const { rise } = ASCENSION;
  const build = 0.6;
  const fade = 0.6;
  if (t < rise - build) return 0;
  if (t < rise) {
    const u = (t - (rise - build)) / build;
    return u * u * u;
  }
  const v = (t - rise) / fade;
  return v >= 1 ? 0 : 1 - v;
}

export function ascensionPose(t: number): AscensionPose {
  const { rise, descend } = ASCENSION;
  if (t < rise) {
    const u = t / rise;
    return { y: RISE_HEIGHT * u * u * u, squash: 1, spin: 0.2 + 5 * u * u };
  }
  const d = t - rise;
  if (d < descend) {
    const u = d / descend;
    // Falls like a dropped block: accelerating into the landing.
    return { y: DROP_FROM * (1 - u * u), squash: 1, spin: 0.6 * (1 - u) };
  }
  const v = d - descend;
  return { y: 0, squash: 1 - 0.08 * Math.exp(-v * 7) * Math.cos(v * 16), spin: 0 };
}
