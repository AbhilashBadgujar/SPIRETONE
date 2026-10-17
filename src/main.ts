import { DEFAULT_CONSTANTS } from './data/constants';
import { ERA_PRESETS } from './data/eras';
import { ERA_IDS, type EraIndex } from './data/ids';
import { demoIsland } from './dev/demo';
import { createPerfOverlay } from './lib/perf';
import { Gulls } from './render/gulls';
import { IslandView } from './render/island-view';
import { LAYOUT } from './render/layout';
import { Ocean } from './render/ocean';
import { Stage } from './render/scene';
import { evaluate } from './sim/evaluate';
import { buildGrid } from './sim/grid';
import { advance, bonusesFor, newGame } from './sim/run';

const grid = buildGrid(DEFAULT_CONSTANTS);
const state = newGame(grid, Date.now() | 0);
const params = new URLSearchParams(location.search);

// ?demo=1..4 previews a filled island in that era.
const demo = Number(params.get('demo'));
if (demo >= 1 && demo <= 4) {
  const era = (demo - 1) as EraIndex;
  state.meta.highestEra = era;
  state.run.island = demoIsland(grid, era);
  state.run.evaluation = evaluate(grid, state.run.island, bonusesFor(state.meta));
}

const app = document.getElementById('app')!;
const stage = new Stage(app);
const ocean = new Ocean();
const gulls = new Gulls();
const view = new IslandView(grid);
stage.scene.add(ocean.water, gulls.mesh);
stage.turntable.add(view.root);

const preset = ERA_PRESETS[ERA_IDS[state.run.island.era]];
stage.applyPreset(preset);
ocean.applyPreset(preset);
view.applyPreset(preset);
view.sync(state.run.island, state.run.evaluation);
stage.frameColumns(view.ringMaxHeights);

const perf = params.has('perf') ? createPerfOverlay(stage.renderer, app) : null;
let last = performance.now();
let time = 0;

stage.renderer.setAnimationLoop((now) => {
  // Clamped so a backgrounded tab never banks idle income (GDD §5: no offline progress).
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  time += dt;
  advance(grid, state, dt);
  stage.turntable.rotation.y += LAYOUT.turntableSpeed * dt;
  ocean.update(time);
  gulls.update(time);
  stage.update(dt);
  stage.render();
  perf?.(dt);
});

if (import.meta.env.DEV) Object.assign(window, { spiretone: { grid, state, stage, view } });
