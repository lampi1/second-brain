// A report pasted as JSON in the last message is read as agent_report's arguments (chats/text-report.ts, ADR 0356).
import { describe, expect, it } from 'vitest';
import { reportInText } from '../../../src/main/chats/text-report';

const R = { outcome: 'done', summary: 'Fatto', criteria: [{ criterion: 'A', met: true }] };
describe('reportInText', () => {
  it('a ```json block, the whole text or the last {…} in prose', () => {
    expect(reportInText('Ecco:\n```json\n' + JSON.stringify(R) + '\n```')).toEqual({ ...R, output: 'Fatto' });
    expect(reportInText(JSON.stringify({ ...R, output: 'Esteso' }))).toEqual({ ...R, output: 'Esteso' });
    expect(reportInText(`Prima {"a":1} poi il report: ${JSON.stringify(R)} fine.`)).toEqual({ ...R, output: 'Fatto' });
  });
  it('wrapped as { agent_report } or as a tool call', () => {
    expect(reportInText(JSON.stringify({ agent_report: R }))).toMatchObject({ outcome: 'done' });
    expect(reportInText(JSON.stringify({ name: 'mcp_second-brain_agent_report', arguments: R }))).toMatchObject({ outcome: 'done' });
  });
  it('braces inside strings do not break it', () => {
    expect(reportInText(JSON.stringify({ ...R, summary: 'usa {x} e "}"' }))).toMatchObject({ summary: 'usa {x} e "}"' });
  });
  it('null without an outcome of done | partial | blocked and a summary, or without JSON', () => {
    expect(reportInText(JSON.stringify({ outcome: 'ok', summary: 's' }))).toBeNull();
    expect(reportInText(JSON.stringify({ outcome: 'done' }))).toBeNull();
    expect(reportInText('Ho finito, tutto bene.')).toBeNull();
    expect(reportInText('{ rotto')).toBeNull();
  });
});
