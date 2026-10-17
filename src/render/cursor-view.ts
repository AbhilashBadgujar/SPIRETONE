import {
  BoxGeometry,
  Color,
  ConeGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import type { ColumnId, Grid } from '../sim/grid';
import type { Island } from '../sim/island';
import { LAYOUT, columnAngle, columnRadius, columnTopY } from './layout';
import { blockGeometry } from './meshes';

// The cursor: a ghost block where the next block would land, plus a floating
// marker that stays visible over buildings. Glides between columns along the
// ring rather than cutting across the island.

export type CursorState = 'ready' | 'broke' | 'blocked';

const COLORS: Record<CursorState | 'smart' | 'reject', number> = {
  ready: 0xffffff,
  smart: 0xffd75e,
  broke: 0x9fb4c8,
  blocked: 0x7d7d7d,
  reject: 0xff5a5a,
};
/** The marker must stay findable from across the island, so it only dims a little. */
const MARKER_COLORS: Record<CursorState, number> = { ready: 0xffffff, broke: 0xd8e4f0, blocked: 0xa8a8a8 };
const OPACITY: Record<CursorState, number> = { ready: 0.38, broke: 0.2, blocked: 0.14 };

const GLIDE = 14;
const SHAKE_TIME = 0.35;
const POP_TIME = 0.25;

export class CursorView {
  readonly root = new Group();

  private readonly ghost: Mesh;
  private readonly ghostMaterial = new MeshBasicMaterial({ transparent: true, depthWrite: false });
  private readonly outlineMaterial = new LineBasicMaterial({ transparent: true });
  private readonly marker: Mesh;
  private readonly markerMaterial = new MeshBasicMaterial({ depthTest: false });
  private readonly body = new Group();

  private angle = 0;
  private radius: number = LAYOUT.ringRadius[0];
  private y: number = LAYOUT.groundY;
  private target = { angle: 0, radius: 0, y: 0 };
  private state: CursorState = 'ready';
  private smart = false;
  private shakeT = 0;
  private popT = 0;
  private snapped = false;
  private readonly tint = new Color();

  constructor(private readonly grid: Grid) {
    this.ghost = new Mesh(blockGeometry(), this.ghostMaterial);
    const W = LAYOUT.blockWidth + 0.03;
    const H = LAYOUT.blockHeight + 0.03;
    const D = LAYOUT.blockDepth + 0.03;
    const outline = new LineSegments(
      new EdgesGeometry(new BoxGeometry(W, H, D).translate(0, LAYOUT.blockHeight / 2, 0)),
      this.outlineMaterial,
    );
    this.marker = new Mesh(new ConeGeometry(0.19, 0.38, 4).rotateX(Math.PI), this.markerMaterial);
    this.marker.renderOrder = 10;
    this.body.add(this.ghost, outline, this.marker);
    this.root.add(this.body);
  }

  setTarget(c: ColumnId, island: Island, state: CursorState, smart: boolean): void {
    const h = island.heights[c];
    this.target.angle = columnAngle(this.grid, c);
    this.target.radius = columnRadius(this.grid, c);
    this.target.y = island.inPlaza[c] ? LAYOUT.groundY + LAYOUT.plazaHeight : columnTopY(h);
    this.state = state;
    this.smart = smart;
    if (!this.snapped) {
      this.angle = this.target.angle;
      this.radius = this.target.radius;
      this.y = this.target.y;
      this.snapped = true;
    }
  }

  /** Turntable-space position of the floating marker, for HUD chips. */
  anchor(out: Vector3): Vector3 {
    return out.set(
      Math.sin(this.angle) * this.radius,
      this.y + this.marker.position.y,
      Math.cos(this.angle) * this.radius,
    );
  }

  /** Rejected drop: wobble and flash. */
  shake(): void {
    this.shakeT = SHAKE_TIME;
  }

  /** Accepted drop: quick squash. */
  pop(): void {
    this.popT = POP_TIME;
  }

  update(dt: number, time: number): void {
    const k = 1 - Math.exp(-GLIDE * dt);
    let da = this.target.angle - this.angle;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    this.angle += da * k;
    this.radius += (this.target.radius - this.radius) * k;
    this.y += (this.target.y - this.y) * k;

    this.shakeT = Math.max(0, this.shakeT - dt);
    this.popT = Math.max(0, this.popT - dt);

    const wobble = this.shakeT > 0 ? Math.sin(time * 60) * 0.07 * (this.shakeT / SHAKE_TIME) : 0;
    this.root.rotation.y = this.angle;
    this.body.position.set(wobble, this.y, this.radius);

    const pop = this.popT / POP_TIME;
    const squash = 1 + 0.35 * pop * pop;
    this.ghost.scale.set(squash, 1 / squash, squash);

    const bob = Math.sin(time * 3.2) * 0.06;
    this.marker.position.y = LAYOUT.blockHeight + 0.75 + bob;
    this.marker.rotation.y = time * 1.6;

    const rejecting = this.shakeT > 0;
    const smart = this.smart && this.state !== 'blocked';
    this.tint.setHex(rejecting ? COLORS.reject : smart && this.state === 'ready' ? COLORS.smart : COLORS[this.state]);
    this.ghostMaterial.color.copy(this.tint);
    this.outlineMaterial.color.copy(this.tint);
    this.markerMaterial.color.setHex(
      rejecting ? COLORS.reject : smart ? COLORS.smart : MARKER_COLORS[this.state],
    );
    const breathe = this.state === 'ready' ? 0.08 * Math.sin(time * 4) : 0;
    this.ghostMaterial.opacity = OPACITY[this.state] + breathe;
    this.outlineMaterial.opacity = this.state === 'blocked' ? 0.35 : 0.95;
  }
}
