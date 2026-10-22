// The Proposte deck's sources (ADR 0123): each one turns what an existing module already keeps waiting for the user into
// cards (shared/proposals.ts) with who, where, when and the evidence, and decides a card only through that module's own
// path, the same call its old page made: a memory fact → memory:confirm / memory:retract; a skill candidate →
// learning:promote / the rollback of the change that wrote it; a change the maintenance applied → Tieni (a reviewed mark)
// / brainmodel:rollback; an agent's protected setting → settings:confirm; a role trial → agents:trialDecide; a tier
// suggestion → agents:lifecycleDecide; a Battito rule → approvals:decide; an improvement-loop policy → learn:act.
// Pure over injected ports (index.ts wires them to the handlers): unit-tested in test/unit/proposals/service.test.ts.
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { AgentLifecycleSnapshot } from '../../shared/agent-lifecycle';
import type { BrainChange } from '../../shared/brain-model';
import type { ChatSummary, LearnAction, LearnResult, SettingProposal } from '../../shared/contract';
import type { MemoryReviewRecord, SkillCandidateView } from '../../shared/learning-review';
import type { ApprovalItem as PulseApproval, PulseResult } from '../../shared/pulse';
import type { Proposal, ProposalAsk, ProposalCode, ProposalDecision, ProposalKeep, ProposalFact, ProposalProvenance, ProposalSource, ProposalWho } from '../../shared/proposals';
import { isRoleId } from '../../shared/roles';
import type { FileSnapshot, StoredChange } from '../brainmodel/changes';

/** Changes older than this are history, not news: they stay in the change log only. */
export const CHANGE_WINDOW_MS = 14 * 86_400_000;
/** Jobs whose changes are moves of the brain's own format, not knowledge to review. */
const FORMAT_JOBS: readonly string[] = ['migration', 'upgrade', 'user'];
/** The default verification a confirmed fact records when the user adds no note (memory-records.ts needs one line). */
export const DECK_EVIDENCE = 'Confirmed by the user in Memoria → Proposte';

export interface ProposalPorts {
  now(): number;
  runs(): readonly AgentRun[];
  chats(): readonly ChatSummary[];
  memory?: { list(): MemoryReviewRecord[] | Promise<MemoryReviewRecord[]>; confirm(id: string, evidence: string, choice?: { keep: ProposalKeep; ids: string[] }): Promise<unknown>; retract(id: string, reason: string): Promise<unknown> };
  candidates?: { list(): SkillCandidateView[] | Promise<SkillCandidateView[]>; promote(name: string, digest: string, replayId: string, exampleRunId: string): unknown };
  changes?: { list(): BrainChange[]; stored(): StoredChange[]; rollback(id: string): unknown };
  settings?: { pending(): SettingProposal[]; confirm(id: string, accept: boolean): unknown };
  roles?: { list(): AgentProfile[]; resolveTrial(id: string, decision: 'keep' | 'rollback'): unknown };
  lifecycle?: { read(): AgentLifecycleSnapshot | Promise<AgentLifecycleSnapshot>; decide(key: string, decision: 'approve' | 'dismiss'): unknown };
  pulse?: { list(): PulseApproval[] | Promise<PulseApproval[]>; decide(id: string, decision: 'approve' | 'discard'): PulseResult | Promise<PulseResult> };
  policies?: { status(): Promise<unknown>; act(a: LearnAction): Promise<LearnResult> };
  /** the reviewed marks (Tieni on an applied change) */
  reviewed: { has(id: string): boolean; mark(id: string): void };
}

/** One source: its cards now, and the decision on one of them (by its id in the source). */
export interface Source {
  id: ProposalSource;
  available(p: ProposalPorts): boolean;
  list(p: ProposalPorts): Promise<Proposal[]>;
  decide(p: ProposalPorts, card: Proposal, decision: ProposalDecision, note?: string, keep?: ProposalKeep): Promise<void>;
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
    const ext = path.extname(f.file).slice(1).toLowerCase(), name = f.file.replace(/^.*[\\/](scripts|queries)[\\/]/, '$1/');
    if (ext === 'md') {
      const block = /^(`{3,}|~{3,})([\w+-]*)[^\n]*\n([\s\S]*?)\n\1[ \t]*$/m.exec(text);
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

// ── memory facts to confirm ───────────────────────────────────────────────────────────────────────────────────────
const memory: Source = {
  id: 'memory',
  available: p => !!p.memory,
  async list(p) {
    const rows = await p.memory!.list();
    const same = (a: MemoryReviewRecord, b: MemoryReviewRecord): boolean => a.scope.roleId === b.scope.roleId && a.scope.userId === b.scope.userId && a.scope.project === b.scope.project
      && a.scope.repository === b.scope.repository && a.scope.environment === b.scope.environment && a.subject === b.subject && a.predicate === b.predicate;
    return rows.filter(r => r.status === 'proposed').map(r => {
      // the same check as memory-records.ts memoryConflicts: the card asks replace or keep both before Approva works
      const conflicts = rows.filter(x => x.memoryId !== r.memoryId && x.memoryId !== r.supersedes && same(x, r) && x.status === 'confirmed' && !x.validTo && x.value !== r.value)
        .map(x => ({ id: x.memoryId, value: x.value }));
      const { run, chat } = whereFrom(p, r.sourceRunId);
      const scope = Object.entries(r.scope).map(([k, v]) => `${k}: ${v}`).join(' · ');
      const evidence = [run?.report?.summary ?? '', run?.goal ? `${run.goal}` : '', `${r.sourceEventId}`];
      return card('memory', r.memoryId, {
        group: 'fact', applied: false, title: `${r.subject} · ${r.predicate}`, content: r.value,
        ask: { kind: 'remember', ...(isRoleId(r.scope.roleId) ? { role: r.scope.roleId } : {}), subject: r.subject, predicate: r.predicate,
          ...(r.scope.project ? { project: r.scope.project } : {}), ...(r.scope.repository ? { repository: r.scope.repository } : {}), ...(r.scope.environment ? { environment: r.scope.environment } : {}),
          ...(conflicts.length ? { conflicts } : {}) },
        facts: [{ key: 'scope', value: scope }, ...(r.supersedes ? [{ key: 'before' as const, value: r.supersedes }] : [])],
        provenance: prov({ who: roleWho(run?.agentId ?? r.scope.roleId, { kind: 'app', id: 'agent' }), ...(chat ? { chat } : {}), runId: r.sourceRunId, files: ['memory/records.json'], at: r.observedAt, evidence }),
        canApprove: true, canReject: true,
      });
    });
  },
  async decide(p, c, decision, note, keep) {
    const id = native(c), text = note?.trim().replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, 900);
    const conflicts = c.ask.kind === 'remember' ? c.ask.conflicts ?? [] : [];
    if (decision === 'approve' && conflicts.length && keep !== 'new' && keep !== 'both') throw new Error('Scegli prima cosa fare con quello che ricordava già: sostituirlo o tenerli entrambi.');
    if (decision === 'approve') await p.memory!.confirm(id, text || DECK_EVIDENCE, ...(conflicts.length && keep ? [{ keep, ids: conflicts.map(x => x.id) }] : []));
    else await p.memory!.retract(id, `Rejected in Memoria → Proposte${text ? `: ${text}` : ''}`);
  },
};

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
    if (decision === 'approve') { await p.candidates!.promote(v.name, v.digest, v.eligibleReplayIds[0]!, v.verifiedExampleRunIds[0]!); return; }
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
    return p.changes!.list().filter(c => c.at >= since && !c.rolledBackAt && !FORMAT_JOBS.includes(c.job) && !p.reviewed.has(c.id)).flatMap(c => {
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
    if (decision === 'approve') { p.reviewed.mark(id); return; }
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

export const SOURCES: readonly Source[] = [memory, candidate, change, setting, trial, tier, pulse, policy];
/** A path shown short: relative to the brain when it is inside it. */
export const shortPath = (file: string, root: string | null): string => (root && path.isAbsolute(file) && path.resolve(file).startsWith(path.resolve(root) + path.sep) ? path.relative(root, file).split(path.sep).join('/') : file);
