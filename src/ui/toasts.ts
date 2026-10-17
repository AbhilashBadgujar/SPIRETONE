import { ACH_BY_ID, type AchId } from '../data/achievements';
import { ACHIEVEMENT_ICONS } from './achievement-icons';
import { ICONS } from './icons';

// Achievement toasts (GDD §9, §10: a local unlock with a toast). One at a
// time under the top-right pills, queued, and held back while something
// else owns the screen (the Ascension sequence, the era card).

/** Seconds a toast stays up. */
const SHOW = 3.2;
/** Seconds between one toast leaving and the next arriving. */
const GAP = 0.25;
/** Matches the toast-out animation in hud.css. */
const OUT_MS = 300;

export class Toasts {
  private readonly el: HTMLDivElement;
  private readonly queue: AchId[] = [];
  private current: { el: HTMLElement; t: number } | null = null;
  private gap = 0;

  constructor(
    parent: HTMLElement,
    /** Called as each toast appears, for its sound. */
    private readonly onShow: (id: AchId) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'toasts';
    parent.appendChild(this.el);
  }

  get pending(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }

  push(id: AchId): void {
    this.queue.push(id);
  }

  /** `held`: keep queued toasts waiting (the one on screen still finishes). */
  update(dt: number, held: boolean): void {
    if (this.current) {
      this.current.t -= dt;
      if (this.current.t > 0) return;
      const el = this.current.el;
      el.classList.add('out');
      window.setTimeout(() => el.remove(), OUT_MS);
      this.current = null;
      this.gap = GAP;
      return;
    }
    this.gap -= dt;
    if (held || this.gap > 0 || this.queue.length === 0) return;
    this.show(this.queue.shift()!);
  }

  private show(id: AchId): void {
    const a = ACH_BY_ID[id];
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `
      <span class="toast-icon">${ACHIEVEMENT_ICONS[id]}</span>
      <span class="toast-body">
        <b class="toast-name"></b>
        <span class="toast-points">${ICONS.trophy}${a.points}G</span>
      </span>`;
    el.querySelector('.toast-name')!.textContent = a.name;
    this.el.appendChild(el);
    this.current = { el, t: SHOW };
    this.onShow(id);
  }
}
