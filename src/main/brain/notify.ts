// Calm notifications (calm UI: few, useful notifications; a toast must be rare, named and useful; research in docs/research/
// research-browser-memory.md D). Rules: a Windows toast only for urgent kinds by default (settings.osToasts), only
// when the app window is not focused (when the user is looking, the in-app feed is enough), never for events that happened
// while the app was closed, never for muted kinds or in do-not-disturb. Events that arrive together become ONE toast
// ("3 novità per te"); at most one toast every 20 s, except urgent ones (an agent blocked on the user), which go out after a
// short 1.5 s grouping window. A new toast replaces the previous one instead of stacking. While "Rispondi dopo" is on
// (main/later.ts) a new request's event is `held`: it stays in the feed, no toast (the user answers from the queue).
// Windows caveat: an unpackaged app (electron.exe from node_modules) may have its toasts dropped silently when no Start
// Menu shortcut carries its AppUserModelId ('second-brain', set in main/index.ts). We cannot detect a silent drop; a
// reported failure ('failed' event) or Notification.isSupported() false switches to in-app only (logged with a hint).
// The packaged build (phase 5) installs the shortcut. Used by brain/index.ts; the Electron side is in showToast().
import type { FeedEvent, Settings } from '../../shared/contract';
import { cut } from './live';

export interface Toast { title: string; body: string; urgent: boolean; eventIds: string[]; count: number }

export interface NotifierDeps {
  settings(): Pick<Settings, 'osToasts' | 'mute' | 'dnd' | 'dndUntil'>;
  isFocused(): boolean;
  show(t: Toast): void;
  /** false = OS toasts unavailable (tests, unsupported, a reported failure): everything stays in-app */
  enabled(): boolean;
  /** an event that must not become a toast now ("Rispondi dopo": a new request waits silently in the queue) */
  held?(e: FeedEvent): boolean;
}

export interface NotifierTiming { groupMs: number; urgentGroupMs: number; minGapMs: number }
export const TIMING: NotifierTiming = { groupMs: 4000, urgentGroupMs: 1500, minGapMs: 20000 };

const LEVEL = { quiet: 0, normal: 1, urgent: 2 } as const;
const MIN = { off: 99, normal: 1, urgent: 2 } as const;

/** Which events may become a toast (before the focus check and grouping). */
export function loud(events: FeedEvent[], s: Pick<Settings, 'osToasts' | 'mute' | 'dnd' | 'dndUntil'>, now = Date.now()): FeedEvent[] {
  if (s.dnd || (s.dndUntil !== null && s.dndUntil !== undefined && now < s.dndUntil)) return [];
  return events.filter(e => !e.away && !s.mute[e.kind] && LEVEL[e.priority] >= MIN[s.osToasts]);
}

/** One toast for a group of events: a single named thing, or "N novità per te" with the first three. */
export function compose(events: FeedEvent[]): Toast {
  const urgent = events.some(e => e.priority === 'urgent');
  const ordered = [...events].sort((a, b) => LEVEL[b.priority] - LEVEL[a.priority] || b.at - a.at);
  const first = ordered[0]!;
  if (ordered.length === 1) return { title: cut(`${first.label}: ${first.title}`, 120), body: cut(first.detail, 240), urgent, eventIds: [first.id], count: 1 };
  const lines = ordered.slice(0, 3).map(e => cut(`${e.label}: ${e.title}`, 80));
  if (ordered.length > 3) lines.push(`e altre ${ordered.length - 3}`);
  return { title: `${ordered.length} novità per te`, body: lines.join('\n'), urgent, eventIds: ordered.map(e => e.id), count: ordered.length };
}

export class Notifier {
  private buffer: FeedEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private dueAt = 0;
  private firstAt = 0;
  private lastToastAt = -Infinity;
  readonly shown: Toast[] = []; // last few, for diagnostics and tests

  constructor(private d: NotifierDeps, private t: NotifierTiming = TIMING) {}

  push(events: FeedEvent[]): void {
    if (!this.d.enabled()) return;
    const l = this.free(loud(events, this.d.settings()));
    if (!l.length || this.d.isFocused()) return;
    const now = Date.now();
    if (!this.buffer.length) this.firstAt = now;
    this.buffer.push(...l);
    const urgent = this.buffer.some(e => e.priority === 'urgent');
    // urgent: a short grouping window, no throttle · others: grouped, and never sooner than 20 s after the last toast
    const due = urgent ? this.firstAt + this.t.urgentGroupMs : Math.max(this.firstAt + this.t.groupMs, this.lastToastAt + this.t.minGapMs);
    this.schedule(Math.max(now, due));
  }

  private schedule(at: number): void {
    if (this.timer && this.dueAt <= at) return; // an earlier flush is already planned
    if (this.timer) clearTimeout(this.timer);
    this.dueAt = at;
    this.timer = setTimeout(() => this.flush(), Math.max(0, at - Date.now()));
  }

  private flush(): void {
    this.timer = null; this.dueAt = 0;
    const events = this.buffer; this.buffer = [];
    // the user came back to the app meanwhile, or muted/disabled it: the feed already shows them
    const still = this.d.enabled() ? this.free(loud(events, this.d.settings())) : [];
    if (!still.length || this.d.isFocused()) return;
    const toast = compose(still);
    this.lastToastAt = Date.now();
    this.shown.push(toast);
    if (this.shown.length > 20) this.shown.shift();
    this.d.show(toast);
  }

  private free(events: FeedEvent[]): FeedEvent[] { return this.d.held ? events.filter(e => !this.d.held!(e)) : events; }

  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; this.buffer = []; }
}
