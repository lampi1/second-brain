// The turn-start watchdog (ADR 0221): a message sent to an idle session that gets no first event from its engine
// within a bounded time (default 120 s) puts a visible warning in the chat ("<engine> non ha ancora risposto…: la
// sessione resta aperta") and a warn line in the log; the session is never restarted or replaced by it (the user's Stop
// or a later answer decide). When the first event comes after all, the warning turns into an info line saying how late,
// and every turn logs its time to first event ("timing: turn start"). Why: a stalled engine looked like a busy one,
// with no sign and no trace (cloudroom's watchdog idea, plan proposal 10). How: the session and its sink are wrapped;
// anything the engine makes the adapter report (an item, a question, a patch, an exit) counts as its first event, except
// what the adapter reports synchronously inside send() itself. Used by engines/sessions.ts sessionFor, for every kind.
import { sysEn } from '../../shared/sys';
import type { ChatItem } from '../../shared/contract';
import type { HarnessSession, SessionSink } from './session';
import { log } from '../log';

export const TURN_NO_START_MS = 120_000;

export interface WatchOptions {
  chatId: string;
  engine: string;
  label: string;
  /** how long a sent turn may wait for its first event (tests: a few ms) */
  noStartMs?: number;
}

let seq = 0;

/** The session made by `make`, watched: same object for the caller (a Proxy), its sink wrapped. */
export function watchTurns<S extends HarnessSession>(make: (sink: SessionSink) => S, sink: SessionSink, o: WatchOptions): S {
  const limit = o.noStartMs ?? TURN_NO_START_MS;
  let armedAt: number | null = null, timer: ReturnType<typeof setTimeout> | null = null, warnId: string | null = null, inSend = false;
  const disarm = () => { if (timer) clearTimeout(timer); timer = null; armedAt = null; warnId = null; };
  const seconds = (ms: number) => Math.round(ms / 1000);
  const fire = () => {
    timer = null;
    if (armedAt === null) return;
    const waited = Date.now() - armedAt, params = { label: o.label, seconds: seconds(waited) };
    warnId = `turn-watch-${(seq++).toString(36)}`;
    const item: ChatItem = { kind: 'system', id: warnId, at: Date.now(), text: sysEn('turnNoStart', params), code: 'turnNoStart', params, level: 'warn' };
    sink.item(item, false);
    log.warn('chats', 'turn start watchdog: no first event from the engine', {
      chat: o.chatId, data: { engine: o.engine, waitedMs: waited },
      cause: 'the message was written to the engine and it has sent nothing since',
      hint: 'the session is left open: the user may wait or press Stop; npm run logs -- --run <chat> shows the engine stderr',
    });
  };
  const first = () => {
    if (inSend || armedAt === null) return;
    const ms = Date.now() - armedAt, late = warnId;
    disarm();
    log.info('chats', 'timing: turn start', { chat: o.chatId, data: { engine: o.engine, firstEventMs: ms, late: !!late } });
    if (late) {
      const params = { label: o.label, seconds: seconds(ms) };
      sink.item({ kind: 'system', id: late, at: Date.now(), text: sysEn('turnStartLate', params), code: 'turnStartLate', params, level: 'info' }, true);
    }
  };
  const watched = new Proxy(sink, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown;
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        const own = prop === 'item' && (args[0] as ChatItem).id === warnId && warnId !== null;
        const engineSide = !(prop === 'item' && (args[0] as ChatItem).kind === 'user');
        if (prop === 'exit') disarm();
        else if (!own && engineSide) first();
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  const session = make(watched);
  return new Proxy(session, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown;
      if (prop === 'send') {
        return (...args: unknown[]) => {
          const idle = !target.busy;
          inSend = true;
          try { (v as (...a: unknown[]) => unknown).apply(target, args); } finally { inSend = false; }
          if (idle && armedAt === null) { armedAt = Date.now(); timer = setTimeout(fire, limit); timer.unref?.(); }
        };
      }
      if (prop === 'interrupt' || prop === 'close') return (...args: unknown[]) => { disarm(); return (v as (...a: unknown[]) => unknown).apply(target, args); };
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}
