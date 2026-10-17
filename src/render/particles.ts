import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
  type Material,
} from 'three';

// Low-poly particles in turntable space. Each pool is one instanced draw;
// particles fade by shrinking, so no per-instance alpha is needed.

export interface Emit {
  origin: Vector3;
  count: number;
  color: Color | number;
  /** 'ring' sprays outward along the ground, 'fountain' upward in a cone, 'sphere' everywhere. */
  shape: 'ring' | 'fountain' | 'sphere';
  speed: readonly [number, number];
  size: readonly [number, number];
  life: readonly [number, number];
  gravity?: number;
  /** Ring: start this far out from the origin. */
  radius?: number;
}

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _axis = new Vector3();
const _color = new Color();
const _jitter = new Color();

class Pool {
  readonly mesh: InstancedMesh;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly spin: Float32Array;
  private readonly grav: Float32Array;
  private next = 0;
  private live = 0;

  constructor(
    readonly capacity: number,
    material: Material,
  ) {
    this.mesh = new InstancedMesh(new OctahedronGeometry(1, 0), material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.frustumCulled = false;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity).fill(1);
    this.life = new Float32Array(capacity).fill(1);
    this.size = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
  }

  emit(e: Emit): void {
    _color.set(e.color);
    for (let n = 0; n < e.count; n++) {
      // Ring buffer: when full, the oldest particle is recycled.
      const i = this.next;
      this.next = (this.next + 1) % this.capacity;
      const speed = lerp(e.speed, Math.random());
      const a = Math.random() * Math.PI * 2;
      let dx: number;
      let dy: number;
      let dz: number;
      if (e.shape === 'ring') {
        dx = Math.cos(a);
        dz = Math.sin(a);
        dy = 0.25 + Math.random() * 0.35;
      } else if (e.shape === 'fountain') {
        const tilt = Math.random() * 0.7;
        dx = Math.cos(a) * Math.sin(tilt);
        dz = Math.sin(a) * Math.sin(tilt);
        dy = Math.cos(tilt);
      } else {
        const u = Math.random() * 2 - 1;
        const r = Math.sqrt(1 - u * u);
        dx = Math.cos(a) * r;
        dz = Math.sin(a) * r;
        dy = u;
      }
      const r0 = e.radius ?? 0;
      this.pos[i * 3] = e.origin.x + (e.shape === 'ring' ? dx * r0 : 0);
      this.pos[i * 3 + 1] = e.origin.y;
      this.pos[i * 3 + 2] = e.origin.z + (e.shape === 'ring' ? dz * r0 : 0);
      this.vel[i * 3] = dx * speed;
      this.vel[i * 3 + 1] = dy * speed;
      this.vel[i * 3 + 2] = dz * speed;
      this.age[i] = 0;
      this.life[i] = lerp(e.life, Math.random());
      this.size[i] = lerp(e.size, Math.random());
      this.spin[i] = (Math.random() - 0.5) * 12;
      this.grav[i] = e.gravity ?? 6;
      // Small brightness jitter so a burst doesn't read as one flat color.
      this.mesh.setColorAt(i, _jitter.copy(_color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.12));
    }
    this.live = this.capacity;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    if (this.live === 0) return;
    let alive = 0;
    const drag = Math.exp(-1.6 * dt);
    for (let i = 0; i < this.capacity; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const p = this.age[i] / this.life[i];
      if (p >= 1) {
        this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
        continue;
      }
      alive++;
      const j = i * 3;
      this.vel[j] *= drag;
      this.vel[j + 2] *= drag;
      this.vel[j + 1] -= this.grav[i] * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const s = this.size[i] * (1 - p * p);
      _p.set(this.pos[j], this.pos[j + 1], this.pos[j + 2]);
      _q.setFromAxisAngle(_axis.set(0.3, 1, 0.2).normalize(), this.spin[i] * this.age[i]);
      _s.set(s, s, s);
      this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.live = alive;
  }
}

export class Particles {
  /** Lit, for dust and debris. */
  readonly dust = new Pool(240, new MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 }));
  /** Unlit and untonemapped, for sparks and sparkles. */
  readonly sparks = new Pool(320, new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));

  get meshes(): InstancedMesh[] {
    return [this.dust.mesh, this.sparks.mesh];
  }

  update(dt: number): void {
    this.dust.update(dt);
    this.sparks.update(dt);
  }
}

function lerp(range: readonly [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}
