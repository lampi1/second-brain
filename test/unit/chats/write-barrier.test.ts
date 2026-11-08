// The write barrier (ADR 0228): reads pass at once, anything that may write (unknown tools included) waits for the
// turn's snapshot, a failed snapshot releases it, a newer hold replaces an older one.
import { describe, expect, it } from 'vitest';
import { mayWrite, WriteBarrier } from '../../../src/main/chats/write-barrier';

const settled = async (p: Promise<void> | null): Promise<boolean> => {
  if (!p) return true;
  let done = false;
  void p.then(() => { done = true; });
  await new Promise(resolve => setTimeout(resolve, 5));
  return done;
};

describe('write barrier', () => {
  it('counts every tool not known to only read as writing', () => {
    for (const t of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'Agent', 'Task', 'mcp__x__y', '', 'NewToolTomorrow']) expect(mayWrite(t)).toBe(true);
    for (const t of ['Read', 'Grep', 'Glob', 'WebFetch', 'TodoWrite', 'AskUserQuestion']) expect(mayWrite(t)).toBe(false);
  });

  it('lets everything through when nothing is held', () => {
    const b = new WriteBarrier();
    expect(b.pass('Write')).toBeNull();
    expect(b.held).toBe(false);
  });

  it('holds writes until the snapshot settles; reads pass at once', async () => {
    const b = new WriteBarrier();
    let settle!: () => void;
    b.hold(new Promise<void>(resolve => { settle = resolve; }));
    expect(b.pass('Read')).toBeNull();
    const w = b.pass('Edit');
    expect(await settled(w)).toBe(false);
    settle();
    expect(await settled(w)).toBe(true);
    expect(b.held).toBe(false);
    expect(b.pass('Edit')).toBeNull();
  });

  it('a failed snapshot releases the writes (that turn cannot be undone, as before) and never rejects', async () => {
    const b = new WriteBarrier();
    b.hold(Promise.reject(new Error('git failed')));
    const w = b.pass('Bash');
    await expect(w).resolves.toBeUndefined();
    expect(b.held).toBe(false);
  });

  it('a newer hold replaces an older one; the older settling does not open the newer', async () => {
    const b = new WriteBarrier();
    let first!: () => void, second!: () => void;
    b.hold(new Promise<void>(resolve => { first = resolve; }));
    b.hold(new Promise<void>(resolve => { second = resolve; }));
    first();
    const w = b.pass('Write');
    expect(await settled(w)).toBe(false);
    expect(b.held).toBe(true);
    second();
    expect(await settled(w)).toBe(true);
  });
});
