// «Aggiorna» waits for the chats at work (ADR 0371 point 8, #492: 5 «app restarted while you were working» in 20 hours,
// each a turn cut by an update the user started). With chats mid-turn the update does not start: it waits until no chat
// is running a turn (looked at every UPDATE_POLL_MS), then goes; after UPDATE_WAIT_MAX_MS it stops waiting and asks
// the user, naming how many chats «Aggiorna ora» would interrupt. «Aggiorna ora» goes at once at any moment.
// Pure apart from the injected clock and timer (the tests' own). Used by update/source.ts AppSourceService.updateNow.
// Unit tests: test/unit/update-when-idle.test.ts.

export const UPDATE_WAIT_MAX_MS = 20 * 60_000, UPDATE_POLL_MS = 5_000;

export interface WhenIdleDeps {
  /** how many chats are running a turn now */
  busy: () => number;
  /** a timer (default: setTimeout, unref'd); returns its cancel */
  schedule?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
  maxMs?: number;
  pollMs?: number;
}
export interface WhenIdleEvents {
  /** nobody works any more (or the user forced it): start the update */
  go: () => void;
  /** still waiting on n chats; timedOut: the maximum wait passed, the user decides */
  waiting: (n: number, timedOut: boolean) => void;
}

const chats = (n: number): string => n === 1 ? '1 chat' : `${n} chat`;
/** The waiting line (Italian, for the user). */
export const waitingText = (n: number): string =>
  `Aspetto che ${n === 1 ? 'la chat al lavoro finisca' : `le ${n} chat al lavoro finiscano`} il turno, poi aggiorno da solo (al massimo ${UPDATE_WAIT_MAX_MS / 60_000} minuti). «Aggiorna ora» ${n === 1 ? 'la interrompe' : 'le interrompe'}.`;
/** The question after the maximum wait (Italian, for the user). */
export const timedOutText = (n: number): string =>
  `Dopo ${UPDATE_WAIT_MAX_MS / 60_000} minuti ${chats(n)} ${n === 1 ? 'lavora' : 'lavorano'} ancora: «Aggiorna ora» ${n === 1 ? 'la interrompe' : 'le interrompe'} (riprendono da sole dopo il riavvio), oppure premi «Aggiorna» più tardi.`;

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const t = setTimeout(fn, ms);
  (t as { unref?: () => void }).unref?.();
  return () => clearTimeout(t);
};

export class UpdateWhenIdle {
  private cancel: (() => void) | null = null;
  private since = 0;
  constructor(private readonly d: WhenIdleDeps) {}

  /** A wait is running (not yet gone, not timed out). */
  get waiting(): boolean { return this.cancel !== null; }

  /** 'go': start now (nobody works, or force). 'wait': the events say when. */
  begin(force: boolean, on: WhenIdleEvents): 'go' | 'wait' {
    this.stop();
    const n = force ? 0 : this.d.busy();
    if (n <= 0) return 'go';
    this.since = (this.d.now ?? Date.now)();
    on.waiting(n, false);
    this.arm(on);
    return 'wait';
  }

  /** The wait ends without an update (an update forced, the app quitting). */
  stop(): void { this.cancel?.(); this.cancel = null; }

  private arm(on: WhenIdleEvents): void {
    const schedule = this.d.schedule ?? defaultSchedule;
    this.cancel = schedule(() => {
      this.cancel = null;
      const n = this.d.busy();
      if (n <= 0) { on.go(); return; }
      if ((this.d.now ?? Date.now)() - this.since >= (this.d.maxMs ?? UPDATE_WAIT_MAX_MS)) { on.waiting(n, true); return; }
      on.waiting(n, false);
      this.arm(on);
    }, this.d.pollMs ?? UPDATE_POLL_MS);
  }
}
