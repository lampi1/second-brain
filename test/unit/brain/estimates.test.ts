// The job ledger (src/main/brain/estimates.ts): the kind of work of a job (the one taxonomy, ADR 0182; old rows mapped), the cost.mjs backfill parser
// on a fixture, the ledger (upsert, last wins, prompt never stored, backfill never overrides app jobs). ADR 0053
// removed the per-job cost/time estimate this module used to compute for the UI.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FileJobStore, Ledger, backfillFromCost } from '../../../src/main/brain/estimates';
import type { TaskKind } from '../../../src/shared/contract';
import { FIXTURES, plainNode, tmpDir } from './helpers';

describe('kind of work (ADR 0182: the routing table\'s own kinds)', () => {
  const cases: [string, TaskKind][] = [
    ['Fix the login error on the settings page', 'bug-fix'],
    ["C'è un bug: l'agenda non si apre, correggilo", 'bug-fix'],
    ['Riesegui il test plan E2E', 'qa-run'],
    ['Fai la review della PR 42', 'review'],
    ['Implementa la nuova pagina dei preventivi', 'app-feature'],
    ['Investiga perché il login fallisce da martedì', 'investigation'],
    ['Brief mattino', 'altro'],
  ];
  for (const [text, kind] of cases) it(`${kind}: ${text}`, () => {
    const l = new Ledger({ load: () => [], append: () => {} });
    const { id } = l.record({ harness: 'claude', model: null, effort: null, prompt: text });
    expect(l.all().find(r => r.id === id)!.kind).toBe(kind);
  });
  it('an old row keeps loading: its own kind is mapped to the one taxonomy', () => {
    const d = tmpDir();
    const f = path.join(d, 'jobs.jsonl');
    fs.writeFileSync(f, ['fix', 'qa', 'research', 'question', 'other', 'bug-fix', 'nonsense'].map((kind, i) => JSON.stringify({ id: `j${i}`, at: i, harness: 'claude', model: null, effort: null, kind, promptChars: 1, actual: null, source: 'app' })).join('\n') + '\n');
    expect(new FileJobStore(f).load().map(r => r.kind)).toEqual(['bug-fix', 'qa-run', 'investigation', 'altro', 'altro', 'bug-fix', 'altro']);
  });
});

describe('estimates', () => {
  it('backfill: one Claude job per chat from cost.mjs; chats cut by the window or still active are left out', () => {
    const j = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'cost-1day.json'), 'utf8')) as { from: string; chats: Record<string, { from: number; to: number }> };
    const start = Date.parse(`${j.from}T00:00:00+02:00`) - 2 * 864e5; // pretend a window that began two days earlier
    const rows = backfillFromCost(j, { now: Date.parse(`${j.from}T20:00:00+02:00`), windowStartMs: start });
    expect(rows.map(r => [r.id.slice(0, 15), r.kind, r.actual!.usd, r.actual!.minutes])).toEqual([
      ['claude:11111111', 'bug-fix', 8.25, 40],
      ['claude:22222222', 'orchestrator', 4.25, 120],
    ]);
    expect(rows[0]).toMatchObject({ harness: 'claude', model: null, source: 'backfill', promptChars: null });
    // the same chats seen from a window that starts on their day (maybe cut) or while still active: skipped
    expect(backfillFromCost(j, { now: Date.parse(`${j.from}T20:00:00+02:00`), windowStartMs: Date.parse(`${j.from}T00:00:00+02:00`) })).toEqual([]);
    // at 09:50 the chat that ended at 09:00 may still be running (last message within the hour); the 08:40 one is done
    expect(backfillFromCost(j, { now: Date.parse(`${j.from}T09:50:00+02:00`), windowStartMs: start }).map(r => r.id.slice(7, 15))).toEqual(['11111111']);
    expect(backfillFromCost(null, { now: 0, windowStartMs: 0 })).toEqual([]);
  });

  it('ledger: record and update by id (last wins), prompt never stored, survives a restart', () => {
    const file = path.join(tmpDir(), 'jobs.jsonl');
    const l = new Ledger(new FileJobStore(file));
    const { id } = l.record({ harness: 'claude', model: 'claude-opus-5-5', effort: 'high', prompt: 'Fix the login bug please' });
    l.record({ id, harness: 'claude', model: 'claude-opus-5-5', effort: 'high', actual: { usd: 1.2, minutes: 14, tokensIn: 1000, tokensOut: 200, turns: 3 } });
    expect(fs.readFileSync(file, 'utf8')).not.toMatch(/login bug/);
    const again = new Ledger(new FileJobStore(file)).all();
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ id, kind: 'bug-fix', promptChars: 24, actual: { usd: 1.2, minutes: 14, turns: 3 }, source: 'app' });
    expect(() => l.record({ harness: 'x' as never, model: null, effort: null })).toThrow(/harness/);
    expect(() => l.record({ harness: 'claude', model: null, effort: null, actual: { usd: -1, minutes: null, tokensIn: null, tokensOut: null, turns: null } })).toThrow(/≥ 0/);
  });

  it('a backfill never overrides app jobs', async () => {
    const dir = tmpDir();
    const root = tmpDir();
    fs.mkdirSync(path.join(root, 'ops', 'tools'), { recursive: true });
    const fx = fs.readFileSync(path.join(FIXTURES, 'cost-1day.json'), 'utf8');
    const j = JSON.parse(fx) as { from: string; chats: Record<string, { from: number; to: number }> };
    // a fake cost.mjs whose window starts long before the fixture chats, so none of them is "cut"
    fs.writeFileSync(path.join(root, 'ops', 'tools', 'cost.mjs'), `const j = ${fx};\nj.from = '2026-09-01';\nconsole.log(JSON.stringify(j));\n`);
    const l = new Ledger(new FileJobStore(path.join(dir, 'jobs.jsonl')), path.join(dir, 'jobs-meta.json'));
    l.record({ id: 'claude:11111111-1111-4111-8111-111111111111', harness: 'claude', model: 'opus-5-5', effort: null, prompt: 'fix', actual: { usd: 9, minutes: 41, tokensIn: null, tokensOut: null, turns: 2 } });
    const now = Date.parse(`${j.from}T20:00:00+02:00`);
    const r = await l.backfill(root, plainNode, now);
    expect(r).toEqual({ added: 1, skipped: null });
    expect(l.all().find(x => x.id.startsWith('claude:1111'))!.actual!.usd).toBe(9); // the app's record stays
    expect((await l.backfill(root, plainNode, now + 3600e3)).skipped).toMatch(/20 ore/);
    expect((await l.backfill(null, plainNode)).skipped).toMatch(/cost\.mjs/);
  });
});
