// Issue #93: a role limited to read-only commands (shell-read) runs the brain's declared read-only node tools
// (read-only-tools.md, agents/read-tools.ts) by their exact real path, and nothing else run by node; the list itself
// is the user's: a role's edit of it is refused by the role gate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { READ_TOOLS_FILE, lineScript, readOnlyTools } from '../../../src/main/agents/read-tools';
import { readOnlyCommand, shellWithin } from '../../../src/main/agents/tool-policy';
import { gateRequest, isReadToolsList } from '../../../src/main/agents/role-gate';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
function brain() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-readtools-'))); roots.push(root);
  fs.mkdirSync(path.join(root, 'tools'));
  for (const f of ['my-tasks.mjs', 'azure-status.mjs', 'evil.mjs']) fs.writeFileSync(path.join(root, 'tools', f), 'console.log(1)\n');
  fs.writeFileSync(path.join(root, READ_TOOLS_FILE), ['# Strumenti di sola lettura', '', '- `tools/my-tasks.mjs`: i miei work item', '- tools/azure-status.mjs — stato di Azure',
    '- tools/example-app-health.mjs: non ancora scritto', '- note senza script', ''].join('\n'));
  return root;
}

describe('declared read-only tools', () => {
  it('reads the list: existing scripts by real path, a missing one left out', () => {
    const root = brain(), paths = readOnlyTools(root);
    expect(paths).toEqual([path.join(root, 'tools', 'my-tasks.mjs'), path.join(root, 'tools', 'azure-status.mjs')]);
    expect(readOnlyTools(null)).toEqual([]);
    expect(readOnlyTools(path.join(root, 'nowhere'))).toEqual([]);
    expect(lineScript('- `node tools/x.mjs`: y')).toBe('tools/x.mjs');
    expect(lineScript('1. tools/x.cjs')).toBe('tools/x.cjs');
    expect(lineScript('- tools/x.sh')).toBeNull();
    expect(lineScript('# tools/x.mjs')).toBeNull();
  });

  it('node runs a declared tool by its exact path; any other node use stays refused', () => {
    const root = brain(), scripts = { cwd: root, paths: readOnlyTools(root) };
    const ok = (c: string, s = scripts) => readOnlyCommand(c, s);
    expect(ok('node tools/my-tasks.mjs')).toBe(true);
    expect(ok('node ./tools/azure-status.mjs --json')).toBe(true);
    expect(ok('node.exe tools/my-tasks.mjs 24')).toBe(true);
    expect(ok('node tools/my-tasks.mjs | head -5')).toBe(true);
    // an absolute path with forward slashes (the parser drops backslashes, so a Windows path written with them stays
    // refused: fail closed)
    expect(ok(`node ${path.join(root, 'tools', 'my-tasks.mjs').replace(/\\/g, '/')}`, { ...scripts, cwd: os.tmpdir() })).toBe(true);
    expect(ok('node tools/example-app-health.mjs 24')).toBe(false); // declared, missing
    expect(ok('node tools/evil.mjs')).toBe(false); // not declared
    expect(ok('node tools/my-tasks.mjs', { ...scripts, cwd: os.tmpdir() })).toBe(false); // another file from another folder
    expect(ok('node -e "require(1)" tools/my-tasks.mjs')).toBe(false);
    expect(ok('node --require ./tools/evil.mjs tools/my-tasks.mjs')).toBe(false);
    expect(ok('node tools/*.mjs')).toBe(false);
    expect(ok('node tools/my-tasks.mjs; rm -rf x')).toBe(false);
    expect(ok('node tools/my-tasks.mjs > out.txt')).toBe(false);
    expect(ok('node tools/my-tasks.mjs --output=x')).toBe(false);
    expect(ok('node')).toBe(false);
    expect(readOnlyCommand('node tools/my-tasks.mjs')).toBe(false); // no list given: as before
    // through a link to the declared file: the same file
    fs.symlinkSync(path.join(root, 'tools', 'my-tasks.mjs'), path.join(root, 'tools', 'alias.mjs'));
    expect(ok('node tools/alias.mjs')).toBe(true);
    // under a parent limited to read-only commands (the role gate's check)
    const parent = { tools: { allow: ['read' as const, 'shell-read' as const] }, ceiling: null };
    expect(shellWithin(parent, 'Bash', { command: 'node tools/my-tasks.mjs' }, scripts)).toBe(true);
    expect(shellWithin(parent, 'Bash', { command: 'node tools/evil.mjs' }, scripts)).toBe(false);
  });

  it('the list is the user\'s: a role\'s edit of it is refused, another brain file is not', () => {
    const root = brain(), file = path.join(root, READ_TOOLS_FILE);
    expect(isReadToolsList(root, file)).toBe(true);
    expect(isReadToolsList(root, path.join(root, 'tools', 'my-tasks.mjs'))).toBe(false);
    const chat = { role: { id: 'artisan', name: 'Artisan' }, skills: [], brainRoot: root, policy: null };
    const v = gateRequest({ type: 'permission', tool: 'Write', input: { file_path: file } }, chat);
    expect(v).toMatchObject({ kind: 'deny', code: 'readToolsList' });
    expect(gateRequest({ type: 'permission', tool: 'Edit', input: { file_path: path.join(root, 'now.md') } }, chat).kind).toBe('pass');
    // a plain chat (the user's own) is never gated
    expect(gateRequest({ type: 'permission', tool: 'Write', input: { file_path: file } }, { skills: [], brainRoot: root }).kind).toBe('pass');
  });
});
