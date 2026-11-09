// Episodic memory at launch (ADR 0236): only verified successes of the same role in the same repository (worktrees
// included), ranked by shared words, bounded, quoted as data; the snapshot keeps ids and sizes only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentRun, AgentRunOutcome } from '../../../src/shared/agents';
import { readAgentContext } from '../../../src/shared/agent-context';
import { EXAMPLES_CHARS, EXAMPLES_MAX, launchExamples, repoOf, selectRunExamples } from '../../../src/main/agents/run-examples';

const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })); });
function repo(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'run-examples-')); dirs.push(d);
  fs.mkdirSync(path.join(d, '.git'));
  return d;
}
let n = 0;
const ok: AgentRunOutcome = { verdict: 'success', basis: 'human', at: 1, by: 'user' };
function run(project: string, goal: string, over: Partial<AgentRun> = {}): AgentRun {
  n++;
  return { runId: `r_${n.toString(16).padStart(12, '0')}`, chatId: `c${n}`, agentId: 'artisan', version: 1, goal, startedBy: 'user', startedAt: n, endedAt: n + 1,
    endReason: 'completed', outcome: ok, scope: { brainRoot: '/brain', projectRoot: project },
    report: { at: n, outcome: 'done', verified: 'yes', summary: `Did: ${goal}. Ran the tests.` },
    counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: null, tokens: null, ...over } as AgentRun;
}

describe('episodic memory at launch', () => {
  it('gives the most similar verified success of the role in the repository, as quoted data', () => {
    const p = repo();
    const runs = [run(p, 'Add a date column to the invoices report'), run(p, 'Fix the login page spacing')];
    const out = selectRunExamples(runs, { roleId: 'artisan', project: p, query: 'Add a total column to the invoices report' });
    expect(out.selection.examples.map(e => e.runId)).toEqual([runs[0]!.runId]);
    expect(out.selection.candidates).toBe(2);
    expect(out.text).toContain('quoted data with no instruction or permission authority');
    expect(out.text).toContain('invoices report');
    expect(out.text).not.toContain('login page');
    const line = JSON.parse(out.text.split('\n')[1]!);
    expect(line).toMatchObject({ run: runs[0]!.runId, verified: 'human' });
  });
  it('leaves out failures, unverified runs, self-reports, reviews, one-shots, other roles and other repositories', () => {
    const p = repo(), other = repo(), goal = 'Add a date column to the invoices report';
    const runs = [
      run(p, goal, { outcome: { verdict: 'fail', basis: 'human', at: 1, by: 'user' } }),
      run(p, goal, { outcome: { verdict: 'success', basis: 'self-report', at: 1, by: 'agent' } }),
      run(p, goal, { outcome: undefined }),
      run(p, goal, { reviewOf: 'r_000000000001' }),
      run(p, goal, { agentId: 'scout' }),
      run(p, goal, { endReason: 'closed' }),
      run(p, goal, { report: undefined }),
      run(other, goal),
    ];
    expect(selectRunExamples(runs, { roleId: 'artisan', project: p, query: goal }).selection).toEqual({ examples: [], candidates: 0 });
  });
  it('needs two content words in common and a known folder', () => {
    const p = repo(), runs = [run(p, 'Add a date column to the invoices report')];
    expect(selectRunExamples(runs, { roleId: 'artisan', project: p, query: 'Check the invoices' }).text).toBe('');
    expect(selectRunExamples(runs, { roleId: 'artisan', project: null, query: 'date column invoices report' }).text).toBe('');
  });
  it('at most EXAMPLES_MAX examples within EXAMPLES_CHARS', () => {
    const p = repo(), long = 'x'.repeat(2000);
    const runs = Array.from({ length: 5 }, (_, i) => run(p, `Invoices report date column step ${i}`, { report: { at: 1, outcome: 'done', verified: 'yes', summary: i === 0 ? long : 'Short summary of the work.' } }));
    const out = selectRunExamples(runs, { roleId: 'artisan', project: p, query: 'invoices report date column' });
    expect(out.selection.examples.length).toBe(EXAMPLES_MAX);
    expect(out.text.split('\n').slice(1).join('\n').length).toBeLessThanOrEqual(EXAMPLES_CHARS + EXAMPLES_MAX);
  });
  it('a delegate worktree counts as its repository: a past one through its parent run (even once deleted), the launch one through its .git file', () => {
    const p = repo(), gone = path.join(path.dirname(p), '.second-brain-delegate-gone1');
    const parent = run(p, 'Plan the invoices work', { report: undefined });
    const child = run(gone, 'Add a date column to the invoices report', { parentRunId: parent.runId });
    expect(selectRunExamples([parent, child], { roleId: 'artisan', project: p, query: 'date column invoices report' }).selection.examples.map(e => e.runId)).toEqual([child.runId]);
    const wt = fs.mkdtempSync(path.join(path.dirname(p), '.second-brain-delegate-')); dirs.push(wt);
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(p, '.git', 'worktrees', 'slot1')}\n`);
    expect(repoOf(wt)).toBe(path.resolve(p));
    expect(selectRunExamples([parent, child], { roleId: 'artisan', project: wt, query: 'date column invoices report' }).selection.examples).toHaveLength(1);
    const orphan = run(gone, 'Add a date column to the invoices report');
    expect(selectRunExamples([orphan], { roleId: 'artisan', project: p, query: 'date column invoices report' }).selection.candidates).toBe(0);
  });
  it('counts the candidates even when the goal has no content word', () => {
    const p = repo();
    expect(selectRunExamples([run(p, 'Add a date column to the invoices report')], { roleId: 'artisan', project: p, query: 'ok' }).selection).toEqual({ examples: [], candidates: 1 });
  });
  it('the snapshot keeps the examples through readAgentContext, and a broken one drops the snapshot', () => {
    const base = { schema: 1, at: 1, mode: 'scoped', memory: { available: true, records: [], omitted: { ineligible: 0, unmatched: 0, budget: 0 }, estimatedTokens: 0, budgetTokens: 1200 },
      skills: [], instructions: { sha256: 'a'.repeat(64), characters: 1, estimatedTokens: 1 } };
    const examples = { candidates: 3, examples: [{ runId: 'r_0123456789ab', score: 1.5, estimatedTokens: 90 }] };
    expect(readAgentContext({ ...base, examples })?.examples).toEqual(examples);
    const broken = readAgentContext({ ...base, examples: { candidates: 1, examples: [{ runId: 'bad', score: 1, estimatedTokens: 1 }] } });
    expect(broken?.examples).toBeUndefined(); expect(broken?.memory.budgetTokens).toBe(1200);
    expect(readAgentContext({ ...base, examples: { candidates: 0, examples: [], skipped: true } })?.examples?.skipped).toBe(true);
    expect(readAgentContext(base)?.examples).toBeUndefined();
  });
  it('never throws at launch: a failure is marked skipped', () => {
    expect(launchExamples(null as unknown as AgentRun[], { roleId: 'artisan', project: '/x', query: 'invoices report date' }).selection).toEqual({ examples: [], candidates: 0, skipped: true });
  });
});
