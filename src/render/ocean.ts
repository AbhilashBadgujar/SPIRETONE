import { Color, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import type { EraPreset } from '../data/eras';
import { LAYOUT } from './layout';

// Faceted ocean: waves are displaced in the vertex shader and flatShading
// derives facet normals from them. Surf is shaded into the same surface so
// wave crests can't slice through it.

export class Ocean {
  readonly water: Mesh;

  private readonly uniforms = {
    uTime: { value: 0 },
    uWaveHeight: { value: 0.12 },
    uWaveSpeed: { value: 0.6 },
    uShallow: { value: new Color() },
    uDeep: { value: new Color() },
    uFoam: { value: new Color() },
    uShore: { value: LAYOUT.islandRadius + 0.15 },
    /** 0..1; fades out while the island is lifted during Ascension. */
    uSurf: { value: 1 },
  };

  constructor() {
    const material = new MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.3 });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uTime;
uniform float uWaveHeight;
uniform float uWaveSpeed;
varying float vDist;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float t = uTime * uWaveSpeed;
vec2 p = transformed.xz;
transformed.y += uWaveHeight * (sin(p.x * 0.35 + t * 1.3) + sin(p.y * 0.42 - t * 1.1)
  + 0.6 * sin((p.x + p.y) * 0.8 + t * 2.1));
vDist = length(p);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform float uShore;
uniform float uSurf;
varying float vDist;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
diffuseColor.rgb *= mix(uShallow, uDeep, smoothstep(6.0, 34.0, vDist));
float shore = vDist - uShore;
// A ring hugging the shoreline: fades out inward too, so nothing shows
// under the island when it lifts off.
float surf = (1.0 - smoothstep(0.0, 0.85, shore)) * smoothstep(-0.6, -0.1, shore);
surf *= 0.7 + 0.3 * sin(shore * 14.0 - uTime * 2.4);
diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, clamp(surf, 0.0, 1.0) * 0.8 * uSurf);`,
        );
    };

    this.water = new Mesh(new PlaneGeometry(260, 260, 120, 120).rotateX(-Math.PI / 2), material);
    this.water.position.y = LAYOUT.waterLevel;
    this.water.receiveShadow = true;
  }

  applyPreset(p: EraPreset): void {
    this.uniforms.uShallow.value.setHex(p.ocean.shallow);
    this.uniforms.uDeep.value.setHex(p.ocean.deep);
    this.uniforms.uFoam.value.setHex(p.ocean.foam);
    this.uniforms.uWaveHeight.value = p.ocean.waveHeight;
    this.uniforms.uWaveSpeed.value = p.ocean.waveSpeed;
  }

  update(time: number): void {
    this.uniforms.uTime.value = time;
  }

  setSurf(amount: number): void {
    this.uniforms.uSurf.value = amount;
  }
}
