// Recurring errors become rules (the owner, 2026-10-22: an error noted in ai-errors.md should end in a rule, not only in
// a note). Part of the maintenance's 'corrections' job, zero tokens: ai-errors.md is read and grouped as on the Qualità
// page (memory-stats.ts groupErrors: same type and area, else overlapping words); a group with ERROR_MIN lines or more
// becomes one line of rules/lessons.md (every role reads it), under «Errori ricorrenti». The line is the group's own
// «regola:» when a line wrote one, else the error itself ("già successo N volte"). One change per group, with its undo;
// a group already turned into a rule (its tag is in the change log, undone or not) is never written again, so an undo is
// the user's decision. ai-errors.md stays as written: the log and the Qualità statistics read it.
// Called by brainmodel/service.ts after corrections(); unit tests: test/unit/brainmodel/error-lessons.test.ts.
import path from 'node:path';
import type { JobContext } from './jobs';
import { appendUnder, brainJsonWithTopic, fold, LESSONS_RULE, LESSONS_WHEN } from './jobs';
import { groupErrors, parseError } from './memory-stats';
import { readSmall } from './model';
import { changeText } from './change-text';

export const ERROR_MIN = 2;
const HEADING = 'Errori ricorrenti';
const oneLine = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** The change log's evidence tag of one group: stable across passes (its label, folded). */
export const errorTag = (label: string): string => `ai-errors.md · ${fold(label).replace(/[^a-z0-9]+/g, ' ').trim()}`;

/** The rule a recurring group gives: its own «regola:», else the error and how often it happened. */
export function errorRule(g: { label: string; count: number; sample: string; rule: string | null }): string {
  return g.rule ? oneLine(g.rule, 240) : oneLine(`Errore già successo ${g.count} volte («${g.label}»): ${g.sample}. Controlla questo punto prima di consegnare.`, 300);
}

export function errorLessons(ctx: JobContext): number {
  const text = readSmall(path.join(ctx.root, 'ai-errors.md'));
  if (!text) return 0;
  const entries = text.split('\n').map(parseError).filter((e): e is NonNullable<typeof e> => !!e);
  const done = new Set(ctx.log.all().filter(c => c.job === 'corrections').flatMap(c => c.evidence));
  let changes = 0;
  for (const g of groupErrors(entries, []).groups) {
    const tag = errorTag(g.label);
    if (g.count < ERROR_MIN || done.has(tag)) continue;
    const rule = errorRule(g);
    const file = path.join(ctx.root, LESSONS_RULE);
    const current = readSmall(file) ?? LESSONS_WHEN;
    if (current.includes(rule)) continue;
    const writes = [{ file, text: appendUnder(current, HEADING, `- ${rule} (${g.count} volte, ultima ${g.last ?? '—'}; ai-errors.md)`) }];
    const cfg = brainJsonWithTopic(ctx.root, LESSONS_RULE);
    if (cfg) writes.push(cfg);
    if (ctx.log.apply({ job: 'corrections', kind: 'rule', action: 'update', target: LESSONS_RULE, summary: changeText().newRule({ rule: oneLine(rule, 120) }),
      reason: `Errore ricorrente in ai-errors.md (${g.count} volte, ${g.agents.join(', ')}): diventa una regola per ogni ruolo.`, evidence: [tag] }, writes)) changes++;
    done.add(tag);
  }
  return changes;
}
