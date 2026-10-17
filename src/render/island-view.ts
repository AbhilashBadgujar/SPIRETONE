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

const _m = new Matrix4();
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
      parent.add(mesh);
      return mesh;
    });
  }

  reset(): void {
    this.count = 0;
  }

  /** `tint` overrides the first part's slot color for this instance. */
  push(matrix: Matrix4, colors: Record<Slot, Color>, tint?: Color): void {
    const i = this.count++;
    this.meshes.forEach((mesh, p) => {
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, p === 0 && tint ? tint : colors[this.parts[p].slot]);
    });
  }

  commit(): void {
    for (const mesh of this.meshes) {
      mesh.count = this.count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }
}

export class IslandView {
  readonly root = new Group();
  /** Tallest column per ring at the last sync, for camera framing. */
  readonly ringMaxHeights: number[];

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
    ];

    const rock = new Mesh(M.rockGeometry(), [this.rockMaterial, this.sandMaterial, this.rockMaterial]);
    const grass = new Mesh(M.grassGeometry(), this.grassMaterial);
    const mound = new Mesh(M.moundGeometry(), this.grassMaterial);
    const spire = new Mesh(M.spireGeometry(), this.rockMaterial);
    const crystal = new Mesh(M.spireCrystalGeometry(), this.crystalMaterial);
    for (const mesh of [rock, grass, mound, spire]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    this.root.add(rock, grass, mound, spire, crystal);
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
    this.ringMaxHeights.fill(0);

    for (let c = 0; c < g.columnCount; c++) {
      const { structure } = ev.columns[c];
      const h = island.heights[c];
      const x = columnX(g, c);
      const z = columnZ(g, c);
      const yaw = columnAngle(g, c);
      const ring = g.ring[c];
      this.ringMaxHeights[ring] = Math.max(this.ringMaxHeights[ring], h);

      switch (structure) {
        case 'ST_EMPTY':
          this.markers.push(place(x, LAYOUT.groundY, z, yaw), colors);
          continue;
        case 'ST_PLAZA':
          continue; // drawn per group below
        case 'ST_PIER':
          this.piers.push(place(x, 0, z, yaw), colors);
          continue;
        default:
          break;
      }

      for (let level = 0; level < h; level++) {
        const m = place(x, LAYOUT.groundY + level * H, z, yaw);
        this.blocks.push(m, colors, this.blockColor(island, structure, c, level));
        this.windows.push(m, colors);
      }
      const top = place(x, columnTopY(h), z, yaw);
      if (structure === 'ST_COTTAGE') this.cottageRoofs.push(top, colors);
      else if (structure === 'ST_TOWER') this.towerRoofs.push(top, colors);
      else if (structure === 'ST_LIGHTHOUSE') this.lamps.push(top, colors);
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
      this.bridges.push(
        place(ax + dx / 2, LAYOUT.groundY + floor * H + 0.14, az + dz / 2, Math.atan2(dx, dz), 1, 1, length),
        colors,
      );
    }

    for (const k of this.kinds) k.commit();
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
    this.plazaSlabs.push(place(cx, LAYOUT.groundY, cz, yaw, across, 1, radial), this.colors);
    this.fountains.push(place(cx, LAYOUT.groundY + M.PLAZA_HEIGHT, cz, yaw), this.colors);
  }

  private blockColor(island: Island, structure: StructureId, c: ColumnId, level: number): Color {
    if (island.golden[c]) return GOLD;
    // Lighthouses read as striped towers.
    if (structure === 'ST_LIGHTHOUSE' && level % 2 === 1) return this.colors.roof;
    return _c.copy(this.colors.base).offsetHSL(0, 0, (jitter(c * 31 + level * 7) - 0.5) * 0.07);
  }
}

function jitter(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
