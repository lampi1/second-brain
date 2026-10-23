// Lessons from every agent wait for explicit user approval in Regia. Only approved lessons reach the corrections job.
// Old pending lessons migrate to the waiting queue; agent tools cannot approve. User role edits still snapshot skills.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AgentDraft, AgentProfile } from '../../../shared/agents';
import type { LearnedRuleProposal, LessonTarget } from '../../../shared/agent-pack';
import type { AgentRun } from '../../../shared/agents';
import { readLocal, writeLocal } from '../local-store';
import { checkPermissionText } from '../tool-policy';
import type { AgentPackFlows } from './flows';
import type { McpTool } from '../../mcp/server';

export class AgentPackLearning {
  private readonly file: string;
  private proposals: LearnedRuleProposal[];
  constructor(private readonly flows: AgentPackFlows, userData: string) {
    this.file = path.join(userData, 'agent-learn-proposals.json');
    const raw = readLocal(this.file) as { proposals?: LearnedRuleProposal[] } | undefined;
    if (raw && (!Array.isArray(raw.proposals) || raw.proposals.length > 500 || raw.proposals.some(p => !p || typeof p.rule !== 'string' || typeof p.evidence !== 'string' || !['pending', 'approved', 'discarded'].includes(p.status) || (p.fromChat !== undefined && typeof p.fromChat !== 'string')))) throw new Error('Invalid learned-rule proposal store');
    this.proposals = (raw?.proposals ?? []).map(p => p.status === 'pending' && !p.userApproved ? { ...p, fromChat: p.fromChat || 'orchestrator' } : p);
  }
  private persist(): void { writeLocal(this.file, { version: 1, proposals: this.proposals }); }
  /** Called after a lesson is queued: the service runs the corrections job (wired by brainmodel/service.ts). */
  onProposed: (() => void) | null = null;
  /** fromChat = the work chat that proposed it (its own endpoint): the lesson waits for the Orchestrator and the user. */
  propose(agentId: string, rule: string, evidence: string, target?: LessonTarget, skill?: string, fromChat?: string): LearnedRuleProposal {
    this.flows.profile(agentId);
    if (typeof rule !== 'string' || !rule.trim() || rule.length > 2000 || /[\r\n\0]/.test(rule) || typeof evidence !== 'string' || !evidence.trim() || evidence.length > 500 || /[\r\n\0]/.test(evidence)) throw new Error('A learned rule needs bounded text and evidence');
    if (target !== undefined && !['role', 'skill', 'rule'].includes(target)) throw new Error('target is role, skill or rule');
    if (fromChat !== undefined && target === 'rule') throw new Error('A work chat cannot add a rule for every role: send it to your parent.');
    checkPermissionText(rule);
    if (skill !== undefined && (typeof skill !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill) || skill.length > 64)) throw new Error('Invalid skill name');
    if (this.proposals.filter(p => p.status === 'pending').length >= 200) throw new Error('Too many lessons waiting: the maintenance applies them first');
    if (fromChat !== undefined && this.waiting().length >= 50) throw new Error('Too many lessons waiting for the Orchestrator: send this one with send_to_chat instead.');
    const proposal: LearnedRuleProposal = { id: randomBytes(8).toString('hex'), agentId, rule: rule.trim(), evidence: evidence.trim(), createdAt: Date.now(), status: 'pending',
      ...(target ? { target } : {}), ...(skill ? { skill } : {}), fromChat: fromChat || 'orchestrator' };
    this.proposals = [...this.proposals.slice(-499), proposal]; this.persist();
    // Every proposal waits for a real user decision, including the Orchestrator's.
    return structuredClone(proposal);
  }
  /** Lessons the corrections job applies, oldest first: a work chat's lesson only once accepted. */
  pending(): LearnedRuleProposal[] { return structuredClone(this.proposals.filter(p => p.status === 'pending' && p.userApproved === true && !p.fromChat)); }
  /** Work chats' lessons waiting for the Orchestrator and the user, oldest first. */
  waiting(): LearnedRuleProposal[] { return structuredClone(this.proposals.filter(p => p.status === 'pending' && !!p.fromChat)); }
  /** The renderer's explicit user decision on a waiting lesson (agent_lessons_waiting): accepted = applied by the job. */
  review(id: string, accept: boolean): LearnedRuleProposal {
    const p = this.proposals.find(x => x.id === id && x.status === 'pending' && !!x.fromChat);
    if (!p || typeof accept !== 'boolean') throw new Error('Waiting lesson not found.');
    if (accept) checkPermissionText(p.rule);
    const next: LearnedRuleProposal = { ...p, note: accept ? `accettata (da ${p.fromChat})` : 'rifiutata', ...(accept ? {} : { status: 'discarded' as const }) };
    if (accept) { delete next.fromChat; next.userApproved = true; }
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
  /** The user's edit of a role: its editable know-how files are snapshotted with it. */
  save(draft: AgentDraft, id: string): AgentProfile {
    const previous = this.flows.profile(id);
    this.flows.root(); this.flows.deps.catalog.validateDraft(draft, id);
    const files = this.flows.ownSkills(previous, true), knowhow = this.flows.persistSkills(id, files, previous.knowhow?.linked);
    const profile = this.flows.deps.catalog.save({ ...draft, knowhow }, id);
    this.flows.publishCurrent(profile); return profile;
  }
}

/** The lessons tool on the app endpoints. With `queueAs` (an endpoint that is not the authenticated Orchestrator), the
 *  lesson waits like a work chat's (fromChat) and may not be a rule for every role. */
export function agentLearnTool(service: AgentPackLearning, queueAs?: string): McpTool {
  return { name: 'agent_learn_propose', description: queueAs ? 'Record one lesson from the user\'s corrections, with evidence (run ids). It waits for the Orchestrator and the user before it is applied: target "role" (default) for the role\'s text, "skill" for the named skill. Never for permissions, settings or hooks.'
    : 'Record one lesson from the user\'s corrections, with evidence (run ids). The app queues it for explicit user approval in Regia before applying it: target "role" (default) adds it to the role\'s text, "skill" to the named skill (how a job is done), "rule" to the brain\'s rules (applies to every role). Never for permissions, settings, limits or hooks: those change only in Brain → Agenti. Lessons proposed by work chats wait in agent_lessons_waiting.',
    inputSchema: { type: 'object', properties: { agentId: { type: 'string', description: 'the role id (scout, artisan…)' }, rule: { type: 'string' }, evidence: { type: 'string' }, target: { type: 'string', enum: queueAs ? ['role', 'skill'] : ['role', 'skill', 'rule'] }, skill: { type: 'string' } }, required: ['agentId', 'rule', 'evidence'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: args => {
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

/** agent_learn_propose on a work chat's own token endpoint (wiring.ts addChatTools): a lesson for the role of the
 *  caller's open run only (the chat the token names, never an argument), as role or skill, never a rule for every role,
 *  and queued: it waits until the authenticated Orchestrator accepts it with the user (agent_lessons_waiting). */
export function chatLearnTool(service: AgentPackLearning, runs: () => readonly AgentRun[]): McpTool {
  return { name: 'agent_learn_propose', description: 'Record one lesson from the user\'s corrections about YOUR role (the one your chat runs as), with evidence (run ids). It waits for the Orchestrator and the user before it is applied: target "role" (default) for your role\'s text, "skill" for the named skill. Never for permissions, settings or hooks; a rule for every role goes to your parent with agent_report.',
    inputSchema: { type: 'object', properties: { agentId: { type: 'string', description: 'optional: your own role id (default)' }, rule: { type: 'string' }, evidence: { type: 'string' }, target: { type: 'string', enum: ['role', 'skill'] }, skill: { type: 'string' } }, required: ['rule', 'evidence'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (args, ctx) => {
      const chatId = ctx?.params?.chatId;
      if (!chatId) throw new Error('This tool works only on a chat\'s own endpoint.');
      const own = runs().filter(r => r.chatId === chatId && r.endedAt === undefined).sort((x, y) => y.startedAt - x.startedAt)[0];
      if (!own) throw new Error('Your chat runs no role: tell the user instead.');
      const lesson = parseLesson(args);
      if (lesson.agentId !== undefined && lesson.agentId !== own.agentId) throw new Error('A work chat proposes lessons only for its own role: no work chat changes another role\'s text.');
      if (lesson.target === 'rule') throw new Error('A work chat cannot add a rule for every role: report it to your parent.');
      return JSON.stringify(service.propose(own.agentId, lesson.rule, lesson.evidence, lesson.target, lesson.skill, chatId));
    } };
}

/** agent_lessons_waiting, the authenticated Orchestrator's only (appctl/tools.ts): the work chats' queued lessons; with
 *  id + accept, its decision after asking the user (accepted = applied by the corrections job, with an undo). */
export function lessonReviewTool(service: AgentPackLearning): McpTool {
  return { name: 'agent_lessons_waiting', description: 'Read lessons awaiting the user in Regia. Only the user can approve or reject them through the app; no agent may decide.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: args => {
      if (Object.keys(args).length) throw new Error('Only the user can decide lessons in Regia.');
      return JSON.stringify(service.waiting());
    } };
}
