// Italian formatting helpers for the UI (costs, models, efforts, states, relative times, folders). Pure functions:
// every tile, the top bar and the palette use them, and the unit tests pin their output (test/unit/format.test.ts).
import type { ChatState, ChatSummary, Effort, Harness, PermissionMode } from '@shared/contract';

const money = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1.84 → "1,84 $" (the mockups' style: Italian decimals, dollar after). */
export function formatCost(usd: number): string {
  return `${money.format(Number.isFinite(usd) ? usd : 0)} $`;
}

/** The cost shown on a chat: Cursor does not report a per-chat cost yet, so 0 there reads "costo n/d"; "≈" while part
 *  of it is the running turn's estimate (the real figure replaces it at the end of the turn). */
export function chatCost(c: Pick<ChatSummary, 'harness' | 'costUsd'> & { costKnown?: boolean; costLiveUsd?: number; costLedgerUsd?: number }): string {
  if (c.costLedgerUsd !== undefined) return `≈ ${formatCost(c.costLedgerUsd)}`;
  if (c.costKnown === false || (c.harness === 'cursor' && !c.costUsd)) return 'costo n/d';
  return `${c.costLiveUsd ? '≈ ' : ''}${formatCost(c.costUsd)}`;
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
/** Token counts for people: 820 · 46k · 238k · 1,2M. */
export function tokensShort(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 999_500) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toLocaleString('it-IT', { maximumFractionDigits: 1 })}M`;
}

export function folderName(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

export type Tone = 'run' | 'wait' | 'done' | 'idle' | 'err' | 'off' | 'regia';

/** The state pill of a chat: Italian label + color tone. */
export function stateInfo(c: Pick<ChatSummary, 'state' | 'isRegia' | 'appRegia' | 'pending' | 'queued' | 'closedAt'>): { label: string; tone: Tone } {
  const s: ChatState = c.state;
  if (s === 'waiting' || c.pending > 0) return { label: 'ti aspetta', tone: 'wait' };
  // an agent's start or turn waiting for the machine's load (ADR 0036): not finished
  if (c.queued && !c.closedAt && s !== 'running' && s !== 'error') return { label: 'in coda', tone: 'off' };
  if (s === 'running') return { label: 'al lavoro', tone: 'run' };
  if (s === 'starting') return { label: 'avvio…', tone: 'off' };
  if (s === 'error') return { label: 'errore', tone: 'err' };
  if (s === 'closed') return { label: 'chiusa', tone: 'off' };
  return c.isRegia || c.appRegia ? { label: 'ti ascolta', tone: 'regia' } : { label: 'finito', tone: 'done' };
}

/** Why a chat waits in the CPU queue (ADR 0036): the figure over its limit, or the chats ahead of it. */
export function queueReason(q: NonNullable<ChatSummary['queued']>, limits: { cpu: number; ram: number }): string {
  if (q.cpu > limits.cpu) return `CPU ${q.cpu}%`;
  if (q.freeRam < limits.ram) return `RAM libera ${q.freeRam}%`;
  return 'dietro altre';
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

/** The estimate shown beside a chat's cost: $ range and minutes range (the brain's honest 80% range, or p25-p75 of
 *  similar past jobs: the tooltip says which), "stima senza dati" without enough of them. */
export function estimateText(e: ChatSummary['estimate']): string | null {
  if (e === undefined) return null;
  if (e === null) return 'stima senza dati';
  const usd = `${formatCost(e.usdLow).replace(' $', '')}–${formatCost(e.usdHigh)}`;
  const min = e.minLow == null || e.minHigh == null ? 'durata senza dati'
    : e.minHigh < 60 ? `${Math.round(e.minLow)}–${Math.round(e.minHigh)} min` : `${minutes(e.minLow * 6e4)}–${minutes(e.minHigh * 6e4)}`;
  return `stima ${usd} · ${min}`;
}

/** The estimate's tooltip: where it comes from, the error measured on the past chats (brain table), the chat so far. */
export function estimateTip(e: ChatSummary['estimate'], soFar: string): string {
  if (!e) return 'Meno di 5 lavori simili: niente stima';
  if (e.from !== 'brain') return `Stima da ${e.basis} lavori simili; finora ${soFar}`;
  const err = e.errMin != null ? `; sulle chat passate sbaglia in media di ${minutes(e.errMin * 6e4)}${e.errUsd != null ? ` e ${formatCost(e.errUsd)}` : ''}` : '';
  // what the range promises and how often it held on the past chats (each estimated before it ran)
  const range = e.cover === 0.8
    ? `; intervallo che contiene il reale 8 volte su 10${e.held ? ` (sulle ultime ${e.held.n} chat: durata ${Math.round(e.held.min * 100)}%${e.held.usd != null ? `, costo ${Math.round(e.held.usd * 100)}%` : ''})` : ''}`
    : e.cover === 0.5 ? '; intervallo della metà centrale delle chat simili' : '';
  const mid = e.minMid !== undefined && e.usdMid !== undefined ? `; valore tipico ${minutes(e.minMid * 6e4)}, ${formatCost(e.usdMid)}` : '';
  return `Stima da ${e.basis} chat passate (${e.label ?? 'simili'})${range}${mid}${err}; finora ${soFar}`;
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
  const hm = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return sameDay(at, now) ? hm : `${d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })} ${hm}`;
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
