import {
  BufferGeometry,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Ambient Era I gulls circling the island. One instanced draw call; wings
// flap by scaling the instance's y (the tips swing through the body plane).

interface Bird {
  radius: number;
  height: number;
  speed: number;
  phase: number;
}

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _qRoll = new Quaternion();
const _s = new Vector3();
const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);

export class Gulls {
  readonly mesh: InstancedMesh;
  private readonly birds: Bird[];

  constructor(count = 4) {
    this.birds = Array.from({ length: count }, (_, i) => ({
      radius: 4.5 + i * 1.3,
      height: 3.2 + (i % 3) * 0.7,
      speed: (i % 2 === 0 ? 1 : -1) * (0.32 - i * 0.03),
      phase: i * 2.1,
    }));
    const material = new MeshStandardMaterial({ color: 0xf8f8f4, flatShading: true, roughness: 0.8, side: DoubleSide });
    this.mesh = new InstancedMesh(gullGeometry(), material, count);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  update(time: number): void {
    this.birds.forEach((b, i) => {
      const a = b.phase + time * b.speed;
      _p.set(Math.sin(a) * b.radius, b.height + Math.sin(time * 0.6 + b.phase) * 0.35, Math.cos(a) * b.radius);
      // Face along the direction of travel and bank into the turn.
      const sign = Math.sign(b.speed);
      _q.setFromAxisAngle(UP, Math.atan2(Math.cos(a) * sign, -Math.sin(a) * sign));
      _qRoll.setFromAxisAngle(FORWARD, -0.25 * sign);
      _q.multiply(_qRoll);
      // Flap in bursts, glide in between.
      const flapping = Math.max(0, Math.sin(time * 0.5 + b.phase));
      const flap = 1 + 1.3 * flapping * Math.sin(time * 9 + b.phase * 3);
      _s.set(1, flap, 1);
      this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function gullGeometry(): BufferGeometry {
  const body = new ConeGeometry(0.05, 0.32, 4).rotateX(Math.PI / 2).toNonIndexed();
  body.deleteAttribute('uv');
  const wings = new BufferGeometry();
  // prettier-ignore
  wings.setAttribute('position', new Float32BufferAttribute([
    0, 0, 0.07,   -0.44, 0.09, -0.03,   0, 0, -0.09,
    0, 0, 0.07,    0, 0, -0.09,          0.44, 0.09, -0.03,
  ], 3));
  wings.computeVertexNormals();
  const merged = mergeGeometries([body, wings]);
  if (!merged) throw new Error('gull geometry merge failed');
  return merged;
}
