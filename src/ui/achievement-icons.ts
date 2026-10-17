import type { AchId } from '../data/achievements';
import { ICONS, STRUCTURE_ICONS } from './icons';

// One icon per achievement (GDD §9), for toasts and the trophy shelf.

const hex = (roman: string) => `<b class="hex">${roman}</b>`;

export const ACHIEVEMENT_ICONS: Readonly<Record<AchId, string>> = {
  ACH_FIRST_DROP: ICONS.block,
  ACH_PIER: STRUCTURE_ICONS.ST_PIER,
  ACH_TOWER: STRUCTURE_ICONS.ST_TOWER,
  ACH_PLAZA: STRUCTURE_ICONS.ST_PLAZA,
  ACH_BRIDGE: ICONS.bridge,
  ACH_BALCONY: ICONS.balcony,
  ACH_LIGHTHOUSE: STRUCTURE_ICONS.ST_LIGHTHOUSE,
  ACH_BEACON: ICONS.resonance,
  ACH_FULL_CHORD: ICONS.harmony,
  ACH_HARMONY_6: ICONS.harmony,
  ACH_GOLDEN: ICONS.golden,
  ACH_GOLDEN_20: ICONS.golden,
  ACH_OVERCLOCK: ICONS.gear,
  ACH_CASCADE: ICONS.cascade,
  ACH_CASCADE_100: ICONS.cascade,
  ACH_ASCEND_1: ICONS.ascend,
  ACH_ASCEND_5: ICONS.ascend,
  ACH_ASCEND_10: ICONS.ascend,
  ACH_ASCEND_20: ICONS.ascend,
  ACH_SHARDS_100: ICONS.shard,
  ACH_SHARDS_1000: ICONS.shard,
  ACH_ERA_2: hex('II'),
  ACH_ERA_3: hex('III'),
  ACH_ERA_4: hex('IV'),
  ACH_NODE_1: ICONS.tree,
  ACH_BRANCH_START: ICONS.flag,
  ACH_BRANCH_ORBIT: ICONS.eye,
  ACH_BRANCH_LUCK: ICONS.golden,
  ACH_BRANCH_GULLS: ICONS.gull,
  ACH_BRANCH_YIELD: ICONS.resonance,
  ACH_TREE_FULL: ICONS.tree,
  ACH_GULL_1: ICONS.gull,
  ACH_GULL_500: ICONS.gull,
  ACH_BLOCKS_1000: ICONS.block,
};
