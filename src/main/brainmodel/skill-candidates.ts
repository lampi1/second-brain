// Reviewable skill candidates remain outside the engine skill path until a user promotes a concrete draft with
// independently verified example evidence and a passing held-out replay of that exact content. Used by learning IPC.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentRun } from '../../shared/agents';
import type { SkillCandidateView } from '../../shared/learning-review';
import { checkMd, NAME_RE, parseMd } from '../../shared/skillmd';
import { isWorkRole } from '../../shared/roles';
import { verifiedVerdict } from '../../shared/run-verdict';
import { checkPermissionText } from '../agents/tool-policy';
import type { ChangeLog } from './changes';
import { contentDigest, type EvaluationStore, type ReplayCandidate } from './evaluation';

export interface SkillCandidateDeps { root: string; log: ChangeLog; evaluations: EvaluationStore; runs(): readonly AgentRun[] }
const MAX_TEXT = 24_000;

/** Reject linked ancestors/files: generated candidate names never become arbitrary filesystem paths. */
function safeFile(root: string, parts: string[]): string {
  const chosen = path.resolve(root);
  const rootStat = fs.lstatSync(chosen);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Brain root must be a real directory.');
  const base = fs.realpathSync(chosen); let current = base;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const st = fs.lstatSync(current);
      if (st.isSymbolicLink() || !st.isDirectory() && (!st.isFile() || st.nlink !== 1)) throw new Error('Linked candidate/skill path refused.');
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  return current;
}
const candidateName = (name: string): string => { if (!NAME_RE.test(name) || name.length > 64) throw new Error('Invalid skill candidate name.'); return name; };
const ready = (text: string): boolean => /^## (?:Passi|Steps)\s*$/mi.test(text) && (text.match(/^\d+[.)]\s+\S.{8,}$/gm) ?? []).length >= 2;
function draftText(name: string, text: string): void {
  if (!text.trim() || text.length > MAX_TEXT) throw new Error('Candidate draft must contain 1–24000 characters.');
  if (checkMd('skill', text).some(i => i.level === 'error') || parseMd(text).fields.find(field => field.key === 'name')?.value !== name) throw new Error('A valid skill header with the same candidate name is required.');
  checkPermissionText(text);
}

export class SkillCandidateService {
  constructor(private readonly deps: SkillCandidateDeps) {}
  private file(name: string): string { return safeFile(this.deps.root, ['memory', 'skill-candidates', `${candidateName(name)}.md`]); }
  private target(name: string): string { return safeFile(this.deps.root, ['.claude', 'skills', candidateName(name), 'SKILL.md']); }
  private read(name: string): string {
    const file = this.file(name), stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_TEXT * 4) throw new Error('Candidate file too large or invalid.');
    return fs.readFileSync(file, 'utf8');
  }
  list(): SkillCandidateView[] {
    const dir = safeFile(this.deps.root, ['memory', 'skill-candidates']);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.md') && NAME_RE.test(f.slice(0, -3))).sort().slice(0, 100).map(f => this.inspect(f.slice(0, -3)));
  }
  inspect(name: string): SkillCandidateView {
    const text = this.read(name), digest = contentDigest(text);
    const origin = this.deps.log.all().find(c => c.job === 'repeated-task' && c.kind === 'skill' && c.action === 'create' && c.target === name && !c.rolledBackAt && c.files.some(f => f.file === this.file(name)));
    const sourceRunIds = origin?.evidence ?? [];
    const verifiedExampleRunIds = this.deps.runs().filter(r => sourceRunIds.includes(r.runId) && r.endedAt !== undefined && r.report?.canonical && verifiedVerdict(r, [], 0)?.verdict === 'success').map(r => r.runId);
    const eligibleReplayIds = this.deps.evaluations.replays().filter(r => this.deps.evaluations.eligibleReplay(r.id, { name, digest })).map(r => r.id);
    const promoted = fs.existsSync(this.target(name));
    const promotionProblems: string[] = [];
    let valid = true; try { draftText(name, text); } catch { valid = false; }
    if (!origin) promotionProblems.push('missing-provenance');
    if (!valid || !ready(text)) promotionProblems.push('invalid-steps');
    if (!verifiedExampleRunIds.length) promotionProblems.push('missing-verified-example');
    if (!eligibleReplayIds.length) promotionProblems.push('missing-holdout-replay');
    if (promoted) promotionProblems.push('already-promoted');
    return { name, text, digest, stepsReady: valid && ready(text), sourceRunIds, verifiedExampleRunIds, eligibleReplayIds, promotionProblems, promoted };
  }
  save(name: string, text: string, expectedDigest: string): SkillCandidateView {
    const before = this.inspect(name);
    if (before.digest !== expectedDigest) throw new Error('Candidate changed; reload before saving.');
    if (before.promoted) throw new Error('This candidate was already promoted.');
    draftText(name, text);
    this.deps.log.apply({ job: 'user', kind: 'skill', action: 'update', target: name, summary: `Draft updated: ${name}`, reason: 'Explicit candidate draft edit; remains non-loadable.', evidence: [before.digest] }, [{ file: this.file(name), text }]);
    return this.inspect(name);
  }
  replayCandidate(name: string): ReplayCandidate {
    const candidate = this.inspect(name);
    if (!candidate.stepsReady) throw new Error('Write concrete candidate steps before replaying.');
    const example = this.deps.runs().find(r => candidate.verifiedExampleRunIds.includes(r.runId));
    return { name, text: candidate.text, digest: candidate.digest, ...(example && isWorkRole(example.agentId) ? { roleId: example.agentId } : {}) };
  }
  promote(name: string, expectedDigest: string, replayId: string, exampleRunId: string): SkillCandidateView {
    const candidate = this.inspect(name);
    if (candidate.digest !== expectedDigest) throw new Error('Candidate changed; replay the current draft before promotion.');
    if (candidate.promotionProblems.length) throw new Error(candidate.promotionProblems.join(' '));
    if (!candidate.eligibleReplayIds.includes(replayId) || !candidate.verifiedExampleRunIds.includes(exampleRunId)) throw new Error('Selected promotion evidence is missing, stale, or belongs to another candidate.');
    // Exact replayed bytes only: adding/changing instructions during promotion would invalidate the receipt.
    const result = this.deps.log.apply({ job: 'user', kind: 'skill', action: 'create', target: name, summary: `Verified candidate promoted: ${name}`, reason: 'Explicit promotion after independent example verification and held-out replay of this exact draft.', evidence: [exampleRunId, `replay:${replayId}`, `sha256:${candidate.digest}`] }, [{ file: this.target(name), text: candidate.text }]);
    if (!result) throw new Error('Promotion made no change.');
    return this.inspect(name);
  }
}
