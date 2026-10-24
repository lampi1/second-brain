// The routine command executor (ADR 0154): the exact command from a brain script/query pinned by hash, params and
// attachments filled in, refused when the file changed or an argument could reach cmd; `resolve` spawns nothing (the
// dry run), `execute` launches without a shell and rechecks the hash; attachments are content-addressed and checked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FlowRun, FlowStep } from '../../../src/shared/flows';
import { attachmentFile, contentHash, execute, resolve, saveAttachment, sha256 } from '../../../src/main/flows/executor';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function brain(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-')); dirs.push(root);
  for (const [file, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), body); }
  return { root, attachments: path.join(root, 'att'), work: path.join(root, 'work') };
}
const step = (kind: 'script' | 'query', ref: string, hash: string, extra: Partial<FlowStep> = {}): FlowStep => ({ id: 's', title: 's', kind: 'check', instructions: 'run', inputs: [], evidence: [], timeoutMs: 10000, maxAttempts: 1, effect: 'read-only', action: { kind, ref, hash }, ...extra });
const run = (inputs: Record<string, string> = {}, attachments: FlowRun['attachments'] = []): FlowRun => ({ id: 'r', revision: 1, flowId: 'f', flowVersion: 1, definitionDigest: '', ownerOrchestratorId: 'app', subjectKey: 'k', scope: {}, inputs, status: 'active', currentStep: 0, steps: [], createdAt: 0, updatedAt: 0, attachments });
const SCRIPT = 'console.log(JSON.stringify(process.argv.slice(2)))\n';

describe('routine executor', () => {
  it('fills params and attachments, and executes without a shell', async () => {
    const b = brain({ 'scripts/echo.js': SCRIPT }), att = saveAttachment(b.attachments, 'list.txt', 'a\nb\n');
    expect(att).toMatchObject({ name: 'list.txt', lines: 2, sha256: sha256('a\nb\n') });
    const resolved = resolve(b.root, step('script', 'echo.js', sha256(SCRIPT), { args: { From: '{{from}}', List: '{{attachment:list.txt}}', Odd: '$(whoami); rm -rf /' } }), run({ from: 'Team Air' }, [att]), b.attachments, b.work);
    expect(resolved.problems).toEqual([]);
    expect(resolved.program).toBe('node'); expect(resolved.command).toContain('--From "Team Air"');
    const result = await execute(resolved, { cwd: b.root, timeoutMs: 10000 });
    expect(result.exitCode).toBe(0);
    // the shell-looking value reaches the script as one plain argument
    expect(JSON.parse(result.output)).toEqual(['--From', 'Team Air', '--List', attachmentFile(b.attachments, att), '--Odd', '$(whoami); rm -rf /']);
  });
  it('refuses a changed or missing file, a missing value and a language without a runner', () => {
    const b = brain({ 'scripts/echo.js': SCRIPT, 'scripts/run.exe': 'x' });
    expect(resolve(b.root, step('script', 'echo.js', 'f'.repeat(64)), run(), b.attachments, b.work).problems).toEqual(["echo.js è cambiato dopo l'approvazione: serve il tuo ok sul nuovo contenuto"]);
    expect(resolve(b.root, step('script', 'gone.js', 'f'.repeat(64)), run(), b.attachments, b.work).problems).toEqual(['gone.js non esiste più nel brain']);
    expect(resolve(b.root, step('script', 'echo.js', sha256(SCRIPT), { args: { A: '{{nope}}' } }), run(), b.attachments, b.work).problems).toEqual(['manca il valore di {{nope}}']);
    expect(resolve(b.root, step('script', 'run.exe', sha256('x')), run(), b.attachments, b.work).problems[0]).toMatch(/non si esegue da una routine/);
    expect(contentHash(b.root, 'script', '../scripts/echo.js')).toBe(sha256(SCRIPT));
    expect(contentHash(b.root, 'script', '../../etc/passwd')).toBeNull();
  });
  it('re-checks the hash right before launching', async () => {
    const b = brain({ 'scripts/echo.js': SCRIPT }), resolved = resolve(b.root, step('script', 'echo.js', sha256(SCRIPT)), run(), b.attachments, b.work);
    fs.appendFileSync(path.join(b.root, 'scripts', 'echo.js'), '// later\n');
    await expect(execute(resolved, { cwd: b.root, timeoutMs: 10000 })).rejects.toThrow(/cambiato prima dell'avvio/);
  });
  it('builds a read-only sqlcmd query with integrated auth and -v variables, from a .md query note', () => {
    const note = '# Check\n\n```sql\nSELECT * FROM t WHERE id = $(Id)\n```\n', b = brain({ 'queries/check.md': note });
    const resolved = resolve(b.root, step('query', 'check.md', sha256(note), { args: { server: 'test-sql', database: 'Air', Id: '{{id}}' } }), run({ id: '42' }), b.attachments, b.work);
    expect(resolved.problems).toEqual([]);
    expect(resolved.args).toEqual(['-S', 'test-sql', '-d', 'Air', '-E', '-b', '-K', 'ReadOnly', '-i', path.join(b.work, `${sha256(note)}.sql`), '-v', 'Id=42']);
    expect(fs.readFileSync(path.join(b.work, `${sha256(note)}.sql`), 'utf8')).toBe('SELECT * FROM t WHERE id = $(Id)');
    expect(resolve(b.root, step('query', 'check.md', sha256(note), { args: {} }), run(), b.attachments, b.work).problems).toEqual(["la query non ha l'argomento server", "la query non ha l'argomento database"]);
  });
  it('stores attachments by content and refuses a changed one, a bad name or one over 5 MB', () => {
    const b = brain({}), att = saveAttachment(b.attachments, 'licenze.csv', 'x;y\n');
    expect(saveAttachment(b.attachments, 'other.csv', 'x;y\n').sha256).toBe(att.sha256);
    fs.writeFileSync(path.join(b.attachments, att.sha256), 'tampered');
    expect(() => attachmentFile(b.attachments, att)).toThrow(/mancante o cambiato/);
    expect(() => saveAttachment(b.attachments, '../evil', 'x')).toThrow(/nome non valido/);
    expect(() => saveAttachment(b.attachments, 'big.txt', 'x'.repeat(5 * 1024 * 1024 + 1))).toThrow(/5 MB/);
  });
});
