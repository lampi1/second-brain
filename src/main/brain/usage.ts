// Usage for the top bar and for the spending limits. Why: the user wants to see at a glance what today costs and how
// close they are to their plan limits, without spending tokens. Sources (all read-only, no model call):
// - Claude $ today: the brain's ops/tools/cost.mjs --days 1 --json (transcripts priced at API list price; on a
//   subscription an equivalent cost), run as an Electron-node child, cached, refreshed every 3 min. It also carries
//   Cursor's real cost from its usage export CSV (known only up to the export time: older than today = unknown).
// - Plan windows (5 h / 7 d %): not readable at rest. Three sources, newest wins: (1) a running app Claude chat's
//   stream-json `rate_limit_event` (utilization as a 0-1 fraction, resets in unix seconds), (2) a `get_usage` control
//   response (0-100, ISO resets; needs a running CLI process but no model call), both pushed by the chat manager via
//   BrainService.ingestRateLimits; (3) Claude Code's own cache `cachedUsageUtilization` in ~/.claude.json (written when
//   /usage or get_usage ran; trusted for 1 hour, as Claude Code itself does). Nothing found = null + limitsNote.
// Used by brain/index.ts ('app:usage', 'usage' events, budget.ts input).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Usage } from '../../shared/contract';
import { log } from '../log';
import { romeDay } from './live';
import { runNode, type NodeRunner } from './node';
import type { ChatSpend, Spend } from './budget';

export interface Limits { fiveHourPct: number | null; fiveHourResetsAt: number | null; weekPct: number | null; weekResetsAt: number | null; source: 'stream' | 'get_usage' | 'claude-cache'; at: number }
export interface CostSnapshot { todayUsd: number; chats: ChatSpend[]; cursorTodayUsd: number | null; cursorNote: string; costKnown: boolean; costNote: string }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ddmm = (t: number) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit' }).format(new Date(t));
const hhmm = (t: number) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(new Date(t));

/** cost.mjs --json → today's Claude $, per-chat $ (key = Claude session id), Cursor's $ when its export covers today. */
export function parseCost(j: unknown, today: string): CostSnapshot {
  if (!isObj(j)) return { todayUsd: 0, chats: [], cursorTodayUsd: null, cursorNote: 'costi non disponibili', costKnown: false, costNote: 'cost.mjs: risposta non valida' };
  const byDay = isObj(j.byDay) ? j.byDay : {};
  const day = isObj(byDay[today]) ? (byDay[today] as Record<string, unknown>) : null;
  const todayUsd = num(day?.usd) ?? (Object.keys(byDay).length ? 0 : num(j.total) ?? 0);
  const chats: ChatSpend[] = isObj(j.chats)
    ? Object.entries(j.chats).flatMap(([id, c]) => (isObj(c) && (num(c.usd) ?? 0) > 0 ? [{ id, title: String(c.title ?? id.slice(0, 8)), usd: num(c.usd)! }] : []))
    : [];
  let cursorTodayUsd: number | null = null, cursorNote: string;
  const cur = isObj(j.cursor) ? j.cursor : null;
  const downloaded = cur && typeof cur.downloaded === 'string' ? Date.parse(cur.downloaded) : NaN;
  if (!cur || !cur.file) cursorNote = 'Cursor: costo sconosciuto (nessun export: dashboard Cursor → Usage → Export CSV)';
  else if (!Number.isFinite(downloaded) || romeDay(downloaded) !== today) cursorNote = `Cursor: oggi sconosciuto (export del ${Number.isFinite(downloaded) ? ddmm(downloaded) : '?'})`;
  else {
    const cd = isObj(cur.byDay) && isObj(cur.byDay[today]) ? (cur.byDay[today] as Record<string, unknown>) : null;
    cursorTodayUsd = num(cd?.usd) ?? 0;
    cursorNote = `Cursor: fino alle ${hhmm(downloaded)} (ora dell'export)`;
  }
  return { todayUsd, chats, cursorTodayUsd, cursorNote, costKnown: true, costNote: 'Claude a prezzo di listino API (su abbonamento è un costo equivalente)' };
}

const readWindow = (w: unknown, scale: number, resetsKey: string, resetsScale: 'iso' | 'unix'): { pct: number | null; resets: number | null } => {
  if (!isObj(w)) return { pct: null, resets: null };
  const u = num(w.utilization);
  const r = w[resetsKey];
  const resets = resetsScale === 'iso' ? (typeof r === 'string' ? Date.parse(r) : null) : (num(r) !== null ? num(r)! * 1000 : null);
  return { pct: u === null ? null : Math.round(u * scale * 10) / 10, resets: resets !== null && Number.isFinite(resets) ? resets : null };
};

/** A rate-limit message from Claude (stream event, get_usage answer, or Claude Code's cache) → plan windows, or null. */
export function parseRateLimits(msg: unknown, now = Date.now()): Limits | null {
  if (!isObj(msg)) return null;
  // (1) stream-json: {type:'rate_limit_event', rate_limit_info:{rateLimitType, utilization 0-1, resetsAt s, unifiedWindows?}}
  if (msg.type === 'rate_limit_event' && isObj(msg.rate_limit_info)) {
    const i = msg.rate_limit_info;
    const uw = isObj(i.unifiedWindows) ? i.unifiedWindows : {};
    let f = readWindow(uw.five_hour, 100, 'resetsAt', 'unix'), w = readWindow(uw.seven_day, 100, 'resetsAt', 'unix');
    const one = readWindow({ utilization: i.utilization, resetsAt: i.resetsAt }, 100, 'resetsAt', 'unix');
    if (f.pct === null && i.rateLimitType === 'five_hour') f = one;
    if (w.pct === null && i.rateLimitType === 'seven_day') w = one;
    if (f.pct === null && w.pct === null) return null;
    return { fiveHourPct: f.pct, fiveHourResetsAt: f.resets, weekPct: w.pct, weekResetsAt: w.resets, source: 'stream', at: now };
  }
  // (2) get_usage control response (maybe wrapped: {response:{...}}): rate_limits.{five_hour,seven_day}.{utilization 0-100, resets_at ISO}
  const body = isObj(msg.response) ? msg.response : msg;
  if (isObj(body.rate_limits)) {
    const f = readWindow(body.rate_limits.five_hour, 1, 'resets_at', 'iso'), w = readWindow(body.rate_limits.seven_day, 1, 'resets_at', 'iso');
    if (f.pct === null && w.pct === null) return null;
    return { fiveHourPct: f.pct, fiveHourResetsAt: f.resets, weekPct: w.pct, weekResetsAt: w.resets, source: 'get_usage', at: now };
  }
  // (3) Claude Code's cache: {fetchedAtMs, utilization:{five_hour:{utilization 0-100, resets_at}, seven_day:{...}}}
  if (num(msg.fetchedAtMs) !== null && isObj(msg.utilization)) {
    const f = readWindow(msg.utilization.five_hour, 1, 'resets_at', 'iso'), w = readWindow(msg.utilization.seven_day, 1, 'resets_at', 'iso');
    if (f.pct === null && w.pct === null) return null;
    return { fiveHourPct: f.pct, fiveHourResetsAt: f.resets, weekPct: w.pct, weekResetsAt: w.resets, source: 'claude-cache', at: num(msg.fetchedAtMs)! };
  }
  return null;
}

/** Newer limits on top of older ones: a message about one window (a five_hour-only rate_limit_event) keeps the other. */
export function mergeLimits(newer: Limits, older: Limits | null): Limits {
  if (!older) return newer;
  const five = newer.fiveHourPct !== null ? { fiveHourPct: newer.fiveHourPct, fiveHourResetsAt: newer.fiveHourResetsAt } : { fiveHourPct: older.fiveHourPct, fiveHourResetsAt: older.fiveHourResetsAt };
  const week = newer.weekPct !== null ? { weekPct: newer.weekPct, weekResetsAt: newer.weekResetsAt } : { weekPct: older.weekPct, weekResetsAt: older.weekResetsAt };
  return { ...newer, ...five, ...week };
}

/** Claude Code's global config (only the cachedUsageUtilization key is read; nothing else is kept or logged). */
export function claudeConfigFile(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json');
}
export const CACHE_TTL_MS = 3600e3;
export function readClaudeCache(file: string, now = Date.now()): Limits | null {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const l = parseRateLimits(j.cachedUsageUtilization, now);
    return l && now - l.at >= 0 && now - l.at <= CACHE_TTL_MS ? l : null;
  } catch { return null; }
}

/** Snapshot for the top bar from the last cost and the freshest limits. Windows past their reset become unknown. */
export function composeUsage(cost: CostSnapshot | null, limits: Limits | null, now = Date.now()): Usage {
  const u: Usage = { todayUsd: cost?.todayUsd ?? 0, fiveHourPct: null, fiveHourResetsAt: null, weekPct: null, weekResetsAt: null, limitsSource: null, limitsAt: null, at: now,
    costKnown: !!cost?.costKnown, costNote: cost?.costNote ?? 'costi in calcolo…', cursorTodayUsd: cost?.cursorTodayUsd ?? null, cursorNote: cost?.cursorNote ?? '' };
  if (!limits) {
    u.limitsNote = 'Limiti 5 ore / 7 giorni non disponibili: arrivano da una chat Claude aperta nell\'app (o, per un\'ora, da /usage in Claude Code)';
    return u;
  }
  const live = (pct: number | null, resets: number | null) => (resets !== null && resets < now ? null : pct);
  u.fiveHourPct = live(limits.fiveHourPct, limits.fiveHourResetsAt);
  u.fiveHourResetsAt = u.fiveHourPct === null ? null : limits.fiveHourResetsAt;
  u.weekPct = live(limits.weekPct, limits.weekResetsAt);
  u.weekResetsAt = u.weekPct === null ? null : limits.weekResetsAt;
  u.limitsSource = limits.source;
  u.limitsAt = limits.at;
  const age = Math.round((now - limits.at) / 6e4);
  u.limitsNote = `${limits.source === 'claude-cache' ? 'Da Claude Code' : 'Da una chat Claude'}, ${age <= 1 ? 'adesso' : `${age} min fa`}`;
  return u;
}

export interface UsageMonitorOptions {
  root: string | null;
  node: NodeRunner;
  everyMs?: number;              // default 3 min
  claudeConfig?: string | null;  // null = do not read Claude Code's cache (tests)
  onUsage(u: Usage, spend: Spend): void;
}

export class UsageMonitor {
  private cost: CostSnapshot | null = null;
  private limits: Limits | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private warned = false;

  constructor(private o: UsageMonitorOptions) {}

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.o.everyMs ?? 180e3);
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  get(): Usage { return composeUsage(this.cost, this.freshest()); }

  spend(): Spend {
    const u = this.get();
    return {
      day: romeDay(),
      claude: { dayUsd: this.cost?.costKnown ? this.cost.todayUsd : null, chats: this.cost?.chats ?? [], fiveHourPct: u.fiveHourPct, fiveHourResetsAt: u.fiveHourResetsAt, weekPct: u.weekPct, weekResetsAt: u.weekResetsAt ?? null },
      cursor: { dayUsd: this.cost?.cursorTodayUsd ?? null, chats: [] },
    };
  }

  ingest(msg: unknown): boolean {
    const l = parseRateLimits(msg);
    if (!l) return false;
    this.limits = !this.limits || l.at >= this.limits.at ? mergeLimits(l, this.limits) : mergeLimits(this.limits, l);
    this.o.onUsage(this.get(), this.spend());
    return true;
  }

  private freshest(): Limits | null {
    const cached = this.o.claudeConfig ? readClaudeCache(this.o.claudeConfig) : null;
    if (!cached) return this.limits;
    if (!this.limits) return cached;
    return cached.at > this.limits.at ? mergeLimits(cached, this.limits) : mergeLimits(this.limits, cached);
  }

  async refresh(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const script = this.o.root ? path.join(this.o.root, 'ops', 'tools', 'cost.mjs') : null;
      if (!script || !fs.existsSync(script)) {
        if (!this.warned) log.warn('brain', 'no cost.mjs in this brain: usage without $', { data: { script } });
        this.warned = true;
        this.cost = { todayUsd: 0, chats: [], cursorTodayUsd: null, cursorNote: 'Cursor: costo sconosciuto', costKnown: false, costNote: 'costi non disponibili: il cervello non ha ops/tools/cost.mjs' };
      } else {
        const r = await runNode(this.o.node, script, ['--days', '1', '--json'], this.o.root!, 120e3);
        let j: unknown = null;
        try { j = JSON.parse(r.stdout); } catch { /* below */ }
        if (j) this.cost = parseCost(j, romeDay());
        else {
          log.warn('brain', 'cost.mjs gave no JSON', { data: { code: r.code, error: r.error, stderr: r.stderr.slice(0, 300) } });
          if (!this.cost) this.cost = { todayUsd: 0, chats: [], cursorTodayUsd: null, cursorNote: '', costKnown: false, costNote: 'cost.mjs non ha risposto: riprovo tra 3 minuti' };
        }
      }
      this.o.onUsage(this.get(), this.spend());
    } finally { this.running = false; }
  }
}
