// app_agents_recap (ADR 0260): the recap the Orchestrator gives when the user asks «fai il punto», «resoconto», «a che
// punto siamo»: one short block per agent with a status mark, its last steps done and where it stands now, ready to
// send as it is, also to the phone (plain text: Telegram gets no parse_mode, so no bold or tables). Why: the owner,
// 2026-11-10: «quando chiedo un resoconto all'Orchestrator voglio un elenco puntato breve per ogni agente, gli ultimi
// punti che ha fatto … anche da telefono so bene cosa stanno facendo e a che punto sono». Built from what the app holds
// (zero tokens): the chat's todo or plan list when it keeps one (Claude TodoWrite, Cursor/ACP todos and plan), else the
// first sentence of its last messages; the open request, the error or the last report. A delegated chat shows only its
// state and its report (ADR 0083, 0226): never its messages. Mounted on the Orchestrator's own endpoint by
// appctl/tools.ts; pinned by test/unit/appctl-agents-recap.test.ts.
import type { ChatItem, ChatSummary, PendingRequest } from '../../shared/contract';
import type { AgentRun } from '../../shared/agents';
import { askLine } from './digest';

interface Tool { name: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }; run(a: Record<string, unknown>): string }
export interface AgentsRecapDeps {
  chats(): ChatSummary[];
  items(chatId: string): ChatItem[];
  pending(): PendingRequest[];
  runs(): AgentRun[];
  now?: () => number;
}

/** at most this many steps done per agent, each cut at STEP_MAX characters */
export const STEPS_MAX = 3;
const STEP_MAX = 90;
/** closed chats named on the last line when they closed within this window */
const CLOSED_MS = 6 * 3600_000;

const one = (s: string | undefined, n = STEP_MAX): string => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** the first sentence of a message, without markdown marks */
const sentence = (s: string): string => one((s.replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]+/g, '').split(/(?<=[.!?:])\s|\n/).find(x => x.trim()) ?? ''));

export interface Steps { done: string[]; now?: string; next?: string }

/** A todo/plan list «✓ a\n▸ b\n○ c» or TodoWrite todos as steps. */
function fromList(rows: { status: string; content: string }[]): Steps | null {
  if (!rows.length) return null;
  const done = rows.filter(r => r.status === 'completed').map(r => one(r.content));
  const now = rows.find(r => r.status === 'in_progress')?.content;
  const next = rows.find(r => r.status === 'pending')?.content;
  return { done: done.slice(-STEPS_MAX), ...(now ? { now: one(now) } : {}), ...(next ? { next: one(next) } : {}) };
}
const MARK: Record<string, string> = { '✓': 'completed', '▸': 'in_progress', '○': 'pending', '✗': 'cancelled' };
const parseList = (list: string) => list.split('\n').map(l => l.trim()).filter(Boolean).map(l => ({ status: MARK[l[0] ?? ''] ?? 'pending', content: l.slice(1).trim() }));

/** The steps of one chat: its latest todo or plan list, else the first sentence of its last messages. */
export function stepsOf(items: ChatItem[]): Steps {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === 'tool' && it.name === 'TodoWrite') {
      const todos = (it.input as { todos?: unknown } | null)?.todos;
      if (Array.isArray(todos)) {
        const s = fromList(todos.map(t => t as { status?: unknown; content?: unknown }).map(t => ({ status: String(t.status ?? ''), content: String(t.content ?? '') })).filter(t => t.content));
        if (s) return s;
      }
    }
    if (it.kind === 'system' && (it.code === 'todos' || it.code === 'plan') && typeof it.params?.list === 'string') {
      const s = fromList(parseList(it.params.list));
      if (s) return s;
    }
  }
  // no list: the first sentence of each message since the user's last one, newest last, no repeats
  let from = items.length;
  while (from > 0 && items[from - 1]!.kind !== 'user') from--;
  const said = [...new Set(items.slice(from).filter((i): i is Extract<ChatItem, { kind: 'assistant' }> => i.kind === 'assistant').map(i => sentence(i.text)).filter(Boolean))];
  return { done: said.slice(-STEPS_MAX) };
}

type Mark = 'wait' | 'error' | 'run' | 'queue' | 'done' | 'stopped' | 'idle';
const ICON: Record<Mark, string> = { wait: '🙋', error: '🔴', run: '🟢', queue: '⏳', done: '✅', stopped: '✋', idle: '💤' };
const LABEL: Record<Mark, string> = { wait: 'aspetta te', error: 'ferma su un errore', run: 'al lavoro', queue: 'in coda', done: 'ha finito', stopped: 'fermata', idle: 'ferma' };
const ORDER: Mark[] = ['wait', 'error', 'run', 'queue', 'done', 'stopped', 'idle'];

/** True when a text is the agents recap (the phone gives it more room, phone/condense.ts): an agent's head in its first
 *  two lines, and at most two lines that are not a head, a step, a sub-agent or the closed line (an intro or a closing
 *  sentence the model added). */
export function isAgentsRecap(text: string): boolean {
  const lines = text.trim().split('\n').filter(l => l.trim());
  const head = (l: string) => Object.values(ICON).some(i => l.startsWith(`${i} `)) && l.includes(' — ');
  const other = lines.filter(l => !head(l) && !/^ {0,2}- /.test(l) && !l.startsWith('Chiuse nelle ultime 6 ore: '));
  return lines.slice(0, 2).some(head) && other.length <= 2 && other.length < lines.length / 2;
}

function markOf(c: ChatSummary, asks: PendingRequest[]): Mark {
  if (asks.length || c.state === 'waiting') return 'wait';
  if (c.state === 'error') return 'error';
  if (c.queued) return 'queue';
  if (c.state === 'running' || c.state === 'starting') return 'run';
  return c.lastResult ? (c.lastResult.interrupted ? 'stopped' : c.lastResult.isError ? 'error' : 'done') : 'idle';
}

/** The latest report summary of a chat: its run's canonical result, else its delegation result. */
function reportOf(c: ChatSummary, runs: AgentRun[]): string | undefined {
  const canon = runs.filter(r => r.chatId === c.id && r.report?.canonical).map(r => r.report!.canonical!).sort((x, y) => y.at - x.at)[0];
  const s = canon?.summary ?? (c.delegation?.result && !c.delegation.result.noReport ? c.delegation.result.summary : undefined);
  return s ? one(s, 140) : undefined;
}

const roleOf = (c: ChatSummary) => c.agent?.name ? `${c.agent.name} · ` : '';

/** The whole recap, plain text: one block per agent, the ones waiting for the user first. */
export function agentsRecap(d: AgentsRecapDeps): string {
  const now = d.now?.() ?? Date.now();
  const all = d.chats().filter(c => !c.quick);
  const open = all.filter(c => !c.closedAt && c.state !== 'closed' && !c.isOrchestrator);
  const asks = new Map<string, PendingRequest[]>();
  for (const r of d.pending()) asks.set(r.chatId, [...(asks.get(r.chatId) ?? []), r]);
  const runs = d.runs();
  const kids = new Map<string, ChatSummary[]>();
  for (const c of open) if (c.parentId) kids.set(c.parentId, [...(kids.get(c.parentId) ?? []), c]);
  const ids = new Set(open.map(c => c.id));
  // a delegated chat goes under its parent; one whose parent is not open stands on its own
  const roots = open.filter(c => !c.parentId || !ids.has(c.parentId));

  const block = (c: ChatSummary): string[] => {
    const rs = asks.get(c.id) ?? [];
    const m = markOf(c, rs);
    const head = `${ICON[m]} ${roleOf(c)}${c.title} — ${LABEL[m]}`;
    const report = m === 'done' || m === 'error' ? reportOf(c, runs) : undefined;
    // a delegated chat: state and report only (ADR 0083, 0226)
    const s: Steps = c.parentId ? { done: [] } : stepsOf(d.items(c.id));
    const rows = s.done.map(x => `- ✓ ${x}`);
    // a delegated chat's question and error text are its parent's (ADR 0083: app_digest mutes them too)
    if (m === 'wait') rows.push(`- 🙋 ${rs.length && !c.parentId ? one(askLine(rs[0]!), 160) : 'una richiesta per te'}`);
    else if (m === 'error') rows.push(`- ❗ ${(c.parentId ? report : one(c.lastError ?? report ?? c.lastText, 140)) || 'errore'}`);
    else if (m === 'stopped') rows.push('- ✋ l’hai fermata tu');
    else if (m === 'queue') rows.push(`- ⏳ posizione ${c.queued!.position}`);
    else if (m === 'run' && s.now) rows.push(`- ▸ ora: ${s.now}`);
    else if (m === 'done' && report) rows.push(`- 📄 ${report}`);
    else if (m === 'done' && s.next) rows.push(`- ○ poi: ${s.next}`);
    const sub = (kids.get(c.id) ?? []).map(k => { const km = markOf(k, asks.get(k.id) ?? []); return `  - ${ICON[km]} ${roleOf(k)}${k.title} — ${LABEL[km]}`; });
    return [head, ...rows, ...sub];
  };

  const sorted = [...roots].sort((a, b) => ORDER.indexOf(markOf(a, asks.get(a.id) ?? [])) - ORDER.indexOf(markOf(b, asks.get(b.id) ?? [])) || b.updatedAt - a.updatedAt);
  const out = sorted.map(c => block(c).join('\n'));
  const closed = all.filter(c => c.closedAt && now - c.closedAt <= CLOSED_MS && !c.isOrchestrator && !c.parentId).map(c => c.title);
  if (closed.length) out.push(`Chiuse nelle ultime 6 ore: ${closed.join(', ')}`);
  return out.length ? out.join('\n\n') : 'Nessun agente al lavoro.';
}

export function agentsRecapTool(d: AgentsRecapDeps): Tool {
  return {
    name: 'app_agents_recap',
    description: 'The recap for «fai il punto», «resoconto», «a che punto siamo», «cosa stanno facendo»: one short plain-text block per open agent (status mark, role, title, its last steps done, what it does now, what it waits for from the user, or its last report), the ones waiting for the user first; delegated chats under their parent with their state only. Zero tokens. Reply with this text as it is: it is written for the phone too.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: () => agentsRecap(d),
  };
}
