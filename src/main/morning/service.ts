// The morning block's service (ADR 0102): keeps the user's presence (userData/morning.json: the last presence, the day
// the block opened and the day it was dismissed), answers the one 'morning:brief' channel (presence / get / dismiss)
// and gathers the brief's inputs from what the app already holds, with zero tokens: the chats and their run store, the
// open requests, the "Da approvare" queue, the Task page's last read, the brain's ideas and cost report (its own data
// server, brain.api), the cloud agents, the maintenance change log. The brain's two reads are cached (ideas 5 min,
// yesterday's spend for the day). Off in the test suites unless SB_MORNING=1 (the block would cover their pages).
// Built by wiring.ts and demo-wiring.ts; IPC in index.ts; pure parts in morning/brief.ts.
import type { AgentRun } from '../../shared/agents';
import type { BrainChange } from '../../shared/brain-model';
import type { CloudAgent } from '../../shared/cloud';
import type { BrainApiResult, ChatSummary, TasksState } from '../../shared/contract';
import type { MorningOp, MorningState } from '../../shared/morning';
import { readLocal, writeLocal } from '../agents/local-store';
import { localDay } from '../jobs/scheduler';
import { romeDay } from '../brain/live';
import { errText, log } from '../log';
import { buildBrief, dismissStep, emptyPresence, isOpen, presenceStep, runsSpend, spendOfDay, type PresenceState } from './brief';

export interface MorningDeps {
  file: string;
  chats(): ChatSummary[];
  runs(): AgentRun[];
  /** open questions, permissions and commands left for the user */
  pending(): number;
  /** entries waiting in "Da approvare" (trials, tier suggestions, the Battito's proposals) */
  approvals(): number;
  tasks(): TasksState | null;
  cloud(): CloudAgent[];
  changes(): BrainChange[];
  api(path: string): Promise<BrainApiResult>;
  stallMin(): number;
  lastEventAt?(chatId: string): number | undefined;
  now?(): number;
  env?: NodeJS.ProcessEnv;
}

const IDEAS_MS = 5 * 60_000;

export class MorningService {
  private st: PresenceState;
  private ideas: { at: number; rows: { titolo?: string; stato?: string; scaduta?: string }[] } | null = null;
  private spend: { day: string; usd: number | null } | null = null;
  private savedAt = 0;
  /** further approvals counted in (the Battito's proposals: index.ts, where the Battito is built) */
  extraApprovals: () => number = () => 0;
  constructor(private readonly d: MorningDeps) {
    let st = emptyPresence();
    try {
      const raw = readLocal(d.file) as Partial<PresenceState> | undefined;
      const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null), s = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
      if (raw?.version === 1) st = { version: 1, lastPresentAt: n(raw.lastPresentAt), openSince: n(raw.openSince), openDay: s(raw.openDay), dismissedDay: s(raw.dismissedDay) };
    } catch { /* a broken file: start as a first presence */ }
    this.st = st;
  }
  private now(): number { return this.d.now?.() ?? Date.now(); }
  private enabled(): boolean { const env = this.d.env ?? process.env; return !env.SB_TEST || env.SB_MORNING === '1'; }
  private save(force: boolean): void {
    const now = this.now();
    if (!force && now - this.savedAt < 60_000) return;
    this.savedAt = now;
    try { writeLocal(this.d.file, this.st); } catch (e) { log.warn('app', 'morning presence not saved', { cause: errText(e), hint: 'the block may show again after a restart; check the app data folder is writable' }); }
  }
  /** The user has worked with the app before: a role run or a work chat. */
  history(): boolean {
    try { return this.d.runs().some(r => r.source !== 'oneshot') || this.d.chats().some(c => !c.isOrchestrator); } catch { return false; }
  }

  async handle(arg: { op?: MorningOp } | undefined): Promise<MorningState> {
    const op: MorningOp = arg?.op === 'get' || arg?.op === 'dismiss' ? arg.op : 'presence';
    const now = this.now(), history = this.history();
    if (op === 'dismiss') { this.st = dismissStep(this.st, now, localDay); this.save(true); return { history, show: false, brief: null }; }
    if (op === 'presence') {
      const before = this.st.openSince;
      this.st = presenceStep(this.st, now, localDay);
      this.save(before !== this.st.openSince);
    }
    const show = this.enabled() && history && isOpen(this.st, now, localDay);
    if (!show && op !== 'get') return { history, show: false, brief: null };
    const since = (show ? this.st.openSince : null) ?? this.st.lastPresentAt ?? now - 86_400_000;
    return { history, show, brief: await this.brief(Math.min(since, now), now) };
  }

  private async brief(since: number, now: number) {
    const [ideas, spend] = await Promise.all([this.readIdeas(now), this.readSpend(now)]);
    const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };
    return buildBrief({
      now, since, chats: safe(() => this.d.chats(), []), runs: safe(() => this.d.runs(), []),
      pending: safe(() => this.d.pending(), 0), approvals: safe(() => this.d.approvals(), 0) + safe(() => this.extraApprovals(), 0),
      tasks: safe(() => this.d.tasks(), null), ideas, today: romeDay(now), cloud: safe(() => this.d.cloud(), []), changes: safe(() => this.d.changes(), []),
      spendYesterdayUsd: spend, stallMin: safe(() => this.d.stallMin(), 10), ...(this.d.lastEventAt ? { lastEventAt: (id: string) => this.d.lastEventAt?.(id) } : {}),
    });
  }
  private async readIdeas(now: number) {
    if (this.ideas && now - this.ideas.at < IDEAS_MS) return this.ideas.rows;
    let rows: { titolo?: string; stato?: string; scaduta?: string }[] = [];
    try {
      const r = await this.d.api('/api/tables');
      const list = r.ok && r.data && typeof r.data === 'object' ? (r.data as { ideas?: unknown }).ideas : undefined;
      if (Array.isArray(list)) rows = list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map(x => ({ titolo: String(x.titolo ?? ''), stato: String(x.stato ?? ''), scaduta: String(x.scaduta ?? '') }));
    } catch { /* no brain server: no ideas row */ }
    this.ideas = { at: now, rows };
    return rows;
  }
  private async readSpend(now: number): Promise<number | null> {
    const today = romeDay(now), yesterday = romeDay(now - 86_400_000);
    if (this.spend?.day === today) return this.spend.usd;
    let usd: number | null = null;
    try { const r = await this.d.api('/api/cost?days=2'); if (r.ok) usd = spendOfDay(r.data, yesterday); } catch { /* fall back to the runs */ }
    if (usd === null) {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      try { usd = runsSpend(this.d.runs(), start.getTime() - 86_400_000, start.getTime()); } catch { usd = null; }
    }
    this.spend = { day: today, usd };
    return usd;
  }
}
