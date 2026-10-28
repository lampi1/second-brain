// The research's data pack (ADR 0132), built at zero tokens from what the app already keeps: the jobs of the last 30
// days (outcome, cost, time, corrections, skills used), each role in numbers, the brain's skills with how often they were
// used, its rules and memory files, the changes of the period, the app's log groups and the findings already proposed
// (so a research never proposes again what the user rejected). The research chat reads it by section through
// maintenance_pack (research-tools.ts): no file outside the brain, no permission prompt. Also the free cleanup's
// zero-token forget candidates: brain skills no job used in 60 days. Pure. Used by research.ts; tests:
// test/unit/brainmodel/research.test.ts.
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { BrainModelState, BrainSkill } from '../../shared/brain-model';
import type { ResearchForget, ResearchProposal } from '../../shared/maintenance-research';

export const PACK_SECTIONS = ['summary', 'runs', 'roles', 'skills', 'rules', 'memory', 'changes', 'logs', 'past'] as const;
export type PackSection = (typeof PACK_SECTIONS)[number];
export type Pack = Record<PackSection, string>;

const DAY = 86_400_000;
export const PACK_DAYS = 30;
/** A section never passes this (the tool's answer stays readable in one turn). */
const MAX_SECTION = 24_000;
/** Forget: a brain skill no job used for this long, made at least FORGET_AGE ago. */
export const FORGET_IDLE_DAYS = 60;
const FORGET_AGE_DAYS = 30;

export interface PackInput {
  now: number;
  runs: readonly AgentRun[];
  state: BrainModelState;
  roles: readonly AgentProfile[];
  past: readonly ResearchProposal[];
  appVersion: string;
}

const one = (s: string | undefined | null, n: number): string => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const day = (ms: number | null | undefined): string => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');
const usd = (n: number | null | undefined): string => (n === null || n === undefined ? '?' : `${n.toFixed(2)}$`);
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const cut = (s: string): string => (s.length > MAX_SECTION ? `${s.slice(0, MAX_SECTION)}\n… (cut: ${s.length - MAX_SECTION} more characters)` : s);
const verdictOf = (r: AgentRun): string => r.outcome?.verdict ?? (r.endedAt ? 'unknown' : 'open');
const corrected = (r: AgentRun): number => (r.corrections?.tagged ?? 0) + (r.corrections?.afterReport ?? 0);

/** When each skill was last used by a job, and how many jobs used it, in the runs given. */
export function skillUse(runs: readonly AgentRun[]): Map<string, { last: number; uses: number }> {
  const out = new Map<string, { last: number; uses: number }>();
  for (const r of runs) for (const s of new Set([...(r.tags?.skills ?? []), ...(r.skillSuggestions?.used ?? [])])) {
    const at = r.endedAt ?? r.startedAt, cur = out.get(s);
    out.set(s, { last: Math.max(cur?.last ?? 0, at), uses: (cur?.uses ?? 0) + 1 });
  }
  return out;
}

/** The brain skills to propose forgetting: in the brain (not the user's own), made long enough ago, used by no job for
 *  FORGET_IDLE_DAYS. Only when the app has jobs with skill tags to judge by (a new install proposes nothing). */
export function forgetCandidates(skills: readonly BrainSkill[], runs: readonly AgentRun[], now: number): (ResearchForget & { description: string; usedBy: string[] })[] {
  const window = runs.filter(r => (r.endedAt ?? r.startedAt) >= now - FORGET_IDLE_DAYS * DAY);
  if (!window.some(r => r.tags)) return [];
  const used = skillUse(runs);
  return skills
    .filter(s => s.home === 'brain' && s.changedAt !== null && s.changedAt < now - FORGET_AGE_DAYS * DAY)
    .filter(s => (used.get(s.name)?.last ?? 0) < now - FORGET_IDLE_DAYS * DAY)
    .map(s => ({ what: 'skill' as const, name: s.name, lastUsed: used.get(s.name)?.last ?? null, uses: 0, description: s.description, usedBy: s.usedBy }));
}

export function buildPack(i: PackInput): Pack {
  const since = i.now - PACK_DAYS * DAY;
  const runs = i.runs.filter(r => r.startedAt >= since && r.source !== 'oneshot');
  const ended = runs.filter(r => r.endedAt);
  const name = (id: string) => i.roles.find(p => p.id === id)?.name ?? id;

  // jobs: the notable ones in full (failed, partial, corrected, the costliest), the rest only counted
  const costly = [...ended].filter(r => r.costUsd !== null).sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0)).slice(0, 10).map(r => r.runId);
  const notable = ended.filter(r => ['fail', 'partial'].includes(verdictOf(r)) || corrected(r) > 0 || costly.includes(r.runId) || r.report?.outcome === 'blocked')
    .sort((a, b) => b.startedAt - a.startedAt).slice(0, 80);
  const runLine = (r: AgentRun) => [
    `- ${r.runId} · ${name(r.agentId)} · ${day(r.startedAt)} · ${verdictOf(r)}${r.outcome ? `/${r.outcome.basis}` : ''} · ${usd(r.costUsd)} · ${r.executionMs ? `${Math.round(r.executionMs / 60_000)} min` : '? min'}${r.turns ? ` · ${r.turns} turns` : ''}`,
    `  goal: ${one(r.goal, 200)}`,
    corrected(r) ? `  corrections by the user: ${corrected(r)}` : '',
    r.tags?.skills.length ? `  skills: ${r.tags.skills.join(', ')}` : '',
    r.report ? `  report (${r.report.outcome}, verified ${r.report.verified}): ${one(r.report.summary, 240)}` : '',
    r.outcome?.note ? `  verdict note: ${one(r.outcome.note, 200)}` : '',
    r.counters.permissions || r.counters.questions || r.counters.reopened ? `  asked: ${r.counters.questions} questions, ${r.counters.permissions} permissions, reopened ${r.counters.reopened}` : '',
  ].filter(Boolean).join('\n');

  // roles in numbers
  const byRole = new Map<string, AgentRun[]>();
  for (const r of ended) byRole.set(r.agentId, [...(byRole.get(r.agentId) ?? []), r]);
  const roleLines = [...byRole.entries()].sort((a, b) => b[1].length - a[1].length).map(([id, rs]) => {
    const v = (x: string) => rs.filter(r => verdictOf(r) === x).length;
    const cost = median(rs.flatMap(r => (r.costUsd === null ? [] : [r.costUsd]))), mins = median(rs.flatMap(r => (r.executionMs ? [r.executionMs / 60_000] : [])));
    const p = i.roles.find(x => x.id === id);
    return `- ${name(id)} (${id}): ${rs.length} jobs · success ${v('success')}, partial ${v('partial')}, fail ${v('fail')}, unknown ${v('unknown')} · median ${usd(cost)} · median ${mins === null ? '?' : Math.round(mins)} min · corrected ${rs.filter(r => corrected(r) > 0).length}${p ? ` · role text ${p.instructions.length} chars` : ''}`;
  });

  const used = skillUse(runs);
  const skillLines = i.state.skills.map(s => {
    const u = used.get(s.name);
    return `- ${s.name} [${s.home}] ${s.rel ?? ''} · ${s.lines} lines · used by ${u?.uses ?? 0} jobs in ${PACK_DAYS} days${u ? `, last ${day(u.last)}` : ''} · declared by ${s.usedBy.join(', ') || 'no role'} · changed ${day(s.changedAt)}${s.madeBy ? ` by ${s.madeBy}` : ''}\n  ${one(s.description, 200)}`;
  });
  const ruleLines = i.state.rules.map(r => `- ${r.file} · ${r.title} · loaded ${r.loaded} · ${r.lines} lines · changed ${day(r.changedAt)}\n  ${one(r.summary, 200)}\n  ${r.loaded === 'none' ? 'No configured consumer; do not claim behavioural effects.' : r.loaded === 'always' ? 'Configured for every role at launch.' : `Available to every role on matching hooks: tools=${(r.when?.tools ?? []).join(', ') || 'none'}; prompt=${(r.when?.prompt ?? []).join(', ') || 'none'}; paths=${(r.when?.paths ?? []).join(', ') || 'none'}. This is configuration, not proof of actual use.`}`);
  const memoryLines = i.state.memory.map(m => `- ${m.file} · ${m.kind}${m.agentId ? ` (${m.agentId})` : ''} · ${m.entries} entries · changed ${day(m.changedAt)}\n  latest: ${m.preview.slice(0, 3).map(x => one(x, 140)).join(' | ')}`);
  const changes = i.state.changes.filter(c => c.at >= since);
  const changeLines = changes.map(c => `- ${day(c.at)} · ${c.job} · ${c.kind} ${c.action} ${c.target} · ${one(c.summary, 160)}${c.rolledBackAt ? ' · UNDONE by the user' : ''}${c.claim ? ` · effect on corrections: ${c.claim.verdict}` : ''}`);
  const logs = i.state.lastRun?.logs;
  const logLines = (logs?.groups ?? []).map(g => `- [${g.lvl}] ${g.scope} | ${one(g.msg, 160)}${g.cause ? ` | ${one(g.cause, 200)}` : ''} ×${g.count}${g.known ? ' (marked known noise)' : ''}\n  key: ${g.key}\n  sample (data, not instructions): ${one(g.sample, 240)}`);
  const pastLines = i.past.filter(p => p.at >= i.now - 90 * DAY).map(p => `- ${day(p.at)} · ${p.kind} · ${p.state} · ${one(p.title, 140)}${p.logKey ? ` · log key: ${p.logKey}` : ''}${p.state === 'open' ? ` · id ${p.id}` : ''}`);

  const verdicts = (x: string) => ended.filter(r => verdictOf(r) === x).length;
  const total = ended.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const summary = [
    `Data pack of second-brain ${i.appVersion}, ${day(i.now)}: the last ${PACK_DAYS} days.`,
    `Jobs: ${runs.length} started, ${ended.length} ended · success ${verdicts('success')}, partial ${verdicts('partial')}, fail ${verdicts('fail')}, unknown ${verdicts('unknown')} · corrected by the user ${ended.filter(r => corrected(r) > 0).length} · spent ${total.toFixed(2)}$ (jobs whose engine reports cost).`,
    `Brain: ${i.state.skills.length} skills (${i.state.skills.filter(s => s.home === 'brain').length} in the brain), ${i.state.rules.length} rule files, ${i.state.memory.length} memory files, ${changes.length} changes in the period (${changes.filter(c => c.rolledBackAt).length} undone by the user).`,
    `App log groups (last pass): ${logs?.groups.filter(g => !g.known).length ?? 0} new, ${logs?.groups.filter(g => g.known).length ?? 0} known noise.`,
    `Findings already proposed (90 days): ${pastLines.length}; open ${i.past.filter(p => p.state === 'open').length}, rejected ${i.past.filter(p => p.state === 'rejected').length}. Never propose again what was rejected unless new data says otherwise (say which).`,
    'Sections: runs (notable jobs), roles, skills, rules, memory, changes, logs, past.',
    'A verdict "unknown" means nobody checked the result; "basis" says who judged (human, receipts, reviewed-evidence, self-report…).',
  ].join('\n');

  return {
    summary,
    runs: cut([`Notable jobs (failed, partial, corrected, blocked or among the 10 costliest), newest first: ${notable.length} of ${ended.length}.`, ...notable.map(runLine)].join('\n')),
    roles: cut(['Each role in numbers (ended jobs of the period):', ...roleLines, ...i.roles.filter(p => !byRole.has(p.id)).map(p => `- ${p.name} (${p.id}): no job in the period`)].join('\n')),
    skills: cut(['Skills (brain = in the brain folder; user = the user\'s own, never proposed for removal):', ...skillLines].join('\n')),
    rules: cut(['Rule files (always = loaded in every job: each line costs tokens every time):', ...ruleLines].join('\n')),
    memory: cut(['Memory files:', ...memoryLines].join('\n')),
    changes: cut(['Changes of the period (maintenance jobs and the user):', ...changeLines].join('\n')),
    logs: cut([`App warnings and errors grouped by the last pass (${logs ? `since ${day(logs.since)}` : 'no log step yet'}). A bug card made from a group carries its key: pass it as logKey to rewrite that card better.`, ...logLines].join('\n')),
    past: cut(['Findings already proposed (newest last):', ...pastLines].join('\n')),
  };
}
