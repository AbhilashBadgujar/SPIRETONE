import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';

// Sweeping lighthouse beams: one additive light cone per lamp, slowly
// rotating. Turntable space. Kept faint: several lighthouses overlap, and
// additive light adds up fast. Soft all round: brightest just off the lamp,
// fading out along the beam, and fading wherever the cone's skin is seen
// edge-on, so a beam reads as a shaft of light, not a paper fan.

const BEAM_LENGTH = 3.4;
const BEAM_RADIUS = 0.42;
const SWEEP_SPEED = 0.9;
const GAIN = 2.4;

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3(1, 1, 1);
const UP = new Vector3(0, 1, 0);

const vertexShader = /* glsl */ `
varying float vAlong;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vAlong = position.x / ${BEAM_LENGTH.toFixed(2)};
  vec4 local = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
  local = instanceMatrix * local;
  n = mat3(instanceMatrix) * n;
  #endif
  vec4 mv = modelViewMatrix * local;
  vNormal = normalize(normalMatrix * n);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlong;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float along = (1.0 - vAlong) * (1.0 - vAlong) * smoothstep(0.0, 0.06, vAlong);
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  // The soft falloffs take most of the light; GAIN gives back the presets' brightness.
  gl_FragColor = vec4(uColor, along * pow(facing, 1.6) * uOpacity * ${GAIN.toFixed(2)});
  #include <colorspace_fragment>
}`;

export class Beams {
  readonly mesh: InstancedMesh;
  private readonly material: ShaderMaterial;

  constructor(capacity: number) {
    // Apex at the origin pointing along +x.
    const geo = new ConeGeometry(BEAM_RADIUS, BEAM_LENGTH, 16, 1, true)
      .translate(0, -BEAM_LENGTH / 2, 0)
      .rotateZ(Math.PI / 2);

    this.material = new ShaderMaterial({
      uniforms: { uColor: { value: new Color() }, uOpacity: { value: 0.22 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      // Fog would tint the faded far end toward the fog color, and additively that glows.
      fog: false,
    });
    this.mesh = new InstancedMesh(geo, this.material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  setOpacity(opacity: number): void {
    this.material.uniforms.uOpacity.value = opacity;
  }

  setColor(hex: number): void {
    this.material.uniforms.uColor.value.setHex(hex);
  }

  update(time: number, lamps: readonly Vector3[]): void {
    lamps.forEach((lamp, i) => {
      _q.setFromAxisAngle(UP, time * SWEEP_SPEED + i * 1.7);
      this.mesh.setMatrixAt(i, _m.compose(lamp, _q, _s));
    });
    this.mesh.count = lamps.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
