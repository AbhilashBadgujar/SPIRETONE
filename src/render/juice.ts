import { Color, Vector3, type Group } from 'three';
import type { EraPreset } from '../data/eras';
import type { StructureId } from '../data/ids';
import type { Emitter, GameEvents } from '../game/events';
import type { Evaluation } from '../sim/evaluate';
import type { ColumnId, Grid } from '../sim/grid';
import type { Island } from '../sim/island';
import { Beams } from './beams';
import { DROP_FALL_TIME, type IslandView } from './island-view';
import { LAYOUT, columnTopY, columnX, columnZ } from './layout';
import { Particles } from './particles';

// Visual feedback for gameplay events: drop-in animation, landing dust,
// formation sparkles, bridge sparks, lighthouse beams, crystal pulses.
// Everything lands on DROP_FALL_TIME so it lines up with the sound.

/** Seconds between Era IV cascade blocks. Audio uses the same stagger. */
export const CASCADE_STAGGER = 0.12;
const GOLD = 0xffd25e;
/** Cap spark bursts when many bridges form in one drop. */
const MAX_BRIDGE_BURSTS = 4;
/** Sparkle bursts shed while the island rises (one every 0.08 s). */
const ASCEND_SPARKLES = 15;

interface Timer {
  t: number;
  fn: () => void;
}

export class Juice {
  private readonly particles = new Particles();
  private readonly beams: Beams;
  private readonly timers: Timer[] = [];
  private prev: StructureId[];
  private readonly dustColor = new Color();
  private readonly sparkColor = new Color();
  private readonly foamColor = new Color();
  private readonly at = new Vector3();
  private readonly atB = new Vector3();

  constructor(
    private readonly grid: Grid,
    private readonly view: IslandView,
    turntable: Group,
    events: Emitter<GameEvents>,
    private readonly island: () => Island,
  ) {
    this.beams = new Beams(grid.columnCount);
    turntable.add(...this.particles.meshes, this.beams.mesh);
    this.prev = new Array<StructureId>(grid.columnCount).fill('ST_EMPTY');

    events.on('drop', ({ outcome }) => {
      const now = outcome.evaluation.columns.map((col) => col.structure);
      const before = this.prev;
      this.prev = now;
      outcome.placed.forEach((c, i) => {
        const delay = i * CASCADE_STAGGER;
        this.view.dropIn(c, delay);
        this.after(delay + DROP_FALL_TIME, () => this.land(c, before[c] !== now[c] && now[c] !== 'ST_EMPTY'));
      });

      this.after(DROP_FALL_TIME, () => {
        const c = outcome.placed[0];
        if (outcome.newTypes.length) {
          this.view.pulseCrystal(0.6);
          this.particles.sparks.emit({
            origin: this.top(c, this.at),
            count: 30,
            color: GOLD,
            shape: 'sphere',
            speed: [1.5, 3.4],
            size: [0.035, 0.07],
            life: [0.6, 1.1],
            gravity: 2,
          });
        }
        for (const g of outcome.goldenRolled) {
          this.particles.sparks.emit({
            origin: this.top(g, this.at),
            count: 24,
            color: GOLD,
            shape: 'fountain',
            speed: [2, 3.6],
            size: [0.03, 0.06],
            life: [0.7, 1.2],
            gravity: 3,
          });
        }
        for (const e of outcome.newBridges.slice(0, MAX_BRIDGE_BURSTS)) {
          this.particles.sparks.emit({
            origin: this.bridgeMid(e, this.at),
            count: 18,
            color: this.sparkColor,
            shape: 'sphere',
            speed: [1, 2.6],
            size: [0.025, 0.05],
            life: [0.4, 0.8],
            gravity: 4,
          });
        }
        for (const group of outcome.newPlazas) {
          this.at.set(0, 0, 0);
          for (const col of group) this.at.add(this.atB.set(columnX(this.grid, col), 0, columnZ(this.grid, col)));
          this.at.divideScalar(group.length).setY(LAYOUT.groundY + 0.05);
          this.particles.dust.emit({
            origin: this.at,
            count: 26,
            color: this.dustColor,
            shape: 'ring',
            radius: 0.9,
            speed: [1.4, 2.6],
            size: [0.05, 0.09],
            life: [0.45, 0.8],
            gravity: 3,
          });
        }
        for (const l of outcome.newLighthouses) {
          this.particles.sparks.emit({
            origin: this.top(l, this.at),
            count: 26,
            color: this.sparkColor,
            shape: 'fountain',
            speed: [2.5, 4.5],
            size: [0.03, 0.06],
            life: [0.6, 1],
            gravity: 2.5,
          });
        }
      });
    });

    // Rising island sheds gold from its columns, riding the island's lift.
    events.on('ascendStart', () => {
      this.view.pulseCrystal(0.9);
      for (let i = 0; i < ASCEND_SPARKLES; i++) {
        this.after(i * 0.08, () => {
          const island = this.island();
          const built = island.heights.flatMap((h, c) => (h > 0 ? [c] : []));
          if (built.length === 0) return;
          const c = built[Math.floor(Math.random() * built.length)];
          this.top(c, this.at).y += this.view.root.position.y;
          this.particles.sparks.emit({
            origin: this.at,
            count: 8,
            color: GOLD,
            shape: 'fountain',
            speed: [1.5, 3.2],
            size: [0.03, 0.06],
            life: [0.6, 1],
            gravity: -1,
          });
        });
      }
    });

    // The new island hits the water: a splash ring round the rim and a crystal flare.
    events.on('buy', () => this.view.pulseCrystal(0.5));

    events.on('ascendLand', () => {
      this.view.pulseCrystal(0.7);
      this.particles.dust.emit({
        origin: this.at.set(0, LAYOUT.waterLevel + 0.1, 0),
        count: 60,
        color: this.foamColor,
        shape: 'ring',
        radius: LAYOUT.islandRadius + 0.2,
        speed: [1.5, 3.2],
        size: [0.06, 0.12],
        life: [0.5, 0.9],
        gravity: 5,
      });
      this.particles.sparks.emit({
        origin: this.at.set(0, 2.3, 0),
        count: 40,
        color: GOLD,
        shape: 'sphere',
        speed: [1.5, 3.5],
        size: [0.04, 0.07],
        life: [0.7, 1.2],
        gravity: 1.5,
      });
    });
  }

  /** Seed the per-column structure history (new game, loaded or demo island). */
  reset(ev: Evaluation): void {
    this.prev = ev.columns.map((col) => col.structure);
  }

  applyPreset(p: EraPreset): void {
    this.dustColor.setHex(p.island.sand).lerp(new Color(p.palette.base), 0.4);
    this.sparkColor.setHex(p.palette.emissive);
    this.foamColor.setHex(p.ocean.foam);
    this.beams.setColor(p.palette.emissive);
  }

  update(dt: number, time: number): void {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const timer = this.timers[i];
      timer.t -= dt;
      if (timer.t <= 0) {
        this.timers.splice(i, 1);
        timer.fn();
      }
    }
    this.particles.update(dt);
    this.beams.update(time, this.view.lampPoints);
  }

  private after(seconds: number, fn: () => void): void {
    this.timers.push({ t: seconds, fn });
  }

  /** Dust where the block landed; a sparkle on top if the column changed type. */
  private land(c: ColumnId, transformed: boolean): void {
    const island = this.island();
    const h = island.heights[c];
    const base = island.inPlaza[c] ? LAYOUT.groundY : columnTopY(Math.max(0, h - 1));
    this.particles.dust.emit({
      origin: this.at.set(columnX(this.grid, c), base + 0.02, columnZ(this.grid, c)),
      count: 10,
      color: this.dustColor,
      shape: 'ring',
      radius: 0.38,
      speed: [1.1, 2.1],
      size: [0.035, 0.07],
      life: [0.35, 0.6],
      gravity: 4,
    });
    this.view.pulseCrystal(0.12);
    if (!transformed) return;
    this.particles.sparks.emit({
      origin: this.top(c, this.at),
      count: 14,
      color: this.sparkColor,
      shape: 'fountain',
      speed: [1.5, 3],
      size: [0.025, 0.05],
      life: [0.5, 0.9],
      gravity: 3,
    });
  }

  private top(c: ColumnId, out: Vector3): Vector3 {
    const island = this.island();
    const y = island.inPlaza[c] ? LAYOUT.groundY + LAYOUT.plazaHeight : columnTopY(island.heights[c]);
    return out.set(columnX(this.grid, c), y + 0.2, columnZ(this.grid, c));
  }

  /** Midpoint of a bridge deck (mirrors IslandView's bridge placement). */
  private bridgeMid(edgeId: number, out: Vector3): Vector3 {
    const { a, b } = this.grid.edges[edgeId];
    const { heights } = this.island();
    const floor = Math.min(heights[a], heights[b]) - 1;
    return out.set(
      (columnX(this.grid, a) + columnX(this.grid, b)) / 2,
      LAYOUT.groundY + floor * LAYOUT.blockHeight + 0.2,
      (columnZ(this.grid, a) + columnZ(this.grid, b)) / 2,
    );
  }
}
