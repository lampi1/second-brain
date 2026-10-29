// The Log's journal (main/activity/journal.ts): records with ids, cuts long fields and redacts secrets, writes one file a
// day, reloads the last events, cleans the days past the limit and the oldest days past the size cap, keeps demo
// events in memory only.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Journal } from '../../../src/main/activity/journal';
import { addRedaction } from '../../../src/main/log';
import { LOG_FIELD_MAX, LOG_KEEP_DAYS } from '../../../src/shared/activity-log';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-journal-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('journal', () => {
  it('records, cuts, redacts, writes and reloads', () => {
    const dir = tmp(), j = new Journal();
    j.init(dir);
    const e = j.record({ kind: 'task', level: 'ok', title: 'Scout ha lavorato', output: 'x'.repeat(LOG_FIELD_MAX + 50), error: 'token sk-abcdefghijklmnopqrstuvwxyz123' })!;
    expect(e.id).toBeTruthy();
    expect(e.output!.length).toBe(LOG_FIELD_MAX);
    expect(e.error).not.toContain('sk-abcdefghijklmnop');
    j.stop();
    const files = fs.readdirSync(path.join(dir, 'activity'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^log-\d{4}-\d{2}-\d{2}\.jsonl$/);
    const again = new Journal(); again.init(dir); again.stop();
    expect(again.list().events.map(x => x.title)).toEqual(['Scout ha lavorato']);
    expect(again.list().bytes).toBeGreaterThan(0);
  });

  it('redacts a known key that straddles the cut', () => {
    const dir = tmp(), j = new Journal(); j.init(dir);
    const key = 'K3y-' + 'q'.repeat(40);
    addRedaction(key);
    const e = j.record({ kind: 'app', level: 'warn', title: 'x', error: 'a'.repeat(LOG_FIELD_MAX - 10) + key })!;
    j.stop();
    expect(e.error).not.toContain('K3y-qqqq');
    expect(fs.readFileSync(path.join(dir, 'activity', fs.readdirSync(path.join(dir, 'activity'))[0]!), 'utf8')).not.toContain('K3y-qqqq');
  });

  it('pushes new events in one batch', async () => {
    const dir = tmp(), j = new Journal(), got: number[] = [];
    j.init(dir, ev => got.push(ev.length));
    j.record({ kind: 'app', level: 'warn', title: 'a' }); j.record({ kind: 'app', level: 'warn', title: 'b' });
    await new Promise(r => setTimeout(r, 300));
    j.stop();
    expect(got).toEqual([2]);
  });

  it('deletes the days past the limit, keeps today', () => {
    const dir = tmp(), act = path.join(dir, 'activity');
    fs.mkdirSync(act, { recursive: true });
    const day = (ago: number) => { const d = new Date(Date.now() - ago * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    fs.writeFileSync(path.join(act, `log-${day(LOG_KEEP_DAYS + 2)}.jsonl`), '{}\n');
    fs.writeFileSync(path.join(act, `log-${day(1)}.jsonl`), 'broken line\n');
    fs.writeFileSync(path.join(act, 'other.txt'), 'not ours');
    const j = new Journal(); j.init(dir); j.stop();
    expect(fs.readdirSync(act).sort()).toEqual([`log-${day(1)}.jsonl`, 'other.txt']);
    expect(j.list().events).toEqual([]);
  });

  it('keeps an old day the logs digest has not summarized yet (ADR 0192), never past the hold', () => {
    const dir = tmp(), act = path.join(dir, 'activity');
    fs.mkdirSync(act, { recursive: true });
    const day = (ago: number) => { const d = new Date(Date.now() - ago * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    for (const ago of [LOG_KEEP_DAYS + 2, LOG_KEEP_DAYS + 3, LOG_KEEP_DAYS + 60]) fs.writeFileSync(path.join(act, `log-${day(ago)}.jsonl`), '{}\n');
    const j = new Journal();
    j.hold = d => d !== day(LOG_KEEP_DAYS + 3); // +3 is already in the digest
    j.init(dir); j.stop();
    expect(fs.readdirSync(act)).toEqual([`log-${day(LOG_KEEP_DAYS + 2)}.jsonl`]);
  });

  it('keeps demo events in memory only', () => {
    const dir = tmp(), j = new Journal(); j.init(dir);
    j.seed([{ id: 'd1', at: 1, kind: 'pulse', level: 'ok', title: 'Battito' }]);
    j.stop();
    expect(j.list().events.map(e => e.id)).toEqual(['d1']);
    expect(fs.readdirSync(path.join(dir, 'activity'))).toEqual([]);
  });
});
