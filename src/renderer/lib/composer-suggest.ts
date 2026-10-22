// The chat composer's inline suggestion (issue #167, ADR 0118), renderer side: the grey text after the caret that Tab
// accepts. localSuggestion() is the zero-token part, pure: the user's past prompts (the whole message as a prefix of
// one sent before, newest first), then the last word or words of the current line as a prefix of a slash command
// ("/rev" → "/review "), a role, a skill, a chat title or a file name the chat touched. SuggestScheduler is the model
// part's timing: every key cancels the pending pause and the request in flight; a request leaves only after
// SUGGEST_DEBOUNCE_MS without keys (never while the user types fast) and its answer is used only if no key came
// since. The past prompts live in this viewer's localStorage (a convenience: an empty or blocked store only means fewer
// suggestions). Used by components/ChatInput.tsx; unit-tested in test/unit/composer-suggest.test.ts.
import type { ChatItem } from '@shared/contract';
import type { SuggestAnswer, SuggestRequest } from '@shared/composer-suggest';

export interface LocalSources {
  /** the chat's "/" commands and skills (skill: true) */
  commands: readonly { name: string; skill?: boolean }[];
  roles: readonly string[];
  chats: readonly string[];
  files: readonly string[];
  /** past prompts, newest first */
  history: readonly string[];
}

const MIN_WORD = 3;
const MIN_HISTORY = 4;
const MAX_WORDS = 6;

/** The text to show after the caret, or null. Only with the caret at the end of the text. */
export function localSuggestion(text: string, caret: number, src: LocalSources): string | null {
  if (!text || caret !== text.length) return null;
  // 1. a message sent before that starts with what is typed: the rest of its line
  const typed = text.trimStart();
  if (typed.length >= MIN_HISTORY) {
    const low = typed.toLowerCase();
    for (const h of src.history) {
      if (h.length > typed.length && h.toLowerCase().startsWith(low)) {
        const rest = h.slice(typed.length).split('\n')[0]!;
        if (rest.trim()) return rest;
      }
    }
  }
  const line = text.slice(text.lastIndexOf('\n') + 1);
  // 2. a "/" command word anywhere on the line
  const word = /(?:^|\s)(\S+)$/.exec(line)?.[1] ?? '';
  if (word.startsWith('/') && word.length >= 2) {
    const q = word.slice(1).toLowerCase();
    const c = src.commands.filter(x => x.name.toLowerCase().startsWith(q) && x.name.length > q.length)
      .sort((a, b) => Number(!!b.skill) - Number(!!a.skill) || a.name.length - b.name.length)[0];
    return c ? `${c.name.slice(q.length)} ` : null;
  }
  // 3. the last words as the start of a name: the longest fragment that matches wins
  const names = [...src.roles, ...src.commands.filter(c => c.skill).map(c => c.name), ...src.chats, ...src.files];
  const starts: number[] = [];
  for (const m of line.matchAll(/(?:^|\s)(?=\S)/g)) starts.push(m.index + m[0].length);
  for (const i of starts.slice(-MAX_WORDS)) {
    const frag = line.slice(i);
    if (frag.trim().length < MIN_WORD || /\s$/.test(frag)) continue;
    const low = frag.toLowerCase();
    const hit = names.find(n => n.length > frag.length && n.toLowerCase().startsWith(low));
    if (hit) return hit.slice(frag.length);
  }
  return null;
}

/** File names a chat's tools touched (their basenames, newest first, at most `max`). */
export function filesOf(items: readonly ChatItem[] | undefined, max = 200): string[] {
  const out = new Set<string>();
  for (let i = (items?.length ?? 0) - 1; i >= 0 && out.size < max; i--) {
    const it = items![i]!;
    if (it.kind !== 'tool' || !it.input || typeof it.input !== 'object') continue;
    const inp = it.input as Record<string, unknown>;
    for (const k of ['file_path', 'path', 'notebook_path']) {
      const v = inp[k];
      if (typeof v !== 'string' || !v) continue;
      const base = v.split(/[\\/]/).pop()!;
      if (/\.\w{1,8}$/.test(base) && base.length <= 80) out.add(base);
    }
  }
  return [...out];
}

/** The user's own past messages in the chats on screen, newest first (no duplicates, none from another chat). */
export function promptsOf(items: Readonly<Record<string, readonly ChatItem[]>>, max = 300): string[] {
  const all: { at: number; text: string }[] = [];
  for (const list of Object.values(items)) for (const it of list) if (it.kind === 'user' && !it.from && it.text.trim()) all.push({ at: it.at, text: it.text.trim() });
  return [...new Set(all.sort((a, b) => b.at - a.at).map(x => x.text))].slice(0, max);
}

const HISTORY_KEY = 'sb.composer.history.v1';
const HISTORY_MAX = 200;
/** The prompts this viewer sent, newest first (localStorage; empty when it is not readable). */
export function savedPrompts(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, HISTORY_MAX) : [];
  } catch { return []; }
}
export function rememberPrompt(text: string): void {
  const t = text.trim();
  if (t.length < MIN_HISTORY || t.length > 2000) return;
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify([t, ...savedPrompts().filter(x => x !== t)].slice(0, HISTORY_MAX))); } catch { /* fewer suggestions, nothing else */ }
}

export interface SchedulerDeps {
  delayMs: number;
  fetch: (req: SuggestRequest) => Promise<SuggestAnswer>;
  /** asks main to abort the request in flight */
  cancel: () => void;
  /** the model's suffix for the text it was asked for (null = none) */
  onAnswer: (forText: string, suffix: string | null) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export class SuggestScheduler {
  private timer: unknown = null;
  private seq = 0;
  private inflight = false;
  constructor(private readonly d: SchedulerDeps) {}

  /** A key: the pause starts over, the request in flight is cancelled and its answer will be ignored. */
  key(): void {
    this.seq++;
    if (this.timer !== null) { (this.d.clearTimer ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer); this.timer = null; }
    if (this.inflight) { this.inflight = false; this.d.cancel(); }
  }

  /** After the pause (and only if no key came), ask the model for `text`. */
  schedule(text: string, req: SuggestRequest): void {
    this.key();
    const set = this.d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.timer = set(() => {
      this.timer = null;
      const my = this.seq;
      this.inflight = true;
      void this.d.fetch(req).then(a => a.text, () => null).then(s => {
        if (my !== this.seq) return;
        this.inflight = false;
        this.d.onAnswer(text, s);
      });
    }, this.d.delayMs);
  }

  dispose(): void { this.key(); }
}
