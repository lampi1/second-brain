// Impara in main (ADR 0183, src/main/learn/service.ts, store.ts): a start saves the lesson at once and writes it in two
// runs (the first pieces, then the rest in the background); a failed run leaves a sentence and «Riprova», never a
// broken lesson; extras land after the piece and the user lands on them; checks are judged at zero tokens and the first
// answer stays; «Spiegalo tu» is graded; a lesson the app was closed during is marked, an extra or grade cut off frees
// it; remove deletes its folder, also when a run still works in it (when that run ends) or a delete failed (next start).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, errText: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
import { LessonStore } from '../../src/main/learn/store';
import { LearnService, type TeachResult, type TeachRun } from '../../src/main/learn/service';
import { demoRun, demoTeach } from '../../src/main/learn/demo';
import { checkKey, playlist, stepKey, type Lesson } from '../../src/shared/lesson';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-learn-'));
const until = async (fn: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };

function make(teach: (r: TeachRun) => Promise<TeachResult> = demoTeach, opts: { cannot?: string; root?: string } = {}) {
  const store = new LessonStore(opts.root ?? tmp());
  const runs: TeachRun[] = [];
  const events: (Lesson | undefined)[] = [];
  const svc = new LearnService({ store, lang: () => 'it', run: demoRun, devops: () => ({ prs: [], repoDirs: {} }), cannotTeach: () => opts.cannot ?? null,
    teach: r => { runs.push(r); return teach(r); }, changed: (_s, l) => events.push(l) });
  return { store, svc, runs, events };
}
const fast = (r: TeachRun) => { vi.useFakeTimers({ toFake: ['setTimeout'] }); const p = demoTeach(r); vi.runAllTimers(); vi.useRealTimers(); return p; };

describe('LearnService', () => {
  it('starts a PR lesson: saved at once, the first pieces, then the rest in the background', async () => {
    const { svc, store, runs } = make(fast);
    const l = svc.start({ kind: 'pr', ask: '', prUrl: 'https://github.com/lampi1/second-brain/pull/251', depth: 'lesson', level: 'basics' });
    expect(l.state).toBe('preparing');
    expect(store.get(l.id)?.state).toBe('preparing');
    await until(() => store.get(l.id)?.state === 'ready');
    const done = store.get(l.id)!;
    expect(done.title).toBe('Risposte parola per parola (PR #251)');
    expect(done.pr).toMatchObject({ provider: 'github', number: 251, repo: 'lampi1/second-brain' });
    expect(done.steps.filter(s => !s.extra)).toHaveLength(5);
    expect(done.checks.length).toBe(3);
    expect(done.at).toBe(stepKey(done.steps[0]!.id));
    expect(runs.map(r => r.round)).toEqual(['impara-plan', 'impara-rest']);
    // the material is in the lesson's folder and named in the prompt; the diff is inline
    expect(store.readFile(l.id, 'diff.patch')).toContain('ITEM_FRAME_MS');
    expect(runs[0]!.prompt).toContain('diff.patch');
    expect(runs[0]!.prompt).toContain('STREAM_HIDDEN_MS');
    expect(runs[0]!.cwd).toBe(store.dir(l.id));
    expect(done.costUsd).toBeCloseTo(0.39);
  });

  it('a run that fails or writes nonsense leaves a sentence and «Riprova» starts it again', async () => {
    let n = 0;
    const { svc, store } = make(async r => (n++ === 0 ? { ok: false, error: 'tempo scaduto' } : n === 2 ? { ok: true, text: 'not json', costUsd: null, engine: 'claude', model: null } : fast(r)));
    const l = svc.start({ kind: 'topic', ask: 'Come funziona lo streaming', depth: 'quick', level: 'new' });
    await until(() => store.get(l.id)?.state === 'failed');
    expect(store.get(l.id)!.error).toMatch(/tempo scaduto/);
    svc.retry(l.id);
    await until(() => store.get(l.id)?.state === 'failed' && /non era valida/.test(store.get(l.id)!.error ?? ''));
    svc.retry(l.id);
    await until(() => store.get(l.id)?.state === 'ready');
  });

  it('refuses a start it cannot serve, with the reason', () => {
    expect(() => make(fast, { cannot: 'nessun motore' }).svc.start({ kind: 'topic', ask: 'x', depth: 'quick', level: 'new' })).toThrow('nessun motore');
    const { svc } = make(fast);
    expect(() => svc.start({ kind: 'topic', ask: '  ', depth: 'quick', level: 'new' })).toThrow();
    expect(() => svc.start({ kind: 'pr', ask: '', depth: 'quick', level: 'new' })).toThrow(/PR/);
    expect(() => svc.start({ kind: 'text', ask: '', text: ' ', depth: 'quick', level: 'new' })).toThrow(/testo/);
  });

  it('moves, judges a check at zero tokens (first answer stays), adds an extra after the piece', async () => {
    const { svc, store, runs } = make(fast);
    const l = svc.start({ kind: 'pr', ask: '', prUrl: 'https://github.com/lampi1/second-brain/pull/251', depth: 'lesson', level: 'basics' });
    await until(() => store.get(l.id)?.state === 'ready');
    const ready = store.get(l.id)!;
    const c = ready.checks[0]!;
    svc.move(l.id, checkKey(c.id));
    expect(() => svc.move(l.id, 's:nope')).toThrow();
    const before = runs.length;
    let x = svc.answer(l.id, c.id, 1, 2);
    expect(x.checks[0]!.answer).toMatchObject({ choice: 1, confidence: 2 });
    x = svc.answer(l.id, c.id, 0);
    expect(x.checks[0]!.answer!.choice).toBe(1);
    expect(runs.length).toBe(before);
    expect(() => svc.answer(l.id, c.id, 9)).toThrow();

    const piece = ready.steps[1]!;
    const busy = svc.ask(l.id, 'better', stepKey(piece.id));
    expect(busy.busy).toMatchObject({ kind: 'better', of: piece.id });
    expect(() => svc.ask(l.id, 'example', stepKey(piece.id))).toThrow(/già/);
    await until(() => !store.get(l.id)!.busy);
    const after = store.get(l.id)!;
    const extra = after.steps.find(s => s.extra)!;
    expect(extra.extra).toEqual({ kind: 'better', of: piece.id });
    expect(after.at).toBe(stepKey(extra.id));
    const keys = playlist(after).map(p => p.key);
    expect(keys.indexOf(stepKey(extra.id))).toBe(keys.indexOf(stepKey(piece.id)) + 1);
    expect(() => svc.ask(l.id, 'question', stepKey(piece.id), '  ')).toThrow();
  });

  it('grades «Spiegalo tu»; an empty one ends the lesson without a grade', async () => {
    const { svc, store } = make(fast);
    const l = svc.start({ kind: 'pr', ask: '', prUrl: 'https://github.com/lampi1/second-brain/pull/251', depth: 'lesson', level: 'basics' });
    await until(() => store.get(l.id)?.state === 'ready');
    svc.explain(l.id, 'Due attese da 100 ms, ora un fotogramma.');
    await until(() => !!store.get(l.id)!.explain?.grade);
    expect(store.get(l.id)!.explain).toMatchObject({ grade: 'partial', answer: 'Due attese da 100 ms, ora un fotogramma.' });
    expect(store.get(l.id)!.doneAt).toBeTruthy();
    expect(store.get(l.id)!.at).toBe('end');

    const m = make(fast);
    const l2 = m.svc.start({ kind: 'topic', ask: 'x', depth: 'quick', level: 'new' });
    await until(() => m.store.get(l2.id)?.state === 'ready');
    const ended = m.svc.explain(l2.id, '');
    expect(ended.doneAt).toBeTruthy();
    expect(ended.explain?.grade).toBeUndefined();
  });

  it('marks a lesson the app was closed during, lists by last change, removes the folder', () => {
    const root = tmp(), store = new LessonStore(root);
    const base = { title: 't', kind: 'topic' as const, ask: 'x', depth: 'quick' as const, level: 'new' as const, diagram: '', outline: [], steps: [], checks: [], at: '', costUsd: null, engine: null, model: null, sources: [] };
    const a: Lesson = { ...base, id: store.newId(1_000), createdAt: 1, updatedAt: 1, state: 'preparing' };
    const b: Lesson = { ...base, id: store.newId(2_000), createdAt: 2, updatedAt: 2, state: 'more' };
    store.save(a); store.save(b);
    // a service on the folder = the app started again
    const { svc } = make(fast, { root });
    expect(store.get(a.id)).toMatchObject({ state: 'failed' });
    expect(store.get(b.id)).toMatchObject({ state: 'more', error: expect.stringMatching(/interrotta/) });
    expect(svc.state().lessons.map(s => s.id)).toEqual([b.id, a.id]);
    svc.remove(a.id);
    expect(fs.existsSync(store.dir(a.id))).toBe(false);
    expect(() => store.dir('../x')).toThrow();
  });

  it('an extra or a grade cut off by a restart frees the lesson and says so', () => {
    const root = tmp(), store = new LessonStore(root);
    const base = { title: 't', kind: 'topic' as const, ask: 'x', depth: 'quick' as const, level: 'new' as const, diagram: 'flowchart LR\n a --> b', outline: [], steps: [], checks: [], at: '', costUsd: null, engine: null, model: null, sources: [] };
    const l: Lesson = { ...base, id: store.newId(3_000), createdAt: 3, updatedAt: 3, state: 'ready', busy: { kind: 'grade', of: 'end', since: 3 } };
    store.save(l);
    make(fast, { root });
    expect(store.get(l.id)!.busy).toBeUndefined();
    expect(store.get(l.id)!.busyError).toMatch(/interrotta/);
    expect(store.get(l.id)!.state).toBe('ready');
  });

  it('a lesson removed while it is being written leaves no folder behind', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const { svc, store } = make(async r => { await gate; return fast(r); });
    const l = svc.start({ kind: 'pr', ask: '', prUrl: 'https://github.com/lampi1/second-brain/pull/251', depth: 'lesson', level: 'basics' });
    await until(() => !!store.readFile(l.id, 'diff.patch'));
    svc.remove(l.id);
    expect(svc.state().lessons).toHaveLength(0);
    release();
    await until(() => !fs.existsSync(store.dir(l.id)));
    // a folder left with no lesson in it (a delete that failed) goes at the next start
    fs.mkdirSync(store.dir(store.newId(4_000)), { recursive: true });
    make(fast, { root: store.root });
    expect(fs.readdirSync(store.root)).toEqual([]);
  });
});
