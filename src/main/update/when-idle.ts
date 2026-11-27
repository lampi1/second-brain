// «Aggiorna» waits for the chats at work (ADR 0371 point 8, #492: 5 «app restarted while you were working» in 20 hours,
// each a turn cut by an update the user started). With chats mid-turn the update does not start: it waits until no chat
// is running a turn (looked at every UPDATE_POLL_MS), then goes. After UPDATE_WAIT_MAX_MS it asks the user, naming how
// many chats «Aggiorna ora» would interrupt, and still goes by itself when they end (no «Controlla» needed). A code
// update the Orchestrator runs meanwhile (app_update_code) is waited for too (hold). «Aggiorna ora» goes at once.
// Pure apart from the injected clock and timer (the tests' own). Used by update/source.ts AppSourceService.updateNow.
// Unit tests: test/unit/update-when-idle.test.ts.

export const UPDATE_WAIT_MAX_MS = 20 * 60_000, UPDATE_POLL_MS = 5_000;

export interface WhenIdleDeps {
  /** how many chats are running a turn now */
  busy: () => number;
  /** something else holds the update (the Orchestrator's code update running): wait, whatever the chats do */
  hold?: () => boolean;
  /** a timer (default: setTimeout, unref'd); returns its cancel */
  schedule?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
  maxMs?: number;
  pollMs?: number;
}
export interface WhenIdleEvents {
  /** nobody works any more (or the user forced it): start the update */
  go: () => void;
  /** still waiting on n chats (0: on the hold alone); timedOut: the maximum wait passed, the user is asked (the wait
   *  goes on) */
  waiting: (n: number, timedOut: boolean) => void;
}

const chats = (n: number): string => n === 1 ? '1 chat' : `${n} chat`;
/** The waiting line (Italian, for the user). */
export const waitingText = (n: number): string => n <= 0
  ? 'Aspetto che finisca l’aggiornamento del codice in corso, poi aggiorno da solo.'
  : `Aspetto che ${n === 1 ? 'la chat al lavoro finisca' : `le ${n} chat al lavoro finiscano`} il turno, poi aggiorno da solo (al massimo ${UPDATE_WAIT_MAX_MS / 60_000} minuti). «Aggiorna ora» ${n === 1 ? 'la interrompe' : 'le interrompe'}.`;
/** The question after the maximum wait (Italian, for the user). */
export const timedOutText = (n: number): string =>
  `Dopo ${UPDATE_WAIT_MAX_MS / 60_000} minuti ${chats(n)} ${n === 1 ? 'lavora' : 'lavorano'} ancora: «Aggiorna ora» ${n === 1 ? 'la interrompe' : 'le interrompe'} (riprendono da sole dopo il riavvio); altrimenti aggiorno da solo appena ${n === 1 ? 'finisce' : 'finiscono'}.`;

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const t = setTimeout(fn, ms);
  (t as { unref?: () => void }).unref?.();
  return () => clearTimeout(t);
};

export class UpdateWhenIdle {
  private cancel: (() => void) | null = null;
  private since = 0;
  private asked = false;
  constructor(private readonly d: WhenIdleDeps) {}

  /** A wait is running (not yet gone). */
  get waiting(): boolean { return this.cancel !== null; }
  /** The maximum wait passed in this wait: the user was asked. */
  get timedOut(): boolean { return this.asked; }

  /** 'go': start now (nobody works and nothing holds it, or force with nothing holding it). 'wait': the events say when. */
  begin(force: boolean, on: WhenIdleEvents): 'go' | 'wait' {
    this.stop();
    const held = this.d.hold?.() ?? false;
    const n = force ? 0 : this.d.busy();
    if (n <= 0 && !held) return 'go';
    this.since = (this.d.now ?? Date.now)();
    this.asked = false;
    on.waiting(n, false);
    this.arm(on, force);
    return 'wait';
  }

  /** The wait ends without an update (an update forced, the app quitting). */
  stop(): void { this.cancel?.(); this.cancel = null; }

  private arm(on: WhenIdleEvents, force: boolean): void {
    const schedule = this.d.schedule ?? defaultSchedule;
    this.cancel = schedule(() => {
      this.cancel = null;
      const held = this.d.hold?.() ?? false;
      const n = force ? 0 : this.d.busy();
      if (n <= 0 && !held) { on.go(); return; }
      const out = n > 0 && (this.d.now ?? Date.now)() - this.since >= (this.d.maxMs ?? UPDATE_WAIT_MAX_MS);
      if (out) this.asked = true;
      on.waiting(n, this.asked && n > 0);
      this.arm(on, force);
    }, this.d.pollMs ?? UPDATE_POLL_MS);
  }
}
