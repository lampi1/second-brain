// "Rispondi dopo" (ADR 0035; the user, 2026-10-13: "a volte sono concentrato e non ho tempo per rispondere"): one flag,
// kept in userData/answer-later.json so it survives a restart. On = every open question, permission and command waits in
// the "Da rispondere" queue and new ones join it without a popup or a Windows notification (the page still rings); off again when the user opens the queue. The flag lives in
// main because main must hold back the Windows notification of a new request too (brain/notify.ts, `held`); the page
// reads it at start ('later:get'), sets it ('later:set') and follows it ('later:changed'). Nothing is ever sent to the
// asking chats: they stay blocked on their request. Built by wiring.ts and demo-wiring.ts; pinned by test/unit/later.test.ts.
import fs from 'node:fs';
import type { AnswerLater } from '../shared/contract';
import { log } from './log';

/** The feed kinds that announce a request of an app chat (wiring.ts onWaiting, run/asks.ts onAsk): held while on. */
export const REQUEST_KINDS: ReadonlySet<string> = new Set(['question']);

export class AnswerLaterStore {
  private state: AnswerLater | null = null;
  constructor(private readonly file: string, private readonly emit: (s: AnswerLater) => void) {}

  get(): AnswerLater {
    if (this.state) return this.state;
    let on = false;
    try { on = (JSON.parse(fs.readFileSync(this.file, 'utf8')) as { on?: unknown }).on === true; } catch { /* first run or a broken file: off */ }
    return (this.state = { on });
  }

  /** On: "Rispondi dopo" · off: the user opened the queue. Saved and sent to the page only when it changes. */
  set(on: boolean): AnswerLater {
    if (this.get().on === on) return this.state!;
    this.state = { on };
    try { fs.writeFileSync(this.file, JSON.stringify(this.state)); } catch (e) {
      log.warn('later', '"Rispondi dopo" not saved', { cause: String(e), hint: 'check that userData is writable; it holds until the app restarts' });
    }
    log.info('later', on ? 'answer later: on' : 'queue opened: off');
    this.emit(this.state);
    return this.state;
  }
}
