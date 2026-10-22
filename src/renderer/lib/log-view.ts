// Pure helpers of the Log page (components/LogPage.tsx, ADR 0111): the tasks' chains built from the journal's events
// (one card per task: who chose whom and why, each agent's work, the requests, the result, the verification), the
// automatic flags (a duplicate reply, a permission closed without the user's answer, a review without a verdict), the
// search and filters, the day groups. Plain software rules over the app's events: no model, no tokens.
// Tests: test/unit/log-view.test.ts.
import type { LogEvent, LogKind, LogLevel } from '@shared/activity-log';
import { t } from '../i18n';

export type StepKind = 'open' | 'classifier' | 'work' | 'request' | 'result' | 'review' | 'verdict' | 'closed' | 'error' | 'unverified';
export interface ChainStep {
  key: string; kind: StepKind; level: LogLevel; at: number; title: string; text?: string;
  chatId?: string; who?: string; depth: number;
  costUsd: number; ms: number; turns: number; tools: string[]; toolErrors: number;
  /** the events behind the step (a work step folds a chat's consecutive turns) */
  events: LogEvent[];
}
export type FlagKind = 'duplicate' | 'hidden-approval' | 'review-no-verdict';
export interface LogFlag { kind: FlagKind; title: string; detail: string; stepKey?: string }
export interface TaskChain {
  rootId: string; title: string; first: number; last: number; costUsd: number;
  steps: ChainStep[]; flags: LogFlag[]; chats: string[]; errors: number; verified: boolean;
}

const norm = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The tasks, newest activity first, from the task events (kind task, or any event with a rootId). */
export function buildTasks(events: readonly LogEvent[]): TaskChain[] {
  const byRoot = new Map<string, LogEvent[]>();
  for (const e of events) {
    if (!e.rootId) continue;
    const list = byRoot.get(e.rootId);
    if (list) list.push(e); else byRoot.set(e.rootId, [e]);
  }
  const out: TaskChain[] = [];
  for (const [rootId, list] of byRoot) out.push(chainOf(rootId, [...list].sort((a, b) => a.at - b.at)));
  return out.sort((a, b) => b.last - a.last);
}

function chainOf(rootId: string, list: LogEvent[]): TaskChain {
  const parent = new Map<string, string>();
  for (const e of list) if (e.chatId && e.parentId) parent.set(e.chatId, e.parentId);
  const depthOf = (id: string | undefined) => { let d = 0, cur = id; while (cur && parent.has(cur) && d < 8) { cur = parent.get(cur); d++; } return d; };
  const steps: ChainStep[] = [];
  const reqStep = new Map<string, ChainStep>();
  const step = (e: LogEvent, kind: StepKind): ChainStep => ({ key: e.id, kind, level: e.level, at: e.at, title: e.title, ...(e.text ? { text: e.text } : {}), ...(e.chatId ? { chatId: e.chatId } : {}), ...(e.who ? { who: e.who } : {}),
    depth: depthOf(e.chatId), costUsd: e.costUsd ?? 0, ms: e.ms ?? 0, turns: kind === 'work' ? 1 : 0, tools: [...(e.tools ?? [])], toolErrors: e.toolErrors ?? 0, events: [e] });
  for (const e of list) {
    const prev = steps.at(-1);
    if (e.step === 'work') {
      // a chat's consecutive turns are one "lavora" step
      if (prev?.kind === 'work' && prev.chatId === e.chatId) {
        prev.events.push(e); prev.turns++; prev.costUsd += e.costUsd ?? 0; prev.ms += e.ms ?? 0; prev.toolErrors += e.toolErrors ?? 0;
        for (const t of e.tools ?? []) if (!prev.tools.includes(t)) prev.tools.push(t);
        if (e.level === 'error' || (e.level === 'warn' && prev.level !== 'error')) prev.level = e.level;
        prev.at = e.at;
        continue;
      }
      steps.push(step(e, 'work'));
    } else if (e.step === 'request') {
      const s = step(e, 'request'); steps.push(s); if (e.reqId) reqStep.set(`${e.chatId}/${e.reqId}`, s);
    } else if (e.step === 'resolved') {
      const s = e.reqId ? reqStep.get(`${e.chatId}/${e.reqId}`) : undefined;
      if (s) { s.events.push(e); s.level = e.by === 'user' ? 'ok' : e.by === 'other' && e.reqType === 'permission' ? 'warn' : 'info'; s.text = e.title; }
      else steps.push(step(e, 'request'));
    } else if (e.step === 'open' || e.step === 'result' || e.step === 'review' || e.step === 'verdict' || e.step === 'closed') steps.push(step(e, e.step));
    else if (e.kind === 'classifier') steps.push(step(e, 'classifier'));
    else if (e.level === 'error') steps.push(step(e, 'error'));
  }
  const verified = list.some(e => e.step === 'verdict' && e.verdict && e.verdict !== 'unknown');
  const delivered = list.some(e => e.step === 'result' || e.step === 'closed');
  if (!verified && delivered) {
    const last = list.at(-1)!;
    steps.push({ key: `${rootId}-unverified`, kind: 'unverified', level: 'info', at: last.at, title: t('appText.log.unverified'), text: t('appText.log.unverifiedText'), depth: 0, costUsd: 0, ms: 0, turns: 0, tools: [], toolErrors: 0, events: [] });
  }
  const live = list.find(e => e.chatId === rootId);
  return {
    rootId, title: live?.task ?? list.find(e => e.task)?.task ?? list[0]!.who ?? t('appText.log.task'), first: list[0]!.at, last: list.at(-1)!.at,
    costUsd: list.reduce((n, e) => n + (e.step === 'work' ? e.costUsd ?? 0 : 0), 0), steps, flags: flagsOf(list, steps),
    chats: [...new Set(list.map(e => e.chatId).filter((x): x is string => !!x))], errors: list.filter(e => e.level === 'error').length, verified,
  };
}

/** The automatic flags of one task (shared rules, no model). */
export function flagsOf(list: readonly LogEvent[], steps: readonly ChainStep[] = []): LogFlag[] {
  const flags: LogFlag[] = [];
  const stepOf = (e: LogEvent) => steps.find(s => s.events.includes(e))?.key;
  // the same answer twice: two results with the same text, or two turns of a chat ending with the same words
  const seen = new Map<string, LogEvent>();
  for (const e of list) {
    if (e.step !== 'result' && e.step !== 'work') continue;
    const text = norm(e.step === 'result' ? e.output ?? e.text : e.output);
    if (text.length < 20) continue;
    const key = `${e.step === 'result' ? 'r' : e.chatId}|${text}`;
    const before = seen.get(key);
    if (before) { flags.push({ kind: 'duplicate', title: t('appText.log.duplicate'), detail: t('appText.log.duplicateText', { who: e.who ?? t('appText.log.anAgent') }), stepKey: stepOf(e) }); break; }
    seen.set(key, e);
  }
  // a permission closed without the user's answer
  for (const e of list) if (e.step === 'resolved' && e.reqType === 'permission' && e.by === 'other') {
    flags.push({ kind: 'hidden-approval', title: t('appText.log.hiddenApproval'), detail: t('appText.log.hiddenApprovalText', { what: e.text ?? '', who: e.who ?? t('appText.log.anAgentLower') }), stepKey: stepOf(e) });
  }
  // a review that ended without a verdict
  for (const r of list) {
    if (r.step !== 'review' || !r.chatId) continue;
    const mine = list.filter(e => e.chatId === r.chatId);
    const ended = mine.some(e => e.step === 'closed' || e.step === 'result');
    if (ended && !mine.some(e => e.step === 'verdict')) flags.push({ kind: 'review-no-verdict', title: t('appText.log.noVerdict'), detail: t('appText.log.noVerdictText', { who: r.who ?? t('appText.log.theReview') }), stepKey: stepOf(r) });
  }
  return flags;
}

export type KindFilter = LogKind | 'all';
/** Events matching every word of the search and the kind filter. */
export function filterEvents(list: readonly LogEvent[], q: string, kind: KindFilter): LogEvent[] {
  const words = norm(q).normalize('NFD').replace(/[̀-ͯ]/g, '').split(' ').filter(Boolean);
  return list.filter(e => (kind === 'all' || e.kind === kind) && (!words.length || words.every(w => norm([e.title, e.text, e.who, e.task, e.error, ...(e.tools ?? [])].join(' ')).normalize('NFD').replace(/[̀-ͯ]/g, '').includes(w))));
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dayOf = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const clockOf = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

/** Newest first, grouped by local day (newest day first). */
export function byDay<T extends { at: number }>(list: readonly T[]): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const e of [...list].sort((a, b) => b.at - a.at)) { const d = dayOf(e.at); const l = m.get(d); if (l) l.push(e); else m.set(d, [e]); }
  return [...m];
}

/** Money: $0.004 → "$0,004", 1.5 → "$1,50". */
export const money = (usd: number) => `$${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)}`.replace('.', ',');
/** Time: 950 → "1 s", 125000 → "2 min 5 s". */
export function span(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  const m = Math.floor(ms / 60_000), s = Math.round((ms % 60_000) / 1000);
  return m < 60 ? `${m} min${s ? ` ${s} s` : ''}` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
/** Bytes: "3,2 MB". */
export const size = (b: number) => b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
