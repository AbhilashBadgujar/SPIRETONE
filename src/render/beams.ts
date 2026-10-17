import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';

// Sweeping lighthouse beams: one additive light cone per lamp, fading from
// the lamp outward, slowly rotating. Turntable space. Kept faint: several
// lighthouses overlap, and additive light adds up fast.

const BEAM_LENGTH = 3.4;
const BEAM_RADIUS = 0.38;
const SWEEP_SPEED = 0.9;

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3(1, 1, 1);
const UP = new Vector3(0, 1, 0);

export class Beams {
  readonly mesh: InstancedMesh;
  private readonly material: MeshBasicMaterial;

  constructor(capacity: number) {
    // Apex at the origin pointing along +x, brightness falling off with distance.
    const geo = new ConeGeometry(BEAM_RADIUS, BEAM_LENGTH, 12, 1, true)
      .translate(0, -BEAM_LENGTH / 2, 0)
      .rotateZ(Math.PI / 2);
    const pos = geo.getAttribute('position');
    const colors: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const f = Math.max(0, 1 - pos.getX(i) / BEAM_LENGTH);
      colors.push(f, f, f);
    }
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));

    this.material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.22,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
      // Fog would tint the faded far end toward the fog color, and additively that glows.
      fog: false,
    });
    this.mesh = new InstancedMesh(geo, this.material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  setOpacity(opacity: number): void {
    this.material.opacity = opacity;
  }

  setColor(hex: number): void {
    this.material.color.copy(new Color(hex));
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
