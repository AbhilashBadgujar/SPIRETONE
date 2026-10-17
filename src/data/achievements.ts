import type { StructureId } from './ids';
import type { Branch } from './tree';

// Achievements (GDD §9): 34 for 1000G. Nothing missable: every condition
// can be met on any later island, and lifetime counters never reset.
// Count thresholds come from the pacing simulator (§11, tools/pacing.ts),
// which also checks that the last one lands at 2:45–3:00.

export type AchId =
  | 'ACH_FIRST_DROP'
  | 'ACH_PIER'
  | 'ACH_TOWER'
  | 'ACH_PLAZA'
  | 'ACH_BRIDGE'
  | 'ACH_BALCONY'
  | 'ACH_LIGHTHOUSE'
  | 'ACH_BEACON'
  | 'ACH_FULL_CHORD'
  | 'ACH_HARMONY_6'
  | 'ACH_GOLDEN'
  | 'ACH_GOLDEN_20'
  | 'ACH_OVERCLOCK'
  | 'ACH_CASCADE'
  | 'ACH_CASCADE_100'
  | 'ACH_ASCEND_1'
  | 'ACH_ASCEND_5'
  | 'ACH_ASCEND_10'
  | 'ACH_ASCEND_20'
  | 'ACH_SHARDS_100'
  | 'ACH_SHARDS_1000'
  | 'ACH_ERA_2'
  | 'ACH_ERA_3'
  | 'ACH_ERA_4'
  | 'ACH_NODE_1'
  | 'ACH_BRANCH_START'
  | 'ACH_BRANCH_ORBIT'
  | 'ACH_BRANCH_LUCK'
  | 'ACH_BRANCH_GULLS'
  | 'ACH_BRANCH_YIELD'
  | 'ACH_TREE_FULL'
  | 'ACH_GULL_1'
  | 'ACH_GULL_500'
  | 'ACH_BLOCKS_1000';

/** Lifetime counters (survive Ascension). */
export interface Stats {
  /** Blocks placed by any source: player, Gulls and Cascades. */
  blocks: number;
  gullDrops: number;
  goldenRolls: number;
  /** Player or Gull drops that set off at least one Cascade block. */
  cascades: number;
  cascadeBlocks: number;
  /** Most Shards from a single Ascension. */
  bestAscend: number;
}

export const STAT_IDS: readonly (keyof Stats)[] = ['blocks', 'gullDrops', 'goldenRolls', 'cascades', 'cascadeBlocks', 'bestAscend'];

export type AchCondition =
  /** A lifetime counter reaches a value. */
  | { kind: 'stat'; stat: keyof Stats; atLeast: number }
  | { kind: 'ascensions'; atLeast: number }
  /** Era index unlocked (0 = Era I). */
  | { kind: 'era'; atLeast: number }
  | { kind: 'nodes'; atLeast: number }
  /** Every node of a branch owned, or the whole tree. */
  | { kind: 'branch'; branch: Branch | 'all' }
  /** A structure type stands on the current island. */
  | { kind: 'structure'; structure: StructureId }
  /** The current island's evaluation shows this. */
  | { kind: 'island'; test: 'bridge' | 'balcony' | 'beacon2' | 'fullChord' | 'overclock' }
  | { kind: 'harmony'; atLeast: number };

export interface Achievement {
  id: AchId;
  name: string;
  points: number;
  condition: AchCondition;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'ACH_FIRST_DROP', name: 'First Stone', points: 5, condition: { kind: 'stat', stat: 'blocks', atLeast: 1 } },
  { id: 'ACH_PIER', name: 'Low Tide', points: 10, condition: { kind: 'structure', structure: 'ST_PIER' } },
  { id: 'ACH_TOWER', name: 'Upward', points: 10, condition: { kind: 'structure', structure: 'ST_TOWER' } },
  { id: 'ACH_PLAZA', name: 'Market Square', points: 15, condition: { kind: 'structure', structure: 'ST_PLAZA' } },
  { id: 'ACH_BRIDGE', name: 'Span', points: 15, condition: { kind: 'island', test: 'bridge' } },
  { id: 'ACH_BALCONY', name: 'Room with a View', points: 15, condition: { kind: 'island', test: 'balcony' } },
  { id: 'ACH_LIGHTHOUSE', name: 'Keeper of the Light', points: 20, condition: { kind: 'structure', structure: 'ST_LIGHTHOUSE' } },
  { id: 'ACH_BEACON', name: 'Guiding Light', points: 20, condition: { kind: 'island', test: 'beacon2' } },
  { id: 'ACH_FULL_CHORD', name: 'Full Chord', points: 35, condition: { kind: 'island', test: 'fullChord' } },
  { id: 'ACH_HARMONY_6', name: 'Perfect Pitch', points: 30, condition: { kind: 'harmony', atLeast: 6 } },
  { id: 'ACH_GOLDEN', name: 'Midas Touch', points: 15, condition: { kind: 'stat', stat: 'goldenRolls', atLeast: 1 } },
  { id: 'ACH_GOLDEN_20', name: 'Gilded Age', points: 30, condition: { kind: 'stat', stat: 'goldenRolls', atLeast: 20 } },
  { id: 'ACH_OVERCLOCK', name: 'Gear Train', points: 20, condition: { kind: 'island', test: 'overclock' } },
  { id: 'ACH_CASCADE', name: 'Chain Reaction', points: 20, condition: { kind: 'stat', stat: 'cascades', atLeast: 1 } },
  { id: 'ACH_CASCADE_100', name: 'Avalanche', points: 30, condition: { kind: 'stat', stat: 'cascadeBlocks', atLeast: 100 } },
  { id: 'ACH_ASCEND_1', name: 'Lift Off', points: 20, condition: { kind: 'ascensions', atLeast: 1 } },
  { id: 'ACH_ASCEND_5', name: 'Frequent Flyer', points: 25, condition: { kind: 'ascensions', atLeast: 5 } },
  { id: 'ACH_ASCEND_10', name: 'Cloud Walker', points: 40, condition: { kind: 'ascensions', atLeast: 10 } },
  { id: 'ACH_ASCEND_20', name: 'Ever Upward', points: 80, condition: { kind: 'ascensions', atLeast: 20 } },
  { id: 'ACH_SHARDS_100', name: 'Windfall', points: 25, condition: { kind: 'stat', stat: 'bestAscend', atLeast: 100 } },
  { id: 'ACH_SHARDS_1000', name: 'Motherlode', points: 40, condition: { kind: 'stat', stat: 'bestAscend', atLeast: 1000 } },
  { id: 'ACH_ERA_2', name: 'Terracotta', points: 30, condition: { kind: 'era', atLeast: 1 } },
  { id: 'ACH_ERA_3', name: 'Clockwork', points: 40, condition: { kind: 'era', atLeast: 2 } },
  { id: 'ACH_ERA_4', name: 'Astral', points: 60, condition: { kind: 'era', atLeast: 3 } },
  { id: 'ACH_NODE_1', name: 'First Light', points: 10, condition: { kind: 'nodes', atLeast: 1 } },
  { id: 'ACH_BRANCH_START', name: 'Running Start', points: 20, condition: { kind: 'branch', branch: 'start' } },
  { id: 'ACH_BRANCH_ORBIT', name: 'Clockwork Eye', points: 30, condition: { kind: 'branch', branch: 'orbit' } },
  { id: 'ACH_BRANCH_LUCK', name: 'Lucky Star', points: 40, condition: { kind: 'branch', branch: 'luck' } },
  { id: 'ACH_BRANCH_GULLS', name: 'The Flock', points: 40, condition: { kind: 'branch', branch: 'gulls' } },
  { id: 'ACH_BRANCH_YIELD', name: 'Bountiful', points: 40, condition: { kind: 'branch', branch: 'yield' } },
  { id: 'ACH_TREE_FULL', name: 'Constellation', points: 100, condition: { kind: 'branch', branch: 'all' } },
  { id: 'ACH_GULL_1', name: 'Feathered Friend', points: 15, condition: { kind: 'stat', stat: 'gullDrops', atLeast: 1 } },
  { id: 'ACH_GULL_500', name: 'Flight Plan', points: 30, condition: { kind: 'stat', stat: 'gullDrops', atLeast: 500 } },
  { id: 'ACH_BLOCKS_1000', name: 'Master Builder', points: 25, condition: { kind: 'stat', stat: 'blocks', atLeast: 1000 } },
];

export const ACH_BY_ID: Readonly<Record<AchId, Achievement>> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
) as Record<AchId, Achievement>;

export const MAX_GAMERSCORE = 1000;
