// Italian formatting helpers for the UI (costs, models, efforts, states, relative times, folders). Pure functions:
// every tile, the top bar and the palette use them, and the unit tests pin their output (test/unit/format.test.ts).
import type { ChatState, ChatSummary, Effort, Harness, PermissionMode } from '@shared/contract';

const money = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1.84 → "1,84 $" (the mockups' style: Italian decimals, dollar after). */
export function formatCost(usd: number): string {
  return `${money.format(Number.isFinite(usd) ? usd : 0)} $`;
}

/** The cost shown on a chat: Cursor does not report a per-chat cost yet, so 0 there reads "costo n/d". */
export function chatCost(c: Pick<ChatSummary, 'harness' | 'costUsd'> & { costKnown?: boolean }): string {
  if (c.costKnown === false || (c.harness === 'cursor' && !c.costUsd)) return 'costo n/d';
  return formatCost(c.costUsd);
}

const FAMILY: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' };

/** "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5", "grok-4.7" → "Grok 4.7", "gpt-5" → "GPT-5". */
export function prettyModel(model: string | null | undefined, harness: Harness = 'claude'): string {
  if (!model) return harness === 'cursor' ? 'Cursor (predefinito)' : 'predefinito';
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
const EFFORT_IT: Record<Effort, string> = { low: 'bassa', medium: 'media', high: 'alta', xhigh: 'molto alta', max: 'massima' };
export function effortLabel(e: Effort | null | undefined): string | null {
  return e ? EFFORT_IT[e] : null;
}

export const PERMISSION_MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'];
const PERM_IT: Record<PermissionMode, string> = {
  default: 'Chiedi ogni volta', acceptEdits: 'Accetta le modifiche', auto: 'Automatico', plan: 'Solo piano', bypassPermissions: 'Senza permessi',
};
const PERM_SHORT: Record<PermissionMode, string | null> = { default: null, acceptEdits: 'modifiche ok', auto: 'auto', plan: 'piano', bypassPermissions: 'senza permessi' };
export function permissionLabel(p: PermissionMode): string { return PERM_IT[p]; }
/** Short badge for the sub-line; null for the default mode (nothing to show). */
export function permissionBadge(p: PermissionMode | null | undefined): string | null { return p ? PERM_SHORT[p] : null; }

/** Last segment of a path ("C:\\lavoro\\core-web" → "core-web"). */
export function folderName(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

export type Tone = 'run' | 'wait' | 'done' | 'idle' | 'err' | 'off' | 'regia';

/** The state pill of a chat: Italian label + color tone. */
export function stateInfo(c: Pick<ChatSummary, 'state' | 'isRegia' | 'pending'>): { label: string; tone: Tone } {
  const s: ChatState = c.state;
  if (s === 'waiting' || c.pending > 0) return { label: 'ti aspetta', tone: 'wait' };
  if (s === 'running') return { label: 'al lavoro', tone: 'run' };
  if (s === 'starting') return { label: 'avvio…', tone: 'off' };
  if (s === 'error') return { label: 'errore', tone: 'err' };
  if (s === 'closed') return { label: 'chiusa', tone: 'off' };
  return c.isRegia ? { label: 'ti ascolta', tone: 'regia' } : { label: 'finito', tone: 'done' };
}

/** Relative time in Italian, short: "ora", "4 min", "2 h", "3 g". */
export function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'ora';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} g`;
}

/** "tra 2 h 13 min" for a future reset time. */
export function until(ts: number, now: number): string {
  const m = Math.max(0, Math.round((ts - now) / 60000));
  if (m < 60) return `tra ${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `tra ${h} h ${r} min` : `tra ${h} h`;
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

/** Same calendar day (local time). */
export function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
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
  const IT: Record<string, string> = {
    Edit: 'Modifica', MultiEdit: 'Modifica', Write: 'Scrive', Read: 'Legge', Grep: 'Cerca', Glob: 'File', Bash: 'Bash', PowerShell: 'PowerShell',
    WebFetch: 'Web', WebSearch: 'Ricerca web', Task: 'Agente', Agent: 'Agente', TodoWrite: 'Da fare', AskUserQuestion: 'Domanda',
  };
  return IT[name] ?? name;
}

/** Sum of +/− over the diffs of a tool row. */
export function diffTotals(diff: { added: number; removed: number }[] | undefined): { added: number; removed: number } | null {
  if (!diff || diff.length === 0) return null;
  return diff.reduce((a, d) => ({ added: a.added + d.added, removed: a.removed + d.removed }), { added: 0, removed: 0 });
}
