// The Proposte deck's sources (ADR 0123): each one turns what an existing module already keeps waiting for the user into
// cards (shared/proposals.ts) with who, where, when and the evidence, and decides a card only through that module's own
// path, the same call its old page made (memory facts have no cards since ADR 0150: the maintenance saves them itself,
// brainmodel/memory-tidy.ts, at most MEMORY_CAP per role, in the Log with Annulla); a skill candidate → learning:promote
// / the rollback of the change that wrote it; a change the maintenance applied → Tieni (a reviewed mark) / brainmodel:rollback; an agent's protected setting → settings:confirm; a role trial → agents:trialDecide; a tier
// suggestion → agents:lifecycleDecide; a Battito rule → approvals:decide; an improvement-loop policy → learn:act.
// Pure over injected ports (index.ts wires them to the handlers): unit-tested in test/unit/proposals/service.test.ts.
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { AgentLifecycleSnapshot } from '../../shared/agent-lifecycle';
import type { BrainChange } from '../../shared/brain-model';
import type { ChatSummary, LearnAction, LearnResult, SettingProposal } from '../../shared/contract';
import type { SkillCandidateView } from '../../shared/learning-review';
import type { BrainCandidateView, ResearchProposal } from '../../shared/maintenance-research';
import type { ApprovalItem as PulseApproval, PulseResult } from '../../shared/pulse';
import { type Proposal, type ProposalAsk, type ProposalGroup, type ProposalCode, type ProposalDecision, type ProposalKeep, type ProposalFact, type ProposalProvenance, type ProposalSource, type ProposalWho } from '../../shared/proposals';
import { isRoleId } from '../../shared/roles';
import type { FileSnapshot, StoredChange } from '../brainmodel/changes';

/** Changes older than this are history, not news: they stay in the change log only. */
export const CHANGE_WINDOW_MS = 14 * 86_400_000;
/** Jobs whose changes are not news to review: moves of the brain's own format, the user's own edits, and the
 *  maintenance findings the user approved on their card already (ADR 0132). */
const FORMAT_JOBS: readonly string[] = ['migration', 'upgrade', 'user', 'research'];

export interface ProposalPorts {
  now(): number;
  runs(): readonly AgentRun[];
  chats(): readonly ChatSummary[];
  candidates?: { list(): SkillCandidateView[] | Promise<SkillCandidateView[]>; promote(name: string, digest: string, replayId: string, exampleRunId: string): unknown };
  changes?: { list(): BrainChange[]; stored(): StoredChange[]; rollback(id: string): unknown };
  settings?: { pending(): SettingProposal[]; confirm(id: string, accept: boolean): unknown };
  roles?: { list(): AgentProfile[]; resolveTrial(id: string, decision: 'keep' | 'rollback'): unknown };
  lifecycle?: { read(): AgentLifecycleSnapshot | Promise<AgentLifecycleSnapshot>; decide(key: string, decision: 'approve' | 'dismiss'): unknown };
  pulse?: { list(): PulseApproval[] | Promise<PulseApproval[]>; decide(id: string, decision: 'approve' | 'discard'): PulseResult | Promise<PulseResult> };
  policies?: { status(): Promise<unknown>; act(a: LearnAction): Promise<LearnResult> };
  /** the maintenance's findings for the brain (ADR 0132): open cards, applied through the change log on approval */
  research?: { list(): ResearchProposal[]; approve(id: string): unknown; reject(id: string): unknown; repo?(): string | null;
    /** the open candidate brains (ADR 0195): one card each, decided through approve / reject by their id */
    candidates?(): BrainCandidateView[] };
  /** the reviewed marks (Tieni on an applied change) */
  reviewed: { has(id: string): boolean; mark(id: string): void };
}

/** One source: its cards now, and the decision on one of them (by its id in the source). decide answers the
 *  change-log entries an approval made or kept, when it knows them (their rollback undoes it: ADR 0193's ledger). */
export interface Source {
  id: ProposalSource;
  available(p: ProposalPorts): boolean;
  list(p: ProposalPorts): Promise<Proposal[]>;
  decide(p: ProposalPorts, card: Proposal, decision: ProposalDecision, note?: string, choice?: { keep: ProposalKeep; shown: string[] }): Promise<string[] | void>;
}

const iso = (ms: number): string => new Date(Number.isFinite(ms) ? ms : 0).toISOString();
const native = (card: Proposal): string => card.id.slice(card.source.length + 1);
const clip = (s: string, n = 600): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** A setting's value in words: strings as they are, lists one per line, the rest as JSON. */
export const valueText = (v: unknown): string =>
  v === null || v === undefined ? '—' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(valueText).join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);

/** The run behind an item and its chat, from the run store or the chats' own run mirrors. */
export function whereFrom(p: ProposalPorts, runId: string | undefined): { run?: AgentRun; chat?: { id: string; title: string } } {
  if (!runId) return {};
  const chats = p.chats();
  const run = p.runs().find(r => r.runId === runId) ?? chats.find(c => c.run?.runId === runId)?.run;
  const chat = run ? chats.find(c => c.id === run.chatId) : undefined;
  return { ...(run ? { run } : {}), ...(chat ? { chat: { id: chat.id, title: chat.title } } : {}) };
}
const roleWho = (id: string | undefined, fallback: ProposalWho): ProposalWho => (id && isRoleId(id) ? { kind: 'role', id } : fallback);
function chatWho(p: ProposalPorts, chatId: string | undefined): { who: ProposalWho; chat?: { id: string; title: string } } {
  const c = chatId ? p.chats().find(x => x.id === chatId) : undefined;
  if (!c) return { who: { kind: 'app', id: 'agent' } };
  const role = c.isOrchestrator ? 'orchestrator' : c.agent?.id ?? c.run?.agentId;
  return { who: roleWho(role, { kind: 'app', id: 'agent' }), chat: { id: c.id, title: c.title } };
}
function card(source: ProposalSource, id: string, x: Omit<Proposal, 'id' | 'source'>): Proposal { return { id: `${source}:${id}`, source, ...x }; }
/** A script or a saved query a change wrote (or removed), with its code: scripts/<name>.<ext> as it is, a query note
 *  (queries/<name>.md, ADR 0124) by its fenced block. */
const CODE_FILE = /(?:^|[\\/])(scripts|queries)[\\/][^\\/]+$/;
const LANG: Readonly<Record<string, string>> = { mjs: 'javascript', cjs: 'javascript', js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', ps1: 'powershell', psm1: 'powershell', bat: 'bat', cmd: 'bat', sql: 'sql', kql: 'kql', graphql: 'graphql', gql: 'graphql' };
export const MAX_CODE = 20_000;
export function codeOf(files: readonly FileSnapshot[]): ProposalCode[] {
  return files.flatMap(f => {
    const dir = CODE_FILE.exec(f.file)?.[1], text = f.after ?? f.before;
    if (!dir || text === null) return [];
    const ext = path.extname(f.file).slice(1).toLowerCase(), name = f.file.replace(/^(?:.*[\\/])?(scripts|queries)[\\/]/, '$1/');
    if (ext === 'md') {
      const block = /^(`{3,}|~{3,})([\w+-]*)[^\n]*\n([\s\S]*?)\r?\n\1[ \t\r]*$/m.exec(text);
      return block ? [{ file: name, lang: block[2]!.toLowerCase() || 'text', text: clip(block[3]!, MAX_CODE) }] : [{ file: name, lang: 'markdown', text: clip(text, MAX_CODE) }];
    }
    return [{ file: name, lang: LANG[ext] ?? (ext || 'text'), text: clip(text, MAX_CODE) }];
  });
}
/** The item a change is about, short: a role id for a role or its memory, a file's name without the folder. */
function changeAsk(c: BrainChange, code: readonly ProposalCode[]): ProposalAsk {
  const roleOf = /(?:^|[\\/])agents[\\/]([^\\/]+)[\\/]/.exec(c.target)?.[1];
  const role = c.kind === 'agent' ? c.target : roleOf;
  const name = c.target.split(/[\\/]/).pop()!.replace(/\.md$/i, '') || c.target;
  const what = code.some(x => x.file.startsWith('queries/')) || /(?:^|[\\/])queries[\\/]/.test(c.target) ? 'query' : c.kind;
  return { kind: 'applied', what, action: c.action, name, ...(role && isRoleId(role) ? { role } : {}) };
}
const prov = (x: ProposalProvenance): ProposalProvenance => ({ ...x, evidence: x.evidence.filter(e => !!e && e.trim()).map(e => clip(e.trim())) });

// ── skill candidates waiting for promotion ───────────────────────────────────────────────────────────────────────
const isCandidateFile = (file: string): boolean => /[\\/]memory[\\/]skill-candidates[\\/][^\\/]+\.md$/.test(file);
/** The change that wrote a candidate (its rollback is the candidate's Rifiuta). */
function originOf(p: ProposalPorts, name: string): StoredChange | undefined {
  return p.changes?.stored().filter(c => c.job === 'repeated-task' && c.kind === 'skill' && c.action === 'create' && c.target === name && !c.rolledBackAt && c.files.some(f => isCandidateFile(f.file))).at(-1);
}
export const candidateReady = (c: SkillCandidateView): boolean => !c.promoted && c.stepsReady && c.promotionProblems.length === 0 && c.verifiedExampleRunIds.length > 0 && c.eligibleReplayIds.length > 0;
const candidate: Source = {
  id: 'candidate',
  available: p => !!p.candidates,
  async list(p) {
    const views = await p.candidates!.list(), log = p.changes?.list() ?? [];
    return views.filter(v => !v.promoted).flatMap(v => {
      const origin = originOf(p, v.name), undo = origin ? log.find(c => c.id === origin.id)?.canRollback === true : false;
      const ready = candidateReady(v);
      if (!ready && !undo) return []; // nothing the user could do with it here
      const { run, chat } = whereFrom(p, v.sourceRunIds[0]);
      return [card('candidate', v.name, {
        group: 'skill', applied: false, title: v.name, content: v.text, ask: { kind: 'skill', name: v.name },
        facts: [{ key: 'version', value: v.digest.slice(0, 12) }, ...(v.sourceRunIds.length ? [{ key: 'cases' as const, value: String(v.sourceRunIds.length) }] : [])],
        provenance: prov({ who: roleWho(run?.agentId, { kind: 'maintenance', id: 'repeated-task' }), ...(chat ? { chat } : {}), ...(v.sourceRunIds[0] ? { runId: v.sourceRunIds[0] } : {}),
          files: origin?.files.map(f => f.file) ?? [], at: iso(origin?.at ?? p.now()), evidence: [origin?.reason ?? '', ...v.sourceRunIds.map(id => `run ${id}`)] }),
        canApprove: ready, canReject: undo, readFirst: true, evidenceRuns: [...new Set([...v.sourceRunIds, ...v.verifiedExampleRunIds])].slice(0, 6), ...(ready ? {} : { blocked: v.promotionProblems.length ? v.promotionProblems : ['missing-verified-example'] }),
      })];
    });
  },
  async decide(p, c, decision) {
    const name = native(c);
    const v = (await p.candidates!.list()).find(x => x.name === name);
    if (!v) throw new Error('Skill candidate not found.');
    if (decision === 'approve') {
      const before = new Set((p.changes?.stored() ?? []).map(x => x.id));
      await p.candidates!.promote(v.name, v.digest, v.eligibleReplayIds[0]!, v.verifiedExampleRunIds[0]!);
      return (p.changes?.stored() ?? []).filter(x => !before.has(x.id) && x.kind === 'skill' && x.target === v.name).map(x => x.id);
    }
    const origin = originOf(p, name);
    if (!origin) throw new Error('The change that wrote this candidate is gone.');
    await p.changes!.rollback(origin.id);
  },
};

// ── what the maintenance applied by itself in the last 14 days ──────────────────────────────────────────────────────
const change: Source = {
  id: 'change',
  available: p => !!p.changes,
  async list(p) {
    const since = p.now() - CHANGE_WINDOW_MS, stored = p.changes!.stored();
    const candidates = new Set((await p.candidates?.list() ?? []).map(c => c.name));
    // memory tidy-ups stay in the Log with Annulla, never a card: the owner sees only skills and rules (ADR 0150)
    return p.changes!.list().filter(c => c.at >= since && !c.rolledBackAt && !FORMAT_JOBS.includes(c.job) && c.kind !== 'memory' && !p.reviewed.has(c.id)).flatMap(c => {
      const snaps = stored.find(s => s.id === c.id)?.files ?? [], files = snaps.map(f => f.file);
      // a skill candidate is its own card (Approva / Rifiuta), never twice
      if (files.some(isCandidateFile) || (c.job === 'repeated-task' && candidates.has(c.target))) return [];
      const code = codeOf(snaps), ask = changeAsk(c, code);
      const group = ask.kind === 'applied' && (ask.what === 'script' || ask.what === 'query') ? 'script' : c.kind === 'skill' ? 'skill' : c.kind === 'rule' ? 'rule' : c.kind === 'memory' ? 'fact' : 'role';
      const facts: ProposalFact[] = [{ key: 'action', value: c.action }, { key: 'target', value: c.target }];
      return [card('change', c.id, {
        group, applied: true, title: c.summary, content: c.reason, facts, ask, ...(code.length ? { code } : {}),
        provenance: prov({ who: { kind: 'maintenance', id: c.job }, files: files.length ? files : c.kind === 'rule' || c.kind === 'memory' ? [c.target] : [], at: iso(c.at), evidence: c.evidence }),
        canApprove: true, canReject: c.canRollback, ...(c.canRollback ? {} : { blocked: ['changed-since'] }),
      })];
    });
  },
  async decide(p, c, decision) {
    const id = native(c);
    if (decision === 'approve') { p.reviewed.mark(id); return [id]; }
    await p.changes!.rollback(id);
  },
};

// ── agents' requests for a protected setting ────────────────────────────────────────────────────────────────────────
const setting: Source = {
  id: 'setting',
  available: p => !!p.settings,
  async list(p) {
    return p.settings!.pending().map(s => {
      const { who, chat } = chatWho(p, s.chatId);
      return card('setting', s.id, {
        group: 'setting', applied: false, title: s.label, content: s.reason ?? '', ask: { kind: 'setting', label: s.label, before: valueText(s.before), after: valueText(s.after) },
        facts: [{ key: 'target', value: s.key }, { key: 'before', value: valueText(s.before) }, { key: 'after', value: valueText(s.after) }],
        provenance: prov({ who, ...(chat ? { chat } : {}), at: iso(s.at), evidence: [s.reason ?? ''] }),
        canApprove: true, canReject: true,
      });
    });
  },
  async decide(p, c, decision) { await p.settings!.confirm(native(c), decision === 'approve'); },
};

// ── role trials (a trial version runs: keep it or go back) and the loop's tier suggestions ──────────────────────────────
const trial: Source = {
  id: 'trial',
  available: p => !!p.roles,
  async list(p) {
    const snapshot = await Promise.resolve(p.lifecycle?.read()).catch(() => undefined);
    return p.roles!.list().filter(r => r.scope === 'role' && r.trial).map(r => {
      const t = r.trial!, advice = snapshot?.proposals.find(x => x.key === `trial:${r.id}:${t.version}`);
      const evaluation = snapshot?.evaluations.find(e => e.agentId === r.id && e.version === t.version)?.result;
      return card('trial', r.id, {
        group: 'role', applied: true, title: r.name, content: advice?.reason ?? evaluation?.reason ?? '',
        ask: { kind: 'trial', role: r.id, version: t.version, baseline: t.baseline, ...(advice ? { advice: advice.kind } : {}) },
        facts: [{ key: 'version', value: `v${t.version}` }, { key: 'before', value: `v${t.baseline}` }, ...(r.tier ? [{ key: 'tier' as const, value: r.tier }] : []), ...(advice ? [{ key: 'action' as const, value: advice.kind }] : [])],
        provenance: prov({ who: { kind: 'app', id: 'lifecycle' }, at: iso(t.startedAt), evidence: [advice?.reason ?? '', ...(advice?.evidence ?? []).map(e => `${e.kind} ${e.ref}`)] }),
        canApprove: true, canReject: true,
      });
    });
  },
  async decide(p, c, decision) { await p.roles!.resolveTrial(native(c), decision === 'approve' ? 'keep' : 'rollback'); },
};
const tier: Source = {
  id: 'tier',
  available: p => !!p.lifecycle,
  async list(p) {
    const snapshot = await p.lifecycle!.read(), roles = p.roles?.list() ?? [];
    return snapshot.proposals.filter(x => x.state === 'pending' && x.kind === 'tier').map(x => {
      const names = x.agentIds.map(id => roles.find(r => r.id === id)?.name ?? id).join(', ');
      const before = roles.find(r => r.id === x.agentIds[0])?.tier;
      const run = x.evidence.find(e => e.kind === 'run')?.ref, { chat } = whereFrom(p, run);
      return card('tier', x.key, {
        group: 'role', applied: false, title: names, content: x.reason,
        ask: { kind: 'tier', roles: x.agentIds, ...(before ? { before } : {}), ...(x.tier ? { tier: x.tier } : {}), skills: x.skills ?? [] },
        facts: [...(before ? [{ key: 'before' as const, value: before }] : []), ...(x.tier ? [{ key: 'tier' as const, value: x.tier }] : []), ...(x.skills?.length ? [{ key: 'target' as const, value: x.skills.join(', ') }] : [])],
        provenance: prov({ who: { kind: 'app', id: 'lifecycle' }, ...(chat ? { chat } : {}), ...(run ? { runId: run } : {}), at: iso(x.at), evidence: [x.reason, ...x.evidence.map(e => `${e.kind} ${e.ref}`)] }),
        canApprove: true, canReject: true,
      });
    });
  },
  async decide(p, c, decision) { await p.lifecycle!.decide(native(c), decision === 'approve' ? 'approve' : 'dismiss'); },
};

// ── the Battito's learned rules ───────────────────────────────────────────────────────────────────────────────────
const pulse: Source = {
  id: 'pulse',
  available: p => !!p.pulse,
  async list(p) {
    const rows = await p.pulse!.list();
    return (Array.isArray(rows) ? rows : []).filter(x => x?.state === 'pending').map(x => card('pulse', x.id, {
      group: 'rule', applied: false, title: x.title, content: x.text, facts: [{ key: 'target', value: x.agentId }], ask: { kind: 'rule', role: x.agentId },
      provenance: prov({ who: { kind: 'role', id: 'pulse' }, at: iso(x.createdAt), evidence: x.evidence.map(e => `${e}`) }),
      canApprove: true, canReject: true,
    }));
  },
  async decide(p, c, decision) {
    const r = await p.pulse!.decide(native(c), decision === 'approve' ? 'approve' : 'discard');
    if (!r.ok) throw new Error(r.error);
  },
};

// ── the improvement loop's policies (estimates, model choice, thresholds) ─────────────────────────────────────────────
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});
const ID = /^[a-z][a-z0-9-]{0,30}-\d{1,6}$/;
const policy: Source = {
  id: 'policy',
  available: p => !!p.policies,
  async list(p) {
    // /api/improve answers a stale-while-revalidate wrapper ({ value, at, … }) or the bare status
    const raw = obj(await p.policies!.status()), status = obj('value' in raw ? raw.value : raw);
    const rows = Array.isArray(status.policies) ? status.policies : [];
    return rows.map(obj).filter(x => typeof x.domain === 'string' && x.domain !== 'estimates' && ID.test(String(obj(x.pending).id ?? ''))).map(x => {
      const pend = obj(x.pending), ev = obj(pend.evidence), diff = obj(ev.diff);
      const facts: ProposalFact[] = [{ key: 'target', value: String(x.domain) }, ...(typeof x.version === 'number' ? [{ key: 'version' as const, value: `v${x.version} → v${x.version + 1}` }] : []),
        ...(typeof ev.shared === 'number' ? [{ key: 'cases' as const, value: String(ev.shared) }] : []),
        ...(typeof diff.mean === 'number' ? [{ key: 'gain' as const, value: `${(diff.mean as number).toFixed(3)} [${Number(diff.lo).toFixed(3)}, ${Number(diff.hi).toFixed(3)}]` }] : [])];
      const at = typeof pend.at === 'string' && Number.isFinite(Date.parse(pend.at)) ? pend.at : iso(p.now());
      const name = typeof pend.name === 'string' && pend.name ? pend.name : String(pend.id);
      return card('policy', String(pend.id), {
        group: 'learning', applied: false, title: name, content: '', facts,
        ask: { kind: 'policy', domain: String(x.domain), name, ...(typeof x.version === 'number' ? { from: x.version, to: x.version + 1 } : {}), ...(typeof ev.shared === 'number' ? { cases: ev.shared } : {}) },
        provenance: prov({ who: { kind: 'app', id: 'improve' }, at: new Date(at).toISOString(), evidence: [] }),
        canApprove: true, canReject: true,
      });
    });
  },
  async decide(p, c, decision) {
    const r = await p.policies!.act({ action: decision === 'approve' ? 'apply' : 'reject', id: native(c) });
    if (!r.ok) throw new Error(r.error);
  },
};

// ── the maintenance's findings (ADR 0132) ─────────────────────────────────────────────────────────────────────────────
const RESEARCH_GROUP: Readonly<Record<string, ProposalGroup>> = { skill: 'skill', rule: 'rule', role: 'role', forget: 'forget' };
/** The text the card is about, as it is: what a change adds, what forgetting removes, or the issue as it will be opened. */
function researchContent(x: ResearchProposal): string {
  if (x.issue && !x.change) return x.issue.body;
  if (x.change) return x.change.target === 'skill' ? x.change.text : `> ${x.change.text.replace(/\n/g, '\n> ')}`;
  if (x.forget) return `\`${x.forget.what === 'rule' ? x.forget.name : `.claude/skills/${x.forget.name}/`}\``;
  return '';
}
/** A candidate brain as one card (ADR 0195): the findings it gathers, a diff per file, its checks and replay. */
function candidateCard(p: ProposalPorts, c: BrainCandidateView): Proposal {
  const items = c.items.map(x => ({ finding: x.kind, title: x.title }));
  const chat = p.chats().find(x => x.id === c.chatId);
  return card('research', c.id, {
    group: 'brain', applied: false, title: items.map(x => x.title).join(' · ').slice(0, 300) || c.id,
    // the card's content is what the user decides on: the findings it gathers (main refuses a card that changed since)
    content: items.map(x => `- ${x.title}`).join('\n'),
    ask: { kind: 'candidate', items, files: c.files.length, checks: c.evaluation.checks, replay: { state: c.evaluation.replay.state, note: c.evaluation.replay.note, ...(c.evaluation.replay.status ? { status: c.evaluation.replay.status } : {}) } },
    diffs: c.files.map(f => ({ file: f.rel, before: f.before, after: f.after })),
    facts: [{ key: 'cases', value: String(items.length) }, { key: 'target', value: c.files.map(f => f.rel).join(', ').slice(0, 600) }],
    provenance: prov({ who: { kind: 'maintenance', id: 'research' }, ...(chat ? { chat: { id: chat.id, title: chat.title } } : {}), files: c.files.map(f => f.rel), at: iso(c.at),
      evidence: items.map(x => x.title) }),
    canApprove: true, canReject: true,
  });
}
const research: Source = {
  id: 'research',
  available: p => !!p.research,
  async list(p) {
    const chats = p.chats();
    const candidates = (p.research!.candidates?.() ?? []).map(c => candidateCard(p, c));
    return [...candidates, ...p.research!.list().map(x => {
      const chat = x.chatId ? chats.find(c => c.id === x.chatId) : undefined;
      const role = x.change?.role;
      // an idea or a bug about the app's code (or a bold idea that is one): a card that opens its issue on GitHub (ADR 0153)
      const issue = !!x.issue && !x.change && (x.kind === 'app-idea' || x.kind === 'app-bug' || x.kind === 'bold');
      const repo = issue ? p.research!.repo?.() ?? null : null;
      return card('research', x.id, {
        group: issue ? 'issue' : x.kind === 'bold' ? RESEARCH_GROUP[x.change?.target ?? 'rule'] ?? 'rule' : RESEARCH_GROUP[x.kind] ?? 'rule', applied: false, title: issue ? x.issue!.title : x.title, content: researchContent(x),
        ask: { kind: 'research', finding: x.kind, adds: x.adds, removes: x.removes, why: x.why, expected: x.expected, risk: x.risk, evidence: x.evidence, sources: x.sources, ...(x.roleTrial ? { trial: true } : {}) },
        // a revised role text (ADR 0195): its before and after
        ...(x.roleTrial ? { diffs: [{ file: x.roleTrial.role, before: x.roleTrial.before, after: x.roleTrial.text }] } : {}),
        facts: [...(role ?? x.roleTrial?.role ? [{ key: 'target' as const, value: (role ?? x.roleTrial?.role)! }] : []), ...(x.change?.name ? [{ key: 'target' as const, value: x.change.name }] : []),
          ...(issue && repo ? [{ key: 'target' as const, value: repo }] : []), ...(issue && x.issue!.labels?.length ? [{ key: 'scope' as const, value: x.issue!.labels.join(', ') }] : []),
          ...(issue && x.issue!.duplicateOf ? [{ key: 'before' as const, value: x.issue!.duplicateOf.url }] : [])],
        provenance: prov({ who: { kind: 'maintenance', id: x.chatId ? 'research' : 'cleanup' }, ...(chat ? { chat: { id: chat.id, title: chat.title } } : {}), at: iso(x.at), evidence: x.evidence }),
        canApprove: !issue || !!repo, canReject: true, ...(issue && !repo ? { blocked: ['noRepo'] } : {}),
      });
    })];
  },
  async decide(p, c, decision) {
    if (decision !== 'approve') { await p.research!.reject(native(c)); return; }
    const made = await p.research!.approve(native(c));
    // a brain finding answers its change's id (an app card answers the issue's URL)
    return typeof made === 'string' && (p.changes?.stored() ?? []).some(x => x.id === made) ? [made] : [];
  },
};

export const SOURCES: readonly Source[] = [candidate, change, setting, trial, tier, pulse, policy, research];
/** A path shown short: relative to the brain when it is inside it. */
export const shortPath = (file: string, root: string | null): string => (root && path.isAbsolute(file) && path.resolve(file).startsWith(path.resolve(root) + path.sep) ? path.relative(root, file).split(path.sep).join('/') : file);
