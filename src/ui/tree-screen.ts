import { STRUCTURE_NAMES } from '../data/ids';
import { NODE_BY_ID, TREE, type NodeEffect, type NodeId, type TreeNode } from '../data/tree';
import type { Game } from '../game/game';
import { formatNumber } from '../lib/format';
import { nodeState } from '../sim/tree';
import { ICONS, STRUCTURE_ICONS } from './icons';
import { restartClass } from './restart-class';
import './tree.css';

// Upgrade tree screen (GDD §7): a constellation map over the paused island.
// Nodes are icons; the card at the bottom names the selected node, shows
// its effect as icons and numbers, and buys it.
//
// A requirement on a core node is an era gate: it shows as an era badge on
// the node rather than a line back to the spine, so the map keeps to short
// lines. A node whose only requirement is a core node keeps its line.

const ROMAN = ['I', 'II', 'III', 'IV'];
/** Margin around the outermost nodes, in tree units. */
const PAD = 0.75;
/** Pixels per tree unit. Below MIN the map pans instead of shrinking. */
const MIN_UNIT = 58;
const MAX_UNIT = 92;
/** Pointer travel that turns a press on the map into a pan. */
const DRAG_SLOP = 6;
/** Keyboard/pad moves only reach nodes within this angle of the pressed direction. */
const MOVE_CONE = Math.cos((62 * Math.PI) / 180);

/** What Input drives while the screen is open. */
export interface TreeControls {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  move(dx: number, dy: number): void;
  confirm(): void;
}

type Visual = 'owned' | 'ready' | 'short' | 'locked';

interface Edge {
  from: NodeId | null;
  to: NodeId;
  el: SVGLineElement;
}

const isCore = (id: NodeId) => NODE_BY_ID[id].branch === 'core';

/** Requirements drawn as lines (see the header comment). */
function drawnParents(n: TreeNode): readonly NodeId[] {
  if (n.branch === 'core') return n.requires;
  const own = n.requires.filter((r) => !isCore(r));
  return own.length ? own : n.requires;
}

/** The era a node waits on, if a core node gates it. */
function gateEra(n: TreeNode): number | null {
  if (n.branch === 'core') return null;
  let era: number | null = null;
  for (const r of n.requires) {
    const e = NODE_BY_ID[r].effect;
    if (e.kind === 'era') era = Math.max(era ?? 0, e.era);
  }
  return era;
}

function nodeIcon(e: NodeEffect): string {
  switch (e.kind) {
    case 'era':
      return `<b class="hex">${ROMAN[e.era]}</b>`;
    case 'typeYield':
      return STRUCTURE_ICONS[e.structure];
    case 'incomeMult':
      return ICONS.resonance;
    case 'golden':
      return ICONS.golden;
    case 'gulls':
      return ICONS.gull;
    case 'gullInterval':
      return ICONS.wind;
    case 'cursorStep':
      return ICONS.eye;
    case 'rapidDrop':
      return ICONS.rapid;
    case 'orbitSkip':
      return ICONS.skip;
    case 'startRes':
      return ICONS.flag;
  }
}

/** The effect as one icon-and-number chip plus a few words. */
function effectLine(e: NodeEffect): { chip: string; hint: string } {
  const pct = (f: number) => `${Math.round(f * 100)}%`;
  switch (e.kind) {
    case 'era':
      return { chip: `<b class="hex">${ROMAN[e.era]}</b>`, hint: 'New era · next island' };
    case 'typeYield':
      return { chip: `${STRUCTURE_ICONS[e.structure]}+${pct(e.add)}`, hint: `${STRUCTURE_NAMES[e.structure]} yield` };
    case 'incomeMult':
      return { chip: `${ICONS.rate}×${e.mult}`, hint: 'All income' };
    case 'golden':
      return { chip: `${ICONS.golden}+${pct(e.chance)}`, hint: 'Golden chance' };
    case 'gulls':
      return { chip: `${ICONS.gull}+${e.add}`, hint: e.add === 1 ? 'A Gull drops for you' : 'Gulls drop for you' };
    case 'gullInterval':
      return { chip: `${ICONS.gull}×${(1 / e.mult).toFixed(1)}`, hint: 'Gull speed' };
    case 'cursorStep':
      return { chip: `${ICONS.eye}+${pct(1 / e.mult - 1)}`, hint: 'Cursor speed' };
    case 'rapidDrop':
      return { chip: `${ICONS.block}${ICONS.rapid}`, hint: 'Hold Drop to repeat' };
    case 'orbitSkip':
      return { chip: `${ICONS.skip}`, hint: 'Cursor skips full columns' };
    case 'startRes':
      return { chip: `${ICONS.resonance}×${e.mult}`, hint: 'Start Resonance' };
  }
}

/** The node a keyboard or pad step in direction (dx, dy) lands on, or null. */
export function stepFrom(from: NodeId, dx: number, dy: number): NodeId | null {
  const [cx, cy] = NODE_BY_ID[from].pos;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  let best: NodeId | null = null;
  let bestScore = Infinity;
  for (const n of TREE) {
    if (n.id === from) continue;
    const vx = n.pos[0] - cx;
    const vy = n.pos[1] - cy;
    const along = vx * ux + vy * uy;
    if (along / Math.hypot(vx, vy) < MOVE_CONE) continue;
    // Prefer nodes straight ahead over nearer ones off to the side.
    const score = along + 2 * Math.abs(vx * uy - vy * ux);
    if (score < bestScore) {
      bestScore = score;
      best = n.id;
    }
  }
  return best;
}

const BOUNDS = (() => {
  const xs = [0, ...TREE.map((n) => n.pos[0])];
  const ys = [0, ...TREE.map((n) => n.pos[1])];
  const minX = Math.min(...xs) - PAD;
  const minY = Math.min(...ys) - PAD;
  return { minX, minY, w: Math.max(...xs) + PAD - minX, h: Math.max(...ys) + PAD - minY };
})();

/** Percent position of a tree point on the map. */
const at = (x: number, y: number) =>
  `left:${(((x - BOUNDS.minX) / BOUNDS.w) * 100).toFixed(3)}%;top:${(((y - BOUNDS.minY) / BOUNDS.h) * 100).toFixed(3)}%`;

export class TreeScreen implements TreeControls {
  private readonly el: HTMLDivElement;
  private readonly viewport: HTMLDivElement;
  private readonly map: HTMLDivElement;
  private readonly hub: HTMLDivElement;
  private readonly shardValue: HTMLElement;
  private readonly shardPill: HTMLElement;
  private readonly nodes = new Map<NodeId, HTMLButtonElement>();
  private readonly edges: Edge[] = [];
  private readonly card: { el: HTMLElement; icon: HTMLElement; name: HTMLElement; chip: HTMLElement; hint: HTMLElement; buy: HTMLButtonElement };

  private openFlag = false;
  private selected: NodeId = 'NODE_Y1';
  private readonly visuals = new Map<NodeId, Visual>();
  private renderKey = '';
  private unit = MIN_UNIT;
  private pan = { x: 0, y: 0 };
  private size = { vw: 0, vh: 0, mw: 0, mh: 0 };
  private drag: { id: number; x: number; y: number; panX: number; panY: number; moved: boolean } | null = null;

  constructor(
    private readonly game: Game,
    root: HTMLElement,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'tree-screen';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="tree-top">
        <button class="pill tree-close" type="button" tabindex="-1" aria-label="Close">${ICONS.close}</button>
        <div class="pill shards">${ICONS.shard}<span class="shard-value">0</span></div>
      </div>
      <div class="tree-viewport">
        <div class="tree-map">
          <svg class="tree-edges" viewBox="${BOUNDS.minX} ${BOUNDS.minY} ${BOUNDS.w} ${BOUNDS.h}" preserveAspectRatio="none" aria-hidden="true"></svg>
          <div class="tree-hub" style="${at(0, 0)}"><span></span></div>
        </div>
      </div>
      <div class="tree-card">
        <div class="tree-card-icon"></div>
        <div class="tree-card-body">
          <div class="tree-card-name"></div>
          <div class="tree-card-effect"><span class="tree-chip"></span><span class="tree-hint"></span></div>
        </div>
        <button class="tree-buy" type="button" tabindex="-1"></button>
      </div>`;
    root.appendChild(this.el);

    const q = <T extends Element>(sel: string) => this.el.querySelector<T>(sel)!;
    this.viewport = q('.tree-viewport');
    this.map = q('.tree-map');
    this.hub = q('.tree-hub');
    this.shardPill = q('.shards');
    this.shardValue = q('.shard-value');
    this.card = {
      el: q('.tree-card'),
      icon: q('.tree-card-icon'),
      name: q('.tree-card-name'),
      chip: q('.tree-chip'),
      hint: q('.tree-hint'),
      buy: q('.tree-buy'),
    };

    const svg = q<SVGSVGElement>('.tree-edges');
    for (const n of TREE) {
      const parents: (NodeId | null)[] = n.requires.length ? [...drawnParents(n)] : [null];
      for (const from of parents) {
        const [x1, y1] = from ? NODE_BY_ID[from].pos : [0, 0];
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(n.pos[0]));
        line.setAttribute('y2', String(n.pos[1]));
        line.dataset.branch = n.branch;
        svg.appendChild(line);
        this.edges.push({ from, to: n.id, el: line });
      }
    }

    for (const n of TREE) {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = 'tree-node';
      b.dataset.branch = n.branch;
      b.setAttribute('aria-label', n.name);
      b.setAttribute('style', at(n.pos[0], n.pos[1]));
      const gate = gateEra(n);
      b.innerHTML = `<span class="tree-node-icon">${nodeIcon(n.effect)}</span>${
        gate === null ? '' : `<b class="tree-gate hex">${ROMAN[gate]}</b>`
      }<span class="tree-cost">${ICONS.shard}${formatNumber(n.cost)}</span>`;
      b.addEventListener('click', () => {
        if (this.drag?.moved) return;
        this.select(n.id);
      });
      this.map.appendChild(b);
      this.nodes.set(n.id, b);
    }

    // pointerdown + preventDefault keeps focus off the buttons, so Space and Enter
    // reach Input instead of clicking whatever was focused.
    const noFocus = (el: HTMLElement) => el.addEventListener('pointerdown', (e) => e.preventDefault());
    const close = q<HTMLButtonElement>('.tree-close');
    noFocus(close);
    close.addEventListener('click', () => this.close());
    noFocus(this.card.buy);
    this.card.buy.addEventListener('click', () => this.confirm());

    this.listenPan();
    window.addEventListener('resize', () => {
      if (this.openFlag) this.layout();
    });

    // Something else paused or resumed the game (menu, a lost pad): step aside.
    game.events.on('pause', ({ reason }) => {
      if (reason !== 'tree') this.hide();
    });
    game.events.on('resume', () => this.hide());
    game.events.on('buy', ({ id }) => this.bought(id));
    game.events.on('buyFail', () => restartClass(this.card.buy, 'shake'));
  }

  get isOpen(): boolean {
    return this.openFlag;
  }

  open(): void {
    if (this.openFlag || this.game.isPaused || this.game.isAscending) return;
    this.game.setPaused(true, 'tree');
    this.openFlag = true;
    this.el.hidden = false;
    this.selected = this.suggested();
    this.renderKey = '';
    this.render();
    this.layout();
    this.center(this.selected);
    restartClass(this.el, 'opening');
  }

  close(): void {
    if (!this.openFlag) return;
    this.hide();
    this.game.setPaused(false);
  }

  /** Select the nearest node in a screen direction. */
  move(dx: number, dy: number): void {
    const next = stepFrom(this.selected, dx, dy);
    if (next) this.select(next);
  }

  /** Buy the selected node. */
  confirm(): void {
    if (this.openFlag) this.game.buy(this.selected);
  }

  /** Whether any node can be bought right now, for the HUD button's badge. */
  anyAffordable(shards = this.game.state.meta.shards): boolean {
    const meta = this.game.state.meta;
    return TREE.some((n) => n.cost <= shards && nodeState(meta, n.id) === 'available');
  }

  update(): void {
    if (this.openFlag) this.render();
  }

  private hide(): void {
    if (!this.openFlag) return;
    this.openFlag = false;
    this.el.hidden = true;
    this.drag = null;
  }

  private select(id: NodeId): void {
    if (id === this.selected) return;
    this.selected = id;
    this.renderKey = '';
    this.render();
    this.reveal(id, true);
  }

  /** On open: the cheapest node you can buy, else the cheapest open one. */
  private suggested(): NodeId {
    const meta = this.game.state.meta;
    const open = TREE.filter((n) => nodeState(meta, n.id) === 'available').sort((a, b) => a.cost - b.cost);
    return (open.find((n) => n.cost <= meta.shards) ?? open[0] ?? TREE[0]).id;
  }

  private render(): void {
    const meta = this.game.state.meta;
    const key = `${meta.shards}|${meta.nodes.length}|${this.selected}`;
    if (key === this.renderKey) return;
    this.renderKey = key;
    this.shardValue.textContent = formatNumber(meta.shards);

    for (const n of TREE) {
      const state = nodeState(meta, n.id);
      const v: Visual = state === 'owned' ? 'owned' : state === 'locked' ? 'locked' : n.cost <= meta.shards ? 'ready' : 'short';
      const el = this.nodes.get(n.id)!;
      if (this.visuals.get(n.id) !== v) {
        this.visuals.set(n.id, v);
        el.dataset.state = v;
      }
      el.classList.toggle('selected', n.id === this.selected);
      const gate = gateEra(n);
      el.classList.toggle('gated', gate !== null && meta.highestEra < gate);
    }
    for (const e of this.edges) {
      const from = e.from === null || meta.nodes.includes(e.from);
      const to = meta.nodes.includes(e.to);
      e.el.dataset.state = to && from ? 'lit' : from ? 'open' : 'dim';
    }
    this.hub.firstElementChild!.textContent = ROMAN[meta.highestEra];

    this.renderCard(NODE_BY_ID[this.selected]);
  }

  private renderCard(n: TreeNode): void {
    const meta = this.game.state.meta;
    const v = this.visuals.get(n.id)!;
    const c = this.card;
    c.el.dataset.branch = n.branch;
    c.el.dataset.state = v;
    c.icon.innerHTML = nodeIcon(n.effect);
    c.name.textContent = n.name;
    const line = effectLine(n.effect);
    c.chip.innerHTML = line.chip;
    c.hint.textContent = line.hint;

    if (v === 'owned') {
      c.buy.innerHTML = ICONS.check;
      c.buy.setAttribute('aria-label', 'Owned');
    } else if (v === 'locked') {
      // Lock, then what it waits on.
      const missing = n.requires.filter((r) => !meta.nodes.includes(r));
      c.buy.innerHTML = `${ICONS.lock}${missing
        .map((r) => `<span class="tree-need" data-branch="${NODE_BY_ID[r].branch}">${nodeIcon(NODE_BY_ID[r].effect)}</span>`)
        .join('')}`;
      c.buy.setAttribute('aria-label', 'Locked');
    } else {
      c.buy.innerHTML = `${ICONS.shard}<span>${formatNumber(n.cost)}</span>`;
      c.buy.setAttribute('aria-label', `Buy for ${n.cost} Shards`);
    }
  }

  private bought(id: NodeId): void {
    this.renderKey = '';
    this.render();
    const el = this.nodes.get(id);
    restartClass(el, 'bought');
    restartClass(this.shardPill, 'drain');
    restartClass(this.card.el, 'bought');
    // Nodes this purchase opened.
    const meta = this.game.state.meta;
    for (const n of TREE) {
      if (n.requires.includes(id) && nodeState(meta, n.id) === 'available') restartClass(this.nodes.get(n.id), 'unlocked');
    }
  }

  /** Fit the map to the viewport, or keep it at MIN_UNIT and let it pan. */
  private layout(): void {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    this.unit = Math.max(MIN_UNIT, Math.min(MAX_UNIT, vw / BOUNDS.w, vh / BOUNDS.h));
    const mw = BOUNDS.w * this.unit;
    const mh = BOUNDS.h * this.unit;
    this.size = { vw, vh, mw, mh };
    this.map.style.width = `${mw}px`;
    this.map.style.height = `${mh}px`;
    this.map.style.setProperty('--unit', `${this.unit}px`);
    this.setPan(this.pan.x, this.pan.y, false);
  }

  private setPan(x: number, y: number, smooth: boolean): void {
    const { vw, vh, mw, mh } = this.size;
    this.pan.x = mw <= vw ? (vw - mw) / 2 : Math.min(0, Math.max(vw - mw, x));
    this.pan.y = mh <= vh ? (vh - mh) / 2 : Math.min(0, Math.max(vh - mh, y));
    this.map.classList.toggle('smooth', smooth);
    this.map.style.transform = `translate3d(${this.pan.x.toFixed(1)}px, ${this.pan.y.toFixed(1)}px, 0)`;
  }

  private center(id: NodeId): void {
    const [x, y] = NODE_BY_ID[id].pos;
    this.setPan(this.size.vw / 2 - (x - BOUNDS.minX) * this.unit, this.size.vh / 2 - (y - BOUNDS.minY) * this.unit, false);
  }

  /** Pan so a node is in view, with room for its cost chip. */
  private reveal(id: NodeId, smooth: boolean): void {
    const [x, y] = NODE_BY_ID[id].pos;
    const px = (x - BOUNDS.minX) * this.unit;
    const py = (y - BOUNDS.minY) * this.unit;
    const { vw, vh } = this.size;
    const margin = this.unit * 0.9;
    let { x: panX, y: panY } = this.pan;
    if (px + panX < margin) panX = margin - px;
    if (px + panX > vw - margin) panX = vw - margin - px;
    if (py + panY < margin) panY = margin - py;
    if (py + panY > vh - margin) panY = vh - margin - py;
    this.setPan(panX, panY, smooth);
  }

  private listenPan(): void {
    const vp = this.viewport;
    vp.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, panX: this.pan.x, panY: this.pan.y, moved: false };
    });
    vp.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      if (!d.moved) {
        d.moved = true;
        // Only now, so a plain tap still clicks the node under it.
        vp.setPointerCapture(e.pointerId);
      }
      this.setPan(d.panX + dx, d.panY + dy, false);
    });
    const end = (e: PointerEvent) => {
      if (this.drag?.id !== e.pointerId) return;
      // Let the click that follows a pan see `moved`, then forget the drag.
      const d = this.drag;
      setTimeout(() => {
        if (this.drag === d) this.drag = null;
      }, 0);
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);
    vp.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.setPan(this.pan.x - e.deltaX, this.pan.y - e.deltaY, false);
      },
      { passive: false },
    );
  }
}
