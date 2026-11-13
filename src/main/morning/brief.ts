// The morning block's data (ADR 0102), pure: when a new presence opens the block (the first of the day, or after an
// absence of MORNING_GAP_MS), and the brief built from what the app already holds, zero tokens. The service
// (morning/service.ts) gathers the inputs and keeps the presence state; the renderer draws it (MorningBlock.tsx).
// Pinned by test/unit/morning/brief.test.ts.
import type { AgentRun } from '../../shared/agents';
import type { BrainChange } from '../../shared/brain-model';
import type { ChatSummary, TasksState } from '../../shared/contract';
import type { MorningBrief, MorningOutcome } from '../../shared/morning';

/** an absence this long opens the block again (the owner's "dopo un'assenza di 4 ore") */
export const MORNING_GAP_MS = 4 * 3600_000;
const DAY = 86_400_000;

export interface PresenceState {
  version: 1;
  /** the user's last presence (ms); null = never seen */
  lastPresentAt: number | null;
  /** the block open now: from when it reports, and on which local day it opened */
  openSince: number | null; openDay: string | null;
  /** the local day the user dismissed it (Esc / Ok): not again that day */
  dismissedDay: string | null;
}
export const emptyPresence = (): PresenceState => ({ version: 1, lastPresentAt: null, openSince: null, openDay: null, dismissedDay: null });

/** A presence at `now`: the block opens on the first one of a day or after a long absence, unless dismissed today. */
export function presenceStep(st: PresenceState, now: number, day: (t: number) => string): PresenceState {
  const today = day(now), prev = st.lastPresentAt;
  const fresh = prev === null || day(prev) !== today || now - prev >= MORNING_GAP_MS;
  const next = { ...st, lastPresentAt: prev === null ? now : Math.max(prev, now) };
  if (fresh && st.dismissedDay !== today) { next.openSince = prev ?? now - DAY; next.openDay = today; }
  return next;
}
export const isOpen = (st: PresenceState, now: number, day: (t: number) => string): boolean =>
  st.openSince !== null && st.openDay === day(now) && st.dismissedDay !== day(now);
export const dismissStep = (st: PresenceState, now: number, day: (t: number) => string): PresenceState => ({ ...st, openSince: null, openDay: null, dismissedDay: day(now) });

export interface BriefInput {
  now: number; since: number;
  chats: ChatSummary[];
  runs: AgentRun[];
  pending: number; approvals: number;
  tasks: TasksState | null;
  /** ideas.md rows from the brain's tables (titolo, stato, scaduta = the "Riprendere" date YYYY-MM-DD) */
  ideas: { titolo?: string; stato?: string; scaduta?: string }[];
  /** today in the brain's days (YYYY-MM-DD) */
  today: string;
  /** the maintenance change log, newest first */
  changes: BrainChange[];
  spendYesterdayUsd: number | null;
  stallMin: number;
  /** a chat's last event (ms), when the chat manager knows it */
  lastEventAt?: (chatId: string) => number | undefined;
}

export function outcomeOf(r: AgentRun): MorningOutcome {
  if (r.report) return r.report.outcome;
  const v = r.outcome?.verdict;
  return v === 'success' ? 'done' : v === 'partial' ? 'partial' : v === 'fail' ? 'blocked' : 'unknown';
}

const cut = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function buildBrief(i: BriefInput): MorningBrief {
  const chat = new Map(i.chats.map(c => [c.id, c]));
  // root role runs the user would call "work": not one-shot jobs, not a delegated child's (its parent reports)
  const runs = i.runs.filter(r => r.endedAt !== undefined && r.endedAt >= i.since && r.endedAt <= i.now && r.source !== 'oneshot' && !r.parentRunId)
    .sort((a, b) => b.endedAt! - a.endedAt!).slice(0, 12)
    .map(r => { const c = chat.get(r.chatId); return { runId: r.runId, chatId: r.chatId, title: cut(c?.title || r.goal || r.agentId, 90), outcome: outcomeOf(r), endedAt: r.endedAt!, open: !!c && !c.closedAt && c.state !== 'closed' }; });
  const t = i.tasks;
  const prs = [
    ...(t?.prs ?? []).filter(p => /fail/i.test(p.build?.result ?? '')).map(p => ({ id: p.id, title: cut(p.title, 90), url: p.url, why: 'build' as const })),
    ...(t?.reviews ?? []).map(p => ({ id: p.id, title: cut(p.title, 90), url: p.url, why: 'vote' as const })),
  ].filter((p, k, all) => all.findIndex(x => x.id === p.id) === k).slice(0, 6);
  const ideas = i.ideas.filter(r => !!r.scaduta && /^\d{4}-\d{2}-\d{2}$/.test(r.scaduta) && r.scaduta <= i.today && !/fatta|scartata/i.test(r.stato ?? '') && !!r.titolo?.trim())
    .sort((a, b) => a.scaduta!.localeCompare(b.scaduta!)).slice(0, 4).map(r => ({ title: cut(r.titolo!, 90), due: r.scaduta! }));
  const changes = i.changes.filter(c => c.job !== 'user' && c.at >= i.since && !c.rolledBackAt).slice(0, 20).map(c => ({ id: c.id, summary: cut(c.summary, 140), canRollback: c.canRollback }));
  const stalled = i.chats.filter(c => !c.isOrchestrator && !c.parentId && !c.closedAt && (c.state === 'running' || c.state === 'starting') && !c.queued && !c.pending)
    .map(c => ({ c, quiet: i.now - Math.max(i.lastEventAt?.(c.id) ?? 0, c.updatedAt) }))
    .filter(x => x.quiet >= Math.max(1, i.stallMin) * 60_000)
    .map(x => ({ chatId: x.c.id, title: cut(x.c.agent?.name ? `${x.c.agent.name} · ${x.c.title}` : x.c.title, 90), quietMin: Math.floor(x.quiet / 60_000) }));
  return { since: i.since, at: i.now, runs, pending: i.pending, approvals: i.approvals, prs, tasksAt: t?.at ?? null, ideas, changes, spendYesterdayUsd: i.spendYesterdayUsd, stalled };
}

/** Yesterday's $ in the brain's cost report (/api/cost: byDay and cursor.byDay, { day: { usd } }); null when absent. */
export function spendOfDay(cost: unknown, day: string): number | null {
  const o = cost && typeof cost === 'object' ? cost as Record<string, unknown> : null;
  if (!o) return null;
  const usd = (byDay: unknown): number | null => {
    const d = byDay && typeof byDay === 'object' ? (byDay as Record<string, unknown>)[day] : undefined;
    const v = d && typeof d === 'object' ? (d as { usd?: unknown }).usd : undefined;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const claude = usd(o.byDay), cursor = usd(o.cursor && typeof o.cursor === 'object' ? (o.cursor as Record<string, unknown>).byDay : undefined);
  if (claude === null && cursor === null) return o.byDay && typeof o.byDay === 'object' ? 0 : null;
  return Math.round(((claude ?? 0) + (cursor ?? 0)) * 100) / 100;
}

/** The app's own fallback: the settled cost of the runs started that day (the engines that report one). */
export function runsSpend(runs: readonly AgentRun[], from: number, to: number): number | null {
  const day = runs.filter(r => r.startedAt >= from && r.startedAt < to && r.costUsd !== null);
  return day.length ? Math.round(day.reduce((n, r) => n + (r.costUsd ?? 0), 0) * 100) / 100 : null;
}
