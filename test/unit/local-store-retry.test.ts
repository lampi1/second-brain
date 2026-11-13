// writeLocal's rename retry (issue #71): a rename over a briefly locked file (EPERM on Windows) is retried, then works;
// a lock that never clears still throws and leaves no temp file behind.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLocal, writeLocal } from '../../src/main/agents/local-store';
import { log } from '../../src/main/log';

const eperm = () => Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });

describe('writeLocal rename retry', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retries a rename that fails twice with EPERM, then saves and warns once', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ls-'));
    const file = path.join(dir, 'agent-analytics.json');
    writeLocal(file, { v: 1 });
    const real = fs.renameSync.bind(fs);
    let fails = 2;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((a, b) => { if (fails-- > 0) throw eperm(); real(a, b); });
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    writeLocal(file, { v: 2 });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(readLocal(file)).toEqual({ v: 2 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('throws after every try fails and keeps the previous file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ls-'));
    const file = path.join(dir, 'runs.json');
    writeLocal(file, { v: 1 });
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw eperm(); });
    expect(() => writeLocal(file, { v: 2 })).toThrow(/EPERM/);
    expect(readLocal(file)).toEqual({ v: 1 });
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('does not retry other errors', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ls-'));
    const file = path.join(dir, 'x.json');
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Object.assign(new Error('nope'), { code: 'EXDEV' }); });
    expect(() => writeLocal(file, {})).toThrow(/nope/);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
