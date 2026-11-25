// Helpers of the required-tools table (shared/role-tools.ts, ADR 0356): engine spellings back to the app's names, and
// the chat the work of a moved chat goes on in (problem 4 of 2026-11-25: a reuse of a chat whose engine changed).
import { describe, expect, it } from 'vitest';
import { bareTool, missingTools, successorIn } from '../../../src/shared/role-tools';

describe('role tools helpers', () => {
  it('bareTool reads every engine\'s spelling', () => {
    for (const n of ['mcp__second-brain__agent_report', 'mcp_second-brain_agent_report', 'second-brain-agent_report', 'second-brain:agent_report', 'agent_report'])
      expect(bareTool(n), n).toBe('agent_report');
    expect(bareTool('mcp__other__agent_report')).toBe('mcp__other__agent_report');
    expect(missingTools(['show_ui', 'agent_report'], ['mcp__second-brain__show_ui'])).toEqual(['agent_report']);
  });
  it('successorIn follows continuedBy to the end, and stops on a loop or a missing chat', () => {
    const list = [{ id: 'a', continuedBy: { id: 'b' } }, { id: 'b', continuedBy: { id: 'c' } }, { id: 'c' }];
    expect(successorIn(list, 'a')?.id).toBe('c');
    expect(successorIn(list, 'c')?.id).toBe('c');
    expect(successorIn([{ id: 'a', continuedBy: { id: 'gone' } }], 'a')?.id).toBe('a');
    expect(successorIn([{ id: 'a', continuedBy: { id: 'b' } }, { id: 'b', continuedBy: { id: 'a' } }], 'a')).toBeDefined();
    expect(successorIn(list, 'x')).toBeUndefined();
  });
});
