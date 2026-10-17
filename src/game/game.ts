import { Matrix4, Ray, Raycaster, Vector2, Vector3 } from 'three';
import { ERA_PRESETS } from '../data/eras';
import { ERA_IDS, type EraIndex } from '../data/ids';
import type { NodeId } from '../data/tree';
import { Ambience } from '../render/ambience';
import { CursorView, type CursorState } from '../render/cursor-view';
import { Flock } from '../render/flock';
import { Gulls } from '../render/gulls';
import { DROP_FALL_HEIGHT, IslandView } from '../render/island-view';
import { Juice } from '../render/juice';
import { LAYOUT, columnAngle, columnTopY, columnX, columnZ } from '../render/layout';
import { Ocean } from '../render/ocean';
import { Stage } from '../render/scene';
import { evaluate } from '../sim/evaluate';
import type { ColumnId, Grid } from '../sim/grid';
import { advanceGulls } from '../sim/gulls';
import { ascendThreshold, isDroppable, previewDrop, totalBlocks, type DropPreview } from '../sim/island';
import {
  advance,
  ascend,
  bonusesFor,
  canAscend,
  currentCost,
  shardsOnAscend,
  tryDrop,
  unlocksFor,
  type DropAttempt,
  type GameState,
} from '../sim/run';
import { buyNode, effectsOf, type BuyRejection } from '../sim/tree';
import { ASCENSION, ASCENSION_TOTAL, ascensionPose } from './ascension';
import { OrbitCursor, moveSelection, type CursorContext } from './cursor';
import { Emitter, type GameEvents } from './events';
import { pickColumn } from './picking';

// The playable client: owns the sim state, the scene and the two control
// modes. Input (input.ts) calls in; the HUD reads state and listens on `events`.

export type ControlMode = 'orbit' | 'direct';
export type HoldSource = 'key' | 'pad' | 'button';
export type DropSource = 'key' | 'pad' | 'pointer';
/** 'menu' shows the pause veil; 'tree' freezes play behind the tree screen. */
export type PauseReason = 'menu' | 'tree';

export interface CursorInfo {
  column: ColumnId;
  state: CursorState;
  cost: number;
  /** What a drop here would do; null when the column is blocked. */
  preview: DropPreview | null;
}

const FACE_TURN = 6;
/** Surf is gone once the island is this far out of the water. */
const SURF_FADE_HEIGHT = 0.8;
/** Headroom above a column top for HUD anchors, clear of roofs and lamps. */
const ANCHOR_HEADROOM = 0.9;
const _v = new Vector3();
const _fall = new Vector3();

export class Game {
  readonly events = new Emitter<GameEvents>();
  readonly stage: Stage;

  private readonly view: IslandView;
  private readonly cursorView: CursorView;
  private readonly ocean = new Ocean();
  private readonly gulls = new Gulls();
  /** Worker Gulls, one per owned Gull node. */
  private readonly flock = new Flock();
  private readonly juice: Juice;
  private readonly ambience: Ambience;
  private readonly orbit: OrbitCursor;

  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly ray = new Ray();
  private readonly inverse = new Matrix4();

  private mode: ControlMode;
  private selected: ColumnId = 0;
  /** Direct mode via keys/stick turns the island to face the selection; hover doesn't. */
  private faceSelected = false;
  private readonly holds = new Set<HoldSource>();
  private holdTime = 0;
  /** After an Ascend, the hold must be released before another can start. */
  private holdLatched = false;
  private holdBlockedShown = false;
  /** Bumped whenever the island changes, to invalidate the preview cache. */
  private version = 0;
  private previewCache: { column: ColumnId; version: number; preview: DropPreview | null } = {
    column: -1,
    version: -1,
    preview: null,
  };
  private era: EraIndex;
  private time = 0;
  /** Running Ascension sequence, or null. */
  private ascension: { t: number; shards: number; phase: 'rise' | 'descend' | 'settle' } | null = null;
  private pauseReason: PauseReason | null = null;
  /** Drop inputs held down, for NODE_O3 rapid drop. */
  private readonly dropHolds = new Set<DropSource>();
  private rapidTimer = 0;

  constructor(
    readonly grid: Grid,
    readonly state: GameState,
    container: HTMLElement,
    mode: ControlMode,
  ) {
    this.stage = new Stage(container);
    this.view = new IslandView(grid);
    this.cursorView = new CursorView(grid);
    this.orbit = new OrbitCursor(grid);
    this.stage.scene.add(this.ocean.water, this.gulls.mesh);
    this.stage.turntable.add(this.view.root, this.cursorView.root, this.flock.birds, this.flock.blocks);
    this.juice = new Juice(grid, this.view, this.stage.turntable, this.events, () => this.state.run.island);
    this.ambience = new Ambience(
      grid,
      () => this.state.run.island,
      () => this.state.run.evaluation,
    );
    this.stage.turntable.add(...this.ambience.meshes);

    this.era = state.run.island.era;
    this.applyEra();
    this.refreshIsland();
    this.juice.reset(state.run.evaluation);
    this.mode = mode;
    this.orbit.reset(this.cursorContext());
  }

  get controlMode(): ControlMode {
    return this.mode;
  }

  /** The column a Drop would hit. */
  get column(): ColumnId {
    return this.mode === 'orbit' ? this.orbit.column : this.selected;
  }

  /** 0..1 progress of the Ascend hold. */
  get ascendProgress(): number {
    return this.holdTime / this.grid.k.K_ASCEND_HOLD;
  }

  get isPaused(): boolean {
    return this.pauseReason !== null;
  }

  get pausedBy(): PauseReason | null {
    return this.pauseReason;
  }

  /** A held Drop is repeating (NODE_O3). */
  get isRapidDropping(): boolean {
    return this.dropHolds.size > 0 && !this.pauseReason && !this.ascension && unlocksFor(this.state.meta).rapidDrop;
  }

  get isAscending(): boolean {
    return this.ascension !== null;
  }

  /** Seconds into the running Ascension sequence, or null. The HUD flash runs on this clock. */
  get ascensionTime(): number | null {
    return this.ascension?.t ?? null;
  }

  /** Freezes the economy, cursor and turntable; ambient scenery keeps moving. */
  setPaused(paused: boolean, reason: PauseReason = 'menu'): void {
    const next = paused ? reason : null;
    if (next === this.pauseReason) return;
    this.pauseReason = next;
    this.holds.clear();
    this.dropHolds.clear();
    this.holdTime = 0;
    if (next) this.events.emit('pause', { reason: next });
    else this.events.emit('resume', {});
  }

  /** Buys a tree node. Yield bonuses apply to this island at once; eras from the next. */
  buy(id: NodeId): BuyRejection | null {
    const rejection = buyNode(this.state.meta, id);
    if (rejection) {
      this.events.emit('buyFail', { id, reason: rejection });
      return rejection;
    }
    const { run, meta } = this.state;
    run.evaluation = evaluate(this.grid, run.island, bonusesFor(meta));
    this.refreshIsland();
    this.events.emit('buy', { id });
    return null;
  }

  /** NODE_O3: while a Drop input stays held, drops repeat every K_RAPID_INTERVAL. */
  setDropHeld(source: DropSource, held: boolean): void {
    const wasHeld = this.dropHolds.size > 0;
    if (held) this.dropHolds.add(source);
    else this.dropHolds.delete(source);
    // The press itself already dropped; the first repeat comes one interval later.
    if (!wasHeld) this.rapidTimer = this.grid.k.K_RAPID_INTERVAL;
  }

  cursorInfo(): CursorInfo {
    const c = this.column;
    return {
      column: c,
      state: this.cursorState(c),
      cost: currentCost(this.grid, this.state.run),
      preview: this.previewAt(c),
    };
  }

  /** Turntable-space point just above column c, for floating HUD labels. */
  columnAnchor(c: ColumnId, out: Vector3): Vector3 {
    const { island } = this.state.run;
    const top = island.inPlaza[c] ? LAYOUT.groundY + LAYOUT.plazaHeight : columnTopY(island.heights[c]);
    return out.set(columnX(this.grid, c), top + ANCHOR_HEADROOM, columnZ(this.grid, c));
  }

  cursorAnchor(out: Vector3): Vector3 {
    return this.cursorView.anchor(out);
  }

  /** Turntable-space point to CSS pixels. Returns false when behind the camera. */
  project(local: Vector3, out: { x: number; y: number }): boolean {
    _v.copy(local).applyMatrix4(this.stage.turntable.matrixWorld).project(this.stage.camera);
    if (_v.z > 1) return false;
    const canvas = this.stage.renderer.domElement;
    out.x = ((_v.x + 1) / 2) * canvas.clientWidth;
    out.y = ((1 - _v.y) / 2) * canvas.clientHeight;
    return true;
  }

  setMode(mode: ControlMode): void {
    if (mode === this.mode) return;
    if (mode === 'orbit') this.orbit.reset(this.cursorContext(), this.selected);
    else this.selected = this.orbit.column;
    this.faceSelected = false;
    this.mode = mode;
  }

  /** `quiet`: a held repeat; a refused one passes silently instead of shaking. */
  drop(c: ColumnId = this.column, quiet = false): void {
    if (this.pauseReason || this.ascension) return;
    const incomeBefore = this.state.run.evaluation.income;
    const attempt = tryDrop(this.grid, this.state, c);
    if (!attempt.ok) {
      if (quiet) return;
      if (c === this.column) this.cursorView.shake();
      this.events.emit('reject', { column: c, reason: attempt.reason });
      return;
    }
    this.cursorView.pop();
    this.landed(c, attempt, incomeBefore, 'player', 0);
  }

  /** Shared tail of player and Gull drops. `delay`: seconds until the block starts to fall. */
  private landed(
    c: ColumnId,
    attempt: Extract<DropAttempt, { ok: true }>,
    incomeBefore: number,
    by: 'player' | 'gull',
    delay: number,
  ): void {
    this.refreshIsland();
    this.events.emit('drop', { column: c, cost: attempt.cost, outcome: attempt.outcome, incomeBefore, by, delay });
  }

  /** A worker Gull carries the block in; it falls on its own if every bird is busy. */
  private gullDrop(c: ColumnId, attempt: Extract<DropAttempt, { ok: true }>, incomeBefore: number): void {
    const { island } = this.state.run;
    // Where the column's new top starts its fall (IslandView.dropPose).
    const base = island.inPlaza[c] ? LAYOUT.groundY : columnTopY(island.heights[c] - 1);
    _fall.set(columnX(this.grid, c), base + DROP_FALL_HEIGHT, columnZ(this.grid, c));
    const delay = this.flock.dispatch(_fall, columnAngle(this.grid, c)) ?? 0;
    this.landed(c, attempt, incomeBefore, 'gull', delay);
  }

  select(c: ColumnId, source: 'pointer' | 'keys'): void {
    if (this.mode !== 'direct') return;
    this.selected = c;
    this.faceSelected = source === 'keys';
  }

  move(dIndex: number, dRing: number): void {
    if (this.mode !== 'direct') return;
    this.select(moveSelection(this.grid, this.selected, dIndex, dRing), 'keys');
  }

  setHold(source: HoldSource, held: boolean): void {
    if (held) this.holds.add(source);
    else this.holds.delete(source);
  }

  /** Column under a screen point, or null. */
  pick(clientX: number, clientY: number): ColumnId | null {
    const rect = this.stage.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.stage.camera);
    this.stage.turntable.updateMatrixWorld();
    this.inverse.copy(this.stage.turntable.matrixWorld).invert();
    this.ray.copy(this.raycaster.ray).applyMatrix4(this.inverse);
    return pickColumn(this.grid, this.state.run.island, this.ray);
  }

  update(dt: number): void {
    this.time += dt;
    if (this.ascension && !this.pauseReason) {
      this.updateAscension(dt);
    } else if (!this.pauseReason) {
      if (this.mode === 'orbit') this.orbit.update(dt, this.cursorContext());
      this.updateHold(dt);
      this.updateRapidDrop(dt);
      advance(this.grid, this.state, dt);
      for (const g of advanceGulls(this.grid, this.state, dt)) this.gullDrop(g.column, g.attempt, g.incomeBefore);
      this.updateTurntable(dt);
    }

    const c = this.column;
    this.cursorView.setTarget(c, this.state.run.island, this.cursorState(c), isSmart(this.previewAt(c)));
    this.cursorView.update(dt, this.time);
    this.view.update(dt, this.time);
    this.juice.update(dt, this.time);
    this.ambience.update(dt);
    this.ocean.update(this.time);
    this.gulls.update(this.time);
    this.flock.setCount(effectsOf(this.state.meta.nodes).gulls, this.time);
    this.flock.update(dt, this.time);

    this.stage.update(dt);
    this.stage.render();
  }

  private updateHold(dt: number): void {
    if (this.holds.size === 0) {
      this.holdTime = 0;
      this.holdLatched = false;
      this.holdBlockedShown = false;
      return;
    }
    if (this.holdLatched) return;
    const { run } = this.state;
    if (!canAscend(this.grid, run)) {
      this.holdTime = 0;
      if (!this.holdBlockedShown) {
        this.holdBlockedShown = true;
        const remaining = ascendThreshold(this.grid, run.island) - totalBlocks(run.island);
        this.events.emit('ascendBlocked', { remaining });
      }
      return;
    }
    this.holdTime += dt;
    if (this.holdTime >= this.grid.k.K_ASCEND_HOLD) {
      this.holdLatched = true;
      this.holdTime = 0;
      this.beginAscension();
    }
  }

  private updateRapidDrop(dt: number): void {
    if (this.dropHolds.size === 0 || !unlocksFor(this.state.meta).rapidDrop) return;
    this.rapidTimer -= dt;
    while (this.rapidTimer <= 0) {
      this.rapidTimer += this.grid.k.K_RAPID_INTERVAL;
      this.drop(this.column, true);
    }
  }

  private beginAscension(): void {
    const { run } = this.state;
    if (!canAscend(this.grid, run)) return;
    // The economy is frozen from here, so this is exactly what the peak pays.
    const shards = shardsOnAscend(this.grid, run);
    this.ascension = { t: 0, shards, phase: 'rise' };
    this.cursorView.root.visible = false;
    // The island is about to lift off under any bird still carrying a block.
    this.flock.recall();
    this.events.emit('ascendStart', { shards });
  }

  private updateAscension(dt: number): void {
    const a = this.ascension!;
    a.t += dt;
    if (a.phase === 'rise' && a.t >= ASCENSION.rise) {
      a.phase = 'descend';
      this.swapIsland();
    }
    if (a.phase === 'descend' && a.t >= ASCENSION.rise + ASCENSION.descend) {
      a.phase = 'settle';
      this.events.emit('ascendLand', {});
    }

    const root = this.view.root;
    if (a.t >= ASCENSION_TOTAL) {
      root.position.y = 0;
      root.scale.set(1, 1, 1);
      this.ocean.setSurf(1);
      this.cursorView.root.visible = true;
      this.ascension = null;
      this.events.emit('ascendEnd', { shards: a.shards });
      return;
    }
    const pose = ascensionPose(a.t);
    root.position.y = pose.y;
    // No island in the water, no surf around it.
    this.ocean.setSurf(Math.max(0, 1 - pose.y / SURF_FADE_HEIGHT));
    const widen = 1 / Math.sqrt(pose.squash);
    root.scale.set(widen, pose.squash, widen);
    const tt = this.stage.turntable;
    tt.rotation.y = wrapAngle(tt.rotation.y + pose.spin * dt);
  }

  /** The peak: bank Shards and build the next island while the flash hides it. */
  private swapIsland(): void {
    const shards = ascend(this.grid, this.state);
    if (shards === null) return;
    const eraChanged = this.state.run.island.era !== this.era;
    if (eraChanged) {
      this.era = this.state.run.island.era;
      this.applyEra();
    }
    this.refreshIsland();
    this.juice.reset(this.state.run.evaluation);
    this.selected = 0;
    this.orbit.reset(this.cursorContext());
    this.events.emit('ascend', { shards });
    if (eraChanged) this.events.emit('era', { era: this.era });
  }

  private updateTurntable(dt: number): void {
    const tt = this.stage.turntable;
    if (this.mode === 'orbit') {
      tt.rotation.y = wrapAngle(tt.rotation.y + LAYOUT.turntableSpeed * dt);
    } else if (this.faceSelected) {
      const d = wrapAngle(-columnAngle(this.grid, this.selected) - tt.rotation.y);
      tt.rotation.y = wrapAngle(tt.rotation.y + d * (1 - Math.exp(-FACE_TURN * dt)));
    }
  }

  private cursorState(c: ColumnId): CursorState {
    const { run } = this.state;
    if (!isDroppable(this.grid, run.island, c)) return 'blocked';
    return run.resonance >= currentCost(this.grid, run) ? 'ready' : 'broke';
  }

  /** previewDrop for c, cached per island version. */
  private previewAt(c: ColumnId): DropPreview | null {
    const cache = this.previewCache;
    if (cache.column !== c || cache.version !== this.version) {
      const { run } = this.state;
      cache.column = c;
      cache.version = this.version;
      cache.preview = previewDrop(this.grid, run.island, c, bonusesFor(this.state.meta), run.evaluation);
    }
    return cache.preview;
  }

  private cursorContext(): CursorContext {
    const { run, meta } = this.state;
    return {
      island: run.island,
      evaluation: run.evaluation,
      bonuses: bonusesFor(meta),
      skipBlocked: unlocksFor(meta).orbitSkipsBlocked,
      stepMult: effectsOf(meta.nodes).cursorStepMult,
    };
  }

  private refreshIsland(): void {
    this.version++;
    this.view.sync(this.state.run.island, this.state.run.evaluation);
    this.stage.frameColumns(this.view.ringMaxHeights);
  }

  private applyEra(): void {
    const preset = ERA_PRESETS[ERA_IDS[this.era]];
    this.stage.applyPreset(preset);
    this.ocean.applyPreset(preset);
    this.view.applyPreset(preset);
    this.juice.applyPreset(preset);
    this.flock.applyPreset(preset);
    this.ambience.applyPreset(preset);
    // Ambient gulls are Era I's particle system; worker Gulls fly in every era.
    this.gulls.mesh.visible = preset.ambient === 'gulls';
  }
}

/** The smart-pause test: would this drop add something new? */
function isSmart(p: DropPreview | null): boolean {
  return p !== null && (p.newType || p.newBridge || p.newLighthouse);
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
