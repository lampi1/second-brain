// The lessons queue (ADR 0077, replacing the learned-rule approvals of ADR 0073): the Orchestrator records a lesson from
// the user's corrections with agent_learn_propose, and the brain model's "corrections" maintenance job applies it at once,
// without the user's approval, to the agent's role, to a skill or to a rule (brainmodel/jobs.ts), logged with an undo.
// A work chat (its own token endpoint, chatLearnTool) may only propose a lesson for its own open run's agent, never a
// rule for every agent, and its lesson waits (fromChat) until the authenticated Orchestrator accepts it with the user.
// Lessons no longer live in an agent's own skill (learned-rules.md). Also the agent save path of the Agenti editor.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AgentDraft, AgentProfile } from '../../../shared/agents';
import type { LearnedRuleProposal, LessonTarget } from '../../../shared/agent-pack';
import type { AgentRun } from '../../../shared/agents';
import { readLocal, writeLocal } from '../local-store';
import { checkPermissionText } from '../author-policy';
import type { AgentPackFlows } from './flows';
import type { McpTool } from '../../mcp/server';

export class AgentPackLearning {
  private readonly file: string;
  private proposals: LearnedRuleProposal[];
  constructor(private readonly flows: AgentPackFlows, userData: string) {
    this.file = path.join(userData, 'agent-learn-proposals.json');
    const raw = readLocal(this.file) as { proposals?: LearnedRuleProposal[] } | undefined;
    if (raw && (!Array.isArray(raw.proposals) || raw.proposals.length > 500 || raw.proposals.some(p => !p || typeof p.rule !== 'string' || typeof p.evidence !== 'string' || !['pending', 'approved', 'discarded'].includes(p.status) || (p.fromChat !== undefined && typeof p.fromChat !== 'string')))) throw new Error('Invalid learned-rule proposal store');
    this.proposals = raw?.proposals ?? [];
  }
  private persist(): void { writeLocal(this.file, { version: 1, proposals: this.proposals }); }
  /** Called after a lesson is queued: the service runs the corrections job (wired by brainmodel/service.ts). */
  onProposed: (() => void) | null = null;
  /** fromChat = the work chat that proposed it (its own endpoint): the lesson waits for the Orchestrator and the user. */
  propose(agentId: string, rule: string, evidence: string, target?: LessonTarget, skill?: string, fromChat?: string): LearnedRuleProposal {
    this.flows.profile(agentId);
    if (typeof rule !== 'string' || !rule.trim() || rule.length > 2000 || /[\r\n\0]/.test(rule) || typeof evidence !== 'string' || !evidence.trim() || evidence.length > 500 || /[\r\n\0]/.test(evidence)) throw new Error('A learned rule needs bounded text and evidence');
    if (target !== undefined && !['role', 'skill', 'rule'].includes(target)) throw new Error('target is role, skill or rule');
    if (fromChat !== undefined && target === 'rule') throw new Error('A work chat cannot add a rule for every agent: send it to your Orchestrator.');
    checkPermissionText(rule);
    if (skill !== undefined && (typeof skill !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill) || skill.length > 64)) throw new Error('Invalid skill name');
    if (this.proposals.filter(p => p.status === 'pending').length >= 200) throw new Error('Too many lessons waiting: the maintenance applies them first');
    if (fromChat !== undefined && this.waiting().length >= 50) throw new Error('Too many lessons waiting for the Orchestrator: send this one with send_to_chat instead.');
    const proposal: LearnedRuleProposal = { id: randomBytes(8).toString('hex'), agentId, rule: rule.trim(), evidence: evidence.trim(), createdAt: Date.now(), status: 'pending',
      ...(target ? { target } : {}), ...(skill ? { skill } : {}), ...(fromChat ? { fromChat } : {}) };
    this.proposals = [...this.proposals.slice(-499), proposal]; this.persist();
    if (!fromChat) try { this.onProposed?.(); } catch { /* the next maintenance pass applies it */ }
    return structuredClone(proposal);
  }
  /** Lessons the corrections job applies, oldest first: a work chat's lesson only once accepted. */
  pending(): LearnedRuleProposal[] { return structuredClone(this.proposals.filter(p => p.status === 'pending' && !p.fromChat)); }
  /** Work chats' lessons waiting for the Orchestrator and the user, oldest first. */
  waiting(): LearnedRuleProposal[] { return structuredClone(this.proposals.filter(p => p.status === 'pending' && !!p.fromChat)); }
  /** The authenticated Orchestrator's decision on a waiting lesson (agent_lessons_waiting): accepted = applied by the job. */
  review(id: string, accept: boolean): LearnedRuleProposal {
    const p = this.proposals.find(x => x.id === id && x.status === 'pending' && !!x.fromChat);
    if (!p || typeof accept !== 'boolean') throw new Error('Waiting lesson not found.');
    if (accept) checkPermissionText(p.rule);
    const next: LearnedRuleProposal = { ...p, note: accept ? `accettata (da ${p.fromChat})` : 'rifiutata', ...(accept ? {} : { status: 'discarded' as const }) };
    if (accept) delete next.fromChat;
    this.proposals = this.proposals.map(x => x === p ? next : x);
    this.persist();
    if (accept) try { this.onProposed?.(); } catch { /* the next maintenance pass applies it */ }
    return structuredClone(this.proposals.find(x => x.id === id)!);
  }
  /** The job's outcome for one lesson: applied (where, in `note`) or discarded (why). */
  settle(id: string, status: 'approved' | 'discarded', note: string): void {
    this.proposals = this.proposals.map(p => p.id === id && p.status === 'pending' ? { ...p, status, note: note.slice(0, 300) } : p);
    this.persist();
  }
  save(draft: AgentDraft, id?: string): AgentProfile {
    const previous = id ? this.flows.profile(id) : undefined;
    this.flows.root(); this.flows.deps.catalog.validateDraft(draft);
    const createdId = id ?? `agent-${randomBytes(8).toString('hex')}`;
    const seed = previous ?? { ...draft, id: createdId } as AgentProfile;
    const files = this.flows.ownSkills(seed, true), knowhow = this.flows.persistSkills(createdId, files, previous?.knowhow?.linked);
    const profile = this.flows.deps.catalog.save({ ...draft, knowhow }, id, id ? undefined : createdId);
    this.flows.publishCurrent(profile); return profile;
  }
}

/** The lessons tool on the app endpoints. With `setting` (the authenticated Orchestrator only), it also takes a "Contesto
 *  massimo" change (maxContext, issue #80): an agent_update, applied at once as a trial version with an undo (ADR 0082:
 *  part of the agent's profile, not an app setting). With `queueAs` (an endpoint that is not the authenticated
 *  Orchestrator), the lesson waits like a work chat's (fromChat) and may not be a rule for every agent. */
export function agentLearnTool(service: AgentPackLearning, setting?: (agentId: string, patch: { maxContext: number | null }, evidence: string, callerChatId: string | undefined) => unknown, queueAs?: string): McpTool {
  return { name: 'agent_learn_propose', description: queueAs ? 'Record one lesson from the user\'s corrections, with evidence (run ids). It waits for the Orchestrator and the user before it is applied: target "role" (default) for the agent\'s role, "skill" for the named skill. Never for permissions, settings or hooks.'
    : `Record one lesson from the user's corrections, with evidence (run ids). The app applies it at once, without asking the user, and logs it with an undo: target "role" (default) adds it to the agent's role, "skill" to the named skill (how a job is done), "rule" to the brain's rules (applies to every agent). Never for permissions, settings or hooks. Lessons proposed by work chats wait in agent_lessons_waiting.${setting ? ' To propose the agent\'s maximum context instead, pass maxContext (tokens, 100000-1000000, or null for the app setting) with evidence and no rule: it is part of the agent’s profile, so it applies at once as a trial version, logged with an undo (only Claude engines apply it).' : ''}`,
    inputSchema: { type: 'object', properties: { agentId: { type: 'string' }, rule: { type: 'string' }, evidence: { type: 'string' }, target: { type: 'string', enum: queueAs ? ['role', 'skill'] : ['role', 'skill', 'rule'] }, skill: { type: 'string' }, ...(setting ? { maxContext: { type: ['integer', 'null'], minimum: 100000, maximum: 1000000 } } : {}) }, required: setting ? ['agentId', 'evidence'] : ['agentId', 'rule', 'evidence'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (args, ctx) => {
      if (setting && args.maxContext !== undefined) {
        if (Object.keys(args).some(k => !['agentId', 'evidence', 'maxContext'].includes(k)) || typeof args.agentId !== 'string' || typeof args.evidence !== 'string' || !(args.maxContext === null || Number.isSafeInteger(args.maxContext))) throw new Error('Invalid maximum-context proposal: agentId, evidence and maxContext (integer or null), no rule');
        return Promise.resolve(setting(args.agentId, { maxContext: args.maxContext as number | null }, args.evidence, ctx?.params?.chatId)).then(r => JSON.stringify(r));
      }
      const lesson = parseLesson(args);
      if (lesson.agentId === undefined) throw new Error('Invalid lesson: agentId required');
      return JSON.stringify(service.propose(lesson.agentId, lesson.rule, lesson.evidence, lesson.target, lesson.skill, queueAs));
    } };
}

function parseLesson(args: Record<string, unknown>): { agentId?: string; rule: string; evidence: string; target?: LessonTarget; skill?: string } {
  if (Object.keys(args).some(k => !['agentId', 'rule', 'evidence', 'target', 'skill'].includes(k)) || (args.agentId !== undefined && typeof args.agentId !== 'string') || typeof args.rule !== 'string' || typeof args.evidence !== 'string'
    || (args.target !== undefined && typeof args.target !== 'string') || (args.skill !== undefined && typeof args.skill !== 'string')) throw new Error('Invalid lesson');
  return { agentId: args.agentId as string | undefined, rule: args.rule, evidence: args.evidence, target: args.target as LessonTarget | undefined, skill: args.skill as string | undefined };
}

/** agent_learn_propose on a work chat's own token endpoint (wiring.ts addChatTools): a lesson for the agent of the
 *  caller's open run only (the chat the token names, never an argument), as role or skill, never a rule for every agent,
 *  and queued: it waits until the authenticated Orchestrator accepts it with the user (agent_lessons_waiting). */
export function chatLearnTool(service: AgentPackLearning, runs: () => readonly AgentRun[]): McpTool {
  return { name: 'agent_learn_propose', description: 'Record one lesson from the user\'s corrections about YOUR agent (the one your chat runs as), with evidence (run ids). It waits for your Orchestrator and the user before it is applied: target "role" (default) for your role, "skill" for the named skill. Never for permissions, settings or hooks; a rule for every agent goes to your Orchestrator with send_to_chat.',
    inputSchema: { type: 'object', properties: { agentId: { type: 'string', description: 'optional: your own agent id (default)' }, rule: { type: 'string' }, evidence: { type: 'string' }, target: { type: 'string', enum: ['role', 'skill'] }, skill: { type: 'string' } }, required: ['rule', 'evidence'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (args, ctx) => {
      const chatId = ctx?.params?.chatId;
      if (!chatId) throw new Error('This tool works only on a chat\'s own endpoint.');
      const own = runs().filter(r => r.chatId === chatId && r.endedAt === undefined).sort((x, y) => y.startedAt - x.startedAt)[0];
      if (!own) throw new Error('Your chat has no open agent run: send the lesson to your Orchestrator with send_to_chat.');
      const lesson = parseLesson(args);
      if (lesson.agentId !== undefined && lesson.agentId !== own.agentId) throw new Error('A work chat proposes lessons only for its own agent: send the others to your Orchestrator.');
      if (lesson.target === 'rule') throw new Error('A work chat cannot add a rule for every agent: send it to your Orchestrator.');
      return JSON.stringify(service.propose(own.agentId, lesson.rule, lesson.evidence, lesson.target, lesson.skill, chatId));
    } };
}

/** agent_lessons_waiting, the authenticated Orchestrator's only (appctl/tools.ts): the work chats' queued lessons; with
 *  id + accept, its decision after asking the user (accepted = applied by the corrections job, with an undo). */
export function lessonReviewTool(service: AgentPackLearning): McpTool {
  return { name: 'agent_lessons_waiting', description: 'Lessons that work chats proposed for their own agent, waiting (they are not applied). List them with no arguments; ask the user, then pass id and accept (true = applied at once with an undo, false = discarded).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, accept: { type: 'boolean' } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: args => {
      if (Object.keys(args).some(k => !['id', 'accept'].includes(k))) throw new Error('agent_lessons_waiting: unknown argument.');
      if (args.id === undefined && args.accept === undefined) return JSON.stringify(service.waiting());
      if (typeof args.id !== 'string' || typeof args.accept !== 'boolean') throw new Error('Pass both id and accept.');
      return JSON.stringify(service.review(args.id, args.accept));
    } };
}
