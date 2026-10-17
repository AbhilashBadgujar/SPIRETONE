import {
  ACESFilmicToneMapping,
  CanvasTexture,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { EraPreset } from '../data/eras';
import { LAYOUT, columnTopY } from './layout';

// Renderer, lights, sky and the fixed camera (GDD §1: fixed, framed on the
// island, auto-dolly to fit the tallest column).

export const CAMERA = {
  fov: 30,
  elevationDeg: 30,
  /** NDC box the island must fit inside; the margins leave room for the HUD. */
  ndcX: 0.9,
  ndcTop: 0.62,
  ndcBottom: -0.78,
  /** Higher = snappier dolly. */
  smoothing: 2.5,
};

/** Headroom above a column's top block for roofs and lamps. */
const CAP_ALLOWANCE = 0.8;
const RIM_RADIUS = LAYOUT.islandRadius + 0.7;

const _v = new Vector3();
const deg = (d: number) => (d * Math.PI) / 180;

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(CAMERA.fov, 1, 0.1, 400);
  /** Everything that spins with the island. */
  readonly turntable = new Group();

  private readonly sun = new DirectionalLight();
  private readonly skyLight = new HemisphereLight();
  private readonly fog = new FogExp2(0xffffff, 0.01);
  private readonly skyCanvas = document.createElement('canvas');
  private readonly skyTexture: CanvasTexture;
  /** Scratch camera for fitting, so the real one never jumps mid-search. */
  private readonly probe = new PerspectiveCamera(CAMERA.fov, 1, 0.1, 400);
  private ringHeights: readonly number[] = [];
  private readonly goal = { distance: 20, targetY: 0.5 };
  private readonly current = { distance: 20, targetY: 0.5 };
  private snap = true;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    this.skyCanvas.width = 2;
    this.skyCanvas.height = 256;
    this.skyTexture = new CanvasTexture(this.skyCanvas);
    this.skyTexture.colorSpace = SRGBColorSpace;
    this.scene.background = this.skyTexture;
    this.scene.fog = this.fog;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 3;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -8;
    sc.right = sc.top = 8;
    sc.near = 1;
    sc.far = 60;

    this.scene.add(this.turntable, this.skyLight, this.sun, this.sun.target);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  applyPreset(p: EraPreset): void {
    const ctx = this.skyCanvas.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, this.skyCanvas.height);
    g.addColorStop(0, hex(p.sky.top));
    g.addColorStop(1, hex(p.sky.bottom));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.skyCanvas.width, this.skyCanvas.height);
    this.skyTexture.needsUpdate = true;

    this.fog.color.setHex(p.fog.color);
    this.fog.density = p.fog.density;

    this.skyLight.color.setHex(p.skyLight.sky);
    this.skyLight.groundColor.setHex(p.skyLight.ground);
    this.skyLight.intensity = p.skyLight.intensity;

    const el = deg(p.sun.elevation);
    const az = deg(p.sun.azimuth);
    this.sun.color.setHex(p.sun.color);
    this.sun.intensity = p.sun.intensity;
    this.sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(25);
  }

  /** Re-aim the dolly so the island and its tallest columns fit. */
  frameColumns(ringMaxHeights: readonly number[]): void {
    this.ringHeights = ringMaxHeights.slice();
    this.computeGoal();
  }

  update(dt: number): void {
    const t = this.snap ? 1 : 1 - Math.exp(-CAMERA.smoothing * dt);
    this.snap = false;
    this.current.distance += (this.goal.distance - this.current.distance) * t;
    this.current.targetY += (this.goal.targetY - this.current.targetY) * t;
    aim(this.camera, this.current.distance, this.current.targetY);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    for (const cam of [this.camera, this.probe]) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    this.computeGoal();
    this.snap = true;
  }

  private computeGoal(): void {
    const points = this.framePoints();
    const tallest = Math.max(...points.map((p) => p.y));
    const targetY = Math.max(0.2, tallest * 0.32);
    let lo = 4;
    let hi = 150;
    for (let it = 0; it < 26; it++) {
      const mid = (lo + hi) / 2;
      if (this.fits(mid, targetY, points)) hi = mid;
      else lo = mid;
    }
    this.goal.distance = hi;
    this.goal.targetY = targetY;
  }

  private fits(distance: number, targetY: number, points: Vector3[]): boolean {
    aim(this.probe, distance, targetY);
    this.probe.updateMatrixWorld();
    for (const p of points) {
      _v.copy(p).project(this.probe);
      if (Math.abs(_v.x) > CAMERA.ndcX || _v.y > CAMERA.ndcTop || _v.y < CAMERA.ndcBottom) return false;
    }
    return true;
  }

  /** Rotation-invariant hull: the island turns, so sample full circles. */
  private framePoints(): Vector3[] {
    const points: Vector3[] = [new Vector3(0, 2.4, 0)];
    const steps = 16;
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      points.push(new Vector3(Math.sin(a) * RIM_RADIUS, LAYOUT.waterLevel, Math.cos(a) * RIM_RADIUS));
      this.ringHeights.forEach((h, r) => {
        if (h <= 0) return;
        const radius = LAYOUT.ringRadius[r] + 0.45;
        points.push(new Vector3(Math.sin(a) * radius, columnTopY(h) + CAP_ALLOWANCE, Math.cos(a) * radius));
      });
    }
    return points;
  }
}

function aim(cam: PerspectiveCamera, distance: number, targetY: number): void {
  const el = deg(CAMERA.elevationDeg);
  cam.position.set(0, targetY + distance * Math.sin(el), distance * Math.cos(el));
  cam.lookAt(0, targetY, 0);
}

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}
