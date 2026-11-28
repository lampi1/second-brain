// The Gmail reader of the scheduled activities (src/main/activities/sources/gmail.ts): the query, the mapping of
// search_threads / get_message answers to ActivityItems, the cursor and filter working with them, the failures in the user's
// words, and that only read-only tools are ever called. Fakes only: no real mail, no network, no clock.
import { describe, expect, it } from 'vitest';
import { defaultActivity, defaultFilter, selectNew, type Activity } from '../../src/shared/activities';
import {
  GMAIL_COMPLETIONS_MAX, GMAIL_THREADS_MAX, GmailWriteBlocked, READ_ONLY_TOOLS, buildQuery, callReadOnly, createGmailReader, parseThreads,
  type GmailCallResult, type GmailDeps,
} from '../../src/main/activities/sources/gmail';

const activity = (more: Partial<Activity> = {}): Activity => ({ ...defaultActivity('gmail'), id: 'a1', createdAt: 0, updatedAt: 0, propose: 'p', ...more });
const asJson = (v: unknown): GmailCallResult => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
const msg = (id: string, ms: number, more: Record<string, unknown> = {}) => ({
  id, threadId: `t-${id}`, internalDate: String(ms), labelIds: ['INBOX', 'UNREAD'], snippet: 'short  snippet',
  payload: { headers: [{ name: 'From', value: 'Anna Rossi' }, { name: 'Subject', value: `Subject ${id}` }] }, ...more,
});

function fake(answers: Record<string, (args: Record<string, unknown>) => GmailCallResult | Error>, serverId: string | null = 'srv'): GmailDeps & { calls: { tool: string; args: Record<string, unknown> }[] } {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    serverId: () => serverId,
    async call(_s, tool, args) {
      calls.push({ tool, args });
      const r = answers[tool]?.(args) ?? new Error('unknown tool');
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

describe('buildQuery', () => {
  it('first run looks one day back; later runs start at the cursor (epoch seconds, one second of overlap)', () => {
    expect(buildQuery(defaultFilter(), { at: 0, keys: [] })).toBe('newer_than:1d');
    expect(buildQuery(defaultFilter(), { at: 1_800_000_000_000, keys: [] })).toBe('after:1799999999');
  });
  it('adds the filter as Gmail operators', () => {
    const q = buildQuery({ senders: ['boss'], subjectWords: ['bug', 'urgent "x"'], mentionsOnly: false, unreadOnly: true, excludeNoReply: true }, { at: 0, keys: [] });
    expect(q).toBe('newer_than:1d is:unread from:("boss") subject:("bug" OR "urgent  x") -from:(noreply OR no-reply OR donotreply OR do-not-reply)');
  });
});

describe('mapping search_threads and get_message', () => {
  it('takes the newest message of each thread and maps it to an item (snippet only, link to the thread)', async () => {
    const deps = fake({ search_threads: () => asJson({ threads: [{ id: 't-m2', messages: [msg('m1', 1_800_000_001_000), msg('m2', 1_800_000_002_000)] }] }) });
    const r = await createGmailReader(deps).read(activity(), { at: 0, keys: [] }, 0);
    expect(r.error).toBeUndefined();
    expect(r.items).toEqual([{
      key: 'm2', at: 1_800_000_002_000, from: 'Anna Rossi', title: 'Subject m2', text: 'short snippet', unread: true, mentionsMe: true,
      url: 'https://mail.google.com/mail/u/0/#all/t-m2',
    }]);
    expect(deps.calls.map(c => c.tool)).toEqual(['search_threads']);
  });

  it('reads structuredContent, flat fields and seconds timestamps', () => {
    const got = parseThreads({ threads: [{ id: 't1', messages: [{ id: 'x', From: 'Bruno', Subject: 'S', internalDate: 1_800_000_000, labels: ['IMPORTANT'] }] }] });
    expect(got).toMatchObject([{ id: 'x', from: 'Bruno', subject: 'S', at: 1_800_000_000_000, labels: ['IMPORTANT'] }]);
  });

  it('asks get_message only for a thread that came without sender, subject or time', async () => {
    const deps = fake({
      search_threads: () => asJson({ threads: [{ id: 't1', snippet: 'only a stub' }, { id: 't2', messages: [msg('m2', 1_800_000_005_000)] }] }),
      get_message: args => asJson(msg(String(args.messageId), 1_800_000_009_000, { threadId: 't1' })),
    });
    const r = await createGmailReader(deps).read(activity(), { at: 0, keys: [] }, 0);
    expect(deps.calls.filter(c => c.tool === 'get_message').map(c => c.args)).toEqual([{ messageId: 't1' }]);
    expect(r.items.map(i => [i.key, i.at, i.title])).toEqual([['t1', 1_800_000_009_000, 'Subject t1'], ['m2', 1_800_000_005_000, 'Subject m2']]);
  });

  it('caps the threads read and the get_message completions per run', async () => {
    const threads = Array.from({ length: GMAIL_THREADS_MAX + 10 }, (_, i) => ({ id: `t${i}` }));
    const deps = fake({ search_threads: () => asJson({ threads }), get_message: a => asJson(msg(String(a.messageId), 1_800_000_001_000)) });
    const r = await createGmailReader(deps).read(activity(), { at: 0, keys: [] }, 0);
    expect(deps.calls.filter(c => c.tool === 'get_message')).toHaveLength(GMAIL_COMPLETIONS_MAX);
    expect(r.items.length).toBe(GMAIL_COMPLETIONS_MAX);
  });

  it('marks promotions and spam as not for me and read mail as not unread', async () => {
    const deps = fake({ search_threads: () => asJson({ threads: [
      { id: 'a', messages: [msg('a', 1_800_000_001_000, { labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] })] },
      { id: 'b', messages: [msg('b', 1_800_000_002_000, { labelIds: ['INBOX', 'CATEGORY_PERSONAL'] })] },
    ] }) });
    const r = await createGmailReader(deps).read(activity(), { at: 0, keys: [] }, 0);
    expect(r.items.map(i => [i.key, i.mentionsMe, i.unread])).toEqual([['a', false, false], ['b', true, false]]);
  });
});

describe('cursor and filter on what the reader returns', () => {
  it('a second read of the same mail gives nothing new; the filter drops no-reply', async () => {
    const deps = fake({ search_threads: () => asJson({ threads: [
      { id: 'a', messages: [msg('a', 1_800_000_001_000)] },
      { id: 'b', messages: [msg('b', 1_800_000_002_000, { payload: { headers: [{ name: 'From', value: 'noreply service' }, { name: 'Subject', value: 'News' }] } })] },
    ] }) });
    const reader = createGmailReader(deps);
    const f = { ...defaultFilter(), excludeNoReply: true, unreadOnly: true };
    const first = selectNew((await reader.read(activity(), { at: 0, keys: [] }, 0)).items, { at: 0, keys: [] }, f);
    expect(first.kept.map(i => i.key)).toEqual(['a']);
    expect(first.cursor).toEqual({ at: 1_800_000_002_000, keys: ['a', 'b'] });
    const again = selectNew((await reader.read(activity(), first.cursor, 0)).items, first.cursor, f);
    expect(again.kept).toEqual([]);
    expect(deps.calls[1]!.args.query).toBe('after:1800000001');
  });
});

describe('failures are reported in the user\'s words, never with the connector\'s text', () => {
  it('no connector in the config', async () => {
    const r = await createGmailReader(fake({}, null)).read(activity(), { at: 0, keys: [] }, 0);
    expect(r).toEqual({ items: [], error: 'connettore Gmail non collegato: aggiungilo in Impostazioni → Connettori' });
  });
  it('an expired sign-in, a tool error and a network failure', async () => {
    const run = (a: (x: Record<string, unknown>) => GmailCallResult | Error) => createGmailReader(fake({ search_threads: a })).read(activity(), { at: 0, keys: [] }, 0);
    expect((await run(() => new Error('HTTP 401 Unauthorized'))).error).toMatch(/^accesso Gmail scaduto/);
    expect((await run(() => ({ isError: true, content: [{ type: 'text', text: 'invalid_grant for subject SECRET' }] }))).error).toMatch(/^accesso Gmail scaduto/);
    expect((await run(() => new Error('fetch failed'))).error).toBe('Gmail non raggiungibile');
    const other = await run(() => ({ isError: true, content: [{ type: 'text', text: 'body of a private mail' }] }));
    expect(other.error).toBe('lettura di Gmail non riuscita');
    expect(JSON.stringify(other)).not.toContain('private');
  });
});

describe('only read-only tools are ever called', () => {
  it('the allowed list has no write tool of the connector', () => {
    for (const w of ['send_message', 'reply', 'forward', 'create_draft', 'update_draft', 'delete_draft', 'trash_message', 'trash_thread', 'label_message', 'label_thread', 'unlabel_message', 'create_label', 'delete_label', 'update_label', 'mark_message_spam', 'update_message_labels']) {
      expect(READ_ONLY_TOOLS as readonly string[]).not.toContain(w);
    }
  });
  it('a write tool is refused before the connector is reached', async () => {
    const deps = fake({ send_message: () => asJson({}) });
    for (const tool of ['send_message', 'trash_thread', 'create_draft', 'label_thread']) await expect(callReadOnly(deps, 'srv', tool, {})).rejects.toBeInstanceOf(GmailWriteBlocked);
    expect(deps.calls).toEqual([]);
  });
  it('a whole run calls only the allowed tools', async () => {
    const deps = fake({ search_threads: () => asJson({ threads: [{ id: 't1' }] }), get_message: a => asJson(msg(String(a.messageId), 1_800_000_001_000)) });
    await createGmailReader(deps).read(activity(), { at: 0, keys: [] }, 0);
    expect(deps.calls.length).toBeGreaterThan(0);
    for (const c of deps.calls) expect(READ_ONLY_TOOLS as readonly string[]).toContain(c.tool);
  });
});
