import { Vector3 } from 'three';
import { ERA_PRESETS, type EraPreset } from '../data/eras';
import { ERA_IDS } from '../data/ids';
import { ASCENSION } from '../game/ascension';
import type { Game } from '../game/game';
import { CASCADE_STAGGER } from '../render/juice';
import { DROP_FALL_TIME } from '../render/island-view';
import type { ColumnId } from '../sim/grid';

// Synthesized sound: every drop is a plucked note in the era's root key,
// so building plays a melody. No samples; everything is WebAudio.
//
// Pitch rises with height: degree = 2 × (height − 1) + (outer rings sit
// lower), walked up a pentatonic scale so any sequence stays consonant.
//
// Under the drops: the sea and the wind (the bed), and slow background
// music in the same key, a pad with a music box picking out its chords.
//
// Plucks and chirps (the tonal bus) and the music go to the master both dry
// and through a shared warm reverb; the bed, thuds, bonks and whoosh go dry.
// The master carries mute and the pause-menu duck.

const SCALES = { major: [0, 2, 4, 7, 9], minor: [0, 3, 5, 7, 10] } as const;
const MASTER = 0.55;
/** Master level while the pause menu is open, relative to MASTER: the sea keeps breathing, quietly. */
const MENU_DUCK = 0.35;
const MUTE_KEY = 'spiretone.muted';
/** Seconds between gull calls, however busy the flock is. */
const CHIRP_GAP = 2.5;

/** A dark, gently decaying room. */
const REVERB = { seconds: 2.6, decay: 3, level: 0.3 };
/** How much of each bus reaches the reverb. */
const TONAL_SEND = 0.45;
const MUSIC_SEND = 0.8;

/** Bed levels at a soundscape value of 1 (eras.ts). */
const WAVES_LEVEL = 0.55;
const WIND_LEVEL = 0.35;
/** Seconds of looped noise under the bed: long enough that the loop never shows. */
const BED_NOISE = 6;
/** Time constant of bed and music level changes. */
const FADE = 1.5;

/** Background music: 48 bpm, four beats to a chord. */
const BEAT = 1.25;
const BAR_BEATS = 4;
/** Scheduled this far ahead of the audio clock. */
const LOOKAHEAD = 0.3;
/** Seconds after the first gesture before the music comes in. */
const MUSIC_DELAY = 2;
const PAD = { gain: 0.026, attack: 1.6, release: 2.4, cutoff: 900 };
/** Music box: a soft note on about this share of beats, now and then off the beat. */
const BOX = { gain: 0.04, chance: 0.4, offbeat: 0.3 };
/** Music level while an Ascension plays over it. */
const MUSIC_DUCKED = 0.3;

/**
 * Pad chords, in semitones from the root, one per bar. Every tone sits in
 * the era's pentatonic scale, so drops, music box and pad never clash.
 */
export const PAD_CHORDS = {
  major: [
    [0, 4, 7],
    [-3, 0, 4],
    [-5, 2, 9],
    [-8, -5, 0],
  ],
  minor: [
    [0, 3, 7],
    [-2, 3, 5],
    [-9, -5, -2],
    [-7, 0, 3],
  ],
} as const;

type Music = EraPreset['music'];

/** Pentatonic scale degree → MIDI note in `music`'s key. */
export function degreeToMidi(degree: number, music: Music, octaveShift = 0): number {
  const steps = SCALES[music.scale];
  const octave = Math.floor(degree / steps.length);
  return music.root + octaveShift + 12 * octave + steps[((degree % steps.length) + steps.length) % steps.length];
}

/** The note a drop plays: higher for taller columns, inner rings a step above outer. */
export function dropNote(height: number, ring: number, rings: number, music: Music): number {
  let degree = 2 * (Math.max(1, height) - 1) + (rings - 1 - ring);
  // Fold very tall columns back into a two-octave band.
  if (degree > 9) degree = 5 + ((degree - 5) % 5);
  return degreeToMidi(degree, music);
}

const _v = new Vector3();
const _screen = { x: 0, y: 0 };

export class Sound {
  /** For tests: drop and event notes scheduled since load (not the background music). */
  readonly stats = { notes: 0 };

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Plucks and chirps: dry to master, and into the reverb. */
  private tonal: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private bed: { waves: GainNode; wind: GainNode } | null = null;
  private noise: AudioBuffer | null = null;
  private charge: { osc: OscillatorNode; gain: GainNode } | null = null;
  private mutedFlag = readMuted();
  private menuOpen = false;
  private lastChirp = -Infinity;
  /** A new era arrived at the peak; its fanfare plays when the sequence ends. */
  private eraPending = false;
  /** Era whose soundscape the bed is set to. */
  private bedEra = -1;
  /** Audio-clock time of the next music beat, and its count. */
  private nextBeat = 0;
  private beat = 0;

  constructor(private readonly game: Game) {
    // Browsers only allow audio after a gesture. Capture phase runs this
    // before the same gesture's drop handler, so the first drop is audible.
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
    this.listen();
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  toggleMute(): void {
    this.mutedFlag = !this.mutedFlag;
    try {
      localStorage.setItem(MUTE_KEY, this.mutedFlag ? '1' : '0');
    } catch {
      // Storage can be unavailable (private mode); muting still works this session.
    }
    this.applyLevel();
  }

  /** Achievement toast: a bright bell, a fifth, then a high sparkle. */
  chime(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    this.arpeggio([3, 5], t, 0.09, 0.2, 12);
    this.arpeggio([6, 7, 8], t + 0.22, 0.04, 0.09, 12);
  }

  /** Per frame: the Ascend charge tone follows the hold; the bed and music run on. */
  update(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.updateBed(ctx);
    this.updateMusic(ctx);
    const p = this.game.ascendProgress;
    if (p > 0 && !this.charge) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      gain.gain.value = 0;
      osc.connect(gain).connect(this.master);
      osc.start();
      this.charge = { osc, gain };
    }
    if (!this.charge) return;
    if (p <= 0) {
      const { osc, gain } = this.charge;
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
      osc.stop(ctx.currentTime + 0.3);
      this.charge = null;
      return;
    }
    const root = midiToHz(this.music().root - 12);
    this.charge.osc.frequency.setTargetAtTime(root * Math.pow(2, p * 1.5), ctx.currentTime, 0.03);
    this.charge.gain.gain.setTargetAtTime(0.03 + 0.09 * p, ctx.currentTime, 0.03);
  }

  private unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = this.level();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    const reverb = ctx.createConvolver();
    reverb.buffer = roomImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = REVERB.level;
    reverb.connect(wet).connect(master);
    const bus = (send: number) => {
      const gain = ctx.createGain();
      const toReverb = ctx.createGain();
      toReverb.gain.value = send;
      gain.connect(master);
      gain.connect(toReverb).connect(reverb);
      return gain;
    };
    const tonal = bus(TONAL_SEND);
    const music = bus(MUSIC_SEND);
    music.gain.value = 0;

    // White noise: 0.3 s reused for every thud, a longer loop under the bed.
    const noise = whiteNoise(ctx, 0.3);

    this.ctx = ctx;
    this.master = master;
    this.tonal = tonal;
    this.musicBus = music;
    this.noise = noise;
    this.bed = this.startBed(ctx, master);
    this.nextBeat = ctx.currentTime + MUSIC_DELAY;
    music.gain.setTargetAtTime(1, this.nextBeat, FADE);
  }

  /** Master gain for the current mute and menu state. */
  private level(): number {
    if (this.mutedFlag) return 0;
    return this.menuOpen ? MASTER * MENU_DUCK : MASTER;
  }

  private applyLevel(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.08);
  }

  private listen(): void {
    const { events } = this.game;

    events.on('drop', ({ outcome, by, delay }) => {
      const ctx = this.ctx;
      if (!ctx) return;
      const release = ctx.currentTime + delay;
      const t0 = release + DROP_FALL_TIME;
      // Gulls play the same melody a step behind the player's own drops.
      const level = by === 'gull' ? 0.2 : 0.32;
      if (by === 'gull' && release - this.lastChirp > CHIRP_GAP) {
        this.lastChirp = release;
        this.chirp(release - 0.05, this.panFor(outcome.placed[0]));
      }
      outcome.placed.forEach((c, i) => {
        const when = t0 + i * CASCADE_STAGGER;
        const pan = this.panFor(c);
        this.thud(when, pan);
        this.pluck(this.noteFor(c), when, level, pan);
      });
      const land = t0 + 0.06;
      if (outcome.newTypes.length) this.arpeggio([0, 1, 2, 3], land, 0.07, 0.22);
      if (outcome.newPlazas.length) this.arpeggio([0, 2, 3], land, 0.05, 0.18);
      if (outcome.newBridges.length) this.arpeggio([2, 4], land + 0.05, 0.09, 0.16);
      if (outcome.newLighthouses.length) this.arpeggio([3, 4, 5], land, 0.08, 0.2);
      if (outcome.goldenRolled.length) this.arpeggio([5, 6, 7, 8], land, 0.05, 0.14);
    });

    events.on('reject', () => this.bonk(0));
    events.on('ascendBlocked', () => {
      this.bonk(0);
      this.bonk(0.14);
    });
    // The pause menu turns everything down rather than off; the tree screen
    // keeps sound on, since buying has its own chords.
    events.on('pause', ({ reason }) => {
      // Set either way: the menu can hand straight over to the tree screen.
      this.menuOpen = reason === 'menu';
      this.applyLevel();
      const ctx = this.ctx;
      if (reason !== 'menu' && ctx) this.arpeggio([2, 3], ctx.currentTime + 0.01, 0.06, 0.1);
    });
    events.on('resume', () => {
      this.menuOpen = false;
      this.applyLevel();
      if (!document.hidden) void this.ctx?.resume();
    });
    events.on('buy', () => {
      const ctx = this.ctx;
      if (!ctx) return;
      // A chord rolled up, its root an octave down underneath.
      this.arpeggio([0, 1, 2, 3, 4], ctx.currentTime + 0.01, 0.045, 0.2);
      this.arpeggio([0], ctx.currentTime + 0.01, 0, 0.2, -12);
    });
    events.on('buyFail', () => this.bonk(0));
    events.on('ascendStart', () => {
      this.whoosh(ASCENSION.rise);
      this.setMusicLevel(MUSIC_DUCKED);
    });
    events.on('ascend', () => {
      const ctx = this.ctx;
      if (!ctx) return;
      this.arpeggio([0, 2, 3, 4, 5, 6], ctx.currentTime + 0.02, 0.06, 0.24);
      this.arpeggio([0, 3], ctx.currentTime + 0.02, 0, 0.18, -12);
    });
    events.on('era', () => (this.eraPending = true));
    // Lands with the era card, after the Shards card has flown (ui/ceremony.ts).
    events.on('ascendEnd', () => {
      const ctx = this.ctx;
      if (!ctx) return;
      // The music starts over from its first chord, in the new island's key.
      this.beat = 0;
      this.nextBeat = ctx.currentTime + 1.5;
      this.setMusicLevel(1);
      if (!this.eraPending) return;
      this.eraPending = false;
      const t = ctx.currentTime + 0.75;
      this.arpeggio([0, 1, 2, 3, 4, 5, 6, 7], t, 0.07, 0.2);
      this.arpeggio([0, 2, 3], t, 0, 0.16, -12);
      this.arpeggio([0], t, 0, 0.22, -24);
    });
    events.on('ascendLand', () => {
      const ctx = this.ctx;
      if (!ctx) return;
      this.thud(ctx.currentTime, 0);
      this.thud(ctx.currentTime + 0.01, 0);
      this.pluck(degreeToMidi(0, this.music(), -12), ctx.currentTime, 0.3, 0);
    });
  }

  private setMusicLevel(level: number): void {
    if (this.ctx && this.musicBus) this.musicBus.gain.setTargetAtTime(level, this.ctx.currentTime, FADE / 3);
  }

  /**
   * The sea and the wind: looped noise, low-passed into two washes that
   * swell out of step (one each side), and a narrow band of wind whose
   * pitch and strength wander. Levels follow the era (updateBed).
   */
  private startBed(ctx: AudioContext, out: AudioNode): { waves: GainNode; wind: GainNode } {
    const loop = whiteNoise(ctx, BED_NOISE);
    const source = (offset: number) => {
      const src = ctx.createBufferSource();
      src.buffer = loop;
      src.loop = true;
      src.start(ctx.currentTime, offset);
      return src;
    };
    const lfo = (rate: number, depth: number, target: AudioParam) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = rate;
      const amount = ctx.createGain();
      amount.gain.value = depth;
      osc.connect(amount).connect(target);
      osc.start();
    };

    const waves = ctx.createGain();
    waves.gain.value = 0;
    waves.connect(out);
    for (const [pan, rate, offset] of [
      [-0.5, 0.09, 0],
      [0.5, 0.13, BED_NOISE / 2],
    ]) {
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 450;
      lowpass.Q.value = 0.3;
      const swell = ctx.createGain();
      swell.gain.value = 0.5;
      // Each swell brightens as it peaks, like a wave turning over.
      lfo(rate, 0.42, swell.gain);
      lfo(rate, 280, lowpass.frequency);
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      source(offset).connect(lowpass).connect(swell).connect(panner).connect(waves);
    }

    const wind = ctx.createGain();
    wind.gain.value = 0;
    wind.connect(out);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 650;
    band.Q.value = 1.4;
    lfo(0.05, 260, band.frequency);
    const gust = ctx.createGain();
    gust.gain.value = 0.55;
    lfo(0.031, 0.4, gust.gain);
    source(BED_NOISE / 3).connect(band).connect(gust).connect(wind);

    return { waves, wind };
  }

  /** Fade the bed to the current era's soundscape when the era changes. */
  private updateBed(ctx: AudioContext): void {
    const era = this.game.state.run.island.era;
    if (!this.bed || era === this.bedEra) return;
    this.bedEra = era;
    const { soundscape } = ERA_PRESETS[ERA_IDS[era]];
    this.bed.waves.gain.setTargetAtTime(WAVES_LEVEL * soundscape.waves, ctx.currentTime, FADE);
    this.bed.wind.gain.setTargetAtTime(WIND_LEVEL * soundscape.wind, ctx.currentTime, FADE);
  }

  /** Schedule the music's beats just ahead of the audio clock. */
  private updateMusic(ctx: AudioContext): void {
    // After a stall (a long frame, a resumed context), pick up from now rather than catch up.
    if (this.nextBeat < ctx.currentTime - BEAT) this.nextBeat = ctx.currentTime + 0.05;
    while (this.nextBeat < ctx.currentTime + LOOKAHEAD) {
      this.playBeat(this.beat, this.nextBeat);
      this.beat++;
      this.nextBeat += BEAT;
    }
  }

  /** A bar opens on a pad chord; the music box sometimes picks out one of its tones. */
  private playBeat(beat: number, when: number): void {
    const music = this.music();
    const chords = PAD_CHORDS[music.scale];
    const chord = chords[Math.floor(beat / BAR_BEATS) % chords.length];
    if (beat % BAR_BEATS === 0) {
      for (const s of chord) this.pad(music.root - 12 + s, when, BEAT * BAR_BEATS);
    }
    if (Math.random() < BOX.chance) {
      const s = chord[Math.floor(Math.random() * chord.length)];
      const at = when + (Math.random() < BOX.offbeat ? BEAT / 2 : 0);
      this.kalimba(music.root + 12 + s, at, BOX.gain, Math.random() * 0.8 - 0.4, this.musicBus!);
    }
  }

  /** One pad voice: two detuned triangles under a lowpass, swelling in and out slowly. */
  private pad(midi: number, when: number, hold: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const end = when + hold + PAD.release;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(PAD.gain, when + PAD.attack);
    env.gain.setValueAtTime(PAD.gain, when + hold);
    env.gain.linearRampToValueAtTime(0, end);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = PAD.cutoff;
    env.connect(lowpass).connect(this.musicBus);
    for (const cents of [-7, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = midiToHz(midi);
      osc.detune.value = cents;
      osc.connect(env);
      osc.start(when);
      osc.stop(end + 0.05);
    }
  }

  /** Noise swept upward plus a rising sine: the island lifting off. */
  private whoosh(duration: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t0 = ctx.currentTime;
    const end = t0 + duration;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 2.5;
    band.frequency.setValueAtTime(300, t0);
    band.frequency.exponentialRampToValueAtTime(4000, end);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.exponentialRampToValueAtTime(0.22, end - 0.05);
    ng.gain.exponentialRampToValueAtTime(0.0001, end + 0.25);
    src.connect(band).connect(ng).connect(this.master);
    src.start(t0);
    src.stop(end + 0.3);

    const root = midiToHz(this.music().root - 12);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(root, t0);
    osc.frequency.exponentialRampToValueAtTime(root * 4, end);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.12, end - 0.1);
    og.gain.exponentialRampToValueAtTime(0.0001, end + 0.2);
    osc.connect(og).connect(this.master);
    osc.start(t0);
    osc.stop(end + 0.25);
  }

  private music(): Music {
    return ERA_PRESETS[ERA_IDS[this.game.state.run.island.era]].music;
  }

  private noteFor(c: ColumnId): number {
    const { grid, state } = this.game;
    return dropNote(state.run.island.heights[c], grid.ring[c], grid.k.K_RINGS, this.music());
  }

  /** Stereo position from where the column is on screen. */
  private panFor(c: ColumnId): number {
    if (!this.game.project(this.game.columnAnchor(c, _v), _screen)) return 0;
    const w = this.game.stage.renderer.domElement.clientWidth || 1;
    return Math.max(-1, Math.min(1, ((_screen.x / w) * 2 - 1) * 0.6));
  }

  /** `degrees` are pentatonic scale degrees (degreeToMidi): 0-4 span the octave, 5 is the octave above. */
  private arpeggio(degrees: number[], start: number, gap: number, gain: number, octaveShift = 0): void {
    const music = this.music();
    degrees.forEach((d, i) => this.pluck(degreeToMidi(d, music, octaveShift), start + i * gap, gain, 0));
  }

  /** A drop or event note, on the tonal bus. */
  private pluck(midi: number, when: number, gain: number, pan: number): void {
    if (!this.tonal) return;
    this.stats.notes++;
    this.kalimba(midi, when, gain, pan, this.tonal);
  }

  /** Kalimba-ish pluck: sine body, a quick triangle overtone, a faint bell partial. */
  private kalimba(midi: number, when: number, gain: number, pan: number, bus: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const f = midiToHz(midi);
    const end = when + 1.4;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0, when);
    out.gain.linearRampToValueAtTime(gain, when + 0.005);
    out.gain.exponentialRampToValueAtTime(0.0001, end);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3800;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(tone).connect(panner).connect(bus);

    const partial = (type: OscillatorType, mult: number, level: number, decay: number) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(level, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
      osc.connect(g).connect(out);
      osc.start(when);
      osc.stop(end);
    };
    partial('sine', 1, 1, 1.4);
    partial('triangle', 2, 0.25, 0.35);
    partial('sine', 4.01, 0.08, 0.15);
  }

  /** Soft wooden landing: filtered noise plus a falling sine. */
  private thud(when: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.master);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 160;
    band.Q.value = 0.9;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.35, when);
    ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.14);
    src.connect(band).connect(ng).connect(panner);
    src.start(when);
    src.stop(when + 0.16);

    const body = ctx.createOscillator();
    body.frequency.setValueAtTime(110, when);
    body.frequency.exponentialRampToValueAtTime(55, when + 0.12);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.22, when);
    bg.gain.exponentialRampToValueAtTime(0.0001, when + 0.14);
    body.connect(bg).connect(panner);
    body.start(when);
    body.stop(when + 0.16);
  }

  /** A gull's two-note call as it lets go of a block, carrying a little over the water. */
  private chirp(when: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.tonal) return;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.tonal);
    for (const [start, from, to] of [
      [0, 2300, 3100],
      [0.11, 2600, 1900],
    ] as const) {
      const t = when + start;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(to, t + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.035, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      osc.connect(g).connect(panner);
      osc.start(t);
      osc.stop(t + 0.1);
    }
  }

  /** GDD §2: rejected drops get a soft error sound. */
  private bonk(delay: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const when = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(210, when);
    osc.frequency.exponentialRampToValueAtTime(120, when + 0.14);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.18, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.2);
    osc.connect(lp).connect(g).connect(this.master);
    osc.start(when);
    osc.stop(when + 0.22);
  }
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function whiteNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Stereo impulse response: noise, darkened and faded out, so the room sounds warm rather than hissy. */
function roomImpulse(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * REVERB.seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      smooth += 0.3 * (Math.random() * 2 - 1 - smooth);
      data[i] = smooth * Math.pow(1 - i / length, REVERB.decay);
    }
  }
  return buffer;
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
