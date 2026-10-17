import { DoubleSide, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import type { EraPreset } from '../data/eras';
import { gullGeometry } from './gulls';
import { LAYOUT } from './layout';
import { blockGeometry } from './meshes';

// Worker Gulls (GDD §8). Each owned Gull circles low around the island in
// turntable space. When the flock drops a block, the nearest idle bird
// swoops to the column with the block hanging under it, lets go exactly
// where the drop animation starts its fall, and climbs back to its circle.
//
// The sim has already placed the block by then; the drop event's `delay`
// keeps the view, sound and HUD waiting for the release.

/** Seconds from dispatch to release. */
export const DELIVER_TIME = 0.9;
const RETURN_TIME = 1.2;
export const MAX_WORKERS = 5;
const CIRCLE_RADIUS = LAYOUT.islandRadius + 0.5;
const CIRCLE_SPEED = 0.42;
/** Workers are drawn bigger than the ambient gulls: they carry blocks. */
const BIRD_SCALE = 1.45;
/** Gap between a bird and the top of the block it carries. */
const CARRY_GAP = 0.32;

type Mode = 'circle' | 'deliver' | 'return';

export interface Worker {
  phase: number;
  height: number;
  mode: Mode;
  /** Seconds into the current flight. */
  t: number;
  from: Vector3;
  ctrl: Vector3;
  to: Vector3;
  pos: Vector3;
  prev: Vector3;
  /** Heading, kept when the bird stands still for a frame. */
  yaw: number;
  /** Yaw of the carried block, matching its column so the release doesn't snap. */
  blockYaw: number;
  carrying: boolean;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _qBank = new Quaternion();
const _s = new Vector3();
const _v = new Vector3();
const _p = new Vector3();
const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

/** Point u (0..1) along the quadratic Bézier a → c bending toward b. */
export function bezier(a: Vector3, b: Vector3, c: Vector3, u: number, out: Vector3): Vector3 {
  const v = 1 - u;
  return out.set(
    v * v * a.x + 2 * v * u * b.x + u * u * c.x,
    v * v * a.y + 2 * v * u * b.y + u * u * c.y,
    v * v * a.z + 2 * v * u * b.z + u * u * c.z,
  );
}

/** Ease in and out, so birds accelerate off their circle and brake into the drop. */
export function swoop(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

export class Flock {
  readonly birds: InstancedMesh;
  readonly blocks: InstancedMesh;
  readonly workers: Worker[];
  private count = 0;
  private readonly blockMaterial = new MeshStandardMaterial({ flatShading: true, roughness: 0.85 });

  constructor() {
    this.workers = Array.from({ length: MAX_WORKERS }, (_, i) => ({
      phase: (i / MAX_WORKERS) * Math.PI * 2,
      height: 2.3 + (i % 3) * 0.35,
      mode: 'circle' as Mode,
      t: 0,
      from: new Vector3(),
      ctrl: new Vector3(),
      to: new Vector3(),
      pos: new Vector3(),
      prev: new Vector3(),
      yaw: 0,
      blockYaw: 0,
      carrying: false,
    }));
    const material = new MeshStandardMaterial({ color: 0xf8f8f4, flatShading: true, roughness: 0.8, side: DoubleSide });
    this.birds = new InstancedMesh(gullGeometry(), material, MAX_WORKERS);
    this.blocks = new InstancedMesh(blockGeometry(), this.blockMaterial, MAX_WORKERS);
    for (const mesh of [this.birds, this.blocks]) {
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
    }
  }

  get size(): number {
    return this.count;
  }

  /** Show one bird per owned Gull. New birds join the circle where they belong. */
  setCount(n: number, time: number): void {
    const next = Math.max(0, Math.min(MAX_WORKERS, n));
    for (let i = this.count; i < next; i++) {
      const w = this.workers[i];
      w.mode = 'circle';
      w.carrying = false;
      this.circleAt(w, time, w.pos);
      w.prev.copy(w.pos);
    }
    this.count = next;
    this.birds.count = next;
    this.blocks.count = next;
  }

  applyPreset(p: EraPreset): void {
    this.blockMaterial.color.setHex(p.palette.base);
  }

  /**
   * Send the nearest idle bird to drop a block whose base should start its
   * fall at `blockBase`. Returns seconds until it lets go, or null when every
   * bird is busy (the block then falls on its own).
   */
  dispatch(blockBase: Vector3, blockYaw: number): number | null {
    let best: Worker | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < this.count; i++) {
      const w = this.workers[i];
      if (w.mode !== 'circle') continue;
      const d = w.pos.distanceToSquared(blockBase);
      if (d < bestDist) {
        bestDist = d;
        best = w;
      }
    }
    if (!best) return null;
    best.mode = 'deliver';
    best.t = 0;
    best.carrying = true;
    best.blockYaw = blockYaw;
    best.from.copy(best.pos);
    best.to.set(blockBase.x, blockBase.y + LAYOUT.blockHeight + CARRY_GAP, blockBase.z);
    // Arc over the midpoint, a little above the higher end.
    best.ctrl.copy(best.from).lerp(best.to, 0.5);
    best.ctrl.y = Math.max(best.from.y, best.to.y) + 0.9;
    return DELIVER_TIME;
  }

  /** Every carrier lets go where it is and heads home. */
  recall(): void {
    for (let i = 0; i < this.count; i++) {
      const w = this.workers[i];
      if (w.mode !== 'deliver') continue;
      w.carrying = false;
      this.startReturn(w);
    }
  }

  update(dt: number, time: number): void {
    for (let i = 0; i < this.count; i++) {
      const w = this.workers[i];
      w.prev.copy(w.pos);
      w.t += dt;
      if (w.mode === 'deliver') {
        bezier(w.from, w.ctrl, w.to, swoop(w.t / DELIVER_TIME), w.pos);
        if (w.t >= DELIVER_TIME) {
          w.carrying = false;
          this.startReturn(w);
        }
      } else if (w.mode === 'return') {
        // The circle keeps moving, so aim at where the bird's slot is now.
        bezier(w.from, w.ctrl, this.circleAt(w, time, _p), swoop(w.t / RETURN_TIME), w.pos);
        if (w.t >= RETURN_TIME) w.mode = 'circle';
      } else {
        this.circleAt(w, time, w.pos);
      }
      this.pose(i, w, time);
    }
    this.birds.instanceMatrix.needsUpdate = true;
    this.blocks.instanceMatrix.needsUpdate = true;
  }

  /** Climb back out over the rim from wherever the bird is. */
  private startReturn(w: Worker): void {
    w.mode = 'return';
    w.t = 0;
    w.from.copy(w.pos);
    _v.set(w.pos.x, 0, w.pos.z).normalize();
    w.ctrl.copy(w.pos).addScaledVector(_v, 1.4);
    w.ctrl.y += 1.1;
  }

  private circleAt(w: Worker, time: number, out: Vector3): Vector3 {
    const a = w.phase + time * CIRCLE_SPEED;
    return out.set(
      Math.sin(a) * CIRCLE_RADIUS,
      w.height + Math.sin(time * 0.9 + w.phase) * 0.15,
      Math.cos(a) * CIRCLE_RADIUS,
    );
  }

  private pose(i: number, w: Worker, time: number): void {
    _v.subVectors(w.pos, w.prev);
    if (Math.hypot(_v.x, _v.z) > 1e-5) w.yaw = Math.atan2(_v.x, _v.z);
    _q.setFromAxisAngle(UP, w.yaw);
    // Bank on the circle; level out to carry.
    _qBank.setFromAxisAngle(FORWARD, w.mode === 'circle' ? -0.22 : 0);
    _q.multiply(_qBank);
    // Busy birds beat their wings hard; circling ones glide between bursts.
    const flap =
      w.mode === 'circle'
        ? 1 + 1.3 * Math.max(0, Math.sin(time * 0.6 + w.phase)) * Math.sin(time * 9 + w.phase * 3)
        : 1 + 1.1 * Math.sin(time * 13 + w.phase * 3);
    _s.set(BIRD_SCALE, BIRD_SCALE * flap, BIRD_SCALE);
    this.birds.setMatrixAt(i, _m.compose(w.pos, _q, _s));

    if (!w.carrying) {
      this.blocks.setMatrixAt(i, HIDDEN);
      return;
    }
    _p.set(w.pos.x, w.pos.y - CARRY_GAP - LAYOUT.blockHeight, w.pos.z);
    _q.setFromAxisAngle(UP, w.blockYaw);
    this.blocks.setMatrixAt(i, _m.compose(_p, _q, _s.set(1, 1, 1)));
  }
}
