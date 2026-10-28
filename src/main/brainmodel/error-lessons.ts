// Legacy recurring-error writer, retained for compatibility but not mounted in automatic maintenance. ai-errors.md
// is grouped as on the Qualità page (memory-stats.ts groupErrors). Only explicit reusable prevention rules in distinct date/chat
// occurrences qualify; observations are never turned into truncated instructions with a generic suffix.
// This legacy writer is not mounted in automatic maintenance; approved lessons use jobs.ts corrections().
// a group already turned into a rule (its tag is in the change log, undone or not) is never written again, so an undo is
// the user's decision. ai-errors.md stays as written: the log and the Qualità statistics read it.
// Unit tests: test/unit/brainmodel/error-lessons.test.ts.
import path from 'node:path';
import type { JobContext } from './jobs';
import { appendUnder, brainJsonWithTopic, fold, LESSONS_RULE, LESSONS_WHEN } from './jobs';
import { groupErrors, parseError } from './memory-stats';
import { readSmall } from './model';
import { changeText } from './change-text';
import { checkMemoryWorth } from '../rules/memory-worth';
import { checkPermissionText } from '../agents/tool-policy';

export const ERROR_MIN = 2;
const HEADING = 'Errori ricorrenti';
const oneLine = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** The change log's evidence tag of one group: stable across passes (its label, folded). */
export const errorTag = (label: string): string => `ai-errors.md · ${fold(label).replace(/[^a-z0-9]+/g, ' ').trim()}`;

/** Preserve the complete prevention sentence or omit it; a case-bound observation is not a reusable rule. */
export function errorRule(g: { rule: string | null }): string | null {
  const rule = g.rule?.replace(/\s+/g, ' ').trim();
  if (!rule || rule.length > 4000 || /…|\.\.\.$/.test(rule)) return null;
  try { checkMemoryWorth('setup', 'note', rule); checkPermissionText(rule); } catch { return null; }
  return rule;
}

export function errorLessons(ctx: JobContext): number {
  const text = readSmall(path.join(ctx.root, 'ai-errors.md'));
  if (!text) return 0;
  const entries = text.split('\n').map(parseError).filter((e): e is NonNullable<typeof e> => !!e);
  const done = new Set(ctx.log.all().filter(c => c.job === 'corrections').flatMap(c => c.evidence));
  let changes = 0;
  const grouped = groupErrors(entries, []);
  for (const g of grouped.groups) {
    // Legacy lines name a chat or role in agent. Repeated lines on the same day from it are one occurrence.
    const count = new Set(grouped.items.filter(e => e.group === g.key).map(e => `${e.date}:${e.agent}`)).size;
    const tag = errorTag(g.label);
    if (count < ERROR_MIN || done.has(tag)) continue;
    const rule = errorRule(g);
    if (!rule) continue;
    const file = path.join(ctx.root, LESSONS_RULE);
    const current = readSmall(file) ?? LESSONS_WHEN;
    if (current.includes(rule)) continue;
    const writes = [{ file, text: appendUnder(current, HEADING, `- ${rule} (${count} volte, ultima ${g.last ?? '—'}; ai-errors.md)`) }];
    const cfg = brainJsonWithTopic(ctx.root, LESSONS_RULE);
    if (cfg) writes.push(cfg);
    if (ctx.log.apply({ job: 'corrections', kind: 'rule', action: 'update', target: LESSONS_RULE, summary: changeText().newRule({ rule: oneLine(rule, 120) }),
      reason: `Errore ricorrente in ai-errors.md (${count} occorrenze, ${g.agents.join(', ')}): prevenzione riutilizzabile.`, evidence: [tag] }, writes)) changes++;
    done.add(tag);
  }
  return changes;
}
