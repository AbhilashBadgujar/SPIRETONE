import { HARMONY_TYPES, type EraIndex, type StructureId } from '../data/ids';
import { NODE_BY_ID, type NodeId } from '../data/tree';
import { evaluate, plazaGroup } from './evaluate';
import type { ColumnId, Grid } from './grid';
import type { Island } from './island';
import { bonusesFor, type GameState, type Meta } from './run';
import { effectsOf } from './tree';

// Save format. Only source state is stored; the evaluation is rebuilt on
// load. Loading is defensive: anything structurally wrong rejects the save,
// while values that a later tuning pass could invalidate (a lowered cap) are
// clamped instead.
//
// v1 → v2: v2 adds owned tree nodes. A v1 save loads with an empty tree.

export const SAVE_VERSION = 2;

export interface SaveData {
  v: typeof SAVE_VERSION;
  savedAt: number;
  meta: Meta;
  run: {
    island: {
      era: EraIndex;
      heights: number[];
      plazas: ColumnId[];
      golden: boolean[];
      paidBlocks: number;
      discovered: StructureId[];
    };
    resonance: number;
    earned: number;
    tickCarry: number;
    rngSeed: number;
  };
}

export function serialize(state: GameState, now = Date.now()): SaveData {
  const { meta, run } = state;
  const { island } = run;
  return {
    v: SAVE_VERSION,
    savedAt: now,
    meta: { ...meta, nodes: meta.nodes.slice() },
    run: {
      island: {
        era: island.era,
        heights: island.heights.slice(),
        plazas: island.plazas.slice(),
        golden: island.golden.slice(),
        paidBlocks: island.paidBlocks,
        discovered: island.discovered.slice(),
      },
      resonance: run.resonance,
      earned: run.earned,
      tickCarry: run.tickCarry,
      rngSeed: run.rngSeed,
    },
  };
}

/** A playable GameState, or null if `data` isn't a save this build can trust. */
export function deserialize(grid: Grid, data: unknown): GameState | null {
  const n = grid.columnCount;
  const eras = grid.k.K_CAP_ERA.length;
  if (!isObject(data) || (data.v !== 1 && data.v !== SAVE_VERSION)) return null;
  const { meta, run } = data;
  if (!isObject(meta) || !isObject(run) || !isObject(run.island)) return null;
  const isl = run.island;

  // Owned nodes: known ids only, each once. The era follows from them.
  const savedNodes = data.v === 1 ? [] : meta.nodes;
  if (!Array.isArray(savedNodes)) return null;
  const nodes = [...new Set(savedNodes as unknown[])].filter((id): id is NodeId => typeof id === 'string' && id in NODE_BY_ID);
  const highestEra = effectsOf(nodes).highestEra;

  if (
    !nonNeg(meta.shards) ||
    !isEra(meta.highestEra, eras) ||
    !nonNeg(meta.ascensions) ||
    !nonNeg(meta.lifetimeResonance) ||
    !isEra(isl.era, eras) ||
    isl.era > highestEra ||
    !arrayOf(isl.heights, n, (h) => Number.isInteger(h) && h >= 0) ||
    !arrayOf(isl.golden, n, (g) => typeof g === 'boolean') ||
    !Array.isArray(isl.plazas) ||
    !Array.isArray(isl.discovered) ||
    !nonNeg(isl.paidBlocks) ||
    !nonNeg(run.resonance) ||
    !nonNeg(run.earned) ||
    !nonNeg(run.tickCarry) ||
    !Number.isInteger(run.rngSeed)
  ) {
    return null;
  }

  const era = isl.era as EraIndex;
  const heights = (isl.heights as number[]).map((h, c) => Math.min(h, grid.caps[era][c]));

  // Plaza anchors are the source of truth; inPlaza is rebuilt from them.
  // A group that no longer fits (bad anchor, overlap, wrong height) is dropped.
  const inPlaza = new Array<boolean>(n).fill(false);
  const plazas: ColumnId[] = [];
  for (const anchor of isl.plazas as unknown[]) {
    if (!Number.isInteger(anchor) || (anchor as number) < 0 || (anchor as number) >= n) continue;
    if (grid.ring[anchor as number] >= grid.k.K_RINGS - 1) continue;
    const group = plazaGroup(grid, anchor as number);
    if (group.some((c) => inPlaza[c] || heights[c] !== grid.k.K_PLAZA_HEIGHT)) continue;
    for (const c of group) inPlaza[c] = true;
    plazas.push(anchor as number);
  }

  const known: readonly StructureId[] = HARMONY_TYPES;
  const discovered = (isl.discovered as unknown[]).filter((s): s is StructureId => known.includes(s as StructureId));

  const island: Island = {
    era,
    heights,
    inPlaza,
    plazas,
    golden: (isl.golden as boolean[]).slice(),
    paidBlocks: Math.floor(isl.paidBlocks as number),
    discovered: [...new Set(discovered)],
  };
  const restoredMeta: Meta = {
    shards: Math.floor(meta.shards as number),
    nodes,
    highestEra,
    ascensions: Math.floor(meta.ascensions as number),
    lifetimeResonance: meta.lifetimeResonance as number,
  };
  return {
    meta: restoredMeta,
    run: {
      island,
      resonance: run.resonance as number,
      earned: run.earned as number,
      tickCarry: Math.min(run.tickCarry as number, grid.k.K_TICK),
      rngSeed: run.rngSeed as number,
      evaluation: evaluate(grid, island, bonusesFor(restoredMeta)),
      gullCarry: 0,
    },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonNeg(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function isEra(v: unknown, eras: number): v is EraIndex {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) < eras;
}

function arrayOf(v: unknown, length: number, ok: (x: never) => boolean): boolean {
  return Array.isArray(v) && v.length === length && v.every((x) => ok(x as never));
}
