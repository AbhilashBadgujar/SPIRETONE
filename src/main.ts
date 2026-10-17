import { DEFAULT_CONSTANTS } from './data/constants';
import { buildGrid } from './sim/grid';
import { newGame } from './sim/run';

const grid = buildGrid(DEFAULT_CONSTANTS);
const state = newGame(grid, Date.now() | 0);

// Step 2 mounts the 3D island here. Until then the sim is reachable from devtools.
if (import.meta.env.DEV) Object.assign(window, { spiretone: { grid, state } });
