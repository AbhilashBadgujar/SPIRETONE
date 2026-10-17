import {
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { EraPreset } from '../data/eras';
import type { StructureId } from '../data/ids';
import { plazaGroup, type Evaluation } from '../sim/evaluate';
import type { ColumnId, Grid } from '../sim/grid';
import type { Island } from '../sim/island';
import { LAYOUT, columnAngle, columnTopY, columnX, columnZ } from './layout';
import * as M from './meshes';

// Draws one island from sim state. sync() rebuilds every instance matrix from
// scratch, which is cheap at 36 columns and is only called when state changes.
// dropIn() then animates a column's top (block plus whatever sits on it)
// falling into place on top of that final state.

type Slot =
  | 'base'
  | 'roof'
  | 'accent'
  | 'water'
  | 'emissive'
  | 'window'
  | 'grass'
  | 'sand'
  | 'rock'
  | 'marker';

const GOLD = new Color(0xffc83c);

/** Seconds from a drop to the block landing; audio and particles sync to it. */
export const DROP_FALL_TIME = 0.16;
/** How far above its resting place a dropped block starts falling. */
export const DROP_FALL_HEIGHT = 2.6;
const SETTLE_TIME = 0.45;

/** Seconds a drop animates in total. */
export const DROP_TOTAL_TIME = DROP_FALL_TIME + SETTLE_TIME;

/** Vertical offset and y-scale of a dropping column top `t` seconds in (t < 0: not started). */
export function dropPose(t: number): { dy: number; sy: number } | null {
  if (t < 0) return null;
  if (t < DROP_FALL_TIME) {
    const u = t / DROP_FALL_TIME;
    return { dy: DROP_FALL_HEIGHT * (1 - u * u), sy: 1 + 0.12 * u };
  }
  const u = t - DROP_FALL_TIME;
  return { dy: 0, sy: 1 - 0.3 * Math.exp(-u * 10) * Math.cos(u * 24) };
}

const _m = new Matrix4();
const _anim = new Matrix4();
const _spin = new Matrix4();
/** Radians per second a bridge cog turns. */
const GEAR_SPEED = 1.8;
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _c = new Color();
const UP = new Vector3(0, 1, 0);

function place(x: number, y: number, z: number, yaw: number, sx = 1, sy = 1, sz = 1): Matrix4 {
  _p.set(x, y, z);
  _q.setFromAxisAngle(UP, yaw);
  _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s);
}

interface Part {
  geometry: BufferGeometry;
  slot: Slot;
  glow?: boolean;
}

/** One logical mesh made of per-slot instanced parts that share transforms. */
class Kind {
  readonly meshes: InstancedMesh[];
  private count = 0;

  constructor(
    private readonly parts: Part[],
    capacity: number,
    materials: { solid: Material; glow: Material },
    parent: Group,
  ) {
    this.meshes = parts.map((part) => {
      const mesh = new InstancedMesh(part.geometry, part.glow ? materials.glow : materials.solid, capacity);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.count = 0;
      mesh.castShadow = !part.glow;
      mesh.receiveShadow = !part.glow;
      // Falling blocks start outside any cached bounds; the island is always on screen anyway.
      mesh.frustumCulled = false;
      parent.add(mesh);
      return mesh;
    });
  }

  reset(): void {
    this.count = 0;
  }

  /** Returns the instance index. `tint` overrides the first part's slot color. */
  push(matrix: Matrix4, colors: Record<Slot, Color>, tint?: Color): number {
    const i = this.count++;
    this.meshes.forEach((mesh, p) => {
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, p === 0 && tint ? tint : colors[this.parts[p].slot]);
    });
    return i;
  }

  setMatrix(i: number, matrix: Matrix4): void {
    for (const mesh of this.meshes) mesh.setMatrixAt(i, matrix);
  }

  flushMatrices(): void {
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }

  commit(): void {
    for (const mesh of this.meshes) {
      mesh.count = this.count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

/** One instance that belongs to a column's top. `lift` is its height above the top block's base. */
interface TopRef {
  kind: Kind;
  index: number;
  lift: number;
  base: Matrix4;
}

export class IslandView {
  readonly root = new Group();
  /** Tallest column per ring at the last sync, for camera framing. */
  readonly ringMaxHeights: number[];
  /** Turntable-space lamp centers of every lighthouse, for the beams. */
  readonly lampPoints: Vector3[] = [];

  /** Per column, the instances that drop in with its newest block. */
  private readonly tops: TopRef[][];
  /** Columns mid-drop, with seconds since their drop started. */
  private readonly drops = new Map<ColumnId, number>();
  private readonly crystal: Mesh;
  private readonly crystalY: number;
  private crystalPulse = 0;

  private readonly solid = new MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.85 });
  private readonly glow = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  private readonly colors = {} as Record<Slot, Color>;
  private preset: EraPreset | null = null;
  private last: { island: Island; ev: Evaluation } | null = null;

  private readonly blocks: Kind;
  private readonly windows: Kind;
  private readonly markers: Kind;
  private readonly cottageRoofs: Kind;
  private readonly towerRoofs: Kind;
  private readonly lamps: Kind;
  private readonly piers: Kind;
  private readonly plazaSlabs: Kind;
  private readonly fountains: Kind;
  private readonly bridges: Kind;
  /** Part of the bridge mesh, shown where the era preset turns gears on. */
  private readonly gears: Kind;
  private readonly gearBases: Matrix4[] = [];
  private readonly kinds: Kind[];

  private readonly rockMaterial = new MeshStandardMaterial({ flatShading: true, roughness: 1 });
  private readonly sandMaterial = new MeshStandardMaterial({ flatShading: true, roughness: 1 });
  private readonly grassMaterial = new MeshStandardMaterial({ flatShading: true, roughness: 1 });
  private readonly crystalMaterial = new MeshBasicMaterial({ toneMapped: false });

  constructor(private readonly grid: Grid) {
    if (LAYOUT.ringRadius.length !== grid.k.K_RINGS) {
      throw new Error('LAYOUT.ringRadius needs one radius per ring');
    }
    for (const slot of ['base', 'roof', 'accent', 'water', 'emissive', 'window', 'grass', 'sand', 'rock', 'marker'] as Slot[]) {
      this.colors[slot] = new Color();
    }
    this.ringMaxHeights = new Array<number>(grid.k.K_RINGS).fill(0);
    this.tops = Array.from({ length: grid.columnCount }, () => []);

    const n = grid.columnCount;
    const maxCap = Math.max(...grid.k.K_CAP_ERA);
    const mats = { solid: this.solid, glow: this.glow };
    const kind = (parts: Part[], capacity: number) => new Kind(parts, capacity, mats, this.root);

    this.blocks = kind([{ geometry: M.blockGeometry(), slot: 'base' }], n * maxCap);
    this.windows = kind([{ geometry: M.windowGeometry(), slot: 'window' }], n * maxCap);
    this.markers = kind([{ geometry: M.markerGeometry(), slot: 'marker' }], n);
    this.cottageRoofs = kind([{ geometry: M.cottageRoofGeometry(), slot: 'roof' }], n);
    this.towerRoofs = kind(
      [
        { geometry: M.towerRoofGeometry(), slot: 'roof' },
        { geometry: M.flagGeometry(), slot: 'accent' },
      ],
      n,
    );
    this.lamps = kind(
      [
        { geometry: M.lampGalleryGeometry(), slot: 'accent' },
        { geometry: M.lampGlassGeometry(), slot: 'emissive', glow: true },
        { geometry: M.lampCapGeometry(), slot: 'roof' },
      ],
      n,
    );
    this.piers = kind(
      [
        { geometry: M.pierWoodGeometry(), slot: 'accent' },
        { geometry: M.pierCargoGeometry(), slot: 'base' },
      ],
      grid.k.K_INDICES,
    );
    this.plazaSlabs = kind([{ geometry: M.plazaSlabGeometry(), slot: 'sand' }], Math.floor(n / 4));
    this.fountains = kind(
      [
        { geometry: M.fountainStoneGeometry(), slot: 'base' },
        { geometry: M.fountainWaterGeometry(), slot: 'water' },
      ],
      Math.floor(n / 4),
    );
    this.bridges = kind(
      [
        { geometry: M.bridgeWoodGeometry(), slot: 'accent' },
        { geometry: M.bridgeRopeGeometry(), slot: 'base' },
      ],
      grid.edges.length,
    );
    this.gears = kind([{ geometry: M.bridgeGearGeometry(), slot: 'base' }], grid.edges.length);
    this.kinds = [
      this.blocks,
      this.windows,
      this.markers,
      this.cottageRoofs,
      this.towerRoofs,
      this.lamps,
      this.piers,
      this.plazaSlabs,
      this.fountains,
      this.bridges,
      this.gears,
    ];

    const rock = new Mesh(M.rockGeometry(), [this.rockMaterial, this.sandMaterial, this.rockMaterial]);
    const grass = new Mesh(M.grassGeometry(), this.grassMaterial);
    const mound = new Mesh(M.moundGeometry(), this.grassMaterial);
    const spire = new Mesh(M.spireGeometry(), this.rockMaterial);
    // Pivot the crystal on its own center so it can spin and pulse in place.
    const crystalGeometry = M.spireCrystalGeometry();
    crystalGeometry.computeBoundingBox();
    const crystalCenter = crystalGeometry.boundingBox!.getCenter(new Vector3());
    crystalGeometry.translate(-crystalCenter.x, -crystalCenter.y, -crystalCenter.z);
    this.crystal = new Mesh(crystalGeometry, this.crystalMaterial);
    this.crystal.position.copy(crystalCenter);
    this.crystalY = crystalCenter.y;
    for (const mesh of [rock, grass, mound, spire]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    this.root.add(rock, grass, mound, spire, this.crystal);
  }

  /** Start column c's newest block falling in, optionally after a delay (cascades). */
  dropIn(c: ColumnId, delay = 0): void {
    this.drops.set(c, -delay);
    this.applyDrops();
  }

  /** Swell the spire crystal; it eases back on its own. */
  pulseCrystal(amount: number): void {
    this.crystalPulse = Math.max(this.crystalPulse, amount);
  }

  update(dt: number, time: number): void {
    for (const [c, t] of this.drops) {
      const next = t + dt;
      if (next >= DROP_TOTAL_TIME) {
        this.drops.delete(c);
        for (const ref of this.tops[c]) ref.kind.setMatrix(ref.index, ref.base);
      } else {
        this.drops.set(c, next);
      }
    }
    this.applyDrops();

    this.crystalPulse *= Math.exp(-5 * dt);
    this.crystal.rotation.y = time * 0.7;
    this.crystal.position.y = this.crystalY + Math.sin(time * 1.4) * 0.05;
    this.crystal.scale.setScalar(1 + this.crystalPulse);

    if (this.gearBases.length) {
      // Neighbors turn opposite ways, like meshed gears.
      this.gearBases.forEach((base, i) => {
        _spin.makeRotationX(time * GEAR_SPEED * (i % 2 ? 1 : -1));
        this.gears.setMatrix(i, _anim.multiplyMatrices(base, _spin));
      });
      this.gears.flushMatrices();
    }
  }

  applyPreset(p: EraPreset): void {
    this.preset = p;
    const c = this.colors;
    c.base.setHex(p.palette.base);
    c.roof.setHex(p.palette.roof);
    c.accent.setHex(p.palette.accent);
    c.water.setHex(p.palette.water);
    c.emissive.setHex(p.palette.emissive);
    c.grass.setHex(p.island.grass);
    c.sand.setHex(p.island.sand);
    c.rock.setHex(p.island.rock);
    c.marker.setHex(p.island.grass).offsetHSL(0, -0.05, -0.08);
    if (p.litWindows) c.window.setHex(p.palette.emissive);
    else c.window.setHex(p.palette.accent).multiplyScalar(0.45);

    this.windows.meshes[0].material = p.litWindows ? this.glow : this.solid;
    this.windows.meshes[0].castShadow = !p.litWindows;
    this.solid.roughness = p.roughness;
    this.rockMaterial.color.copy(c.rock);
    this.sandMaterial.color.copy(c.sand);
    this.grassMaterial.color.copy(c.grass);
    this.crystalMaterial.color.copy(c.emissive);

    if (this.last) this.sync(this.last.island, this.last.ev);
  }

  sync(island: Island, ev: Evaluation): void {
    this.last = { island, ev };
    if (!this.preset) return;
    const g = this.grid;
    const H = LAYOUT.blockHeight;
    const colors = this.colors;

    for (const k of this.kinds) k.reset();
    this.gearBases.length = 0;
    this.ringMaxHeights.fill(0);
    this.lampPoints.length = 0;
    for (const refs of this.tops) refs.length = 0;

    for (let c = 0; c < g.columnCount; c++) {
      const { structure } = ev.columns[c];
      const h = island.heights[c];
      const x = columnX(g, c);
      const z = columnZ(g, c);
      const yaw = columnAngle(g, c);
      const ring = g.ring[c];
      const top = this.tops[c];
      this.ringMaxHeights[ring] = Math.max(this.ringMaxHeights[ring], h);

      switch (structure) {
        case 'ST_EMPTY':
          this.markers.push(place(x, LAYOUT.groundY, z, yaw), colors);
          continue;
        case 'ST_PLAZA':
          continue; // drawn per group below
        case 'ST_PIER': {
          const m = place(x, 0, z, yaw);
          track(top, this.piers, this.piers.push(m, colors), 0, m);
          continue;
        }
        default:
          break;
      }

      for (let level = 0; level < h; level++) {
        const m = place(x, LAYOUT.groundY + level * H, z, yaw);
        const b = this.blocks.push(m, colors, this.blockColor(island, structure, c, level));
        const w = this.windows.push(m, colors);
        if (level === h - 1) {
          track(top, this.blocks, b, 0, m);
          track(top, this.windows, w, 0, m);
        }
      }
      const cap = place(x, columnTopY(h), z, yaw);
      const dress =
        structure === 'ST_COTTAGE' ? this.cottageRoofs : structure === 'ST_TOWER' ? this.towerRoofs : this.lamps;
      track(top, dress, dress.push(cap, colors), H, cap);
      if (structure === 'ST_LIGHTHOUSE') this.lampPoints.push(new Vector3(x, columnTopY(h) + LAMP_CENTER, z));
    }

    for (const anchor of island.plazas) this.pushPlaza(plazaGroup(g, anchor));

    for (const e of g.edges) {
      if (!ev.activeBridges[e.id]) continue;
      const ax = columnX(g, e.a);
      const az = columnZ(g, e.a);
      const dx = columnX(g, e.b) - ax;
      const dz = columnZ(g, e.b) - az;
      const floor = Math.min(island.heights[e.a], island.heights[e.b]) - 1;
      const length = Math.hypot(dx, dz) - LAYOUT.blockDepth * 0.3;
      const deckY = LAYOUT.groundY + floor * H + 0.14;
      const yaw = Math.atan2(dx, dz);
      this.bridges.push(place(ax + dx / 2, deckY, az + dz / 2, yaw, 1, 1, length), colors);
      // Overclock (Era III+): the bridge's cog stands on its deck and turns.
      if (this.preset.gears && ev.columns[e.a].overclock + ev.columns[e.b].overclock > 0) {
        const m = place(ax + dx / 2, deckY + M.GEAR_RADIUS + 0.06, az + dz / 2, yaw).clone();
        this.gears.push(m, colors);
        this.gearBases.push(m);
      }
    }

    for (const k of this.kinds) k.commit();
    this.applyDrops();
  }

  /** Pose every dropping column top for its current time. */
  private applyDrops(): void {
    if (this.drops.size === 0) return;
    const touched = new Set<Kind>();
    for (const [c, t] of this.drops) {
      const pose = dropPose(t);
      for (const ref of this.tops[c]) {
        if (!pose) {
          ref.kind.setMatrix(ref.index, _anim.makeScale(0, 0, 0));
        } else {
          const sx = 1 / Math.sqrt(pose.sy);
          _m.makeScale(sx, ref.lift > 0 ? 1 : pose.sy, sx);
          _anim.multiplyMatrices(ref.base, _m);
          // Parts above the block ride its squashed top.
          _anim.elements[13] += pose.dy + ref.lift * (pose.sy - 1);
          ref.kind.setMatrix(ref.index, _anim);
        }
        touched.add(ref.kind);
      }
    }
    for (const k of touched) k.flushMatrices();
  }

  private pushPlaza(group: ColumnId[]): void {
    const g = this.grid;
    const [a, b, c, d] = group;
    const xs = group.map((col) => columnX(g, col));
    const zs = group.map((col) => columnZ(g, col));
    const cx = (xs[0] + xs[1] + xs[2] + xs[3]) / 4;
    const cz = (zs[0] + zs[1] + zs[2] + zs[3]) / 4;
    const dist = (p: ColumnId, q: ColumnId) =>
      Math.hypot(columnX(g, p) - columnX(g, q), columnZ(g, p) - columnZ(g, q));
    const across = (dist(a, b) + dist(c, d)) / 2 + LAYOUT.blockWidth * 0.9;
    const radial = (dist(a, c) + dist(b, d)) / 2 + LAYOUT.blockDepth * 0.9;
    const yaw = Math.atan2(cx, cz);
    const slabM = place(cx, LAYOUT.groundY, cz, yaw, across, 1, radial).clone();
    const slab = this.plazaSlabs.push(slabM, this.colors);
    const fountainM = place(cx, LAYOUT.groundY + LAYOUT.plazaHeight, cz, yaw);
    const fountain = this.fountains.push(fountainM, this.colors);
    // Whichever of the four columns completed the plaza drops the whole slab in.
    for (const col of group) {
      track(this.tops[col], this.plazaSlabs, slab, 0, slabM);
      track(this.tops[col], this.fountains, fountain, LAYOUT.plazaHeight, fountainM);
    }
  }

  private blockColor(island: Island, structure: StructureId, c: ColumnId, level: number): Color {
    if (island.golden[c]) return GOLD;
    // Lighthouses read as striped towers.
    if (structure === 'ST_LIGHTHOUSE' && level % 2 === 1) return this.colors.roof;
    return _c.copy(this.colors.base).offsetHSL(0, 0, (jitter(c * 31 + level * 7) - 0.5) * 0.07);
  }
}

/** Glass center above a lighthouse's top block (see meshes.lampGlassGeometry). */
const LAMP_CENTER = 0.23;

function track(refs: TopRef[], kind: Kind, index: number, lift: number, matrix: Matrix4): void {
  refs.push({ kind, index, lift, base: matrix.clone() });
}

function jitter(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
