// The lessons queue (ADR 0077, replacing the learned-rule approvals of ADR 0073): the Orchestrator records a lesson from
// the user's corrections with agent_learn_propose, and the brain model's "corrections" maintenance job applies it at once,
// without the user's approval, to the agent's role, to a skill or to a rule (brainmodel/jobs.ts), logged with an undo.
// Lessons no longer live in an agent's own skill (learned-rules.md). Also the agent save path of the Agenti editor.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AgentDraft, AgentProfile } from '../../../shared/agents';
import type { LearnedRuleProposal, LessonTarget } from '../../../shared/agent-pack';
import { readLocal, writeLocal } from '../local-store';
import type { AgentPackFlows } from './flows';
import type { McpTool } from '../../mcp/server';

export class AgentPackLearning {
  private readonly file: string;
  private proposals: LearnedRuleProposal[];
  constructor(private readonly flows: AgentPackFlows, userData: string) {
    this.file = path.join(userData, 'agent-learn-proposals.json');
    const raw = readLocal(this.file) as { proposals?: LearnedRuleProposal[] } | undefined;
    if (raw && (!Array.isArray(raw.proposals) || raw.proposals.length > 500 || raw.proposals.some(p => !p || typeof p.rule !== 'string' || typeof p.evidence !== 'string' || !['pending', 'approved', 'discarded'].includes(p.status)))) throw new Error('Invalid learned-rule proposal store');
    this.proposals = raw?.proposals ?? [];
  }
  private persist(): void { writeLocal(this.file, { version: 1, proposals: this.proposals }); }
  /** Called after a lesson is queued: the service runs the corrections job (wired by brainmodel/service.ts). */
  onProposed: (() => void) | null = null;
  propose(agentId: string, rule: string, evidence: string, target?: LessonTarget, skill?: string): LearnedRuleProposal {
    this.flows.profile(agentId);
    if (typeof rule !== 'string' || !rule.trim() || rule.length > 2000 || /[\r\n\0]/.test(rule) || typeof evidence !== 'string' || !evidence.trim() || evidence.length > 500 || /[\r\n\0]/.test(evidence)) throw new Error('A learned rule needs bounded text and evidence');
    if (target !== undefined && !['role', 'skill', 'rule'].includes(target)) throw new Error('target is role, skill or rule');
    if (skill !== undefined && (typeof skill !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill) || skill.length > 64)) throw new Error('Invalid skill name');
    if (this.proposals.filter(p => p.status === 'pending').length >= 200) throw new Error('Too many lessons waiting: the maintenance applies them first');
    const proposal: LearnedRuleProposal = { id: randomBytes(8).toString('hex'), agentId, rule: rule.trim(), evidence: evidence.trim(), createdAt: Date.now(), status: 'pending',
      ...(target ? { target } : {}), ...(skill ? { skill } : {}) };
    this.proposals = [...this.proposals.slice(-499), proposal]; this.persist();
    try { this.onProposed?.(); } catch { /* the next maintenance pass applies it */ }
    return structuredClone(proposal);
  }
  /** Lessons not applied yet, oldest first (the corrections job reads them). */
  pending(): LearnedRuleProposal[] { return structuredClone(this.proposals.filter(p => p.status === 'pending')); }
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

/** The lessons tool. With `setting`, it also takes a "Contesto massimo" change (maxContext, issue #80): an agent_update,
 *  applied at once as a trial version with an undo (ADR 0082: part of the agent's profile, not an app setting). */
export function agentLearnTool(service: AgentPackLearning, setting?: (agentId: string, patch: { maxContext: number | null }, evidence: string, callerChatId: string | undefined) => unknown): McpTool {
  return { name: 'agent_learn_propose', description: `Record one lesson from the user's corrections, with evidence (run ids). The app applies it at once, without asking the user, and logs it with an undo: target "role" (default) adds it to the agent's role, "skill" to the named skill (how a job is done), "rule" to the brain's rules (applies to every agent). Never for permissions, settings or hooks.${setting ? ' To propose the agent\'s maximum context instead, pass maxContext (tokens, 100000-1000000, or null for the app setting) with evidence and no rule: it is part of the agent’s profile, so it applies at once as a trial version, logged with an undo (only Claude engines apply it).' : ''}`,
    inputSchema: { type: 'object', properties: { agentId: { type: 'string' }, rule: { type: 'string' }, evidence: { type: 'string' }, target: { type: 'string', enum: ['role', 'skill', 'rule'] }, skill: { type: 'string' }, ...(setting ? { maxContext: { type: ['integer', 'null'], minimum: 100000, maximum: 1000000 } } : {}) }, required: setting ? ['agentId', 'evidence'] : ['agentId', 'rule', 'evidence'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (args, ctx) => {
      if (setting && args.maxContext !== undefined) {
        if (Object.keys(args).some(k => !['agentId', 'evidence', 'maxContext'].includes(k)) || typeof args.agentId !== 'string' || typeof args.evidence !== 'string' || !(args.maxContext === null || Number.isSafeInteger(args.maxContext))) throw new Error('Invalid maximum-context proposal: agentId, evidence and maxContext (integer or null), no rule');
        return Promise.resolve(setting(args.agentId, { maxContext: args.maxContext as number | null }, args.evidence, ctx?.params?.chatId)).then(r => JSON.stringify(r));
      }
      if (Object.keys(args).some(k => !['agentId', 'rule', 'evidence', 'target', 'skill'].includes(k)) || typeof args.agentId !== 'string' || typeof args.rule !== 'string' || typeof args.evidence !== 'string'
        || (args.target !== undefined && typeof args.target !== 'string') || (args.skill !== undefined && typeof args.skill !== 'string')) throw new Error('Invalid lesson');
      return JSON.stringify(service.propose(args.agentId, args.rule, args.evidence, args.target as LessonTarget | undefined, args.skill as string | undefined));
    } };
}
