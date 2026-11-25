// The fallback channel of a chat's app tools (ADR 0356, owner 2026-11-25: «canale di riserva uguale per tutti: un
// comando locale dell'app, legato alla chat, che chiama lo stesso strumento con gli stessi controlli»). An engine may
// leave one of the app's tools out of what its model sees (Antigravity drops the largest ones over its schema budget;
// a resumed or long session may never list them again): the chat then runs `sb-tool <tool> '<json>'` in its own shell.
// The command calls the same tool on the same per-chat MCP endpoint (its URL, with the chat's token, is in the
// session's environment as SB_CHAT_TOOLS), so the same checks run: the chat's own filter, the tool's own guards.
// Written by the app into <userData>/bin at start (installToolCli): a small CommonJS script run by the app's own
// executable as Node (ELECTRON_RUN_AS_NODE), with a POSIX shell wrapper and a Windows .cmd. Used by wiring.ts and
// chats/manager-sessions.ts (toolCliEnv); the script's argument reading is tested in test/unit/chats/tool-cli.test.ts.
import fs from 'node:fs';
import path from 'node:path';

export const TOOL_CLI = 'sb-tool';
export const TOOL_CLI_URL_ENV = 'SB_CHAT_TOOLS';

/** The script. `sb-tool list` lists the chat's tools; `sb-tool <tool> '<json>'`, `sb-tool <tool> --file args.json` or
 *  `sb-tool <tool> -` (arguments on stdin) calls one. Prints the tool's text; exit 1 on an error or a refusal. */
export const TOOL_CLI_SOURCE = String.raw`'use strict';
// second-brain fallback tool command (ADR 0356): calls one app tool on this chat's own MCP endpoint.
const fs = require('node:fs');
function parse(argv, readFile, stdin) {
  const [tool, ...rest] = argv;
  if (!tool || tool === '-h' || tool === '--help') return { help: true };
  if (tool === 'list') return { method: 'tools/list', params: {} };
  let raw = '{}';
  if (rest[0] === '--file') { if (!rest[1]) throw new Error('--file needs a path'); raw = readFile(rest[1]); }
  else if (rest[0] === '-') raw = stdin();
  else if (rest.length) raw = rest.join(' ');
  let args;
  try { args = JSON.parse(String(raw).replace(/^﻿/, '')); } catch (e) { throw new Error('the arguments are not valid JSON: ' + e.message); }
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('the arguments must be a JSON object');
  return { method: 'tools/call', params: { name: tool.replace(/^(?:mcp__?)?second-brain(?:__|_|:|-)/, ''), arguments: args } };
}
function render(method, reply) {
  if (reply.error) return { text: 'Error: ' + (reply.error.message || JSON.stringify(reply.error)), failed: true };
  const r = reply.result || {};
  if (method === 'tools/list') return { text: (r.tools || []).map(t => t.name).join('\n'), failed: false };
  const text = (r.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  return { text, failed: !!r.isError };
}
async function main() {
  const url = process.env.${TOOL_CLI_URL_ENV};
  const out = s => process.stdout.write(s + '\n'), err = s => process.stderr.write(s + '\n');
  let req;
  try { req = parse(process.argv.slice(2), f => fs.readFileSync(f, 'utf8'), () => fs.readFileSync(0, 'utf8')); }
  catch (e) { err('sb-tool: ' + e.message); process.exit(2); }
  if (req.help) { out("usage: sb-tool list | sb-tool <tool> '<json arguments>' | sb-tool <tool> --file args.json | sb-tool <tool> - (stdin)"); return; }
  if (!url) { err('sb-tool: no app endpoint for this chat (' + '${TOOL_CLI_URL_ENV}' + ' is not set): run it from the chat\'s own shell'); process.exit(2); }
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: req.method, params: req.params }) });
  if (!res.ok) { err('sb-tool: the app answered ' + res.status + ' (is the app open? is this the chat\'s own shell?)'); process.exit(1); }
  const shown = render(req.method, await res.json());
  (shown.failed ? err : out)(shown.text);
  if (shown.failed) process.exit(1);
}
if (require.main === module) main().catch(e => { process.stderr.write('sb-tool: ' + (e && e.message || e) + '\n'); process.exit(1); });
module.exports = { parse, render };
`;

/** Writes the command into `<userData>/bin` (the script and its two wrappers, run by `exe` as Node). Returns the folder,
 *  or null when it cannot be written (logged by the caller: chats then have no fallback). */
export function installToolCli(userData: string, exe: string = process.execPath): string | null {
  const dir = path.join(userData, 'bin');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const script = path.join(dir, `${TOOL_CLI}.cjs`);
    write(script, TOOL_CLI_SOURCE);
    write(path.join(dir, TOOL_CLI), `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${exe}" "${script}" "$@"\n`, 0o755);
    write(path.join(dir, `${TOOL_CLI}.cmd`), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" "${script}" %*\r\n`);
    return dir;
  } catch { return null; }
}

const write = (file: string, text: string, mode?: number): void => {
  const same = (() => { try { return fs.readFileSync(file, 'utf8') === text; } catch { return false; } })();
  if (!same) fs.writeFileSync(file, text, mode ? { mode } : {});
  if (mode) try { fs.chmodSync(file, mode); } catch { /* Windows */ }
};

/** The environment a chat's engine starts with so that its shell finds the command: the folder first on PATH (whatever
 *  the key's case, as Windows keeps «Path») and the chat's endpoint. Nothing when either is missing. */
export function toolCliEnv(base: Record<string, string | undefined>, dir: string | null, url: string | null): Record<string, string> {
  if (!dir || !url) return {};
  const key = Object.keys(base).find(k => k.toUpperCase() === 'PATH') ?? 'PATH';
  const now = base[key] ?? '';
  const parts = now.split(path.delimiter).filter(Boolean);
  return { [key]: parts.includes(dir) ? now : [dir, ...parts].join(path.delimiter), [TOOL_CLI_URL_ENV]: url };
}

/** The line that tells a chat how to reach a tool its engine did not give it (the tool check, the report reminder). */
export function toolCliHint(tools: readonly string[]): string {
  const one = tools[0] ?? 'agent_report';
  return `Se uno strumento dell'app (${tools.join(', ') || one}) non è tra i tuoi, usa il comando locale dell'app nella tua shell: \`${TOOL_CLI} ${one} '<argomenti JSON>'\` (oppure \`${TOOL_CLI} ${one} --file args.json\`; \`${TOOL_CLI} list\` elenca i tuoi strumenti). Chiama lo stesso strumento con gli stessi controlli.`;
}
