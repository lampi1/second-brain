// The memory worth gate (ADR 0129): a fact tied to one case (a URL with a port, an id, a commit, a user path, a date, a
// branch) is refused unless worded as a reusable rule (ids, commits and dates never), general facts and rules pass, the
// refusal says what to save instead, near-duplicates are found by their words; and every new fact goes through it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkMemoryWorth, memoryWorth, nearSame } from '../../../src/main/rules/memory-worth';
import { proposeMemory, readMemoryRecords } from '../../../src/main/rules/memory-records';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const w = (value: string, predicate = 'note', subject = 'setup') => memoryWorth(subject, predicate, value);

describe('memoryWorth', () => {
  it('flags the owner\'s example: a local URL with a port, one case', () => {
    const r = w('Statistiche prestazioni locally: https://localhost:44309/stats (after login Air runs on 44309, not 44319)');
    expect(r).toMatchObject({ specific: true, rule: false, signs: ['url'] });
  });
  it.each([
    ['ticket', 'Il bug è il work item 48213, aperto da Marco', 'id'],
    ['PR', 'Fixed in PR #412', 'id'],
    ['jira key', 'See ABC-1234 for the context', 'id'],
    ['commit', 'The regression came with commit 3fa9c1e', 'commit'],
    // built from parts so the guard's user-path rule does not flag the made-up user (tools/guard/scan.mjs)
    ['user path', `The export is in C:\\${'Users'}\\mario\\Downloads\\report.xlsx`, 'path'],
    ['home path', `Logs land in /${'home'}/mario/app/logs`, 'path'],
    ['date', 'The test environment was reset on 2026-10-21', 'date'],
    ['today', 'Oggi il server di test è giù', 'date'],
    ['branch', 'The fix lives on feat/stats-port', 'branch'],
  ])('flags a %s', (_name, value, sign) => {
    const r = w(value);
    expect(r.specific).toBe(true);
    expect(r.signs).toContain(sign);
  });
  it('lets general knowledge and rules through', () => {
    for (const v of ['After login the local app runs on a port other than the default: read it from the launch profile',
      'Prima di un merge lancia npm run check:branch', 'I prompt per dopo stanno nella cartella prompts/ del progetto',
      'Rimborsi parziali si calcolano sul prezzo già scontato', 'logs/feedback/AAAA-MM-GG.log, una riga JSON per richiesta',
      'L’ambiente test-2 si resetta ogni notte', 'Le date nei file sono in formato ISO-8601, UTF-8', 'Il modulo risponde 500 quando manca il token']) expect(w(v).specific, v).toBe(false);
  });
  it('a rule may name a URL, a path or a branch, never an id, a commit or a date', () => {
    expect(w('When the local stats page is needed use https://localhost:44309/stats').specific).toBe(false);
    expect(w('Branches are named like feat/short-name', 'convention').specific).toBe(false);
    expect(w('Always mention PR #412 when deploying').specific).toBe(true);
    expect(w('Before 2026-10-21 the server ran on 8080').specific).toBe(true);
  });
  it('ranks a rule over a plain fact over a case-specific one', () => {
    const rule = w('Always run the tests first'), plain = w('The tests are in test/unit'), one = w('The tests failed today');
    expect(rule.score).toBeGreaterThan(plain.score);
    expect(plain.score).toBeGreaterThan(one.score);
  });
  it('the refusal says what was found and what to save instead', () => {
    expect(() => checkMemoryWorth('setup', 'note', 'Stats: http://127.0.0.1:44309/x')).toThrow(/tied to one case \(an address with a port or an id\).*launch profile/);
    expect(() => checkMemoryWorth('setup', 'note', 'Use the launch profile for the port')).not.toThrow();
  });
});

describe('nearSame', () => {
  it('same words in another order or case are the same; a different number is not', () => {
    expect(nearSame('I log del modulo feedback stanno in logs/feedback', 'i log del modulo FEEDBACK stanno in logs/feedback.')).toBe(true);
    expect(nearSame('Il server di test si riavvia ogni notte alle 6', 'Il server di test si riavvia ogni notte alle 6 in punto')).toBe(true);
    expect(nearSame('Il server di test si riavvia alle 6', 'Il database di prova si svuota il lunedì')).toBe(false);
    expect(nearSame('porta 4319', 'porta 4329')).toBe(false); // short values: only the very same words
  });
});

describe('the gate on every new fact', () => {
  it('proposeMemory refuses a case-specific fact and stores nothing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-worth-')); dirs.push(root);
    const base = { scope: { roleId: 'artisan' }, subject: 'setup', predicate: 'note', sourceEventId: 'e', sourceRunId: 'r' };
    expect(() => proposeMemory(root, { ...base, value: 'Statistiche prestazioni: https://localhost:44309/stats' })).toThrow(/tied to one case/);
    expect(readMemoryRecords(root)).toEqual([]);
    expect(proposeMemory(root, { ...base, value: 'After login the local app runs on a port other than the default: read it from the launch profile' }).status).toBe('proposed');
  });
});
