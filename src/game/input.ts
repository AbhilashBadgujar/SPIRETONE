import type { TreeControls } from '../ui/tree-screen';
import type { Game } from './game';

// Keyboard, mouse/touch and gamepad bindings (GDD §4 controls table, §10).
//
//   Drop     Space / left click / tap / pad A; held repeats once NODE_O3 is owned
//   Ascend   hold Q / hold pad B / hold the on-screen button
//   Select   (Direct mode) mouse hover, tap, A D W S or arrows, left stick / d-pad
//   Tree     Tab / pad View / the tree button. Inside: move with the same keys,
//            stick or d-pad; buy with Space, Enter or pad A; close with Tab,
//            Esc, pad B or pad View
//   Pause    Esc / pad Menu; resume with Space, Enter, pad A or a tap

const MOVE_KEYS: Record<string, readonly [number, number]> = {
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
};

const STICK_DEADZONE = 0.5;
const REPEAT_DELAY = 0.35;
const REPEAT_RATE = 0.16;
const RUMBLE_EVERY = 0.1;

const PAD_A = 0;
const PAD_B = 1;
const PAD_UP = 12;
const PAD_DOWN = 13;
const PAD_LEFT = 14;
const PAD_RIGHT = 15;
/** View / Back / Select. */
const PAD_VIEW = 8;
/** Menu / Start. */
const PAD_START = 9;

export class Input {
  private padA = false;
  private padB = false;
  /** B closed the tree; ignore it until released, so it doesn't start an Ascend hold. */
  private padBLatched = false;
  private padView = false;
  private padStart = false;
  private padDir = '';
  private padRepeat = 0;
  private rumbleTimer = 0;
  /** Index of the pad that has been played with, so its disconnect can pause. */
  private padInUse: number | null = null;

  constructor(
    private readonly game: Game,
    canvas: HTMLCanvasElement,
    private readonly tree: TreeControls,
  ) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    // Keyups are lost while unfocused, so drop every hold.
    window.addEventListener('blur', () => {
      this.game.setHold('key', false);
      this.game.setHold('pad', false);
      this.game.setDropHeld('key', false);
      this.game.setDropHeld('pointer', false);
      this.game.setDropHeld('pad', false);
    });
    // GDD §4 cert behavior: pause when the controller in use disconnects.
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index !== this.padInUse) return;
      this.padInUse = null;
      this.game.setPaused(true);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || this.game.controlMode !== 'direct') return;
      const c = this.game.pick(e.clientX, e.clientY);
      if (c !== null) this.game.select(c, 'pointer');
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (this.game.controlMode === 'orbit') {
        this.game.drop();
        this.game.setDropHeld('pointer', true);
        return;
      }
      const c = this.game.pick(e.clientX, e.clientY);
      if (c === null) return;
      this.game.select(c, 'pointer');
      this.game.drop(c);
      this.game.setDropHeld('pointer', true);
    });
    const release = () => this.game.setDropHeld('pointer', false);
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', release);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Gamepads have no events for buttons, so poll once per frame. */
  poll(dt: number): void {
    const pad = firstPad();
    if (!pad) {
      this.game.setHold('pad', false);
      this.padA = false;
      return;
    }

    if (pad.buttons.some((b) => b.pressed)) this.padInUse = pad.index;
    const a = pressed(pad, PAD_A);
    const b = pressed(pad, PAD_B);
    const view = pressed(pad, PAD_VIEW);
    const start = pressed(pad, PAD_START);
    const aDown = a && !this.padA;
    const bDown = b && !this.padB;
    const viewDown = view && !this.padView;
    const startDown = start && !this.padStart;
    if (!a && this.padA) this.game.setDropHeld('pad', false);
    this.padA = a;
    this.padB = b;
    this.padView = view;
    this.padStart = start;
    if (!b) this.padBLatched = false;

    if (this.tree.isOpen) {
      this.game.setHold('pad', false);
      if (bDown || viewDown || startDown) {
        this.tree.close();
        this.padBLatched = b;
      } else if (aDown) {
        this.tree.confirm();
      }
      this.pollMove(pad, dt, (dx, dy) => this.tree.move(dx, dy));
      return;
    }

    if (startDown) this.game.setPaused(!this.game.isPaused);
    if (viewDown && !this.game.isPaused) this.tree.open();
    if (aDown) {
      if (this.game.isPaused) {
        this.game.setPaused(false);
      } else {
        this.game.drop();
        this.game.setDropHeld('pad', true);
      }
    }
    this.game.setHold('pad', b && !this.padBLatched);

    if (this.game.controlMode === 'direct') this.pollMove(pad, dt, (dx, dy) => this.game.move(dx, dy));
    this.rumble(pad, dt);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (this.tree.isOpen) {
      this.treeKey(e, down);
      return;
    }
    if (e.code === 'Escape') {
      if (down && !e.repeat) this.game.setPaused(!this.game.isPaused);
      return;
    }
    if (e.code === 'Tab') {
      // Never let Tab walk focus through the page.
      e.preventDefault();
      if (down && !e.repeat && !this.game.isPaused) this.tree.open();
      return;
    }
    if (this.game.isPaused) {
      // Space or Enter resumes; nothing else acts while paused.
      if (down && !e.repeat && (e.code === 'Space' || e.code === 'Enter')) {
        e.preventDefault();
        this.game.setPaused(false);
      }
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (e.repeat) return;
      if (down) this.game.drop();
      this.game.setDropHeld('key', down);
      return;
    }
    if (e.code === 'KeyQ') {
      this.game.setHold('key', down);
      return;
    }
    const move = MOVE_KEYS[e.code];
    if (move && down) {
      e.preventDefault();
      this.game.move(move[0], move[1]);
    }
  }

  private treeKey(e: KeyboardEvent, down: boolean): void {
    if (e.code === 'Tab' || e.code === 'Space' || e.code === 'Enter' || MOVE_KEYS[e.code]) e.preventDefault();
    if (!down) return;
    if (e.code === 'Tab' || e.code === 'Escape') {
      if (!e.repeat) this.tree.close();
      return;
    }
    if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
      this.tree.confirm();
      return;
    }
    const move = MOVE_KEYS[e.code];
    if (move) this.tree.move(move[0], move[1]);
  }

  /** Stick and d-pad as discrete steps with key-style repeat. */
  private pollMove(pad: Gamepad, dt: number, step: (dx: number, dy: number) => void): void {
    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    let dIndex = 0;
    let dRing = 0;
    if (Math.abs(x) > STICK_DEADZONE && Math.abs(x) >= Math.abs(y)) dIndex = Math.sign(x);
    else if (Math.abs(y) > STICK_DEADZONE) dRing = Math.sign(y);
    if (pressed(pad, PAD_LEFT)) dIndex = -1;
    if (pressed(pad, PAD_RIGHT)) dIndex = 1;
    if (pressed(pad, PAD_UP)) dRing = -1;
    if (pressed(pad, PAD_DOWN)) dRing = 1;

    const dir = `${dIndex},${dRing}`;
    if (dir === '0,0') {
      this.padDir = '';
      return;
    }
    if (dir !== this.padDir) {
      this.padDir = dir;
      this.padRepeat = REPEAT_DELAY;
      step(dIndex, dRing);
      return;
    }
    this.padRepeat -= dt;
    if (this.padRepeat <= 0) {
      this.padRepeat = REPEAT_RATE;
      step(dIndex, dRing);
    }
  }

  /** Rumble rises as the Ascend hold fills (GDD §4). */
  private rumble(pad: Gamepad, dt: number): void {
    const p = this.game.ascendProgress;
    if (p <= 0) {
      this.rumbleTimer = 0;
      return;
    }
    this.rumbleTimer -= dt;
    if (this.rumbleTimer > 0) return;
    this.rumbleTimer = RUMBLE_EVERY;
    // Not every browser has an actuator, or playEffect on it.
    pad.vibrationActuator
      ?.playEffect?.('dual-rumble', {
        duration: RUMBLE_EVERY * 1000 + 20,
        strongMagnitude: 0.1 + 0.6 * p,
        weakMagnitude: 0.2 + 0.8 * p,
      })
      .catch(() => {});
  }
}

function firstPad(): Gamepad | null {
  let pads: (Gamepad | null)[] = [];
  try {
    pads = navigator.getGamepads?.() ?? [];
  } catch {
    // A frame whose permissions policy blocks gamepads throws here.
    return null;
  }
  for (const pad of pads) if (pad?.connected) return pad;
  return null;
}

function pressed(pad: Gamepad, button: number): boolean {
  return pad.buttons[button]?.pressed ?? false;
}
