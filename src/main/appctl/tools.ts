// App control tools: the app itself, usable by AI (the user, 2026-10-11: "l'IA deve sapere perfettamente come testarla da
// sola ... perché dovrà usarla al meglio"). Mounted on the local MCP server at /mcp/app (127.0.0.1 only, Host/Origin
// checked). An agent (the Regia, a test agent) can read the app's state, chats, pending requests, feed and logs, take
// screenshots of the whole window, and steer the UI. Rules (ADR 0006):
// - It can NEVER answer a permission or start a command: only the user's click in the app is their ok. One exception
//   for questions (ADR 0017): app_resolve_question closes a work chat's question panel with the answer the user gave
//   the Regia, marked "Risposto in Regia dall'utente", and only if he wrote to the Regia or answered it since the
//   question opened (the user, 2026-10-12: "anche se rispondi te alle chat, rimane la UI della domanda nella chat").
// - Messages it sends to chats are labelled as not written by the user (like mail between chats).
// - No production, no secrets: the logs it returns are already redacted by log.ts.
// - It can close a chat like the user's ✕ (app_close_chat), never a Regia nor a chat waiting for the user.
// - Several Regie (ADR 0021): each calls on its own endpoint, so the tools know the caller (appControlTools callerId).
// - Long chats: it can ask a chat's hand-off and "Riprendi" it in a new chat (app_handoff_chat, app_continue_chat),
//   under the same rule for chats across engines as messages (engines/policy.ts; an agent never starts a stopped
//   chat on another engine).
// - Both mounts see the shared Grindhouse. Only an Orchestrator's own mount brings the app's code folder up to date
//   when the user asks (app_update_code, ADR 0074); no tool promotes or restarts the app (only the user's click on
//   "Aggiorna" in Settings, ADR 0075).
import type { BrowserWindow } from 'electron';
import type { ChatItem, ChatSummary, TasksState, Effort, EventMap, Harness, PendingRequest, RouteAgent, RoutingRow, RunInfo, TaskKind } from '../../shared/contract';
import { TASK_KINDS } from '../../shared/contract';
import { EFFORTS, isFable, modelRow } from '../brain/routing';
import { engineLabel, engineOf, engines } from '../engines/registry';
import { agentsMayOpen, crossRefusal, openRefusal } from '../engines/policy';
import type { BrainService, BrowserService, ChatService } from '../services';
import { errText, log, redact } from '../log';
import { fmtFactor, previewOf } from '../browser/preview';
import { healthSnapshot } from '../health';
import { timerSnapshot } from '../timers';
import { chatName, regiaOfChat } from '../../shared/regia';
import { isLongChat } from '../../shared/context';
import { describeUi } from '../../shared/genui';
import { digest } from './digest';
import { gitBranch } from '../chats/branch';
import { claimsAlias } from '../chats/mail';
import type { PullResult } from '../update/source';
import { GENERAL_AGENT_ID, ORCHESTRATOR_AGENT_ID, type AgentCatalog } from '../../shared/agents';
import { agentCatalogTool, discoverRankedAgents, type ClassifyAgents } from '../agents/discovery';
import { authoringTools, type AgentAuthoring } from '../agents/authoring';
import { agentLearnTool, type AgentPackLearning } from '../agents/pack/learning';
import type { CloudService } from '../cloud/service';
import { isCloudEngine } from '../../shared/cloud';

export type ToolOut = string | { text?: string; images?: { data: string; mimeType: string; caption?: string }[] } | object;
export interface ToolDef { name: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }; run(args: Record<string, unknown>): Promise<ToolOut> | ToolOut }

export interface AppCtlDeps {
  /** cloud agents (ADR 0080): app_create_chat where:'cloud' starts one, app_chats lists them */
  cloud?: CloudService;
  agentAuthoring?: AgentAuthoring;
  agentLearning?: AgentPackLearning;
  agents?: () => AgentCatalog;
  classifyAgents?: ClassifyAgents;
  chats: ChatService; browser: BrowserService; brain: BrainService;
  window: () => BrowserWindow | null;
  emitUi: (cmd: EventMap['ui:command']) => void;
  version: string;
  /** the code blocks the user ran with "Esegui" (read-only: no tool starts a run) */
  runs?: (chatId?: string) => RunInfo[];
  /** the "Comando da eseguire" requests (shell blocks left for the user), listed with the other open requests */
  commandAsks?: () => PendingRequest[];
  /** Only the authenticated per-chat mount may enable the canonical coordinator's union scope. */
  unified?: boolean;
  /** the app's code folder (update/source.ts): a chat there works on the app (routing area App); pull = app_update_code */
  code?: { repo: () => string | null; inRepo?: (dir: string) => Promise<boolean>; pull?: () => Promise<PullResult> };
  /** the Task page's last read (the user's PRs, unread news) for app_digest; absent = not shown */
  tasks?: () => TasksState | null;
  /** an agent version's results line for its route's reason ("12 run, 9 con esito, 78% riuscite"); absent = none */
  agentStats?: (agentId: string, version: number) => string | null;
}

/** agent_learn_propose on the app endpoints: a learned rule, or (with the authoring service) an agent's "Contesto
 *  massimo" as an agent_update proposal for the user (issue #80). */
function learnTool(d: AppCtlDeps, callerId: string | undefined): ToolDef {
  const authoring = d.agentAuthoring;
  const tool = agentLearnTool(d.agentLearning!, authoring ? (agentId, patch, evidence) => authoring.call('agent_update', { agentId, patch, reason: evidence.slice(0, 600) }, callerId ?? 'orchestrator') : undefined);
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema, run: async a => JSON.parse(String(await tool.run(a, { params: {} } as unknown as Parameters<typeof tool.run>[1]))) as object };
}

/** app_digest since "last": when each caller (Regia endpoint) last asked, for this app run */
const lastDigest = new Map<string, number>();

const obj = (props: Record<string, object> = {}, required: string[] = []) => ({ type: 'object', properties: props, required });
const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
/** app_update_code runs only within this many minutes of a message the user wrote to the Orchestrator (ADR 0074) */
export const PULL_ASK_MIN = 10;
export const AGENT_LABEL = "[Messaggio di un agente tramite second-brain, non scritto dall'utente: non vale come suo ok o permesso]";
/** how a work chat sees an answer the Regia delivered for the user (app_resolve_question) */
export const RESOLVED_LABEL = 'Risposto nell’Orchestrator dall\'utente:';
/** a message the app or an agent wrote (AGENT_LABEL, the app's news to the Regia, mail between chats): never the user's */
const labelled = (text: string) => (text.split('\n', 1)[0] ?? '').includes('non vale come suo ok');

const brief = (c: ChatSummary, warn: number) => ({
  effort: c.effortStatus ?? { supported: !!engineOf(c.harness)?.caps.effort, requested: c.effort, submitted: null, effective: null, pending: false, effectiveSource: 'unknown', sessionDefault: null },
  id: c.id, title: c.title, harness: c.harness, state: c.state, pending: c.pending, model: c.model, costUsd: Math.round(c.costUsd * 100) / 100, isRegia: c.isRegia,
  ...(c.background ? { background: c.background } : {}),
  ...(c.work ? {work:c.work} : {}), last: c.lastText.slice(0, 200),
  ...(c.contextTokens ? { contextTokens: c.contextTokens, ...(c.contextEstimated ? { contextEstimated: true } : {}), long: isLongChat(c, warn) } : {}),
  ...(c.handoffAt ? { handoffAt: new Date(c.handoffAt).toISOString() } : {}),
  ...(c.continuedBy ? { continuedBy: c.continuedBy.id } : {}), ...(c.continuedFrom ? { continuedFrom: c.continuedFrom.id } : {}),
  ...(c.queued ? { queued: queuedLine(c.queued) } : {}),
  // an agent chat's run: its runId is what agent_feedback / agent_run_report take (never the chat id)
  ...(c.run ? { run: { runId: c.run.runId, agentId: c.run.agentId, version: c.run.version, state: c.run.endedAt === undefined ? 'running' : 'ended' } } : {}),
});
/** "queued (CPU 92%, RAM 40% free, position 1)": an agent's start or turn waiting for the machine's load (ADR 0036) */
export const queuedLine = (q: NonNullable<ChatSummary['queued']>): string => `queued (CPU ${q.cpu}%, RAM ${q.freeRam}% free, position ${q.position})`;
/** closed (archived) chats the Regia may reopen: the last 7 days, newest first, at most 20 */
const RECENT_CLOSED_MS = 7 * 24 * 3600_000;
export function recentClosed(list: ChatSummary[], now = Date.now()): ChatSummary[] {
  return list.filter(c => c.closedAt && now - c.closedAt <= RECENT_CLOSED_MS).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)).slice(0, 20);
}

/** The per-Regia endpoint /mcp/app/r/:chatId/:token answers only an open work Regia presenting its own token (ADR
 *  0021): the id names the caller, whose engine decides the rule for chats across engines, so it may not be picked by anyone else. */
export function regiaEndpointAuth(tokens: { check(key: string, token: string): boolean }, list: () => Pick<ChatSummary, 'id' | 'isRegia'>[]) {
  return (p: Record<string, string>): boolean => !!p.chatId && !!p.token && tokens.check(p.chatId, p.token) && list().some(c => c.id === p.chatId && c.isRegia);
}

/** callerId = the work Regia that calls (its own endpoint /mcp/app/r/<id>/<token>, ADR 0021); none or stale = the first
 *  Regia (/mcp/app: test agents). The chats it creates answer to it; its messages are signed with its title. */
export function appControlTools(d: AppCtlDeps, callerId?: string): ToolDef[] {
  const unified = () => d.unified === true && !!callerId && d.chats.list().some(c => c.id === callerId && c.isRegia && c.orchestrator && !c.closedAt);
  const mine = (_c: ChatSummary) => true;
  /** the caller: the work Regia of this endpoint */
  const caller = (): ChatSummary | undefined => {
    const all = d.chats.list();
    if (unified()) return all.find(c => c.id === callerId);
    const id = regiaOfChat(all.find(c => c.id === callerId), all);
    return all.find(c => c.id === id);
  };
  /** Chat visibility is shared; ownership checks remain on operations that require an owner. */
  const other = (chatId: string) => d.chats.list().some(c => c.id === chatId && !mine(c));
  const guard = (chatId: string) => { if (other(chatId)) throw new Error(`chat non trovata: ${chatId} (vedi app_chats)`); return chatId; };
  const tools: ToolDef[] = [
    ...(d.agentAuthoring && unified() && callerId ? authoringTools(d.agentAuthoring, callerId, unified, () => d.agents?.().profiles.filter(p => p.origin.kind === 'preset' && p.status === 'active' && p.routable !== false && p.id !== ORCHESTRATOR_AGENT_ID).map(p => p.id) ?? []) : []),
    ...(d.agentLearning ? [learnTool(d, callerId)] : []),
    ...(d.agents ? [{ name: 'agent_catalog', description: agentCatalogTool(d.agents).description, inputSchema: agentCatalogTool(d.agents).inputSchema, run: (a: Record<string, unknown>) => discoverRankedAgents(d.agents!, a, d.classifyAgents) }] : []),
    {
      name: 'app_set_chat_effort',
      description: 'Select the reasoning effort for one app chat. Changes the next turn, never approvals, sandbox, model or a running turn. Returns requested, submitted, provider-reported effective and pending separately; null is unknown/default, never medium.',
      inputSchema: obj({ chatId: str('chat id from app_chats'), effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] } }, ['chatId', 'effort']),
      run: async a => {
        const chatId = typeof a.chatId === 'string' ? a.chatId : '';
        if (!chatId || typeof a.effort !== 'string' || !['low', 'medium', 'high', 'xhigh', 'max'].includes(a.effort)) throw new Error('chatId ed effort validi sono obbligatori.');
        const target = need(chatId);
        if (!engineOf(target.harness)?.caps.effort) throw new Error('Questo motore non supporta la scelta dell’effort.');
        const updated = await d.chats.set(target.id, { effort: a.effort as Effort });
        return { chatId: updated.id, effort: updated.effortStatus ?? { supported: true, requested: updated.effort, submitted: null, effective: null, pending: true, effectiveSource: 'unknown', sessionDefault: null } };
      },
    },
    {
      name: 'app_set_chat_work',
      description:'Declare an explicit assignment or future-mailbox wait, or explicitly complete it. Holds prevent automatic archive and idle-session release across turns/restarts; they never approve actions or confirm a successful result. Completion never closes a chat immediately.',
      inputSchema:obj({chatId:str('chat id in your scope'),status:{type:'string',enum:['assigned','waiting-mail','completed']}},['chatId','status']),
      run:async a=>{
        const id=guard(String(a.chatId??'')),target=d.chats.list().find(c=>c.id===id&&mine(c));
        const owner=caller();
        if(!target||!owner||(target.id!==owner.id&&target.regiaOf!==owner.id))throw new Error('Agente fuori dal tuo gruppo.');
        if(!['assigned','waiting-mail','completed'].includes(String(a.status)))throw new Error('Stato incarico non valido.');
        const result=await d.chats.set(id,{workStatus:a.status as 'assigned'|'waiting-mail'|'completed'});
        return {chatId:id,work:result.work};
      },
    },
    {
      name: 'app_state', description: 'Overview of the app: version, brain folder, chats by state, open questions/permissions, browser tabs, today usage, context use of the Claude chats (calls over 200k, cold cache rewrites over 100k, compactions, cold hand-off notes written vs used, $ per call after a continuation vs after a compaction; ADR 0031), health (MCP port and whether it fell back to a random one, main-window renderer crashes/hangs/reloads, engines killed by force, Job Object guard) since the app started.',
      inputSchema: obj(),
      run: () => {
        const chats = d.chats.list().filter(mine);
        const by: Record<string, number> = {};
        for (const c of chats) if (!c.closedAt) by[c.state] = (by[c.state] ?? 0) + 1;
        const q = d.chats.queueState();
        const queue = q && { enabled: q.enabled, cpu: q.cpu, freeRam: q.freeRam, waiting: q.waiting.filter(w => !other(w.chatId)).map(w => ({ chatId: w.chatId, kind: w.kind, position: w.position })) };
        return { version: d.version, brainRoot: d.brain.info().brainRoot, chats: by, ...(queue ? { queue } : {}), closedChats: chats.filter(c => c.closedAt).length, pending: d.chats.pending().filter(r => !other(r.chatId)).length, tabs: d.browser.list().length, usage: d.brain.usage(), ...(d.chats.contextStats ? { context: d.chats.contextStats() } : {}), logs: log.folder, health: healthSnapshot(), timers: timerSnapshot() };
      },
    },
    {
      name: 'app_chats', description: 'The chats in the app (Claude and Cursor engines): "app" = on the grid (state, open questions, model, cost, last line, background tasks still running, context size (long=true is a passive threshold observation, not a reason to change session), hand-off and "Riprendi" links, and for an agent chat its run: run.runId is the id agent_feedback and agent_run_report take, never the chat id); "closed" = finished chats that closed by themselves or by hand in the last 7 days (newest first): reopen one with app_reopen_chat, or just app_send_to_chat.',
      inputSchema: obj(),
      run: () => {
        const all = d.chats.list().filter(mine);
        const warn = d.brain.settings().contextWarnTokens;
        return {
          app: all.filter(c => !c.closedAt).map(c => brief(c, warn)),
          closed: recentClosed(all).map(c => ({ ...brief(c, warn), closedAt: new Date(c.closedAt!).toISOString(), closedBy: c.closedBy ?? 'auto' })),
          // agents in the vendors' clouds (ADR 0080): status and page only; follow them on their vendor's page
          ...(d.cloud ? { cloud: d.cloud.state().agents.slice(0, 30).map(a => ({ id: a.id, engine: a.engine, title: a.title, status: a.status, repo: a.repo, ...(a.branch ? { branch: a.branch } : {}), url: a.url, ...(a.summary ? { summary: a.summary.slice(0, 200) } : {}), ...(a.costUsd !== undefined ? { costUsd: a.costUsd } : {}), updatedAt: new Date(a.updatedAt).toISOString() })) } : {}),
        };
      },
    },
    {
      name: 'app_digest',
      description: `The status in ONE call, zero tokens: every open chat with its state, what it waits for from the user (question text, permission, command), errors, last line, git branch, long context; chats closed and commands the user ran; the user's PRs (build, votes, QA failures) and unread Task news from the app's last Task read (Azure DevOps). Use it for "stato" and when woken, instead of app_chats + app_chat_items per chat + app_pending; read a chat's items only when its line is not enough. since: "last" (what changed since your previous app_digest), an ISO time, or omit for everything; chats waiting or failed are always listed.`,
      inputSchema: obj({ since: str('"last", an ISO time, or omit') }),
      run: a => {
        const key = `app:${callerId ?? ''}`;
        const now = Date.now();
        const raw = typeof a.since === 'string' ? a.since.trim() : '';
        const since = raw === 'last' ? lastDigest.get(key) ?? null : raw ? Date.parse(raw) : null;
        if (since !== null && Number.isNaN(since)) throw new Error('since: "last" oppure un orario ISO (es. 2026-10-13T18:00:00Z)');
        lastDigest.set(key, now);
        return digest({
          chats: d.chats.list().filter(mine), pending: [...d.chats.pending(), ...(d.commandAsks?.() ?? [])].filter(r => !other(r.chatId)),
          runs: (d.runs?.() ?? []).filter(r => !other(r.chatId)), tasks: d.tasks?.() ?? null,
          now, since, selfId: caller()?.id, warnTokens: d.brain.settings().contextWarnTokens, branch: gitBranch,
        });
      },
    },
    {
      name: 'app_reopen_chat', description: 'Reopen a closed (archived) chat listed under "closed" by app_chats: it goes back on the grid with its whole history and its session resumes (--resume) on the next message. Sending it a message with app_send_to_chat reopens it too.',
      inputSchema: obj({ chatId: str('chat id from app_chats "closed"') }, ['chatId']),
      run: async a => {
        const id = String(a.chatId ?? '');
        if (!d.chats.list().some(c => c.id === id && mine(c))) throw new Error(`chat non trovata: ${id} (vedi app_chats)`);
        const c = await d.chats.reopen(id);
        log.info('appctl', 'agent reopened a chat', { chat: id });
        return brief(c, d.brain.settings().contextWarnTokens);
      },
    },
    {
      name: 'app_close_chat', description: 'Close an app chat for the user, like his ✕ / Ctrl+W: it leaves the grid and its engine ends with every tool it started (MCP servers, shells, dev servers); the transcript stays. Never an Orchestrator; refused while the chat waits for the user (his open questions are his).',
      inputSchema: obj({ chatId: str('chat id from app_chats "app"') }, ['chatId']),
      run: async a => {
        const id = String(a.chatId ?? '');
        const c = d.chats.list().find(x => x.id === id);
        if (!c || !mine(c)) throw new Error(`chat non trovata: ${id} (vedi app_chats)`);
        if (c.isRegia) throw new Error('L’Orchestrator non si chiude da uno strumento: solo l’utente, dal suo menu ⋯');
        if (c.pending > 0) throw new Error(`«${c.title}» aspetta una risposta dell’utente: chiudila solo lui`);
        await d.chats.close(id);
        log.info('appctl', 'agent closed a chat', { chat: id, data: { title: c.title, state: c.state } });
        d.brain.publish([{ kind: 'chat-closed', title: c.title, detail: 'chiusa dall’Orchestrator', chatId: id, who: c.harness }]);
        return 'closed';
      },
    },
    {
      name: 'app_chat_items', description: 'Last items of one app chat (messages, tool rows, results), texts truncated.',
      inputSchema: obj({ chatId: str('chat id from app_chats'), last: num('how many, default 30') }, ['chatId']),
      // image previews stay out (base64, up to 10 per message): the count `images` says enough to an agent
      run: a => d.chats.items(guard(String(a.chatId))).slice(-(Number(a.last) || 30)).map(({ thumbs: _thumbs, ...i }: ChatItem & { thumbs?: unknown }) => ({ ...i, ...('text' in i ? { text: i.text.slice(0, 1500) } : {}), ...('output' in i && i.output ? { output: i.output.slice(0, 800) } : {}), ...(i.kind === 'artifact' ? { ui: describeUi(i.ui) } : {}) })),
    },
    {
      name: 'app_command_runs',
      description: 'Commands the user ran from a chat code block with "Esegui" (PowerShell 5.1 in the app): state, exit code, output tail. Read-only: only the user starts a run, by his click. Pass chatId to see the runs of one chat (yours: read the outcome of the command you proposed).',
      inputSchema: obj({ chatId: str('chat id from app_chats (optional)'), last: num('how many, newest last, default 5') }),
      run: a => (d.runs?.(a.chatId ? guard(String(a.chatId)) : undefined) ?? []).filter(r => !other(r.chatId)).slice(-(Number(a.last) || 5))
        .map(r => ({ id: r.id, chatId: r.chatId, state: r.state, exitCode: r.exitCode, code: redact(r.code.slice(0, 1500)), cwd: r.cwd, output: redact(r.output.slice(-4000)), startedAt: new Date(r.startedAt).toISOString(), endedAt: r.endedAt ? new Date(r.endedAt).toISOString() : null, ...(r.prod ? { prod: r.prod } : {}) })),
    },
    {
      name: 'app_pending', description: 'Open questions, permission requests and commands left for the user to run (type "command": a shell block waiting for his Esegui) waiting for the user (read-only; the one exception: app_resolve_question, for a question the user answered in the Regia).',
      inputSchema: obj(), run: () => [...d.chats.pending(), ...(d.commandAsks?.() ?? [])].filter(r => !other(r.chatId)),
    },
    {
      name: 'app_resolve_question',
      description: 'Close a work chat\'s open question panel (type "question" in app_pending) with the answer the user gave YOU in the Regia: the chat receives it marked "Risposto in Regia dall\'utente: …" and the question leaves "Ti aspettano". Only for a decision he took in the Regia after the question opened (the app checks that he wrote to you or answered your question since then); never your own choice, never a permission or a command (only his click answers those), never the Regia\'s own questions. answers: one entry per question of the request, the exact question text as key, his answer as value (several options: one string, comma-separated). note: optional, his words or context, added to the first answer.',
      inputSchema: obj({
        chatId: str('the work chat, from app_pending'), requestId: str('the question\'s id, from app_pending'),
        answers: { type: 'object', description: '{ "<question text>": "<his answer>" } for every question', additionalProperties: { type: 'string' } },
        note: str('optional: his words or context'),
      }, ['chatId', 'requestId', 'answers']),
      run: async a => {
        const chatId = String(a.chatId ?? ''), requestId = String(a.requestId ?? '');
        const target = need(chatId);
        if (target.isRegia) throw new Error('bloccato: le domande dell’Orchestrator le risponde solo l\'utente, nel loro pannello');
        const req = d.chats.pending().find(p => p.chatId === chatId && p.id === requestId);
        if (!req) throw new Error('questa domanda non è più aperta (quelle aperte: app_pending)');
        if (req.type !== 'question' || !req.questions?.length) throw new Error('bloccato: solo le domande; permessi e comandi li risponde solo l\'utente con un clic');
        const regia = caller();
        // several Regie (ADR 0021): only the Regia the chat answers to, where its question shows, closes it
        if (regia) {
          const all = d.chats.list();
          const owner = regiaOfChat(target, all);
          if (owner !== regia.id) throw new Error(`bloccato: questa domanda è dell’Orchestrator «${chatName(all.find(c => c.id === owner) ?? regia)}»: la risponde l'utente lì`);
        }
        if (!regia || !decidedSince(regia.id, req.at)) throw new Error('bloccato: L\'utente non ha scritto né risposto nell’Orchestrator da quando la domanda si è aperta. Chiedigliela prima: una tua scelta non vale come sua');
        const given = a.answers && typeof a.answers === 'object' && !Array.isArray(a.answers) ? a.answers as Record<string, unknown> : {};
        const asked = req.questions.map(q => q.question);
        const text = (v: unknown) => (Array.isArray(v) ? v.map(String).join(', ') : String(v ?? '')).trim();
        if (Object.keys(given).some(k => !asked.includes(k)) || asked.some(q => !text(given[q]))) {
          throw new Error(`answers deve avere una risposta per ogni domanda, con il testo esatto come chiave: ${asked.map(q => `«${q}»`).join(', ')}`);
        }
        const note = String(a.note ?? '').replace(/\s+/g, ' ').trim();
        const answers = Object.fromEntries(asked.map((q, i) => [q, `${RESOLVED_LABEL} ${text(given[q])}${note && i === 0 ? ` (nota: ${note})` : ''}`]));
        await d.chats.answer(chatId, requestId, { kind: 'question', answers });
        log.info('appctl', 'question answered from the Regia', { chat: chatId, data: { requestId, questions: asked.length } });
        return { ok: true, chatId, requestId, answers };
      },
    },
    {
      name: 'app_feed', description: 'Recent live feed events (ideas, errors, chats done/waiting...).',
      inputSchema: obj({ limit: num('default 30') }), run: a => d.brain.feed().filter(e => !e.chatId || !other(e.chatId)).slice(0, Number(a.limit) || 30),
    },
    {
      name: 'app_logs', description: 'Recent structured log entries of the app (redacted). Filters: level (debug|info|warn|error), scope, chat, grep.',
      inputSchema: obj({ level: str('minimum level'), scope: str('module scope, e.g. chats'), chat: str('chat id'), grep: str('text'), tail: num('default 50') }),
      run: a => {
        const order = { debug: 0, info: 1, warn: 2, error: 3 } as const;
        const min = order[(a.level as keyof typeof order) ?? 'debug'] ?? 0;
        const g = typeof a.grep === 'string' ? a.grep.toLowerCase() : null;
        return log.recent.filter(e => (!e.chat || !other(e.chat)) && order[e.lvl] >= min && (!a.scope || e.scope === a.scope) && (!a.chat || e.chat === a.chat) && (!g || JSON.stringify(e).toLowerCase().includes(g)))
          .slice(-(Number(a.tail) || 50));
      },
    },
    {
      name: 'app_screenshot', description: 'Screenshot of the app window (the UI) plus each browser tab visible on screen with its position. Images scaled to a long side of ~1000 px (the text gives each factor). To know what the app shows, try app_state, app_chats or app_chat_items first (far fewer tokens); take a screenshot only to really see the UI.',
      inputSchema: obj(),
      run: async () => {
        const win = d.window();
        if (!win) return 'no window';
        const images: { data: string; mimeType: string; caption: string }[] = [];
        const ui = await win.webContents.capturePage();
        const p = previewOf(ui);
        images.push({ data: p.data, mimeType: p.mimeType, caption: `app UI ${ui.getSize().width}x${ui.getSize().height}, image ${p.width}x${p.height} (UI px = image px × ${fmtFactor(p.factor)})` });
        for (const v of win.contentView.children) {
          const wc = (v as { webContents?: Electron.WebContents }).webContents;
          if (!wc) continue;
          const b = v.getBounds();
          let img = await wc.capturePage();
          // an agent tab drawn scaled (browser/tabs.ts emulate) captures a desktop-size surface with the view in its corner
          const k = ui.getSize().width / Math.max(1, win.getContentSize()[0]!), s = img.getSize();
          if (s.width > Math.round(b.width * k) + 1) img = img.crop({ x: 0, y: 0, width: Math.min(s.width, Math.round(b.width * k)), height: Math.min(s.height, Math.round(b.height * k)) });
          const t = previewOf(img);
          images.push({ data: t.data, mimeType: t.mimeType, caption: `browser tab ${redact(wc.getURL())} at x=${b.x} y=${b.y} ${b.width}x${b.height}, image ${t.width}x${t.height} (capture px = image px × ${fmtFactor(t.factor)})` });
        }
        return { text: `${images.length} images`, images };
      },
    },
    {
      name: 'app_ui', description: 'Steer the UI (visual only, never the keyboard focus): action "maximize" (chat id), "restore", "page" (value: workspace|task|fatto|idee|costi|qualita|confronto|agenti|skill|regole|memoria|classificatori|collegamenti|esplora|mappa), "palette".',
      inputSchema: obj({ action: str('maximize|restore|page|palette'), value: str('argument of the action') }, ['action']),
      // only visual steering: never actions that move the keyboard focus (next, focus…): an agent must not be able to
      // put the user's next keystroke on a permission or into another chat's input (review 2026-10-11)
      run: a => {
        const action = String(a.action);
        if (!['maximize', 'restore', 'page', 'palette'].includes(action)) throw new Error(`app_ui: action not allowed for agents: ${action} (maximize|restore|page|palette)`);
        // Every worker and its browser can be maximized in the Grindhouse.
        if (action === 'maximize' && a.value !== undefined) { const v = String(a.value); const tab = d.browser.list().find(t => t.id === v); guard(tab?.ownerChatId ?? v); }
        d.emitUi({ action, value: a.value === undefined ? undefined : String(a.value) });
        return 'ok';
      },
    },
    {
      name: 'app_create_chat',
      description: 'Create a work chat in the app and start it with a prompt (the Orchestrator does this instead of the user). Never an Orchestrator: only the user picks it. Title "Area · cosa". Agent first (ADR 0078): pass agentId (from agent_catalog with request) and the agent\'s profile decides engine, model and effort; nothing overrides it (a profile with no model gets the routing table\'s model for this kind of work as a default). Without agentId the app asks the local classifier on title and prompt: a match above its threshold runs as that agent, otherwise Generale, routed by the table (Impostazioni → «Instradamento modelli»; no row = the user’s "Chat aperte dall’Orchestrator"). Naming harness/model/effort without agentId skips the classifier; differing from the table row is an override and needs a reason. parentRunId = the run this chat is a sub-agent of (it reports to that chat). The chat starts in the brain folder unless cwd is given (pick the repo or worktree from the task). The prompt is labelled as written by an agent. When no agent fits, propose a new one to the user in a panel first (agent_create with the panel answer), then start it here with its agentId.',
      inputSchema: obj({
        title: str('"Area · cosa", e.g. "Ordini · Fix totale"'), prompt: str('what the chat must do'),
        agentId: str('optional profile id from agent_catalog: its engine, model and effort decide (agent first); omitted = the classifier picks one above its threshold, else Generale. Manifest never grants access.'),
        agentVersion: { type: 'integer', description: 'Expected active definition version; refuse if it changed.' },
        parentRunId: str('Parent run ID'), reviewOf: str('Run being reviewed'), reworkOf: str('Run being reworked'), goal: str('Run goal, up to 2000 characters'),
        kind: str(`optional kind of task: ${TASK_KINDS.join(' | ')}; omitted: read from title and prompt`),
        harness: str(`optional engine id: ${engines().map(e => e.id).join(' | ')}; with agentId only the agent's own; omit it to let the agent or the routing table decide`),
        model: str('optional model id; with agentId only the agent\'s own; omit it to let the agent or the routing table decide'),
        effort: str('optional reasoning effort: low | medium | high | xhigh | max (max only when the user asked); with agentId only the agent\'s own'),
        reason: str('without agentId: why, when harness/model/effort differ from what the table says (required then)'),
        cwd: str('optional absolute folder (repo or worktree); default: the brain folder'),
        where: str('optional: "local" (default) or "cloud" = an agent in the vendor\'s cloud (harness cursor | codex | claude, default cursor; cwd must be a GitHub checkout on a branch already pushed; it pushes only its own cursor/… codex/… claude/… branch; Cursor bills at API prices and is blocked over the Cursor daily budget). Only when the user asked for a cloud agent.'),
        env: str('optional, where "cloud" + harness codex: the Codex cloud environment id (remembered per repo)'),
      }, ['title', 'prompt']),
      run: async a => {
        // only the user chooses the Regia (one at a time: a new one would take the role from the agent's own chat)
        const links: { parentRunId?: string; reviewOf?: string; reworkOf?: string; goal?: string; agentVersion?: number } = {};
        for (const key of ['parentRunId', 'reviewOf', 'reworkOf', 'goal'] as const) if (a[key] !== undefined) {
          if (!unified() || typeof a[key] !== 'string' || !a[key].trim() || a[key].length > (key === 'goal' ? 2000 : 80)) throw new Error('Invalid or unauthorized run link/goal.');
          links[key] = a[key];
        }
        if (a.agentVersion !== undefined) {
          if (!unified() || !Number.isSafeInteger(a.agentVersion) || Number(a.agentVersion) < 1 || typeof a.agentId !== 'string') throw new Error('Invalid agent version.');
          links.agentVersion = Number(a.agentVersion);
        }
        const cwd = typeof a.cwd === 'string' && a.cwd.trim() ? a.cwd.trim() : d.brain.info().brainRoot;
        if (!cwd) throw new Error('nessuna cartella: il cervello non è collegato');
        // a chat in the app's code folder or one of its worktrees works on the app (routing area App)
        const app = await d.code?.inRepo?.(cwd) ?? false;
        if (a.regia !== undefined && a.regia !== false) throw new Error('app_create_chat crea solo chat di lavoro: l’Orchestrator lo sceglie l’utente (Nuova chat → «È l’Orchestrator» o «Cambia motore»)');
        const title = String(a.title ?? '').trim().slice(0, 80), prompt = String(a.prompt ?? '').trim();
        if (!title || !prompt || prompt.length > 8000) throw new Error('title and prompt are required (prompt ≤ 8000 chars)');
        // a former Regia's title is the Orchestrator's mail box: a new chat may not take its mail
        if (claimsAlias(title, d.chats.list())) throw new Error(`The title «${title}» is reserved for the Orchestrator's mail: choose another.`);
        const s = d.brain.settings();
        if (a.where !== undefined && a.where !== 'local' && a.where !== 'cloud') throw new Error('where: local | cloud');
        if (a.where === 'cloud') {
          if (!d.cloud) throw new Error('agenti cloud non disponibili');
          const engine = a.harness === undefined || a.harness === null || a.harness === '' ? 'cursor' : a.harness;
          if (!isCloudEngine(engine)) throw new Error('where "cloud": harness cursor | codex | claude');
          const refused = openRefusal(s, caller()?.harness ?? 'claude', engine);
          if (refused) throw new Error(`bloccato: ${refused}`);
          const agent = await d.cloud.start({ engine, cwd, title, prompt: `${AGENT_LABEL}\n\n${prompt}`, ...(typeof a.model === 'string' && a.model ? { model: a.model } : {}), ...(typeof a.env === 'string' ? { env: a.env } : {}) }, 'agent');
          log.info('appctl', 'agent started a cloud agent', { data: { engine, title, id: agent.id, repo: agent.repo } });
          return { cloudAgentId: agent.id, engine, title: agent.title, status: agent.status, repo: agent.repo, ...(agent.branch ? { branch: agent.branch } : {}), url: agent.url };
        }
        const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
        const kind = text(a.kind);
        if (kind && !(TASK_KINDS as readonly string[]).includes(kind)) throw new Error(`kind sconosciuto: ${kind} (${TASK_KINDS.join(' | ')})`);
        const askedEffort: string | null | undefined = text(a.effort);
        if (askedEffort && !(EFFORTS as readonly string[]).includes(askedEffort)) throw new Error(`effort: ${EFFORTS.join(' | ')}`);
        let said: Harness | undefined = typeof a.harness === 'string' && engineOf(a.harness) ? a.harness : undefined;
        if (a.harness !== undefined && a.harness !== null && a.harness !== '' && !said) throw new Error(`harness: ${engines().map(e => e.id).join(' | ')}`);
        const askedModel: string | null | undefined = text(a.model);
        let selected: AgentCatalog['profiles'][number] | undefined;
        // the caller is the Regia (the only chat given these tools), on any engine: a chat on another engine spends that
        // engine's tokens, so it starts only when the user allows chats across engines (engines/policy.ts)
        const regia = caller();
        const from = regia?.harness ?? 'claude';
        // agent first (ADR 0078): who chose the agent, and the classifier's view when it chose (or found none)
        let chosenBy: RouteAgent['chosenBy'] = links.parentRunId ? 'parent' : 'orchestrator';
        let scored: { score: number; threshold: number; mode: RouteAgent['mode'] } | undefined;
        let fallback: RouteAgent | undefined;
        if (a.agentId !== undefined) {
          if (typeof a.agentId !== 'string') throw Error('agentId non valido.');
          const catalog = d.agents?.();
          if (!catalog || catalog.problem) throw Error('Catalogo Agenti non disponibile.');
          selected = catalog.profiles.find(p => p.id === a.agentId);
          if (!selected) throw Error('Agente non trovato.');
          if (said && said !== selected.engine || askedModel !== undefined && askedModel !== selected.model || askedEffort !== undefined && askedEffort !== selected.effort) throw Error('La configurazione non corrisponde all’Agente scelto.');
        } else if (!said && askedModel === undefined && askedEffort === undefined && d.agents && d.classifyAgents) {
          // no agent named: the local classifier ($0, no model call) on the chat's title and prompt; the first match above
          // its threshold that may start now runs the chat, else Generale (the table routes it)
          const catalog = d.agents();
          if (!catalog.problem) {
            try {
              const c = await d.classifyAgents(`${title}\n\n${prompt}`.slice(0, 2000), catalog);
              for (const cand of c.candidates) {
                // Generale ranked first is a match of Generale: the fallback, not the next agent down
                if (cand.score < c.threshold || cand.id === GENERAL_AGENT_ID) break;
                const p = catalog.profiles.find(x => x.id === cand.id && x.status === 'active' && x.routable !== false && x.id !== ORCHESTRATOR_AGENT_ID);
                const e = p && catalog.models.find(m => m.engine === p.engine);
                if (!p || !e?.enabled || !e.trusted || openRefusal(s, from, p.engine)) continue;
                selected = p; chosenBy = 'classifier'; scored = { score: cand.score, threshold: c.threshold, mode: c.mode };
                break;
              }
              if (!selected) {
                const g = catalog.profiles.find(x => x.id === GENERAL_AGENT_ID);
                fallback = { id: GENERAL_AGENT_ID, version: g?.activeVersion ?? 0, chosenBy: 'fallback', threshold: c.threshold, mode: c.mode, ...(c.candidates[0] ? { score: c.candidates[0].score } : {}) };
              }
            } catch (e) { log.warn('appctl', 'agent classifier failed: the chat starts as Generale', { cause: errText(e), hint: 'check the local classifier (Agenti → Classificatori); the routing table decides meanwhile' }); }
          }
        }
        // a model id belongs to one engine: without harness, the registry says which; an unknown one needs harness
        if (askedModel && !said && !selected) {
          const row = modelRow(askedModel, d.brain.routingInfo().registry);
          if (!row || !engineOf(row.harness)) throw new Error('model without harness: say harness too, or omit both to let the routing table decide');
          said = row.harness;
        }
        // an agent's profile decides (ADR 0078); what nobody names comes from the routing table, else from the user's
        // "Chat aperte dalla Regia" (read now); a row on an engine this Regia may not start now leaves it to the defaults
        const agent = selected ? { id: selected.id, name: selected.name, version: selected.activeVersion, harness: selected.engine, model: selected.model, effort: selected.effort ?? null,
          chosenBy, ...(scored ?? {}), stats: d.agentStats?.(selected.id, selected.activeVersion) ?? null } : undefined;
        const routed = d.brain.route({
          ...(selected ? { api: null, agent } : {}),
          canRun: h => !openRefusal(s, from, h),
          title, prompt, ...(kind ? { kind: kind as TaskKind } : {}), appCode: app,
          ask: selected ? {} : { ...(said ? { harness: said } : {}), ...(askedModel !== undefined ? { model: askedModel } : {}), ...(askedEffort !== undefined ? { effort: askedEffort as Effort | null } : {}), ...(text(a.reason) ? { reason: text(a.reason)!.slice(0, 300) } : {}) },
          defaults: { harness: s.regiaChats.harness, models: { claude: s.regiaChats.claudeModel || null, cursor: s.regiaChats.cursorModel || null }, effort: s.regiaChats.claudeEffort || null },
        });
        if ('error' in routed) throw new Error(`app_create_chat: ${routed.error}`);
        const { harness, model, effort } = routed;
        const route = fallback ? { ...routed.route, agent: fallback } : routed.route;
        const refused = openRefusal(s, from, harness);
        if (refused) throw new Error(`bloccato: ${refused}`);
        // a work chat answers to the Regia that opens it: its questions go to her tab, and it knows whom to write to
        const parentChat = links.parentRunId ? d.chats.list().find(c => c.run?.runId === links.parentRunId) : undefined;
        const yours = (regia ? `\n\nIl tuo Orchestrator è «${regia.title}»: scrivigli con send_to_chat.` : '')
          + (parentChat ? `\nSei un sotto-agente di «${parentChat.title}»: quando hai finito mandagli il risultato con send_to_chat.` : '')
          + '\nPer un sotto-compito puoi avviare un agente del catalogo come tuo sotto-agente: agent_catalog (con request) e poi agent_start_subagent.';
        const chat = await d.chats.create({ harness, cwd, title, prompt: `${AGENT_LABEL}${yours}\n\n${prompt}`, ...links, regia: false, ...(selected ? { agentId: selected.id } : {}), ...(regia ? { regiaOf: regia.id } : {}), ...(model ? { model } : {}), ...(effort ? { effort } : {}), route }, 'agent');
        log.info('appctl', 'agent created a chat', { chat: chat.id, data: { harness, title, model: model || null, effort, route: route.source, kind: route.kind, area: route.area, version: route.version, reason: route.reason, ...(route.agent ? { agent: route.agent } : {}) } });
        // the machine is busy: the chat exists, its first turn waits in the CPU queue (ADR 0036)
        return { chatId: chat.id, title: chat.title, harness, cwd, model: model || null, effort, ...(chat.queued ? { status: queuedLine(chat.queued) } : {}), route: { source: route.source, kind: route.kind, area: route.area, tableVersion: route.version, reason: route.reason, ...(route.agent ? { agent: route.agent } : {}) } };
      },
    },
    {
      name: 'app_send_to_chat', description: 'Send a message to an app chat (a closed one is reopened by itself and resumes). It is labelled as written by an agent, not by the user (never an ok or a permission).',
      inputSchema: obj({ chatId: str('chat id'), text: str('message') }, ['chatId', 'text']),
      run: async a => {
        const text = String(a.text ?? '').trim();
        if (!text || text.length > 4000) throw new Error('text empty or longer than 4000 chars');
        // A chat on another engine than the caller's (the Regia's) spends that engine's tokens: an agent may write to one
        // only when the user allows chats across engines (engines/policy.ts; inbox.mjs obeys the same switch) and only if
        // it is already running — an agent never starts a stopped engine of another kind (review 2026-10-11).
        const target = d.chats.list().find(c => c.id === String(a.chatId));
        if (target && !mine(target)) throw new Error(`chat non trovata: ${target.id} (vedi app_chats)`);
        const regia = caller();
        const from = regia?.harness ?? 'claude';
        if (target && target.harness !== from) {
          const name = engineLabel(target.harness);
          const refused = crossRefusal(d.brain.settings(), from, target.harness);
          if (refused) throw new Error(`messaggio bloccato: ${refused}`);
          if (!['running', 'waiting', 'idle'].includes(target.state)) throw new Error(`la chat ${name} non è attiva: un agente non la avvia (spenderebbe crediti ${name}); chiedi all’utente`);
        }
        await d.chats.send(String(a.chatId), `${AGENT_LABEL}\n\n${text}`, undefined, false, regia?.title ?? 'Orchestrator');
        log.info('appctl', 'agent message sent to chat', { chat: String(a.chatId), data: { chars: text.length } });
        const q = d.chats.list().find(c => c.id === String(a.chatId))?.queued;
        return q ? queuedLine(q) : 'sent';
      },
    },
    {
      name: 'app_handoff_chat',
      description: 'A chat writes its hand-off note now (state, files and worktree, decisions, tried and dropped, next step), saved by the app; returns the note and its path. Refused while the chat works or waits for the user. A stopped Cursor chat is never started: the app builds the note itself.',
      inputSchema: obj({ chatId: str('chat id from app_chats') }, ['chatId']),
      run: async a => {
        const target = need(String(a.chatId));
        // an engine switched off in the settings is never started for this: the app builds the note itself
        const allowStart = crossRule(target, 'leggere') && agentsMayOpen(d.brain.settings(), target.harness);
        const h = await d.chats.handoff(target.id, { reason: 'manual', allowStart });
        log.info('appctl', 'agent asked a hand-off', { chat: target.id, data: { source: h.source } });
        return { chatId: h.chatId, path: h.path, source: h.source, at: new Date(h.at).toISOString(), text: h.text };
      },
    },
    {
      name: 'app_continue_chat',
      description: '"Riprendi": explicitly opens a NEW chat on the same engine and folder from the old chat\'s hand-off (written first if missing or stale); the old chat stops and stays readable, linked both ways. Use only for an intentional new task/session or requested handoff, never merely because context is long. The engine manages native compaction. Not for the Orchestrator.',
      inputSchema: obj({ chatId: str('chat id from app_chats') }, ['chatId']),
      run: async a => {
        const target = need(String(a.chatId));
        // the engine first (on, and the Regie allowed there), then the rule across engines with the engine named
        const st = d.brain.settings();
        if (!agentsMayOpen(st, target.harness)) throw new Error(`bloccato: ${openRefusal(st, target.harness, target.harness)}`);
        const allowStart = crossRule(target, 'riprendere');
        const chat = await d.chats.continueChat(target.id, { allowStart, promptPrefix: AGENT_LABEL });
        log.info('appctl', 'agent continued a chat in a new one', { chat: target.id, data: { next: chat.id } });
        return { chatId: chat.id, title: chat.title, harness: chat.harness, continuedFrom: target.id };
      },
    },
    {
      name: 'app_routing',
      description: 'The model routing table in force (rows: kind, area, model, effort, why; exploration rate), the models it may pick, the rule for the app\'s chats, and its last changes (who, when, why, with what data). Read it before app_routing_save.',
      inputSchema: obj(),
      run: () => {
        const i = d.brain.routingInfo();
        const auto = (i.registry?.models ?? []).filter(m => m.routing === 'auto' && i.registry?.harnesses[m.harness]?.routing === 'auto' && !isFable(m));
        return { table: i.table, error: i.error, kinds: i.kinds, pickable: auto.map(m => ({ id: m.id, harness: m.harness, efforts: m.efforts.filter(e => e !== 'max'), price: m.price })),
          appChats: i.registry?.appChats ?? null, history: i.history.slice(0, 10) };
      },
    },
    {
      name: 'app_routing_save',
      description: 'Write a new version of the model routing table by yourself (the user, 2026-10-14: the AI decides the models of new chats and sub-agents in full autonomy; he sees and edits the same table in Impostazioni → «Instradamento modelli» and restores any version with one click). Send the WHOLE table (every row, as app_routing returns it, with your changes), why you change it and the data behind it (outcomes, costs, counts). App-area chats may use any available engine under the same launch permissions as other chats. Refused when it breaks a hard rule: unknown or manual model, a model on another engine, a table changed since baseVersion, a row the user locked (locked: true; keep it as is, never lock or unlock one), Fable, max effort, a row without its why (you always write it; the user may leave it out), exploration outside 0-0.5.',
      inputSchema: obj({
        routes: { type: 'array', description: 'every row: { kind (task kind or "*"), area? (string or list), harness, model, effort (or null), why, since?, evidence? }', items: { type: 'object' } },
        // the cost weight (costWeight) is the user's: not a parameter, a save keeps it
        exploration: num('optional share of chats that try a little-sampled model of the same engine, 0 to 0.5; omitted = unchanged'),
        reason: str('why this change (shown to the user in the table\'s history)'),
        evidence: str('the data behind it: outcomes, costs, counts, the ledger lines you read'),
        baseVersion: num('the table version you read with app_routing: refused when another version is in force since (reload, redo the change)'),
      }, ['routes', 'reason', 'evidence', 'baseVersion']),
      run: a => {
        const reason = String(a.reason ?? '').trim().slice(0, 300), evidence = String(a.evidence ?? '').trim().slice(0, 300);
        if (!reason || !evidence) throw new Error('reason ed evidence sono obbligatori: perché cambi e con quali dati');
        if (!Array.isArray(a.routes)) throw new Error('routes: la tabella intera (vedi app_routing)');
        if (!Number.isInteger(a.baseVersion)) throw new Error('baseVersion: la versione letta con app_routing');
        const who = caller()?.title ?? 'Orchestrator';
        const i = d.brain.saveRouting(a.routes as RoutingRow[], reason, { ...(a.exploration === undefined || a.exploration === null ? {} : { exploration: Number(a.exploration) }), by: `agente: ${who}`, evidence, base: a.baseVersion as number });
        log.info('appctl', 'agent saved the routing table', { data: { version: i.table?.version ?? null, by: who, reason } });
        return { version: i.table?.version ?? null, exploration: i.table?.exploration ?? null, rows: i.table?.routes.length ?? 0 };
      },
    },
  ];
  // only the authenticated Orchestrator mount (/mcp/app/r/<id>/<token>): the plain mount is open to local processes
  if (d.code?.pull && unified()) {
    const pull = d.code.pull;
    tools.push({
      name: 'app_update_code',
      description: `Only when the user asked in their own words to update the app ("aggiornati", "aggiorna l'app"): brings the app's code folder up to date with GitHub (scripts/pull.mjs: fetch main, fast-forward only, never merges or drops local work, never pushes), reinstalls the pinned dependencies if the lockfile changed and builds. It never promotes or restarts. Refused unless the user wrote to the Orchestrator in the last ${PULL_ASK_MIN} minutes. Then tell the user the result: a dev app run from the checkout picks it up when restarted; to switch at once, the user presses «Aggiorna» in Impostazioni → Aggiornamenti.`,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      inputSchema: obj(),
      run: async () => {
        const regia = caller();
        if (!unified() || !regia) throw new Error('bloccato: solo l’Orchestrator aggiorna il codice dell’app, quando l’utente lo chiede');
        if (!decidedSince(regia.id, Date.now() - PULL_ASK_MIN * 60_000)) throw new Error('bloccato: l’utente non ha chiesto di aggiornare l’app. Aggiorna solo se te lo chiede lui');
        return pull();
      },
    });
  }
  return tools;

  /** did the user write to the Regia, or answer one of its questions, at or after `at`? (his decision, not the agent's) */
  function decidedSince(regiaId: string, at: number): boolean {
    return d.chats.items(regiaId).some(i => i.at >= at && (
      i.kind === 'user' ? !labelled(i.text) : i.kind === 'tool' && /question/i.test(i.name) && i.status === 'ok'));
  }

  function need(chatId: string): ChatSummary {
    const c = d.chats.list().find(x => x.id === chatId && mine(x));
    if (!c) throw new Error(`chat sconosciuta: ${chatId}`);
    return c;
  }

  /** A chat on another engine than the caller's (the Regia's, as in app_send_to_chat) spends that engine's credits:
   *  allowed only as engines/policy.ts says, and a stopped one is never started (false = only if already running; the
   *  hand-off then gets a token-free note from the app). Chats of the caller's own engine: true. */
  function crossRule(c: ChatSummary, verb: string): boolean {
    const from = caller()?.harness ?? 'claude';
    if (c.harness === from) return true;
    const refused = crossRefusal(d.brain.settings(), from, c.harness);
    if (refused) throw new Error(`bloccato: un agente non può ${verb} una chat ${engineLabel(c.harness)}: ${refused}`);
    return ['running', 'waiting', 'idle'].includes(c.state);
  }
}
