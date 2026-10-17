import { flashOpacity } from '../game/ascension';
import { formatNumber } from '../lib/format';
import { ICONS } from './icons';

// HUD half of the Ascension sequence: a flash that peaks exactly when the
// island swaps, then a Shards card that counts up and flies into the
// Shards counter when the new island has landed.
//
// The flash is driven from the game's sequence clock, not CSS time, so it
// stays on the swap even when frames are slow.

const COUNT_UP_MS = 700;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Ceremony {
  private readonly flash: HTMLDivElement;
  private card: HTMLDivElement | null = null;
  private lastFlash = -1;

  constructor(
    private readonly parent: HTMLElement,
    /** Where the card flies to. */
    private readonly target: () => HTMLElement,
  ) {
    this.flash = document.createElement('div');
    this.flash.className = 'ascend-flash';
    parent.appendChild(this.flash);
  }

  /** Per frame. `t`: seconds into the sequence, or null when none is running. */
  update(t: number | null): void {
    const o = t === null ? 0 : Math.round(flashOpacity(t) * 100) / 100;
    if (o === this.lastFlash) return;
    this.lastFlash = o;
    this.flash.style.opacity = String(o);
  }

  /** At the peak: the card appears and counts up to the payout. */
  peak(shards: number): void {
    this.card?.remove();
    const card = document.createElement('div');
    card.className = 'shard-card';
    card.innerHTML = `${ICONS.shard}<span>+0</span>`;
    this.parent.appendChild(card);
    this.card = card;
    const value = card.querySelector('span')!;

    // Every keyframe names opacity: a missing one would ease back to the CSS 0.
    card.animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1.1)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }], {
      duration: 380,
      easing: 'cubic-bezier(.2,.9,.3,1.3)',
      fill: 'forwards',
    });
    const t0 = performance.now();
    const tick = (now: number) => {
      if (this.card !== card) return;
      const p = Math.min(1, (now - t0) / COUNT_UP_MS);
      value.textContent = `+${formatNumber(Math.round(shards * (1 - (1 - p) * (1 - p))))}`;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** Sequence over: fly the card into the Shards counter. Resolves when it lands. */
  async end(): Promise<void> {
    const card = this.card;
    if (!card) return;
    this.card = null;
    try {
      if (reducedMotion()) {
        await card.animate([{ opacity: 1 }, { opacity: 0 }], 250).finished;
        return;
      }
      // The pop-in held the card visible with fill: forwards; take it over from here.
      card.getAnimations().forEach((a) => a.cancel());
      card.style.opacity = '1';
      const from = card.getBoundingClientRect();
      const to = this.target().getBoundingClientRect();
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      await card.animate(
        [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(.3)`, opacity: 0.6 }],
        { duration: 520, easing: 'cubic-bezier(.6,0,.8,.4)', fill: 'forwards' },
      ).finished;
    } finally {
      card.remove();
    }
  }
}
