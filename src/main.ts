import { Sound } from './audio/sound';
import { DEFAULT_CONSTANTS } from './data/constants';
import type { EraIndex } from './data/ids';
import { demoIsland } from './dev/demo';
import { Game } from './game/game';
import { Input } from './game/input';
import { AdaptiveQuality, LEVELS } from './game/quality';
import { loadSettings, saveSettings, type Quality } from './game/settings';
import { clearSave, loadGame, saveGame } from './game/storage';
import { createPerfOverlay } from './lib/perf';
import { evaluate } from './sim/evaluate';
import { buildGrid } from './sim/grid';
import { bonusesFor, newGame, type GameState } from './sim/run';
import { clearCoach } from './ui/coach';
import { Hud } from './ui/hud';
import '@fontsource-variable/nunito';
import './ui/hud.css';

const AUTOSAVE_MS = 10_000;

const grid = buildGrid(DEFAULT_CONSTANTS);
const params = new URLSearchParams(location.search);
// Hosts that drop the query string still pass a bare #token: #orbit, #direct, #demo1..#demo4.
const hash = location.hash.slice(1);

// ?demo=1..4 starts on a filled island in that era and never touches the save.
// ?fresh starts a new game (the next autosave replaces the old one).
// ?nocoach skips How to play and the first-run hints (automated tests).
const demo = Number(params.get('demo') ?? (/^demo[1-4]$/.test(hash) ? hash.slice(4) : null));
const isDemo = demo >= 1 && demo <= 4;

let state: GameState;
if (isDemo) {
  const era = (demo - 1) as EraIndex;
  state = newGame(grid, Date.now() | 0);
  state.meta.highestEra = era;
  state.run.island = demoIsland(grid, era);
  state.run.evaluation = evaluate(grid, state.run.island, bonusesFor(state.meta));
} else {
  state = (params.has('fresh') ? null : loadGame(grid)) ?? newGame(grid, Date.now() | 0);
}

// Direct (tap where to build) is the web default, changed in the pause
// screen's settings; ?mode=orbit|direct and #orbit / #direct override it for testing.
const settings = loadSettings();
const urlMode = params.get('mode') ?? hash;
const mode = urlMode === 'orbit' || urlMode === 'direct' ? urlMode : settings.mode;

const game = new Game(grid, state, document.getElementById('app')!, mode);
const sound = new Sound(game);

// Phones and tablets start a quality step lower; 'auto' steps down while slow.
const quality = new AdaptiveQuality(settings.quality, window.matchMedia('(pointer: coarse)').matches);
game.applyQuality(LEVELS[quality.level]);

/** Set when progress is being erased, so the page-hide save can't write it back. */
let resetting = false;
const QUALITY_CYCLE: Record<Quality, Quality> = { auto: 'high', high: 'low', low: 'auto' };
const hud = new Hud(game, document.getElementById('hud')!, sound, {
  get mode() {
    return game.controlMode;
  },
  toggleMode() {
    settings.mode = game.controlMode === 'orbit' ? 'direct' : 'orbit';
    game.setMode(settings.mode);
    saveSettings(settings);
  },
  get quality() {
    return settings.quality;
  },
  cycleQuality() {
    settings.quality = QUALITY_CYCLE[settings.quality];
    quality.setQuality(settings.quality);
    game.applyQuality(LEVELS[quality.level]);
    saveSettings(settings);
  },
  resetProgress: isDemo
    ? undefined
    : () => {
        resetting = true;
        clearSave();
        // A fresh start gets the first-run hints again.
        clearCoach();
        location.reload();
      },
}, !isDemo && !params.has('nocoach'));
const input = new Input(game, game.stage.renderer.domElement, hud.tree);
const perf = params.has('perf') ? createPerfOverlay(game.stage.renderer, document.body) : null;

// GDD §4 suspend/resume: leaving the tab or app pauses, so play never resumes unseen.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !game.isPaused && !game.isAscending) game.setPaused(true);
});
// iOS Safari ignores user-scalable=no; stop pinch and double-tap zoom here.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

if (!isDemo) {
  const save = () => {
    if (!resetting) saveGame(game.state);
  };
  window.setInterval(save, AUTOSAVE_MS);
  // Tab switch, app switch or close: save now. No time passes while away (GDD §5).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
  });
  window.addEventListener('pagehide', save);
  game.events.on('ascend', save);
  game.events.on('buy', save);
  game.events.on('achievement', save);
}

let last = performance.now();
game.stage.renderer.setAnimationLoop((now) => {
  const frame = Math.max(0, (now - last) / 1000);
  last = now;
  const level = quality.sample(frame);
  if (level !== null) game.applyQuality(LEVELS[level]);
  // Clamped so a backgrounded tab never banks idle income (GDD §5: no offline progress).
  const dt = Math.min(0.1, frame);
  input.poll(dt);
  game.update(dt);
  hud.update(dt);
  sound.update();
  perf?.(dt);
});

if (import.meta.env.DEV) Object.assign(window, { spiretone: { grid, state, game, hud, sound, quality, settings } });
