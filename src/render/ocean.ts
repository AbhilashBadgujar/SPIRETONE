import { Color, Mesh, MeshStandardMaterial, PlaneGeometry, ShaderChunk } from 'three';
import type { EraPreset } from '../data/eras';
import type { Light } from './daylight';
import { LAYOUT } from './layout';

// Faceted ocean: waves are displaced in the vertex shader and flatShading
// derives facet normals from them. Surf is shaded into the same surface so
// wave crests can't slice through it. Era IV's starfield twinkles in the
// water as unlit points. Shadows on the water are faint and fade out away
// from the shore, so a low sun's long shadows read as shade, not black blades.
//
// The sea takes no scene fog. Far out it mirrors the sky (more the lower you
// look across it), then hazes into the horizon color (sky.bottom) itself,
// before tone mapping, all the way before its far edge: the sky dome
// (sky.ts) is that color at and below the horizon, so sea and sky meet
// without a seam on either render path.

/** Shadow strength on the water at the shoreline. */
const WATER_SHADOW = 0.6;
/** Distance past the shoreline over which water shadows fade out. */
const WATER_SHADOW_FADE = 8;
const SHADOW_NEEDLE = 'directionalLightShadow.shadowIntensity,';
/** Distance from the island over which the sea fades fully into the horizon haze (the plane ends at 130). */
const HAZE = { from: 55, to: 125 };

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
    uHaze: { value: new Color() },
    uHazeDensity: { value: 0 },
    /** The sky just above the horizon, which the far sea mirrors. */
    uSky: { value: new Color() },
  };
  private readonly material: MeshStandardMaterial;

  constructor() {
    const material = new MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.3, fog: false });
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
varying vec2 vXZ;
varying float vDepth;`,
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
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
vDepth = -mvPosition.z;`,
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
uniform vec3 uHaze;
uniform float uHazeDensity;
uniform vec3 uSky;
varying float vDist;
varying vec2 vXZ;
varying float vDepth;`,
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
}`,
        )
        .replace(
          '#include <tonemapping_fragment>',
          `// Fresnel off the calm surface (not the facets, which would glitter in bands).
vec3 seaUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
float grazing = pow(1.0 - clamp(dot(seaUp, normalize(vViewPosition)), 0.0, 1.0), 5.0);
gl_FragColor.rgb = mix(gl_FragColor.rgb, uSky, grazing * 0.85);
float fogged = 1.0 - exp(-uHazeDensity * uHazeDensity * vDepth * vDepth);
gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, max(fogged, smoothstep(${HAZE.from.toFixed(1)}, ${HAZE.to.toFixed(1)}, vDist)));
#include <tonemapping_fragment>`,
        );
    };

    this.water = new Mesh(new PlaneGeometry(260, 260, 120, 120).rotateX(-Math.PI / 2), material);
    this.water.position.y = LAYOUT.waterLevel;
    this.water.receiveShadow = true;
  }

  /** What doesn't drift with the time of day; colors come in through applyLight. */
  applyPreset(p: EraPreset): void {
    this.uniforms.uFoam.value.setHex(p.ocean.foam);
    this.uniforms.uWaveHeight.value = p.ocean.waveHeight;
    this.uniforms.uWaveSpeed.value = p.ocean.waveSpeed;
    this.uniforms.uStars.value = p.ocean.stars;
    this.material.roughness = p.ocean.roughness;
  }

  applyLight(l: Light): void {
    this.uniforms.uShallow.value.copy(l.shallow);
    this.uniforms.uDeep.value.copy(l.deep);
    this.uniforms.uHaze.value.copy(l.skyBottom);
    this.uniforms.uSky.value.copy(l.skyBottom);
    this.uniforms.uHazeDensity.value = l.fogDensity;
  }

  update(time: number): void {
    this.uniforms.uTime.value = time;
  }

  setSurf(amount: number): void {
    this.uniforms.uSurf.value = amount;
  }

  /** Wave height above the water level at world (x, z): the vertex shader's displacement, for things afloat. */
  waveAt(x: number, z: number): number {
    const u = this.uniforms;
    const t = u.uTime.value * u.uWaveSpeed.value;
    return u.uWaveHeight.value * (Math.sin(x * 0.35 + t * 1.3) + Math.sin(z * 0.42 - t * 1.1) + 0.6 * Math.sin((x + z) * 0.8 + t * 2.1));
  }
}

/** three's light loop with the sun's shadow scaled by `waterShadow`. */
function waterLights(): string {
  const chunk = ShaderChunk.lights_fragment_begin;
  if (!chunk.includes(SHADOW_NEEDLE)) throw new Error('lights_fragment_begin changed: update the water shadow patch');
  return chunk.split(SHADOW_NEEDLE).join('directionalLightShadow.shadowIntensity * waterShadow,');
}
