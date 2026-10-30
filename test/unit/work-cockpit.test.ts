// Home must contain only agent surfaces; coordination requests demand concrete modal decisions, not recaps.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { initialState } from '../../src/renderer/store/state';
vi.mock('../../src/renderer/store/store', () => ({ useApp: (select: (s: typeof initialState) => unknown) => select(initialState), send: vi.fn() }));
vi.mock('../../src/renderer/store/workflows', () => ({ reloadWorkflows: vi.fn(), reloadLessons: vi.fn() }));
vi.mock('../../src/renderer/lib/later', () => ({ openQueue: vi.fn() }));
vi.mock('../../src/renderer/store/ui', () => ({ toast: vi.fn() }));
vi.mock('../../src/renderer/components/AgentStrips', () => ({ AgentStrips: () => createElement('section', { 'data-testid': 'agents' }), AgentStripsActions: () => createElement('nav') }));
import { RecapButton, RECAP } from '../../src/renderer/components/WorkCockpit';
import { Home } from '../../src/renderer/brain/pages/Home';
describe('agent-only Home and actionable coordination', () => {
  it('mounts the agent workspace without a work summary board or durable approval controls', () => {
    const html = renderToStaticMarkup(createElement(Home, { nav: vi.fn() }));
    expect(html).toContain('data-testid="agents"'); expect(html).not.toContain('cloud-agents');
    expect(html).not.toMatch(/work-cockpit|work-routine|work-thread/);
  });
  it('keeps the action visible but disabled before an Orchestrator is configured', () => {
    const html = renderToStaticMarkup(createElement(RecapButton));
    expect(html).toContain('Fai il punto'); expect(html).toContain('disabled');
    expect(html).not.toContain('Riepilogo');
  });
  it('asks for real yes/no decisions with fresh evidence and reopens existing requests without inventing approvals', () => {
    for (const text of ['app_work_list', 'app_digest', 'app_work_report propose', 'app_unblock', 'Sì / No', 'senza duplicarli', 'Non scrivere un riepilogo testuale', 'già autorizzati']) expect(RECAP).toContain(text);
  });
});
