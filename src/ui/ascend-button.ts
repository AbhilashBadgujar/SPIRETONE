import { formatNumber } from '../lib/format';
import { ICONS } from './icons';

// Hold-to-Ascend button (GDD §4). Outer ring: island fill toward the Ascend
// threshold. Inner gold ring: hold progress. Holding too early shakes and
// shows how many blocks are still needed; once ready, a chip shows the
// Shards an Ascend would pay.

const R_FILL = 44;
const R_HOLD = 35;
const C_FILL = 2 * Math.PI * R_FILL;
const C_HOLD = 2 * Math.PI * R_HOLD;
const CHIP_TIME_MS = 1400;

export class AscendButton {
  readonly el: HTMLDivElement;
  private readonly fillArc: SVGCircleElement;
  private readonly holdArc: SVGCircleElement;
  private readonly chip: HTMLDivElement;
  private readonly chipCount: HTMLSpanElement;
  private readonly gain: HTMLDivElement;
  private readonly gainCount: HTMLSpanElement;
  private chipTimer = 0;
  private last = { fill: -1, hold: -1, ready: false, shards: '' };

  constructor(parent: HTMLElement, onHold: (held: boolean) => void) {
    const el = document.createElement('div');
    el.className = 'ascend';
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', 'Ascend (hold)');
    el.innerHTML = `
      <svg class="ascend-rings" viewBox="0 0 100 100" aria-hidden="true">
        <circle class="track" cx="50" cy="50" r="${R_FILL}"/>
        <circle class="fill" cx="50" cy="50" r="${R_FILL}" stroke-dasharray="${C_FILL}" stroke-dashoffset="${C_FILL}"/>
        <circle class="hold" cx="50" cy="50" r="${R_HOLD}" stroke-dasharray="${C_HOLD}" stroke-dashoffset="${C_HOLD}"/>
      </svg>
      <div class="ascend-core">${ICONS.ascend}</div>
      <div class="ascend-chip">${ICONS.block}<span></span></div>
      <div class="ascend-chip ascend-gain" data-tip="Aether Shards on Ascend">${ICONS.shard}<span></span></div>`;
    parent.appendChild(el);
    this.el = el;
    this.fillArc = el.querySelector('.fill')!;
    this.holdArc = el.querySelector('.hold')!;
    this.chip = el.querySelector('.ascend-chip')!;
    this.chipCount = this.chip.querySelector('span')!;
    this.gain = el.querySelector('.ascend-gain')!;
    this.gainCount = this.gain.querySelector('span')!;

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      onHold(true);
    });
    const release = () => onHold(false);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /**
   * fill: island fill / threshold (clamped to 1). hold: 0..1 of K_ASCEND_HOLD.
   * shards: what an Ascend would pay right now.
   */
  render(fill: number, ready: boolean, hold: number, shards: number): void {
    const f = Math.round(Math.min(1, fill) * 200) / 200;
    const h = Math.round(hold * 200) / 200;
    const s = `+${formatNumber(shards)}`;
    if (f !== this.last.fill) this.fillArc.setAttribute('stroke-dashoffset', String(C_FILL * (1 - f)));
    if (h !== this.last.hold) this.holdArc.setAttribute('stroke-dashoffset', String(C_HOLD * (1 - h)));
    if (ready !== this.last.ready) {
      this.el.classList.toggle('ready', ready);
      this.gain.classList.toggle('show', ready);
      // A "blocks to go" count is stale the moment the island qualifies.
      if (ready) this.chip.classList.remove('show');
    }
    if (s !== this.last.shards) this.gainCount.textContent = s;
    this.el.classList.toggle('holding', h > 0);
    this.last = { fill: f, hold: h, ready, shards: s };
  }

  showBlocked(remaining: number): void {
    this.chipCount.textContent = `${remaining}`;
    this.chip.classList.add('show');
    this.el.classList.remove('shake');
    void this.el.offsetWidth; // restart the animation
    this.el.classList.add('shake');
    window.clearTimeout(this.chipTimer);
    this.chipTimer = window.setTimeout(() => this.chip.classList.remove('show'), CHIP_TIME_MS);
  }
}
