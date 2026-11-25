// The check of a chat's required tools at every start, resume and engine change (chats/tool-check.ts, ADR 0356): the
// served list lacking one = the fallback; the engine not loading one = a reload, then the fallback; never left waiting.
import { describe, expect, it } from 'vitest';
import { saysToolMissing, toolAction } from '../../../src/main/chats/tool-check';

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

// 2026-11-25, after the merge: an Antigravity Strategist whose MCP preload timed out had its list served in full, yet
// said plan_propose and agent_delegate were missing and stopped; the app saw nothing wrong
describe('saysToolMissing', () => {
  const need = ['show_ui', 'plan_propose', 'agent_delegate', 'agent_report'];
  it('a required tool named in a sentence that says it is not there', () => {
    expect(saysToolMissing('Gli strumenti plan_propose e agent_delegate non sono disponibili nella mia sessione, quindi mi fermo.', need)).toEqual(['plan_propose', 'agent_delegate']);
    expect(saysToolMissing('I do not have mcp_second-brain_plan_propose among my tools.', need)).toEqual(['plan_propose']);
    expect(saysToolMissing('Manca show_ui.', need)).toEqual(['show_ui']);
    expect(saysToolMissing('agent_report is not available here.', need)).toEqual(['agent_report']);
  });
  it('not a tool merely named, nor a missing thing that is not a tool', () => {
    expect(saysToolMissing('Ho chiamato agent_report con outcome done.', need)).toEqual([]);
    expect(saysToolMissing('Non ho ancora chiamato agent_report: prima finisco i test.', need)).toEqual([]);
    expect(saysToolMissing('Manca un test per il modulo ordini.', need)).toEqual([]);
    expect(saysToolMissing('plan_proposed is missing', need)).toEqual([]);
  });
  it('said missing: the fallback at once, also after a reload, never twice', () => {
    expect(toolAction(need, { startedAt: 1, served: need, saidMissing: ['plan_propose'] }, 0, true)).toMatchObject({ kind: 'fallback', missing: ['plan_propose'] });
    expect(toolAction(need, { startedAt: 1, served: need, saidMissing: ['plan_propose'], acted: 'reload' }, 1, true)).toMatchObject({ kind: 'fallback' });
    expect(toolAction(need, { startedAt: 1, served: need, saidMissing: ['plan_propose'], acted: 'fallback' }, 1, true)).toEqual({ kind: 'ok' });
  });
});
