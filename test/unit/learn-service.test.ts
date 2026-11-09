// Impara in main (ADR 0185, 0188, src/main/learn/service.ts, store.ts): a start saves the lesson at once, researches it
// (a web run that sees only the ask, a files run over the material, brain and app), has each fact checked by a run
// that did not write it, asks its questions and waits for the answers, then writes it in two runs (the first pieces,
// then the rest in the background), citing the verified facts; a failed run leaves a sentence and «Riprova», never a
// broken lesson; extras land after the piece and the user lands on them; checks are judged at zero tokens and the first
// answer stays; «Spiegalo tu» is graded; a lesson the app was closed during is marked, an extra or grade cut off frees
// it; remove deletes its folder, also when a run still works in it (when that run ends) or a delete failed (next start).
// «Spiegazione» (ADR 0230, the default; the other tests ask for «Quiz»): no check, no review card, one question at most.
// The public topics of the files (ADR 0206): filtered, shown while they wait (✕ drops one, «Cerca ora», at once in
// «Modalità notte»), then searched by a web run that sees only the ask and the queries, its facts verified on the web.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, errText: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
import { LessonStore } from '../../src/main/learn/store';
import { LearnService, fullRef, mergeQuality, type TeachResult, type TeachRun } from '../../src/main/learn/service';
import { demoRun, demoTeach } from '../../src/main/learn/demo';
import { type Lesson } from '../../src/shared/lesson';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-learn-'));
const until = async (fn: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };

const TEACHERS = [{ engine: 'claude', label: 'Claude', models: [{ id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }], efforts: ['low', 'medium', 'high', 'xhigh'] as const, web: true },
  { engine: 'codex', label: 'Codex', models: [], efforts: [] as const, web: false }].map(t => ({ ...t, efforts: [...t.efforts] }));

function make(teach: (r: TeachRun) => Promise<TeachResult> = demoTeach, opts: { cannot?: string; root?: string; web?: boolean; brain?: string; away?: boolean } = {}) {
  const store = new LessonStore(opts.root ?? tmp());
  const runs: TeachRun[] = [];
  const events: (Lesson | undefined)[] = [];
  const svc = new LearnService({ store, lang: () => 'it', run: demoRun, devops: () => ({ prs: [], repoDirs: {} }), cannotTeach: () => opts.cannot ?? null,
    teach: r => { runs.push(r); return teach(r); }, changed: (_s, l) => events.push(l),
    teachers: () => TEACHERS, webOk: () => !!opts.web, places: () => ({ brain: opts.brain ?? null, appSource: null }), guide: () => '# Guida dell’app', away: () => !!opts.away });
  return { store, svc, runs, events };
}
const fast = (r: TeachRun) => { vi.useFakeTimers({ toFake: ['setTimeout'] }); const p = demoTeach(r); vi.runAllTimers(); vi.useRealTimers(); return p; };

describe('LearnService', () => {

  it('keeps a file reference openable: relative ones under the root that has the file, absolute ones as they are', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ref-')), app = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-app-'));
    fs.mkdirSync(path.join(app, 'src'));
    fs.writeFileSync(path.join(app, 'src', 'a.ts'), 'x');
    expect(fullRef('materiale.md', [dir, app])).toBe(path.join(dir, 'materiale.md'));
    expect(fullRef('src/a.ts:12-20', [dir, app])).toBe(`${path.join(app, 'src/a.ts')}:12-20`);
    const abs = path.join(os.tmpdir(), 'brain', 'note.md');
    expect(fullRef(`${abs}:4`, [dir])).toBe(`${abs}:4`);
  });

  it('refuses a start it cannot serve, with the reason', () => {
    expect(() => make(fast, { cannot: 'nessun motore' }).svc.start({ mode: 'quiz', kind: 'topic', ask: 'x', depth: 'quick', level: 'new' })).toThrow('nessun motore');
    const { svc } = make(fast);
    expect(() => svc.start({ mode: 'quiz', kind: 'topic', ask: '  ', depth: 'quick', level: 'new' })).toThrow();
    expect(() => svc.start({ mode: 'quiz', kind: 'pr', ask: '', depth: 'quick', level: 'new' })).toThrow(/PR/);
    expect(() => svc.start({ mode: 'quiz', kind: 'text', ask: '', text: ' ', depth: 'quick', level: 'new' })).toThrow(/testo/);
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
});

describe('the Studio, its quiz and the quality gate (ADR 0205)', () => {
  // a quiz lesson: `ready` waits for its review cards, which an explain lesson never writes (ADR 0230)
  const PR = { mode: 'quiz' as const, kind: 'pr' as const, ask: '', prUrl: 'https://github.com/lampi1/second-brain/pull/251', depth: 'lesson' as const, level: 'basics' as const };
  async function ready(teach: (r: TeachRun) => Promise<TeachResult> = fast, root?: string) {
    const m = make(teach, root ? { root } : {});
    const l = m.svc.start(PR);
    await until(() => m.store.get(l.id)?.cards?.state === 'done');
    return { ...m, id: l.id };
  }

  it('a gate that does not answer keeps the draft and says so; a rewrite that is worse is not taken', async () => {
    const off = await ready(r => (r.round === 'impara-quality' ? Promise.resolve({ ok: false as const, error: 'rete giù' }) : fast(r)));
    const a = off.store.get(off.id)!;
    expect(a.steps.find(s => s.title === 'Cosa non risolve')!.cites ?? []).toEqual([]);
    expect(a.quality).toMatchObject({ none: true, fixed: 0, fails: { cites: 1 } });
    // the gate "fixes" the recap with a piece far too long for one idea and still without a citation
    const worse = await ready(async r => {
      if (r.round !== 'impara-quality') return fast(r);
      const n = [...(r.prompt as string).matchAll(/^\{"n":(\d+),"title":"([^"]*)"/gm)];
      const pieces = n.map(([, k, t]) => (t === 'Cosa non risolve' ? { n: Number(k), fails: ['cites'], fix: { title: t, say: Array(120).fill('parola').join(' '), focus: ['engine'] } } : { n: Number(k) }));
      return { ok: true, text: JSON.stringify({ pieces, checks: [] }), costUsd: 0.01, engine: 'claude', model: null };
    });
    const b = worse.store.get(worse.id)!;
    expect(b.steps.find(s => s.title === 'Cosa non risolve')!.role).toBe('recap');
    expect(b.steps.find(s => s.title === 'Cosa non risolve')!.say).not.toContain('parola parola');
    expect(b.quality).toMatchObject({ fixed: 0 });
    expect(b.quality!.none).toBeUndefined();
  });

  it('merges the plan\'s and the rest\'s reports', () => {
    expect(mergeQuality(undefined, { checked: 2, fixed: 0, fails: {}, at: 1 })).toEqual({ checked: 2, fixed: 0, fails: {}, at: 1 });
    expect(mergeQuality({ checked: 3, fixed: 1, fails: { cites: 1 }, at: 1 }, { checked: 4, fixed: 1, fails: { cites: 1, diagram: 1 }, at: 2, none: true }))
      .toEqual({ checked: 7, fixed: 2, fails: { cites: 2, diagram: 1 }, at: 2, none: true });
  });
});
