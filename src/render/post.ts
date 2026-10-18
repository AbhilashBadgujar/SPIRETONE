import {
  ACESFilmicToneMapping,
  ColorManagement,
  HalfFloatType,
  RawShaderMaterial,
  SRGBTransfer,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// The soft finish over the scene: bloom, so lit windows, lamps and the
// crystal glow, and a tilt-shift falloff at the top and bottom of the
// frame, so the island reads as a miniature. The vignette is CSS
// (index.html): free, and there at every quality level.
//
//   scene   MSAA HDR target
//   tilt x  horizontal half of the blur, resolved into a plain HDR target
//   bloom   adds onto that target (never onto the MSAA one: three discards
//           a multisampled buffer's samples once they are resolved)
//   tilt y  vertical half, then tone mapping and sRGB to the screen

/** HDR luminance where bloom starts. Sunlit walls peak around 0.65; boosted glow (GLOW_LUMINANCE) clears it. */
const BLOOM_THRESHOLD = 1;
const BLOOM_RADIUS = 0.4;
/**
 * While bloom is on, glow materials are scaled to this luminance whatever
 * the era's emissive color, so every era's windows clear the threshold by
 * the same margin and none burns out to white.
 */
export const GLOW_LUMINANCE = 1.4;

const TILT = {
  /** Screen height (0 bottom, 1 top) of the sharpest line: the island's middle. */
  focus: 0.47,
  /** Half-height of the band around it that stays sharp. */
  band: 0.24,
  /** Blur step per unit of screen height past the band, as a fraction of the width. */
  blur: 0.012,
};

const vertexShader = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Nine-tap Gaussian along uStep, scaled by distance past the in-focus band;
// one tap inside it.
const fragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uStep;
uniform float uFocus;
uniform float uBand;
#ifdef OUTPUT
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
#endif
varying vec2 vUv;
void main() {
  vec2 d = uStep * max(0.0, abs(vUv.y - uFocus) - uBand);
  vec4 c = texture2D(tDiffuse, vUv);
  if (d != vec2(0.0)) {
    c *= 0.1633;
    c += (texture2D(tDiffuse, vUv - d) + texture2D(tDiffuse, vUv + d)) * 0.1531;
    c += (texture2D(tDiffuse, vUv - 2.0 * d) + texture2D(tDiffuse, vUv + 2.0 * d)) * 0.12245;
    c += (texture2D(tDiffuse, vUv - 3.0 * d) + texture2D(tDiffuse, vUv + 3.0 * d)) * 0.0918;
    c += (texture2D(tDiffuse, vUv - 4.0 * d) + texture2D(tDiffuse, vUv + 4.0 * d)) * 0.051;
  }
  gl_FragColor = c;
#ifdef OUTPUT
  gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
  #ifdef SRGB_TRANSFER
  gl_FragColor = sRGBTransferOETF(gl_FragColor);
  #endif
#endif
}`;

function tiltMaterial(output: boolean, srgb: boolean): RawShaderMaterial {
  const defines: Record<string, string> = {};
  if (output) defines.OUTPUT = '';
  if (output && srgb) defines.SRGB_TRANSFER = '';
  return new RawShaderMaterial({
    defines,
    uniforms: {
      tDiffuse: { value: null },
      uStep: { value: new Vector2() },
      uFocus: { value: TILT.focus },
      uBand: { value: TILT.band },
      toneMappingExposure: { value: 1 },
    },
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
}

export class Post {
  /** Off: the renderer draws straight to the screen with its own tone mapping and MSAA. */
  enabled = false;

  private readonly scene = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
  private readonly hdr = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly bloom = new UnrealBloomPass(new Vector2(1, 1), 0, BLOOM_RADIUS, BLOOM_THRESHOLD);
  private readonly tiltX: RawShaderMaterial;
  private readonly output: RawShaderMaterial;
  private readonly quad = new FullScreenQuad();
  private tiltShift = false;
  private aspect = 1;

  constructor(private readonly renderer: WebGLRenderer) {
    // The output pass stands in for the renderer's own tone mapping (ACES, scene.ts).
    if (renderer.toneMapping !== ACESFilmicToneMapping) throw new Error('Post expects ACES tone mapping');
    const srgb = ColorManagement.getTransfer(renderer.outputColorSpace) === SRGBTransfer;
    this.tiltX = tiltMaterial(false, srgb);
    this.output = tiltMaterial(true, srgb);
  }

  /** Bloom strength for the current era. */
  set bloomStrength(strength: number) {
    this.bloom.strength = strength;
  }

  /** `tiltShift`: the blur falloff; bloom is always on while `enabled`. */
  configure(enabled: boolean, tiltShift: boolean): void {
    this.enabled = enabled;
    this.tiltShift = tiltShift;
    // Past 2x pixel density, 2x MSAA is plenty and saves a lot of memory.
    const samples = this.renderer.getPixelRatio() >= 2 ? 2 : 4;
    if (this.scene.samples !== samples) {
      this.scene.samples = samples;
      this.scene.dispose();
    }
    this.updateSteps();
  }

  /** Drawing-buffer size in pixels. */
  setSize(width: number, height: number): void {
    this.scene.setSize(width, height);
    this.hdr.setSize(width, height);
    this.bloom.setSize(width, height);
    this.aspect = width / Math.max(1, height);
    this.updateSteps();
  }

  render(scene: Scene, camera: Camera): void {
    const r = this.renderer;
    r.setRenderTarget(this.scene);
    r.render(scene, camera);

    this.tiltX.uniforms.tDiffuse.value = this.scene.texture;
    this.quad.material = this.tiltX;
    r.setRenderTarget(this.hdr);
    this.quad.render(r);

    this.bloom.render(r, this.hdr, this.hdr, 0, false);

    this.output.uniforms.tDiffuse.value = this.hdr.texture;
    this.output.uniforms.toneMappingExposure.value = r.toneMappingExposure;
    this.quad.material = this.output;
    r.setRenderTarget(null);
    this.quad.render(r);
  }

  private updateSteps(): void {
    const blur = this.tiltShift ? TILT.blur : 0;
    this.tiltX.uniforms.uStep.value.set(blur, 0);
    // Same reach in pixels both ways.
    this.output.uniforms.uStep.value.set(0, blur * this.aspect);
  }
}
