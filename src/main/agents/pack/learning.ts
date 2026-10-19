// Asynchronous learned-rule proposals. Only explicit decisions change user-agent files; preset updates belong to the catalog.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AgentDraft, AgentProfile } from '../../../shared/agents';
import type { LearnedRuleProposal, LearnedRules } from '../../../shared/agent-pack';
import { readLocal, writeLocal } from '../local-store';
import type { AgentPackFlows } from './flows';
import { portableId } from './flows';
import { hashFiles } from './emit';
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
  propose(agentId: string, rule: string, evidence: string): LearnedRuleProposal {
    this.flows.profile(agentId);
    if (typeof rule !== 'string' || !rule.trim() || rule.length > 2000 || /[\r\n\0]/.test(rule) || typeof evidence !== 'string' || !evidence.trim() || evidence.length > 500 || /[\r\n\0]/.test(evidence)) throw new Error('A learned rule needs bounded text and evidence');
    if (this.proposals.length >= 500) throw new Error('Review pending learned rules first');
    const proposal: LearnedRuleProposal = { id: randomBytes(8).toString('hex'), agentId, rule: rule.trim(), evidence: evidence.trim(), createdAt: Date.now(), status: 'pending' };
    this.proposals = [...this.proposals, proposal]; this.persist(); return structuredClone(proposal);
  }
  /** Every agent's pending learned rules, oldest first (the "Da approvare" queue reads them; decided with decide()). */
  pending(): LearnedRuleProposal[] { return structuredClone(this.proposals.filter(p => p.status === 'pending')); }
  list(id: string): LearnedRules {
    const profile = this.flows.profile(id), files = this.flows.ownSkills(profile, true);
    const file = `skills/${portableId(id)}/learned-rules.md`;
    return { text: file ? files.get(file)!.toString('utf8') : '', proposals: structuredClone(this.proposals.filter(p => p.agentId === id && p.status === 'pending')) };
  }
  decide(id: string, proposalId: string, decision: 'approve' | 'edit' | 'discard', text?: string): LearnedRules {
    const proposal = this.proposals.find(p => p.id === proposalId && p.agentId === id && p.status === 'pending');
    if (!proposal || !['approve', 'edit', 'discard'].includes(decision)) throw new Error('Unknown learned-rule decision');
    if (decision !== 'discard') {
      const rule = decision === 'edit' ? text : proposal.rule;
      if (typeof rule !== 'string' || !rule.trim() || rule.length > 2000 || /[\r\n\0]/.test(rule)) throw new Error('Invalid learned rule');
      const profile = this.flows.profile(id), files = this.flows.ownSkills(profile, true), previousHash = hashFiles(files);
      const own = `skills/${portableId(id)}/learned-rules.md`;
      const current = files.get(own)!.toString('utf8');
      if (current.split(/\r?\n/).length >= 200) throw new Error('Merge existing learned rules before adding another');
      files.set(own, Buffer.from(`${current.trimEnd()}\n- ${rule.trim()} · ${new Date().toISOString().slice(0, 10)} · ${proposal.evidence}\n`));
      const knowhow = this.flows.persistSkills(id, files, profile.knowhow?.linked);
      const updated = this.flows.deps.catalog.applyPack({ ...profile, knowhow }, id, { kind: 'learned-rule' }, true, profile.origin);
      this.flows.publishCurrent(updated, previousHash);
    }
    this.proposals = this.proposals.map(p => p.id === proposalId ? { ...p, status: decision === 'discard' ? 'discarded' : 'approved' } : p);
    this.persist(); return this.list(id);
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

/** The learned-rule tool. With `setting`, it also takes a "Contesto massimo" change (maxContext, issue #80): queued as an
 *  agent_update proposal for the user (Agenti → Da approvare), never applied by itself. */
export function agentLearnTool(service: AgentPackLearning, setting?: (agentId: string, patch: { maxContext: number | null }, evidence: string, callerChatId: string | undefined) => unknown): McpTool {
  return { name: 'agent_learn_propose', description: `Propose one learned rule with evidence. Queues it on the agent card for Brother to approve, edit or discard; never applies it or interrupts the user.${setting ? ' To propose the agent\'s maximum context instead, pass maxContext (tokens, 100000-1000000, or null for the app setting) with evidence and no rule: it becomes a proposal in Agenti → Da approvare (only Claude engines apply it).' : ''}`,
    inputSchema: { type: 'object', properties: { agentId: { type: 'string' }, rule: { type: 'string' }, evidence: { type: 'string' }, ...(setting ? { maxContext: { type: ['integer', 'null'], minimum: 100000, maximum: 1000000 } } : {}) }, required: setting ? ['agentId', 'evidence'] : ['agentId', 'rule', 'evidence'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (args, ctx) => {
      if (setting && args.maxContext !== undefined) {
        if (Object.keys(args).some(k => !['agentId', 'evidence', 'maxContext'].includes(k)) || typeof args.agentId !== 'string' || typeof args.evidence !== 'string' || !(args.maxContext === null || Number.isSafeInteger(args.maxContext))) throw new Error('Invalid maximum-context proposal: agentId, evidence and maxContext (integer or null), no rule');
        return Promise.resolve(setting(args.agentId, { maxContext: args.maxContext as number | null }, args.evidence, ctx?.params?.chatId)).then(r => JSON.stringify(r));
      }
      if (Object.keys(args).some(k => !['agentId', 'rule', 'evidence'].includes(k)) || typeof args.agentId !== 'string' || typeof args.rule !== 'string' || typeof args.evidence !== 'string') throw new Error('Invalid learned-rule proposal');
      return JSON.stringify(service.propose(args.agentId, args.rule, args.evidence));
    } };
}
