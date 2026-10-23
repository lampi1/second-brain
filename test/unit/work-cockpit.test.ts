// Renderer snapshot checks without Electron: no model calls, visible work and explicit decision outcomes.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { initialState } from '../../src/renderer/store/state';
import type { WorkThread } from '../../src/shared/workflows';
vi.mock('../../src/renderer/store/store', () => ({ useApp: (select: (s: typeof initialState) => unknown) => select(initialState), send: vi.fn() }));
vi.mock('../../src/renderer/store/workflows', () => ({ useWorkflows: () => ({ rows: [row], error: null }), decideWork: vi.fn(), reloadWorkflows: vi.fn() }));
vi.mock('../../src/renderer/store/tasks', () => ({ useTasks: (select: (s: null) => unknown) => select(null) }));
vi.mock('../../src/renderer/lib/later', () => ({ openQueue: vi.fn() }));
vi.mock('../../src/renderer/actions', () => ({ openChatRef: vi.fn() }));
vi.mock('../../src/renderer/store/ui', () => ({ toast: vi.fn() }));
import { WorkCockpit, RecapButton } from '../../src/renderer/components/WorkCockpit';
const row: WorkThread = { id: 'feature', version: 2, title: 'Search accessibility', profile: 'feature', priority: 'support', stage: 'mockup', status: 'approval', chatIds: [], summary: 'Approve the keyboard navigation preview', waitingOn: 'Te', nextAction: 'Approve mockup', evidence: '', cycles: 0, createdAt: 1, updatedAt: 2, proposal: { id: 'proposal', text: 'Approve the keyboard navigation preview' }, events: [{ at: 2, stage: 'mockup', kind: 'proposed', text: 'Keyboard navigation preview' }] };
describe('work cockpit', () => {
  it('shows durable work, the current stage and yes/no choices without an active chat', () => {
    const html = renderToStaticMarkup(createElement(WorkCockpit));
    for (const text of ['Regia', 'Search accessibility', 'Aspetta te', 'Sì, procedi', 'No, proponi altro', 'aria-current="step"', 'Proposto']) expect(html).toContain(text);
  });
  it('keeps recap visible but disabled before an Orchestrator is configured', () => {
    const html = renderToStaticMarkup(createElement(RecapButton));
    expect(html).toContain('Fai il punto'); expect(html).toContain('disabled');
  });
});
