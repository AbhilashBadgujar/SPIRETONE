import { Color, Vector3 } from 'three';
import type { EraPreset } from '../data/eras';
import type { Evaluation } from '../sim/evaluate';
import type { ColumnId, Grid } from '../sim/grid';
import type { Island } from '../sim/island';
import { LAYOUT, columnTopY, columnX, columnZ } from './layout';
import { Particles } from './particles';

// GDD §6 per-era ambient particles, in turntable space. Era I's gulls are a
// mesh of their own (gulls.ts); the rest are motes from a small pool:
//
//   embers  Era II   drift up from lit columns, most from Beacon columns
//   steam   Era III  puffs from overclocked bridges, tower tops and rim vents
//   motes   Era IV   star motes hanging in the air around the island

type Mode = EraPreset['ambient'];

const EVERY: Record<Mode, number> = { gulls: Infinity, embers: 0.09, steam: 0.1, motes: 0.07 };
const STEAM = 0xdcdde4;
const MOTE_ALT = 0xd2b8ff;

export class Ambience {
  readonly particles = new Particles();
  private mode: Mode = 'gulls';
  private clock = 0;
  private readonly glow = new Color();
  private readonly at = new Vector3();
  private readonly built: ColumnId[] = [];
  private readonly favored: ColumnId[] = [];

  constructor(
    private readonly grid: Grid,
    private readonly island: () => Island,
    private readonly evaluation: () => Evaluation,
  ) {}

  get meshes() {
    return this.particles.meshes;
  }

  applyPreset(p: EraPreset): void {
    this.mode = p.ambient;
    this.glow.setHex(p.palette.emissive);
    this.clock = 0;
  }

  update(dt: number): void {
    this.clock -= dt;
    while (this.clock <= 0) {
      this.clock += EVERY[this.mode];
      if (this.mode === 'embers') this.ember();
      else if (this.mode === 'steam') this.steam();
      else if (this.mode === 'motes') this.mote();
      else break;
    }
    this.particles.update(dt);
  }

  /** Era II: lantern light rising. Beacon columns (next to a Lighthouse) shed most of it. */
  private ember(): void {
    this.collect((c, ev) => ev.columns[c].beacons > 0 || ev.columns[c].structure === 'ST_LIGHTHOUSE');
    const pool = this.favored.length && Math.random() < 0.7 ? this.favored : this.built;
    if (!pool.length) return;
    const c = pool[Math.floor(Math.random() * pool.length)];
    this.columnTop(c, this.at);
    this.at.x += (Math.random() - 0.5) * 0.5;
    this.at.z += (Math.random() - 0.5) * 0.5;
    this.particles.sparks.emit({
      origin: this.at,
      count: 1,
      color: this.glow,
      shape: 'fountain',
      speed: [0.15, 0.45],
      size: [0.022, 0.04],
      life: [1.6, 2.6],
      gravity: -0.25,
    });
  }

  /** Era III: steam from overclocked bridges first, then chimneys, then vents on the rim. */
  private steam(): void {
    const island = this.island();
    const ev = this.evaluation();
    const roll = Math.random();
    const bridges = this.grid.edges.filter((e) => ev.activeBridges[e.id] && ev.columns[e.a].overclock > 0);
    if (bridges.length && roll < 0.45) {
      const e = bridges[Math.floor(Math.random() * bridges.length)];
      const floor = Math.min(island.heights[e.a], island.heights[e.b]) - 1;
      this.at.set(
        (columnX(this.grid, e.a) + columnX(this.grid, e.b)) / 2,
        LAYOUT.groundY + floor * LAYOUT.blockHeight + 0.45,
        (columnZ(this.grid, e.a) + columnZ(this.grid, e.b)) / 2,
      );
    } else if (roll < 0.8) {
      this.collect((c) => island.heights[c] >= 2);
      if (!this.favored.length) return;
      this.columnTop(this.favored[Math.floor(Math.random() * this.favored.length)], this.at);
      this.at.y += 0.35;
    } else {
      const a = Math.random() * Math.PI * 2;
      const r = LAYOUT.islandRadius - 0.4;
      this.at.set(Math.sin(a) * r, LAYOUT.groundY, Math.cos(a) * r);
    }
    this.particles.dust.emit({
      origin: this.at,
      count: 1,
      color: STEAM,
      shape: 'fountain',
      speed: [0.2, 0.5],
      size: [0.14, 0.26],
      life: [1.8, 2.8],
      gravity: -0.35,
    });
  }

  /** Era IV: motes hanging in a shell of air around the island. */
  private mote(): void {
    const a = Math.random() * Math.PI * 2;
    const r = 1.5 + Math.random() * 5.5;
    this.at.set(Math.sin(a) * r, 0.4 + Math.random() * 4.5, Math.cos(a) * r);
    this.particles.sparks.emit({
      origin: this.at,
      count: 1,
      color: Math.random() < 0.7 ? this.glow : MOTE_ALT,
      shape: 'sphere',
      speed: [0.02, 0.12],
      size: [0.018, 0.038],
      life: [2, 3.5],
      gravity: -0.05,
    });
  }

  /** Fills `built` with every built column and `favored` with those passing `test`. */
  private collect(test: (c: ColumnId, ev: Evaluation) => boolean): void {
    const island = this.island();
    const ev = this.evaluation();
    this.built.length = 0;
    this.favored.length = 0;
    for (let c = 0; c < island.heights.length; c++) {
      if (island.heights[c] === 0) continue;
      this.built.push(c);
      if (test(c, ev)) this.favored.push(c);
    }
  }

  private columnTop(c: ColumnId, out: Vector3): Vector3 {
    const island = this.island();
    const y = island.inPlaza[c] ? LAYOUT.groundY + LAYOUT.plazaHeight : columnTopY(island.heights[c]);
    return out.set(columnX(this.grid, c), y + 0.15, columnZ(this.grid, c));
  }
}
