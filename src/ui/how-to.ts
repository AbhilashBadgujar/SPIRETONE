import type { Game } from '../game/game';
import { ICONS } from './icons';

// How to play: the core loop (GDD §1) as one picture. Five icons round a
// ring, Build → Earn → Ascend → Shards → Upgrade → back to Build, and three
// short lines under it. Shown on first launch and from the pause screen.

const STEPS = [
  { icon: ICONS.block, label: 'Build' },
  { icon: ICONS.resonance, label: 'Earn' },
  { icon: ICONS.ascend, label: 'Ascend' },
  { icon: ICONS.shard, label: 'Shards' },
  { icon: ICONS.tree, label: 'Upgrade' },
] as const;

/** Ring geometry in the SVG's 300×300 box. */
const R = 112;
const C = 150;

export class HowTo {
  private readonly el: HTMLDivElement;

  constructor(
    private readonly game: Game,
    parent: HTMLElement,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'how-to';
    this.el.hidden = true;

    // Nodes round the ring, starting at the top and going clockwise.
    const at = (i: number) => {
      const a = -Math.PI / 2 + (i / STEPS.length) * Math.PI * 2;
      return { x: C + R * Math.cos(a), y: C + R * Math.sin(a), a };
    };
    // Arrowheads midway between nodes, pointing along the ring.
    const arrows = STEPS.map((_, i) => {
      const a = -Math.PI / 2 + ((i + 0.5) / STEPS.length) * Math.PI * 2;
      const x = C + R * Math.cos(a);
      const y = C + R * Math.sin(a);
      const deg = (a * 180) / Math.PI + 90;
      return `<path d="M-7 -6 L4 0 L-7 6" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(1)})" />`;
    }).join('');

    this.el.innerHTML = `
      <div class="how-to-card">
        <div class="how-to-loop">
          <svg viewBox="0 0 300 300" aria-hidden="true">
            <circle cx="${C}" cy="${C}" r="${R}" class="how-to-ring"/>
            <g class="how-to-arrows">${arrows}</g>
          </svg>
          ${STEPS.map((s, i) => {
            const p = at(i);
            return `<div class="how-to-step" style="left:${((p.x / 300) * 100).toFixed(2)}%;top:${((p.y / 300) * 100).toFixed(2)}%">
              <span class="how-to-icon">${s.icon}</span><b>${s.label}</b></div>`;
          }).join('')}
          <div class="how-to-center">${ICONS.orbit}</div>
        </div>
        <ul class="how-to-lines">
          <li><span>${ICONS.direct}</span>Tap the island to drop blocks. They cost Resonance.</li>
          <li><span>${ICONS.ascend}</span>When the ring is full, hold Ascend to cash in for Shards.</li>
          <li><span>${ICONS.tree}</span>Shards buy upgrades. Islands reset; upgrades stay.</li>
        </ul>
        <button class="how-to-play" type="button" tabindex="-1" aria-label="Play">${ICONS.play}</button>
      </div>`;
    parent.appendChild(this.el);

    // Anywhere closes it: it's a picture, not a form.
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });
    game.events.on('pause', ({ reason }) => {
      if (reason !== 'help') this.el.hidden = true;
    });
    game.events.on('resume', () => (this.el.hidden = true));
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(): void {
    if (this.game.isAscending) return;
    this.game.setPaused(true, 'help');
    this.el.hidden = false;
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.game.setPaused(false);
  }
}
