// Render the actual child-strip component with provider state: visible content, escaped descriptions and IT/EN.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentChildren, ChildObservation } from '../../src/shared/agents';
vi.mock('../../src/renderer/store/store', () => ({ useApp: vi.fn() }));
vi.mock('../../src/renderer/lib/clock', () => ({ useNow: () => 100_000 }));
const profiles = [{ id: 'indagine', name: 'Indagine', avatar: { kind: 'symbol', value: 'search' } }];
vi.mock('../../src/renderer/store/agents', () => ({ useAgents: () => ({ catalog: { profiles } }) }));
import { useApp } from '../../src/renderer/store/store';
import { ChildStrips } from '../../src/renderer/components/ChildStrips';
import { setLang } from '../../src/renderer/i18n';

afterEach(() => setLang('it'));
const render = (children?: ChildObservation[]) => {
  const agentChildren: AgentChildren = { coverage: 'partial', active: null, total: null, observedActive: 1, observedTotal: 1, observedAt: 1000, children: children ?? [] };
  vi.mocked(useApp).mockImplementation(selector => selector({ chats: { parent: { title: 'Parent', agentChildren } } } as unknown as Parameters<typeof selector>[0]));
  return renderToStaticMarkup(createElement(ChildStrips, { chatId: 'parent' }));
};
const row = (state: ChildObservation['state']): ChildObservation => ({ key: state, nativeId: state, toolCallId: null, parentNativeId: null, kind: 'agent', state, task: '<script>Review</script>', startedAt: 1000, observedAt: 2000, source: 'live' });
describe('child strips', () => {
  it('shows description, state and original start time of the children at work; ended ones leave at once', () => {
    const html = render(['running', 'waiting', 'failed', 'stopped', 'completed'].map(s => ({ ...row(s as ChildObservation['state']), key: s })));
    expect(html).toContain('Sottoagenti di Parent');
    expect(html).toContain('In attività');
    expect(html).not.toContain('Errore');
    expect(html).not.toContain('Fermato');
    expect(html).not.toContain('Concluso');
    expect(html).toContain('1970-01-01T00:00:01.000Z');
    expect(html).toContain('&lt;script&gt;Review&lt;/script&gt;');
    expect(html.match(/role="listitem"/g)).toHaveLength(2);
    setLang('en');
    expect(render([row('running')])).toContain('Subagents of Parent');
  });
  it('names the app agent each sub-agent runs as, or "nessun agente" (#69); a command names none', () => {
    const html = render([{ ...row('running'), key: 'a', agentType: 'indagine' }, { ...row('running'), key: 'b', agentType: 'general-purpose' }, { ...row('running'), key: 'c' }, { ...row('running'), key: 'd', kind: 'shell' }]);
    expect(html).toContain('data-agent-id="indagine"');
    expect(html).toContain('Indagine');
    expect(html.match(/nessun agente/g)).toHaveLength(2);
    expect(html).toContain('data-agent-type="general-purpose"');
    expect(html.match(/data-testid="child-agent"/g)).toHaveLength(3);
    setLang('en');
    expect(render([{ ...row('running'), key: 'b' }])).toContain('no agent');
  });
  it('renders no empty group, also when every child has ended', () => {
    expect(render()).toBe('');
    expect(render(Array.from({ length: 5 }, (_, i) => ({ ...row('completed'), key: String(i) })))).toBe('');
  });
});
