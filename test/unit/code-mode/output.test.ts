// Code Mode's batching and output fixes (ADR 0331, 2026-11-22 audit): the run_code result as plain text with only the
// failed calls, the value cut to its limit with a structural shrink that keeps valid JSON, the nudge after three
// single-call scripts, the typed TypeScript API of the tools (Cloudflare's Code Mode), the required-input check before
// any panel, the PowerShell wrapper (an encoded script: $_ survives) and Grep's (?i). Fake spawn and temp folders only.
import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { powershellArgs, runNative, type Spawn } from '../../../src/main/code-mode/natives';
import { fsOp } from '../../../src/main/code-mode/fs-ops';
import type { FsRunner } from '../../../src/main/code-mode/fs-run';
import { bridge, catalog, type BridgeDeps } from '../../../src/main/code-mode/bridge';
import { NUDGE_AFTER, resultText, runCodeTool, shrinkValue, VALUE_MAX } from '../../../src/main/code-mode/tool';
import { declarations, missingRequired, schemaType, toolSignature } from '../../../src/main/code-mode/types';
import type { SandboxResult } from '../../../src/main/code-mode/sandbox';
import type { McpTool } from '../../../src/main/mcp/server';

const dirs: string[] = [];
const tmp = (): string => { const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cmo-'))); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const res = (over: Partial<SandboxResult>): SandboxResult => ({ ok: true, logs: '', calls: 0, cpuMs: 1, ...over });
const ctx = () => ({ mount: 'chat' as const, params: { chatId: 'c' }, sessionId: 's', signal: new AbortController().signal, progress: () => true });
const text = (o: unknown): string => (o as { raw: { content: { text: string }[] } }).raw.content[0]!.text;

const typed: McpTool = { name: 'navigate', description: 'Opens a page in a tab. More words here.', run: async () => 'ok',
  inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' }, tab: { type: 'number' }, mode: { enum: ['a', 'b'] }, tags: { type: 'array', items: { type: 'string' } } } } };
const deps = (over: Partial<BridgeDeps> = {}): BridgeDeps => ({
  decideFor: async () => ({ kind: 'allow' }), row: () => {}, context: () => ({ error: 'no folder' }),
  appTools: () => [typed], extServers: () => ['outlook'], extTools: async () => [], ...over,
});

describe('the run_code result the model reads', () => {
  it('a string value is plain text, an object is JSON, and only the failed calls are listed', () => {
    const calls = [{ tool: 'Read', decision: 'allowed', ok: true }, { tool: 'Bash', decision: 'denied', ok: false }];
    expect(resultText(res({ value: 'line 1\nline 2' }), calls)).toBe('line 1\nline 2\n\n[failed calls] Bash (denied)');
    expect(resultText(res({ value: { a: 1 } }), [calls[0]!])).toBe('{\n "a": 1\n}');
    expect(resultText(res({ ok: false, error: 'boom', logs: 'seen' }), [])).toBe('Error: boom\n\n[console]\nseen');
  });

  it('a value over the limit is cut, with the hint to filter inside the script', () => {
    const out = resultText(res({ value: 'x'.repeat(VALUE_MAX * 2) }), []);
    expect(out.length).toBeLessThan(VALUE_MAX + 300);
    expect(out).toMatch(/more characters of the value cut: filter inside the script/);
  });

  it('the structural shrink keeps the shape and valid JSON, with markers where it cut', () => {
    const big = { files: Array.from({ length: 500 }, (_, i) => ({ name: `f${i}.ts`, body: 'y'.repeat(200) })), note: 'small' };
    const { value, cut } = shrinkValue(big, 4_000);
    expect(cut).toBe(true);
    const json = JSON.stringify(value);
    expect(json.length).toBeLessThanOrEqual(4_000);
    const back = JSON.parse(json) as { files: unknown[]; note: string };
    expect(back.note).toBe('small');
    expect(JSON.stringify(back.files)).toMatch(/more (items|characters)/);
    expect(shrinkValue({ a: 1 }, 100)).toEqual({ value: { a: 1 }, cut: false });
  });

  it('three scripts in a row with one call each get the batching hint, then the count starts again', async () => {
    const tool = runCodeTool({ ...deps(), progressEveryMs: 1e9 });
    const one = async (): Promise<string> => text(await tool.run({ code: 'return await tools.navigate({ url: "x" });' }, ctx()));
    for (let i = 1; i < NUDGE_AFTER; i++) expect(await one()).toBe('ok');
    expect(await one()).toMatch(/^ok\n\n\[hint\] Your last 3 scripts made at most one tool call each/);
    expect(await one()).toBe('ok');
    // a batched script resets it
    expect(text(await tool.run({ code: 'return (await Promise.all([tools.navigate({ url: "a" }), tools.navigate({ url: "b" })])).join();' }, ctx()))).toBe('ok,ok');
  });
});

describe('the tools as a typed TypeScript API', () => {
  it('a JSON schema becomes a one-line type', () => {
    expect(schemaType(typed.inputSchema)).toBe('{ url: string; tab?: number; mode?: "a" | "b"; tags?: string[] }');
    expect(schemaType({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toBe('string | null');
    expect(schemaType({ type: 'object', properties: { a: { type: 'object', properties: { b: { type: 'object', properties: { c: { type: 'string' } } } } } } })).toMatch(/b\?: object/);
  });

  it('the declarations name every native and app tool with its doc line and signature, connectors through list_tools', () => {
    const d = declarations(['Bash', 'PowerShell'], [typed], 'c', ['outlook']);
    expect(d).toMatch(/^declare const tools: \{/);
    expect(d).toMatch(/PowerShell: \(input: \{ command: string;/);
    expect(d).toContain('/** Opens a page in a tab. */\n  navigate: (input: { url: string; tab?: number; mode?: "a" | "b"; tags?: string[] }) => Promise<string>;');
    expect(d).toMatch(/servers: outlook/);
    expect(toolSignature(typed, 'c')).toMatch(/^\(input: \{ url: string/);
  });

  it('a call without a required input fails before any permission panel, with the signature', async () => {
    let asked = 0;
    const d = deps({ decideFor: async () => { asked++; return { kind: 'allow' }; } });
    const b = bridge(d, 'c', await catalog(d, 'c'), { signal: new AbortController().signal, progress: () => true, sessionId: 's' });
    expect(missingRequired(typed, 'c', { tab: 1 })).toEqual(['url']);
    await expect(b.call('navigate', { tab: 1 })).rejects.toThrow(/navigate: missing required input url; its signature: \(input: \{ url: string/);
    expect(asked).toBe(0);
    await expect(b.call('navigate', { url: 'x' })).resolves.toBe('ok');
    expect(asked).toBe(1);
  });
});

function fakeSpawn(seen: { cmd: string; args: string[] }[]): Spawn {
  return ((cmd: string, args: string[], _o: SpawnOptions) => {
    seen.push({ cmd, args });
    const stdout = new EventEmitter(), stderr = new EventEmitter(), child = new EventEmitter() as EventEmitter & { stdout: unknown; stderr: unknown; kill: () => void };
    child.stdout = stdout; child.stderr = stderr; child.kill = () => {};
    queueMicrotask(() => { stdout.emit('data', 'done\n'); child.emit('close', 0); });
    return child as never;
  }) as unknown as Spawn;
}

describe('the PowerShell wrapper', () => {
  it('the script goes as -EncodedCommand: $_ and quotes reach PowerShell untouched', () => {
    const cmd = 'Get-ChildItem | Where-Object { $_.Name -like "*.ts" } | ForEach-Object { "$($_.Length)" }';
    const { args, file } = powershellArgs(cmd, () => { throw new Error('no file for a short script'); });
    expect(file).toBeUndefined();
    expect(args.slice(0, 5)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass']);
    expect(args[5]).toBe('-EncodedCommand');
    const decoded = Buffer.from(args[6]!, 'base64').toString('utf16le');
    expect(decoded.endsWith(cmd)).toBe(true);
    expect(decoded).toMatch(/OutputEncoding = \[System\.Text\.Encoding\]::UTF8/);
  });

  it('a script too long for a command line goes as a temporary .ps1 with a BOM', () => {
    const f = path.join(tmp(), 'long.ps1');
    const cmd = '$x = 1; '.repeat(3_000) + '$_';
    const { args, file } = powershellArgs(cmd, () => f);
    expect(file).toBe(f);
    expect(args.slice(-2)).toEqual(['-File', f]);
    const body = fs.readFileSync(f, 'utf8');
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body.endsWith(cmd)).toBe(true);
  });

  it('runNative runs PowerShell with its own executable, not Git Bash, and gives the exit code', async () => {
    const seen: { cmd: string; args: string[] }[] = [];
    const out = await runNative('PowerShell', { command: 'Write-Output $env:PATH' }, { cwd: tmp(), shell: '/bin/bash', psShell: 'pwsh', spawn: fakeSpawn(seen) });
    expect(out).toEqual({ exitCode: 0, stdout: 'done\n', stderr: '' });
    expect(seen[0]!.cmd).toBe('pwsh');
    expect(seen[0]!.args).toContain('-EncodedCommand');
    await expect(runNative('PowerShell', { command: 'x' }, { cwd: tmp(), psShell: null })).rejects.toThrow(/PowerShell not found/);
    await expect(runNative('PowerShell', {}, { cwd: tmp(), psShell: 'pwsh', spawn: fakeSpawn([]) })).rejects.toThrow(/command is required/);
  });
});

describe('Grep and its flags', () => {
  const direct: FsRunner = async req => fsOp(req);
  it('a leading (?i) becomes ignore-case, "-i" works, and a bad regex explains what Grep takes', async () => {
    const cwd = tmp();
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'Needle here\n');
    const env = { cwd, fsRun: direct };
    expect(String(await runNative('Grep', { pattern: '(?i)needle' }, env))).toContain('a.txt');
    expect(String(await runNative('Grep', { pattern: 'needle', '-i': true }, env))).toContain('a.txt');
    expect(String(await runNative('Grep', { pattern: 'needle' }, env))).not.toContain('a.txt');
    await expect(runNative('Grep', { pattern: '(?s)a(' }, env)).rejects.toThrow(/"-i": true/);
  });
});
