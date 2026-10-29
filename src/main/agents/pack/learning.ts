// Lessons from every agent wait for explicit user approval in the shared questions modal. Only approved lessons reach the corrections job.
// Old pending lessons migrate to the waiting queue; agent tools cannot approve. User role edits still snapshot skills.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AgentDraft, AgentProfile } from '../../../shared/agents';
import type { LearnedRuleProposal, LessonTarget } from '../../../shared/agent-pack';
import type { LessonStub } from '../../../shared/brain-model';
import type { AgentRun } from '../../../shared/agents';
import { readLocal, writeLocal } from '../local-store';
import { checkPermissionText } from '../tool-policy';
import type { AgentPackFlows } from './flows';
import type { McpTool } from '../../mcp/server';
import { assessLesson, sameLessonEvidence } from './lesson-evidence';
import { decisionFeedback } from '../../../shared/decision-feedback';

export class AgentPackLearning {
  private readonly file: string;
  private proposals: LearnedRuleProposal[];
  constructor(private readonly flows: AgentPackFlows, userData: string) {
    this.file = path.join(userData, 'agent-learn-proposals.json');
    const raw = readLocal(this.file) as { proposals?: LearnedRuleProposal[] } | undefined;
    if (raw && (!Array.isArray(raw.proposals) || raw.proposals.length > 500 || raw.proposals.some(p => !p || typeof p.rule !== 'string' || typeof p.evidence !== 'string' || !['pending', 'approved', 'discarded'].includes(p.status) || (p.fromChat !== undefined && typeof p.fromChat !== 'string')))) throw new Error('Invalid learned-rule proposal store');
    this.proposals = (raw?.proposals ?? []).map(p => p.status === 'pending' && (!p.userApproved || !p.assessment) ? { ...p, fromChat: p.fromChat || 'orchestrator' } : p);
  }
  private persist(): void { writeLocal(this.file, { version: 1, proposals: this.proposals }); }
  /** Main-process injection only: tool arguments cannot supply outcomes or provenance. */
  evidenceRuns: () => readonly AgentRun[] = () => [];
  private assessment(p: LearnedRuleProposal): NonNullable<LearnedRuleProposal['assessment']> {
    try { return assessLesson(p, this.evidenceRuns(), this.flows.root()); }
    catch { return { state: 'insufficient', reason: 'Fonti non disponibili: la lezione non può essere applicata.', proposalHash: '', checkedAt: Date.now(), causal: false, sources: [] }; }
  }
  private supported(p: LearnedRuleProposal): boolean { return sameLessonEvidence(p.assessment, this.assessment(p)); }
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
    proposal.assessment = this.assessment(proposal);
    this.proposals = [...this.proposals.slice(-499), proposal]; this.persist();
    // Every proposal waits for a real user decision, including the Orchestrator's.
    return structuredClone(proposal);
  }
  /** Lessons the corrections job applies, oldest first: a work chat's lesson only once accepted. */
  pending(): LearnedRuleProposal[] { return structuredClone(this.proposals.filter(p => p.status === 'pending' && p.userApproved === true && !p.fromChat && this.supported(p))); }
  /** Work chats' lessons waiting for the Orchestrator and the user, oldest first. */
  waiting(): LearnedRuleProposal[] {
    return structuredClone(this.proposals.filter(p => p.status === 'pending').flatMap(p => {
      const current = this.assessment(p), supported = sameLessonEvidence(p.assessment, current);
      if (!p.fromChat && supported) return [];
      return [{ ...p, assessment: supported ? p.assessment : { ...current, state: 'insufficient' as const,
        reason: current.state === 'insufficient' ? current.reason : 'La proposta non corrisponde alle fonti verificate: invia una nuova proposta prima dell’approvazione.' } }];
    }));
  }
  /** The renderer's explicit user decision on a waiting lesson (agent_lessons_waiting): accepted = applied by the job. */
  review(id: string, accept: boolean, feedback?: string): LearnedRuleProposal {
    const correction = decisionFeedback(feedback, accept);
    const p = this.proposals.find(x => x.id === id && x.status === 'pending' && (!!x.fromChat || !this.supported(x)));
    if (!p || typeof accept !== 'boolean') throw new Error('Waiting lesson not found.');
    if (accept) {
      checkPermissionText(p.rule);
      if (!this.supported(p)) throw new Error('Insufficient or changed lesson evidence: submit a new evidence-backed proposal before approval.');
    }
    const next: LearnedRuleProposal = { ...p, note: accept ? `accettata (da ${p.fromChat})` : correction ? `Risposta libera dell’utente: ${correction}` : 'rifiutata', ...(correction ? { feedback: correction } : {}), ...(accept ? {} : { status: 'discarded' as const }) };
    if (accept) { delete next.fromChat; next.userApproved = true; }
    this.proposals = this.proposals.map(x => x === p ? next : x);
    this.persist();
    if (accept) try { this.onProposed?.(); } catch { /* the next maintenance pass applies it */ }
    return structuredClone(this.proposals.find(x => x.id === id)!);
  }
  /** Every stored lesson's date and status, for the Apprendimento page's honest count (ADR 0182). */
  stubs(): LessonStub[] { return this.proposals.map(p => ({ createdAt: p.createdAt, status: p.status })); }
  /** Durable user corrections remain readable after a failed wake or restart; these are history, not approvals. */
  feedbackHistory(): LearnedRuleProposal[] {
    return structuredClone(this.proposals.filter(p => p.status === 'discarded' && typeof p.feedback === 'string' && p.feedback.trim()));
  }
  /** The job's outcome for one lesson: applied (where, in `note`) or discarded (why). */
  settle(id: string, status: 'approved' | 'discarded', note: string): void {
    if (status === 'approved' && !this.pending().some(p => p.id === id)) throw new Error('Only an approved, evidence-backed lesson can be settled as applied.');
    this.proposals = this.proposals.map(p => p.id === id && p.status === 'pending' ? { ...p, status, note: note.slice(0, 300) } : p);
    this.persist();
  }
  /** The user's edit of a role: its editable know-how files are snapshotted with it. */
  save(draft: AgentDraft, id: string, reason?: string): AgentProfile {
    const previous = this.flows.profile(id);
    this.flows.root(); this.flows.deps.catalog.validateDraft(draft, id);
    const files = this.flows.ownSkills(previous, true), knowhow = this.flows.persistSkills(id, files, previous.knowhow?.linked);
    const profile = this.flows.deps.catalog.save({ ...draft, knowhow }, id, reason);
    this.flows.publishCurrent(profile); return profile;
  }
}

/** The lessons tool on the app endpoints. With `queueAs` (an endpoint that is not the authenticated Orchestrator), the
 *  lesson waits like a work chat's (fromChat) and may not be a rule for every role. */
export function agentLearnTool(service: AgentPackLearning, queueAs?: string): McpTool {
  return { name: 'agent_learn_propose', description: queueAs ? 'Record one lesson from the user\'s corrections, with explicit evidence (run:<id> for completed runs with independently verified outcomes). It waits for the Orchestrator and the user before it is applied: target "role" (default) for the role\'s text, "skill" for the named skill. Never for permissions, settings or hooks.'
    : 'Record one lesson from the user\'s corrections, with explicit evidence (run:<id> for completed runs with independently verified outcomes). The app queues it for explicit user approval in the shared questions modal before applying it: target "role" (default) adds it to the role\'s text, "skill" to the named skill (how a job is done), "rule" to the brain\'s rules (applies to every role). Never for permissions, settings, limits or hooks: those change only in Brain → Agenti. Lessons proposed by work chats wait in agent_lessons_waiting.',
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
  return { name: 'agent_learn_propose', description: 'Record one lesson from the user\'s corrections about YOUR role (the one your chat runs as), with explicit evidence (run:<id> for completed runs with independently verified outcomes). It waits for the Orchestrator and the user before it is applied: target "role" (default) for your role\'s text, "skill" for the named skill. Never for permissions, settings or hooks; a rule for every role goes to your parent with agent_report.',
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

/** Read-only proposals and rejected user corrections; renderer IPC alone records user decisions. */
export function lessonReviewTool(service: AgentPackLearning): McpTool {
  return { name: 'agent_lessons_waiting', description: 'Read pending lessons and rejected lesson history containing user feedback. Discarded entries are recorded corrections, never approvals or pending questions: resume an unaddressed correction after failed notification or restart, without repeating already addressed work. Only the user decides pending proposals in the questions modal.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: args => {
      if (Object.keys(args).length) throw new Error('Only the user can decide lessons in the shared questions modal.');
      return JSON.stringify([...service.waiting(), ...service.feedbackHistory()]);
    } };
}
