// Code Mode's parts (ADR 0331): who gets it (code-mode/policy.ts), the thin native wrappers over a temp folder with a
// fake spawn (code-mode/natives.ts: no real process), the bridge's tool list and output values (code-mode/bridge.ts),
// run_code's schema per chat (code-mode/tool.ts), and the setting the Orchestrator reads and changes (app_config area
// setting, its change log and Annulla) and the guide's card about it.
import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codeModeFor, gateName } from '../../../src/main/code-mode/policy';
import { bashTimeout, globRegExp, runNative, type NativeEnv, type Spawn } from '../../../src/main/code-mode/natives';
import { FS_LIMITS, fsOp } from '../../../src/main/code-mode/fs-ops';
import type { FsRunner } from '../../../src/main/code-mode/fs-run';
import { bridge, catalog, outputValue, type BridgeDeps } from '../../../src/main/code-mode/bridge';
import { runCodeTool, toolList } from '../../../src/main/code-mode/tool';
import type { McpTool } from '../../../src/main/mcp/server';
import { configTool, type ConfigDeps } from '../../../src/main/appctl/config';
import { ConfigStore, DEFAULTS, schema } from '../../../src/main/brain/config';
import { entries } from '../../../src/main/appctl/guide';

const dirs: string[] = [];
const tmp = (): string => { const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cmp-'))); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('who runs in Code Mode', () => {
  it('Claude and Cursor chats with the setting on; never the Orchestrator, the research or another engine', () => {
    const c = (o: object) => ({ harness: 'claude', isOrchestrator: false, research: false, ...o }) as never;
    expect(codeModeFor(c({}), true)).toBe(true);
    expect(codeModeFor(c({ harness: 'cursor' }), true)).toBe(true);
    expect(codeModeFor(c({}), false)).toBe(false);
    expect(codeModeFor(c({ isOrchestrator: true }), true)).toBe(false);
    expect(codeModeFor(c({ research: true }), true)).toBe(false);
    expect(codeModeFor(c({ harness: 'codex' }), true)).toBe(false);
  });
  it('names a call the way the gates know it', () => {
    expect(gateName('native', 'Bash')).toBe('Bash');
    expect(gateName('app', 'navigate')).toBe('mcp__second-brain__navigate');
    expect(gateName('ext', 'send_email', 'outlook')).toBe('mcp__outlook__send_email');
  });
});

// only the env variable a test sets is kept: a whole env must never land in a test's output
function fakeSpawn(seen: { cmd: string; args: string[]; cwd?: string; chatEnv?: string }[], code = 0, out = 'hi\n', err = '', hang = false): Spawn & { killed: number } {
  const f = ((cmd: string, args: string[], opts: SpawnOptions) => {
    seen.push({ cmd, args, ...(typeof opts.cwd === 'string' ? { cwd: opts.cwd } : {}), ...(opts.env?.SB_CHAT ? { chatEnv: opts.env.SB_CHAT } : {}) });
    const stdout = new EventEmitter(), stderr = new EventEmitter(), child = new EventEmitter() as EventEmitter & { stdout: unknown; stderr: unknown; kill: () => void };
    child.stdout = stdout; child.stderr = stderr;
    child.kill = () => { f.killed++; queueMicrotask(() => child.emit('close', null)); };
    if (!hang) queueMicrotask(() => { stdout.emit('data', out); if (err) stderr.emit('data', err); child.emit('close', code); });
    return child as never;
  }) as unknown as Spawn & { killed: number };
  f.killed = 0;
  return f;
}

/** the file reads run here, not in their worker thread (no thread in a unit test) */
const direct: FsRunner = async req => fsOp(req);

describe('the native wrappers', () => {
  it('Bash runs the command with the shell in the chat\'s folder and returns exit code and output', async () => {
    const cwd = tmp(), seen: { cmd: string; args: string[]; cwd?: string }[] = [];
    expect(await runNative('Bash', { command: 'echo hi' }, { cwd, shell: '/bin/bash', spawn: fakeSpawn(seen) })).toEqual({ exitCode: 0, stdout: 'hi\n', stderr: '' });
    expect(seen).toEqual([{ cmd: '/bin/bash', args: ['-c', 'echo hi'], cwd }]);
    expect(await runNative('Bash', { command: 'false' }, { cwd, shell: '/bin/bash', spawn: fakeSpawn([], 2, '', 'no') })).toMatchObject({ exitCode: 2, stderr: 'no' });
    await expect(runNative('Bash', { command: 'ls' }, { cwd, shell: null })).rejects.toThrow(/Git Bash not found/);
    await expect(runNative('Bash', {}, { cwd, shell: '/bin/bash', spawn: fakeSpawn([]) })).rejects.toThrow(/command is required/);
  });

  it('Bash gets the chat\'s env; the run\'s end kills it; its timeout never passes the run\'s time left', async () => {
    const cwd = tmp(), seen: { cmd: string; args: string[]; chatEnv?: string }[] = [];
    await runNative('Bash', { command: 'env' }, { cwd, shell: '/bin/bash', spawn: fakeSpawn(seen), env: { SB_CHAT: 'c1' } });
    expect(seen[0]!.chatEnv).toBe('c1');
    const ac = new AbortController(), hung = fakeSpawn([], 0, '', '', true);
    const running = runNative('Bash', { command: 'sleep 999' }, { cwd, shell: '/bin/bash', spawn: hung, signal: ac.signal });
    ac.abort();
    await expect(running).rejects.toThrow(/stopped: its run ended/);
    expect(hung.killed).toBe(1);
    expect(bashTimeout(undefined)).toBe(120_000);
    expect(bashTimeout(600_000, 30_000)).toBe(30_000);
    expect(bashTimeout(5_000, 30_000)).toBe(5_000);
    expect(() => bashTimeout(undefined, 500)).toThrow(/no time left/);
    await expect(runNative('Bash', { command: 'ls' }, { cwd, shell: '/bin/bash', spawn: fakeSpawn([]), signal: AbortSignal.abort() })).rejects.toThrow(/cancelled/);
  });

  it('the file reads have size limits and leave out what the chat may not read', async () => {
    const cwd = tmp();
    fs.writeFileSync(path.join(cwd, 'big.txt'), Buffer.alloc(FS_LIMITS.maxFileBytes + 1, 'a'));
    fs.writeFileSync(path.join(cwd, 'ok.txt'), 'needle');
    fs.writeFileSync(path.join(cwd, '.env'), 'needle');
    await expect(runNative('Read', { file_path: 'big.txt' }, { cwd, fsRun: direct })).rejects.toThrow(/over the 10 MB/);
    await expect(runNative('Edit', { file_path: 'big.txt', old_string: 'a', new_string: 'b' }, { cwd })).rejects.toThrow(/over 10 MB/);
    expect(() => fsOp({ op: 'grep', base: cwd, files: ['ok.txt'], pattern: 'x'.repeat(FS_LIMITS.patternMax + 1), ignoreCase: false, mode: 'content', limit: 0 })).toThrow(/over 1000 characters/);
    const env: NativeEnv = { cwd, fsRun: direct, readable: f => path.basename(f) !== '.env' };
    const hits = String(await runNative('Grep', { pattern: 'needle' }, env)).split('\n').map(f => path.basename(f));
    expect(hits).toEqual(['ok.txt']); // big.txt skipped (too large), .env left out (a Read deny)
    expect((await runNative('Glob', { pattern: '*' }, env) as string[]).map(f => path.basename(f)).sort()).toEqual(['big.txt', 'ok.txt']);
  });

  it('a slow file read is the runner\'s to stop: its time limit follows the run\'s time left', async () => {
    const cwd = tmp(), asked: number[] = [];
    const slow: FsRunner = async (_req, o) => { asked.push(o.timeoutMs); throw new Error('Grep took over 5 s and was stopped: narrow the path or the pattern'); };
    await expect(runNative('Grep', { pattern: '(a+)+$' }, { cwd, fsRun: slow, maxMs: 5_000 })).rejects.toThrow(/was stopped/);
    expect(asked).toEqual([5_000]);
  });

  it('Write, Read, Edit over the chat\'s folder', async () => {
    const cwd = tmp();
    await runNative('Write', { file_path: 'sub/a.txt', content: 'uno\ndue\ndue\n' }, { cwd });
    expect(await runNative('Read', { file_path: 'sub/a.txt' }, { cwd, fsRun: direct })).toBe('1\tuno\n2\tdue\n3\tdue\n4\t');
    expect(await runNative('Read', { file_path: 'sub/a.txt', offset: 2, limit: 1 }, { cwd, fsRun: direct })).toBe('2\tdue');
    await expect(runNative('Edit', { file_path: 'sub/a.txt', old_string: 'due', new_string: 'tre' }, { cwd })).rejects.toThrow(/found 2 times/);
    await runNative('Edit', { file_path: 'sub/a.txt', old_string: 'uno', new_string: 'zero' }, { cwd });
    await runNative('Edit', { file_path: 'sub/a.txt', old_string: 'due', new_string: 'tre', replace_all: true }, { cwd });
    expect(fs.readFileSync(path.join(cwd, 'sub', 'a.txt'), 'utf8')).toBe('zero\ntre\ntre\n');
    await expect(runNative('Edit', { file_path: 'sub/a.txt', old_string: 'nove', new_string: 'x' }, { cwd })).rejects.toThrow(/not found/);
  });

  it('Grep and Glob walk the folder, node_modules and .git left out', async () => {
    const cwd = tmp();
    for (const [f, t] of [['src/a.ts', 'const x = 1;\nfoo()\n'], ['src/b.md', 'foo bar'], ['node_modules/m/i.ts', 'foo'], ['.git/c', 'foo']]) {
      fs.mkdirSync(path.dirname(path.join(cwd, f!)), { recursive: true });
      fs.writeFileSync(path.join(cwd, f!), t!);
    }
    const env = { cwd, fsRun: direct };
    const files = String(await runNative('Grep', { pattern: 'foo' }, env)).split('\n').map(f => path.relative(cwd, f).replace(/\\/g, '/')).sort();
    expect(files).toEqual(['src/a.ts', 'src/b.md']);
    expect(String(await runNative('Grep', { pattern: 'foo', glob: '*.ts', output_mode: 'content' }, env))).toMatch(/a\.ts:2:foo\(\)$/);
    expect(String(await runNative('Grep', { pattern: 'FOO', '-i': true, output_mode: 'count' }, env)).split('\n')).toHaveLength(2);
    const ts = (await runNative('Glob', { pattern: '**/*.ts' }, env) as string[]).map(f => path.relative(cwd, f).replace(/\\/g, '/'));
    expect(ts).toEqual(['src/a.ts']);
    expect(globRegExp('src/*.{ts,md}').test('src/b.md')).toBe(true);
    expect(globRegExp('*.ts').test('deep/x/y.ts')).toBe(true);
  });
});

const appTool = (name: string, out: unknown): McpTool => ({ name, description: `${name} tool`, inputSchema: { type: 'object' }, run: async () => out as never });
const deps = (over: Partial<BridgeDeps> = {}): BridgeDeps => ({
  decideFor: async () => ({ kind: 'allow' }), row: () => {}, context: () => ({ error: 'no folder' }),
  appTools: () => [appTool('navigate', 'ok'), appTool('run_code', 'x')], extServers: () => ['outlook', 'broken'],
  extTools: async (_c, s) => { if (s === 'broken') throw new Error('down'); return [appTool('send_email', 'sent')]; }, ...over,
});

describe('the bridge and run_code\'s schema', () => {
  it('lists natives, the chat\'s app tools (not run_code) and each answering connector', async () => {
    expect((await catalog(deps(), 'c')).map(e => e.name)).toEqual(['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'navigate', 'outlook__send_email']);
    const list = toolList(deps(), 'c');
    expect(list).toMatch(/^Native: Bash/);
    expect(list).toMatch(/App: navigate \(/);
    expect(list).not.toMatch(/run_code/);
    expect(list).toMatch(/Connectors: outlook, broken/);
    const schema = runCodeTool(deps()).inputSchemaFor!({ chatId: 'c' }) as { properties: { code: { description: string } } };
    expect(schema.properties.code.description).toContain('navigate');
  });
  it('a tool\'s output becomes a script value; an error result throws', () => {
    expect(outputValue('plain')).toBe('plain');
    expect(outputValue({ text: 'shot', images: [{ data: 'x', mimeType: 'image/png' }] } as never)).toMatch(/1 image\(s\) not passed/);
    expect(outputValue({ raw: { content: [{ type: 'text', text: 'a' }], structuredContent: { n: 1 } } })).toEqual({ n: 1 });
    expect(() => outputValue({ raw: { content: [{ type: 'text', text: 'bad' }], isError: true } })).toThrow('bad');
  });
  it('a script reaches app tools and connectors in-process, and list_tools reads the list', async () => {
    const out = await runCodeTool({ ...deps(), progressEveryMs: 1e9 }).run({ code: 'const a = await tools.navigate({ url: "x" }); const b = await tools.call("outlook__send_email", {}); const l = await tools.list_tools({ server: "outlook" }); return [a, b, l.length];' },
      { mount: 'chat', params: { chatId: 'c' }, sessionId: 's', signal: new AbortController().signal, progress: () => true });
    const body = JSON.parse((out as { raw: { content: { text: string }[] } }).raw.content[0]!.text) as { value: unknown };
    expect(body.value).toEqual(['ok', 'sent', 1]);
  });
  it('a user\'s wait counts as paused while it lasts, two at once count once', async () => {
    let t = 0, release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const d = deps({ decideFor: async (_c, _t, _i, o) => { o.asking?.(); await gate; o.waited?.(0); return { kind: 'allow' }; } });
    const b = bridge(d, 'c', await catalog(d, 'c'), { signal: new AbortController().signal, progress: () => true, sessionId: 's' }, { now: () => t });
    const one = b.call('navigate', {}), two = b.call('navigate', {});
    await new Promise(r => setImmediate(r));
    t = 5_000;
    expect(b.pausedMs!()).toBe(5_000);
    release(); await Promise.all([one, two]);
    t = 9_000;
    expect(b.pausedMs!()).toBe(5_000);
  });

  it('a host call that never answers: the wall limit ends the run, and the run\'s end cancels the call', async () => {
    let t = 0, cancelled = false;
    const hang: McpTool = { name: 'hang', description: 'never answers', inputSchema: { type: 'object' }, run: (_a, c) => new Promise(() => { c.signal.addEventListener('abort', () => { cancelled = true; }); }) };
    const out = await runCodeTool({ ...deps({ appTools: () => [hang], extServers: () => [] }), progressEveryMs: 1e9, limits: { wallMs: 1_000 }, now: () => t,
      setTimer: (fn, ms) => { queueMicrotask(() => { t += ms; fn(); }); return () => {}; } })
      .run({ code: 'await tools.hang({}); return 1;' }, { mount: 'chat', params: { chatId: 'c' }, sessionId: 's', signal: new AbortController().signal, progress: () => true });
    const r = JSON.parse((out as { raw: { content: { text: string }[] } }).raw.content[0]!.text) as { ok: boolean; error?: string };
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/time limit of 1 s/) });
    expect(cancelled).toBe(true);
  });

  it('an empty script is an error, not a run', async () => {
    const out = await runCodeTool(deps()).run({ code: '  ' }, { mount: 'chat', params: { chatId: 'c' }, sessionId: 's', signal: new AbortController().signal, progress: () => true });
    expect((out as { raw: { isError?: boolean } }).raw.isError).toBe(true);
  });
});

function configDeps(): ConfigDeps & { store: ConfigStore } {
  const store = new ConfigStore(tmp(), {});
  return { store, callerId: 'orch-1', userAsked: () => true, brain: {
    settings: () => store.get(), settingsSchema: () => store.schema(), settingsHistory: n => store.history(n),
    undoSetting: (id, by = 'user', origin) => store.undo(id, { by, ...origin }), requestSetting: (k, v, o) => store.request(k, v, o),
  } };
}

describe('the Code Mode setting and the Orchestrator', () => {
  it('is a protected boolean, off by default, with label and description', () => {
    const e = schema().find(x => x.key === 'codeMode');
    expect(e).toMatchObject({ type: 'boolean', default: false, protected: true, label: 'Code Mode' });
    expect(e?.description).toMatch(/run_code/);
    expect(DEFAULTS.codeMode).toBe(false);
  });
  it('the Orchestrator reads it, turns it on on the user\'s words (change log), and Annulla turns it off', async () => {
    const d = configDeps(), tool = configTool(d);
    const got = await tool.run({ action: 'get', area: 'setting', query: 'code mode' }) as { key: string; value: unknown }[];
    expect(got.find(x => x.key === 'codeMode')).toMatchObject({ value: false });
    const r = await tool.run({ action: 'set', area: 'setting', key: 'codeMode', value: true, reason: 'prova Code Mode' }) as { changed: string; changeId: string };
    expect(r.changed).toBe('codeMode');
    expect(d.store.get().codeMode).toBe(true);
    expect(d.store.history(1)[0]).toMatchObject({ by: 'agent', chatId: 'orch-1', key: 'codeMode' });
    await tool.run({ action: 'undo', area: 'setting', changeId: r.changeId });
    expect(d.store.get().codeMode).toBe(false);
  });
  it('another agent only proposes it', () => {
    const store = new ConfigStore(tmp(), {});
    expect('proposal' in store.request('codeMode', true, { by: 'agent', chatId: 'w' })).toBe(true);
    expect(store.get().codeMode).toBe(false);
  });
  it('the guide explains what it does and when it pays, with its state now', () => {
    const card = (on: boolean) => entries(null, { settings: { schema, get: () => ({ ...DEFAULTS, codeMode: on }) }, window: () => null, tools: () => [] } as never, 'it')
      .find(e => e.kind === 'concept' && e.title.startsWith('Code Mode'))!;
    expect(card(false).text).toMatch(/app_config area setting key codeMode/);
    expect(card(false).text).toMatch(/When it pays/);
    expect(card(false).text).toMatch(/Now: off\.$/);
    expect(card(true).text).toMatch(/Now: on\.$/);
  });
});
