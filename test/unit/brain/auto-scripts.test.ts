// Issue #111 (ADR 0096): a reusable command run with "Esegui" that ended with exit 0 becomes a brain script by itself
// (heuristic, no tokens), with a changelog line; trivial commands, failures and anything that looks like a credential
// stay out; dedupe by command; a script the user deleted is not added back. Plus brain_script_add, the work chats'
// add-only tool. Real files in a temp folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunInfo } from '../../../src/shared/contract';
import { AutoScripts, scriptNameOf, skipReason } from '../../../src/main/brain/auto-scripts';
import { BrainScripts, parseHeader } from '../../../src/main/brain/scripts';
import { BrainChangelog } from '../../../src/main/brain/changelog';
import { chatScriptAddTool } from '../../../src/main/brain/scripts-tools';
import type { CallCtx } from '../../../src/main/mcp/server';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-auto-scripts-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const DEPLOY = 'az webapp deploy --resource-group rg-test --name air-test --src-path .\\air.zip --type zip';
let seq = 0;
const run = (code: string, over: Partial<RunInfo> = {}): RunInfo => ({
  id: `run-${++seq}`, chatId: 'c1', itemId: 'i1', code, cwd: 'C:\\repo', state: 'ok', exitCode: 0, output: 'done',
  startedAt: 1_000, endedAt: 4_000, ...over,
});
const setup = () => {
  const changelog = new BrainChangelog(() => root);
  const scripts = new BrainScripts(() => root, changelog);
  const auto = new AutoScripts({ scripts, root: () => root, chatTitle: () => 'Deploy Air', platform: 'win32' });
  return { changelog, scripts, auto };
};

describe('skipReason (reusable command heuristic)', () => {
  it('keeps a command with arguments or a few steps', () => {
    expect(skipReason(DEPLOY)).toBeNull();
    expect(skipReason('cd C:\\repo\\Populator\ndotnet run -- --migrate all')).toBeNull();
    expect(skipReason('npm run build\nnpm run migrate')).toBeNull();
  });
  it('skips look-arounds, one-word tools and empty blocks', () => {
    expect(skipReason('ls')).toBe('trivial');
    expect(skipReason('git status\ngit log -5')).toBe('trivial');
    expect(skipReason('Get-ChildItem C:\\temp -Recurse | Select-Object -First 5')).toBe('trivial');
    expect(skipReason('npm test')).toBe('short');
    expect(skipReason('# only a comment\n')).toBe('empty');
  });
  it('skips a command that may hold a credential', () => {
    const secret = `sqlcmd -S db.local -U sa -P ${'Sup3r'}${'Secret!42'} -Q "select 1"`;
    expect(skipReason(secret)).toBe('secret');
    expect(skipReason(`curl -H "Authorization: Bearer ${'abcdef0123456789'}${'abcdef0123456789'}" https://x.test/api`)).toBe('secret');
  });
});

describe('AutoScripts', () => {
  it('saves a successful reusable run as a tested script with a changelog line', () => {
    const { auto, scripts, changelog } = setup();
    const file = auto.onRun(run(DEPLOY));
    expect(file).toBe(`scripts/${scriptNameOf(DEPLOY, 'win32')}`);
    expect(file).toMatch(/^scripts\/cmd-az-webapp-deploy-[0-9a-f]{8}\.ps1$/);
    const [s] = scripts.list().scripts;
    expect(s).toMatchObject({ title: DEPLOY.slice(0, 69) + '…', tags: ['auto', 'esegui', 'produzione'], tested: { state: 'ok' } });
    expect(s!.description).toContain('Deploy Air');
    const text = fs.readFileSync(path.join(root, file!), 'utf8');
    expect(text).toContain(DEPLOY);
    expect(parseHeader(text).usage).toContain('powershell -NoProfile -File scripts/');
    const [e] = changelog.list().entries;
    expect(e).toMatchObject({ kind: 'script', action: 'added', by: 'app', target: file });
    expect(e!.summary).toContain('.deleted');
  });

  it('ignores failed, stopped and running runs, and the same run twice', () => {
    const { auto } = setup();
    expect(auto.onRun(run(DEPLOY, { state: 'error', exitCode: 1 }))).toBeNull();
    expect(auto.onRun(run(DEPLOY, { state: 'stopped', exitCode: null }))).toBeNull();
    expect(auto.onRun(run(DEPLOY, { state: 'running', exitCode: null }))).toBeNull();
    const r = run(DEPLOY);
    expect(auto.onRun(r)).not.toBeNull();
    expect(auto.onRun(r)).toBeNull();
  });

  it('dedupes by command, also against a script saved by hand with the same body', () => {
    const { auto, scripts } = setup();
    expect(auto.onRun(run(DEPLOY))).not.toBeNull();
    expect(auto.onRun(run(`  ${DEPLOY}  \n`))).toBeNull();
    const cmd = 'dotnet run --project Populator -- --migrate all';
    scripts.save({ name: 'migra-test.ps1', code: cmd, by: 'Orchestrator', meta: { title: 'Migra', description: 'Migra i DB di test', tested: { ok: true, note: 'ok' } } });
    expect(auto.onRun(run(cmd))).toBeNull();
    expect(scripts.list().scripts).toHaveLength(2);
  });

  it('does not add back a script the user deleted (the rollback holds)', () => {
    const { auto, scripts } = setup();
    const file = auto.onRun(run(DEPLOY))!;
    scripts.delete({ name: path.basename(file), by: 'utente', reason: 'non serve' });
    expect(auto.onRun(run(DEPLOY))).toBeNull();
    expect(scripts.list().scripts).toEqual([]);
  });

  it('never writes a trivial or secret command, and nothing without a brain', () => {
    const { auto } = setup();
    expect(auto.onRun(run('git status'))).toBeNull();
    expect(auto.onRun(run(`$env:X = "x"; sqlcmd -S db.local -U sa -P ${'Sup3r'}${'Secret!42'} -Q "select 1"`))).toBeNull();
    expect(fs.existsSync(path.join(root, 'scripts'))).toBe(false);
    const none = new AutoScripts({ scripts: new BrainScripts(() => null), root: () => null });
    expect(none.onRun(run(DEPLOY))).toBeNull();
  });

  it('writes a shell script off Windows', () => {
    expect(scriptNameOf('npm run build\nnpm run migrate', 'linux')).toMatch(/^cmd-npm-run-build-[0-9a-f]{8}\.sh$/);
  });
});

describe('brain_script_add (work chats)', () => {
  const ctx = { mount: 'chat', params: { chatId: 'c7' }, sessionId: '', signal: new AbortController().signal, progress: () => false } as CallCtx;
  const args = { name: 'deploy-air.ps1', title: 'Deploy Air test', description: 'Zip su web app di test', code: DEPLOY, note: 'deploy ok' };

  it('adds a new script logged under the chat title, and refuses to overwrite one', async () => {
    const changelog = new BrainChangelog(() => root);
    const scripts = new BrainScripts(() => root, changelog);
    const tool = chatScriptAddTool(scripts, id => (id === 'c7' ? 'Lavoro Air' : null));
    const out = JSON.parse(await tool.run(args, ctx) as string);
    expect(out).toMatchObject({ ok: true, action: 'added', file: 'scripts/deploy-air.ps1' });
    expect(scripts.list().scripts[0]!.tested.state).toBe('ok');
    expect(changelog.list().entries[0]).toMatchObject({ by: 'Lavoro Air', action: 'added' });
    await expect(async () => tool.run({ ...args, code: 'echo 2' }, ctx)).rejects.toThrow(/exists already/);
  });

  it('refuses a credential', async () => {
    const tool = chatScriptAddTool(new BrainScripts(() => root), () => 'x');
    await expect(async () => tool.run({ ...args, name: 'b.ps1', code: `$${'pass'}${'word'} = "${'demo-non-reale-42'}"` }, ctx)).rejects.toThrow(/credential/);
  });
});
