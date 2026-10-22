// A run's receipts recorded by ChatManager (ADR 0130) on a real git repository: the commands its engine reported with
// their exit codes, the files its turn changed (from the per-turn checkpoint), and the deterministic verdict once the
// run ended and its last turn's files are in; without checkpoints the files stay unknown.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { SessionSink } from '../../../src/main/chats/session';
import { plainOwner } from '../../../src/main/agents/catalog';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (): string => { const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rc-'))); roots.push(d); return d; };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@localhost', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@localhost' } });
function repo(): string {
  const d = tmp();
  git(d, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(d, 'src'));
  fs.writeFileSync(path.join(d, 'src', 'a.ts'), 'export const a = 1;\n');
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'init');
  return d;
}
const waitFor = async (ok: () => boolean): Promise<void> => { for (let i = 0; i < 1000 && !ok(); i++) await new Promise(r => setTimeout(r, 10)); };

/** A turn: the agent edits src/a.ts, then runs `command` with `exit`. */
function fixture(checkpoints: boolean, command: string, exit: number) {
  const d = repo();
  const userData = tmp();
  const m = new ChatManager({ userData, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, checkpoints: () => checkpoints, sessionFactory: (_h, _o, s: SessionSink) => {
    return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
      start() { s.changed({ state: 'idle' }); },
      send() {
        s.changed({ state: 'running' });
        const t = Date.now();
        fs.writeFileSync(path.join(d, 'src', 'a.ts'), 'export const a = 2;\n');
        s.item({ kind: 'tool', id: 'e1', at: t, name: 'Edit', summary: 'Edit: src/a.ts', input: { file_path: path.join(d, 'src', 'a.ts') }, status: 'ok' }, false);
        s.item({ kind: 'tool', id: 'b1', at: t + 1, name: 'Bash', summary: 'Bash', input: { command }, status: 'running' }, false);
        s.item({ kind: 'tool', id: 'b1', at: t + 1, name: 'Bash', summary: 'Bash', input: { command }, status: exit ? 'error' : 'ok', exitCode: exit }, true);
        s.item({ kind: 'tool', id: 'b1', at: t + 1, name: 'Bash', summary: 'Bash', input: { command }, status: exit ? 'error' : 'ok', exitCode: exit }, true); // a repeated row counts once
        s.item({ kind: 'result', id: 'r1', at: t + 2, costUsd: 0, durationMs: 1, turns: 1, isError: false }, false);
        s.changed({ state: 'idle' });
      },
      close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
      rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    } as never;
  } });
  managers.push(m);
  const create = () => m.create({ harness: 'claude', cwd: d, prompt: 'Correggi a.ts' }, 'agent',
    { owner: { ...plainOwner('claude', null), source: 'catalog', id: 'artisan', version: 1 }, instructions: 'You fix code.', policy: null });
  return { m, userData, create, run: (id: string) => m.list().find(x => x.id === id)?.run };
}

describe('receipts on a run (ADR 0130)', () => {
  it('records the command with its exit code and the turn\'s files, and passes the run when the check ran after the change', async () => {
    const f = fixture(true, 'npm test', 0);
    const c = await f.create();
    await waitFor(() => !!f.run(c.id)?.receipts?.filesKnown);
    expect(f.run(c.id)?.receipts).toMatchObject({ commands: [{ cmd: 'npm test', exit: 0, check: true }], files: ['src/a.ts'], filesKnown: true, filesGap: false, codeTouched: true, testsTouched: false });
    await f.m.set(c.id, { workStatus: 'completed' });
    expect(f.run(c.id)?.receipts?.verdict).toMatchObject({ result: 'pass', reason: 'checks-passed' });
    const stored = JSON.parse(fs.readFileSync(path.join(f.userData, 'agent-runs.json'), 'utf8')) as { runs: { receipts?: unknown }[] };
    expect(stored.runs[0]!.receipts).toMatchObject({ verdict: { result: 'pass' } });
  });
  it('a failing check after the change fails the run', async () => {
    const f = fixture(true, 'npx vitest run', 1);
    const c = await f.create();
    await waitFor(() => !!f.run(c.id)?.receipts?.filesKnown);
    await f.m.set(c.id, { workStatus: 'completed' });
    expect(f.run(c.id)?.receipts?.verdict).toMatchObject({ result: 'fail', reason: 'check-failed' });
  });
  it('without checkpoints the files stay unknown: no pass', async () => {
    const f = fixture(false, 'npm test', 0);
    const c = await f.create();
    await waitFor(() => !!f.run(c.id)?.receipts?.filesGap);
    await f.m.set(c.id, { workStatus: 'completed' });
    expect(f.run(c.id)?.receipts).toMatchObject({ filesKnown: false, filesGap: true, codeTouched: true, verdict: { result: 'unknown', reason: 'files-unknown' } });
  });
});
