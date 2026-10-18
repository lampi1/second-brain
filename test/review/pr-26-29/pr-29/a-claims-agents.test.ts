// Review test (PR #29, claim audit half A: cards every-task-agent … permissions). Each test reads the fact from main's
// code (the worktree outside the PR files is main f875516) and checks the card text against it. Every test here fails
// because the card states something main no longer does (agent metrics PR #22, earnable milestones PR #25, the agent
// builder's model call).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONCEPTS, type Bi } from '@shared/concept-guide';

const root = path.resolve(import.meta.dirname, '../../../..');
const src = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const card = (id: string) => CONCEPTS.find(c => c.id === id)!;
const both = (b: Bi) => `${b.it}\n${b.en}`;
const all = (id: string) => { const c = card(id); return [c.summary, ...c.points, ...c.tech.map(t => t.text), ...(c.target ?? [])].map(both).join('\n'); };

describe('card milestones vs main (PR #25: milestones earnable)', () => {
  const wiring = src('src/main/wiring.ts');
  it('main builds ProgressService enabled and awards first-agent and setup-complete (precondition)', () => {
    expect(wiring).toContain('new ProgressService(ctx.userData, { enabled: true');
    expect(wiring).toContain("progressService.award('first-agent')");
    expect(wiring).toContain("progressService.award('setup-complete')");
  });
  it('summary does not say the milestones are retired / no new ones are awarded', () => {
    expect(both(card('milestones').summary)).not.toMatch(/ritirat|retired|non se ne assegnano|no new ones/i);
  });
  it('points do not say the service is built disabled', () => {
    expect(card('milestones').points.map(both).join('\n')).not.toMatch(/disattivato|built disabled|non sono disponibili|unavailable/i);
  });
  it('tech row does not say ProgressService has enabled: false', () => {
    expect(card('milestones').tech.map(t => both(t.text)).join('\n')).not.toContain('enabled: false');
  });
});

describe('card errors-rules vs main (PR #22: corrections counted per run)', () => {
  it('main counts corrections on the run and as a per-agent metric (precondition)', () => {
    expect(src('src/shared/agents.ts')).toContain('corrections?: AgentRunCorrections');
    expect(src('src/main/chats/manager.ts')).toContain("run.corrections[tagged ? 'tagged' : 'afterReport']++");
    expect(src('src/shared/agents.ts')).toContain('correctionsPerRun: Metric');
  });
  it('target does not claim corrections are not counted in runs or metrics yet', () => {
    expect((card('errors-rules').target ?? []).map(both).join('\n')).not.toMatch(/non sono ancora contate|not counted/i);
  });
});

describe('card classifiers vs main: the headline is not the only model call', () => {
  it('main also calls a model for the agent builder draft (precondition)', () => {
    expect(src('src/main/agents/catalog.ts')).toContain('await this.d.complete(');
    expect(src('src/main/wiring.ts')).toContain("purpose: 'agent-builder'");
  });
  it('tech row does not say headline.ts is the app’s only model call', () => {
    expect(card('classifiers').tech.map(t => both(t.text)).join('\n')).not.toMatch(/unica chiamata a un modello|only model call/i);
  });
});

describe('card metrics vs main (PR #22: §5 metrics read from agent-runs.json)', () => {
  it('main computes per-agent metrics from the runs file, exposed as agents:metrics (precondition)', () => {
    expect(src('src/main/agents/run-metrics.ts')).toMatch(/read from agent-runs\.json/);
    expect(src('src/shared/contract.ts')).toContain("'agents:metrics'");
  });
  it('the card does not say agent metrics are not built from the runs file', () => {
    expect(all('metrics')).not.toMatch(/non dal file delle run|not from the runs file/i);
  });
});

describe('card runs vs main (PR #22: report, corrections, execution time, continuation links)', () => {
  const agents = src('src/shared/agents.ts');
  it('AgentRun carries report, corrections and executionMs (precondition)', () => {
    for (const f of ['report?: AgentRunReport', 'corrections?: AgentRunCorrections', 'executionMs?: number', 'continuedFrom?: string']) expect(agents).toContain(f);
  });
  it('the AgentRun data shape on the card lists report, corrections and executionMs', () => {
    const data = both(card('runs').tech[0]!.text);
    for (const f of ['report', 'corrections', 'executionMs']) expect(data, f).toContain(f);
  });
  it('main sets the continuation link and counts it as rework (precondition)', () => {
    expect(src('src/main/chats/manager.ts')).toContain('nr.s.run.continuedFrom = r.s.run.runId');
    expect(src('src/main/agents/run-metrics.ts')).toContain('r.continuedFrom');
  });
  it('target does not say nothing sets the links between runs (reworks)', () => {
    expect((card('runs').target ?? []).map(both).join('\n')).not.toMatch(/niente li imposta|nothing sets them/i);
  });
});
