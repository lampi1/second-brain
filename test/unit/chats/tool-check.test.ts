// The check of a chat's required tools at every start, resume and engine change (chats/tool-check.ts, ADR 0356): the
// served list lacking one = the fallback; the engine not loading one = a reload, then the fallback; never left waiting.
import { describe, expect, it } from 'vitest';
import { toolAction } from '../../../src/main/chats/tool-check';

const need = ['show_ui', 'agent_report'];
describe('toolAction', () => {
  it('nothing required, no endpoint or already on the fallback: ok', () => {
    expect(toolAction([], { startedAt: 1 }, 0, true)).toEqual({ kind: 'ok' });
    expect(toolAction(need, { startedAt: 1 }, 0, false)).toEqual({ kind: 'ok' });
    expect(toolAction(need, { startedAt: 1, turnEnded: true, acted: 'fallback' }, 1, true)).toEqual({ kind: 'ok' });
  });
  it('the endpoint served a list without one: the fallback at once (no reload fixes the app\'s own list)', () => {
    expect(toolAction(need, { startedAt: 1, served: ['show_ui'] }, 0, true)).toMatchObject({ kind: 'fallback', missing: ['agent_report'] });
  });
  it('the engine says it loaded fewer: a reload, then the fallback', () => {
    const s = { startedAt: 1, served: need, engineSaw: ['mcp__second-brain__show_ui'] };
    expect(toolAction(need, s, 0, true)).toMatchObject({ kind: 'reload', missing: ['agent_report'] });
    expect(toolAction(need, s, 1, true)).toMatchObject({ kind: 'fallback', missing: ['agent_report'] });
    expect(toolAction(need, { ...s, acted: 'reload' as const }, 0, true)).toMatchObject({ kind: 'fallback' });
  });
  it('the engine loaded them all, under any spelling: ok', () => {
    expect(toolAction(need, { startedAt: 1, engineSaw: ['mcp__second-brain__show_ui', 'mcp_second-brain_agent_report'] }, 0, true)).toEqual({ kind: 'ok' });
    expect(toolAction(need, { startedAt: 1, served: need }, 0, true)).toEqual({ kind: 'ok' });
  });
  it('a turn ended and the engine never read the endpoint (a resumed session): a reload, then the fallback', () => {
    expect(toolAction(need, { startedAt: 1 }, 0, true)).toEqual({ kind: 'wait' });
    expect(toolAction(need, { startedAt: 1, turnEnded: true }, 0, true)).toMatchObject({ kind: 'reload', missing: need });
    expect(toolAction(need, { startedAt: 1, turnEnded: true }, 1, true)).toMatchObject({ kind: 'fallback', missing: need });
  });
});
