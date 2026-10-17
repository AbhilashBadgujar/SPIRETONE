import { Matrix4, Ray, Raycaster, Vector2, Vector3 } from 'three';
import { ERA_PRESETS } from '../data/eras';
import { ERA_IDS, type EraIndex } from '../data/ids';
import { CursorView, type CursorState } from '../render/cursor-view';
import { Gulls } from '../render/gulls';
import { IslandView } from '../render/island-view';
import { Juice } from '../render/juice';
import { LAYOUT, columnAngle, columnTopY, columnX, columnZ } from '../render/layout';
import { Ocean } from '../render/ocean';
import { Stage } from '../render/scene';
import type { ColumnId, Grid } from '../sim/grid';
import { ascendThreshold, isDroppable, previewDrop, totalBlocks, type DropPreview } from '../sim/island';
import {
  advance,
  ascend,
  bonusesFor,
  canAscend,
  currentCost,
  tryDrop,
  unlocksFor,
  type GameState,
} from '../sim/run';
import { OrbitCursor, moveSelection, type CursorContext } from './cursor';
import { Emitter, type GameEvents } from './events';
import { pickColumn } from './picking';

// The playable client: owns the sim state, the scene and the two control
// modes. Input (input.ts) calls in; the HUD reads state and listens on `events`.

export type ControlMode = 'orbit' | 'direct';
export type HoldSource = 'key' | 'pad' | 'button';

export interface CursorInfo {
  column: ColumnId;
  state: CursorState;
  cost: number;
  /** What a drop here would do; null when the column is blocked. */
  preview: DropPreview | null;
}

const FACE_TURN = 6;
/** Headroom above a column top for HUD anchors, clear of roofs and lamps. */
const ANCHOR_HEADROOM = 0.9;
const _v = new Vector3();

export class Game {
  readonly events = new Emitter<GameEvents>();
  readonly stage: Stage;

  private readonly view: IslandView;
  private readonly cursorView: CursorView;
  private readonly ocean = new Ocean();
  private readonly gulls = new Gulls();
  private readonly juice: Juice;
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
    this.stage.turntable.add(this.view.root, this.cursorView.root);
    this.juice = new Juice(grid, this.view, this.stage.turntable, this.events, () => this.state.run.island);

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

  drop(c: ColumnId = this.column): void {
    const incomeBefore = this.state.run.evaluation.income;
    const attempt = tryDrop(this.grid, this.state, c);
    if (!attempt.ok) {
      if (c === this.column) this.cursorView.shake();
      this.events.emit('reject', { column: c, reason: attempt.reason });
      return;
    }
    this.cursorView.pop();
    this.refreshIsland();
    this.events.emit('drop', { column: c, cost: attempt.cost, outcome: attempt.outcome, incomeBefore });
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
    if (this.mode === 'orbit') this.orbit.update(dt, this.cursorContext());
    this.updateHold(dt);
    advance(this.grid, this.state, dt);
    this.updateTurntable(dt);

    const c = this.column;
    this.cursorView.setTarget(c, this.state.run.island, this.cursorState(c), isSmart(this.previewAt(c)));
    this.cursorView.update(dt, this.time);
    this.view.update(dt, this.time);
    this.juice.update(dt, this.time);
    this.ocean.update(this.time);
    this.gulls.update(this.time);

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
      this.doAscend();
    }
  }

  private doAscend(): void {
    const shards = ascend(this.grid, this.state);
    if (shards === null) return;
    if (this.state.run.island.era !== this.era) {
      this.era = this.state.run.island.era;
      this.applyEra();
    }
    this.refreshIsland();
    this.juice.reset(this.state.run.evaluation);
    this.selected = 0;
    this.orbit.reset(this.cursorContext());
    this.events.emit('ascend', { shards });
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
  }
}

/** The smart-pause test: would this drop add something new? */
function isSmart(p: DropPreview | null): boolean {
  return p !== null && (p.newType || p.newBridge || p.newLighthouse);
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
