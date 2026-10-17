import { STRUCTURE_NAMES, type StructureId } from '../data/ids';
import { STRUCTURE_ICONS } from './icons';

// First time a structure type appears on an island: its icon bursts in at
// center screen, then flies into its slot in the Harmony row.

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class DiscoveryBurst {
  private readonly queue: StructureId[] = [];
  private busy = false;

  constructor(
    private readonly parent: HTMLElement,
    private readonly slotFor: (s: StructureId) => HTMLElement | null,
    private readonly onLanded: (s: StructureId) => void,
  ) {}

  show(s: StructureId): void {
    this.queue.push(s);
    if (!this.busy) void this.next();
  }

  private async next(): Promise<void> {
    const s = this.queue.shift();
    if (!s) {
      this.busy = false;
      return;
    }
    this.busy = true;

    const el = document.createElement('div');
    el.className = 'burst';
    el.innerHTML = `
      <div class="burst-rays"></div>
      <div class="burst-badge">${STRUCTURE_ICONS[s]}</div>
      <div class="burst-name">${STRUCTURE_NAMES[s]}</div>`;
    this.parent.appendChild(el);
    const badge = el.querySelector<HTMLElement>('.burst-badge')!;
    const rays = el.querySelector<HTMLElement>('.burst-rays')!;
    const name = el.querySelector<HTMLElement>('.burst-name')!;

    try {
      if (reducedMotion()) {
        await el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], 1400)
          .finished;
      } else {
        await Promise.all([
          badge.animate(
            [{ transform: 'scale(.2)' }, { transform: 'scale(1.18)', offset: 0.65 }, { transform: 'scale(1)' }],
            { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1.3)', fill: 'forwards' },
          ).finished,
          rays.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], {
            duration: 420,
            fill: 'forwards',
          }).finished,
          name.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], {
            duration: 300,
            delay: 120,
            fill: 'forwards',
          }).finished,
        ]);
        await wait(750);
        name.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
        rays.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' });
        const slot = this.slotFor(s);
        if (slot) {
          const from = badge.getBoundingClientRect();
          const to = slot.getBoundingClientRect();
          const dx = to.left + to.width / 2 - (from.left + from.width / 2);
          const dy = to.top + to.height / 2 - (from.top + from.height / 2);
          const k = to.width / from.width;
          await badge.animate(
            [{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${k})`, opacity: 0.9 }],
            { duration: 520, easing: 'cubic-bezier(.6,0,.8,.4)', fill: 'forwards' },
          ).finished;
        } else {
          await badge.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' }).finished;
        }
      }
    } finally {
      el.remove();
      this.onLanded(s);
    }
    await this.next();
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
