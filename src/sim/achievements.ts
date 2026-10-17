import { ACH_BY_ID, ACHIEVEMENTS, type AchCondition, type AchId, type Stats } from '../data/achievements';
import { HARMONY_TYPES } from '../data/ids';
import { TREE } from '../data/tree';
import type { DropOutcome } from './island';
import type { GameState } from './run';

// Achievement rules (GDD §9). Conditions read meta and the current island's
// evaluation; callers check after every event that can satisfy one (a drop,
// an Ascension, a purchase) and on load, which also back-fills achievements
// for saves made before they existed.

export function emptyStats(): Stats {
  return { blocks: 0, gullDrops: 0, goldenRolls: 0, cascades: 0, cascadeBlocks: 0, bestAscend: 0 };
}

/** Counts a successful drop's blocks, golden rolls and Cascade. */
export function recordDrop(stats: Stats, outcome: DropOutcome): void {
  stats.blocks += outcome.placed.length;
  stats.goldenRolls += outcome.goldenRolled.length;
  if (outcome.placed.length > 1) {
    stats.cascades += 1;
    stats.cascadeBlocks += outcome.placed.length - 1;
  }
}

export function met(cond: AchCondition, state: GameState): boolean {
  const { meta, run } = state;
  const ev = run.evaluation;
  switch (cond.kind) {
    case 'stat':
      return meta.stats[cond.stat] >= cond.atLeast;
    case 'ascensions':
      return meta.ascensions >= cond.atLeast;
    case 'era':
      return meta.highestEra >= cond.atLeast;
    case 'nodes':
      return meta.nodes.length >= cond.atLeast;
    case 'branch':
      return TREE.every((n) => (cond.branch !== 'all' && n.branch !== cond.branch) || meta.nodes.includes(n.id));
    case 'structure':
      return ev.typesPresent.includes(cond.structure);
    case 'harmony':
      return ev.harmony >= cond.atLeast - 1e-9;
    case 'island':
      switch (cond.test) {
        case 'bridge':
          return ev.bridgeCount > 0;
        case 'balcony':
          return ev.columns.some((c) => c.balconySides > 0);
        case 'beacon2':
          return ev.columns.some((c) => c.beacons >= 2);
        case 'fullChord':
          return HARMONY_TYPES.every((t) => ev.typesPresent.includes(t));
        case 'overclock':
          return ev.columns.some((c) => c.overclock > 0);
      }
  }
}

/** Unlocks everything newly met and returns those ids, in table order. */
export function checkAchievements(state: GameState): AchId[] {
  const owned = state.meta.achievements;
  const fresh: AchId[] = [];
  for (const a of ACHIEVEMENTS) {
    if (owned.includes(a.id) || !met(a.condition, state)) continue;
    owned.push(a.id);
    fresh.push(a.id);
  }
  return fresh;
}

export function gamerscore(ids: readonly AchId[]): number {
  return ids.reduce((sum, id) => sum + ACH_BY_ID[id].points, 0);
}
