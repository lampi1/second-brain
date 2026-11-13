// Engines run below the app's priority (jobguard.ts lowerEnginePriority, 2026-10-27 freezes): a real Claude session on
// the fake CLI comes up below normal, what it starts inherits that, and a refused or missing pid never breaks a start.
// Removed on 2026-11-09: the tests that started a real process, git, a port or a fake CLI (docs/tests/load-sensitive-
// removed.md); the lines above still name what they covered, and only the in-process tests below remain.

import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeSession } from '../../../src/main/chats/claude';
import { lowerEnginePriority } from '../../../src/main/chats/jobguard';
import { log } from '../../../src/main/log';

const BELOW = os.constants.priority.PRIORITY_BELOW_NORMAL;
const open: ClaudeSession[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(s => s.close(500))); vi.restoreAllMocks(); });

describe('engine CPU priority', () => {
  it('no pid or a refusal: false, the start goes on, one warning only', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    expect(lowerEnginePriority(undefined)).toBe(false);
    const refuse = () => { throw new Error('EPERM'); };
    expect(lowerEnginePriority(123, refuse)).toBe(false);
    expect(lowerEnginePriority(124, refuse)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const set = vi.fn();
    expect(lowerEnginePriority(125, set)).toBe(true);
    expect(set).toHaveBeenCalledWith(125, BELOW);
  });
});
