import { ERA_PRESETS } from '../data/eras';
import { ERA_IDS, type EraIndex } from '../data/ids';
import { ICONS, STRUCTURE_ICONS } from './icons';
import { restartClass } from './restart-class';

// Shown once when an island lands in a new era (GDD §6): the era's hex, its
// name, and icons for what it brings — the taller height cap and its
// signature mechanic. The name is the one line of text; the rest is icons.

const ROMAN = ['I', 'II', 'III', 'IV'];

/** Era II Lighthouses + Beacon, Era III Overclock, Era IV Cascade. */
const SIGNATURE: Record<EraIndex, string> = {
  0: STRUCTURE_ICONS.ST_COTTAGE,
  1: STRUCTURE_ICONS.ST_LIGHTHOUSE,
  2: `${ICONS.bridge}${ICONS.gear}`,
  3: ICONS.cascade,
};

export class EraCard {
  private readonly el: HTMLDivElement;
  private readonly hex: HTMLElement;
  private readonly name: HTMLElement;
  private readonly cap: HTMLElement;
  private readonly sig: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'era-card';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="era-card-hex"><span></span></div>
      <div class="era-card-name"></div>
      <div class="era-card-gains">
        <span class="era-card-gain era-card-cap" data-tip="Taller columns"></span>
        <span class="era-card-gain era-card-sig"></span>
      </div>`;
    parent.appendChild(this.el);
    this.hex = this.el.querySelector('.era-card-hex span')!;
    this.name = this.el.querySelector('.era-card-name')!;
    this.cap = this.el.querySelector('.era-card-cap')!;
    this.sig = this.el.querySelector('.era-card-sig')!;
    this.el.addEventListener('animationend', (e) => {
      if (e.target === this.el) this.el.hidden = true;
    });
  }

  get showing(): boolean {
    return !this.el.hidden;
  }

  /** `cap`: the new inner-ring height cap. */
  show(era: EraIndex, cap: number): void {
    this.hex.textContent = ROMAN[era];
    this.name.textContent = ERA_PRESETS[ERA_IDS[era]].name;
    this.cap.innerHTML = `${ICONS.block}${ICONS.rate}${cap}`;
    this.sig.innerHTML = SIGNATURE[era];
    this.el.hidden = false;
    restartClass(this.el, 'play');
  }
}
