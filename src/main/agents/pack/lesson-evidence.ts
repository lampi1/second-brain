// Host-owned evidence snapshots for the lesson queue. Cited run outcomes justify review, never claimed causal gains.
// Learning rechecks the exact proposal and sources before the user's approval and before maintenance applies it.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { LearnedRuleAssessment, LearnedRuleProposal } from '../../../shared/agent-pack';
import type { AgentRun } from '../../../shared/agents';
import { verifiedVerdict } from '../../../shared/run-verdict';

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const realRoot = (root: string): string | null => { try { return fs.realpathSync.native(root); } catch { return null; } };
export function lessonHash(p: LearnedRuleProposal): string {
  return hash([p.id, p.agentId, p.rule, p.evidence, p.target ?? 'role', p.skill ?? null, p.createdAt]);
}
/** Only explicit references count. Natural-language claims of success never become host provenance. */
export function assessLesson(p: LearnedRuleProposal, runs: readonly AgentRun[], brainRoot: string, now = Date.now()): LearnedRuleAssessment {
  const result: LearnedRuleAssessment = { state: 'insufficient', reason: 'Cita almeno una run conclusa con esito verificato: run:<id>.', proposalHash: lessonHash(p), checkedAt: now, causal: false, sources: [] };
  const currentRoot = realRoot(brainRoot);
  const ids = [...new Set([...p.evidence.matchAll(/\brun:([a-zA-Z0-9_-]+)|\b(r_[a-zA-Z0-9_-]+)\b/g)].map(m => m[1] ?? m[2]!))].sort();
  if (!ids.length || ids.length > 10) return result;
  for (const id of ids) {
    const matches = runs.filter(r => r.runId === id), r = matches.length === 1 ? matches[0] : undefined;
    const verdict = r && verifiedVerdict(r, undefined, now);
    const sourceRoot = r?.scope ? realRoot(r.scope.brainRoot) : null;
    if (!r || r.agentId !== p.agentId || !r.scope || !currentRoot || !sourceRoot || sourceRoot !== currentRoot
      || !r.scope.projectRoot || !Number.isFinite(r.startedAt) || !Number.isFinite(r.endedAt) || r.endedAt! < r.startedAt || r.endedAt! > now
      || !verdict || !Number.isFinite(r.outcome?.at) || r.outcome!.at < r.startedAt || r.outcome!.at > now) {
      result.reason = `Evidenza insufficiente: ${id} deve essere una run conclusa di questo ruolo e brain, con esito verificato.`;
      return result;
    }
    // Keep the exact recorded scope bound, and bind an alias to its resolved target too. Repointing a link after
    // proposal/approval must invalidate the evidence even when both the configured brain and run use that alias.
    const scope = sourceRoot === r.scope.brainRoot ? r.scope : { ...r.scope, resolvedBrainRoot: sourceRoot };
    result.sources.push({ runId: id, verdict: verdict.verdict, basis: verdict.basis, outcomeAt: r.outcome!.at,
      endedAt: r.endedAt!, projectRoot: r.scope.projectRoot,
      fingerprint: hash([r.runId, r.agentId, scope, r.goal, r.startedAt, r.endedAt, r.outcome, r.corrections, r.reworkOf, r.report]) });
  }
  result.state = 'supported';
  result.reason = 'Fonti verificate disponibili. La pertinenza della lezione va valutata dall’utente; il suo effetto non è misurato.';
  return result;
}
/** A changed source needs a new proposal and a new explicit user decision. Legacy approval has no evidence binding. */
export function sameLessonEvidence(stored: LearnedRuleAssessment | undefined, current: LearnedRuleAssessment): boolean {
  return stored?.state === 'supported' && stored.causal === false && current.state === 'supported'
    && stored.proposalHash === current.proposalHash && JSON.stringify(stored.sources) === JSON.stringify(current.sources);
}
