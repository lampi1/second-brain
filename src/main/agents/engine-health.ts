// Engines whose chats just failed to start (ADR 0352): «se oggi l'app passa davvero al motore successivo quando il primo
// è … in errore». An engine is in trouble for TROUBLE_MS after one of its chats ended in error before its first turn (no
// answer, a login that does not work, a crash at start); a turn that ends well on it clears it at once. A plan limit is not
// trouble (the credit book has it, credits.ts). In memory only: a restart tries every engine again. Used by wiring.ts (the
// catalog's pick passes an engine in trouble over while another one may start; ChatManager startFailed moves the chat that
// failed); tests in test/unit/agents/engine-health.test.ts.
import type { ChatSummary, Harness } from '../../shared/contract';
import { limitSignal } from './credits';

export const TROUBLE_MS = 10 * 60_000;

export class EngineHealth {
  private readonly failedAt = new Map<Harness, number>();
  /** chat → the state it was last seen in: an error counts once, when the chat enters it */
  private readonly seen = new Map<string, string>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Every chat:updated. */
  observe(c: Pick<ChatSummary, 'id' | 'harness' | 'state' | 'lastError' | 'lastResult' | 'closedAt'>): void {
    const was = this.seen.get(c.id);
    if (c.closedAt) this.seen.delete(c.id); else this.seen.set(c.id, c.state);
    if (c.state === 'error' && was !== 'error' && !c.lastResult && c.lastError && !limitSignal(c.lastError)) this.fail(c.harness);
    const failed = this.failedAt.get(c.harness);
    if (failed !== undefined && c.lastResult && !c.lastResult.isError && c.lastResult.at >= failed) this.failedAt.delete(c.harness);
  }

  fail(engine: Harness): void { this.failedAt.set(engine, this.now()); }

  trouble(engine: Harness): boolean {
    const at = this.failedAt.get(engine);
    if (at === undefined) return false;
    if (this.now() - at < TROUBLE_MS) return true;
    this.failedAt.delete(engine);
    return false;
  }
}
