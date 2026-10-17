import type { NodeId } from '../data/tree';
import type { DropRejection, DropOutcome } from '../sim/island';
import type { ColumnId } from '../sim/grid';
import type { BuyRejection } from '../sim/tree';

// Gameplay events for HUD (Step 4) and juice/audio (Step 5) to react to.

export interface GameEvents {
  /**
   * A block landed in the sim. `delay`: seconds before it starts to fall on
   * screen (a worker Gull still carrying it in); 0 for the player's drops.
   */
  drop: { column: ColumnId; cost: number; outcome: DropOutcome; incomeBefore: number; by: 'player' | 'gull'; delay: number };
  reject: { column: ColumnId; reason: DropRejection | 'CANT_AFFORD' };
  /** Ascend held below the fill threshold. */
  ascendBlocked: { remaining: number };
  /** Hold completed: the sequence begins and controls lock. */
  ascendStart: { shards: number };
  /** Sequence peak: Shards banked and the new island is in place (behind the flash). */
  ascend: { shards: number };
  /** The new island touches down. */
  ascendLand: Record<string, never>;
  /** Sequence over; controls are back. */
  ascendEnd: { shards: number };
  pause: { reason: 'menu' | 'tree' };
  resume: Record<string, never>;
  /** A tree node was bought. */
  buy: { id: NodeId };
  /** A tree purchase was refused. */
  buyFail: { id: NodeId; reason: BuyRejection };
}

type Handler<T> = (payload: T) => void;

export class Emitter<E> {
  private readonly handlers: { [K in keyof E]?: Handler<E[K]>[] } = {};

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    const list = (this.handlers[type] ??= []);
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    for (const fn of this.handlers[type] ?? []) fn(payload);
  }
}
