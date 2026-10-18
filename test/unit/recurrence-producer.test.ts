// Exercises the shipped quality producer through Node, as brain-site imports it on a clean installation.
// Pins the 14-day verdicts and explicit excluded rows for the release audit (ADR 0024/0037).
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('ships recurrence and quality with conservative 14-day rule verdicts', () => {
  const program = String.raw`
    import { parse, recurrence, quality } from './brain-template/ops/tools/recurrence.mjs';
    const row = (date, type, area, rule = '') => '- ' + date + ' 10:00 · chat · ' + area + ' · ' + type + ' · detto: claim · vero: fact · visto da: owner' + (rule ? ' · regola: ' + rule : '');
    const text = [row('2026-10-01', 'fatto-presunto', 'checkout', 'verify'),
      row('2026-10-15', 'fatto-non-verificato', 'checkout'),
      row('2026-10-01', 'regola-ignorata', 'network', 'read'),
      row('2026-10-16', 'regola-ignorata', 'network'),
      row('2026-10-17', 'altro', 'testing', 'wait'),
      row('2026-10-17', 'unknown-label', 'testing'), '- 2026-10-17 malformed'].join('\n');
    console.log(JSON.stringify({ recurrence: recurrence(parse(text)), quality: quality(text, { today: '2026-10-18' }) }));
  `;
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8' }));
  expect(result.recurrence.totals).toContainEqual(['fatto-non-verificato', 2]);
  expect(result.quality.rules.map((r: { status: string }) => r.status)).toEqual(['tornato', 'non-tornato', 'troppo-presto']);
  expect(result.quality.invalid).toHaveLength(1);
  expect(result.quality.unparsed).toHaveLength(1);
  expect(result.quality.lines).toBe(7);
});
