import type { Constants } from '../data/constants';
import type { EraIndex, StructureId } from '../data/ids';
import { NODE_BY_ID, TREE, type NodeId } from '../data/tree';
import type { Bonuses } from './evaluate';

// Upgrade-tree rules (GDD §7): buying nodes and folding owned nodes into
// the effects the rest of the sim reads.

export interface Effects {
  bonuses: Bonuses;
  rapidDrop: boolean;
  orbitSkipsBlocked: boolean;
  startResMult: number;
  cursorStepMult: number;
  gulls: number;
  gullIntervalMult: number;
  /** Highest era any owned core node unlocks. */
  highestEra: EraIndex;
}

export type NodeState = 'owned' | 'available' | 'locked';
export type BuyRejection = 'UNKNOWN' | 'OWNED' | 'LOCKED' | 'CANT_AFFORD';

/** The part of Meta the tree reads and writes. */
export interface TreeOwner {
  shards: number;
  nodes: NodeId[];
  highestEra: EraIndex;
}

const cache = new WeakMap<readonly NodeId[], { length: number; effects: Effects }>();

/** Effects of a set of owned nodes. Cached per array until it changes length. */
export function effectsOf(nodes: readonly NodeId[]): Effects {
  const hit = cache.get(nodes);
  if (hit && hit.length === nodes.length) return hit.effects;

  const additiveByType: Partial<Record<StructureId, number>> = {};
  const effects: Effects = {
    bonuses: { additive: 0, additiveByType, incomeMult: 1, goldenChance: 0 },
    rapidDrop: false,
    orbitSkipsBlocked: false,
    startResMult: 1,
    cursorStepMult: 1,
    gulls: 0,
    gullIntervalMult: 1,
    highestEra: 0,
  };
  for (const id of nodes) {
    const e = NODE_BY_ID[id]?.effect;
    if (!e) continue;
    switch (e.kind) {
      case 'era':
        effects.highestEra = Math.max(effects.highestEra, e.era) as EraIndex;
        break;
      case 'typeYield':
        additiveByType[e.structure] = (additiveByType[e.structure] ?? 0) + e.add;
        break;
      case 'incomeMult':
        effects.bonuses.incomeMult *= e.mult;
        break;
      case 'golden':
        effects.bonuses.goldenChance += e.chance;
        break;
      case 'gulls':
        effects.gulls += e.add;
        break;
      case 'gullInterval':
        effects.gullIntervalMult *= e.mult;
        break;
      case 'cursorStep':
        effects.cursorStepMult *= e.mult;
        break;
      case 'rapidDrop':
        effects.rapidDrop = true;
        break;
      case 'orbitSkip':
        effects.orbitSkipsBlocked = true;
        break;
      case 'startRes':
        effects.startResMult *= e.mult;
        break;
    }
  }
  cache.set(nodes, { length: nodes.length, effects });
  return effects;
}

export function nodeState(owner: TreeOwner, id: NodeId): NodeState {
  if (owner.nodes.includes(id)) return 'owned';
  return NODE_BY_ID[id].requires.every((r) => owner.nodes.includes(r)) ? 'available' : 'locked';
}

export function buyRejection(owner: TreeOwner, id: NodeId): BuyRejection | null {
  const node = NODE_BY_ID[id];
  if (!node) return 'UNKNOWN';
  const state = nodeState(owner, id);
  if (state === 'owned') return 'OWNED';
  if (state === 'locked') return 'LOCKED';
  if (owner.shards < node.cost) return 'CANT_AFFORD';
  return null;
}

/** Spends Shards on a node. Era nodes take effect from the next island (GDD §6). */
export function buyNode(owner: TreeOwner, id: NodeId): BuyRejection | null {
  const rejection = buyRejection(owner, id);
  if (rejection) return rejection;
  owner.shards -= NODE_BY_ID[id].cost;
  owner.nodes.push(id);
  owner.highestEra = effectsOf(owner.nodes).highestEra;
  return null;
}

/** Seconds per Gull drop for the whole flock, or Infinity with no Gulls. */
export function flockInterval(k: Readonly<Constants>, e: Effects): number {
  return e.gulls > 0 ? (k.K_GULL_INTERVAL * e.gullIntervalMult) / e.gulls : Infinity;
}

export const ALL_NODES: readonly NodeId[] = TREE.map((n) => n.id);
