// Release writer protocol exercises real child CLIs against inert filesystem fixtures only: no app/network/build.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { acquireReleaseLock, withReleaseLock } from '../../scripts/update.mjs';

const home = path.resolve(import.meta.dirname, '../../test-results/writer-fixtures');
const put = (root: string, name: string, text: string | Buffer) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const make = () => { fs.mkdirSync(home, { recursive: true }); return fs.mkdtempSync(path.join(home, 'case-')); };
function state(root: string, current = 'running', previous: string | null = null, protocol = 1) {
  put(root, 'current.json', JSON.stringify({ current, previous, writerProtocol: protocol, bad: [], history: [] }));
}
afterEach(() => vi.restoreAllMocks());

it('retains dirty evidence if commit persistence fails', () => {
  const base = make(); state(base);
  const lease = acquireReleaseLock(base, 'commit-failure'); lease.begin();
  const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('injected rename failure'); });
  expect(() => lease.commit()).toThrow('injected rename failure');
  rename.mockRestore();
  expect(() => lease.release()).toThrow('journal preserved');
  expect(JSON.parse(fs.readFileSync(path.join(base, '.release-writer-lock/owner.json'), 'utf8')).dirty).toBe(true);
  expect(fs.existsSync(path.join(base, '.release-writer-lock/before/current.json'))).toBe(true);
});

it('refuses a changed owner token before mutation or cleanup', () => {
  const base = make(), lease = acquireReleaseLock(base, 'owner-check');
  const owner = path.join(base, '.release-writer-lock/owner.json');
  const record = JSON.parse(fs.readFileSync(owner, 'utf8'));
  fs.writeFileSync(owner, JSON.stringify({ ...record, token: 'different-owner' }));
  expect(() => lease.begin()).toThrow('ownership changed');
  expect(() => lease.release()).toThrow('ownership changed');
  expect(fs.existsSync(owner)).toBe(true);
});

it('ordinary rejected preconditions leave no dirty lock', () => {
  const base = make();
  expect(() => withReleaseLock(base, 'precondition', () => { throw new Error('precondition failed'); })).toThrow('precondition failed');
  expect(fs.existsSync(path.join(base, '.release-writer-lock'))).toBe(false);
});

it('does not silently adopt an existing legacy root for any writer', () => {
  const base = make();
  put(base, 'current.json', '{"current":"legacy","previous":null,"bad":[],"history":[]}');
  expect(() => acquireReleaseLock(base, 'install')).toThrow('offline migration');
  expect(fs.existsSync(path.join(base, '.release-writer-lock'))).toBe(false);
});
