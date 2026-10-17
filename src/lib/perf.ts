import type { WebGLRenderer } from 'three';

/** Tiny fps / draw-call readout, shown with ?perf. Returns a per-frame tick. */
export function createPerfOverlay(renderer: WebGLRenderer, parent: HTMLElement): (dt: number) => void {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:10;padding:4px 6px;border-radius:4px;' +
    'font:12px/1.3 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.55);pointer-events:none';
  parent.appendChild(el);
  let frames = 0;
  let elapsed = 0;
  return (dt) => {
    frames++;
    elapsed += dt;
    if (elapsed < 0.5) return;
    const { calls, triangles } = renderer.info.render;
    el.textContent = `${Math.round(frames / elapsed)} fps · ${calls} calls · ${(triangles / 1000).toFixed(1)}k tris`;
    frames = 0;
    elapsed = 0;
  };
}
