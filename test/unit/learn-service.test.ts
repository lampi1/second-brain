// Impara in main (ADR 0185, 0188, src/main/learn/service.ts, store.ts): a start saves the lesson at once, researches it
// (a web run that sees only the ask, a files run over the material, brain and app), has each fact checked by a run
// that did not write it, asks its questions and waits for the answers, then writes it in two runs (the first pieces,
// then the rest in the background), citing the verified facts; a failed run leaves a sentence and «Riprova», never a
// broken lesson; extras land after the piece and the user lands on them; checks are judged at zero tokens and the first
// answer stays; «Spiegalo tu» is graded; a lesson the app was closed during is marked, an extra or grade cut off frees
// it; remove deletes its folder, also when a run still works in it (when that run ends) or a delete failed (next start).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, errText: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
import { LessonStore } from '../../src/main/learn/store';
import { LearnService, fullRef, mergeQuality, type TeachResult, type TeachRun } from '../../src/main/learn/service';
import { demoRun, demoTeach } from '../../src/main/learn/demo';
import { checkKey, playlist, stepKey, type Lesson } from '../../src/shared/lesson';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-learn-'));
const until = async (fn: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };

const TEACHERS = [{ engine: 'claude', label: 'Claude', models: [{ id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }], efforts: ['low', 'medium', 'high', 'xhigh'] as const, web: true },
  { engine: 'codex', label: 'Codex', models: [], efforts: [] as const, web: false }].map(t => ({ ...t, efforts: [...t.efforts] }));

function make(teach: (r: TeachRun) => Promise<TeachResult> = demoTeach, opts: { cannot?: string; root?: string; web?: boolean; brain?: string } = {}) {
  const store = new LessonStore(opts.root ?? tmp());
  const runs: TeachRun[] = [];
  const events: (Lesson | undefined)[] = [];
  const svc = new LearnService({ store, lang: () => 'it', run: demoRun, devops: () => ({ prs: [], repoDirs: {} }), cannotTeach: () => opts.cannot ?? null,
    teach: r => { runs.push(r); return teach(r); }, changed: (_s, l) => events.push(l),
    teachers: () => TEACHERS, webOk: () => !!opts.web, places: () => ({ brain: opts.brain ?? null, appSource: null }), guide: () => '# Guida dell’app' });
  return { store, svc, runs, events };
}
const fast = (r: TeachRun) => { vi.useFakeTimers({ toFake: ['setTimeout'] }); const p = demoTeach(r); vi.runAllTimers(); vi.useRealTimers(); return p; };

describe('LearnService', () => {
  it('starts a PR lesson: saved at once, the first pieces, then the rest in the background', async () => {
    const { svc, store, runs } = make(fast);
    const l = svc.start({ kind: 'pr', ask: '', prUrl: 'https://github.com/lampi1/second-brain/pull/251', depth: 'lesson', level: 'basics' });
    expect(l.state).toBe('preparing');
    expect(store.get(l.id)?.state).toBe('preparing');
    await until(() => store.get(l.id)?.cards?.state === 'done');
    const done = store.get(l.id)!;
    expect(done.title).toBe('Risposte parola per parola (PR #251)');
    expect(done.pr).toMatchObject({ provider: 'github', number: 251, repo: 'lampi1/second-brain' });
    expect(done.steps.filter(s => !s.extra)).toHaveLength(6);
    expect(done.checks.length).toBe(3);
    expect(done.at).toBe(stepKey(done.steps[0]!.id));
    // a PR has no web research: its files, their check, then the plan and the rest, at the default effort
    // then the review cards, at medium effort
    // each written part is checked by the quality gate (ADR 0205), at low effort, before the learner sees it
    expect(runs.map(r => r.round)).toEqual(['impara-files', 'impara-verify-files', 'impara-plan', 'impara-quality', 'impara-rest', 'impara-quality', 'impara-cards']);
    expect(runs.filter(r => r.round !== 'impara-quality' && r.round !== 'impara-cards').every(r => !r.web && r.effort === 'high' && r.teacher === null)).toBe(true);
    expect(runs.filter(r => r.round === 'impara-quality').every(r => r.effort === 'low')).toBe(true);
    expect(runs.at(-1)!.effort).toBe('medium');
    // the material is in the lesson's folder and named in the prompt; the diff is inline
    expect(store.readFile(l.id, 'diff.patch')).toContain('ITEM_FRAME_MS');
    const plan = runs[2]!;
    expect(plan.prompt).toContain('diff.patch');
    expect(plan.prompt).toContain('STREAM_HIDDEN_MS');
    expect(plan.cwd).toBe(store.dir(l.id));
    // the facts: checked by the second run, the wrong number corrected, the model's own knowledge left unsure
    expect(done.facts?.map(f => f.check)).toEqual(['ok', 'fixed', 'ok', 'ok', 'unsure']);
    expect(done.facts![1]!.claim).toContain('da 100 a 16 ms');
    // a file the run named relative to its folder is kept as a full path, so «Fonti» can open it
    const store27 = `${path.join(store.dir(l.id), 'src/renderer/store/store.ts')}:27`;
    expect(done.facts![1]!.ref).toBe(store27);
    expect(done.facts![3]!.ref).toBe(path.join(store.dir(l.id), 'materiale.md'));
    expect(plan.prompt).toContain(`f2 [verified; file ${store27}] STREAM_MS nello store del renderer passa da 100 a 16 ms.`);
    expect(plan.prompt).toContain('f5 [NOT CONFIRMED; model knowledge]');
    expect(plan.prompt).not.toContain('da 100 a 10 ms');
    expect(runs[1]!.prompt).toContain('da 100 a 10 ms');
    expect(done.prep).toMatchObject({ files: 5, ok: 3, fixed: 1, unsure: 1, dropped: 0, phases: { gather: 'done', web: 'skip', files: 'done', verify: 'done', ask: 'skip', plan: 'done' }, why: { web: 'pr' } });
    // the pieces cite the facts, their beats name known nodes
    expect(done.steps[1]!.cites).toEqual(['f1', 'f5']);
    expect(done.steps[0]!.beats?.[1]).toMatchObject({ focus: ['engine', 'manager'], flow: { from: 'engine', to: 'manager' } });
    // the pieces' roles and visuals (ADR 0205): a code walkthrough's beats name lines, not nodes
    expect(done.steps.map(s => s.role)).toEqual(['problem', 'example', 'rule', 'worked', 'faded', 'recap']);
    expect(done.steps.map(s => s.visual?.kind ?? 'flow')).toEqual(['flow', 'code', 'sequence', 'formula', 'chart', 'mindmap']);
    expect(done.steps[1]!.beats?.[1]).toMatchObject({ focus: [], lines: [6, 9] });
    expect(done.steps[4]!.beats?.[2]).toMatchObject({ mark: 'Store (nascosta)' });
    // the gate rewrote the recap, which cited no fact; the report counts what it found
    expect(done.steps[5]!.cites).toEqual(['f4', 'f1']);
    expect(done.quality).toMatchObject({ checked: 9, fixed: 1, fails: { cites: 1 } });
    expect(done.costUsd).toBeCloseTo(0.57);
  });

  it('a topic: the web run sees only the ask and has only the web; the files run reads brain and guide; questions wait for the answers', async () => {
    const { svc, store, runs } = make(fast, { web: true, brain: '/home/me/brain' });
    const l = svc.start({ kind: 'topic', ask: 'Come funziona lo streaming nella mia app', depth: 'quick', level: 'new', teacher: { engine: 'claude', model: 'sonnet', effort: 'xhigh' } });
    expect(l.teacher).toEqual({ engine: 'claude', model: 'sonnet', effort: 'xhigh' });
    await until(() => !!store.get(l.id)?.clarify);
    const web = runs.find(r => r.round === 'impara-web')!, files = runs.find(r => r.round === 'impara-files')!;
    expect(web.web).toBe(true);
    expect(web.prompt).toContain('Come funziona lo streaming nella mia app');
    // nothing private reaches the web run: no brain, no guide, no lesson folder
    expect(web.prompt).not.toContain('/home/me/brain');
    expect(web.prompt).not.toContain(store.dir(l.id));
    expect(web.cwd).toBe(path.join(store.dir(l.id), 'web'));
    expect(files.web).toBeUndefined();
    expect(files.prompt).toContain('/home/me/brain');
    expect(files.prompt).toContain(path.join(store.dir(l.id), 'guida-app.md'));
    expect(store.readFile(l.id, 'guida-app.md')).toBe('# Guida dell’app');
    expect(runs.every(r => r.effort === 'xhigh' && r.teacher?.model === 'sonnet')).toBe(true);
    // the questions wait: no plan until they are answered
    await until(() => store.get(l.id)?.prep?.phases.verify === 'done');
    await new Promise(r => setTimeout(r, 30));
    expect(runs.some(r => r.round === 'impara-plan')).toBe(false);
    expect(store.get(l.id)!.facts!.filter(f => f.from === 'web').map(f => f.check)).toEqual(['ok', 'ok']);
    // nothing the files run wrote reaches a run with the web: the web check sees only the web facts, and a files fact
    // with no file (the demo's «60 Hz») is left out when the web is on
    const vweb = runs.find(r => r.round === 'impara-verify-web')!;
    expect(vweb.web).toBe(true);
    expect(vweb.prompt).not.toContain('ITEM_FRAME_MS');
    expect(vweb.prompt).not.toContain('60 Hz');
    expect(store.get(l.id)!.facts!.some(f => f.from === 'known')).toBe(false);
    expect(() => svc.clarify('nope', [])).toThrow();
    svc.clarify(l.id, ['Dentro second-brain']);
    expect(() => svc.clarify(l.id, ['x'])).toThrow();
    await until(() => store.get(l.id)?.state === 'ready');
    const plan = runs.find(r => r.round === 'impara-plan')!;
    expect(plan.prompt).toContain('→ Dentro second-brain');
    expect(store.get(l.id)!.prep?.phases.ask).toBe('done');
  });

  it('keeps only a teacher it offers; a removed lesson stops waiting for its answers', async () => {
    const { svc, store, runs } = make(fast, { web: true });
    expect(svc.state().teachers?.map(t => t.engine)).toEqual(['claude', 'codex']);
    const a = svc.start({ kind: 'topic', ask: 'x', depth: 'quick', level: 'new', teacher: { engine: 'gemini', model: 'x', effort: 'high' } });
    expect(a.teacher).toBeUndefined();
    const b = svc.start({ kind: 'topic', ask: 'y', depth: 'quick', level: 'new', teacher: { engine: 'claude', model: 'fable', effort: 'max' } });
    expect(b.teacher).toEqual({ engine: 'claude', model: null, effort: null });
    await until(() => !!store.get(a.id)?.clarify && store.get(a.id)?.prep?.phases.verify === 'done');
    svc.remove(a.id);
    await new Promise(r => setTimeout(r, 30));
    expect(runs.filter(r => r.round === 'impara-plan')).toHaveLength(0);
  });

  it('a run that fails or writes nonsense leaves a sentence and «Riprova» starts it again; a failed research goes on', async () => {
    let n = 0;
    const { svc, store } = make(async r => (r.round === 'impara-files' ? { ok: false, error: 'rete giù' } : r.round !== 'impara-plan' ? fast(r)
      : n++ === 0 ? { ok: false, error: 'tempo scaduto' } : n === 2 ? { ok: true, text: 'not json', costUsd: null, engine: 'claude', model: null } : fast(r)));
    const l = svc.start({ kind: 'text', ask: 'Come funziona lo streaming', text: 'Due attese da 100 ms.', depth: 'quick', level: 'new' });
    await until(() => store.get(l.id)?.state === 'failed');
    expect(store.get(l.id)!.error).toMatch(/tempo scaduto/);
    svc.retry(l.id);
    await until(() => store.get(l.id)?.state === 'failed' && /non era valida/.test(store.get(l.id)!.error ?? ''));
    svc.retry(l.id);
    await until(() => store.get(l.id)?.state === 'ready');
    expect(store.get(l.id)!.prep).toMatchObject({ phases: { files: 'skip' }, why: { files: expect.stringMatching(/^failed: rete giù/) } });
    expect(store.get(l.id)!.facts).toEqual([]);
  });

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
    await until(() => !!m.store.get(l2.id)?.clarify);
    m.svc.clarify(l2.id, ['']);
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

describe('the Studio, its quiz and the quality gate (ADR 0205)', () => {
  const PR = { kind: 'pr' as const, ask: '', prUrl: 'https://github.com/lampi1/second-brain/pull/251', depth: 'lesson' as const, level: 'basics' as const };
  async function ready(teach: (r: TeachRun) => Promise<TeachResult> = fast, root?: string) {
    const m = make(teach, root ? { root } : {});
    const l = m.svc.start(PR);
    await until(() => m.store.get(l.id)?.cards?.state === 'done');
    return { ...m, id: l.id };
  }

  it('a tile is one cheap run over the verified facts, saved with the lesson; flashcards go into the review', async () => {
    const { svc, store, runs, id } = await ready();
    const before = store.get(id)!.costUsd!;
    expect(svc.studio(id, 'flashcards').studio?.flashcards?.state).toBe('making');
    expect(() => svc.studio(id, 'flashcards')).toThrow(/già/);
    await until(() => store.get(id)?.studio?.flashcards?.state === 'done');
    const run = runs.at(-1)!;
    expect(run).toMatchObject({ round: 'impara-studio', effort: 'low' });
    expect(run.web).toBeFalsy();
    expect(run.prompt).toContain('no search');
    expect(run.prompt).not.toContain('NOT CONFIRMED');
    const out = store.get(id)!.studio!.flashcards!.out!;
    expect(out.kind === 'flashcards' && out.n).toBeGreaterThan(0);
    const own = svc.review.ofLesson(id).filter(c => c.origin === 'studio');
    expect(own.map(c => c.id)).toEqual(Array.from({ length: own.length }, (_, i) => `${id}:s:f${i + 1}`));
    expect(store.get(id)!.costUsd).toBeCloseTo(before + 0.02);
    // made again: the set is replaced, not added to
    svc.studio(id, 'flashcards');
    await until(() => store.get(id)?.studio?.flashcards?.state === 'done' && store.get(id)!.costUsd! > before + 0.03);
    expect(svc.review.ofLesson(id).filter(c => c.origin === 'studio')).toHaveLength(own.length);
    expect(() => svc.studio(id, 'challenge')).toThrow(/non valida/);
  });

  it('the quiz plays as a review session; an answered question becomes a review card', async () => {
    const { svc, store, id } = await ready();
    expect(svc.queue('quiz', undefined, id)).toEqual([]);
    svc.studio(id, 'quiz');
    await until(() => store.get(id)?.studio?.quiz?.state === 'done');
    const q = svc.queue('quiz', undefined, id);
    expect(q.length).toBeGreaterThanOrEqual(4);
    expect(q[0]!.card.id).toBe(`${id}:sq1`);
    expect(svc.review.get(`${id}:sq1`)).toBeNull();
    const graded = svc.gradeCard(`${id}:sq1`, 3);
    expect(graded).toMatchObject({ id: `${id}:sq1`, origin: 'studio' });
    expect(graded.mem).not.toBeNull();
    expect(svc.queue('quiz', undefined, id)[0]!.card.mem).not.toBeNull();
  });

  it('a tile that fails says why; one cut by a restart is marked failed; no verified fact, no Studio', async () => {
    const root = tmp();
    const { svc, store, id } = await ready(r => (r.round === 'impara-studio' ? Promise.resolve({ ok: false as const, error: 'tempo scaduto' }) : fast(r)), root);
    svc.studio(id, 'summary');
    await until(() => store.get(id)?.studio?.summary?.state === 'failed');
    expect(store.get(id)!.studio!.summary!.error).toMatch(/tempo scaduto/);
    store.save({ ...store.get(id)!, studio: { ...store.get(id)!.studio, glossary: { state: 'making', at: 1 } } });
    make(fast, { root });
    expect(store.get(id)!.studio!.glossary).toMatchObject({ state: 'failed', error: expect.stringMatching(/interrotta/) });
    store.save({ ...store.get(id)!, facts: (store.get(id)!.facts ?? []).map(f => ({ ...f, check: 'unsure' as const })) });
    expect(() => make(fast, { root }).svc.studio(id, 'mindmap')).toThrow(/verificati/);
  });

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
