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
import { glowScale } from './post';

// Draws one island from sim state. sync() rebuilds every instance matrix from
// scratch, which is cheap at 36 columns and is only called when state changes.
// dropIn() then animates a column's top (block plus whatever sits on it)
// falling into place on top of that final state.
//
// Besides the structures: each building's dressing (door, floor trims,
// window boxes, chimney, laundry on its bridges), a little garden on every
// empty column that the first block clears, and fixed scenery on the beach
// and round the spire. All of it is picked by hashing the column, so a
// column always looks the same. `spots` tells life.ts where people can walk.

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
  | 'patch'
  | 'tuft'
  | 'leaf'
  | 'trunk'
  | 'flower';

/** Where life.ts can put people and boats, in IslandView root space. Keys survive a resync. */
export interface LifeSpots {
  chimneys: Vector3[];
  plazas: { key: string; x: number; y: number; z: number }[];
  /** `busy`: a turning cog takes the middle of the deck. */
  bridges: { key: string; from: Vector3; to: Vector3; busy: boolean }[];
  piers: { key: string; x: number; z: number; yaw: number }[];
}

const GOLD = new Color(0xffc83c);
/** Window glass brightness when unlit: the emissive color, dimmed to dark glass. */
const WINDOW_DARK = 0.13;
/** Beach scenery sits on the sand between the outer columns, clear of piers and plazas. */
const BEACH_RADIUS = LAYOUT.islandRadius - 0.15;
/** Garden ring round the spire, inside the path villagers stroll (life.ts). */
const GARDEN_RADIUS = 1.38;

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
const _tint = new Color();
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
  /** false: too small to cast a shadow worth its draw. */
  shadow?: boolean;
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
      mesh.castShadow = !part.glow && part.shadow !== false;
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
  readonly spots: LifeSpots = { chimneys: [], plazas: [], bridges: [], piers: [] };

  /** Per column, the instances that drop in with its newest block. */
  private readonly tops: TopRef[][];
  /** Columns mid-drop, with seconds since their drop started. */
  private readonly drops = new Map<ColumnId, number>();
  private readonly crystal: Mesh;
  private readonly crystalY: number;
  private crystalPulse = 0;

  private readonly solid = new MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.85 });
  private readonly glow = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  /** Windows glow too, dimmed down to dark glass while the era's day is bright (daylight.ts). */
  private readonly windowGlass = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  private windowsLit = 0;
  private readonly colors = {} as Record<Slot, Color>;
  /** Lit windows, lamps and the crystal burn past the bloom threshold (render/post.ts). */
  private bloom = false;
  private preset: EraPreset | null = null;
  private readonly paints: Color[] = [];
  private last: { island: Island; ev: Evaluation } | null = null;

  private readonly blocks: Kind;
  private readonly windows: Kind;
  /** Ground floors: no outward window, the door goes there. */
  private readonly groundWindows: Kind;
  private readonly doors: Kind;
  private readonly trims: Kind;
  private readonly flowerBoxes: Kind;
  private readonly laundry: Kind;
  private readonly plots: Kind;
  private readonly tufts: Kind;
  private readonly flowers: Kind;
  private readonly bushes: Kind;
  private readonly trees: Kind;
  private readonly pines: Kind;
  private readonly boulders: Kind;
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
    const slots: Slot[] = ['base', 'roof', 'accent', 'water', 'emissive', 'window', 'grass', 'sand', 'rock'];
    for (const slot of [...slots, 'patch', 'tuft', 'leaf', 'trunk', 'flower'] as Slot[]) this.colors[slot] = new Color();
    this.ringMaxHeights = new Array<number>(grid.k.K_RINGS).fill(0);
    this.tops = Array.from({ length: grid.columnCount }, () => []);

    const n = grid.columnCount;
    const maxCap = Math.max(...grid.k.K_CAP_ERA);
    const mats = { solid: this.solid, glow: this.glow };
    const kind = (parts: Part[], capacity: number) => new Kind(parts, capacity, mats, this.root);

    // Scenery: a plot's worth on every column, plus the beach and the garden.
    const around = grid.k.K_INDICES * 2;

    this.blocks = kind([{ geometry: M.blockGeometry(), slot: 'base' }], n * maxCap);
    this.windows = kind([{ geometry: M.windowGeometry(), slot: 'window', glow: true }], n * maxCap);
    this.groundWindows = kind([{ geometry: M.windowGeometry(false), slot: 'window', glow: true }], n);
    for (const k of [this.windows, this.groundWindows]) k.meshes[0].material = this.windowGlass;
    this.doors = kind(
      [
        { geometry: M.awningGeometry(), slot: 'roof' },
        { geometry: M.doorGeometry(), slot: 'trunk', shadow: false },
        { geometry: M.doorLanternGeometry(), slot: 'emissive', glow: true },
      ],
      n,
    );
    this.trims = kind([{ geometry: M.trimGeometry(), slot: 'accent' }], n * maxCap);
    this.flowerBoxes = kind(
      [
        { geometry: M.flowerBloomsGeometry(), slot: 'flower', shadow: false },
        { geometry: M.flowerBoxGeometry(), slot: 'accent', shadow: false },
      ],
      n * maxCap,
    );
    this.laundry = kind([{ geometry: M.laundryGeometry(), slot: 'flower' }], grid.edges.length * 3);
    this.plots = kind([{ geometry: M.plotGeometry(), slot: 'patch', shadow: false }], n);
    this.tufts = kind([{ geometry: M.tuftGeometry(), slot: 'tuft', shadow: false }], n * 3 + around * 2);
    this.flowers = kind(
      [
        { geometry: M.bloomGeometry(), slot: 'flower', shadow: false },
        { geometry: M.stemGeometry(), slot: 'leaf', shadow: false },
      ],
      n * 3 + around * 2,
    );
    this.bushes = kind([{ geometry: M.bushGeometry(), slot: 'leaf' }], n + around);
    const tree = (canopy: BufferGeometry, trunk: BufferGeometry) =>
      kind(
        [
          { geometry: canopy, slot: 'leaf' },
          { geometry: trunk, slot: 'trunk' },
        ],
        n + around,
      );
    this.trees = tree(M.treeCanopyGeometry(), M.treeTrunkGeometry());
    this.pines = tree(M.pineCanopyGeometry(), M.pineTrunkGeometry());
    this.boulders = kind([{ geometry: M.boulderGeometry(), slot: 'rock' }], n + around);
    this.cottageRoofs = kind(
      [
        { geometry: M.cottageRoofGeometry(), slot: 'roof' },
        { geometry: M.chimneyGeometry(), slot: 'accent' },
      ],
      n,
    );
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
      this.groundWindows,
      this.doors,
      this.trims,
      this.flowerBoxes,
      this.laundry,
      this.plots,
      this.tufts,
      this.flowers,
      this.bushes,
      this.trees,
      this.pines,
      this.boulders,
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

  /** Brighten lit windows, lamps and the crystal past the bloom threshold, or back to plain. */
  setBloom(on: boolean): void {
    this.bloom = on;
    this.applyGlow();
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

  /** 0 dark glass .. 1 lit: windows (and door lanterns) follow the era's time of day. */
  setWindowsLit(lit: number): void {
    this.windowsLit = lit;
    this.applyGlow();
  }

  private applyGlow(): void {
    const e = this.colors.emissive;
    const boost = glowScale(e, this.bloom);
    this.glow.color.setScalar(boost);
    this.crystalMaterial.color.copy(e).multiplyScalar(boost);
    this.windowGlass.color.setScalar(WINDOW_DARK + (boost - WINDOW_DARK) * this.windowsLit);
    this.doors.meshes[2].visible = this.windowsLit > 0.5;
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
    c.patch.setHex(p.island.grass).offsetHSL(0, 0.03, -0.035);
    c.tuft.setHex(p.island.grass).offsetHSL(0.01, 0.08, -0.11);
    c.leaf.setHex(p.flora.leaf);
    c.trunk.setHex(p.flora.trunk);
    c.flower.setHex(p.flora.flowers[0]);
    this.paints.length = 0;
    for (const hex of p.flora.flowers) this.paints.push(new Color(hex));
    c.window.setHex(p.palette.emissive);
    this.solid.roughness = p.roughness;
    this.rockMaterial.color.copy(c.rock);
    this.sandMaterial.color.copy(c.sand);
    this.grassMaterial.color.copy(c.grass);
    this.applyGlow();

    if (this.last) this.sync(this.last.island, this.last.ev);
  }

  sync(island: Island, ev: Evaluation): void {
    this.last = { island, ev };
    if (!this.preset) return;
    const g = this.grid;
    const H = LAYOUT.blockHeight;
    const colors = this.colors;
    const spots = this.spots;

    for (const k of this.kinds) k.reset();
    this.gearBases.length = 0;
    this.ringMaxHeights.fill(0);
    this.lampPoints.length = 0;
    spots.chimneys.length = 0;
    spots.plazas.length = 0;
    spots.bridges.length = 0;
    spots.piers.length = 0;
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
          this.pushPlot(c, x, z, yaw);
          continue;
        case 'ST_PLAZA':
          continue; // drawn per group below
        case 'ST_PIER': {
          const m = place(x, 0, z, yaw);
          track(top, this.piers, this.piers.push(m, colors), 0, m);
          spots.piers.push({ key: `q${c}`, x, z, yaw });
          continue;
        }
        default:
          break;
      }

      // Each building stands a hair off the grid, so a street doesn't look stamped out.
      const turn = yaw + (jitter(c * 53 + 3) - 0.5) * 0.1;
      const windowBoxes = structure !== 'ST_LIGHTHOUSE' && jitter(c * 71 + 5) < 0.55;
      for (let level = 0; level < h; level++) {
        const m = place(x, LAYOUT.groundY + level * H, z, turn);
        const onTop = level === h - 1;
        const add = (kind: Kind, tint?: Color) => {
          const i = kind.push(m, colors, tint);
          if (onTop) track(top, kind, i, 0, m);
        };
        add(this.blocks, this.blockColor(island, structure, c, level));
        if (level === 0) {
          add(this.groundWindows);
          add(this.doors, this.paint(c, 1));
        } else {
          add(this.windows);
          add(this.trims);
          if (windowBoxes) add(this.flowerBoxes, this.paint(c, level + 2));
        }
      }
      const cap = place(x, columnTopY(h), z, turn);
      if (structure === 'ST_COTTAGE') {
        track(top, this.cottageRoofs, this.cottageRoofs.push(cap, colors, this.roofColor(c)), H, cap);
        spots.chimneys.push(new Vector3(M.CHIMNEY_TOP.x, M.CHIMNEY_TOP.y, M.CHIMNEY_TOP.z).applyMatrix4(cap));
      } else if (structure === 'ST_TOWER') {
        track(top, this.towerRoofs, this.towerRoofs.push(cap, colors, this.roofColor(c)), H, cap);
      } else {
        track(top, this.lamps, this.lamps.push(cap, colors), H, cap);
        this.lampPoints.push(new Vector3(x, columnTopY(h) + LAMP_CENTER, z));
      }
    }

    for (const anchor of island.plazas) this.pushPlaza(plazaGroup(g, anchor));

    for (const e of g.edges) {
      if (!ev.activeBridges[e.id]) continue;
      const ax = columnX(g, e.a);
      const az = columnZ(g, e.a);
      const dx = columnX(g, e.b) - ax;
      const dz = columnZ(g, e.b) - az;
      const span = Math.hypot(dx, dz);
      const floor = Math.min(island.heights[e.a], island.heights[e.b]) - 1;
      const length = span - LAYOUT.blockDepth * 0.3;
      const deckY = LAYOUT.groundY + floor * H + 0.14;
      const yaw = Math.atan2(dx, dz);
      const mx = ax + dx / 2;
      const mz = az + dz / 2;
      this.bridges.push(place(mx, deckY, mz, yaw, 1, 1, length), colors);
      // Overclock (Era III+): the bridge's cog stands on its deck and turns.
      const geared = this.preset.gears && ev.columns[e.a].overclock + ev.columns[e.b].overclock > 0;
      if (geared) {
        const m = place(mx, deckY + M.GEAR_RADIUS + 0.06, mz, yaw).clone();
        this.gears.push(m, colors);
        this.gearBases.push(m);
      }
      const ux = dx / span;
      const uz = dz / span;
      // Washing pegged along one rope (the bridge's local +x side).
      if (jitter(e.id * 23 + 9) < 0.45) {
        for (const k of [-1, 0, 1]) {
          const lx = mx + ux * k * 0.2 + uz * 0.165;
          const lz = mz + uz * k * 0.2 - ux * 0.165;
          this.laundry.push(place(lx, deckY + 0.215, lz, yaw), colors, this.paint(e.id + 40, k + 1));
        }
      }
      const walk = length / 2 - 0.14;
      const deck = deckY + 0.02;
      spots.bridges.push({
        key: `b${e.id}`,
        from: new Vector3(mx - ux * walk, deck, mz - uz * walk),
        to: new Vector3(mx + ux * walk, deck, mz + uz * walk),
        busy: geared,
      });
    }

    this.pushSurrounds();

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
    this.spots.plazas.push({ key: `p${a}`, x: cx, y: LAYOUT.groundY + LAYOUT.plazaHeight, z: cz });
    // Whichever of the four columns completed the plaza drops the whole slab in.
    for (const col of group) {
      track(this.tops[col], this.plazaSlabs, slab, 0, slabM);
      track(this.tops[col], this.fountains, fountain, LAYOUT.plazaHeight, fountainM);
    }
  }

  /** An empty column's patch of garden: tufts and flowers, now and then a bush, tree or rock. */
  private pushPlot(c: ColumnId, x: number, z: number, yaw: number): void {
    const y = LAYOUT.groundY;
    this.plots.push(place(x, y, z, yaw), this.colors);
    const r = (k: number) => jitter(c * 131 + k * 17);
    this.scatter(x, y, z, c * 7 + 1, 2 + Math.floor(r(1) * 2), Math.floor(r(2) * 4), 0.1, 0.28);
    const fx = x + (r(4) - 0.5) * 0.14;
    const fz = z + (r(5) - 0.5) * 0.14;
    const feature = r(3);
    if (feature < 0.15) this.pushTree(fx, y, fz, c * 7 + 2, 0.6 + r(6) * 0.25);
    else if (feature < 0.38) this.pushBush(fx, y, fz, c * 7 + 3, 0.8 + r(6) * 0.3);
    else if (feature < 0.48) this.pushBoulder(fx, y, fz, c * 7 + 4, 0.8 + r(6) * 0.4);
  }

  /** Fixed scenery: beach growth and rocks between the outer columns, and a garden round the spire. */
  private pushSurrounds(): void {
    const n = this.grid.k.K_INDICES;
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2;
      const seed = 500 + i * 13;
      const bx = Math.sin(a) * BEACH_RADIUS;
      const bz = Math.cos(a) * BEACH_RADIUS;
      const roll = jitter(seed);
      if (roll < 0.45) this.pushTree(bx, 0, bz, seed + 1, 0.8 + jitter(seed + 2) * 0.35);
      else if (roll < 0.75) this.pushBush(bx, 0, bz, seed + 1, 1 + jitter(seed + 2) * 0.3);
      else this.pushBoulder(bx, 0, bz, seed + 1, 1.3 + jitter(seed + 2) * 0.5);
      // A pebble beside it, along the shore.
      const b = a + (jitter(seed + 3) < 0.5 ? -1 : 1) * 0.07;
      this.pushBoulder(Math.sin(b) * BEACH_RADIUS, 0, Math.cos(b) * BEACH_RADIUS, seed + 4, 0.45 + jitter(seed + 5) * 0.3);

      const gx = Math.sin(a) * GARDEN_RADIUS;
      const gz = Math.cos(a) * GARDEN_RADIUS;
      if (i % 3 === 0) this.pushBush(gx, LAYOUT.groundY, gz, seed + 6, 0.75);
      this.scatter(gx, LAYOUT.groundY, gz, seed + 7, 1, 2, 0.06, 0.18);
    }
  }

  /** `tufts` grass tufts then `flowers` flowers, scattered rMin..rMax round (x, z). */
  private scatter(x: number, y: number, z: number, seed: number, tufts: number, flowers: number, rMin: number, rMax: number): void {
    for (let i = 0; i < tufts + flowers; i++) {
      const a = jitter(seed * 3.1 + i * 7.7) * Math.PI * 2;
      const d = rMin + jitter(seed * 5.3 + i * 3.9) * (rMax - rMin);
      const spin = jitter(seed * 1.7 + i * 11.3) * Math.PI * 2;
      const s = 0.8 + jitter(seed * 2.9 + i * 5.1) * 0.45;
      const m = place(x + Math.cos(a) * d, y, z + Math.sin(a) * d, spin, s, s, s);
      if (i < tufts) this.tufts.push(m, this.colors);
      else this.flowers.push(m, this.colors, this.paint(seed, i));
    }
  }

  private pushTree(x: number, y: number, z: number, seed: number, scale: number): void {
    const pine = jitter(seed * 1.3) < (this.preset?.flora.pines ?? 0);
    const kind = pine ? this.pines : this.trees;
    // Pines stand a little taller and narrower than round trees.
    const wide = pine ? scale * 0.85 : scale;
    const tall = pine ? scale * 1.15 : scale;
    kind.push(place(x, y, z, jitter(seed * 2.3) * Math.PI * 2, wide, tall, wide), this.colors, this.leafColor(seed));
  }

  private pushBush(x: number, y: number, z: number, seed: number, scale: number): void {
    this.bushes.push(place(x, y, z, jitter(seed * 2.3) * Math.PI * 2, scale, scale, scale), this.colors, this.leafColor(seed));
  }

  private pushBoulder(x: number, y: number, z: number, seed: number, scale: number): void {
    const tint = _tint.copy(this.colors.rock).offsetHSL(0, 0, 0.06 + (jitter(seed * 3.7) - 0.5) * 0.1);
    this.boulders.push(place(x, y, z, jitter(seed * 2.3) * Math.PI * 2, scale, scale, scale), this.colors, tint);
  }

  private leafColor(seed: number): Color {
    return _tint.copy(this.colors.leaf).offsetHSL((jitter(seed * 4.1) - 0.5) * 0.05, 0, (jitter(seed * 6.7) - 0.5) * 0.12);
  }

  /** One of the era's flower colors, picked by hash: blooms, awnings, washing. */
  private paint(seed: number, k: number): Color {
    const i = Math.floor(jitter(seed * 97 + k * 13) * this.paints.length);
    return this.paints[i] ?? this.colors.flower;
  }

  /** Each roof a shade of its own. */
  private roofColor(c: ColumnId): Color {
    return _tint.copy(this.colors.roof).offsetHSL((jitter(c * 29 + 1) - 0.5) * 0.03, 0, (jitter(c * 37 + 2) - 0.5) * 0.1);
  }

  private blockColor(island: Island, structure: StructureId, c: ColumnId, level: number): Color {
    if (island.golden[c]) return GOLD;
    // Lighthouses read as striped towers.
    if (structure === 'ST_LIGHTHOUSE' && level % 2 === 1) return this.colors.roof;
    // A shade per building (so its floors read as one), and a whisper per floor.
    const hue = (jitter(c * 31 + 1) - 0.5) * 0.04;
    const sat = (jitter(c * 43 + 2) - 0.5) * 0.12;
    const light = (jitter(c * 59 + 3) - 0.5) * 0.08 + (jitter(c * 31 + level * 7) - 0.5) * 0.025;
    return _c.copy(this.colors.base).offsetHSL(hue, sat, light);
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
