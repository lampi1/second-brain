// A workflow yes/no decision must show its exact proposal visibly, not only its accessibility label.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
import { WorkCard } from '../../src/renderer/components/WorkCockpit';
import type { WorkThread } from '../../src/shared/workflows';
it('renders the exact pending proposal separately from an unrelated summary', () => {
  const row = { id: 'thread', title: 'Demo', profile: 'feature', priority: 'normal', stage: 'plan', status: 'approval', summary: 'General progress', waitingOn: '', nextAction: '', chatIds: [], events: [], proposal: { id: 'proposal', text: 'Use the smaller migration on the staging database only.' } } as unknown as WorkThread;
  const html = renderToStaticMarkup(createElement(WorkCard, { row }));
  expect(html).toContain(`<span>${row.proposal!.text}</span>`);
  expect(html).toContain('General progress'); expect(html).toContain('Sì, procedi');
});
