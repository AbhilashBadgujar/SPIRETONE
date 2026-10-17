// Pacing simulator (GDD §11). Plays a whole game the way a reasonable
// orbit-mode player would and reports when each §5 milestone lands.
//
//   npm run pacing            report with the shipped constants and tree
//
// Player model:
//   - Drops only when the orbit cursor is on a column whose income gain is at
//     least PICKY × the best available, once per cursor visit (rapid drop,
//     NODE_O3, allows repeats every K_RAPID_INTERVAL).
//   - Gulls drop on their own (src/sim/gulls.ts, the same code the game runs).
//   - Ascends once allowed and the next block is more than ASCEND_WAIT seconds
//     away, nothing left would raise income, or MAX_LINGER seconds have passed.
//   - After each Ascension buys tree nodes: the next core node whenever
//     affordable, otherwise the cheapest affordable node, until nothing fits.
//   - Each Ascension costs the sequence time plus TREE_BROWSE seconds.
//   - Keeps playing after the full tree until every achievement (GDD §9) is
//     unlocked, checking them after every event the game checks them on.

import { ACH_BY_ID, ACHIEVEMENTS, MAX_GAMERSCORE, type AchId } from '../src/data/achievements';
import { DEFAULT_CONSTANTS, type Constants } from '../src/data/constants';
import { TREE, type NodeId } from '../src/data/tree';
import { ASCENSION_TOTAL } from '../src/game/ascension';
import { OrbitCursor } from '../src/game/cursor';
import { checkAchievements, gamerscore } from '../src/sim/achievements';
import { buildGrid, type Grid } from '../src/sim/grid';
import { advanceGulls } from '../src/sim/gulls';
import { cloneIsland, dropBlock, isDroppable, totalBlocks } from '../src/sim/island';
import {
  advance,
  ascend,
  bonusesFor,
  canAscend,
  currentCost,
  newGame,
  shardsOnAscend,
  tryDrop,
  type GameState,
} from '../src/sim/run';
import { buyNode, effectsOf, nodeState } from '../src/sim/tree';

export const PLAYER = {
  PICKY: 0.8,
  ASCEND_WAIT: 25,
  MAX_LINGER: 150,
  TREE_BROWSE: 20,
  TIME_LIMIT_MIN: 300,
};

/** GDD §5 pacing targets, in minutes. */
export const TARGETS = {
  firstAscension: [25, 25],
  era2: [35, 40],
  era3: [75, 80],
  era4: [115, 125],
  fullTree: [150, 160],
  gamerscore1000: [165, 180],
} as const;

export interface IslandLog {
  n: number;
  era: number;
  startMin: number;
  minutes: number;
  blocks: number;
  shards: number;
  bought: NodeId[];
}

export interface RunReport {
  islands: IslandLog[];
  milestones: Partial<Record<keyof typeof TARGETS, number>>;
  /** Unlock time of each achievement, in minutes, in unlock order. */
  achievements: { id: AchId; min: number }[];
  endMin: number;
  /** An island began that the player could never afford a block on. */
  stuck: boolean;
}

function gains(grid: Grid, s: GameState): number[] {
  const bonuses = bonusesFor(s.meta);
  const out: number[] = [];
  for (let c = 0; c < grid.columnCount; c++) {
    if (!isDroppable(grid, s.run.island, c)) {
      out.push(-Infinity);
      continue;
    }
    const trial = cloneIsland(s.run.island);
    const o = dropBlock(grid, trial, c, { bonuses, random: () => 1 }, s.run.evaluation);
    out.push(o.evaluation.income - s.run.evaluation.income);
  }
  return out;
}

function buyNodes(s: GameState): NodeId[] {
  const bought: NodeId[] = [];
  for (;;) {
    const open = TREE.filter((n) => nodeState(s.meta, n.id) === 'available');
    const core = open.find((n) => n.branch === 'core');
    const pick =
      core && core.cost <= s.meta.shards
        ? core
        : open.filter((n) => n.cost <= s.meta.shards).sort((a, b) => a.cost - b.cost)[0];
    if (!pick) return bought;
    buyNode(s.meta, pick.id);
    bought.push(pick.id);
  }
}

export function simulateRun(k: Readonly<Constants> = DEFAULT_CONSTANTS, seed = 7): RunReport {
  const grid = buildGrid(k);
  const s = newGame(grid, seed);
  const islands: IslandLog[] = [];
  const milestones: RunReport['milestones'] = {};
  const dt = k.K_TICK;
  let t = 0;
  let stuck = false;
  const achievements: RunReport['achievements'] = [];
  const unlock = () => {
    for (const id of checkAchievements(s)) achievements.push({ id, min: t / 60 });
  };

  while (t < PLAYER.TIME_LIMIT_MIN * 60) {
    const start = t;
    const effects = effectsOf(s.meta.nodes);
    const cursor = new OrbitCursor(grid);
    const ctx = () => ({
      island: s.run.island,
      evaluation: s.run.evaluation,
      bonuses: bonusesFor(s.meta),
      skipBlocked: effects.orbitSkipsBlocked,
      stepMult: effects.cursorStepMult,
    });
    cursor.reset(ctx());
    let g = gains(grid, s);
    let readyAt = -1;
    let visit = 0;
    let droppedOnVisit = -1;
    let lastPlayerDrop = -Infinity;

    for (;;) {
      advance(grid, s, dt);
      t += dt;
      if (cursor.update(dt, ctx())) visit++;
      if (advanceGulls(grid, s, dt).length) {
        g = gains(grid, s);
        unlock();
      }

      const best = Math.max(...g);
      if (canAscend(grid, s.run)) {
        if (readyAt < 0) readyAt = t;
        const cost = currentCost(grid, s.run);
        const wait = Math.max(0, cost - s.run.resonance) / Math.max(s.run.evaluation.income, 1e-9);
        if (best <= 0 || wait > PLAYER.ASCEND_WAIT || t - readyAt > PLAYER.MAX_LINGER) break;
      } else if (best <= 0 && effects.gulls === 0) {
        break; // nothing left that helps, still below the threshold
      }
      if (s.run.evaluation.income === 0 && s.run.resonance < currentCost(grid, s.run) && effects.gulls === 0) {
        stuck = true; // can't afford a single block and nothing earns: the run is dead
        break;
      }
      if (t - start > PLAYER.TIME_LIMIT_MIN * 60) break;

      const c = cursor.column;
      // Without rapid drop a player presses once per cursor visit.
      const canPress = effects.rapidDrop ? t - lastPlayerDrop >= k.K_RAPID_INTERVAL : visit !== droppedOnVisit;
      if (canPress && s.run.resonance >= currentCost(grid, s.run) && g[c] > 0 && g[c] >= PLAYER.PICKY * best) {
        tryDrop(grid, s, c);
        unlock();
        lastPlayerDrop = t;
        droppedOnVisit = visit;
        g = gains(grid, s);
      }
    }

    if (stuck || !canAscend(grid, s.run)) break;
    const era = s.run.island.era + 1;
    const blocks = totalBlocks(s.run.island);
    const shards = shardsOnAscend(grid, s.run);
    const minutes = (t - start) / 60;
    ascend(grid, s);
    t += ASCENSION_TOTAL + PLAYER.TREE_BROWSE;
    if (milestones.firstAscension === undefined) milestones.firstAscension = t / 60;
    const bought = buyNodes(s);
    for (const id of bought) {
      if (id === 'NODE_C1') milestones.era2 = t / 60;
      if (id === 'NODE_C2') milestones.era3 = t / 60;
      if (id === 'NODE_C3') milestones.era4 = t / 60;
    }
    unlock();
    islands.push({ n: islands.length + 1, era, startMin: start / 60, minutes, blocks, shards, bought });
    if (s.meta.nodes.length === TREE.length && milestones.fullTree === undefined) milestones.fullTree = t / 60;
    if (gamerscore(s.meta.achievements) >= MAX_GAMERSCORE) {
      milestones.gamerscore1000 = achievements[achievements.length - 1].min;
      break;
    }
  }
  return { islands, milestones, achievements, endMin: t / 60, stuck };
}

function fmt(min: number | undefined): string {
  if (min === undefined) return '  —  ';
  // Round first, so 59.6 minutes reads 1:00, not 0:60.
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function printReport(r: RunReport): void {
  if (r.stuck) console.log('STUCK: an island started that could not afford its first block');
  console.log(' #  era  start  length  blocks  shards  bought');
  for (const i of r.islands) {
    console.log(
      `${String(i.n).padStart(2)}  ${String(i.era).padStart(3)}  ${fmt(i.startMin).padStart(5)}  ${i.minutes.toFixed(1).padStart(6)}  ${String(i.blocks).padStart(6)}  ${String(i.shards).padStart(6)}  ${i.bought.map((b) => b.replace('NODE_', '')).join(' ')}`,
    );
  }
  console.log('\nachievement          G   at');
  let score = 0;
  for (const a of r.achievements) {
    score += ACH_BY_ID[a.id].points;
    console.log(`${a.id.replace('ACH_', '').padEnd(16)} ${String(ACH_BY_ID[a.id].points).padStart(3)}  ${fmt(a.min).padStart(5)}  ${String(score).padStart(4)}G`);
  }
  const missing = ACHIEVEMENTS.filter((a) => !r.achievements.some((x) => x.id === a.id));
  if (missing.length) console.log(`never unlocked: ${missing.map((a) => a.id).join(' ')}`);

  console.log('\nmilestone        sim     target');
  for (const key of Object.keys(TARGETS) as (keyof typeof TARGETS)[]) {
    const [lo, hi] = TARGETS[key];
    const v = r.milestones[key];
    const ok = v !== undefined && v >= lo * 0.9 && v <= hi * 1.1;
    console.log(`${key.padEnd(15)} ${fmt(v).padStart(5)}   ${fmt(lo)}–${fmt(hi)}  ${ok ? 'ok' : 'OFF'}`);
  }
}

declare const process: { argv: string[] };
if (process.argv[1]?.endsWith('pacing.mjs')) printReport(simulateRun());
