// Recurring errors of ai-errors.md become rules in rules/lessons.md (src/main/brainmodel/error-lessons.ts): a group of
// two or more lines gives one rule (its own «regola:» first), once; an undo is never redone; a single error stays a note.
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
    expect(errorLessons(s.ctx)).toBe(2);
    const text = s.lessons();
    expect(text).toContain('## Errori ricorrenti');
    expect(text).toContain('- niente «fatto» senza screenshot (2 volte');
    expect(text).toMatch(/Errore già successo 2 volte \(«Test dato per passato senza eseguirlo»\)/);
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

  it('words a rule-less group from the error itself', () => {
    expect(errorRule({ label: 'x', count: 3, sample: 'y', rule: null })).toBe('Errore già successo 3 volte («x»): y. Controlla questo punto prima di consegnare.');
    expect(errorRule({ label: 'x', count: 3, sample: 'y', rule: 'fai z' })).toBe('fai z');
  });
});
