import type { EraIndex, StructureId } from './ids';

// Upgrade tree (GDD §7). Every node's effect plugs into a term the rules
// already have: era unlocks (§6), tree bonuses in a column's additive term
// and treeIncomeMult (§3, §5), golden chance (§3), Gulls (§8), cursor timing
// and the NODE_O3 / NODE_O5 control unlocks (§4), and start Resonance (§5).
//
// Costs are in Aether Shards and come from the pacing simulator (§11,
// tools/pacing.ts); `pos` is the node's place on the tree map.

export type NodeId =
  | 'NODE_C1'
  | 'NODE_C2'
  | 'NODE_C3'
  | 'NODE_S1'
  | 'NODE_S2'
  | 'NODE_Y1'
  | 'NODE_Y2'
  | 'NODE_Y3'
  | 'NODE_Y4'
  | 'NODE_Y5'
  | 'NODE_Y6'
  | 'NODE_Y7'
  | 'NODE_Y8'
  | 'NODE_O1'
  | 'NODE_O2'
  | 'NODE_O3'
  | 'NODE_O4'
  | 'NODE_O5'
  | 'NODE_G1'
  | 'NODE_G2'
  | 'NODE_G3'
  | 'NODE_G4'
  | 'NODE_G5'
  | 'NODE_L1'
  | 'NODE_L2'
  | 'NODE_L3';

export type Branch = 'core' | 'start' | 'yield' | 'orbit' | 'gulls' | 'luck';

export type NodeEffect =
  /** Unlocks this era for the next island and every one after (GDD §6). */
  | { kind: 'era'; era: EraIndex }
  /** Adds to the additive term of every column of this structure (GDD §3). */
  | { kind: 'typeYield'; structure: StructureId; add: number }
  /** Multiplies treeIncomeMult (GDD §5). */
  | { kind: 'incomeMult'; mult: number }
  /** Adds to the chance a column's first block rolls MOD_GOLDEN (GDD §3). */
  | { kind: 'golden'; chance: number }
  /** Adds Gulls (GDD §8). */
  | { kind: 'gulls'; add: number }
  /** Multiplies K_GULL_INTERVAL. */
  | { kind: 'gullInterval'; mult: number }
  /** Multiplies K_CURSOR_STEP. */
  | { kind: 'cursorStep'; mult: number }
  /** NODE_O3: hold Drop to repeat every K_RAPID_INTERVAL (GDD §4). */
  | { kind: 'rapidDrop' }
  /** NODE_O5: the orbit cursor skips capped and plaza-locked columns (GDD §4). */
  | { kind: 'orbitSkip' }
  /** Multiplies K_START_RES. */
  | { kind: 'startRes'; mult: number };

export interface TreeNode {
  id: NodeId;
  name: string;
  branch: Branch;
  cost: number;
  requires: readonly NodeId[];
  effect: NodeEffect;
  /** Map position in tree units; (0, 0) is the hub, up is negative y. */
  pos: readonly [number, number];
}

export const TREE: readonly TreeNode[] = [
  // Core spine, straight up from the hub.
  { id: 'NODE_C1', name: 'Terracotta Bastion', branch: 'core', cost: 30, requires: ['NODE_Y1'], effect: { kind: 'era', era: 1 }, pos: [0, -1.5] },
  { id: 'NODE_C2', name: 'Clockwork Foundry', branch: 'core', cost: 160, requires: ['NODE_C1', 'NODE_Y4'], effect: { kind: 'era', era: 2 }, pos: [0, -3] },
  { id: 'NODE_C3', name: 'Astral Citadel', branch: 'core', cost: 800, requires: ['NODE_C2', 'NODE_G3'], effect: { kind: 'era', era: 3 }, pos: [0, -4.6] },

  // Start: below the hub.
  { id: 'NODE_S1', name: 'Head Start', branch: 'start', cost: 4, requires: [], effect: { kind: 'startRes', mult: 5 }, pos: [0, 1.3] },
  { id: 'NODE_S2', name: 'Deep Pockets', branch: 'start', cost: 40, requires: ['NODE_S1', 'NODE_C1'], effect: { kind: 'startRes', mult: 10 }, pos: [0, 2.5] },

  // Yield: out to the left of the hub, then up the left of the spine.
  { id: 'NODE_Y1', name: 'Hearth Fires', branch: 'yield', cost: 3, requires: [], effect: { kind: 'typeYield', structure: 'ST_COTTAGE', add: 1 }, pos: [-1.2, -0.3] },
  { id: 'NODE_Y2', name: 'Tidewood', branch: 'yield', cost: 12, requires: ['NODE_Y1'], effect: { kind: 'typeYield', structure: 'ST_PIER', add: 1 }, pos: [-2.2, 0.4] },
  { id: 'NODE_Y3', name: 'Masonry', branch: 'yield', cost: 18, requires: ['NODE_Y2'], effect: { kind: 'typeYield', structure: 'ST_TOWER', add: 1 }, pos: [-3.3, 0] },
  { id: 'NODE_Y4', name: 'Market Day', branch: 'yield', cost: 40, requires: ['NODE_Y3'], effect: { kind: 'typeYield', structure: 'ST_PLAZA', add: 1 }, pos: [-3.4, -1.2] },
  { id: 'NODE_Y5', name: 'Lamp Oil', branch: 'yield', cost: 60, requires: ['NODE_Y4', 'NODE_C1'], effect: { kind: 'typeYield', structure: 'ST_LIGHTHOUSE', add: 1 }, pos: [-2.9, -2.4] },
  { id: 'NODE_Y6', name: 'Resonant Isle', branch: 'yield', cost: 250, requires: ['NODE_Y5'], effect: { kind: 'incomeMult', mult: 2 }, pos: [-1.9, -3] },
  { id: 'NODE_Y7', name: 'Choir of Stone', branch: 'yield', cost: 500, requires: ['NODE_Y6', 'NODE_C2'], effect: { kind: 'incomeMult', mult: 3 }, pos: [-1.2, -4] },
  { id: 'NODE_Y8', name: 'Music of the Spheres', branch: 'yield', cost: 4000, requires: ['NODE_Y7', 'NODE_C3'], effect: { kind: 'incomeMult', mult: 5 }, pos: [-1.1, -5.5] },

  // Orbit: out to the right of the hub, mirroring yield.
  { id: 'NODE_O1', name: 'Quick Eye', branch: 'orbit', cost: 5, requires: [], effect: { kind: 'cursorStep', mult: 0.8 }, pos: [1.2, -0.3] },
  { id: 'NODE_O2', name: 'Quicker Eye', branch: 'orbit', cost: 12, requires: ['NODE_O1'], effect: { kind: 'cursorStep', mult: 0.8 }, pos: [2.2, 0.4] },
  { id: 'NODE_O3', name: 'Rapid Drop', branch: 'orbit', cost: 30, requires: ['NODE_O2'], effect: { kind: 'rapidDrop' }, pos: [3.3, 0] },
  { id: 'NODE_O4', name: 'Sharp Eye', branch: 'orbit', cost: 200, requires: ['NODE_O3', 'NODE_C1'], effect: { kind: 'cursorStep', mult: 0.8 }, pos: [3.4, -1.2] },
  { id: 'NODE_O5', name: 'Pathfinder', branch: 'orbit', cost: 400, requires: ['NODE_O4'], effect: { kind: 'orbitSkip' }, pos: [3, -2.4] },

  // Gulls: up the right of the spine.
  { id: 'NODE_G1', name: 'First Gull', branch: 'gulls', cost: 40, requires: ['NODE_C1'], effect: { kind: 'gulls', add: 1 }, pos: [1.1, -1.9] },
  { id: 'NODE_G2', name: 'Second Gull', branch: 'gulls', cost: 45, requires: ['NODE_G1'], effect: { kind: 'gulls', add: 1 }, pos: [1.9, -3] },
  { id: 'NODE_G3', name: 'Tailwind', branch: 'gulls', cost: 300, requires: ['NODE_G2', 'NODE_C2'], effect: { kind: 'gullInterval', mult: 0.6 }, pos: [1.2, -4] },
  { id: 'NODE_G4', name: 'Third Gull', branch: 'gulls', cost: 450, requires: ['NODE_G3'], effect: { kind: 'gulls', add: 1 }, pos: [2.5, -4.2] },
  { id: 'NODE_G5', name: 'Flock', branch: 'gulls', cost: 3000, requires: ['NODE_G4', 'NODE_C3'], effect: { kind: 'gulls', add: 2 }, pos: [1.1, -5.5] },

  // Luck: lower left, off Tidewood.
  { id: 'NODE_L1', name: 'Gilded Clay', branch: 'luck', cost: 22, requires: ['NODE_Y2'], effect: { kind: 'golden', chance: 0.02 }, pos: [-1.5, 1.5] },
  { id: 'NODE_L2', name: 'Gilded Stone', branch: 'luck', cost: 350, requires: ['NODE_L1', 'NODE_C2'], effect: { kind: 'golden', chance: 0.02 }, pos: [-2.6, 2.2] },
  { id: 'NODE_L3', name: 'Gilded Crystal', branch: 'luck', cost: 2500, requires: ['NODE_L2', 'NODE_C3'], effect: { kind: 'golden', chance: 0.03 }, pos: [-3.7, 1.7] },
];

export const NODE_BY_ID: Readonly<Record<NodeId, TreeNode>> = Object.fromEntries(
  TREE.map((n) => [n.id, n]),
) as Record<NodeId, TreeNode>;
