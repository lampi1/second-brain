// The brain's saved queries (ADR 0124): the note format round-trips (header fields, the query byte for byte, a fence
// inside the query), native .sql/.kql files show with their comment header, reads mask credentials, a delete goes
// through the ChangeLog and Annulla puts it back, and the chat tools find and add queries (add only, no credentials).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChangeLog } from '../../../src/main/brainmodel/changes';
import { BrainQueries, languageLabel, parseQueryNote, queryNote, touchesQueries } from '../../../src/main/brain/queries';
import { brainQueriesTool, chatQueryAddTool, findQueries } from '../../../src/main/brain/queries-tools';
import { writeDemoQueries } from '../../../src/main/brain/queries-demo';

let root: string, userData: string, log: ChangeLog, q: BrainQueries;
const write = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const toolCtx = { params: { chatId: 'c1' } } as never;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-queries-'));
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-queries-ud-'));
  log = new ChangeLog(userData);
  q = new BrainQueries(() => root, () => log);
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(userData, { recursive: true, force: true }); });

describe('query notes', () => {
  it('round-trips the header and keeps the query byte for byte, a fence inside it too', () => {
    const code = 'SELECT 1\r\n-- ```not a fence end\r\n```\r\nFROM t';
    const text = queryNote('SQL', code, { title: 'Uno', description: 'Prova.', source: 'db test', tags: ['a', 'b'], from: '`x.md`' });
    expect(text).toContain('- **Runs on:** db test');
    expect(text).toContain('````sql\n');
    expect(parseQueryNote(text)).toEqual({ title: 'Uno', description: 'Prova.', source: 'db test', tags: ['a', 'b'], from: '`x.md`', lang: 'sql', code });
  });
  it('labels the languages', () => {
    expect([languageLabel('kusto'), languageLabel('KQL'), languageLabel('postgresql'), languageLabel('spl'), languageLabel('weird')]).toEqual(['KQL', 'KQL', 'PostgreSQL', 'SPL', 'WEIRD']);
    expect(touchesQueries('queries\\a.md')).toBe(true);
    expect(touchesQueries('scripts/a.sql')).toBe(false);
  });
});

describe('BrainQueries', () => {
  it('lists notes and native files with their header, masks credentials on read', () => {
    writeDemoQueries(root, Date.parse('2026-10-22T08:00:00Z'));
    write('queries/costi.kql', '// @title Costi per giorno\n// @source ADX costi\n// @tags costi\n\nCosts | summarize sum(Amount) by bin(Day, 1d)\n');
    write('queries/plain.sql', '-- Tutti gli utenti\nSELECT * FROM users;\n');
    const fake = ['gh', 'p_', 'b'.repeat(36)].join('');
    write('queries/segreta.md', `# Con segreto\n\nTest.\n\n\`\`\`sql\nSELECT '${fake}' AS t;\nSELECT 2;\n\`\`\`\n`);
    write('queries/README.txt', 'not a query');
    const list = q.list();
    expect(list.queries.map(x => x.id)).toContain('clienti-attivi.md');
    expect(list.queries).toHaveLength(8);
    const kql = list.queries.find(x => x.id === 'costi.kql')!;
    expect(kql).toMatchObject({ title: 'Costi per giorno', source: 'ADX costi', tags: ['costi'], language: 'KQL', lang: 'kusto' });
    expect(q.get('costi.kql').code).toBe('Costs | summarize sum(Amount) by bin(Day, 1d)');
    expect(list.queries.find(x => x.id === 'plain.sql')).toMatchObject({ title: 'plain', description: 'Tutti gli utenti', language: 'SQL' });
    const demo = q.get('clienti-attivi.md');
    expect(demo).toMatchObject({ language: 'KQL', source: expect.stringContaining('Azure Data Explorer'), tags: ['clienti', 'report', 'settimanale'] });
    expect(demo.code.startsWith('Sessions\n| where Timestamp > ago(30d)')).toBe(true);
    const secret = q.get('segreta.md');
    expect(secret.masked).toBe(1);
    expect(secret.code).not.toContain(fake);
    expect(() => q.get('../brain.json')).toThrow();
  });

  it('deletes through the ChangeLog; Annulla puts the file back', () => {
    writeDemoQueries(root, Date.now());
    const before = fs.readFileSync(path.join(root, 'queries', 'login-falliti.md'), 'utf8');
    const r = q.delete('login-falliti.md');
    expect(r.file).toBe('queries/login-falliti.md');
    expect(fs.existsSync(path.join(root, 'queries', 'login-falliti.md'))).toBe(false);
    const change = log.all().find(c => c.id === r.changeId)!;
    expect(change).toMatchObject({ job: 'user', kind: 'memory', action: 'remove', target: 'queries/login-falliti.md' });
    log.rollback(r.changeId, { activeVersion: () => null, restore: () => {} });
    expect(fs.readFileSync(path.join(root, 'queries', 'login-falliti.md'), 'utf8')).toBe(before);
    expect(() => q.delete('nope.md')).toThrow(/non trovata/);
  });

  it('never reads through a symlinked queries/ folder', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-queries-out-'));
    try {
      fs.writeFileSync(path.join(outside, 'x.md'), '# X\n\n```sql\nSELECT 1;\n```\n');
      fs.symlinkSync(outside, path.join(root, 'queries'), 'dir');
      expect(q.list().queries).toEqual([]);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });
});

describe('the chat tools', () => {
  it('brain_query_add adds a new query note (add only, no credentials, logged); brain_queries finds it', async () => {
    const added: string[] = [];
    const changelog = { add: (e: { target: string }) => { added.push(e.target); return e; } } as never;
    const qs = new BrainQueries(() => root, () => log, changelog);
    const add = chatQueryAddTool(qs, () => 'Scout · report');
    const args = { name: 'ordini-aperti', language: 'sql', title: 'Ordini aperti', description: 'Gli ordini ancora aperti.', runsOn: 'Postgres ordini', tags: ['ordini'], code: 'SELECT id FROM ordini\nWHERE stato = \'aperto\';' };
    const r = JSON.parse(await add.run(args, toolCtx) as string) as { file: string };
    expect(r.file).toBe('queries/ordini-aperti.md');
    expect(added).toEqual(['queries/ordini-aperti.md']);
    const saved = qs.get('ordini-aperti.md');
    expect(saved).toMatchObject({ title: 'Ordini aperti', source: 'Postgres ordini', code: args.code });
    expect(saved.from).toContain('Scout · report');
    expect(() => add.run(args, toolCtx)).toThrow(/exists already/);
    const fake = ['gh', 'p_', 'c'.repeat(36)].join('');
    expect(() => add.run({ ...args, name: 'x', code: `SELECT '${fake}';` }, toolCtx)).toThrow(/credential/);
    const found = JSON.parse(await brainQueriesTool(qs).run({ q: 'ordini postgres' }, toolCtx) as string) as { total: number; queries: { title: string; runsOn: string }[] };
    expect(found.total).toBe(1);
    expect(found.queries[0]).toMatchObject({ title: 'Ordini aperti', runsOn: 'Postgres ordini' });
    expect(findQueries(qs.list().queries, 'kusto')).toEqual([]);
  });
});
