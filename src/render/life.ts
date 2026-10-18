import {
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import type { EraPreset } from '../data/eras';
import { DROP_TOTAL_TIME, type LifeSpots } from './island-view';
import { LAYOUT } from './layout';
import * as M from './meshes';
import type { Ocean } from './ocean';
import { Particles } from './particles';
import { glowScale } from './post';

// The island's life, animated every frame from IslandView's spots:
//
//   villagers  two stroll round the spire from the first moment; then two
//              to a plaza, circling its fountain, and one to most bridges,
//              pacing the deck (not where a cog turns)
//   fishers    stand at the end of some piers, rod out over the water
//   boats      one moored by every pier, riding the ocean's waves
//   smoke      curls from cottage chimneys
//   fireflies  drift and blink over the island in the dusk and night eras
//   fish       now and then one leaps from the sea with a splash
//
// Everything but the fish lives under IslandView's root, so it rises with
// the island in an Ascension. The fish leaps in world space (`sea`).

const MAX_PEOPLE = 32;
const MAX_BOATS = 12;
const MAX_FIREFLIES = 16;
/** Seconds a newcomer takes to appear, after whatever they stand on has landed. */
const ARRIVE = 0.4;
/** The path round the spire, outside its garden (island-view.ts). */
const STROLL_RADIUS = 1.64;
/** Round a plaza's fountain. */
const PLAZA_RADIUS = 0.62;
/** Walking pace, world units per second. */
const PACE = 0.22;
/** Where a moored boat lies, in its pier's frame (+z out to sea, +x along the shore): off the far end, clear of the cliff. */
const MOORING = { x: 0.45, z: 1.62 };
/** Where a fisher stands on the pier deck. */
const FISHER = { x: -0.1, y: 0.13, z: 1.15 };
const SMOKE_EVERY = 0.2;
/** Seconds between fish, at random in this range. */
const FISH_GAP = [3, 8] as const;
const FISH_LEAP = { time: 0.8, length: 1.1, height: 0.6 };

const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac].map((hex) => new Color(hex));

type Path =
  | { kind: 'loop'; x: number; y: number; z: number; radius: number }
  | { kind: 'line'; from: Vector3; to: Vector3 }
  | { kind: 'fish'; x: number; z: number; yaw: number };

interface Walker {
  key: string;
  path: Path;
  /** Loop: angle; line: 0..2 out and back. */
  u: number;
  /** +1 or -1 round a loop. */
  dir: number;
  /** Footsteps taken, for the walking bob. */
  steps: number;
  seed: number;
  born: number;
}

interface Boat {
  key: string;
  x: number;
  z: number;
  yaw: number;
  seed: number;
  born: number;
}

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _tilt = new Quaternion();
const _s = new Vector3();
const _w = new Vector3();
const _c = new Color();
const UP = new Vector3(0, 1, 0);
const ALONG = new Vector3(0, 0, 1);
const ACROSS = new Vector3(1, 0, 0);

/** Instanced parts that share one transform per instance. */
class Crowd {
  readonly meshes: InstancedMesh[];

  constructor(geometries: BufferGeometry[], material: Material, capacity: number, parent: Group) {
    this.meshes = geometries.map((geometry) => {
      const mesh = new InstancedMesh(geometry, material, capacity);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      parent.add(mesh);
      return mesh;
    });
  }

  set count(n: number) {
    for (const mesh of this.meshes) mesh.count = n;
  }

  color(i: number, ...colors: Color[]): void {
    this.meshes.forEach((mesh, p) => mesh.setColorAt(i, colors[p]));
  }

  matrix(i: number, m: Matrix4): void {
    for (const mesh of this.meshes) mesh.setMatrixAt(i, m);
  }

  flush(colors: boolean): void {
    for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (colors && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

export class Life {
  /** Add under IslandView's root. */
  readonly root = new Group();
  /** Add to the scene: world space, for the fish. */
  readonly sea = new Group();

  private readonly material = new MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.85 });
  private readonly people: Crowd;
  private readonly rods: Crowd;
  private readonly boats: Crowd;
  private readonly fireflies: InstancedMesh;
  private readonly fireflyMaterial = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  private readonly fish: Mesh;
  private readonly smoke = new Particles();
  private readonly splashes = new Particles();

  private walkers: Walker[] = [];
  private moored: Boat[] = [];
  private chimneys: Vector3[] = [];
  private preset: EraPreset | null = null;
  private readonly clothes: Color[] = [];
  private readonly smokeColor = new Color();
  private readonly fishColor = new Color();
  private readonly foamColor = new Color();
  private bloom = false;
  private synced = false;
  private time = 0;
  private smokeClock = 0;
  private nextFish: number = FISH_GAP[0];
  private leap: { t: number; x: number; z: number; dx: number; dz: number } | null = null;

  constructor(private readonly ocean: Ocean) {
    this.people = new Crowd([M.personBodyGeometry(), M.personHeadGeometry()], this.material, MAX_PEOPLE, this.root);
    this.rods = new Crowd([M.fishingRodGeometry()], this.material, MAX_PEOPLE, this.root);
    this.boats = new Crowd([M.boatHullGeometry(), M.boatInsideGeometry()], this.material, MAX_BOATS, this.root);
    this.fireflies = new InstancedMesh(M.fireflyGeometry(), this.fireflyMaterial, MAX_FIREFLIES);
    this.fireflies.instanceMatrix.setUsage(DynamicDrawUsage);
    this.fireflies.frustumCulled = false;
    this.fireflies.count = 0;
    this.root.add(this.fireflies, ...this.smoke.meshes);

    this.fish = new Mesh(M.fishGeometry(), new MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.4 }));
    this.fish.visible = false;
    this.sea.add(this.fish, ...this.splashes.meshes);
  }

  applyPreset(p: EraPreset): void {
    this.preset = p;
    this.clothes.length = 0;
    for (const hex of [p.palette.roof, p.palette.accent, ...p.flora.flowers]) this.clothes.push(new Color(hex));
    this.smokeColor.setHex(0xf2efe8).lerp(_c.setHex(p.fog.color), 0.3);
    this.fishColor.setHex(0xb8c8d8).lerp(_c.setHex(p.ocean.foam), 0.3);
    (this.fish.material as MeshStandardMaterial).color.copy(this.fishColor);
    this.foamColor.setHex(p.ocean.foam);
    this.fireflies.count = p.fireflies ? Math.min(MAX_FIREFLIES, p.fireflies.count) : 0;
    this.applyGlow();
  }

  /** People about the island, fishers included. */
  get villagers(): number {
    return this.walkers.length;
  }

  get boatCount(): number {
    return this.moored.length;
  }

  /** Fireflies burn past the bloom threshold while bloom is on (render/post.ts). */
  setBloom(on: boolean): void {
    this.bloom = on;
    this.applyGlow();
  }

  /** Who walks where, after the island changed. Newcomers arrive once what they stand on has landed. */
  sync(spots: LifeSpots): void {
    // A first sync (a new game, a loaded save) fills the island at once.
    const arrive = this.synced ? this.time + DROP_TOTAL_TIME : this.time - ARRIVE;
    this.synced = true;
    const old = new Map(this.walkers.map((w) => [w.key, w]));
    const next: Walker[] = [];
    const add = (key: string, path: Path, seed: number) => {
      if (next.length >= MAX_PEOPLE) return;
      const kept = old.get(key);
      if (kept) {
        kept.path = path;
        next.push(kept);
        return;
      }
      const start = path.kind === 'loop' ? hash(seed * 3.3) * Math.PI * 2 : hash(seed * 3.3) * 2;
      next.push({ key, path, u: start, dir: hash(seed * 7.1) < 0.5 ? 1 : -1, steps: 0, seed, born: arrive });
    };

    const y = LAYOUT.groundY;
    add('g0', { kind: 'loop', x: 0, y, z: 0, radius: STROLL_RADIUS }, 1);
    add('g1', { kind: 'loop', x: 0, y, z: 0, radius: STROLL_RADIUS }, 2);
    spots.plazas.forEach((s, i) => {
      const loop: Path = { kind: 'loop', x: s.x, y: s.y, z: s.z, radius: PLAZA_RADIUS };
      add(`${s.key}a`, loop, 10 + i * 2);
      add(`${s.key}b`, loop, 11 + i * 2);
    });
    for (const s of spots.piers) {
      const seed = 200 + Number(s.key.slice(1));
      if (hash(seed) < 0.5) add(s.key, { kind: 'fish', x: s.x, z: s.z, yaw: s.yaw }, seed);
    }
    for (const s of spots.bridges) {
      const seed = 400 + Number(s.key.slice(1));
      if (!s.busy && hash(seed) < 0.6) add(s.key, { kind: 'line', from: s.from, to: s.to }, seed);
    }
    this.walkers = next;

    const wood = this.clothes[1] ?? _c.setHex(0x7a5a3a);
    let rods = 0;
    next.forEach((w, i) => {
      const clothes = this.clothes[Math.floor(hash(w.seed * 5.9) * this.clothes.length)] ?? _c.setHex(0xffffff);
      this.people.color(i, clothes, SKINS[Math.floor(hash(w.seed * 8.3) * SKINS.length)]);
      if (w.path.kind === 'fish') this.rods.color(rods++, wood);
    });
    this.people.count = next.length;
    this.people.flush(true);
    this.rods.flush(true);

    const boats = new Map(this.moored.map((b) => [b.key, b]));
    this.moored = spots.piers.slice(0, MAX_BOATS).map((s) => {
      const seed = 300 + Number(s.key.slice(1));
      return boats.get(s.key) ?? { key: s.key, x: s.x, z: s.z, yaw: s.yaw, seed, born: arrive };
    });
    this.moored.forEach((b, i) => {
      const paint = this.clothes[2 + Math.floor(hash(b.seed * 4.7) * (this.clothes.length - 2))] ?? this.clothes[0];
      this.boats.color(i, paint, this.clothes[1] ?? paint);
    });
    this.boats.count = this.moored.length;
    this.boats.flush(true);

    this.chimneys = spots.chimneys.map((v) => v.clone());
  }

  /** `calm`: no Ascension running, so fish may leap. */
  update(dt: number, time: number, calm: boolean): void {
    this.time = time;
    this.updatePeople(dt, time);
    this.updateBoats(time);
    this.updateFireflies(time);
    this.updateSmoke(dt);
    this.updateFish(dt, time, calm);
    this.smoke.update(dt);
    this.splashes.update(dt);
  }

  private updatePeople(dt: number, time: number): void {
    let rods = 0;
    this.walkers.forEach((w, i) => {
      const arrived = smoothstep(w.born, w.born + ARRIVE, time);
      // Everyone stops now and then: to chat, to look at the sea.
      const going = smoothstep(-0.25, 0.25, Math.sin(time * 0.21 + w.seed * 5.3));
      let x: number;
      let y: number;
      let z: number;
      let yaw: number;
      const path = w.path;
      if (path.kind === 'loop') {
        w.u += (w.dir * PACE * going * dt) / path.radius;
        x = path.x + Math.sin(w.u) * path.radius;
        z = path.z + Math.cos(w.u) * path.radius;
        y = path.y;
        yaw = w.u + (w.dir * Math.PI) / 2;
      } else if (path.kind === 'line') {
        const length = Math.max(0.01, path.from.distanceTo(path.to));
        w.u = (w.u + (PACE * going * dt) / length) % 2;
        const out = w.u < 1;
        _p.lerpVectors(path.from, path.to, out ? w.u : 2 - w.u);
        x = _p.x;
        y = _p.y;
        z = _p.z;
        yaw = Math.atan2(path.to.x - path.from.x, path.to.z - path.from.z) + (out ? 0 : Math.PI);
      } else {
        // A fisher at the end of the pier, rocking gently on their heels.
        const sin = Math.sin(path.yaw);
        const cos = Math.cos(path.yaw);
        x = path.x + cos * FISHER.x + sin * FISHER.z;
        z = path.z - sin * FISHER.x + cos * FISHER.z;
        y = FISHER.y;
        yaw = path.yaw + Math.sin(time * 0.7 + w.seed) * 0.08;
      }
      if (path.kind !== 'fish') w.steps += going * dt * 9;
      y += Math.abs(Math.sin(w.steps)) * 0.016;
      _q.setFromAxisAngle(UP, yaw);
      _p.set(x, y, z);
      _s.setScalar(Math.max(0.001, arrived));
      _m.compose(_p, _q, _s);
      this.people.matrix(i, _m);
      if (path.kind === 'fish') this.rods.matrix(rods++, _m);
    });
    this.people.flush(false);
    this.rods.count = rods;
    this.rods.flush(false);
  }

  private updateBoats(time: number): void {
    this.moored.forEach((b, i) => {
      const sin = Math.sin(b.yaw);
      const cos = Math.cos(b.yaw);
      const x = b.x + cos * MOORING.x + sin * MOORING.z;
      const z = b.z - sin * MOORING.x + cos * MOORING.z;
      // Ride the actual wave under the boat: sample it in world space (as of the last frame).
      _w.set(x, 0, z).applyMatrix4(this.root.matrixWorld);
      const y = LAYOUT.waterLevel + this.ocean.waveAt(_w.x, _w.z) - 0.03;
      const roll = Math.sin(time * 1.3 + b.seed) * 0.07;
      const pitch = Math.sin(time * 0.9 + b.seed * 2) * 0.05;
      // Bow out to sea, swung a little off the pier on its line.
      _q.setFromAxisAngle(UP, b.yaw + Math.PI + 0.12 + Math.sin(time * 0.3 + b.seed) * 0.06);
      _q.multiply(_tilt.setFromAxisAngle(ALONG, roll));
      _q.multiply(_tilt.setFromAxisAngle(ACROSS, pitch));
      _s.setScalar(Math.max(0.001, smoothstep(b.born, b.born + ARRIVE, time)));
      this.boats.matrix(i, _m.compose(_p.set(x, y, z), _q, _s));
    });
    this.boats.flush(false);
  }

  private updateFireflies(time: number): void {
    const count = this.fireflies.count;
    for (let i = 0; i < count; i++) {
      const a = hash(i * 7.3 + 1) * Math.PI * 2;
      const r = 0.9 + hash(i * 3.1 + 2) * 4.3;
      const s1 = hash(i * 5.7 + 3) * 10;
      const s2 = hash(i * 9.1 + 4) * 10;
      _p.set(
        Math.sin(a) * r + Math.sin(time * 0.31 + s1) * 0.35 + Math.sin(time * 1.13 + s2) * 0.08,
        0.3 + hash(i * 2.3 + 5) * 0.8 + Math.sin(time * 0.57 + s2) * 0.12,
        Math.cos(a) * r + Math.cos(time * 0.27 + s2) * 0.35 + Math.cos(time * 0.97 + s1) * 0.08,
      );
      // Long dim stretches, then a soft blink.
      const blink = Math.max(0, Math.sin(time * (0.8 + hash(i * 4.4) * 0.9) + s1));
      _s.setScalar(0.35 + 0.9 * blink * blink * blink);
      this.fireflies.setMatrixAt(i, _m.compose(_p, _q.identity(), _s));
    }
    if (count) this.fireflies.instanceMatrix.needsUpdate = true;
  }

  private updateSmoke(dt: number): void {
    if (!this.chimneys.length) return;
    this.smokeClock -= dt;
    while (this.smokeClock <= 0) {
      this.smokeClock += SMOKE_EVERY;
      const top = this.chimneys[Math.floor(Math.random() * this.chimneys.length)];
      this.smoke.dust.emit({
        origin: top,
        count: 1,
        color: this.smokeColor,
        shape: 'fountain',
        speed: [0.05, 0.14],
        size: [0.07, 0.12],
        life: [2, 2.8],
        gravity: -0.22,
      });
    }
  }

  private updateFish(dt: number, time: number, calm: boolean): void {
    if (this.leap) {
      const l = this.leap;
      l.t += dt;
      const u = l.t / FISH_LEAP.time;
      if (u >= 1) {
        this.splash(l.x + l.dx, l.z + l.dz);
        this.leap = null;
        this.fish.visible = false;
        this.nextFish = time + lerp(FISH_GAP, Math.random());
        return;
      }
      const base = LAYOUT.waterLevel + this.ocean.waveAt(l.x, l.z);
      this.fish.position.set(l.x + l.dx * u, base + FISH_LEAP.height * 4 * u * (1 - u), l.z + l.dz * u);
      // Nose follows the arc: up out of the water, down back in.
      this.fish.rotation.set(-Math.atan2(FISH_LEAP.height * 4 * (1 - 2 * u), FISH_LEAP.length), Math.atan2(l.dx, l.dz), 0, 'YXZ');
      return;
    }
    if (!calm || time < this.nextFish) return;
    const a = Math.random() * Math.PI * 2;
    const r = 6.5 + Math.random() * 3.5;
    const heading = a + Math.PI / 2 + (Math.random() - 0.5);
    this.leap = {
      t: 0,
      x: Math.sin(a) * r,
      z: Math.cos(a) * r,
      dx: Math.sin(heading) * FISH_LEAP.length,
      dz: Math.cos(heading) * FISH_LEAP.length,
    };
    this.fish.visible = true;
    this.splash(this.leap.x, this.leap.z);
  }

  private splash(x: number, z: number): void {
    this.splashes.dust.emit({
      origin: _w.set(x, LAYOUT.waterLevel + this.ocean.waveAt(x, z) + 0.03, z),
      count: 9,
      color: this.foamColor,
      shape: 'ring',
      radius: 0.05,
      speed: [0.5, 1.1],
      size: [0.025, 0.05],
      life: [0.35, 0.6],
      gravity: 5,
    });
  }

  private applyGlow(): void {
    const color = this.preset?.fireflies?.color ?? 0xffffff;
    this.fireflyMaterial.color.setHex(color);
    this.fireflyMaterial.color.multiplyScalar(glowScale(this.fireflyMaterial.color, this.bloom));
  }
}

function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function lerp(range: readonly [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}
