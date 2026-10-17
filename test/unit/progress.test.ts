import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProgressService } from '../../src/main/agents/progress';
import type { ChatSummary } from '../../src/shared/contract';
const dirs: string[] = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-progress-')); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const chat = (): ChatSummary => ({ id: 'private-chat-id', state: 'idle', pending: 0, lastText: 'Private answer', lastResult: { at: 100, isError: false } }) as ChatSummary;
describe('local discreet milestones', () => {
  it('awards only explicit validated successful result confirmation, never a finished turn by itself', () => {
    const c = chat(), p = new ProgressService(tmp(), { enabled: true, chats: () => [c], now: () => 200 });
    expect(p.get().earned).toEqual([]);
    expect(p.get().available).toBe(true);
    p.confirmResult(c.id, 100); p.confirmResult(c.id, 100);
    expect(p.get().earned).toEqual([{ id: 'first-result', at: 200 }]);
    for (const patch of [{ lastResult: { at: 101, isError: true } }, { lastResult: { at: 100, isError: false, interrupted: true } }, { pending: 1 }, { state: 'running' }]) {
      const invalid = { ...chat(), ...patch } as ChatSummary;
      const x = new ProgressService(tmp(), { enabled: true, chats: () => [invalid] });
      expect(() => x.confirmResult(invalid.id, 100)).toThrow(); expect(x.get().earned).toEqual([]);
    }
  });
  it('deduplicates replay/restart and persists only ids/times plus the hide preference', () => {
    const dir = tmp(), p = new ProgressService(dir, { enabled: true, chats: () => [chat()], now: () => 200 });
    p.award('first-agent'); p.award('setup-complete'); p.confirmResult(chat().id, 100); p.setHidden(true);
    const next = new ProgressService(dir, { enabled: true, chats: () => [] }); next.award('first-agent');
    expect(next.get()).toMatchObject({ hidden: true, earned: p.get().earned });
    const text = fs.readFileSync(path.join(dir, 'progress.json'), 'utf8');
    expect(text).not.toContain('private-chat-id'); expect(text).not.toContain('Private answer');
    expect(text).not.toContain('available'); expect(text).not.toContain('reason');
  });
  it('never awards demo events or overwrites a damaged local record', () => {
    const dir = tmp(), demo = new ProgressService(dir, { enabled: false, chats: () => [chat()] });
    demo.award('first-agent'); expect(demo.get().earned).toEqual([]);
    expect(demo.get()).toMatchObject({ available: false, reason: expect.any(String) });
    expect(() => demo.confirmResult(chat().id, 100)).toThrow(/demo/);
    const file = path.join(dir, 'progress.json'); fs.writeFileSync(file, '{broken');
    const p = new ProgressService(dir, { enabled: true, chats: () => [] }); p.award('setup-complete');
    expect(p.get()).toMatchObject({ available: false, problem: expect.any(String) }); expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
  });
});
