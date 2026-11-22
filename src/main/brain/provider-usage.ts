// Multi-harness plan-usage collectors (Claude, Cursor, Codex, OpenCode, Antigravity).
// Why: the user wants every harness's session (5 h) and weekly/plan limits with reset times in one top-bar popover,
// with pinnable weekly indicators, modelled on Cloudroom (davidondrej/cloudroom, Apache 2.0: provider-claude-code,
// provider-codex, provider-bridge-acp) and CodexBar (OpenCode Go / local auth).
// Security (AGENTS.md rule 2): local CLI tokens are read in memory only in the main process, sent only to each
// vendor's own HTTPS usage endpoint, never logged, never stored and never sent to the renderer.
// Used by brain/usage.ts (UsageMonitor); pure normalizers are unit-tested in test/unit/brain/provider-usage.test.ts.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type * as NodeSqlite from 'node:sqlite';
import { promisify } from 'node:util';
import type { Harness, HarnessUsage, HarnessUsageWindow } from '../../shared/contract';
import { log } from '../log';
import { opencodeLogTail, readOpencodeLog, opencodeState } from '../agents/credits';
import { cliArgv, engineAllowed, resolveAcp, type CliCommand } from '../chats/cli';
import { channel } from '../engines/model-probe';

const execFileAsync = promisify(execFile);

const FETCH_TIMEOUT_MS = 12_000;
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CURSOR_DASHBOARD_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService';
const OPENCODE_GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const ANTIGRAVITY_ACP_TIMEOUT_MS = 8_000;
const ANTIGRAVITY_TIER_TTL_MS = 60 * 60_000;
const ANTIGRAVITY_RETRY_MS = 10 * 60_000;

export const USAGE_HARNESS_ORDER: readonly { id: Harness; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'antigravity', label: 'Antigravity' },
];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clampPct = (n: number): number => Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;

function parseResetMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string' && v.trim()) {
    if (/^\d+$/.test(v.trim())) {
      const n = Number(v.trim());
      return Number.isSafeInteger(n) ? (n < 1e12 ? n * 1000 : n) : null;
    }
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function decodeJwtPayload(token: string): Obj | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return isObj(parsed) ? parsed : null;
  } catch { return null; }
}

function capWord(s: string | null): string | null {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
}

/** Claude's plan as Anthropic names it: "Max 20x", "Max 5x", else the subscription type ("Pro", "Max"). */
function claudePlanLabel(sub: string | null, tier: string | null): string | null {
  return tier?.endsWith('max_20x') ? 'Max 20x' : tier?.endsWith('max_5x') ? 'Max 5x' : capWord(sub);
}

// ── Pure normalizers (unit-tested without network or processes) ────────────────────────────────────────────────────

export function normalizeClaudeOAuthUsage(
  raw: unknown,
  meta: { subscriptionType?: string | null; rateLimitTier?: string | null; email?: string | null } = {},
  now = Date.now(),
): HarnessUsage {
  const planLabel = claudePlanLabel(meta.subscriptionType ?? null, meta.rateLimitTier ?? null);
  const email = meta.email ?? null;
  if (!isObj(raw)) {
    return { harness: 'claude', label: 'Claude', status: 'error', planLabel, accountEmail: email, windows: [], message: 'Risposta uso Claude non valida.', source: 'oauth', at: now };
  }
  const windows: HarnessUsageWindow[] = [];
  const pushWin = (w: unknown, kind: HarnessUsageWindow['kind'], label: string) => {
    if (!isObj(w)) return;
    const u = num(w.utilization);
    if (u === null) return;
    windows.push({ kind, label, usedPercent: clampPct(u), resetsAt: parseResetMs(w.resets_at) });
  };
  pushWin(raw.five_hour, 'five-hour', '5h');
  pushWin(raw.seven_day, 'weekly', '7g');
  // Model-scoped weekly windows (Cloudroom: limits[].kind === 'weekly_scoped')
  const seenModels = new Set<string>();
  if (Array.isArray(raw.limits)) {
    for (const item of raw.limits) {
      if (!isObj(item) || item.kind !== 'weekly_scoped') continue;
      const scope = isObj(item.scope) ? item.scope : null;
      const modelObj = scope && isObj(scope.model) ? scope.model : null;
      const modelName = str(modelObj?.display_name);
      const pct = num(item.percent);
      if (!modelName || pct === null || seenModels.has(modelName.toLowerCase())) continue;
      seenModels.add(modelName.toLowerCase());
      windows.push({ kind: 'weekly', label: `7g · ${modelName}`, model: modelName.toLowerCase(), usedPercent: clampPct(pct), resetsAt: parseResetMs(item.resets_at) });
    }
  }
  let creditsDetail: string | null = null;
  if (isObj(raw.extra_usage) && raw.extra_usage.is_enabled === true && windows.some(w => w.usedPercent >= 100)) {
    const used = num(raw.extra_usage.used_credits);
    const limit = num(raw.extra_usage.monthly_limit);
    creditsDetail = used === null ? 'Crediti extra attivi' : limit === null ? `$${(used / 100).toFixed(2)} spesi` : `$${(used / 100).toFixed(2)} / $${(limit / 100).toFixed(2)}`;
  }
  return { harness: 'claude', label: 'Claude', status: 'ok', planLabel, accountEmail: email, windows, message: null, ...(creditsDetail ? { creditsDetail } : {}), source: 'oauth', at: now };
}

export function normalizeCursorUsage(rawUsage: unknown, rawPlan: unknown = null, email: string | null = null, now = Date.now()): HarnessUsage {
  const planObj = isObj(rawPlan) && isObj(rawPlan.planInfo) ? rawPlan.planInfo : null;
  const planLabel = str(planObj?.planName);
  if (!isObj(rawUsage)) {
    return { harness: 'cursor', label: 'Cursor', status: 'error', planLabel, accountEmail: email, windows: [], message: 'Risposta uso Cursor non valida.', source: 'dashboard', at: now };
  }
  const resetsAt = parseResetMs(rawUsage.billingCycleEnd);
  const windows: HarnessUsageWindow[] = [];
  const planUsage = isObj(rawUsage.planUsage) ? rawUsage.planUsage : null;
  if (planUsage) {
    const auto = num(planUsage.autoPercentUsed);
    const api = num(planUsage.apiPercentUsed);
    const total = num(planUsage.totalPercentUsed) ?? 0;
    windows.push({ kind: 'plan', label: 'Piano', usedPercent: clampPct(auto !== null && api !== null ? auto : total), resetsAt });
    if (auto !== null && api !== null) {
      windows.push({ kind: 'plan', label: 'Modelli 3P', model: '3p', usedPercent: clampPct(api), resetsAt });
    }
  }
  const spend = isObj(rawUsage.spendLimitUsage) ? rawUsage.spendLimitUsage : null;
  if (spend) {
    const pair = num(spend.overallLimit) !== null ? { limit: num(spend.overallLimit)!, used: num(spend.overallUsed) ?? 0 }
      : num(spend.individualLimit) !== null ? { limit: num(spend.individualLimit)!, used: num(spend.individualUsed) ?? 0 }
      : num(spend.pooledLimit) !== null ? { limit: num(spend.pooledLimit)!, used: num(spend.pooledUsed) ?? 0 }
      : null;
    if (pair && pair.limit > 0) {
      windows.push({ kind: 'spend', label: 'On-demand', usedPercent: clampPct((pair.used / pair.limit) * 100), resetsAt, cost: { usedUsdCents: pair.used, limitUsdCents: pair.limit } });
    }
  }
  return { harness: 'cursor', label: 'Cursor', status: 'ok', planLabel, accountEmail: email, windows, message: windows.length ? null : 'Nessun limite riportato per questo piano.', source: 'dashboard', at: now };
}

const CODEX_PLANS: Record<string, string> = {
  free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro', team: 'Team', business: 'Business', education: 'Education', edu: 'Education', enterprise: 'Enterprise',
};

export function normalizeCodexUsage(raw: unknown, email: string | null = null, now = Date.now(), target: { harness: Harness; label: string; planPrefix?: string } = { harness: 'codex', label: 'Codex' }): HarnessUsage {
  if (!isObj(raw)) {
    return { harness: target.harness, label: target.label, status: 'error', planLabel: null, accountEmail: email, windows: [], message: `Risposta uso ${target.label} non valida.`, source: 'oauth', at: now };
  }
  const rawPlan = str(raw.plan_type);
  const basePlan = rawPlan ? (CODEX_PLANS[rawPlan.toLowerCase()] ?? capWord(rawPlan)) : null;
  const planLabel = target.planPrefix ? (basePlan ? `${target.planPrefix} · ${basePlan}` : target.planPrefix) : basePlan;
  const rl = isObj(raw.rate_limit) ? raw.rate_limit : null;
  const windows: HarnessUsageWindow[] = [];
  const pushWin = (w: unknown, fallbackKind: 'five-hour' | 'weekly', fallbackLabel: string) => {
    if (!isObj(w)) return;
    const pct = num(w.used_percent);
    if (pct === null) return;
    const secs = num(w.limit_window_seconds);
    const kind: HarnessUsageWindow['kind'] = secs === 18_000 ? 'five-hour' : secs === 86_400 ? 'daily' : secs === 604_800 ? 'weekly' : fallbackKind;
    const label = kind === 'five-hour' ? '5h' : kind === 'weekly' ? '7g' : kind === 'daily' ? '24h' : fallbackLabel;
    windows.push({ kind, label, usedPercent: clampPct(pct), resetsAt: parseResetMs(w.reset_at) });
  };
  pushWin(rl?.primary_window, 'five-hour', '5h');
  pushWin(rl?.secondary_window, 'weekly', '7g');
  let creditsDetail: string | null = null;
  const credits = isObj(raw.credits) ? raw.credits : null;
  if (credits?.has_credits === true && credits.unlimited !== true && (rl?.limit_reached === true || windows.some(w => w.usedPercent >= 100))) {
    const bal = credits.balance;
    creditsDetail = bal != null && String(bal).trim() ? `${bal} crediti rimasti` : 'Crediti extra attivi';
  }
  return { harness: target.harness, label: target.label, status: 'ok', planLabel, accountEmail: email, windows, message: windows.length ? null : 'Nessun limite riportato per questo piano.', ...(creditsDetail ? { creditsDetail } : {}), source: 'oauth', at: now };
}

/** Codex app-server `account/rateLimits/updated` notification → HarnessUsage. */
export function normalizeCodexNotification(params: unknown, now = Date.now()): HarnessUsage | null {
  if (!isObj(params)) return null;
  const rl = isObj(params.rateLimits) ? params.rateLimits : isObj(params.rate_limits) ? params.rate_limits : params;
  const primary = isObj(rl.primary) ? rl.primary : isObj(rl.primaryWindow) ? rl.primaryWindow : null;
  const secondary = isObj(rl.secondary) ? rl.secondary : isObj(rl.secondaryWindow) ? rl.secondaryWindow : null;
  const windows: HarnessUsageWindow[] = [];
  const push = (w: Obj | null, fallbackKind: 'five-hour' | 'weekly', fallbackLabel: string) => {
    if (!w) return;
    const pct = num(w.usedPercent ?? w.used_percent);
    if (pct === null) return;
    const mins = num(w.windowDurationMins ?? w.window_duration_mins);
    const kind: HarnessUsageWindow['kind'] = mins === 300 ? 'five-hour' : mins === 10080 ? 'weekly' : mins === 1440 ? 'daily' : fallbackKind;
    const label = kind === 'five-hour' ? '5h' : kind === 'weekly' ? '7g' : kind === 'daily' ? '24h' : fallbackLabel;
    windows.push({ kind, label, usedPercent: clampPct(pct), resetsAt: parseResetMs(w.resetsAt ?? w.resets_at ?? w.resetAt ?? w.reset_at) });
  };
  push(primary, 'five-hour', '5h');
  push(secondary, 'weekly', '7g');
  if (!windows.length) return null;
  const plan = str(rl.planType ?? rl.plan_type);
  return { harness: 'codex', label: 'Codex', status: 'ok', planLabel: plan ? (CODEX_PLANS[plan.toLowerCase()] ?? capWord(plan)) : null, accountEmail: null, windows, message: null, source: 'stream', at: now };
}

export function normalizeOpenCodeGoUsage(raw: unknown, now = Date.now()): HarnessUsage {
  if (!isObj(raw)) {
    return { harness: 'opencode', label: 'OpenCode', status: 'error', planLabel: 'Go', accountEmail: null, windows: [], message: 'Risposta uso OpenCode Go non valida.', source: 'oauth', at: now };
  }
  const windows: HarnessUsageWindow[] = [];
  const push = (w: unknown, kind: HarnessUsageWindow['kind'], label: string) => {
    if (!isObj(w)) return;
    const pct = num(w.usagePercent ?? w.usedPercent ?? w.used_percent);
    if (pct === null) return;
    const resetInSec = num(w.resetInSec ?? w.reset_in_sec);
    const resetsAt = parseResetMs(w.resetsAt ?? w.resets_at) ?? (resetInSec !== null && resetInSec > 0 ? now + resetInSec * 1000 : null);
    windows.push({ kind, label, usedPercent: clampPct(pct), resetsAt });
  };
  push(raw.rollingUsage ?? raw.fiveHour ?? raw.five_hour, 'five-hour', '5h');
  push(raw.weeklyUsage ?? raw.weekly ?? raw.seven_day, 'weekly', '7g');
  push(raw.monthlyUsage ?? raw.monthly, 'plan', 'Mese');
  return { harness: 'opencode', label: 'OpenCode', status: 'ok', planLabel: 'Go', accountEmail: null, windows, message: windows.length ? null : 'Nessun limite riportato per OpenCode Go.', source: 'oauth', at: now };
}

export function normalizeAntigravityUsage(raw: unknown, planTierFallback: string | null = null, now = Date.now()): HarnessUsage {
  if (!isObj(raw)) {
    return { harness: 'antigravity', label: 'Antigravity', status: 'error', planLabel: planTierFallback, accountEmail: null, windows: [], message: 'Risposta uso Antigravity non valida.', source: 'cli', at: now };
  }
  const email = str(raw.email);
  const planLabel = str(raw.plan_tier) ?? planTierFallback;
  const quota = isObj(raw.quota) ? raw.quota : {};
  const windows: HarnessUsageWindow[] = [];
  const pushBucket = (key: string, kind: HarnessUsageWindow['kind'], label: string, model?: string): boolean => {
    const b = quota[key];
    if (!isObj(b) || b.disabled === true) return false;
    const rem = num(b.remaining_fraction);
    if (rem === null) return false;
    const resetIn = num(b.reset_in_seconds);
    const resetsAt = parseResetMs(b.reset_time) ?? (resetIn !== null && resetIn > 0 ? now + resetIn * 1000 : null);
    windows.push({ kind, label, usedPercent: clampPct((1 - rem) * 100), resetsAt, ...(model ? { model } : {}) });
    return true;
  };
  const has5h = pushBucket('gemini-5h', 'five-hour', '5h');
  const has7d = pushBucket('gemini-weekly', 'weekly', '7g');
  pushBucket('3p-5h', 'five-hour', '5h · 3P', '3p');
  pushBucket('3p-weekly', 'weekly', '7g · 3P', '3p');
  if (!has5h && !has7d) {
    for (const [k, b] of Object.entries(quota)) {
      if (k === '3p-5h' || k === '3p-weekly' || !isObj(b) || b.disabled === true) continue;
      const rem = num(b.remaining_fraction);
      if (rem === null) continue;
      const resetIn = num(b.reset_in_seconds);
      windows.push({ kind: 'custom', label: k, usedPercent: clampPct((1 - rem) * 100), resetsAt: parseResetMs(b.reset_time) ?? (resetIn !== null && resetIn > 0 ? now + resetIn * 1000 : null) });
    }
  }
  return { harness: 'antigravity', label: 'Antigravity', status: 'ok', planLabel, accountEmail: email, windows, message: windows.length ? null : 'Nessuna finestra di quota riportata.', source: 'cli', at: now };
}

// ── Local credential readers (in-memory only, never logged) ────────────────────────────────────────────────────────

export interface ProviderCollectorEnv {
  home?: string;
  appData?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  fetchFn?: typeof fetch;
  now?: () => number;
}

function readJsonFile(file: string): Obj | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isObj(parsed) ? parsed : null;
  } catch { return null; }
}

function claudeCredsPath(home: string, env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, '.credentials.json') : path.join(home, '.claude', '.credentials.json');
}

function claudeAccountPath(home: string, env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(home, '.claude.json');
}

function cursorAuthPath(home: string, appData: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (platform === 'win32') return path.join(appData, 'Cursor', 'auth.json');
  if (platform === 'darwin') return path.join(home, '.cursor', 'auth.json');
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'cursor', 'auth.json');
}

function cursorStateDbPath(home: string, appData: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (platform === 'win32') return path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

function readCursorStateDb(dbPath: string): { accessToken: string | null; email: string | null } {
  if (!fs.existsSync(dbPath)) return { accessToken: null, email: null };
  let db: NodeSqlite.DatabaseSync | null = null;
  try {
    // loaded at first use, like app-db.ts: a runtime without node:sqlite only loses the state.vscdb fallback
    const m = process.getBuiltinModule?.('node:sqlite') as typeof NodeSqlite | undefined;
    if (!m?.DatabaseSync) return { accessToken: null, email: null };
    db = new m.DatabaseSync(dbPath, { open: true, readOnly: true });
    const getVal = (k: string) => {
      const row = db!.prepare('SELECT value FROM ItemTable WHERE key = ?').get(k) as { value?: unknown } | undefined;
      return str(row?.value);
    };
    return { accessToken: getVal('cursorAuth/accessToken'), email: getVal('cursorAuth/cachedEmail') };
  } catch {
    return { accessToken: null, email: null };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

function codexAuthPath(home: string, env: NodeJS.ProcessEnv): string {
  return path.join(env.CODEX_HOME?.trim() || path.join(home, '.codex'), 'auth.json');
}

function opencodeAuthPath(home: string, env: NodeJS.ProcessEnv): string {
  return path.join(env.XDG_DATA_HOME?.trim() || path.join(home, '.local', 'share'), 'opencode', 'auth.json');
}

// ── Per-provider collectors ────────────────────────────────────────────────────────────────────────────────────────

export async function collectClaudeUsage(o: ProviderCollectorEnv = {}): Promise<HarnessUsage> {
  const home = o.home ?? os.homedir(), env = o.env ?? process.env, fetchFn = o.fetchFn ?? fetch, now = (o.now ?? Date.now)();
  const credsRaw = readJsonFile(claudeCredsPath(home, env));
  const oauth = credsRaw && isObj(credsRaw.claudeAiOauth) ? credsRaw.claudeAiOauth : null;
  const accessToken = str(oauth?.accessToken);
  const accountRaw = readJsonFile(claudeAccountPath(home, env));
  const oauthAccount = accountRaw && isObj(accountRaw.oauthAccount) ? accountRaw.oauthAccount : null;
  const email = str(oauthAccount?.emailAddress);
  const sub = str(oauth?.subscriptionType);
  const tier = str(oauth?.rateLimitTier);
  const planLabel = claudePlanLabel(sub, tier);
  if (!accessToken || oauth?.refreshToken === '') {
    return { harness: 'claude', label: 'Claude', status: 'unauthenticated', planLabel: null, accountEmail: email, windows: [], message: 'Non connesso: accedi da Claude Code.', source: 'none', at: now };
  }
  const expiresAt = num(oauth?.expiresAt);
  const hasRefresh = !!str(oauth?.refreshToken);
  const refreshExp = num(oauth?.refreshTokenExpiresAt);
  const canRenew = hasRefresh && (refreshExp === null || now < refreshExp);
  if (expiresAt !== null && now >= expiresAt) {
    return canRenew
      ? { harness: 'claude', label: 'Claude', status: 'error', planLabel, accountEmail: email, windows: [], message: 'Token in rinnovo alla prossima risposta Claude.', source: 'oauth', at: now }
      : { harness: 'claude', label: 'Claude', status: 'expired', planLabel, accountEmail: email, windows: [], message: 'Sessione Claude scaduta.', source: 'oauth', at: now };
  }
  try {
    const res = await fetchFn(CLAUDE_USAGE_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json', 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'claude-code/2.1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 401) {
      return { harness: 'claude', label: 'Claude', status: canRenew ? 'error' : 'expired', planLabel, accountEmail: email, windows: [], message: canRenew ? 'Token in rinnovo alla prossima risposta Claude.' : 'Sessione Claude scaduta.', source: 'oauth', at: now };
    }
    if (res.status === 429) {
      return { harness: 'claude', label: 'Claude', status: 'error', planLabel, accountEmail: email, windows: [], message: 'Controllo temporaneamente rallentato da Anthropic (429).', source: 'oauth', at: now };
    }
    if (!res.ok) {
      return { harness: 'claude', label: 'Claude', status: 'error', planLabel, accountEmail: email, windows: [], message: `Lettura uso Claude fallita (HTTP ${res.status}).`, source: 'oauth', at: now };
    }
    return normalizeClaudeOAuthUsage(await res.json(), { subscriptionType: sub, rateLimitTier: tier, email }, now);
  } catch (e) {
    log.debug('brain', 'claude oauth usage fetch failed', { data: { error: e instanceof Error ? e.message : String(e) } });
    return { harness: 'claude', label: 'Claude', status: 'error', planLabel, accountEmail: email, windows: [], message: 'Impossibile leggere i limiti Claude ora.', source: 'oauth', at: now };
  }
}

export async function collectCursorUsage(o: ProviderCollectorEnv = {}): Promise<HarnessUsage> {
  const home = o.home ?? os.homedir(), env = o.env ?? process.env, platform = o.platform ?? process.platform;
  const appData = o.appData ?? env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
  const fetchFn = o.fetchFn ?? fetch, now = (o.now ?? Date.now)();
  const authJson = readJsonFile(cursorAuthPath(home, appData, env, platform));
  const dbInfo = readCursorStateDb(cursorStateDbPath(home, appData, env, platform));
  const accessToken = str(authJson?.accessToken) ?? dbInfo.accessToken;
  const email = dbInfo.email;
  if (!accessToken) {
    return { harness: 'cursor', label: 'Cursor', status: 'unauthenticated', planLabel: null, accountEmail: email, windows: [], message: 'Non connesso: accedi a Cursor CLI o app.', source: 'none', at: now };
  }
  const post = (method: string) => fetchFn(`${CURSOR_DASHBOARD_URL}/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'x-cursor-client-type': 'cli', 'x-cursor-client-version': 'cli-second-brain' },
    body: '{}',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  try {
    const [usageRes, planRes] = await Promise.all([post('GetCurrentPeriodUsage'), post('GetPlanInfo')]);
    if (usageRes.status === 401 || planRes.status === 401) {
      return { harness: 'cursor', label: 'Cursor', status: 'expired', planLabel: null, accountEmail: email, windows: [], message: 'Sessione Cursor scaduta.', source: 'dashboard', at: now };
    }
    if (!usageRes.ok) {
      return { harness: 'cursor', label: 'Cursor', status: 'error', planLabel: null, accountEmail: email, windows: [], message: `Lettura uso Cursor fallita (HTTP ${usageRes.status}).`, source: 'dashboard', at: now };
    }
    const rawUsage: unknown = await usageRes.json();
    const rawPlan: unknown = planRes.ok ? await planRes.json().catch(() => null) : null;
    return normalizeCursorUsage(rawUsage, rawPlan, email, now);
  } catch (e) {
    log.debug('brain', 'cursor dashboard usage fetch failed', { data: { error: e instanceof Error ? e.message : String(e) } });
    return { harness: 'cursor', label: 'Cursor', status: 'error', planLabel: null, accountEmail: email, windows: [], message: 'Impossibile leggere i limiti Cursor ora.', source: 'dashboard', at: now };
  }
}

async function fetchChatGptUsage(
  accessToken: string,
  accountId: string,
  email: string | null,
  fetchFn: typeof fetch,
  now: number,
  target: { harness: Harness; label: string; planPrefix?: string },
): Promise<HarnessUsage> {
  try {
    const res = await fetchFn(CODEX_USAGE_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, 'chatgpt-account-id': accountId, Accept: 'application/json', 'User-Agent': 'second-brain-usage' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 401) {
      return { harness: target.harness, label: target.label, status: 'expired', planLabel: null, accountEmail: email, windows: [], message: `Sessione ${target.label} scaduta.`, source: 'oauth', at: now };
    }
    if (!res.ok) {
      return { harness: target.harness, label: target.label, status: 'error', planLabel: null, accountEmail: email, windows: [], message: `Lettura uso ${target.label} fallita (HTTP ${res.status}).`, source: 'oauth', at: now };
    }
    return normalizeCodexUsage(await res.json(), email, now, target);
  } catch (e) {
    log.debug('brain', 'chatgpt usage fetch failed', { data: { harness: target.harness, error: e instanceof Error ? e.message : String(e) } });
    return { harness: target.harness, label: target.label, status: 'error', planLabel: null, accountEmail: email, windows: [], message: `Impossibile leggere i limiti ${target.label} ora.`, source: 'oauth', at: now };
  }
}

export async function collectCodexUsage(o: ProviderCollectorEnv = {}): Promise<HarnessUsage> {
  const home = o.home ?? os.homedir(), env = o.env ?? process.env, fetchFn = o.fetchFn ?? fetch, now = (o.now ?? Date.now)();
  const raw = readJsonFile(codexAuthPath(home, env));
  if (!raw) {
    return { harness: 'codex', label: 'Codex', status: 'unauthenticated', planLabel: null, accountEmail: null, windows: [], message: 'Non connesso: esegui codex login.', source: 'none', at: now };
  }
  const authMode = str(raw.auth_mode);
  if (authMode === 'apikey' || authMode === 'apiKey' || (authMode === null && str(raw.OPENAI_API_KEY))) {
    return { harness: 'codex', label: 'Codex', status: 'unavailable', planLabel: 'API key', accountEmail: null, windows: [], message: 'Autenticato con API key: nessun limite di abbonamento.', source: 'none', at: now };
  }
  const tokens = isObj(raw.tokens) ? raw.tokens : null;
  const accessToken = str(tokens?.access_token);
  if (!accessToken) {
    return { harness: 'codex', label: 'Codex', status: 'unauthenticated', planLabel: null, accountEmail: null, windows: [], message: 'Non connesso: esegui codex login.', source: 'none', at: now };
  }
  const payload = decodeJwtPayload(accessToken);
  const authClaims = payload && isObj(payload['https://api.openai.com/auth']) ? payload['https://api.openai.com/auth'] : null;
  const profClaims = payload && isObj(payload['https://api.openai.com/profile']) ? payload['https://api.openai.com/profile'] : null;
  const idToken = str(tokens?.id_token);
  const idPayload = idToken ? decodeJwtPayload(idToken) : null;
  const idAuth = idPayload && isObj(idPayload['https://api.openai.com/auth']) ? idPayload['https://api.openai.com/auth'] : null;
  const accountId = str(tokens?.account_id) ?? str(authClaims?.chatgpt_account_id) ?? str(idAuth?.chatgpt_account_id);
  const email = str(payload?.email) ?? str(profClaims?.email);
  const exp = num(payload?.exp);
  if (!accountId) {
    return { harness: 'codex', label: 'Codex', status: 'unauthenticated', planLabel: null, accountEmail: email, windows: [], message: 'Account ChatGPT non trovato in auth.json.', source: 'none', at: now };
  }
  if (exp !== null && now >= exp * 1000) {
    const canRenew = !!str(tokens?.refresh_token);
    return { harness: 'codex', label: 'Codex', status: canRenew ? 'error' : 'expired', planLabel: null, accountEmail: email, windows: [], message: canRenew ? 'Token in rinnovo alla prossima risposta Codex.' : 'Sessione Codex scaduta.', source: 'oauth', at: now };
  }
  return fetchChatGptUsage(accessToken, accountId, email, fetchFn, now, { harness: 'codex', label: 'Codex' });
}

export async function collectOpenCodeUsage(o: ProviderCollectorEnv = {}): Promise<HarnessUsage> {
  const home = o.home ?? os.homedir(), env = o.env ?? process.env, fetchFn = o.fetchFn ?? fetch, now = (o.now ?? Date.now)();
  const auth = readJsonFile(opencodeAuthPath(home, env));
  // 1) OpenCode Go / Zen API key (CodexBar strategy)
  const ocEntry = auth && isObj(auth.opencode) ? auth.opencode : null;
  const goKey = str(env.OPENCODE_API_KEY) ?? str(ocEntry?.key) ?? str(ocEntry?.apiKey) ?? str(ocEntry?.access);
  if (goKey) {
    try {
      const res = await fetchFn(OPENCODE_GO_USAGE_URL, {
        headers: { Authorization: `Bearer ${goKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) return normalizeOpenCodeGoUsage(await res.json(), now);
    } catch { /* fall through to other providers */ }
  }
  // 2) OpenAI ChatGPT OAuth inside OpenCode's auth.json (common when using Codex/ChatGPT subscription via OpenCode)
  const openai = auth && isObj(auth.openai) ? auth.openai : null;
  const oaAccess = str(openai?.access);
  const oaAccount = str(openai?.accountId);
  if (oaAccess && oaAccount) {
    const exp = num(openai?.expires);
    const payload = decodeJwtPayload(oaAccess);
    const email = str(payload?.email) ?? (payload && isObj(payload['https://api.openai.com/profile']) ? str(payload['https://api.openai.com/profile'].email) : null);
    if (exp !== null && now >= exp) {
      return { harness: 'opencode', label: 'OpenCode', status: str(openai?.refresh) ? 'error' : 'expired', planLabel: 'OpenAI', accountEmail: email, windows: [], message: str(openai?.refresh) ? 'Token OpenAI in rinnovo alla prossima risposta OpenCode.' : 'Sessione OpenAI in OpenCode scaduta.', source: 'oauth', at: now };
    }
    return fetchChatGptUsage(oaAccess, oaAccount, email, fetchFn, now, { harness: 'opencode', label: 'OpenCode', planPrefix: 'OpenAI' });
  }
  // 3) Local OpenCode log status (exhausted vs ok)
  const text = await opencodeLogTail(home, 128 * 1024);
  if (text) {
    try {
      const facts = readOpencodeLog(text);
      for (const [prov, f] of facts) {
        const st = opencodeState(`opencode:${prov}`, f, now);
        if (st?.status === 'exhausted') {
          return { harness: 'opencode', label: 'OpenCode', status: 'ok', planLabel: capWord(prov), accountEmail: null, windows: [{ kind: 'custom', label: 'Limite', usedPercent: 100, resetsAt: null }], message: st.note ?? 'Limite raggiunto nel log di OpenCode.', source: 'log', at: now };
        }
      }
    } catch { /* ignore */ }
  }
  const providers = auth ? Object.keys(auth) : [];
  return {
    harness: 'opencode', label: 'OpenCode', status: providers.length ? 'unavailable' : 'unauthenticated',
    planLabel: providers.length ? providers.map(p => capWord(p)).join(', ') : null,
    accountEmail: null, windows: [],
    message: providers.length ? 'Nessun abbonamento con quote leggibili (provider BYOK/API).' : 'Non connesso: esegui opencode auth login.',
    source: 'none', at: now,
  };
}

let agyTierCache: { tier: string | null; at: number; ttl: number } | null = null;

/** The tier from `agy acp` session/new (_meta.antigravity.tier), as Cloudroom reads it. The same resolution and the
 *  same JSON-lines channel the model listing uses (engines/model-probe.ts): stdin errors handled, the process tree
 *  ended on close. A tier is kept for an hour; no answer (timeout, early exit) only for ANTIGRAVITY_RETRY_MS. */
async function probeAntigravityAcpTier(cmd: CliCommand, now: number): Promise<{ signedIn: boolean; tier: string | null }> {
  if (agyTierCache && now - agyTierCache.at < agyTierCache.ttl) return { signedIn: true, tier: agyTierCache.tier };
  const env = { ...cmd.env, AGY_CLI_DISABLE_AUTO_UPDATE: '1' };
  const models = cliArgv({ ...cmd, env }, ['models']);
  try {
    await execFileAsync(models.command, models.args, { timeout: 6_000, env: models.env, windowsHide: true, windowsVerbatimArguments: models.verbatim });
  } catch (e) {
    const out = `${(e as { stdout?: string }).stdout ?? ''}${(e as { stderr?: string }).stderr ?? ''}`;
    if (/please sign in/i.test(out)) return { signedIn: false, tier: null };
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw e;
  }
  const ch = channel(cliArgv({ ...cmd, env }, ['acp', '--disable-telemetry']), os.tmpdir());
  let tier: string | null = null;
  if (!('error' in ch)) {
    try {
      ch.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
      ch.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: os.tmpdir(), mcpServers: [] } });
      const msg = await ch.reply(m => m.id === 2 && isObj(m.result), ANTIGRAVITY_ACP_TIMEOUT_MS);
      const result = isObj(msg.result) ? msg.result : null;
      const meta = result && isObj(result._meta) ? result._meta : null;
      const ag = meta && isObj(meta.antigravity) ? meta.antigravity : null;
      tier = ag && isObj(ag.tier) ? str(ag.tier.name) : null;
    } catch { /* no answer: tier unknown */ } finally { ch.close(); }
  }
  agyTierCache = { tier, at: now, ttl: tier ? ANTIGRAVITY_TIER_TTL_MS : ANTIGRAVITY_RETRY_MS };
  return { signedIn: true, tier };
}

export async function collectAntigravityUsage(o: ProviderCollectorEnv = {}): Promise<HarnessUsage> {
  const env = o.env ?? process.env, platform = o.platform ?? process.platform, now = (o.now ?? Date.now)();
  const notInstalled: HarnessUsage = { harness: 'antigravity', label: 'Antigravity', status: 'not_installed', planLabel: null, accountEmail: null, windows: [], message: 'Antigravity CLI (agy) non trovato.', source: 'none', at: now };
  const cmd = resolveAcp('antigravity', 'agy', null, env);
  if (!cmd) return notInstalled;
  if (!engineAllowed(cmd, env)) return { ...notInstalled, status: 'unavailable', message: 'Nei test il motore reale non parte.' };
  try {
    const { signedIn, tier } = await probeAntigravityAcpTier(cmd, now);
    if (!signedIn) {
      return { harness: 'antigravity', label: 'Antigravity', status: 'unauthenticated', planLabel: null, accountEmail: null, windows: [], message: 'Non connesso: esegui agy acp --login.', source: 'cli', at: now };
    }
    // Cloudroom's statusLine PTY probe is POSIX-only (antigravity-status.ts skips win32). On Windows, agy does not
    // yet expose quota fractions without a PTY, so we report the detected tier honestly without faking 0%.
    return {
      harness: 'antigravity', label: 'Antigravity', status: 'unavailable', planLabel: tier, accountEmail: null, windows: [],
      message: platform === 'win32'
        ? 'Quote 5h/7g non esposte da agy CLI su Windows (solo piano rilevato).'
        : 'Nessuna finestra di quota riportata da agy.',
      source: 'cli', at: now,
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return notInstalled;
    return { harness: 'antigravity', label: 'Antigravity', status: 'error', planLabel: null, accountEmail: null, windows: [], message: 'Impossibile leggere lo stato Antigravity.', source: 'cli', at: now };
  }
}

/** Collects plan usage for all 5 harnesses in parallel. Never throws; each harness isolates its own errors. */
export async function collectAllProviderUsage(o: ProviderCollectorEnv = {}): Promise<HarnessUsage[]> {
  const results = await Promise.all([
    collectClaudeUsage(o),
    collectCursorUsage(o),
    collectCodexUsage(o),
    collectOpenCodeUsage(o),
    collectAntigravityUsage(o),
  ]);
  return results;
}
