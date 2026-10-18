import { Color, Mesh, MeshStandardMaterial, PlaneGeometry, ShaderChunk } from 'three';
import type { EraPreset } from '../data/eras';
import { LAYOUT } from './layout';

// Faceted ocean: waves are displaced in the vertex shader and flatShading
// derives facet normals from them. Surf is shaded into the same surface so
// wave crests can't slice through it. Era IV's starfield twinkles in the
// water as unlit points. Shadows on the water are faint and fade out away
// from the shore, so a low sun's long shadows read as shade, not black blades.

/** Shadow strength on the water at the shoreline. */
const WATER_SHADOW = 0.6;
/** Distance past the shoreline over which water shadows fade out. */
const WATER_SHADOW_FADE = 8;
const SHADOW_NEEDLE = 'directionalLightShadow.shadowIntensity,';

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
    uStars: { value: 0 },
    uAurora: { value: 0 },
    uAuroraNear: { value: new Color() },
    uAuroraFar: { value: new Color() },
  };
  private readonly material: MeshStandardMaterial;

  constructor() {
    const material = new MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.3 });
    this.material = material;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uTime;
uniform float uWaveHeight;
uniform float uWaveSpeed;
varying float vDist;
varying vec2 vXZ;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float t = uTime * uWaveSpeed;
vec2 p = transformed.xz;
transformed.y += uWaveHeight * (sin(p.x * 0.35 + t * 1.3) + sin(p.y * 0.42 - t * 1.1)
  + 0.6 * sin((p.x + p.y) * 0.8 + t * 2.1));
vDist = length(p);
vXZ = p;`,
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
uniform float uStars;
uniform float uAurora;
uniform vec3 uAuroraNear;
uniform vec3 uAuroraFar;
varying float vDist;
varying vec2 vXZ;`,
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
        )
        .replace(
          '#include <lights_fragment_begin>',
          `float waterShadow = ${WATER_SHADOW.toFixed(2)} * (1.0 - smoothstep(uShore, uShore + ${WATER_SHADOW_FADE.toFixed(1)}, vDist));
${waterLights()}`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
if (uStars > 0.0) {
  // One candidate star per cell, most cells empty; kept out of the surf.
  vec2 sp = vXZ * 0.9;
  vec2 cell = floor(sp);
  float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  vec2 off = vec2(fract(h * 17.0), fract(h * 31.0)) - 0.5;
  float d = length(fract(sp) - 0.5 - off * 0.6);
  float twinkle = 0.55 + 0.45 * sin(uTime * 2.3 + h * 60.0);
  float star = step(0.9, h) * smoothstep(0.075, 0.0, d) * twinkle;
  star *= smoothstep(uShore + 0.6, uShore + 3.0, vDist);
  totalEmissiveRadiance += mix(vec3(0.75, 0.85, 1.0), uFoam, 0.4) * star * uStars * 1.6;
}
if (uAurora > 0.0) {
  // Two wavering curtains of light lying on the far water behind the island
  // (the camera looks toward -z), shimmering along their length.
  float z = -vXZ.y;
  float w1 = z - 15.0 - 2.5 * sin(vXZ.x * 0.11 + uTime * 0.07);
  float w2 = z - 24.0 - 3.5 * sin(vXZ.x * 0.08 - uTime * 0.05 + 1.7);
  float shimmer = 0.6 + 0.4 * sin(vXZ.x * 0.9 + uTime * 0.6) * sin(vXZ.x * 0.37 - uTime * 0.4);
  // Fine vertical streaks so it reads as curtains, not blobs.
  shimmer *= 0.75 + 0.25 * sin(vXZ.x * 3.1 + 2.0 * sin(z * 0.4 + uTime * 0.3));
  vec3 a = uAuroraNear * exp(-w1 * w1 / 10.0) + uAuroraFar * exp(-w2 * w2 / 18.0);
  totalEmissiveRadiance += a * shimmer * uAurora * 0.45;
}`,
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
    this.uniforms.uStars.value = p.ocean.stars;
    this.uniforms.uAurora.value = p.ocean.aurora ? 1 : 0;
    if (p.ocean.aurora) {
      this.uniforms.uAuroraNear.value.setHex(p.ocean.aurora[0]);
      this.uniforms.uAuroraFar.value.setHex(p.ocean.aurora[1]);
    }
    this.material.roughness = p.ocean.roughness;
  }

  update(time: number): void {
    this.uniforms.uTime.value = time;
  }

  setSurf(amount: number): void {
    this.uniforms.uSurf.value = amount;
  }
}

/** three's light loop with the sun's shadow scaled by `waterShadow`. */
function waterLights(): string {
  const chunk = ShaderChunk.lights_fragment_begin;
  if (!chunk.includes(SHADOW_NEEDLE)) throw new Error('lights_fragment_begin changed: update the water shadow patch');
  return chunk.split(SHADOW_NEEDLE).join('directionalLightShadow.shadowIntensity * waterShadow,');
}
