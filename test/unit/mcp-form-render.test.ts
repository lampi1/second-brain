// MCP forms must retain connector context, constraints and a refusal in every question-panel host.
// Server-render the real panel; unrelated app navigation and transcript context are isolated.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/store/store', () => ({ useApp: vi.fn(), app: { get: () => ({ pending: [] }) }, answer: vi.fn() }));
vi.mock('../../src/renderer/actions', () => ({ claimFocus: () => false, focusChat: vi.fn(), reqKey: (r: { id: string }) => r.id }));
vi.mock('../../src/renderer/lib/engines', () => ({ engineOf: () => null }));
vi.mock('../../src/renderer/lib/clock', () => ({ useNow: () => 100 }));
vi.mock('../../src/renderer/components/AskContext', () => ({ AskContext: () => null }));
vi.mock('../../src/renderer/components/DecisionCard', () => ({ BriefEvidence: () => null, DecisionCard: () => { throw new Error('MCP fields must not use narrative decisions'); } }));
vi.mock('../../src/renderer/components/CommandRequest', () => ({ CommandRequest: () => null }));
vi.mock('../../src/renderer/components/GenUi', () => ({ AskArtifacts: () => null, openFile: vi.fn() }));
vi.mock('../../src/renderer/components/ui', () => ({ Kbd: () => null }));
import { RequestPanel } from '../../src/renderer/components/RequestPanel';
import { mcpForm } from '../../src/shared/mcp-form';
import type { PendingRequest } from '../../src/shared/contract';

for (const variant of ['lane', 'tile', 'orchestrator', 'compact', 'window', 'plain'] as const) it(`keeps MCP consent and constraints visible in ${variant}`, () => {
  const req: PendingRequest = { id: 'form', chatId: 'fixture', at: 100, type: 'question', tool: 'mcp__fixture', title: 'MCP fixture', detail: 'Server: fixture\nConfirm the selected external action.', input: {},
    questions: mcpForm({ type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['count'] }).questions };
  const html = renderToStaticMarkup(createElement(RequestPanel, { req, variant }));
  for (const text of ['Server: fixture', 'Confirm the selected external action.', 'Rifiuta modulo', 'Minimo: 1', 'Massimo: 3']) expect(html).toContain(text);
  const boolean = { ...req, questions: mcpForm({ type: 'object', properties: { confirm: { type: 'boolean' } }, required: ['confirm'] }).questions };
  expect(renderToStaticMarkup(createElement(RequestPanel, { req: boolean, variant }))).toContain('form-refuse');
});
