// Code Mode's parts (ADR 0331): who gets it (code-mode/policy.ts), the thin native wrappers over a temp folder with a
// fake spawn (code-mode/natives.ts: no real process), the bridge's tool list and output values (code-mode/bridge.ts),
// run_code's schema per chat (code-mode/tool.ts), and the setting the Orchestrator reads and changes (app_config area
// setting, its change log and Annulla) and the guide's card about it.
import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codeModeFor, gateName } from '../../../src/main/code-mode/policy';
import { globRegExp, runNative, type Spawn } from '../../../src/main/code-mode/natives';
import { catalog, outputValue, type BridgeDeps } from '../../../src/main/code-mode/bridge';
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

function fakeSpawn(seen: { cmd: string; args: string[]; cwd?: string }[], code = 0, out = 'hi\n', err = ''): Spawn {
  return (cmd, args, opts) => {
    seen.push({ cmd, args, ...(typeof opts.cwd === 'string' ? { cwd: opts.cwd } : {}) });
    const stdout = new EventEmitter(), stderr = new EventEmitter(), child = new EventEmitter() as EventEmitter & { stdout: unknown; stderr: unknown; kill: () => void };
    child.stdout = stdout; child.stderr = stderr; child.kill = () => {};
    queueMicrotask(() => { stdout.emit('data', out); if (err) stderr.emit('data', err); child.emit('close', code); });
    return child as never;
  };
}

describe('the native wrappers', () => {
  it('Bash runs the command with the shell in the chat\'s folder and returns exit code and output', async () => {
    const cwd = tmp(), seen: { cmd: string; args: string[]; cwd?: string }[] = [];
    expect(await runNative('Bash', { command: 'echo hi' }, { cwd, shell: '/bin/bash', spawn: fakeSpawn(seen) })).toEqual({ exitCode: 0, stdout: 'hi\n', stderr: '' });
    expect(seen).toEqual([{ cmd: '/bin/bash', args: ['-c', 'echo hi'], cwd }]);
    expect(await runNative('Bash', { command: 'false' }, { cwd, shell: '/bin/bash', spawn: fakeSpawn([], 2, '', 'no') })).toMatchObject({ exitCode: 2, stderr: 'no' });
    await expect(runNative('Bash', { command: 'ls' }, { cwd, shell: null })).rejects.toThrow(/Git Bash not found/);
    await expect(runNative('Bash', {}, { cwd, shell: '/bin/bash', spawn: fakeSpawn([]) })).rejects.toThrow(/command is required/);
  });

  it('Write, Read, Edit over the chat\'s folder', async () => {
    const cwd = tmp();
    await runNative('Write', { file_path: 'sub/a.txt', content: 'uno\ndue\ndue\n' }, { cwd });
    expect(await runNative('Read', { file_path: 'sub/a.txt' }, { cwd })).toBe('1\tuno\n2\tdue\n3\tdue\n4\t');
    expect(await runNative('Read', { file_path: 'sub/a.txt', offset: 2, limit: 1 }, { cwd })).toBe('2\tdue');
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
    const files = String(await runNative('Grep', { pattern: 'foo' }, { cwd })).split('\n').map(f => path.relative(cwd, f).replace(/\\/g, '/')).sort();
    expect(files).toEqual(['src/a.ts', 'src/b.md']);
    expect(String(await runNative('Grep', { pattern: 'foo', glob: '*.ts', output_mode: 'content' }, { cwd }))).toMatch(/a\.ts:2:foo\(\)$/);
    expect(String(await runNative('Grep', { pattern: 'FOO', '-i': true, output_mode: 'count' }, { cwd })).split('\n')).toHaveLength(2);
    const ts = (await runNative('Glob', { pattern: '**/*.ts' }, { cwd }) as string[]).map(f => path.relative(cwd, f).replace(/\\/g, '/'));
    expect(ts).toEqual(['src/a.ts']);
    expect(globRegExp('src/*.{ts,md}').test('src/b.md')).toBe(true);
    expect(globRegExp('*.ts').test('deep/x/y.ts')).toBe(true);
  });
});

const appTool = (name: string, out: unknown): McpTool => ({ name, description: `${name} tool`, inputSchema: { type: 'object' }, run: async () => out as never });
const deps = (over: Partial<BridgeDeps> = {}): BridgeDeps => ({
  decideFor: async () => ({ kind: 'allow' }), row: () => {}, cwd: () => null,
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
