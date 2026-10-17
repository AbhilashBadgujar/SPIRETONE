import { Vector3 } from 'three';
import { MODIFIER_MIN_ERA } from '../data/constants';
import { ERA_PRESETS } from '../data/eras';
import { ERA_IDS, HARMONY_TYPES, STRUCTURE_NAMES, type EraIndex, type StructureId } from '../data/ids';
import type { Game } from '../game/game';
import { formatNumber } from '../lib/format';
import type { GameEvents } from '../game/events';
import { ascendThreshold, totalBlocks } from '../sim/island';
import { bonusesFor, canAscend, shardsOnAscend } from '../sim/run';
import { AscendButton } from './ascend-button';
import { DiscoveryBurst } from './burst';
import { Ceremony } from './ceremony';
import { EraCard } from './era-card';
import { Floaters } from './floaters';
import { ICONS, STRUCTURE_ICONS } from './icons';
import { restartClass } from './restart-class';
import { TreeScreen } from './tree-screen';

// Icon-first HUD. Numbers and icons only; names live in hover tooltips.
//
//   top-left    Resonance (rolling) + income per second
//   top-center  Harmony multiplier, gauge to the era cap, structure-type slots
//   top-right   Aether Shards + era badge
//   cursor      cost chip with what the drop will become
//   bottom      Ascend button (fill ring, hold ring, Shards preview)
//   bottom-left upgrade tree button, dotted when a node is affordable

const ROMAN = ['I', 'II', 'III', 'IV'];
/** Seconds between ambient "+N" pops anywhere on the island. */
const POP_SPACING = 0.45;
/** A column pops at most this often; each pop shows what it earned since its last. */
const POP_MIN_GAP = 2.5;
/** Keep some floaters free for drop feedback. */
const POP_RESERVE = 8;
/** Beyond this many new bridges in one drop, show a single "×N" tag. */
const MAX_BRIDGE_TAGS = 2;

/** What the HUD needs from the audio layer. */
export interface MuteControl {
  readonly muted: boolean;
  toggleMute(): void;
}

class Rolling {
  private value = Number.NaN;
  private shown = '';

  constructor(
    private readonly el: HTMLElement,
    private readonly format: (n: number) => string = formatNumber,
  ) {}

  update(target: number, dt: number): void {
    if (!Number.isFinite(this.value)) this.value = target;
    const d = target - this.value;
    this.value = Math.abs(d) <= Math.max(0.01, Math.abs(target) * 1e-4) ? target : this.value + d * (1 - Math.exp(-12 * dt));
    const s = this.format(this.value);
    if (s !== this.shown) {
      this.el.textContent = s;
      this.shown = s;
    }
  }
}

export class Hud {
  readonly tree: TreeScreen;
  private readonly resPill: HTMLElement;
  private readonly shardPill: HTMLElement;
  private readonly res: Rolling;
  private readonly rate: Rolling;
  private readonly shards: Rolling;
  private readonly harmonyPill: HTMLElement;
  private readonly harmonyValue: HTMLElement;
  private readonly harmonyFill: HTMLElement;
  private readonly harmonyBar: HTMLElement;
  private readonly typeSlots = new Map<StructureId, HTMLElement>();
  private readonly eraBadge: HTMLElement;
  private readonly cost: { el: HTMLElement; value: HTMLElement; preview: HTMLElement; meter: HTMLElement; rapid: boolean };
  private readonly ascend: AscendButton;
  private readonly floaters: Floaters;
  private readonly burst: DiscoveryBurst;
  private readonly ceremony: Ceremony;
  private readonly eraCard: EraCard;
  /** A new era reached at the peak, revealed once the Shards card has landed. */
  private eraToReveal: EraIndex | null = null;
  private readonly veil: HTMLDivElement;
  private readonly treeBtn: HTMLButtonElement;
  private treeKey = '';
  /** Drop feedback waiting for a worker Gull to let go of its block. */
  private readonly pending: { t: number; fn: () => void }[] = [];
  /** Shards already banked but still on the Ascension card, not yet in the counter. */
  private pendingShards = 0;

  private last = { harmony: -1, cap: -1, types: '', era: -1 as number, costKey: '', previewKey: '' };
  private popClock = 0;
  private popCursor = 0;
  private readonly earned: Float64Array;
  private readonly sincePop: Float64Array;
  private readonly anchor = new Vector3();
  private readonly anchorB = new Vector3();
  private readonly screen = { x: 0, y: 0 };

  constructor(
    private readonly game: Game,
    private readonly root: HTMLElement,
    sound?: MuteControl,
  ) {
    const top = document.createElement('div');
    top.className = 'hud-top';
    top.innerHTML = `
      <div class="pill res">
        <div class="res-main" data-tip="Resonance">
          <span class="res-orb">${ICONS.resonance}</span><span class="res-value">0</span>
        </div>
        <div class="res-rate" data-tip="Resonance per second">${ICONS.rate}<span class="rate-value">0</span><small>/s</small></div>
      </div>
      <div class="pill harmony">
        <div class="harmony-head" data-tip="Harmony · multiplies income">
          ${ICONS.harmony}<span class="harmony-value">×1.0</span>
        </div>
        <div class="harmony-bar"><div class="harmony-fill"></div></div>
        <div class="types">
          ${HARMONY_TYPES.map(
            (t) => `<span class="type" data-type="${t}" data-tip="${STRUCTURE_NAMES[t]}">${STRUCTURE_ICONS[t]}</span>`,
          ).join('')}
        </div>
      </div>
      <div class="hud-meta">
        <div class="pill shards" data-tip="Aether Shards">${ICONS.shard}<span class="shard-value">0</span></div>
        <div class="era-badge" data-tip=""><span>I</span></div>
        <button class="pill mute" type="button" tabindex="-1" data-tip="Sound" aria-label="Toggle sound"></button>
      </div>`;
    root.appendChild(top);

    const mute = top.querySelector<HTMLButtonElement>('.mute')!;
    if (sound) {
      const paint = () => {
        mute.innerHTML = sound.muted ? ICONS.soundOff : ICONS.soundOn;
        mute.classList.toggle('off', sound.muted);
      };
      paint();
      // pointerdown + preventDefault keeps focus off the button, so Space still drops.
      mute.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        sound.toggleMute();
        paint();
      });
    } else {
      mute.remove();
    }

    const cost = document.createElement('div');
    cost.className = 'cost-chip';
    cost.innerHTML = `${ICONS.block}<span class="cost-value"></span><span class="cost-sep"></span><span class="cost-preview"></span><span class="cost-rapid">${ICONS.rapid}</span><span class="cost-meter"><i></i></span>`;
    root.appendChild(cost);

    const q = <T extends HTMLElement>(sel: string, from: ParentNode = top) => from.querySelector<T>(sel)!;
    this.resPill = q('.res');
    this.res = new Rolling(q('.res-value'));
    this.rate = new Rolling(q('.rate-value'));
    this.shards = new Rolling(q('.shard-value'));
    this.shardPill = q('.shards');
    this.harmonyPill = q('.harmony');
    this.harmonyValue = q('.harmony-value');
    this.harmonyFill = q('.harmony-fill');
    this.harmonyBar = q('.harmony-bar');
    this.eraBadge = q('.era-badge');
    for (const el of top.querySelectorAll<HTMLElement>('.type')) this.typeSlots.set(el.dataset.type as StructureId, el);
    this.cost = {
      el: cost,
      value: q('.cost-value', cost),
      preview: q('.cost-preview', cost),
      meter: q('.cost-meter i', cost),
      rapid: false,
    };

    this.ascend = new AscendButton(root, (held) => game.setHold('button', held));
    this.floaters = new Floaters(root, (v, out) => game.project(v, out));
    this.burst = new DiscoveryBurst(
      root,
      (s) => this.typeSlots.get(s) ?? null,
      (s) => restartClass(this.typeSlots.get(s), 'landed'),
    );

    this.ceremony = new Ceremony(root, () => this.shardPill);
    this.eraCard = new EraCard(root);

    this.treeBtn = document.createElement('button');
    this.treeBtn.type = 'button';
    this.treeBtn.tabIndex = -1;
    this.treeBtn.className = 'tree-btn';
    this.treeBtn.dataset.tip = 'Upgrade tree';
    this.treeBtn.setAttribute('aria-label', 'Upgrade tree');
    this.treeBtn.innerHTML = `${ICONS.tree}<i class="tree-dot"></i>`;
    this.treeBtn.addEventListener('pointerdown', (e) => e.preventDefault());
    this.treeBtn.addEventListener('click', () => this.tree.open());
    root.appendChild(this.treeBtn);
    this.tree = new TreeScreen(game, root);

    // Pause veil: tap anywhere to resume.
    this.veil = document.createElement('div');
    this.veil.className = 'pause-veil';
    this.veil.hidden = true;
    this.veil.innerHTML = `<div class="pause-play" role="button" aria-label="Resume">${ICONS.play}</div>`;
    this.veil.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      game.setPaused(false);
    });
    root.appendChild(this.veil);

    const n = game.grid.columnCount;
    this.earned = new Float64Array(n);
    this.sincePop = new Float64Array(n).fill(POP_MIN_GAP);
    this.listen();
  }

  update(dt: number): void {
    const { grid, state } = this.game;
    const { run, meta } = state;
    const ev = run.evaluation;
    const era = run.island.era;

    this.res.update(run.resonance, dt);
    this.rate.update(ev.income, dt);
    this.shards.update(meta.shards - this.pendingShards, dt);

    const cap = grid.k.K_HARMONY_CAP[era];
    if (ev.harmony !== this.last.harmony || cap !== this.last.cap) this.renderHarmony(ev.harmony, cap);
    const types = ev.typesPresent.join();
    if (types !== this.last.types || era !== this.last.era) this.renderTypes(ev.typesPresent, era as EraIndex);
    if (era !== this.last.era) this.renderEra(era as EraIndex);
    this.last.types = types;
    this.last.era = era;

    this.renderCost();

    const threshold = ascendThreshold(grid, run.island);
    this.ascend.render(
      totalBlocks(run.island) / threshold,
      canAscend(grid, run),
      this.game.ascendProgress,
      shardsOnAscend(grid, run),
    );

    if (!this.game.isAscending && !this.game.isPaused) this.ambientPops(dt);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t > 0) continue;
      this.pending.splice(i, 1);
      p.fn();
    }
    this.floaters.update(dt);
    this.ceremony.update(this.game.ascensionTime);
    this.renderTreeButton();
    this.tree.update();
  }

  private renderTreeButton(): void {
    const { meta } = this.game.state;
    // Shards still on the Ascension card don't count until they land.
    const shards = meta.shards - this.pendingShards;
    const key = `${shards}|${meta.nodes.length}`;
    if (key === this.treeKey) return;
    this.treeKey = key;
    this.treeBtn.classList.toggle('affordable', this.tree.anyAffordable(shards));
  }

  private listen(): void {
    const { events } = this.game;

    events.on('drop', (e) => {
      if (e.delay > 0) this.pending.push({ t: e.delay, fn: () => this.dropFeedback(e) });
      else this.dropFeedback(e);
    });

    events.on('reject', ({ reason }) => {
      if (reason === 'CANT_AFFORD') {
        restartClass(this.cost.el, 'shake');
        return;
      }
      this.floaters.at(this.game.cursorAnchor(this.anchor), ICONS.lock, 'bad');
    });

    events.on('ascendBlocked', ({ remaining }) => this.ascend.showBlocked(remaining));

    events.on('ascendStart', () => {
      this.root.classList.add('ascending');
      this.pending.length = 0;
      // Labels pinned to the old island would hang in mid-air after the swap.
      this.floaters.clear();
    });
    events.on('era', ({ era }) => (this.eraToReveal = era));
    events.on('ascend', ({ shards }) => {
      this.earned.fill(0);
      this.sincePop.fill(POP_MIN_GAP);
      // Hold the counter back until the card lands in it.
      this.pendingShards = shards;
      this.ceremony.peak(shards);
    });
    events.on('ascendEnd', () => {
      this.root.classList.remove('ascending');
      void this.ceremony.end().then(() => {
        this.pendingShards = 0;
        restartClass(this.shardPill, 'pop');
        // New Shards and something to spend them on: point at the tree.
        if (this.tree.anyAffordable()) this.treeBtn.classList.add('beckon');
        if (this.eraToReveal !== null) {
          const era = this.eraToReveal;
          this.eraToReveal = null;
          this.eraCard.show(era, Math.max(...this.game.grid.caps[era]));
        }
      });
    });

    events.on('pause', ({ reason }) => {
      this.veil.hidden = reason !== 'menu';
      if (reason === 'tree') this.treeBtn.classList.remove('beckon');
    });
    events.on('resume', () => (this.veil.hidden = true));
  }

  /** HUD half of a drop: gain, spend, discoveries, tags. */
  private dropFeedback({ column, cost, outcome, incomeBefore, by }: GameEvents['drop']): void {
    const { grid } = this.game;
    const { k } = grid;
    const gain = outcome.evaluation.income - incomeBefore;
    if (gain > 1e-6) {
      // A Gull's gain wears its gull, so it reads as the flock's work.
      const mark = by === 'gull' ? ICONS.gull : '';
      this.floaters.at(
        this.game.columnAnchor(column, this.anchor),
        { key: `${by}:${column}`, value: gain, format: (v) => `${mark}+${formatNumber(v)}<small>/s</small>` },
        'gain',
      );
    }
    // Beside the Resonance pill, so it never sits on the number itself.
    // Floaters center on x, so leave room for half a label.
    const r = this.resPill.getBoundingClientRect();
    this.floaters.atScreen(
      r.right + 34,
      r.top + r.height * 0.75,
      { key: 'spend', value: cost, format: (v) => `-${formatNumber(v)}` },
      'bad',
    );

    for (const t of outcome.newTypes) this.burst.show(t);
    for (const c of outcome.goldenRolled) {
      this.floaters.at(this.game.columnAnchor(c, this.anchor), `${ICONS.golden}×${k.K_M_GOLDEN}`, 'tag');
    }
    if (outcome.newBridges.length > MAX_BRIDGE_TAGS) {
      // Many at once (a cascade): one summary tag instead of a wall of them.
      this.floaters.at(this.game.columnAnchor(column, this.anchor), `${ICONS.bridge}×${outcome.newBridges.length}`, 'tag');
    } else {
      // Overclock eras: the bridge also shares base yield, so it wears a gear.
      const gear = this.game.state.run.island.era >= MODIFIER_MIN_ERA.MOD_OVERCLOCK ? ICONS.gear : '';
      for (const e of outcome.newBridges) {
        const edge = grid.edges[e];
        this.game.columnAnchor(edge.a, this.anchor);
        this.game.columnAnchor(edge.b, this.anchorB);
        this.anchor.lerp(this.anchorB, 0.5);
        this.floaters.at(this.anchor, `${ICONS.bridge}+${Math.round(k.K_M_BRIDGE * 100)}%${gear}`, 'tag');
      }
    }
    // Era IV Cascade: how many free blocks this drop set off.
    if (outcome.placed.length > 1) {
      this.floaters.at(this.game.columnAnchor(column, this.anchor), `${ICONS.cascade}×${outcome.placed.length - 1}`, 'tag');
    }
    if (!outcome.newTypes.includes('ST_PLAZA')) {
      for (const group of outcome.newPlazas) {
        this.anchor.set(0, 0, 0);
        for (const c of group) this.anchor.add(this.game.columnAnchor(c, this.anchorB));
        this.floaters.at(this.anchor.divideScalar(group.length), STRUCTURE_ICONS.ST_PLAZA, 'tag');
      }
    }
    if (!outcome.newTypes.includes('ST_LIGHTHOUSE')) {
      for (const c of outcome.newLighthouses) {
        this.floaters.at(this.game.columnAnchor(c, this.anchor), STRUCTURE_ICONS.ST_LIGHTHOUSE, 'tag');
      }
    }
  }

  private renderHarmony(h: number, cap: number): void {
    this.last.harmony = h;
    this.last.cap = cap;
    this.harmonyValue.textContent = `×${(Math.floor(h * 10 + 1e-6) / 10).toFixed(1)}`;
    const span = Math.max(1e-6, cap - 1);
    this.harmonyFill.style.width = `${Math.min(100, ((h - 1) / span) * 100)}%`;
    this.harmonyBar.style.setProperty('--tick', `${(this.game.grid.k.K_HARMONY_PER_TYPE / span) * 100}%`);
    this.harmonyPill.classList.toggle('max', h >= cap - 1e-9);
  }

  private renderTypes(present: readonly StructureId[], era: EraIndex): void {
    const { k } = this.game.grid;
    const tallest = Math.max(...this.game.grid.caps[era]);
    for (const [t, el] of this.typeSlots) {
      const possible =
        (t !== 'ST_TOWER' || tallest >= k.K_TOWER_MIN_HEIGHT) &&
        (t !== 'ST_LIGHTHOUSE' || tallest >= k.K_LIGHTHOUSE_MIN_HEIGHT);
      el.hidden = !possible;
      el.classList.toggle('lit', present.includes(t));
    }
  }

  private renderEra(era: EraIndex): void {
    const preset = ERA_PRESETS[ERA_IDS[era]];
    this.eraBadge.firstElementChild!.textContent = ROMAN[era];
    this.eraBadge.dataset.tip = `Era ${ROMAN[era]} · ${preset.name}`;
  }

  private renderCost(): void {
    const info = this.game.cursorInfo();
    const el = this.cost.el;
    if (!this.game.project(this.game.cursorAnchor(this.anchor), this.screen)) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.style.transform = `translate3d(${this.screen.x.toFixed(1)}px, ${this.screen.y.toFixed(1)}px, 0)`;

    const costText = info.state === 'blocked' ? '' : formatNumber(info.cost);
    const costKey = `${info.state}|${costText}`;
    if (costKey !== this.last.costKey) {
      this.last.costKey = costKey;
      el.dataset.state = info.state;
      this.cost.value.textContent = costText;
    }

    const p = info.preview;
    const previewKey = p ? `${p.structure}|${p.newType}` : 'none';
    if (previewKey !== this.last.previewKey) {
      this.last.previewKey = previewKey;
      this.cost.preview.innerHTML = p ? STRUCTURE_ICONS[p.structure] : ICONS.lock;
      el.classList.toggle('fresh', !!p?.newType);
    }

    const rapid = this.game.isRapidDropping;
    if (rapid !== this.cost.rapid) {
      this.cost.rapid = rapid;
      el.classList.toggle('rapid', rapid);
    }

    if (info.state === 'broke') {
      const f = Math.min(1, this.game.state.run.resonance / info.cost);
      this.cost.meter.style.transform = `scaleX(${f.toFixed(3)})`;
    }
  }

  private ambientPops(dt: number): void {
    const { grid, state } = this.game;
    const { run, meta } = state;
    const ev = run.evaluation;
    const mult = ev.harmony * grid.k.K_ERA_YIELD_MULT[run.island.era] * bonusesFor(meta).incomeMult;
    const n = grid.columnCount;
    for (let c = 0; c < n; c++) {
      const y = ev.columns[c].yield;
      if (y > 0) this.earned[c] += y * mult * dt;
      this.sincePop[c] += dt;
    }

    this.popClock += dt;
    if (this.popClock < POP_SPACING || this.floaters.free <= POP_RESERVE) return;
    this.popClock = 0;
    for (let step = 0; step < n; step++) {
      const c = (this.popCursor + step) % n;
      if (ev.columns[c].yield <= 0 || this.sincePop[c] < POP_MIN_GAP || this.earned[c] <= 0) continue;
      this.floaters.at(this.game.columnAnchor(c, this.anchor), `+${formatNumber(this.earned[c])}`, 'pop');
      this.earned[c] = 0;
      this.sincePop[c] = 0;
      this.popCursor = c + 1;
      return;
    }
  }
}
