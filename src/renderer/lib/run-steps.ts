// The steps of a delegated chat's card (DelegationCard.tsx, ADR 0083), derived from what the app saw, with zero tokens and
// no model summaries: (1) the engine's own plan when it has one: Claude's TodoWrite todos, Codex's plan (turn/plan/updated,
// shown as a "Piano:" item by chats/codex.ts), Cursor's ACP plan and cursor/update_todos (the 'plan' / 'todos' items of
// chats/acp.ts); else (2) the delegation contract's criteria as open items, ticked by its agent_report; and always
// (3) its recent tool calls grouped into readable lines: consecutive reads and searches under one folder ("Letti 42 file
// in src/payments/"), edits with their diff counts ("Modificati 4 file · +182 −64"), a command ("Lancia `dotnet test`"),
// web and browser actions (shared/explain.ts lines). A sentence like "Trovate 17 chiamate" appears only when the agent
// wrote it as a plan item. Pure: pinned by test/unit/run-steps.test.ts with one fixture per engine.
import type { ChatItem } from '@shared/contract';
import { baseName, explainTool } from '@shared/explain';

export type StepMark = 'done' | 'cur' | 'todo' | 'bad';
export interface RunStep { mark: StepMark; text: string; at?: number; code?: string }
export interface RunSteps {
  /** where the plan part comes from: the engine's plan, the contract's criteria, or nothing */
  source: 'plan' | 'contract' | null;
  steps: RunStep[];
  /** tool lines left out (the "+ N azioni prima" line) */
  earlier: number;
}
type Tool = Extract<ChatItem, { kind: 'tool' }>;
type Sys = Extract<ChatItem, { kind: 'system' }>;
const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

const READS = new Set(['Read', 'Glob', 'Grep', 'Search', 'LS', 'List']);
const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Delete', 'Move']);
const SHELLS = new Set(['Bash', 'PowerShell', 'Shell']);
/** tools that are no step of the work (the plan itself, questions, the delegation's own calls) */
const SKIP = new Set(['TodoWrite', 'AskUserQuestion', 'AskQuestion', 'ExitPlanMode', 'CreatePlan', 'Think', 'ToolSearch', 'Mode']);
/** reading its own children's list is no step of the work */
const isDelegationTool = (name: string) => /^mcp__.+__agent_children$/.test(name);

const markOf = (st: string): StepMark => (st === 'completed' || st === '✓' ? 'done' : st === 'in_progress' || st === 'inProgress' || st === '▸' ? 'cur' : st === 'cancelled' || st === '✗' ? 'bad' : 'todo');

/** "✓ text" / "▸ text" / "○ text" lines of a plan item's text (Codex's "Piano:", ACP's plan and todos). */
function planLines(text: string): RunStep[] {
  return text.split('\n').slice(1).map(l => l.trim()).filter(Boolean).flatMap(l => {
    const m = /^([✓▸○✗])\s+(.+)$/.exec(l);
    return m ? [{ mark: markOf(m[1]!), text: cut(m[2]!, 140) }] : [];
  });
}

/** The engine's latest plan in the transcript, or null. */
export function enginePlan(items: readonly ChatItem[]): RunStep[] | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === 'tool' && it.name === 'TodoWrite') {
      const todos = Array.isArray(o(it.input).todos) ? (o(it.input).todos as unknown[]).map(o) : [];
      const steps = todos.flatMap(t => {
        const st = s(t.status), text = st === 'in_progress' && s(t.activeForm) ? s(t.activeForm) : s(t.content);
        return text ? [{ mark: markOf(st), text: cut(text, 140) }] : [];
      });
      if (steps.length) return steps;
    }
    if (it.kind === 'system') {
      const sys = it as Sys;
      const text = sys.text ?? '';
      if (sys.code === 'plan' || sys.code === 'todos' || /^(Piano|Plan)(:|\b)[^\n]*\n/.test(text)) {
        const steps = planLines(text);
        if (steps.length) return steps;
      }
    }
  }
  return null;
}

/** The delegation contract's criteria as items: open until the report ticks them met (✓) or not (✗). */
export function contractSteps(doneWhen: readonly string[], result?: { doneWhen?: readonly { criterion: string; met: boolean }[] }): RunStep[] {
  return doneWhen.map(c => {
    const a = result?.doneWhen?.find(x => x.criterion === c);
    return { mark: a ? (a.met ? 'done' : 'bad') : 'todo', text: c };
  });
}

/** The common folder of some folders ("src/payments/"), or '' when they share none. */
function folderOf(dirs: string[]): string {
  const parts = dirs.map(p => p.replace(/\\/g, '/').replace(/\/+$/, '').split('/'));
  if (!parts.length || parts.some(p => !p.length)) return '';
  const first = parts[0]!;
  let n = 0;
  while (n < first.length && parts.every(p => p[n] === first[n])) n++;
  const common = first.slice(0, n).filter(Boolean);
  return common.length ? `${common.slice(-2).join('/')}/` : '';
}

const pathOf = (t: Tool): string => { const i = o(t.input); return s(i.file_path) || s(i.notebook_path) || s(i.target_file) || s(i.path) || s(i.filePath); };
const stateOf = (group: Tool[], live: boolean): StepMark => group.some(t => t.status === 'running') && live ? 'cur' : group.some(t => t.status === 'error') ? 'bad' : 'done';

/** The recent tool calls as readable lines, oldest first: runs of reads and of edits fold into one line each. */
export function actionSteps(items: readonly ChatItem[], live: boolean): RunStep[] {
  const tools = items.filter((i): i is Tool => i.kind === 'tool' && !SKIP.has(i.name) && !isDelegationTool(i.name));
  const out: RunStep[] = [];
  for (let k = 0; k < tools.length;) {
    const t = tools[k]!;
    const kind = READS.has(t.name) ? 'read' : EDITS.has(t.name) ? 'edit' : 'one';
    let j = k + 1;
    if (kind !== 'one') while (j < tools.length && (kind === 'read' ? READS : EDITS).has(tools[j]!.name)) j++;
    const group = tools.slice(k, j), last = group[group.length - 1]!, mark = stateOf(group, live);
    if (kind === 'read' && group.length > 1) {
      const files = [...new Set(group.filter(g => g.name === 'Read').map(pathOf).filter(Boolean))];
      // a read names a file (its folder counts), a search names a folder
      const folder = folderOf(group.flatMap(g => { const p = pathOf(g); return !p ? [] : g.name === 'Read' ? [p.replace(/\\/g, '/').split('/').slice(0, -1).join('/')] : [p]; }));
      const text = files.length > 1 ? `Letti ${files.length} file${folder ? ` in ${folder}` : ''}` : files.length === 1 ? `Letto ${baseName(files[0]!)}${group.length > 1 ? ` e ${group.length - 1} ricerche` : ''}` : `${group.length} ricerche${folder ? ` in ${folder}` : ''}`;
      out.push({ mark, text, at: last.at });
    } else if (kind === 'edit') {
      const files = [...new Set(group.map(g => (g.diff?.[0]?.path) || pathOf(g)).filter(Boolean))];
      const added = group.reduce((n, g) => n + (g.diff ?? []).reduce((m, d) => m + d.added, 0), 0);
      const removed = group.reduce((n, g) => n + (g.diff ?? []).reduce((m, d) => m + d.removed, 0), 0);
      const counts = added || removed ? ` · +${added} −${removed}` : '';
      const text = files.length > 1 ? `Modificati ${files.length} file${counts}` : `${mark === 'cur' ? 'Modifica' : 'Modificato'} ${baseName(files[0] ?? '') || 'un file'}${counts}`;
      out.push({ mark, text, at: last.at });
    } else if (SHELLS.has(t.name)) {
      const cmd = s(o(t.input).command) || s(o(t.input).cmd) || t.summary.replace(/^[^:]+:\s*/, '');
      out.push({ mark, text: mark === 'cur' ? 'Lancia' : 'Lanciato', code: cut(cmd.split('\n')[0]!.trim(), 60), at: t.at });
    } else {
      out.push({ mark, text: explainTool(t.name, t.input, t.summary.replace(/^[^:]+:\s*/, '')).line, at: t.at });
    }
    k = j;
  }
  return out;
}

/** The card's steps: the plan's done items, the latest actions, then the plan's open items (or the contract's). */
export function runSteps(items: readonly ChatItem[], opts: { live: boolean; doneWhen?: readonly string[]; result?: { doneWhen?: readonly { criterion: string; met: boolean }[] }; max?: number }): RunSteps {
  const max = opts.max ?? 5;
  const plan = enginePlan(items);
  const actions = actionSteps(items, opts.live);
  if (plan) {
    const done = plan.filter(p => p.mark === 'done' || p.mark === 'bad'), open = plan.filter(p => p.mark === 'cur' || p.mark === 'todo');
    const room = Math.max(1, max - Math.min(open.length, 2) - Math.min(done.length, 2));
    const shown = actions.slice(-room);
    const steps = [...done.slice(-2), ...shown, ...open.slice(0, Math.max(1, max - shown.length - Math.min(done.length, 2)))];
    return { source: 'plan', steps, earlier: actions.length - shown.length + Math.max(0, done.length - 2) };
  }
  // once reported, the criteria show with the result (DelegationCard's Esito), not twice
  const contract = opts.doneWhen?.length && !opts.result ? contractSteps(opts.doneWhen) : [];
  const room = Math.max(1, max - Math.min(contract.length, 2));
  const shown = actions.slice(-room);
  return { source: contract.length ? 'contract' : null, steps: [...shown, ...contract.slice(0, Math.max(1, max - shown.length))], earlier: actions.length - shown.length };
}
