import {
  ACESFilmicToneMapping,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { EraPreset } from '../data/eras';
import type { RenderLevel } from '../game/quality';
import type { Light } from './daylight';
import { LAYOUT, columnTopY } from './layout';
import { Post } from './post';
import { Sky } from './sky';

// Renderer, lights, sky and the fixed camera (GDD §1: fixed, framed on the
// island, auto-dolly to fit the tallest column). The camera sits low enough
// to see a strip of sky over the sea, and drifts a touch while idle.

export const CAMERA = {
  /** Low and wide enough that the horizon sits near the top of the frame. */
  fov: 50,
  elevationDeg: 21,
  /** NDC box the island must fit inside; the margins leave room for the HUD. */
  ndcX: 0.92,
  ndcTop: 0.64,
  /** Clears the Ascend button at bottom-center. */
  ndcBottom: -0.66,
  /** Higher = snappier dolly. */
  smoothing: 2.5,
};

/**
 * Idle drift: a slow sway around the island and a breath of tilt, in radians,
 * over two incommensurate periods (seconds) so it never visibly repeats.
 * Off for prefers-reduced-motion.
 */
const DRIFT = { sway: 0.035, swayFine: 0.012, tilt: 0.006, periods: [53, 23, 37] };

/** Headroom above a column's top block for roofs and lamps. */
const CAP_ALLOWANCE = 0.8;
const RIM_RADIUS = LAYOUT.islandRadius + 0.7;
/** Shadows lift a little: sky light still reaches into them. */
const SHADOW_INTENSITY = 0.82;
/** Light-space slack around the fitted shadow box, for flags and the soft edge. */
const SHADOW_MARGIN = 0.6;

const _v = new Vector3();
const _size = new Vector2();
const deg = (d: number) => (d * Math.PI) / 180;

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(CAMERA.fov, 1, 0.1, 400);
  /** Everything that spins with the island. */
  readonly turntable = new Group();

  private readonly post: Post;
  private readonly sun = new DirectionalLight();
  private readonly skyLight = new HemisphereLight();
  private readonly fog = new FogExp2(0xffffff, 0.01);
  private readonly sky = new Sky();
  private readonly still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  private clock = 0;
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
    // Post renders several passes a frame; the perf overlay wants the whole frame.
    this.renderer.info.autoReset = false;
    this.post = new Post(this.renderer);
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    this.scene.fog = this.fog;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 4;
    this.sun.shadow.intensity = SHADOW_INTENSITY;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    // left/right/top/bottom are fitted to the island (fitShadow).
    const sc = this.sun.shadow.camera;
    sc.near = 1;
    sc.far = 60;

    this.scene.add(this.sky.mesh, this.turntable, this.skyLight, this.sun, this.sun.target);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  /** What doesn't drift with the time of day; the rest comes in through applyLight. */
  applyPreset(p: EraPreset): void {
    this.sky.setNight(p.ocean.stars, p.sky.aurora);
  }

  /** Sun, sky, fog and bloom for this moment of the era's day (daylight.ts). */
  applyLight(l: Light): void {
    this.sky.setColors(l.skyTop, l.skyBottom);
    this.fog.color.copy(l.fogColor);
    this.fog.density = l.fogDensity;

    this.skyLight.color.copy(l.skyColor);
    this.skyLight.groundColor.copy(l.groundColor);
    this.skyLight.intensity = l.skyIntensity;

    const el = deg(l.sunElevation);
    const az = deg(l.sunAzimuth);
    this.sun.color.copy(l.sunColor);
    this.sun.intensity = l.sunIntensity;
    this.sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(25);
    this.fitShadow(this.framePoints());

    this.post.bloomStrength = l.bloom;
  }

  /** Pixel ratio, shadow resolution and post-processing (game/quality.ts). */
  applyQuality(level: RenderLevel): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, level.pixelRatio));
    this.post.configure(level.bloom, level.tiltShift);
    this.sizePost();
    const shadow = this.sun.shadow;
    if (shadow.mapSize.x !== level.shadowSize) {
      shadow.mapSize.set(level.shadowSize, level.shadowSize);
      // The map is allocated at its first render; drop it so the next one uses the new size.
      shadow.map?.dispose();
      shadow.map = null;
    }
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
    this.clock += dt;
    const [a, b, c] = DRIFT.periods.map((period) => Math.sin((this.clock / period) * Math.PI * 2));
    const still = this.still ? 0 : 1;
    aim(this.camera, this.current.distance, this.current.targetY, still * (DRIFT.sway * a + DRIFT.swayFine * b), still * DRIFT.tilt * c);
    this.sky.update(this.clock, this.camera.position);
  }

  render(): void {
    this.renderer.info.reset();
    if (this.post.enabled) this.post.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.sizePost();
    for (const cam of [this.camera, this.probe]) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    this.computeGoal();
    this.snap = true;
  }

  private sizePost(): void {
    const { x, y } = this.renderer.getDrawingBufferSize(_size);
    this.post.setSize(x, y);
  }

  private computeGoal(): void {
    const points = this.framePoints();
    this.fitShadow(points);
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

  /**
   * Fit the sun's shadow box to the island's hull, seen from the sun: as
   * tight as it goes on a low island (sharper shadows), and still around
   * the tallest columns when a low sun stretches their shadows.
   */
  private fitShadow(points: Vector3[]): void {
    const sc = this.sun.shadow.camera;
    // Aimed the way DirectionalLightShadow aims it every frame.
    sc.position.copy(this.sun.position);
    sc.lookAt(this.sun.target.position);
    sc.updateMatrixWorld();
    let left = Infinity;
    let right = -Infinity;
    let bottom = Infinity;
    let top = -Infinity;
    for (const p of points) {
      _v.copy(p).applyMatrix4(sc.matrixWorldInverse);
      left = Math.min(left, _v.x);
      right = Math.max(right, _v.x);
      bottom = Math.min(bottom, _v.y);
      top = Math.max(top, _v.y);
    }
    sc.left = left - SHADOW_MARGIN;
    sc.right = right + SHADOW_MARGIN;
    sc.bottom = bottom - SHADOW_MARGIN;
    sc.top = top + SHADOW_MARGIN;
    sc.updateProjectionMatrix();
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

/** `sway` turns the camera round the island and `tilt` lifts it, both in radians (the idle drift). */
function aim(cam: PerspectiveCamera, distance: number, targetY: number, sway = 0, tilt = 0): void {
  const el = deg(CAMERA.elevationDeg) + tilt;
  const flat = distance * Math.cos(el);
  cam.position.set(Math.sin(sway) * flat, targetY + distance * Math.sin(el), Math.cos(sway) * flat);
  cam.lookAt(0, targetY, 0);
}
