// Legacy error-rule writer: only complete reusable prevention from distinct date/chat occurrences qualifies.
// It remains unmounted in automatic maintenance; an undo is never redone and a single occurrence stays a note.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChangeLog } from '../../../src/main/brainmodel/changes';
import { errorLessons, errorRule } from '../../../src/main/brainmodel/error-lessons';
import type { JobContext } from '../../../src/main/brainmodel/jobs';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
function setup(errors: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-el-')); dirs.push(d);
  const root = path.join(d, 'brain'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'brain.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'ai-errors.md'), errors);
  const log = new ChangeLog(path.join(d, 'ud'));
  const ctx = { root, log } as unknown as JobContext;
  return { root, log, ctx, lessons: () => fs.readFileSync(path.join(root, 'rules', 'lessons.md'), 'utf8') };
}
const ERRORS = `# Errori

- 2026-10-01 09:40 · Artisan · rilasci · verifica mancata · detto: fatto · vero: nessuno screenshot · visto da: tu · regola: niente «fatto» senza screenshot
- 2026-10-08 15:05 · Artisan · rilasci · verifica mancata · detto: pronto · vero: la build era rossa · visto da: revisione
- 2026-10-09 | Sentinel | Test dato per passato senza eseguirlo: la suite non era partita
- 2026-10-15 | Sentinel | Test dato per passato senza eseguirlo: mancava l'ambiente di test libero
- 2026-10-16 | Scout | Nota di rilascio in inglese tecnico
`;

describe('recurring errors become rules', () => {
  it('writes one rule per recurring group, its own «regola:» first, and never twice', () => {
    const s = setup(ERRORS);
    expect(errorLessons(s.ctx)).toBe(1);
    const text = s.lessons();
    expect(text).toContain('## Errori ricorrenti');
    expect(text).toContain('- niente «fatto» senza screenshot (2 volte');
    expect(text).not.toContain('Test dato per passato'); // an observation without a prevention rule is not policy
    expect(text).not.toContain('inglese tecnico'); // once is a note, not a rule
    expect(JSON.parse(fs.readFileSync(path.join(s.root, 'brain.json'), 'utf8')).rules.topicFiles).toEqual(['rules/lessons.md']);
    expect(errorLessons(s.ctx)).toBe(0);
  });

  it('does not redo a rule the user undid', () => {
    const s = setup(ERRORS);
    errorLessons(s.ctx);
    for (const c of s.log.all().reverse()) s.log.rollback(c.id, { restore: () => {}, current: () => null } as never);
    expect(errorLessons(s.ctx)).toBe(0);
  });

  it('keeps full reusable prevention and rejects case-specific or missing rules', () => {
    expect(errorRule({ rule: null })).toBeNull();
    expect(errorRule({ rule: 'Prima di chiudere il ticket 12345, verificare la build.' })).toBeNull();
    const rule = `Prima di consegnare, ${'verifica le evidenze e i risultati osservati; '.repeat(15)}riporta eventuali limiti.`;
    expect(errorRule({ rule })).toBe(rule);
    expect(errorRule({ rule: 'Verifica le evidenze…' })).toBeNull();
  });
  it('ten lines from one chat on one day are one occurrence', () => {
    const line = '- 2026-10-01 09:40 · fixture-chat · test · verifica mancata · vero: nessuno screenshot · regola: Verifica lo screenshot prima di consegnare';
    const s = setup(Array(10).fill(line).join('\n'));
    expect(errorLessons(s.ctx)).toBe(0);
    fs.appendFileSync(path.join(s.root, 'ai-errors.md'), `\n${line.replace('2026-10-01', '2026-10-02')}`);
    expect(errorLessons(s.ctx)).toBe(1);
    expect(s.lessons()).toContain('(2 volte');
  });
});
