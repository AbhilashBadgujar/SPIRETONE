import type { EraId } from './ids';

// Per-era look presets (GDD §6 "one data asset each"). Meshes never change
// between eras; only these values do. Particles and music stems join in
// Steps 5 and 9.

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
    sun: { color: 0xfff0d4, intensity: 2.6, elevation: 38, azimuth: 35 },
    skyLight: { sky: 0xcfe8ff, ground: 0xe8d3a8, intensity: 1.15 },
    sky: { top: 0x7cc3ea, bottom: 0xf7e9cc },
    fog: { color: 0xeee6d2, density: 0.012 },
    ocean: { shallow: 0x35c4bf, deep: 0x16708f, foam: 0xffffff, waveSpeed: 0.6, waveHeight: 0.12 },
  },
  // Golden hour, stucco, clay roofs, lanterns.
  ERA_2: {
    id: 'ERA_2',
    name: 'Terracotta Bastion',
    palette: { base: 0xf0dcbc, roof: 0xc4573a, accent: 0x7a4b2e, water: 0x56b6c4, emissive: 0xffb347 },
    island: { grass: 0xb4a35c, sand: 0xe4c38e, rock: 0x9a7b62 },
    roughness: 0.9,
    litWindows: true,
    sun: { color: 0xffb46a, intensity: 2.4, elevation: 16, azimuth: -55 },
    skyLight: { sky: 0xffd2a0, ground: 0xb08860, intensity: 0.9 },
    sky: { top: 0x6a8cc4, bottom: 0xffc27a },
    fog: { color: 0xf2b77e, density: 0.014 },
    ocean: { shallow: 0x2f97a0, deep: 0x1b4c6b, foam: 0xffe6c8, waveSpeed: 0.5, waveHeight: 0.1 },
  },
  // Stormy dusk, brass, copper, steam vents.
  ERA_3: {
    id: 'ERA_3',
    name: 'Clockwork Foundry',
    palette: { base: 0xb8934a, roof: 0xb0683a, accent: 0x3e3a38, water: 0x6fa0a8, emissive: 0xff9a3c },
    island: { grass: 0x5e6b5a, sand: 0x7d7466, rock: 0x4a4646 },
    roughness: 0.55,
    litWindows: true,
    sun: { color: 0xc8d0e0, intensity: 1.5, elevation: 24, azimuth: 120 },
    skyLight: { sky: 0x8a90a8, ground: 0x3a3430, intensity: 0.8 },
    sky: { top: 0x272e3c, bottom: 0x6e6a78 },
    fog: { color: 0x5a5866, density: 0.02 },
    ocean: { shallow: 0x3b5a66, deep: 0x1e2e38, foam: 0xc8ccd4, waveSpeed: 1.0, waveHeight: 0.22 },
  },
  // Starfield ocean, obsidian, crystal, aurora.
  ERA_4: {
    id: 'ERA_4',
    name: 'Astral Citadel',
    palette: { base: 0x2c2836, roof: 0x8fd8ff, accent: 0x6b5ca5, water: 0x7be0ff, emissive: 0x9cf6ff },
    island: { grass: 0x2e2a40, sand: 0x4a4466, rock: 0x1c1a26 },
    roughness: 0.35,
    litWindows: true,
    sun: { color: 0xb8c8ff, intensity: 1.3, elevation: 42, azimuth: 200 },
    skyLight: { sky: 0x6a6ab8, ground: 0x1a1430, intensity: 0.9 },
    sky: { top: 0x060716, bottom: 0x2a1f4a },
    fog: { color: 0x1a1636, density: 0.016 },
    ocean: { shallow: 0x1c1c48, deep: 0x05050f, foam: 0x9cf6ff, waveSpeed: 0.35, waveHeight: 0.08 },
  },
};
