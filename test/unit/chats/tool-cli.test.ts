// The fallback command of a chat's app tools (chats/tool-cli.ts, ADR 0356): the script the app writes reads its
// arguments as the tool call, prints the tool's text, and the chat's engine finds it on PATH with its endpoint.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { installToolCli, toolCliEnv, toolCliHint, TOOL_CLI, TOOL_CLI_URL_ENV } from '../../../src/main/chats/tool-cli';

const roots: string[] = [];
afterEach(() => { for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const install = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-toolcli-')); roots.push(d); return { d, bin: installToolCli(d, '/app/exe')! }; };
type Cli = { parse: (argv: string[], readFile: (f: string) => string, stdin: () => string) => unknown; render: (method: string, reply: unknown) => { text: string; failed: boolean } };

describe('sb-tool', () => {
  it('writes the script and both wrappers, run by the app\'s executable as Node', () => {
    const { bin } = install();
    expect(fs.readFileSync(path.join(bin, TOOL_CLI), 'utf8')).toContain('ELECTRON_RUN_AS_NODE=1 exec "/app/exe"');
    expect(fs.readFileSync(path.join(bin, `${TOOL_CLI}.cmd`), 'utf8')).toContain('set ELECTRON_RUN_AS_NODE=1');
    if (process.platform !== 'win32') expect(fs.statSync(path.join(bin, TOOL_CLI)).mode & 0o111).not.toBe(0);
  });
  it('reads a tool call from an argument, a file or stdin, and strips an engine prefix', () => {
    const { d, bin } = install();
    const cli = createRequire(import.meta.url)(path.join(bin, `${TOOL_CLI}.cjs`)) as Cli;
    const file = path.join(d, 'a.json'); fs.writeFileSync(file, '﻿{"outcome":"done"}');
    const read = (f: string) => fs.readFileSync(f, 'utf8');
    expect(cli.parse(['agent_report', '{"outcome":"done","summary":"s"}'], read, () => '')).toEqual({ method: 'tools/call', params: { name: 'agent_report', arguments: { outcome: 'done', summary: 's' } } });
    expect(cli.parse(['mcp__second-brain__agent_report', '--file', file], read, () => '')).toEqual({ method: 'tools/call', params: { name: 'agent_report', arguments: { outcome: 'done' } } });
    expect(cli.parse(['plan_propose', '-'], read, () => '{"steps":[]}')).toMatchObject({ params: { name: 'plan_propose', arguments: { steps: [] } } });
    expect(cli.parse(['list'], read, () => '')).toEqual({ method: 'tools/list', params: {} });
    expect(() => cli.parse(['x', '{rotto'], read, () => '')).toThrow(/not valid JSON/);
    expect(() => cli.parse(['x', '[1]'], read, () => '')).toThrow(/JSON object/);
  });
  it('prints the tool\'s text; a refusal or an error fails', () => {
    const { bin } = install();
    const cli = createRequire(import.meta.url)(path.join(bin, `${TOOL_CLI}.cjs`)) as Cli;
    expect(cli.render('tools/call', { result: { content: [{ type: 'text', text: '{"reported":true}' }] } })).toEqual({ text: '{"reported":true}', failed: false });
    expect(cli.render('tools/call', { result: { isError: true, content: [{ type: 'text', text: 'no' }] } })).toEqual({ text: 'no', failed: true });
    expect(cli.render('tools/list', { result: { tools: [{ name: 'a' }, { name: 'b' }] } }).text).toBe('a\nb');
    expect(cli.render('tools/call', { error: { message: 'boom' } })).toEqual({ text: 'Error: boom', failed: true });
  });
  it('the chat\'s environment: the folder first on PATH (Windows «Path» too) and its endpoint', () => {
    const env = toolCliEnv({ Path: `a${path.delimiter}b` }, '/bin/sb', 'http://x/mcp/chat/c/t');
    expect(env).toEqual({ Path: ['/bin/sb', 'a', 'b'].join(path.delimiter), [TOOL_CLI_URL_ENV]: 'http://x/mcp/chat/c/t' });
    expect(toolCliEnv({ PATH: '/bin/sb' }, '/bin/sb', 'u').PATH).toBe('/bin/sb');
    expect(toolCliEnv({}, null, 'u')).toEqual({});
    expect(toolCliHint(['agent_report'])).toContain("sb-tool agent_report '<argomenti JSON>'");
  });
});
