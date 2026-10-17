import type { DropRejection, DropOutcome } from '../sim/island';
import type { ColumnId } from '../sim/grid';

// Gameplay events for HUD (Step 4) and juice/audio (Step 5) to react to.

export interface GameEvents {
  drop: { column: ColumnId; cost: number; outcome: DropOutcome };
  reject: { column: ColumnId; reason: DropRejection | 'CANT_AFFORD' };
  /** Ascend held below the fill threshold. */
  ascendBlocked: { remaining: number };
  ascend: { shards: number };
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
