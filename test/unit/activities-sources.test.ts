// «Attività pianificate» readers (src/main/activities/sources/devops.ts and mcp.ts) with fake script runs and a fake MCP call:
// DevOps news → items (a mention flagged, the window of days from the cursor), a failed script = an error in words; the MCP
// reader maps Outlook and Teams answers, never calls a server the health machine holds back, and turns a refused login into
// «premi Accedi» without throwing.
import { describe, expect, it, vi } from 'vitest';
import { devopsReader } from '../../src/main/activities/sources/devops';
import { mapOutlook, mapTeams, mcpReader, outlookConfig, payloadOf, teamsConfig } from '../../src/main/activities/sources/mcp';
import { defaultActivity, type Activity } from '../../src/shared/activities';

const NOW = Date.parse('2026-11-28T10:00:00Z');
const act = (source: Activity['source'], filter: Partial<Activity['filter']> = {}): Activity => ({ ...defaultActivity(source), filter: { ...defaultActivity(source).filter, ...filter }, id: 'a', createdAt: 0, updatedAt: 0, propose: 'p' });
const cursor = { at: 0, keys: [] };

describe('devops reader', () => {
  const stdout = JSON.stringify({ news: [
    { key: 'k1', at: '2026-11-28T09:00:00Z', kind: 'mention', who: 'Giulia', title: 'Bug sul login', detail: 'puoi guardare?', url: 'https://dev.azure.com/x/1' },
    { key: 'k2', at: '2026-11-28T09:30:00Z', kind: 'comment', who: 'Marco', title: 'Altro', url: 'https://dev.azure.com/x/2' },
  ], assigned: [] });
  it('maps news to items and asks only for the days since the cursor', async () => {
    const run = vi.fn(async () => ({ stdout, stderr: '', code: 0 as number | null }));
    const r = await devopsReader(run).read(act('devops'), { at: NOW - 2 * 864e5, keys: [] }, NOW);
    expect(run).toHaveBeenCalledWith(2);
    expect(r.items).toMatchObject([{ key: 'k1', from: 'Giulia', mentionsMe: true, unread: true, at: Date.parse('2026-11-28T09:00:00Z') }, { key: 'k2', mentionsMe: false }]);
    expect(r.error).toBeUndefined();
  });
  it('a missing script, a failed run and a bad answer are errors in words, never throws', async () => {
    expect((await devopsReader(async () => null).read(act('devops'), cursor, NOW)).error).toContain('devops-me.mjs');
    expect((await devopsReader(async () => ({ stdout: '', stderr: 'DevOps: az login scaduto', code: 2 })).read(act('devops'), cursor, NOW)).error).toContain('az login');
    expect((await devopsReader(async () => ({ stdout: 'no', stderr: '', code: 0 })).read(act('devops'), cursor, NOW)).error).toContain('non riconosciuta');
  });
});

describe('mcp readers', () => {
  const outlook = { value: [
    { id: 'm1', subject: 'Preventivo', from: { emailAddress: { name: 'Anna Rossi' } }, receivedDateTime: '2026-11-28T08:00:00Z', bodyPreview: 'ciao', isRead: false },
    { id: 'm2', subject: 'Letta', from: 'Luca', receivedDateTime: '2026-11-28T07:00:00Z', isRead: true },
    { subject: 'senza id' },
  ] };
  it('maps Outlook mail: unread from isRead, sender from the nested name, rows without id dropped', () => {
    expect(mapOutlook(outlook, NOW)).toMatchObject([{ key: 'm1', from: 'Anna Rossi', title: 'Preventivo', unread: true, text: 'ciao' }, { key: 'm2', from: 'Luca', unread: false }]);
  });
  it('maps Teams messages: mention flag, chat topic as title', () => {
    expect(mapTeams([{ id: 't1', from: { displayName: 'Marco' }, text: 'ti serve?', chatTopic: 'Team Air', createdDateTime: '2026-11-28T08:00:00Z', isMention: true }], NOW))
      .toMatchObject([{ key: 't1', from: 'Marco', title: 'Team Air', mentionsMe: true, unread: true }]);
  });
  it('calls the configured tool with its arguments; text answers are parsed as JSON', async () => {
    const call = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(outlook) }] }));
    const r = await mcpReader(outlookConfig(), { call }).read(act('outlook', { unreadOnly: true }), cursor, NOW);
    expect(call).toHaveBeenCalledWith('outlook-msoutlook-mcp', 'outlook_list_emails', { top: 50, unread_only: true, mark_read: false });
    expect(r.items).toHaveLength(2);
    expect(payloadOf({ content: [{ type: 'text', text: 'plain' }] })).toBe('plain');
    const t = await mcpReader(teamsConfig(), { call: async () => ({ content: [], structuredContent: [{ id: 'x', text: 'a' }] }) }).read(act('teams'), cursor, NOW);
    expect(t.items).toHaveLength(1);
  });
  it('a held-back server is not called (no retry storm); a refused login says «Accedi»; a tool error is an error', async () => {
    const call = vi.fn(async () => ({ content: [] }));
    const held = await mcpReader(teamsConfig(), { call, held: () => 'Teams chiede di accedere di nuovo' }).read(act('teams'), cursor, NOW);
    expect(held).toEqual({ items: [], error: 'Teams chiede di accedere di nuovo' });
    expect(call).not.toHaveBeenCalled();
    const auth = Object.assign(new Error('x'), { code: 'auth' });
    expect((await mcpReader(outlookConfig(), { call: async () => { throw auth; } }).read(act('outlook'), cursor, NOW)).error).toContain('Accedi');
    expect((await mcpReader(outlookConfig(), { call: async () => ({ content: [{ type: 'text', text: 'boom' }], isError: true }) }).read(act('outlook'), cursor, NOW)).error).toContain('errore');
  });
});
