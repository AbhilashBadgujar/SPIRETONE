import { Color } from 'three';
import type { EraLight, EraPreset } from '../data/eras';

// Time of day. Each era drifts from its own look to its `evening` and back
// over DAY seconds of play, lingering at both ends. Windows come on as the
// light goes (Era I's are dark by day; the other eras' are always lit).
// Colors blend in linear space.

/** Seconds of play for a full day: the era's own look, its evening, and back. */
export const DAY = 420;

/** The blended look, as the renderer takes it. */
export interface Light {
  sunColor: Color;
  sunIntensity: number;
  /** Degrees. */
  sunElevation: number;
  sunAzimuth: number;
  skyColor: Color;
  groundColor: Color;
  skyIntensity: number;
  skyTop: Color;
  skyBottom: Color;
  fogColor: Color;
  fogDensity: number;
  shallow: Color;
  deep: Color;
  bloom: number;
  /** 0 dark glass .. 1 lit. */
  windows: number;
}

export function newLight(): Light {
  return {
    sunColor: new Color(),
    sunIntensity: 0,
    sunElevation: 0,
    sunAzimuth: 0,
    skyColor: new Color(),
    groundColor: new Color(),
    skyIntensity: 0,
    skyTop: new Color(),
    skyBottom: new Color(),
    fogColor: new Color(),
    fogDensity: 0,
    shallow: new Color(),
    deep: new Color(),
    bloom: 0,
    windows: 0,
  };
}

/** 0 at the era's own look, 1 at its evening; holds a while at each end. */
export function dayPhase(time: number): number {
  const wave = 0.5 - 0.5 * Math.cos((time / DAY) * Math.PI * 2);
  return smoothstep(0.12, 0.88, wave);
}

/** The preset's own look as an EraLight (the morning end of its day). */
export function ownLight(p: EraPreset): EraLight {
  return {
    sun: p.sun,
    skyLight: p.skyLight,
    sky: p.sky,
    fog: p.fog,
    water: { shallow: p.ocean.shallow, deep: p.ocean.deep },
    bloom: p.bloom,
  };
}

const _a = new Color();
const _b = new Color();

/** The look `k` of the way from the era's own (0) to its evening (1), into `out`. */
export function lightAt(p: EraPreset, k: number, out: Light): Light {
  const a = ownLight(p);
  const b = p.evening;
  const mix = (x: number, y: number) => x + (y - x) * k;
  const tint = (into: Color, x: number, y: number) => into.lerpColors(_a.setHex(x), _b.setHex(y), k);
  tint(out.sunColor, a.sun.color, b.sun.color);
  out.sunIntensity = mix(a.sun.intensity, b.sun.intensity);
  out.sunElevation = mix(a.sun.elevation, b.sun.elevation);
  out.sunAzimuth = mix(a.sun.azimuth, b.sun.azimuth);
  tint(out.skyColor, a.skyLight.sky, b.skyLight.sky);
  tint(out.groundColor, a.skyLight.ground, b.skyLight.ground);
  out.skyIntensity = mix(a.skyLight.intensity, b.skyLight.intensity);
  tint(out.skyTop, a.sky.top, b.sky.top);
  tint(out.skyBottom, a.sky.bottom, b.sky.bottom);
  tint(out.fogColor, a.fog.color, b.fog.color);
  out.fogDensity = mix(a.fog.density, b.fog.density);
  tint(out.shallow, a.water.shallow, b.water.shallow);
  tint(out.deep, a.water.deep, b.water.deep);
  out.bloom = mix(a.bloom, b.bloom);
  // Lamps come on as the sun gets low.
  const lit = p.litWindows ? 1 : 0;
  out.windows = lit + (1 - lit) * smoothstep(0.45, 0.8, k);
  return out;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
