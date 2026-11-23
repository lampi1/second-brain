// The Skill page never loses the user's work: a file removal carries the version the user saw, an answer that is no longer
// the latest request is ignored, a deletion offers Undo long enough to be used. Pins renderer/lib/skill-edit.ts.
import { describe, expect, it, vi } from 'vitest';
import { fileRemoval, latestOnly, undoOffer } from '../../../src/renderer/lib/skill-edit';
import { toast, ui } from '../../../src/renderer/store/ui';

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('skill edits', () => {
  it('removes a file only as the user saw it: the request carries its mtime', () => {
    expect(fileRemoval('a', { path: 'scripts/x.mjs', mtime: 42 })).toEqual({ skill: 'a', path: 'scripts/x.mjs', text: null, mtime: 42 });
  });

  it('a slow first file never lands in the second one: a.mjs is not saved into b.mjs', async () => {
    const a = deferred<string>(), b = deferred<string>(), reqs = latestOnly();
    let path = '', text = '';
    const open = (p: string, d: Promise<string>) => { path = p; text = ''; reqs.run(() => d, v => { text = v; }, () => { text = 'error'; }); };
    open('a.mjs', a.promise);
    open('b.mjs', b.promise);
    b.resolve('text of b');
    await settle();
    a.resolve('text of a');
    await settle();
    expect({ path, text }).toEqual({ path: 'b.mjs', text: 'text of b' });
  });

  it('a late failure is ignored too, and so is everything after a cancel (another skill, the page closed)', async () => {
    const slow = deferred<string>(), last = deferred<string>(), reqs = latestOnly();
    const seen: string[] = [];
    const run = (d: Promise<string>) => reqs.run(() => d, v => seen.push(v), () => seen.push('error'));
    run(slow.promise);
    run(last.promise);
    slow.reject(new Error('gone'));
    await settle();
    reqs.cancel();
    last.resolve('late');
    await settle();
    expect(seen).toEqual([]);
  });

  it('a save that ends after another file opened does not touch the editor', () => {
    const reqs = latestOnly();
    const live = reqs.ticket();
    expect(live()).toBe(true);
    reqs.run(() => new Promise(() => {}), () => {}, () => {});
    expect(live()).toBe(false);
  });

  it('a deletion offers Undo of its own change, and the toast lives at least 15 seconds', () => {
    const undone: string[] = [];
    const o = undoOffer('c1', 'Annulla', id => undone.push(id));
    const id = toast('«a» eliminata', 'ok', o.action, o.ttl);
    const shown = ui.get().toasts.find(x => x.id === id)!;
    expect(shown.action?.label).toBe('Annulla');
    expect(shown.ttl).toBeGreaterThanOrEqual(15_000);
    shown.action!.run();
    expect(undone).toEqual(['c1']);
  });

  it('nothing in the history, nothing to undo: no button that would fail', () => {
    const undo = vi.fn();
    expect(undoOffer(null, 'Annulla', undo).action).toBeUndefined();
    expect(undoOffer(undefined, 'Annulla', undo).action).toBeUndefined();
  });
});
