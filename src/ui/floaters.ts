import { Vector3 } from 'three';

// Pooled floating labels ("+12", "+3/s", icon chips). World-anchored ones
// follow a turntable-space point as the island turns.

export type FloaterKind = 'pop' | 'gain' | 'tag' | 'bad';

type Project = (local: Vector3, out: { x: number; y: number }) => boolean;

/** Numeric floaters with the same key merge while young instead of stacking. */
export interface Merge {
  key: string;
  value: number;
  format: (total: number) => string;
}

interface Floater {
  el: HTMLDivElement;
  active: boolean;
  key: string | null;
  total: number;
  anchor: Vector3;
  /** Screen-space floaters skip projection. */
  world: boolean;
  x: number;
  y: number;
  age: number;
  life: number;
  rise: number;
}

const LIFE: Record<FloaterKind, number> = { pop: 1.1, gain: 1.5, tag: 1.6, bad: 0.9 };
const RISE: Record<FloaterKind, number> = { pop: 34, gain: 54, tag: 46, bad: 24 };
/** A keyed floater younger than this absorbs the next one with its key. */
const MERGE_WINDOW = 0.6;

export class Floaters {
  private readonly pool: Floater[] = [];
  private readonly screen = { x: 0, y: 0 };

  constructor(
    parent: HTMLElement,
    private readonly project: Project,
    size = 32,
  ) {
    const layer = document.createElement('div');
    layer.className = 'floaters';
    parent.appendChild(layer);
    for (let i = 0; i < size; i++) {
      const el = document.createElement('div');
      el.className = 'floater';
      el.hidden = true;
      layer.appendChild(el);
      this.pool.push({
        el,
        active: false,
        key: null,
        total: 0,
        anchor: new Vector3(),
        world: true,
        x: 0,
        y: 0,
        age: 0,
        life: 1,
        rise: 0,
      });
    }
  }

  /** Free slots; ambient pops back off when this runs low. */
  get free(): number {
    return this.pool.reduce((n, f) => n + (f.active ? 0 : 1), 0);
  }

  /** `content` is HTML, or a Merge for numbers that should add up. */
  at(local: Vector3, content: string | Merge, kind: FloaterKind): void {
    if (this.merge(content)) return;
    const f = this.take(content, kind);
    if (!f) return;
    f.world = true;
    f.anchor.copy(local);
  }

  atScreen(x: number, y: number, content: string | Merge, kind: FloaterKind): void {
    if (this.merge(content)) return;
    const f = this.take(content, kind);
    if (!f) return;
    f.world = false;
    f.x = x;
    f.y = y;
  }

  update(dt: number): void {
    for (const f of this.pool) {
      if (!f.active) continue;
      f.age += dt;
      const p = f.age / f.life;
      if (p >= 1) {
        f.active = false;
        f.el.hidden = true;
        continue;
      }
      if (f.world) {
        if (!this.project(f.anchor, this.screen)) {
          f.el.style.opacity = '0';
          continue;
        }
        f.x = this.screen.x;
        f.y = this.screen.y;
      }
      const ease = 1 - (1 - p) * (1 - p);
      const scale = p < 0.12 ? 0.6 + (p / 0.12) * 0.4 : 1;
      const alpha = p < 0.1 ? p / 0.1 : p > 0.6 ? 1 - (p - 0.6) / 0.4 : 1;
      f.el.style.transform = `translate3d(${f.x.toFixed(1)}px, ${(f.y - f.rise * ease).toFixed(1)}px, 0) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
      f.el.style.opacity = alpha.toFixed(3);
    }
  }

  /** Folds a keyed number into a young floater with the same key. */
  private merge(content: string | Merge): boolean {
    if (typeof content === 'string') return false;
    const f = this.pool.find((p) => p.active && p.key === content.key && p.age < MERGE_WINDOW);
    if (!f) return false;
    f.total += content.value;
    f.el.innerHTML = content.format(f.total);
    f.age = Math.min(f.age, 0.05);
    return true;
  }

  private take(content: string | Merge, kind: FloaterKind): Floater | null {
    const f = this.pool.find((p) => !p.active);
    if (!f) return null;
    const keyed = typeof content !== 'string';
    f.active = true;
    f.key = keyed ? content.key : null;
    f.total = keyed ? content.value : 0;
    f.age = 0;
    f.life = LIFE[kind];
    f.rise = RISE[kind];
    f.el.className = `floater floater-${kind}`;
    f.el.innerHTML = keyed ? content.format(content.value) : content;
    f.el.style.opacity = '0';
    f.el.hidden = false;
    return f;
  }
}
