// Server-rendered approval UI: evidence remains text, samples stay visible and no approval happens on render.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { AgentLifecycleView } from '../../../src/renderer/components/AgentLifecyclePanel';
import type { AgentLifecycleSnapshot } from '../../../src/shared/agent-lifecycle';

it('renders pending proposals as text with an explicit review button, without applying anything', () => {
  const onReview = vi.fn();
  const snapshot: AgentLifecycleSnapshot = { problem: null, evaluations: [], feedback: [], proposals: [{
    key: 'gap:reviewer', kind: 'update', agentIds: ['reviewer'], reason: '<script>unsafe()</script>', state: 'pending', at: 1,
    evidence: [{ kind: 'run', ref: 'javascript:unsafe()', at: 1 }],
  }] };
  const html = renderToStaticMarkup(createElement(AgentLifecycleView, { snapshot, onReview }));
  expect(html).toContain('Da approvare'); expect(html).toContain('Esamina proposta');
  expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>'); expect(html).not.toContain('href=');
  expect(onReview).not.toHaveBeenCalled();
});
it('shows unavailable persistence as an error instead of an empty successful queue', () => {
  const html = renderToStaticMarkup(createElement(AgentLifecycleView, { snapshot: { problem: 'Registro non leggibile', proposals: [], evaluations: [], feedback: [] }, onReview() {} }));
  expect(html).toContain('role="alert"'); expect(html).not.toContain('Nessuna proposta');
});
