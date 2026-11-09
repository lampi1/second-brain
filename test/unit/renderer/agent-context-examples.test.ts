// The run's Contesto lists the past-run examples given at launch (ADR 0236): ids and sizes, «none» or «unknown».
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatSummary } from '../../../src/shared/contract';
import type { AgentContextSnapshot } from '../../../src/shared/agent-context';

vi.mock('../../../src/renderer/components/ui', () => ({ Modal: ({ children }: { children: unknown }) => createElement('div', null, children as never) }));
const { AgentContextInspector } = await import('../../../src/renderer/components/AgentContextInspector');

const base: AgentContextSnapshot = { schema: 1, at: 1, mode: 'scoped', memory: { available: true, records: [], omitted: { ineligible: 0, unmatched: 0, budget: 0 }, estimatedTokens: 0, budgetTokens: 1200 },
  skills: [], instructions: { sha256: 'a'.repeat(64), characters: 10, estimatedTokens: 4 } };
const html = (launchContext: AgentContextSnapshot) => renderToStaticMarkup(createElement(AgentContextInspector, { chat: { id: 'c1', title: 'T', launchContext } as unknown as ChatSummary, onClose: () => {} }));

describe('AgentContextInspector examples', () => {
  it('lists the examples given', () => {
    const out = html({ ...base, examples: { candidates: 4, examples: [{ runId: 'r_0123456789ab', score: 2, estimatedTokens: 95 }] } });
    expect(out).toContain('r_0123456789ab'); expect(out).toContain('agent-context-examples');
  });
  it('says none, or unknown for an older launch', () => {
    expect(html({ ...base, examples: { candidates: 0, examples: [] } })).not.toContain('agent-context-examples');
    expect(html(base)).not.toContain('agent-context-examples');
    expect(html({ ...base, examples: { candidates: 0, examples: [], skipped: true } })).not.toContain('agent-context-examples');
  });
});
