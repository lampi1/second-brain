// The fake-engine fixture of a Strategist's plan with the user (a real ChatManager, the real strategy and delegation
// tools, no engine): shared by test/unit/agents/strategy.test.ts and strategy-handover.test.ts. Not a test file.
import { afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions, SessionSink } from '../../../src/main/chats/session';
import { delegationTools } from '../../../src/main/agents/delegation';
import { strategyTools } from '../../../src/main/agents/strategy-tools';
import { ROLE_DEFAULTS, ROLE_IDS, DELEGATION_DEFAULTS, isWorkRole, type DelegationSettings, type RoleId } from '../../../src/shared/roles';
import type { AgentCatalog } from '../../../src/shared/agents';
import type { NewChat } from '../../../src/shared/contract';
import type { McpTool } from '../../../src/main/mcp/server';
import type { PermissionCeiling, ToolClass } from '../../../src/shared/agents';

/** Roles a user narrowed: tools, ceiling and launches per role (the rest stays the default). */
export type Narrowed = Partial<Record<RoleId, { tools: ToolClass[]; ceiling: PermissionCeiling | null; launches: string[] }>>;
/** Every role narrowed back to ADR 0083's restrictive defaults, as a user could set them on the cards. */
const shape = (id: RoleId, n: Narrowed = {}) => { const r = ROLE_DEFAULTS[id]; return n[id] ?? { tools: r.tools, ceiling: r.ceiling, launches: r.launches }; };

export const roots: string[] = [], managers: ChatManager[] = [];
/** the delegation tools' clock (the stall check); undefined = Date.now */
let clock: (() => number) | undefined;
afterEach(async () => { clock = undefined; for (const m of managers.splice(0)) await m.shutdown(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

export const catalog = (n: Narrowed = {}): AgentCatalog => ({ problem: null, archived: [], models: [], profiles: ROLE_IDS.map(id => {
  const r = ROLE_DEFAULTS[id], x = shape(id, n);
  return { id, name: r.name, purpose: r.summary, scope: 'role', engine: 'claude', model: null, tier: r.tier, tierMax: r.tierMax,
    launches: [...x.launches], skills: r.skills, tools: { allow: [...x.tools] }, permissionCeiling: x.ceiling, activeVersion: 1, updatedAt: 1, instructions: r.instructions };
}) } as unknown as AgentCatalog);

export function fixture(limits: Partial<DelegationSettings> = {}, roles?: () => AgentCatalog, onSend?: (chatId: string) => void, narrowed: Narrowed = {}, remembered: [string, string][] = [], away = false) {
  roles ??= () => catalog(narrowed);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-delegation-'));
  roots.push(dir);
  const starts = new Map<string, SessionOptions>(), sinks = new Map<string, SessionSink>(), sent = new Map<string, string[]>(), answers: { chat: string; id: string; answer: { allow?: boolean; message?: string }; patch?: Record<string, string> }[] = [];
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, away: () => away,
    // a report pasted as JSON goes through the real agent_report (ADR 0356), as wiring.ts does
    callChatTool: async (chatId, name, args) => String(await tool(name).run(args, { mount: 'chat', params: { chatId }, sessionId: '', signal: new AbortController().signal } as never)),
    resolveAgent: (req: NewChat) => {
      const id = req.orchestrator ? 'orchestrator' : req.roleId as RoleId | undefined;
      if (!id || (!isWorkRole(id) && id !== 'orchestrator')) return { request: req, owner: { id: 'plain', name: 'Chat', purpose: '', engine: req.harness, model: null, revision: 0, source: 'plain' as const }, instructions: '', policy: null, skills: [], launches: [] };
      const r = ROLE_DEFAULTS[id], x = shape(id, narrowed);
      return { request: req, owner: { id, name: r.name, purpose: r.summary, engine: 'claude', model: null, revision: 1, source: 'catalog' as const, version: 1 }, instructions: r.instructions,
        policy: { tools: { allow: [...x.tools] }, ceiling: x.ceiling }, skills: [...r.skills, ...(req.skills ?? [])], launches: [...x.launches], assets: { pluginDir: path.join(dir, 'p'), skillRoot: path.join(dir, 'p', 'skills') } };
    },
    sessionFactory: (_h, o, s) => {
      starts.set(o.chatId, o); sinks.set(o.chatId, s);
      return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
        start() { s.changed({ state: 'idle' }); }, send(text: string) { sent.set(o.chatId, [...(sent.get(o.chatId) ?? []), text]); onSend?.(o.chatId); },
        close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {},
        answer: (id: string, answer: { allow?: boolean; message?: string }, patch?: Record<string, string>) => { answers.push({ chat: o.chatId, id, answer, ...(patch ? { patch } : {}) }); return true; },
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
      } as unknown as HarnessSession;
    } });
  managers.push(m);
  const tools = [...strategyTools(m), ...delegationTools({ chats: m, roles, settings: () => ({ ...DELEGATION_DEFAULTS, ...limits }), engineRefusal: () => null, label: '[agente]', runs: () => m.runs.list(), now: () => (clock ?? Date.now)(),
    remember: (role, line) => { remembered.push([role, line]); } })];
  const tool = (name: string): McpTool => tools.find(t => t.name === name)!;
  const call = async (name: string, chatId: string, args: Record<string, unknown>) => JSON.parse(await tool(name).run(args, { mount: 'chat', params: { chatId }, sessionId: '', signal: new AbortController().signal } as never) as string);
  const root = (role: RoleId, cwd = dir, by: 'user' | 'agent' = 'agent') => m.create({ harness: 'claude', cwd, roleId: role, title: `${ROLE_DEFAULTS[role].name} root`, prompt: 'Porta gli sconti in percentuale' }, by);
  const task = (role: string, title: string, extra: Record<string, unknown> = {}) => ({ role, title, contract: { goal: `Goal of ${title}`, doneWhen: ['criterion A'], ...extra } });
  return { m, dir, starts, sinks, sent, answers, call, root, task };
}

export const STEPS3 = [{ title: 'Trovo dove si calcola lo sconto', role: 'scout' }, { title: 'Applico lo sconto', role: 'artisan' }, { title: 'Scrivo il riepilogo' }];
/** An ordinary plan proposal. Its doubts are listed: none is open. */
export const PLAN = { steps: STEPS3, doneWhen: 'I test passano', doubts: [] };
export const planOf = (f: ReturnType<typeof fixture>, id: string) => f.m.list().find(c => c.id === id)!.plan!;
/** the user's click on the plan they see now */
export const decide = (f: ReturnType<typeof fixture>, id: string, d: 'approve' | 'change', text?: string) => f.m.planDecide(id, d, planOf(f, id).at, text);

export async function answerPanel(f: ReturnType<typeof fixture>, chatId: string, question: string, value: string, tool = 'AskUserQuestion', source: 'pc' | 'phone' | 'relay' = 'pc') {
  const q = { question, options: [{ label: 'Sì' }, { label: 'No' }], multiSelect: false };
  // Identical wording on a new panel is still a new request, never a recycled engine callback (ADR 0234).
  const id = randomUUID();
  f.sinks.get(chatId)!.pending({ id, type: 'question', tool, title: question, detail: '', input: {}, questions: [q], at: Date.now() });
  passUp(f.m, chatId);
  await f.m.answer(chatId, id, { kind: 'question', answers: { [question]: value } }, source);
}
/** a chat an Orchestrator opened asks it first (ADR 0344): it does not know, the question reaches the user */
export function passUp(m: ChatManager, chatId: string) {
  for (const o of m.list().filter(c => c.isOrchestrator)) for (const h of m.ladderHeldBy(o.id)) if (h.chatId === chatId) void m.ladderReply(o.id, { chatId, askUser: true });
}

