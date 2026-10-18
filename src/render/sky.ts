import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, type Vector3 } from 'three';

// The sky: a dome that follows the camera, so its horizon sits at the true
// horizon behind the sea. At and below the horizon it is sky.bottom, which
// the ocean fades into with distance (ocean.ts), so the sea's far edge
// never shows; above, it climbs to sky.top. The Astral era hangs its stars
// and aurora here.

const RADIUS = 300;

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform float uTime;
uniform float uStars;
uniform float uAurora;
uniform vec3 uAuroraNear;
uniform vec3 uAuroraFar;
varying vec3 vDir;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  // The camera sees only a strip a few degrees deep, so everything happens near the horizon.
  vec3 col = mix(uBottom, uTop, smoothstep(0.01, 0.12, h));

  // Around the horizon: 0 straight ahead (the camera looks toward -z).
  float around = atan(d.x, -d.z);
  if (uStars > 0.0 && h > 0.0) {
    vec2 grid = vec2(around * 90.0, h * 400.0);
    vec2 cell = floor(grid);
    float n = hash(cell);
    vec2 off = vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
    vec2 f = fract(grid) - 0.5 - off * 0.6;
    float twinkle = 0.55 + 0.45 * sin(uTime * 2.1 + n * 50.0);
    float star = step(0.93, n) * smoothstep(0.12, 0.0, length(f)) * twinkle;
    col += vec3(0.8, 0.88, 1.0) * star * uStars * smoothstep(0.004, 0.015, h);
  }
  if (uAurora > 0.0) {
    // Curtains rising off the horizon, waving slowly, finely streaked; low
    // enough to sit in the strip of sky the camera sees.
    float wave = 0.008 * sin(around * 3.0 + uTime * 0.06) + 0.005 * sin(around * 7.0 - uTime * 0.09);
    float band = smoothstep(0.002, 0.012, h) * (1.0 - smoothstep(0.03, 0.075, h - wave));
    float streak = 0.55 + 0.45 * sin(around * 38.0 + 2.5 * sin(around * 5.0 + uTime * 0.2) + uTime * 0.25);
    float sway = 0.6 + 0.4 * sin(around * 2.0 - uTime * 0.04);
    vec3 tint = mix(uAuroraNear, uAuroraFar, smoothstep(0.01, 0.06, h - wave));
    col += tint * band * streak * sway * uAurora * 0.7;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  readonly mesh: Mesh;

  private readonly uniforms = {
    uTop: { value: new Color() },
    uBottom: { value: new Color() },
    uTime: { value: 0 },
    uStars: { value: 0 },
    uAurora: { value: 0 },
    uAuroraNear: { value: new Color() },
    uAuroraFar: { value: new Color() },
  };

  constructor() {
    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new Mesh(new SphereGeometry(RADIUS, 32, 24), material);
    // Drawn first, behind everything.
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
  }

  /** `bottom` is the horizon glow, and the sky below it. */
  setColors(top: Color, bottom: Color): void {
    this.uniforms.uTop.value.copy(top);
    this.uniforms.uBottom.value.copy(bottom);
  }

  /** The Astral era's sky: stars, and the aurora's near and far colors (or null). */
  setNight(stars: number, aurora: readonly [number, number] | null): void {
    this.uniforms.uStars.value = stars;
    this.uniforms.uAurora.value = aurora ? 1 : 0;
    if (aurora) {
      this.uniforms.uAuroraNear.value.setHex(aurora[0]);
      this.uniforms.uAuroraFar.value.setHex(aurora[1]);
    }
  }

  /** Keep the dome on the camera, so its horizon is the true one. */
  update(time: number, camera: Vector3): void {
    this.uniforms.uTime.value = time;
    this.mesh.position.copy(camera);
  }
}
