// The run-report block a role chat ends its run with (agent_report writes the same fields): valid, missing and garbage
// replies; garbage counts as no report.
import { expect, it } from 'vitest';
import { parseRunReport, reportOf, REPORT_MAX } from '../../src/main/agents/run-report';

const block = (body: string) => `Done.\n\n\`\`\`run-report\n${body}\n\`\`\`\n`;

it('reads a valid report, collapsing and cutting the summary', () => {
  const long = `Fixed   the\nlogin ${'x'.repeat(200)}`;
  const p = parseRunReport(block(JSON.stringify({ outcome: 'done', verified: 'yes', summary: long, extra: 'ignored' })), 5);
  expect(p.status).toBe('ok');
  if (p.status !== 'ok') return;
  expect(p.report).toMatchObject({ at: 5, outcome: 'done', verified: 'yes' });
  expect(p.report.summary.startsWith('Fixed the login x')).toBe(true);
  expect(p.report.summary).toHaveLength(140);
  expect(p.report.summary.endsWith('…')).toBe(true);
  expect('extra' in p.report).toBe(false);
});

it('keeps the reviewer counts and takes the last block', () => {
  const text = block(JSON.stringify({ outcome: 'blocked', verified: 'no', summary: 'old' })) + block(JSON.stringify({ outcome: 'partial', verified: 'partial', summary: 'new', findings: 3, blocking: 1 }));
  expect(reportOf(text, 1)).toEqual({ at: 1, outcome: 'partial', verified: 'partial', summary: 'new', findings: 3, blocking: 1 });
});

it('reports missing when there is no block (an inline mention is not one)', () => {
  expect(parseRunReport('All done, no report.', 1)).toEqual({ status: 'missing' });
  expect(parseRunReport('see ```run-report {"outcome":"done"}``` inline', 1)).toEqual({ status: 'missing' });
  expect(reportOf('nothing', 1)).toBeNull();
});

it('marks garbage: bad JSON, wrong values, missing summary, bad counts, too long', () => {
  const cases: [string, string][] = [
    ['{not json', 'not JSON'],
    ['[1]', 'not an object'],
    [JSON.stringify({ outcome: 'ok', verified: 'yes', summary: 's' }), 'outcome'],
    [JSON.stringify({ outcome: 'done', verified: 'maybe', summary: 's' }), 'verified'],
    [JSON.stringify({ outcome: 'done', verified: 'yes', summary: '  ' }), 'summary'],
    [JSON.stringify({ outcome: 'done', verified: 'yes', summary: 's', findings: -1 }), 'findings'],
    [JSON.stringify({ outcome: 'done', verified: 'yes', summary: 's', blocking: 1.5 }), 'blocking'],
    [JSON.stringify({ outcome: 'done', verified: 'yes', summary: 's', findings: 1, blocking: 2 }), 'blocking > findings'],
    [JSON.stringify({ outcome: 'done', verified: 'yes', summary: 'x'.repeat(REPORT_MAX) }), 'too long'],
  ];
  for (const [body, reason] of cases) expect(parseRunReport(block(body), 1)).toEqual({ status: 'garbage', reason });
  expect(reportOf(block('{not json'), 7)).toBeNull();
});

it('keeps a Judge review\'s verdict when it is one of success, partial, fail; drops anything else', () => {
  const base = { outcome: 'done', verified: 'yes', summary: 's' };
  expect(parseRunReport(block(JSON.stringify({ ...base, verdict: 'fail' })), 1)).toMatchObject({ status: 'ok', report: { verdict: 'fail' } });
  const odd = parseRunReport(block(JSON.stringify({ ...base, verdict: 'great' })), 1);
  expect(odd.status === 'ok' && 'verdict' in odd.report).toBe(false);
});
