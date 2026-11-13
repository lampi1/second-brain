// The «fatto» line the app writes to the brain journal for a role's result (#375, brain/journal-line.ts): its text, and
// the call to the brain's own mem.mjs `journal` through a temporary file (a fake runner: no process is started).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fattoText, writeFatto } from '../../../src/main/brain/journal-line';
import { memoryInstructions } from '../../../src/main/rules/new-brain';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-journal-')); dirs.push(d); return d; };
const node = { exe: 'node', env: {} };

describe('the journal «fatto» line', () => {
  it('names the role, the chat and the summary on one line; a partial result says so; a credential is masked', () => {
    expect(fattoText({ role: 'Artisan', title: 'Fix export', summary: 'Export fixed,\ntests green.', outcome: 'done' })).toBe('fatto · Artisan · Fix export: Export fixed, tests green.');
    expect(fattoText({ role: 'Scout', title: 'Bug', summary: 'Cause found', outcome: 'partial' })).toBe('fatto (in parte) · Scout · Bug: Cause found');
    const token = ['ghp', 'Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7c'].join('_'); // built at run time: no secret-shaped text in the repo
    expect(fattoText({ role: 'Scout', title: 'x', summary: `token ${token}`, outcome: 'done' })).not.toContain(token);
    expect(fattoText({ role: 'R', title: 't', summary: 'a'.repeat(1000), outcome: 'done' }).length).toBeLessThanOrEqual(400);
    // a cut by code point: an emoji on the edge is kept whole or left out, never split
    const cutLine = fattoText({ role: 'R', title: 't', summary: '😀'.repeat(500), outcome: 'done' });
    expect(cutLine).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  it('goes through mem.mjs journal with a temporary file, removed after; a refusal or a missing tool throws', async () => {
    const root = tmp(), ud = tmp(), tool = path.join(root, 'mem.mjs');
    fs.writeFileSync(tool, '');
    const calls: { args: string[]; text: string }[] = [];
    const run = async (_n: unknown, _s: string, args: string[]) => { calls.push({ args, text: fs.readFileSync(args[2]!, 'utf8') }); return { stdout: 'appended', stderr: '', code: 0 }; };
    await writeFatto({ tool, root, userData: ud, node, run }, { role: 'Artisan', title: 'T', summary: 'S', outcome: 'done' });
    expect(calls).toEqual([{ args: ['journal', '--file', expect.any(String)], text: 'fatto · Artisan · T: S\n' }]);
    expect(fs.readdirSync(path.join(ud, 'journal-lines'))).toEqual([]);
    const refuse = async () => ({ stdout: '', stderr: 'mem: one line only', code: 1 });
    await expect(writeFatto({ tool, root, userData: ud, node, run: refuse }, { role: 'A', title: 'T', summary: 'S', outcome: 'done' })).rejects.toThrow(/one line only/);
    await expect(writeFatto({ tool: null, root, userData: ud, node, run }, { role: 'A', title: 'T', summary: 'S', outcome: 'done' })).rejects.toThrow(/mem\.mjs/);
  });

  it('the roles get the journal command for their own lines', () => {
    const text = memoryInstructions('/rt', '/brain', '/tools');
    expect(text).toContain('node "/tools/ops/tools/mem.mjs" journal --text "attrito|decisione|lezione · what happened and why"');
    expect(memoryInstructions('/rt', '/brain')).toContain('node "/brain/ops/tools/mem.mjs" journal');
  });
});
