// Durable proposals remain exact and actionable in the shared modal, with free response and evidence links.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
import { WorkApproval } from '../../src/renderer/components/WorkApproval';
import { durableAsks, withDurableAsks } from '../../src/renderer/lib/work-ask';
import type { WorkThread } from '../../src/shared/workflows';
import type { LearnedRuleProposal } from '../../src/shared/agent-pack';
const row: WorkThread = { id: 'thread', version: 4, title: 'Demo', profile: 'feature', priority: 'normal', stage: 'plan', status: 'approval', summary: 'General progress', evidence: '[Report](file:///tmp/report.md)', waitingOn: '', nextAction: '', chatIds: [], events: [], createdAt: 1, updatedAt: 2, cycles: 0, proposal: { id: 'proposal', text: 'Use the smaller migration on the staging database only.' } };
it('renders the exact visible proposal, deferred details, file viewer link and all three response paths', () => {
  const ask = durableAsks([row], [])[0]!;
  const html = renderToStaticMarkup(createElement(WorkApproval, { ask, onEscape: vi.fn() }));
  expect(html).toContain(row.proposal!.text);
  expect(html).toContain('General progress'); expect(html).toContain('Sì, procedi'); expect(html).toContain('No, proponi altro'); expect(html).toContain('Altro…');
  expect(html).toContain('<details>'); expect(html).not.toContain('<details open');
  expect(html).toContain('ctx-link file'); expect(html).toContain('Report');
  expect(html).toContain('data-request-key="workflow/thread@4:proposal"');
});
it('keeps existing requests ahead of durable decisions, including work with no live chat; changes invalidate its deferred key', () => {
  const asks = durableAsks([row, { ...row, id: 'done', status: 'done' }], []);
  const permission = { type: 'permission', at: 99 };
  expect(withDurableAsks([permission], asks)[0]).toBe(permission);
  expect(asks).toHaveLength(1);
  expect(durableAsks([{ ...row, version: 5 }], [])[0]!.id).not.toBe(asks[0]!.id);
  expect(durableAsks([{ ...row, proposal: { id: 'new', text: 'New scope' } }], [])[0]!.id).not.toBe(asks[0]!.id);
});
it('exposes unapproved lessons, binds their exact text and blocks unsupported approval while allowing rejection and free text', () => {
  const lesson: LearnedRuleProposal = { id: 'l', agentId: 'artisan', rule: 'Check keyboard behavior.', evidence: 'One correction', createdAt: 3, status: 'pending' };
  const ask = durableAsks([], [lesson])[0]!;
  const html = renderToStaticMarkup(createElement(WorkApproval, { ask, onEscape: vi.fn() }));
  expect(html).toMatch(/disabled=""[^>]*data-testid="work-approve"/);
  expect(html).toContain('Altro…'); expect(html).toContain('Fonti e verifiche');
  expect(durableAsks([], [{ ...lesson, rule: 'Changed rule.' }])[0]!.id).not.toBe(ask.id);
  // The host waiting projection includes a previous approval whose evidence became insufficient.
  expect(durableAsks([], [{ ...lesson, userApproved: true }])).toHaveLength(1);
  const global = renderToStaticMarkup(createElement(WorkApproval, { ask: durableAsks([], [{ ...lesson, target: 'rule' }])[0]!, onEscape: vi.fn() }));
  expect(global).toContain('Regole del brain · tutti i ruoli');
  const skill = renderToStaticMarkup(createElement(WorkApproval, { ask: durableAsks([], [{ ...lesson, target: 'skill', skill: 'accessibility' }])[0]!, onEscape: vi.fn() }));
  expect(skill).toContain('Skill accessibility');
});
