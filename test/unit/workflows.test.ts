// Persistent workflow invariants: receipts, recovery loops, stale decisions and atomic corruption refusal.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workflows } from '../../src/main/workflows/service';
import { workflowTools } from '../../src/main/workflows/tools';
import type { ChatSummary } from '../../src/shared/contract';
import type { WorkReport, WorkThread } from '../../src/shared/workflows';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
function setup(profile: 'feature' | 'bugfix' | 'investigation' = 'feature') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-work-')); dirs.push(dir);
  const file = path.join(dir, 'work.json'), service = new Workflows(file);
  let row = service.create({ title: 'Search feature', profile, priority: 'normal', chatIds: ['implementation'] });
  return { service, file, get row() { return row; }, report(action: WorkReport['action'], extra: Partial<WorkReport> = {}) {
    row = service.report({ id: row.id, expectedVersion: row.version, action, summary: 'Observed outcome', ...extra }); return row;
  }, decide(approve: boolean) { row = service.decide({ id: row.id, expectedVersion: row.version, proposalId: row.proposal!.id, approve }); return row; } };
}
describe('work threads', () => {
  it('survives restart with the same identity, stage and history, without a live chat', () => {
    const f = setup(); f.report('complete', { evidence: 'requirements.md' });
    expect(new Workflows(f.file).list()).toEqual([f.row]); expect(f.row.stage).toBe('mockup');
  });
  it('requires evidence for every completion and approval for a mockup', () => {
    const f = setup(); expect(() => f.report('complete')).toThrow(/evidenze/);
    f.report('complete', { evidence: 'requirements.md' });
    expect(() => f.report('complete', { evidence: 'preview.png' })).toThrow(/approvata/);
    f.report('propose', { summary: 'Use this preview', evidence: 'preview.png' });
    expect(() => f.report('complete', { evidence: 'preview.png' })).toThrow(/attesa/);
    f.decide(true); f.report('update', { summary: 'Preparing approved preview' });
    f.report('complete', { evidence: 'preview.png' }); expect(f.row.stage).toBe('plan');
  });
  it('rejects stale and repeated user decisions and cannot self-approve through MCP', () => {
    const f = setup(); f.report('propose'); const before = f.row;
    f.decide(true);
    expect(() => f.service.decide({ id: before.id, expectedVersion: before.version, proposalId: before.proposal!.id, approve: true })).toThrow(/cambiato/);
    expect(workflowTools(f.service, () => true).map(t => t.name)).toEqual(['app_work_list', 'app_work_create', 'app_work_report']);
  });
  it('rejecting a proposal blocks completion until an alternative is approved', () => {
    const f = setup('investigation'); f.report('propose'); f.decide(false);
    expect(() => f.report('complete', { evidence: 'facts.md' })).toThrow(/bloccato/);
    f.report('propose', { summary: 'Alternative' }); f.decide(true); f.report('complete', { evidence: 'facts.md' });
    expect(f.row.status).toBe('done');
  });
  it('review failures loop through development, stop after three and resume only after an approved alternative', () => {
    const f = setup('bugfix'); f.report('complete', { evidence: 'analysis.md' }); f.report('propose'); f.decide(true);
    f.report('complete', { evidence: 'plan.md' });
    for (let i = 0; i < 3; i++) {
      f.report('complete', { evidence: `commit-${i}` }); expect(f.row.stage).toBe('review');
      f.report('fail', { evidence: 'failing review' }); expect(f.row.evidence).toBe('');
      if (i < 2) { expect(f.row.stage).toBe('develop'); expect(() => f.report('complete')).toThrow(/evidenze/); }
    }
    expect(f.row.status).toBe('blocked'); f.report('propose'); f.decide(false);
    expect(() => f.report('complete', { evidence: 'invented' })).toThrow(/bloccato/);
    f.report('propose'); f.decide(true); expect(f.row.stage).toBe('develop'); expect(f.row.cycles).toBe(0);
  });
  it('a new proposal invalidates the previous approval', () => {
    const f = setup('bugfix'); f.report('complete', { evidence: 'analysis' }); f.report('propose'); f.decide(true);
    f.report('propose', { summary: 'A different plan' }); expect(f.row.approvedProposal).toBeUndefined();
    f.decide(false); expect(() => f.report('complete', { evidence: 'plan' })).toThrow();
  });
  it('links several repositories but rejects duplicate active chat ownership', () => {
    const f = setup(); f.report('update', { chatIds: ['review'] }); expect(f.row.chatIds).toEqual(['implementation', 'review']);
    expect(() => f.service.create({ title: 'Duplicate', profile: 'feature', priority: 'normal', chatIds: ['review'] })).toThrow(/collegata/);
    const tools = workflowTools(f.service, id => id !== 'private');
    expect(() => tools[1]!.run({ title: 'Bad', profile: 'feature', priority: 'normal', chatIds: ['private'] })).toThrow(/visibili/);
  });
  it('sorts production before support and normal work', () => {
    const f = setup();
    f.service.create({ title: 'Support', priority: 'support', profile: 'bugfix', chatIds: [] });
    f.service.create({ title: 'Incident', priority: 'production', profile: 'bugfix', chatIds: [] });
    expect(f.service.list().map(r => r.priority)).toEqual(['production', 'support', 'normal']);
  });
  it.each([{ profile: 'constructor' }, { status: 'invented' }, { events: [null] }, { stage: 'deploy', profile: 'investigation' }])('preserves invalid persistent data %j', patch => {
    const f = setup(); fs.writeFileSync(f.file, JSON.stringify([{ ...f.row, ...patch }])); const raw = fs.readFileSync(f.file, 'utf8');
    expect(() => new Workflows(f.file)).toThrow(/conservato/); expect(fs.readFileSync(f.file, 'utf8')).toBe(raw);
  });
  it('does not mutate memory if persistence fails', () => {
    const f = setup(); const before: WorkThread[] = f.service.list(); fs.unlinkSync(f.file); fs.mkdirSync(f.file);
    expect(() => f.report('update')).toThrow(); expect(f.service.list()).toEqual(before);
  });
});

describe('existing Strategist approvals', () => {
  it('does not advance while any linked plan still waits, and supports an explicit replacement', () => {
    const f = setup('bugfix'); f.report('complete', { evidence: 'analysis' });
    let pending = true;
    const service = new Workflows(f.file, () => {}, Date.now, () => ({ pending, approved: 'Existing plan receipt' }));
    expect(() => service.report({ id: f.row.id, expectedVersion: f.row.version, action: 'complete', summary: 'Plan', evidence: 'plan.md' })).toThrow(/ancora da decidere/);
    pending = false;
    const proposal = service.report({ id: f.row.id, expectedVersion: f.row.version, action: 'propose', summary: 'Replacement plan' });
    const no = service.decide({ id: proposal.id, expectedVersion: proposal.version, proposalId: proposal.proposal!.id, approve: false });
    expect(() => service.report({ id: no.id, expectedVersion: no.version, action: 'complete', summary: 'Plan', evidence: 'plan.md' })).toThrow(/bloccato/);
  });
  it('consumes a linked user approval without a second proposal', () => {
    const f = setup('bugfix'); f.report('complete', { evidence: 'analysis' });
    const service = new Workflows(f.file, () => {}, Date.now, () => ({ pending: false, approved: 'Exact current plan' }));
    const next = service.report({ id: f.row.id, expectedVersion: f.row.version, action: 'complete', summary: 'Plan', evidence: 'plan.md' });
    expect(next.stage).toBe('develop'); expect(next.events.some(e => e.kind === 'approved')).toBe(true);
  });
});

describe('review ownership', () => {
  it('refuses unrelated or stale reviews and accepts only the recorded implementation run/version', () => {
    const f = setup('bugfix'); f.report('complete', { evidence: 'analysis' }); f.report('propose'); f.decide(true); f.report('complete', { evidence: 'plan' });
    f.report('update', { chatIds: ['reviewer'] });
    const worker = { id: 'implementation', agent: { id: 'artisan' }, run: { runId: 'implementation-run', taskVersion: 2 } };
    const reviewer = { id: 'reviewer', agent: { id: 'sentinel' }, run: { runId: 'review-run', reviewOf: 'unrelated', report: { at: Date.now() + 100, outcome: 'done', verified: 'yes' } } };
    const chats = [worker, reviewer] as unknown as ChatSummary[];
    const tool = workflowTools(f.service, () => true, id => chats.find(c => c.id === id))[2]!;
    const report = (a: Record<string, unknown>) => { const row = f.service.list()[0]!; return tool.run({ id: row.id, expectedVersion: row.version, action: 'complete', summary: 'Verified', evidence: 'check.log', ...a }); };
    report({ implementationChatId: 'implementation' });
    expect(() => report({ reviewChatId: 'reviewer' })).toThrow(/review Sentinel/);
    reviewer.run.reviewOf = 'implementation-run'; worker.run.taskVersion = 3;
    expect(() => report({ reviewChatId: 'reviewer' })).toThrow(/review Sentinel/);
    worker.run.taskVersion = 2; report({ reviewChatId: 'reviewer' });
    expect(f.service.list()[0]!.stage).toBe('test');
  });
});
