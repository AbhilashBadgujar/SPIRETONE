import type { EraId } from './ids';

// Per-era look presets (GDD §6 "one data asset each"). Meshes never change
// between eras; only these values do.
//
// music.root / music.scale are PLACEHOLDERS: the GDD gives every era a root
// key but doesn't say which. Swap them here.

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
  /** Backdrop gradient. The camera looks down, so it only shows past the ocean's edge. */
  sky: {
    top: number;
    bottom: number;
  };
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
    /** 0..1 strength of stars twinkling in the water. */
    stars: number;
    /** Aurora reflected on the far water, near color then far, or null. */
    aurora: readonly [number, number] | null;
  };
  /** Lighthouse beam strength (additive). */
  beams: number;
  /** Root key for drop notes and chords. */
  music: {
    /** MIDI note number of the tonic. */
    root: number;
    /** Pentatonic flavor. */
    scale: 'major' | 'minor';
  };
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
    sky: { top: 0x7cc3ea, bottom: 0xf7e9cc },
    fog: { color: 0xeee6d2, density: 0.012 },
    ocean: { shallow: 0x35c4bf, deep: 0x16708f, foam: 0xffffff, waveSpeed: 0.6, waveHeight: 0.12, roughness: 0.3, stars: 0, aurora: null },
    beams: 0.22,
    music: { root: 62, scale: 'major' }, // D
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
    sun: { color: 0xffb46a, intensity: 2.5, elevation: 17, azimuth: -55 },
    // Golden hour: the warmth comes from the low sun; the sky above stays blue,
    // or the water under it goes olive.
    skyLight: { sky: 0xa8c4f0, ground: 0xb08860, intensity: 1.05 },
    sky: { top: 0x4f73b8, bottom: 0xffb26e },
    fog: { color: 0xf7c28e, density: 0.0075 },
    ocean: { shallow: 0x2a92c8, deep: 0x16357a, foam: 0xffe6c8, waveSpeed: 0.5, waveHeight: 0.1, roughness: 0.25, stars: 0, aurora: null },
    beams: 0.2,
    music: { root: 57, scale: 'major' }, // A
  },
  // Stormy dusk, brass, copper, steam vents.
  ERA_3: {
    id: 'ERA_3',
    name: 'Clockwork Foundry',
    palette: { base: 0xcaa25a, roof: 0xb86a3c, accent: 0x4a4440, water: 0x6fa0a8, emissive: 0xff9a3c },
    island: { grass: 0x66745e, sand: 0x8a7f6e, rock: 0x55504e },
    roughness: 0.5,
    litWindows: true,
    gears: true,
    ambient: 'steam',
    sun: { color: 0xdfe4f2, intensity: 2.1, elevation: 26, azimuth: 120 },
    skyLight: { sky: 0xa4abc4, ground: 0x4c443c, intensity: 1.2 },
    sky: { top: 0x2a3242, bottom: 0x8a8090 },
    fog: { color: 0x5e6070, density: 0.015 },
    ocean: { shallow: 0x46707c, deep: 0x1e2e38, foam: 0xd0d4dc, waveSpeed: 1.0, waveHeight: 0.22, roughness: 0.35, stars: 0, aurora: null },
    beams: 0.12,
    music: { root: 59, scale: 'minor' }, // B minor
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
    sky: { top: 0x04051a, bottom: 0x2a1f52 },
    fog: { color: 0x14102c, density: 0.01 },
    ocean: { shallow: 0x141640, deep: 0x04040e, foam: 0x9cf6ff, waveSpeed: 0.35, waveHeight: 0.06, roughness: 0.9, stars: 1, aurora: [0x4dffc0, 0x8a6cff] },
    beams: 0.18,
    music: { root: 66, scale: 'major' }, // F#
  },
};
