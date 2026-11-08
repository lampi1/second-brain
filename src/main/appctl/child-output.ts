// app_child_output (ADR 0226): the Orchestrator reads the latest agent_report of any chat in its tree, delegated chats of
// other roles included, without spending a turn of that chat (the owner, 2026-11-07: «summary + doneWhen di default,
// output completo solo su richiesta, max 4.000 caratteri»). Why: ADR 0083 kept a delegate's content private to its
// parent, so the Orchestrator had to wake the parent (a paid turn) to learn what a grandchild found. It reads the
// report the app already keeps (the run's canonical result, else the chat's delegation.result): never the chat's
// messages, never a write, never a message to the chat. Mounted on the Orchestrator's own endpoint by appctl/tools.ts;
// pinned by test/unit/appctl-child-output.test.ts.
import type { ChatSummary } from '../../shared/contract';
import type { AgentRun } from '../../shared/agents';

/** the most of a report's output app_child_output returns with full: true */
export const CHILD_OUTPUT_MAX = 4_000;
/** the first CHILD_OUTPUT_MAX code units, never half of an emoji (a lone high surrogate at the end) */
const cutAt = (s: string) => { const c = s.charCodeAt(CHILD_OUTPUT_MAX - 1); return s.slice(0, c >= 0xd800 && c <= 0xdbff ? CHILD_OUTPUT_MAX - 1 : CHILD_OUTPUT_MAX); };
export const truncMarker = (total: number) => `\n…[troncato: ${CHILD_OUTPUT_MAX} di ${total} caratteri]`;

interface Tool { name: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }; run(a: Record<string, unknown>): object }
export interface ChildOutputDeps { chats(): ChatSummary[]; runs(): AgentRun[] }

/** The chat when it is a work chat of the Orchestrator's tree: not Flash (ADR 0105), not an Orchestrator, every ancestor
 *  known and not Flash. */
export function inTree(list: ChatSummary[], chatId: string): ChatSummary | undefined {
  const byId = new Map(list.map(c => [c.id, c]));
  const target = byId.get(chatId);
  if (!target || target.isOrchestrator) return undefined;
  const seen = new Set<string>();
  for (let c: ChatSummary | undefined = target; c; c = c.parentId ? byId.get(c.parentId) : undefined) {
    if (c.quick || seen.has(c.id)) return undefined;
    seen.add(c.id);
    if (c.parentId && !byId.has(c.parentId)) return undefined;
  }
  return target;
}

export function childOutputTool(d: ChildOutputDeps): Tool {
  return {
    name: 'app_child_output',
    description: 'Read the latest agent_report of one chat in your tree (your work chats and every chat delegated under them, other roles included) without spending a turn of that chat. Default: outcome, summary, doneWhen (criterion, met, evidence) and the chat state. full: true adds the report\'s output, cut at 4,000 characters with a visible «[troncato: …]» marker. Read only: never the chat\'s messages, never a message to it.',
    inputSchema: { type: 'object', properties: {
      chatId: { type: 'string', description: 'chat id from app_chats' },
      full: { type: 'boolean', description: 'also return the output (at most 4,000 characters)' },
    }, required: ['chatId'] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: a => {
      const id = typeof a.chatId === 'string' ? a.chatId : '';
      const chat = id ? inTree(d.chats(), id) : undefined;
      if (!chat) throw new Error(`chat non trovata nel tuo albero: ${id} (vedi app_chats)`);
      const head = { chatId: chat.id, title: chat.title, role: chat.agent?.name ?? null, state: chat.state, ...(chat.parentId ? { parentId: chat.parentId } : {}), ...(chat.closedAt ? { closed: true } : {}) };
      // the newest canonical result of the chat's runs: the one the parent received
      const canonical = d.runs().filter(r => r.chatId === chat.id && r.report?.canonical).map(r => r.report!.canonical!).sort((x, y) => y.at - x.at)[0];
      const fallback = chat.delegation?.result;
      if (!canonical && (!fallback || fallback.noReport)) return { ...head, report: null, note: 'nessun agent_report ancora' };
      const report = canonical
        ? { outcome: canonical.outcome, summary: canonical.summary, at: new Date(canonical.at).toISOString(), doneWhen: canonical.doneWhen.map(c => ({ criterion: c.criterion, met: c.met, ...(c.evidence ? { evidence: c.evidence } : {}) })) }
        : { outcome: fallback!.outcome, summary: fallback!.summary, at: new Date(fallback!.at).toISOString(), doneWhen: (fallback!.doneWhen ?? []).map(c => ({ criterion: c.criterion, met: c.met })) };
      if (a.full !== true) return { ...head, report };
      if (!canonical) return { ...head, report, output: null, note: 'output non conservato per questo rapporto' };
      const out = canonical.output, cut = out.length > CHILD_OUTPUT_MAX;
      return { ...head, report, output: cut ? cutAt(out) + truncMarker(out.length) : out, ...(cut ? { truncated: true, outputChars: out.length } : {}) };
    },
  };
}
