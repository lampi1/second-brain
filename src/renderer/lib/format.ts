// Italian formatting helpers for the UI (costs, models, efforts, states, relative times, folders). Pure functions:
// every tile, the top bar and the palette use them, and the unit tests pin their output (test/unit/format.test.ts).
import type { ChatState, ChatSummary, Effort, Harness, PermissionMode } from '@shared/contract';
import { locale, t, type TextKey } from '../i18n';
import { waitsOnChildren } from './agent-children';

/** THE money format of the app (ADR 0101): the number in the UI's locale, then " $" — 1.84 → "1,84 $" (it),
 *  "1.84 $" (en). Every page uses it (directly, or through brain/lib/format.ts fmt.usd); no Intl currency formatter,
 *  no "$x.xx" template, no "USD" suffix. Two decimals; three for a non-zero amount under 0,10 $ (a run's cost would
 *  otherwise read "0,00 $"); `round` drops the decimals from 10 $ up, for totals over days where cents stop mattering. */
export function formatCost(usd: number, opts: { round?: boolean } = {}): string {
  const v = Number.isFinite(usd) ? usd : 0;
  const a = Math.abs(v);
  const digits = opts.round && a >= 10 ? 0 : 2;
  const max = a > 0 && a < 0.1 && !opts.round ? 3 : digits;
  return `${v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: max })} $`;
}

/** The cost shown on a chat: Cursor does not report a per-chat cost yet, so 0 there reads "costo n/d"; "≈" while part
 *  of it is the running turn's estimate (the real figure replaces it at the end of the turn). */
export function chatCost(c: Pick<ChatSummary, 'harness' | 'costUsd'> & { costKnown?: boolean; costLiveUsd?: number; costLedgerUsd?: number }): string {
  if (c.costLedgerUsd !== undefined) return `≈ ${formatCost(c.costLedgerUsd)}`;
  if (c.costKnown === false || (c.harness === 'cursor' && !c.costUsd)) return t('appText.format.costNa');
  return `${c.costLiveUsd ? '≈ ' : ''}${formatCost(c.costUsd)}`;
}

const FAMILY: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' };

/** "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5", "grok-4.7" → "Grok 4.7", "gpt-5" → "GPT-5". */
export function prettyModel(model: string | null | undefined, harness: Harness = 'claude'): string {
  if (!model) return harness === 'cursor' ? t('appText.format.cursorDefault') : t('appText.format.default');
  const m = model.trim();
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(m);
  if (claude) {
    const fam = FAMILY[claude[1]!.toLowerCase()] ?? cap(claude[1]!);
    return `${fam} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}${claude[4] ? ' 1M' : ''}`;
  }
  if (/^gpt/i.test(m)) return m.toUpperCase().replace(/^GPT-?/, 'GPT-');
  if (m === 'auto') return 'Auto';
  return m.split('-').map(cap).join(' ').replace(/ (\d)/, ' $1');
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export function effortLabel(e: Effort | null | undefined): string | null {
  return e ? t(`appText.format.effort.${e}`) : null;
}

/** The effort a chat runs with, as its engine reports it (effortStatus.effective), else the value the app last sent with
 *  a turn (submitted: what that turn runs with); null when neither is known, never the one only asked for (issue #100). */
export function chatEffort(c: Pick<ChatSummary, 'effortStatus'>): string | null {
  return c.effortStatus?.effective ?? c.effortStatus?.submitted ?? null;
}

/** The model of a chat with the effort it runs with: "Opus 5.5 · low"; just the model when the effort is unknown. A
 *  Cursor variant drops its bracketed parameters then ("gpt-5.6-sol[reasoning_effort=low]" → "GPT-5.6-SOL · low"). */
export function modelWithEffort(c: Pick<ChatSummary, 'model' | 'harness' | 'effortStatus'>): string {
  const effort = chatEffort(c);
  const model = prettyModel(effort ? c.model?.replace(/\[.*\]$/, '') : c.model, c.harness);
  return effort ? `${model} · ${effort}` : model;
}

export const PERMISSION_MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'];
export function permissionLabel(p: PermissionMode): string { return t(`appText.format.perm.${p}`); }
/** Short badge for the sub-line; null for the default mode (nothing to show). */
export function permissionBadge(p: PermissionMode | null | undefined): string | null { return p && p !== 'default' ? t(`appText.format.permShort.${p}`) : null; }

/** Last segment of a path ("C:\\lavoro\\core-web" → "core-web"). */
/** Token counts for people: 820 · 46k · 238k · 1,2M. */
export function tokensShort(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 999_500) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toLocaleString(locale(), { maximumFractionDigits: 1 })}M`;
}

export function folderName(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

export type Tone = 'run' | 'wait' | 'done' | 'idle' | 'err' | 'off' | 'orchestrator';

/** The state pill of a chat: Italian label + color tone. */
export function stateInfo(c: Pick<ChatSummary, 'state' | 'isOrchestrator' | 'pending' | 'queued' | 'closedAt'> & { agentChildren?: ChatSummary['agentChildren']; plan?: ChatSummary['plan'] }): { label: string; tone: Tone } {
  const s: ChatState = c.state;
  if (s === 'waiting' || c.pending > 0) return { label:t('ui.state.waiting'), tone: 'wait' };
  // a Strategist's plan waiting for «Approva e parti» (ADR 0108), once its turn is over
  if (c.plan?.phase === 'proposed' && !c.closedAt && (s === 'idle' || s === 'closed')) return { label:t('ui.state.waiting'), tone: 'wait' };
  // an agent's start or turn waiting for the machine's load (ADR 0036): not finished
  if (c.queued && !c.closedAt && s !== 'running' && s !== 'error') return { label:t('ui.state.queued'), tone: 'off' };
  if (s === 'running') return { label:t('ui.state.running'), tone: 'run' };
  if (s === 'starting') return { label:t('ui.state.starting'), tone: 'off' };
  if (s === 'error') return { label:t('ui.state.error'), tone: 'err' };
  if (s === 'closed') return { label:t('ui.state.closed'), tone: 'off' };
  // its turn is over but a sub-agent it started still works: not finished yet (owner, #69)
  if (waitsOnChildren(c.agentChildren)) return { label:t('ui.state.children'), tone: 'run' };
  return c.isOrchestrator ? { label:t('ui.state.orchestrator'), tone: 'orchestrator' } : { label:t('ui.state.done'), tone: 'done' };
}

/** Why a chat waits in the CPU queue (ADR 0036): the figure over its limit, or the chats ahead of it. */
export function queueReason(q: NonNullable<ChatSummary['queued']>, limits: { cpu: number; ram: number }): string {
  if (q.cpu > limits.cpu) return `CPU ${q.cpu}%`;
  if (q.freeRam < limits.ram) return t('appText.format.freeRam', { pct: q.freeRam });
  return t('appText.format.behindOthers');
}

/** Relative time in Italian, short: "ora", "4 min", "2 h", "3 g". */
export function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return t('appText.format.now');
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  return t('appText.format.days', { n: Math.round(h / 24) });
}

/** "tra 2 h 13 min" for a future reset time. */
export function until(ts: number, now: number): string {
  const m = Math.max(0, Math.round((ts - now) / 60000));
  if (m < 60) return t('appText.format.in', { time: `${m} min` });
  const h = Math.floor(m / 60);
  const r = m % 60;
  return t('appText.format.in', { time: r ? `${h} h ${r} min` : `${h} h` });
}

/** Durations for tool rows and results: 42000 → "0:42", 134000 → "2:14", 3780000 → "1 h 03". */
export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** A chat's real work time (starting or running, never waiting for the user's answers), the running span included;
 *  null when it has not worked yet in this app session. */
export function workTime(c: Pick<ChatSummary, 'workMs' | 'workSince'>, now: number): number | null {
  if (c.workMs === undefined && c.workSince === undefined) return null;
  return (c.workMs ?? 0) + (c.workSince !== undefined ? Math.max(0, now - c.workSince) : 0);
}

/** Minutes for people: "<1 min", "12 min", "1 h 05". */
export function minutes(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return '<1 min';
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** Same calendar day (local time). */
export function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** When a chat closed: "18:42" today, "10/10 18:42" before (the palette's "Chiuse" group). */
export function closedTime(at: number, now: number): string {
  const d = new Date(at);
  const hm = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  return sameDay(at, now) ? hm : `${d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' })} ${hm}`;
}

/** Tool names as people read them: "mcp__sb-browser__browser_click" → "Browser · click", "Edit" → "Modifica". */
export function toolLabel(name: string): string {
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name);
  if (mcp) {
    const server = mcp[1]!;
    const tool = mcp[2]!;
    if (/browser/i.test(server) || /^browser_/.test(tool)) return `Browser · ${tool.replace(/^browser_/, '').replace(/_/g, ' ')}`;
    return `${server.replace(/[-_]/g, ' ')} · ${tool.replace(/_/g, ' ')}`;
  }
  if (/^browser_/.test(name)) return `Browser · ${name.replace(/^browser_/, '').replace(/_/g, ' ')}`;
  const IT: Record<string, TextKey | string> = {
    Edit: 'appText.format.tool.edit', MultiEdit: 'appText.format.tool.edit', Write: 'appText.format.tool.write', Read: 'appText.format.tool.read', Grep: 'appText.format.tool.search', Glob: 'File', Bash: 'Bash', PowerShell: 'PowerShell',
    WebFetch: 'Web', WebSearch: 'appText.format.tool.webSearch', Task: 'appText.format.tool.agent', Agent: 'appText.format.tool.agent', TodoWrite: 'appText.format.tool.todo', AskUserQuestion: 'appText.format.tool.question',
  };
  const k = Object.hasOwn(IT, name) ? IT[name]! : name;
  return k.startsWith('appText.') ? t(k as TextKey) : k;
}

/** Sum of +/− over the diffs of a tool row. */
export function diffTotals(diff: { added: number; removed: number }[] | undefined): { added: number; removed: number } | null {
  if (!diff || diff.length === 0) return null;
  return diff.reduce((a, d) => ({ added: a.added + d.added, removed: a.removed + d.removed }), { added: 0, removed: 0 });
}
