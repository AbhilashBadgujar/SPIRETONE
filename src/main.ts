import { DEFAULT_CONSTANTS } from './data/constants';
import type { EraIndex } from './data/ids';
import { demoIsland } from './dev/demo';
import { Game } from './game/game';
import { Input } from './game/input';
import { createPerfOverlay } from './lib/perf';
import { evaluate } from './sim/evaluate';
import { buildGrid } from './sim/grid';
import { bonusesFor, newGame } from './sim/run';
import { Hud } from './ui/hud';
import './ui/hud.css';

const grid = buildGrid(DEFAULT_CONSTANTS);
const state = newGame(grid, Date.now() | 0);
const params = new URLSearchParams(location.search);

// ?demo=1..4 starts on a filled island in that era.
const demo = Number(params.get('demo'));
if (demo >= 1 && demo <= 4) {
  const era = (demo - 1) as EraIndex;
  state.meta.highestEra = era;
  state.run.island = demoIsland(grid, era);
  state.run.evaluation = evaluate(grid, state.run.island, bonusesFor(state.meta));
}

// Orbit is the default (GDD §4); ?mode=direct until the settings screen exists.
const mode = params.get('mode') === 'direct' ? 'direct' : 'orbit';

const game = new Game(grid, state, document.getElementById('app')!, mode);
const hud = new Hud(game, document.getElementById('hud')!);
const input = new Input(game, game.stage.renderer.domElement);
const perf = params.has('perf') ? createPerfOverlay(game.stage.renderer, document.body) : null;

let last = performance.now();
game.stage.renderer.setAnimationLoop((now) => {
  // Clamped so a backgrounded tab never banks idle income (GDD §5: no offline progress).
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  input.poll(dt);
  game.update(dt);
  hud.update(dt);
  perf?.(dt);
});

if (import.meta.env.DEV) Object.assign(window, { spiretone: { grid, state, game, hud } });
