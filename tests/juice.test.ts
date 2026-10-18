import { describe, expect, it } from 'vitest';
import { PAD_CHORDS, degreeToMidi, dropNote } from '../src/audio/sound';
import { ERA_PRESETS } from '../src/data/eras';
import { DROP_FALL_TIME, DROP_TOTAL_TIME, dropPose } from '../src/render/island-view';

const D_MAJOR = { root: 62, scale: 'major' } as const;

describe('drop notes', () => {
  it('walks the pentatonic scale', () => {
    expect([0, 1, 2, 3, 4, 5].map((d) => degreeToMidi(d, D_MAJOR))).toEqual([62, 64, 66, 69, 71, 74]);
    expect(degreeToMidi(0, { root: 59, scale: 'minor' }, -12)).toBe(47);
  });

  it('rises with height and sits inner rings above outer', () => {
    expect(dropNote(1, 2, 3, D_MAJOR)).toBe(62); // pier
    expect(dropNote(1, 0, 3, D_MAJOR)).toBe(66); // inner cottage
    expect(dropNote(3, 0, 3, D_MAJOR)).toBeGreaterThan(dropNote(2, 0, 3, D_MAJOR));
  });

  it('stays in key and within two octaves for every reachable column, every era', () => {
    for (const { music } of Object.values(ERA_PRESETS)) {
      const scale = music.scale === 'major' ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10];
      for (let h = 1; h <= 8; h++) {
        for (let r = 0; r < 3; r++) {
          const n = dropNote(h, r, 3, music);
          expect(scale).toContain((((n - music.root) % 12) + 12) % 12);
          expect(n - music.root).toBeLessThan(24);
        }
      }
    }
  });

  it('keeps the background pad chords in key, so drops never clash with them', () => {
    const scales = { major: [0, 2, 4, 7, 9], minor: [0, 3, 5, 7, 10] };
    for (const scale of ['major', 'minor'] as const) {
      for (const chord of PAD_CHORDS[scale]) {
        for (const s of chord) expect(scales[scale], `${scale} ${chord}`).toContain(((s % 12) + 12) % 12);
      }
    }
  });
});

describe('drop animation', () => {
  it('starts high, lands squashed at DROP_FALL_TIME, settles back to rest', () => {
    expect(dropPose(-0.1)).toBeNull();
    expect(dropPose(0)!.dy).toBeGreaterThan(2);
    const landed = dropPose(DROP_FALL_TIME)!;
    expect(landed.dy).toBe(0);
    expect(landed.sy).toBeLessThan(0.8);
    const end = dropPose(DROP_TOTAL_TIME)!;
    expect(end.dy).toBe(0);
    expect(Math.abs(end.sy - 1)).toBeLessThan(0.02);
  });
});
