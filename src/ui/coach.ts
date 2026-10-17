import { Vector3 } from 'three';
import { STRUCTURE_ICONS, ICONS } from './icons';
import type { Game } from '../game/game';
import type { ColumnId } from '../sim/grid';
import { gullTarget } from '../sim/gulls';
import { ascendThreshold, isDroppable, totalBlocks } from '../sim/island';
import { canAscend } from '../sim/run';

// First-run hints: one short bubble at a time, pointing at the thing that
// matters right now (a spot on the island, a counter, a button) with a
// pulsing ring round it. Each shows once; which ones have been seen is kept
// in localStorage beside the save, and erased with it.

const KEY = 'spiretone.coach';
/** Seconds between one hint leaving and the next appearing. */
const GAP = 1.2;
const MARGIN = 12;

export type HintId =
  | 'howto'
  | 'build'
  | 'earn'
  | 'stack'
  | 'harmony'
  | 'broke'
  | 'ring'
  | 'ascend'
  | 'tree'
  | 'buy'
  | 'again'
  | 'era';

type Target = 'column' | 'stack' | 'res' | 'harmony' | 'ascend' | 'tree' | 'treeBuy' | 'era';
type Place = 'above' | 'below' | 'right';

interface Ctx {
  game: Game;
  flags: { broke: boolean };
}

interface Hint {
  id: Exclude<HintId, 'howto'>;
  target: Target;
  place: Place;
  /** Shows only while the tree screen is open (the rest only during play). */
  inTree?: boolean;
  text: (c: Ctx) => string;
  ready: (c: Ctx) => boolean;
  /** Dismisses the hint for good. Without it, the hint stays up for `seconds`. */
  done?: (c: Ctx) => boolean;
  seconds?: number;
}

const blocks = (c: Ctx) => c.game.state.meta.stats.blocks;
const types = (c: Ctx) => c.game.state.run.evaluation.typesPresent;

const HINTS: readonly Hint[] = [
  {
    id: 'build',
    target: 'column',
    place: 'above',
    text: (c) =>
      c.game.controlMode === 'direct'
        ? `${ICONS.direct}Tap the island to build here`
        : `${ICONS.block}Tap to drop a block where the marker is`,
    ready: (c) => blocks(c) === 0,
    done: (c) => blocks(c) > 0,
  },
  {
    id: 'earn',
    target: 'res',
    place: 'below',
    text: () => `${ICONS.resonance}Buildings earn Resonance every second. Spend it on more blocks.`,
    ready: (c) => blocks(c) >= 1 && c.game.state.run.evaluation.income > 0,
    done: (c) => blocks(c) >= 5,
    seconds: 8,
  },
  {
    id: 'stack',
    target: 'stack',
    place: 'above',
    text: () => `${STRUCTURE_ICONS.ST_TOWER}Build on a block to stack it. Taller buildings earn more.`,
    ready: (c) => blocks(c) >= 3 && !types(c).includes('ST_TOWER'),
    done: (c) => types(c).includes('ST_TOWER'),
    seconds: 14,
  },
  {
    id: 'harmony',
    target: 'harmony',
    place: 'below',
    text: () => `${ICONS.harmony}Different kinds of building raise Harmony, and Harmony multiplies all income.`,
    ready: (c) => types(c).length >= 2,
    seconds: 8,
  },
  {
    id: 'broke',
    // The Resonance counter, not the cost chip: the chip follows the cursor, and the hint is about the counter.
    target: 'res',
    place: 'below',
    text: () => `${ICONS.resonance}Not enough Resonance yet. Wait a moment: it keeps coming in.`,
    ready: (c) => c.flags.broke,
    seconds: 6,
  },
  {
    id: 'ring',
    target: 'ascend',
    place: 'above',
    text: () => `${ICONS.ascend}This ring fills as you build. Fill it to Ascend.`,
    ready: (c) => {
      const { run, meta } = c.game.state;
      return meta.ascensions === 0 && totalBlocks(run.island) / ascendThreshold(c.game.grid, run.island) >= 0.35;
    },
    done: (c) => canAscend(c.game.grid, c.game.state.run),
    seconds: 8,
  },
  {
    id: 'ascend',
    target: 'ascend',
    place: 'above',
    text: () => `${ICONS.ascend}Ready! Hold to Ascend: this island turns into Shards. Building more first earns more.`,
    ready: (c) => c.game.state.meta.ascensions === 0 && canAscend(c.game.grid, c.game.state.run),
    done: (c) => c.game.isAscending || c.game.state.meta.ascensions > 0,
  },
  {
    id: 'tree',
    target: 'tree',
    place: 'right',
    text: () => `${ICONS.shard}Spend Shards on upgrades. Islands reset; upgrades stay forever.`,
    ready: (c) => {
      const { meta } = c.game.state;
      return meta.ascensions > 0 && meta.nodes.length === 0 && meta.shards > 0;
    },
    done: (c) => c.game.pausedBy === 'tree' || c.game.state.meta.nodes.length > 0,
  },
  {
    id: 'buy',
    target: 'treeBuy',
    place: 'above',
    inTree: true,
    text: () => `${ICONS.tree}Pick a glowing node, then buy it here.`,
    ready: (c) => c.game.state.meta.nodes.length === 0,
    done: (c) => c.game.state.meta.nodes.length > 0,
  },
  {
    id: 'again',
    target: 'column',
    place: 'above',
    text: () => `${ICONS.block}New island! Your upgrades make this one earn faster.`,
    ready: (c) => {
      const { meta, run } = c.game.state;
      return meta.nodes.length > 0 && meta.ascensions > 0 && totalBlocks(run.island) === 0;
    },
    done: (c) => totalBlocks(c.game.state.run.island) > 0,
    seconds: 10,
  },
  {
    id: 'era',
    target: 'era',
    place: 'below',
    text: () => `${ICONS.tree}New era unlocked! It starts on your next island, with taller buildings.`,
    ready: (c) => c.game.state.meta.highestEra > c.game.state.run.island.era,
    seconds: 7,
  },
];

export interface CoachTargets {
  res: HTMLElement;
  harmony: HTMLElement;
  ascend: HTMLElement;
  tree: HTMLElement;
  era: HTMLElement;
  treeBuy: () => HTMLElement | null;
}

const _v = new Vector3();

export function loadSeen(): Set<HintId> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? (raw.filter((x) => typeof x === 'string') as HintId[]) : []);
  } catch {
    return new Set();
  }
}

export function clearCoach(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

export class Coach {
  private readonly seen = loadSeen();
  private readonly bubble: HTMLDivElement;
  private readonly text: HTMLElement;
  private readonly ring: HTMLDivElement;
  private current: { hint: Hint; t: number } | null = null;
  private gap = GAP;
  private readonly ctx: Ctx;
  private readonly screen = { x: 0, y: 0 };
  /** The suggested spot, worked out once per island state (it previews every column). */
  private suggestion: { ev: unknown; stack: boolean; column: ColumnId | null } = { ev: null, stack: false, column: null };

  constructor(
    private readonly game: Game,
    parent: HTMLElement,
    private readonly targets: CoachTargets,
    /** True while something else owns the screen (Ascension, era card). */
    private readonly busy: () => boolean,
  ) {
    this.ctx = { game, flags: { broke: false } };
    this.ring = document.createElement('div');
    this.ring.className = 'coach-ring';
    this.ring.hidden = true;
    this.bubble = document.createElement('div');
    this.bubble.className = 'coach';
    this.bubble.hidden = true;
    this.bubble.setAttribute('role', 'status');
    this.bubble.innerHTML = `<span class="coach-text"></span><i class="coach-tail"></i>`;
    this.text = this.bubble.querySelector('.coach-text')!;
    parent.append(this.ring, this.bubble);
    // Tapping a hint puts it away for good.
    this.bubble.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.current) this.finish();
    });
    game.events.on('reject', ({ reason }) => {
      if (reason === 'CANT_AFFORD') this.ctx.flags.broke = true;
    });
  }

  hasSeen(id: HintId): boolean {
    return this.seen.has(id);
  }

  markSeen(id: HintId): void {
    this.seen.add(id);
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.seen]));
    } catch {
      // Hints just come back next session.
    }
  }

  update(dt: number): void {
    const cur = this.current;
    if (cur) {
      cur.t += dt;
      const { hint } = cur;
      const over = hint.done?.(this.ctx) || (hint.seconds !== undefined && cur.t >= hint.seconds);
      if (over) this.finish();
      else if (!this.allowed(hint)) this.hide();
      else this.place(hint);
      return;
    }
    this.gap -= dt;
    if (this.gap > 0 || this.busy()) return;
    const next = HINTS.find((h) => !this.seen.has(h.id) && this.allowed(h) && h.ready(this.ctx));
    if (next) this.show(next);
  }

  /** Hints never cover the pause, help or Ascension screens; tree hints only show in the tree. */
  private allowed(h: Hint): boolean {
    if (this.game.isAscending || this.busy()) return false;
    const by = this.game.pausedBy;
    return h.inTree ? by === 'tree' : by === null;
  }

  private show(hint: Hint): void {
    this.current = { hint, t: 0 };
    this.text.innerHTML = hint.text(this.ctx);
    this.bubble.dataset.place = hint.place;
    this.bubble.hidden = false;
    this.ring.hidden = false;
    this.bubble.classList.remove('in');
    void this.bubble.offsetWidth;
    this.bubble.classList.add('in');
    this.place(hint);
  }

  /** Done with this hint: never again. */
  private finish(): void {
    if (this.current) this.markSeen(this.current.hint.id);
    this.hide();
  }

  /** Off screen for now (paused, ascending); it comes back if still unseen. */
  private hide(): void {
    this.current = null;
    this.bubble.hidden = true;
    this.ring.hidden = true;
    this.gap = GAP;
  }

  private place(hint: Hint): void {
    const rect = this.targetRect(hint.target);
    if (!rect) {
      this.bubble.style.visibility = 'hidden';
      this.ring.hidden = true;
      return;
    }
    this.bubble.style.visibility = '';
    this.ring.hidden = false;
    const pad = 6;
    Object.assign(this.ring.style, {
      left: `${rect.left - pad}px`,
      top: `${rect.top - pad}px`,
      width: `${rect.width + pad * 2}px`,
      height: `${rect.height + pad * 2}px`,
    });

    const b = this.bubble.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let x: number;
    let y: number;
    if (hint.place === 'right') {
      x = rect.right + 16;
      y = cy - b.height / 2;
    } else {
      x = cx - b.width / 2;
      y = hint.place === 'below' ? rect.bottom + 16 : rect.top - b.height - 16;
    }
    x = Math.max(MARGIN, Math.min(innerWidth - b.width - MARGIN, x));
    y = Math.max(MARGIN, Math.min(innerHeight - b.height - MARGIN, y));
    this.bubble.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    // The tail points at the target even when the bubble had to shift to stay on screen.
    const tail =
      hint.place === 'right' ? Math.max(14, Math.min(b.height - 14, cy - y)) : Math.max(16, Math.min(b.width - 16, cx - x));
    this.bubble.style.setProperty('--tail', `${tail.toFixed(1)}px`);
  }

  private targetRect(target: Target): DOMRect | null {
    if (target === 'column' || target === 'stack') {
      const c = this.suggest(target === 'stack');
      if (c === null || !this.game.project(this.game.columnAnchor(c, _v), this.screen)) return null;
      const r = 26;
      return new DOMRect(this.screen.x - r, this.screen.y - r + 18, r * 2, r * 2);
    }
    const el = target === 'treeBuy' ? this.targets.treeBuy() : this.targets[target];
    if (!el || el.hidden) return null;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 ? rect : null;
  }

  private suggest(stack: boolean): ColumnId | null {
    const ev = this.game.state.run.evaluation;
    const s = this.suggestion;
    if (s.ev !== ev || s.stack !== stack) {
      s.ev = ev;
      s.stack = stack;
      s.column = stack ? this.stackColumn() : gullTarget(this.game.grid, this.game.state);
    }
    return s.column;
  }

  /** A single block that a second one would turn into a tower. */
  private stackColumn(): ColumnId | null {
    const { grid, state } = this.game;
    const { island } = state.run;
    for (let c = 0; c < grid.columnCount; c++) {
      if (island.heights[c] === 1 && !island.inPlaza[c] && isDroppable(grid, island, c)) return c;
    }
    return gullTarget(grid, state);
  }
}
