import { describe, expect, it } from 'vitest';
import { CASCADE_MIN_ERA, MODIFIER_MIN_ERA } from '../src/data/constants';
import { ERA_PRESETS } from '../src/data/eras';
import { ERA_IDS, type EraIndex } from '../src/data/ids';
import { evaluate, NO_BONUSES } from '../src/sim/evaluate';
import { Ambience } from '../src/render/ambience';
import { grid, islandWith } from './helpers';

describe('GDD §6 era presets', () => {
  it('give each era its own ambient particle system', () => {
    expect(ERA_IDS.map((id) => ERA_PRESETS[id].ambient)).toEqual(['gulls', 'embers', 'steam', 'motes']);
  });

  it('turn bridge gears on exactly where Overclock applies', () => {
    ERA_IDS.forEach((id, era) => expect(ERA_PRESETS[id].gears, id).toBe(era >= MODIFIER_MIN_ERA.MOD_OVERCLOCK));
  });

  it('send fireflies out only after dark, from golden hour on', () => {
    expect(ERA_IDS.map((id) => ERA_PRESETS[id].fireflies !== null)).toEqual([false, true, true, true]);
  });

  it('keep the starfield ocean and aurora to the Astral era', () => {
    ERA_IDS.forEach((id, era) => {
      const astral = era >= CASCADE_MIN_ERA;
      expect(ERA_PRESETS[id].ocean.stars > 0, id).toBe(astral);
      expect(ERA_PRESETS[id].ocean.aurora !== null, id).toBe(astral);
    });
  });
});

describe('ambience', () => {
  const run = (era: EraIndex, cells: Record<string, number>) => {
    const island = islandWith(era, cells);
    const ev = evaluate(grid, island, NO_BONUSES);
    const a = new Ambience(grid, () => island, () => ev);
    a.applyPreset(ERA_PRESETS[ERA_IDS[era]]);
    a.update(1);
    return a.particles.dust.alive + a.particles.sparks.alive;
  };

  it('stays quiet in Era I, where the gulls are the ambience', () => {
    expect(run(0, { '0,0': 2 })).toBe(0);
  });

  it('emits embers, steam and motes in the later eras', () => {
    for (const era of [1, 2, 3] as const) expect(run(era, { '0,0': 3, '0,1': 4 }), `era ${era}`).toBeGreaterThan(0);
  });

  it('needs nothing built for Era IV motes', () => {
    expect(run(3, {})).toBeGreaterThan(0);
  });
});
