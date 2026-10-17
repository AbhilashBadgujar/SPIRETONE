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

const SCALES = { major: [0, 2, 4, 7, 9], minor: [0, 3, 5, 7, 10] } as const;
const MASTER = 0.55;
const MUTE_KEY = 'spiretone.muted';

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
  /** For tests: notes scheduled since load. */
  readonly stats = { notes: 0 };

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private charge: { osc: OscillatorNode; gain: GainNode } | null = null;
  private mutedFlag = readMuted();

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
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.mutedFlag ? 0 : MASTER, this.ctx.currentTime, 0.02);
  }

  /** Per frame: the Ascend charge tone follows the hold. */
  update(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
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
    master.gain.value = this.mutedFlag ? 0 : MASTER;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    // 0.3 s of white noise, reused for every thud.
    const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.ctx = ctx;
    this.master = master;
    this.noise = noise;
  }

  private listen(): void {
    const { events } = this.game;

    events.on('drop', ({ outcome }) => {
      const ctx = this.ctx;
      if (!ctx) return;
      const t0 = ctx.currentTime + DROP_FALL_TIME;
      outcome.placed.forEach((c, i) => {
        const when = t0 + i * CASCADE_STAGGER;
        const pan = this.panFor(c);
        this.thud(when, pan);
        this.pluck(this.noteFor(c), when, 0.32, pan);
      });
      const land = t0 + 0.06;
      if (outcome.newTypes.length) this.arpeggio([0, 2, 4, 7], land, 0.07, 0.22);
      if (outcome.newPlazas.length) this.arpeggio([0, 4, 7], land, 0.05, 0.18);
      if (outcome.newBridges.length) this.arpeggio([4, 9], land + 0.05, 0.09, 0.16);
      if (outcome.newLighthouses.length) this.arpeggio([7, 9, 12], land, 0.08, 0.2);
      if (outcome.goldenRolled.length) this.arpeggio([10, 12, 14, 15], land, 0.05, 0.14);
    });

    events.on('reject', () => this.bonk(0));
    events.on('ascendBlocked', () => {
      this.bonk(0);
      this.bonk(0.14);
    });
    // The tree screen keeps sound on: buying has its own chords.
    events.on('pause', ({ reason }) => {
      if (reason === 'menu') {
        void this.ctx?.suspend();
        return;
      }
      const ctx = this.ctx;
      if (ctx) this.arpeggio([4, 7], ctx.currentTime + 0.01, 0.06, 0.1);
    });
    events.on('resume', () => {
      if (!document.hidden) void this.ctx?.resume();
    });
    events.on('buy', () => {
      const ctx = this.ctx;
      if (!ctx) return;
      // A chord rolled up, its root an octave down underneath.
      this.arpeggio([0, 2, 4, 7, 9], ctx.currentTime + 0.01, 0.045, 0.2);
      this.arpeggio([0], ctx.currentTime + 0.01, 0, 0.2, -12);
    });
    events.on('buyFail', () => this.bonk(0));
    events.on('ascendStart', () => this.whoosh(ASCENSION.rise));
    events.on('ascend', () => {
      const ctx = this.ctx;
      if (!ctx) return;
      this.arpeggio([0, 4, 7, 9, 12, 14], ctx.currentTime + 0.02, 0.06, 0.24);
      this.arpeggio([0, 7], ctx.currentTime + 0.02, 0, 0.18, -12);
    });
    events.on('ascendLand', () => {
      const ctx = this.ctx;
      if (!ctx) return;
      this.thud(ctx.currentTime, 0);
      this.thud(ctx.currentTime + 0.01, 0);
      this.pluck(degreeToMidi(0, this.music(), -12), ctx.currentTime, 0.3, 0);
    });
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

  private arpeggio(degrees: number[], start: number, gap: number, gain: number, octaveShift = 0): void {
    const music = this.music();
    degrees.forEach((d, i) => this.pluck(degreeToMidi(d, music, octaveShift), start + i * gap, gain, 0));
  }

  /** Kalimba-ish pluck: sine body, a quick triangle overtone, a faint bell partial. */
  private pluck(midi: number, when: number, gain: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.stats.notes++;
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
    out.connect(tone).connect(panner).connect(this.master);

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

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
