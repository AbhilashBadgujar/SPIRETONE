import type { EraId } from './ids';

// Per-era look presets (GDD §6 "one data asset each"). Meshes never change
// between eras; only these values do.
//
// music.root / music.scale are PLACEHOLDERS: the GDD gives every era a root
// key but doesn't say which. Swap them here.
//
// Each era's day drifts slowly from its own look toward `evening` and back
// (render/daylight.ts): Era I's morning to a pink sunset with the windows lit,
// Era II's golden hour to blue dusk, Era III's stormy dusk to night, Era IV's
// night to deeper night.

/** The parts of an era's look that drift through its day. */
export interface EraLight {
  sun: {
    color: number;
    intensity: number;
    /** Degrees above the horizon. */
    elevation: number;
    /** Degrees around the island, 0 = from the camera side. */
    azimuth: number;
  };
  skyLight: {
    sky: number;
    ground: number;
    intensity: number;
  };
  /** Sky gradient, from the horizon (where the far sea fades into `bottom` too) to overhead. */
  sky: {
    top: number;
    bottom: number;
  };
  fog: {
    color: number;
    density: number;
  };
  water: {
    shallow: number;
    deep: number;
  };
  bloom: number;
}

export interface EraPreset {
  id: EraId;
  name: string;
  /** GDD palette slots. */
  palette: {
    base: number;
    roof: number;
    accent: number;
    water: number;
    emissive: number;
  };
  /** Island ground layers. */
  island: {
    grass: number;
    sand: number;
    rock: number;
  };
  roughness: number;
  /** Emissive toggle: windows glow instead of reading as dark glass. */
  litWindows: boolean;
  /** Gear animation toggle: bridges carry a turning cog (Overclock eras). */
  gears: boolean;
  /** GDD §6 ambient particle system. */
  ambient: 'gulls' | 'embers' | 'steam' | 'motes';
  sun: {
    color: number;
    intensity: number;
    /** Degrees above the horizon. */
    elevation: number;
    /** Degrees around the island, 0 = from the camera side. */
    azimuth: number;
  };
  skyLight: {
    sky: number;
    ground: number;
    intensity: number;
  };
  /** Sky gradient, from just above the horizon to overhead, and the Astral aurora (render/sky.ts). */
  sky: {
    top: number;
    bottom: number;
    /** Aurora curtains above the horizon, near color then far, or null. */
    aurora: readonly [number, number] | null;
  };
  /**
   * Densities are tuned for the post-processed look (render/post.ts), which
   * fogs before tone mapping; three's straight-to-screen path (Low quality)
   * fogs after it and reads a little clearer.
   */
  fog: {
    color: number;
    density: number;
  };
  ocean: {
    shallow: number;
    deep: number;
    foam: number;
    waveSpeed: number;
    waveHeight: number;
    roughness: number;
    /** 0..1 strength of stars twinkling in the water (and in the sky). */
    stars: number;
  };
  /** Lighthouse beam strength (additive). */
  beams: number;
  /** Bloom strength on lit windows, lamps and the crystal (render/post.ts). */
  bloom: number;
  /** Root key for drop notes, chords and the background music. */
  music: {
    /** MIDI note number of the tonic. */
    root: number;
    /** Pentatonic flavor. */
    scale: 'major' | 'minor';
  };
  /** Ambient bed under the music, 0..1 per layer (audio/sound.ts). */
  soundscape: {
    waves: number;
    wind: number;
  };
  /** Scenery on open ground (render/island-view.ts) and the island's life (render/life.ts). */
  flora: {
    leaf: number;
    trunk: number;
    /** Flowers, and the paint on awnings, washing, boats and clothes. */
    flowers: readonly number[];
    /** Share of trees that are pines rather than round. */
    pines: number;
  };
  /** Fireflies drifting over the island at dusk and night; null by day. */
  fireflies: { color: number; count: number } | null;
  /** Where this era's day drifts to (sun, sky, fog and water ride along; windows light up). */
  evening: EraLight;
}

export const ERA_PRESETS: Readonly<Record<EraId, EraPreset>> = {
  // Morning sun, bleached wood, canvas, turquoise water, gulls.
  ERA_1: {
    id: 'ERA_1',
    name: 'Driftwood Cove',
    palette: { base: 0xe4d8c0, roof: 0x3f8fb3, accent: 0x8a6a4a, water: 0x63d6d2, emissive: 0xffd98a },
    island: { grass: 0x9cc46a, sand: 0xeedcae, rock: 0x8e857a },
    roughness: 0.85,
    litWindows: false,
    gears: false,
    ambient: 'gulls',
    sun: { color: 0xfff0d4, intensity: 2.6, elevation: 38, azimuth: 35 },
    skyLight: { sky: 0xcfe8ff, ground: 0xe8d3a8, intensity: 1.15 },
    sky: { top: 0x7cc3ea, bottom: 0xf7e9cc, aurora: null },
    fog: { color: 0xeee6d2, density: 0.006 },
    ocean: { shallow: 0x35c4bf, deep: 0x16708f, foam: 0xffffff, waveSpeed: 0.6, waveHeight: 0.12, roughness: 0.3, stars: 0 },
    beams: 0.22,
    bloom: 0.35,
    music: { root: 62, scale: 'major' }, // D
    soundscape: { waves: 1, wind: 0.35 },
    flora: { leaf: 0x6aa84f, trunk: 0x7a5a3a, flowers: [0xff8fab, 0xffd84d, 0xffffff, 0xb59cff, 0xff8a5c], pines: 0.3 },
    fireflies: null,
    // A pink sunset, and the windows come on.
    evening: {
      sun: { color: 0xffb58a, intensity: 1.75, elevation: 14, azimuth: 60 },
      skyLight: { sky: 0xa9b9e6, ground: 0xd1a483, intensity: 0.85 },
      sky: { top: 0x5a6fb0, bottom: 0xffb59a },
      fog: { color: 0xf0c4a8, density: 0.006 },
      water: { shallow: 0x2f9fb4, deep: 0x1a5486 },
      bloom: 0.5,
    },
  },
  // Golden hour, stucco, clay roofs, lanterns.
  ERA_2: {
    id: 'ERA_2',
    name: 'Terracotta Bastion',
    palette: { base: 0xf0dcbc, roof: 0xc4573a, accent: 0x7a4b2e, water: 0x56b6c4, emissive: 0xffb347 },
    island: { grass: 0xa9a85e, sand: 0xe8c48c, rock: 0xa07a5c },
    roughness: 0.9,
    litWindows: true,
    gears: false,
    ambient: 'embers',
    // Low enough for long golden shadows, high enough that they stay on the island's doorstep.
    sun: { color: 0xffb46a, intensity: 2.5, elevation: 22, azimuth: -55 },
    // Golden hour: the warmth comes from the low sun; the sky above stays blue,
    // or the water under it goes olive.
    skyLight: { sky: 0xa8c4f0, ground: 0xb08860, intensity: 1.05 },
    sky: { top: 0x4f73b8, bottom: 0xffb26e, aurora: null },
    fog: { color: 0xf7c28e, density: 0.004 },
    ocean: { shallow: 0x2a92c8, deep: 0x16357a, foam: 0xffe6c8, waveSpeed: 0.5, waveHeight: 0.1, roughness: 0.25, stars: 0 },
    beams: 0.2,
    bloom: 0.45,
    music: { root: 57, scale: 'major' }, // A
    soundscape: { waves: 0.8, wind: 0.25 },
    // Olive trees and tall cypresses.
    flora: { leaf: 0x7f9a3e, trunk: 0x6b4a2e, flowers: [0xff7a45, 0xffc53d, 0xe85d75, 0xfff1d6, 0x9b6bd6], pines: 0.5 },
    fireflies: { color: 0xffd27a, count: 10 },
    // Blue dusk.
    evening: {
      sun: { color: 0xff8f60, intensity: 1.5, elevation: 10, azimuth: -60 },
      skyLight: { sky: 0x8090d0, ground: 0x80604c, intensity: 0.85 },
      sky: { top: 0x26346e, bottom: 0xf08a6a },
      fog: { color: 0xc48f86, density: 0.0045 },
      water: { shallow: 0x23699f, deep: 0x0f2357 },
      bloom: 0.6,
    },
  },
  // Stormy dusk, brass, copper, steam vents.
  ERA_3: {
    id: 'ERA_3',
    name: 'Clockwork Foundry',
    palette: { base: 0xcaa25a, roof: 0xb86a3c, accent: 0x4a4440, water: 0x6fa0a8, emissive: 0xff9a3c },
    island: { grass: 0x6a7a58, sand: 0x8f8270, rock: 0x57524f },
    roughness: 0.5,
    litWindows: true,
    gears: true,
    ambient: 'steam',
    sun: { color: 0xdfe4f2, intensity: 2.1, elevation: 26, azimuth: 120 },
    skyLight: { sky: 0xa4abc4, ground: 0x4c443c, intensity: 1.2 },
    // A slate-blue dusk with the last warmth on the horizon, not grey murk:
    // the foundry's lamps are the warm side of the picture.
    sky: { top: 0x1f2a44, bottom: 0x9a7f7a, aurora: null },
    fog: { color: 0x4b5470, density: 0.0105 },
    ocean: { shallow: 0x46707c, deep: 0x1e2e38, foam: 0xd0d4dc, waveSpeed: 1.0, waveHeight: 0.17, roughness: 0.6, stars: 0 },
    beams: 0.12,
    bloom: 0.5,
    music: { root: 59, scale: 'minor' }, // B minor
    soundscape: { waves: 1, wind: 0.8 },
    flora: { leaf: 0x55684a, trunk: 0x4a3e36, flowers: [0xd4a72c, 0xd9774b, 0xa8b8a0, 0xc65a5a], pines: 0.7 },
    fireflies: { color: 0xffb45a, count: 12 },
    // Night, under a cold moon.
    evening: {
      // From behind the camera: a moon in front would glint off every wave facet.
      sun: { color: 0xb9c6ff, intensity: 1.3, elevation: 34, azimuth: 60 },
      skyLight: { sky: 0x707a9a, ground: 0x2c2830, intensity: 0.95 },
      sky: { top: 0x111827, bottom: 0x5e5068 },
      fog: { color: 0x2f3550, density: 0.009 },
      water: { shallow: 0x30515f, deep: 0x111c26 },
      bloom: 0.65,
    },
  },
  // Starfield ocean, obsidian, crystal, aurora.
  ERA_4: {
    id: 'ERA_4',
    name: 'Astral Citadel',
    palette: { base: 0x3a3448, roof: 0x8fd8ff, accent: 0x7a6ab8, water: 0x7be0ff, emissive: 0x9cf6ff },
    island: { grass: 0x37324c, sand: 0x544c72, rock: 0x221f2e },
    roughness: 0.35,
    litWindows: true,
    gears: true,
    ambient: 'motes',
    sun: { color: 0xc4d0ff, intensity: 1.6, elevation: 42, azimuth: 200 },
    skyLight: { sky: 0x7a78c8, ground: 0x1a1430, intensity: 0.95 },
    sky: { top: 0x04051a, bottom: 0x2a1f52, aurora: [0x4dffc0, 0x8a6cff] },
    fog: { color: 0x14102c, density: 0.01 },
    ocean: { shallow: 0x141640, deep: 0x04040e, foam: 0x9cf6ff, waveSpeed: 0.35, waveHeight: 0.06, roughness: 0.9, stars: 1 },
    beams: 0.18,
    bloom: 0.5,
    music: { root: 66, scale: 'major' }, // F#
    soundscape: { waves: 0.5, wind: 0.2 },
    flora: { leaf: 0x5a4c96, trunk: 0x2c2442, flowers: [0x9cf6ff, 0xc3b2ff, 0x7be0ff, 0xffc6f0], pines: 0.5 },
    fireflies: { color: 0xb8fff0, count: 14 },
    // Deeper night.
    evening: {
      sun: { color: 0xa8b4ff, intensity: 1.3, elevation: 42, azimuth: 200 },
      skyLight: { sky: 0x6462b8, ground: 0x120e26, intensity: 0.85 },
      sky: { top: 0x020310, bottom: 0x1f1745 },
      fog: { color: 0x0e0b24, density: 0.01 },
      water: { shallow: 0x10123a, deep: 0x03030c },
      bloom: 0.6,
    },
  },
};
