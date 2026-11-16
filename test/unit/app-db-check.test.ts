// app.db's page check off the main thread (#426): quick_check runs in a worker thread on a read-only connection, a
// damaged file leaves a mark and the next open moves it aside; the first open never runs the check itself.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkInBackground, closeAppDbs, damagedMark, forgetChecks, openAppDb, readCheck, type CheckResult } from '../../src/main/app-db';
import { log } from '../../src/main/log';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); closeAppDbs(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-dbcheck-')); roots.push(d); return d; };
const check = (file: string) => new Promise<CheckResult>(resolve => checkInBackground(file, resolve));

describe('readCheck', () => {
  it('reads ok, damaged pages and a failure that is not damage', () => {
    expect(readCheck({ rows: ['ok'] })).toEqual({ ok: true });
    expect(readCheck({ rows: ['page 3 is never used', 'x', 'y', 'z'] })).toEqual({ ok: false, damaged: true, cause: 'quick_check: page 3 is never used; x; y' });
    expect(readCheck({ error: 'database is locked', corrupt: false })).toEqual({ ok: false, damaged: false, cause: 'database is locked' });
    expect(readCheck({ error: 'file is not a database', corrupt: true })).toMatchObject({ ok: false, damaged: true });
  });
});

describe('the background check', () => {
  it('finds a healthy database ok and leaves no mark', async () => {
    const dir = tmp(), file = path.join(dir, 'app.db');
    const { db } = openAppDb(file);
    db.exec('create table t(x); insert into t values (1)');
    db.close();
    expect(await check(file)).toEqual({ ok: true });
    expect(fs.existsSync(damagedMark(file))).toBe(false);
  });

  it('marks a damaged file and warns; the next open moves it aside (never deleted) and starts a new one', async () => {
    const dir = tmp(), file = path.join(dir, 'app.db');
    fs.writeFileSync(file, Buffer.alloc(4096, 7));
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const r = await check(file);
    expect(r).toMatchObject({ ok: false, damaged: true });
    expect(fs.existsSync(damagedMark(file))).toBe(true);
    expect(warn).toHaveBeenCalledWith('app-db', 'app database pages damaged', expect.objectContaining({ hint: expect.stringContaining('next start') }));
    const opened = openAppDb(file);
    expect(opened.aside).toMatch(/app\.db\.corrupt-/);
    expect(opened.cause).toMatch(/marked damaged by the last check/);
    expect(fs.existsSync(damagedMark(file))).toBe(false);
    expect(fs.readFileSync(opened.aside!).equals(Buffer.alloc(4096, 7))).toBe(true);
  });

  it('a mark left by a check is honoured even when the file opens fine', () => {
    const dir = tmp(), file = path.join(dir, 'app.db');
    openAppDb(file).db.close();
    fs.writeFileSync(damagedMark(file), 'quick_check: page 9 bad');
    forgetChecks();                                          // the next start
    const opened = openAppDb(file);
    expect(opened.aside).not.toBeNull();
    expect(opened.cause).toContain('page 9 bad');
  });

  it('a mark without its file is dropped, nothing is moved', () => {
    const dir = tmp(), file = path.join(dir, 'app.db');
    fs.writeFileSync(damagedMark(file), 'old');
    const opened = openAppDb(file);
    expect(opened.aside).toBeNull();
    expect(fs.existsSync(damagedMark(file))).toBe(false);
  });

  it('a mark written while the file is open is honoured only at the next start, never by a later owner\'s open', () => {
    const dir = tmp(), file = path.join(dir, 'app.db');
    const first = openAppDb(file);
    fs.writeFileSync(damagedMark(file), 'quick_check: page 2 bad');
    expect(openAppDb(file).aside).toBeNull();          // a second owner in the same process
    first.db.close();
    expect(fs.existsSync(file)).toBe(true);
  });
});
