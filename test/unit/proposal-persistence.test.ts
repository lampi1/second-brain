// Real private files with injected rename faults: bounded contention recovery, atomic preservation and write ordering.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ProposalService, type ProposalDeps } from '../../src/main/improve/proposals';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-persistence-')); roots.push(root);
  const repo = path.join(root, 'repo'), workspaceRoot = path.join(root, 'work'); fs.mkdirSync(repo);
  const branches = new Map<string, string>();
  const deps: ProposalDeps = { repo, workspaceRoot, baseBranch: 'main', emit: () => {}, guard: async () => true,
    verified: async () => ({ quality: true, reviews: true }), startWork: vi.fn(async () => {}),
    run: async (cwd, _command, raw) => {
      const args = raw.slice(5);
      if (args[0] === 'worktree') { fs.mkdirSync(args[4]!); branches.set(args[4]!, args[3]!); return ''; }
      if (args.includes('--git-common-dir')) return repo;
      if (args[0] === 'symbolic-ref') return branches.get(cwd)!;
      if (args[0] === 'rev-parse') return 'a'.repeat(40);
      throw Error('Unexpected fake command');
    } };
  return { deps, service: new ProposalService(deps), file: path.join(workspaceRoot, 'proposals.json') };
}
const fault = (code: string) => Object.assign(new Error('Synthetic filesystem failure'), { code });

it('retries transient replacement denial without deleting old metadata or starting work early', async () => {
  const f = fixture(), first = await f.service.create(), old = fs.readFileSync(f.file, 'utf8');
  const rename = fs.promises.rename.bind(fs.promises);
  const deny = () => {
    expect(fs.readFileSync(f.file, 'utf8')).toBe(old);
    expect(f.deps.startWork).toHaveBeenCalledTimes(1);
    throw fault('EPERM');
  };
  // The immutable writer used renameSync; inject the same denial at either API for an actual RED comparison.
  vi.spyOn(fs, 'renameSync').mockImplementationOnce(deny);
  const spy = vi.spyOn(fs.promises, 'rename').mockImplementationOnce(async () => deny()).mockImplementation(rename);
  const second = await f.service.create();
  expect(spy).toHaveBeenCalledTimes(2);
  expect(new ProposalService(f.deps).list().map(p => p.id)).toEqual([first.id, second.id]);
});

it('bounds persistent contention, preserves the old file and cleans its temporary file', async () => {
  const f = fixture(); await f.service.create(); const old = fs.readFileSync(f.file, 'utf8');
  const spy = vi.spyOn(fs.promises, 'rename').mockRejectedValue(fault('EBUSY'));
  await expect(f.service.create()).rejects.toMatchObject({ cause: { code: 'EBUSY' } });
  expect(spy).toHaveBeenCalledTimes(5); expect(fs.readFileSync(f.file, 'utf8')).toBe(old);
  expect(fs.readdirSync(f.deps.workspaceRoot).filter(name => name.endsWith('.tmp'))).toEqual([]);
  expect(f.deps.startWork).toHaveBeenCalledTimes(1);
});

it('does not retry unrelated filesystem failures', async () => {
  const f = fixture(); const spy = vi.spyOn(fs.promises, 'rename').mockRejectedValue(fault('ENOSPC'));
  await expect(f.service.create()).rejects.toMatchObject({ cause: { code: 'ENOSPC' } });
  expect(spy).toHaveBeenCalledTimes(1); expect(f.deps.startWork).not.toHaveBeenCalled();
});

it('preserves a pre-existing temporary file when exclusive creation rejects a collision', async () => {
  const f = fixture(); let collision = '';
  vi.spyOn(fs.promises, 'open').mockImplementationOnce(async file => {
    collision = String(file); fs.writeFileSync(collision, 'pre-existing unrelated data'); throw fault('EEXIST');
  });
  await expect(f.service.create()).rejects.toMatchObject({ cause: { code: 'EEXIST' } });
  expect(fs.readFileSync(collision, 'utf8')).toBe('pre-existing unrelated data');
  expect(f.deps.startWork).not.toHaveBeenCalled();
});

it('serializes concurrent saves and keeps resume blocked until recovery metadata is persisted', async () => {
  const f = fixture(); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const rename = fs.promises.rename.bind(fs.promises);
  const spy = vi.spyOn(fs.promises, 'rename').mockImplementationOnce(async (...args) => { entered(); await gate; await rename(...args); }).mockImplementation(rename);
  const first = f.service.create(); await started;
  const second = f.service.create();
  try { await expect(f.service.resume(f.service.list()[0]!.id)).rejects.toThrow(/in corso/); }
  finally { release(); }
  const created = await Promise.all([first, second]);
  expect(spy).toHaveBeenCalledTimes(2);
  expect(new ProposalService(f.deps).list().map(p => p.id).sort()).toEqual(created.map(p => p.id).sort());
});
