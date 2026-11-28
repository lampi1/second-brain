// app_show_credentials (ADR 0367): the Orchestrator names an environment («test 3»), the app finds the entry of the
// user's credentials file and shows him a card; the tool's result and the card's chat item carry only an opaque id and
// the group label, never the URL, the user name or the password (fake values below), and a production entry, an
// unknown or an ambiguous reference gets one plain refusal without values; the card gate answers the renderer only
// for an entry shown in the last 10 minutes that is still a test entry.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import type { ChatItem } from '../../src/shared/contract';
import { CARD_REFUSAL, cardMatch, Credentials, DEFAULT_CREDENTIALS_FILE, entryId, parseEntries } from '../../src/main/browser/logins';
import { cardGate } from '../../src/main/browser/card-gate';
import { credentialCardItem, credentialsCardTool, CREDENTIALS_TOOL } from '../../src/main/appctl/credential-card-tool';
import { ORCHESTRATOR_APP_REQUIRED } from '../../src/shared/role-tools';
import { cardMinutesLeft, CREDENTIAL_CARD_MS } from '../../src/shared/credential-card';

// Fake values, built at run time so no literal looks like a secret.
const pw = (n: string) => ['pw', 'made-up', n].join('-');
const ROOT = path.resolve('/brain');
const FILE = ['# Accounts', '```json', JSON.stringify({
  Air: {
    test3: { url: 'https://test3.example.local/', username: 'admin.test3', password: pw('3') },
    test4: { url: 'https://test4.example.local/', username: 'admin.test4', password: pw('4') },
    test13: { url: 'https://test13.example.local/', username: 'admin.test13', password: pw('13') },
    prod: { url: 'https://air.example.com/', username: 'admin', password: pw('prod') },
  },
}, null, 2), '```'].join('\n');
const VALUES = [pw('3'), pw('4'), pw('13'), pw('prod'), 'admin.test3', 'test3.example.local', 'admin.test4'];
const creds = () => new Credentials(() => ROOT, f => {
  if (path.relative(ROOT, f).replace(/\\/g, '/') !== DEFAULT_CREDENTIALS_FILE) throw new Error('ENOENT');
  return FILE;
});
const noValues = (text: string) => { for (const v of VALUES) expect(text).not.toContain(v); };
const entryIdOf = (user: string) => { const all = parseEntries(FILE), i = all.findIndex(e => e.user === user); return entryId(all[i]!, i); };

describe('cardMatch', () => {
  const all = parseEntries(FILE);
  it('finds the entry by the user\'s words, a host or a user name', () => {
    const three = cardMatch(all, 'test 3');
    expect(three).toMatchObject({ group: 'Air · test3' });
    expect(cardMatch(all, 'test3.example.local')).toEqual(three);
    expect(cardMatch(all, 'https://test3.example.local/login')).toEqual(three);
    expect(cardMatch(all, 'admin.test3')).toEqual(three);
    expect(cardMatch(all, 'credenziali di test 4')).toMatchObject({ group: 'Air · test4' });
  });
  it('refuses production, unknown and ambiguous references with one plain answer that names nothing', () => {
    for (const ref of ['prod', 'air.example.com', 'test 9', 'test', 'air']) {
      const m = cardMatch(all, ref);
      expect(m).toEqual({ refusal: CARD_REFUSAL });
      noValues(JSON.stringify(m));
    }
    expect(CARD_REFUSAL).not.toContain('Air');
    expect(cardMatch(all, '')).toHaveProperty('refusal');
  });
  it('never matches a part of a user name, so it cannot be guessed letter by letter', () => {
    for (const ref of ['admin', 'admin.test', 'admin.t', 'dmin']) expect(cardMatch(all, ref)).toEqual({ refusal: CARD_REFUSAL });
    expect(cardMatch(all, 'admin.test4')).toMatchObject({ group: 'Air · test4' });
  });
});

describe('the card gate (credentials:card and credentials:reveal)', () => {
  const setup = () => {
    let now = 1_000, text = FILE;
    const c = new Credentials(() => ROOT, f => {
      if (path.relative(ROOT, f).replace(/\\/g, '/') !== DEFAULT_CREDENTIALS_FILE) throw new Error('ENOENT');
      return text;
    });
    const gate = cardGate(c, () => now);
    return { gate, c, tick: (ms: number) => { now += ms; }, edit: (t: string) => { text = t; } };
  };
  it('answers only for an entry shown in the last 10 minutes', () => {
    const { gate, tick } = setup();
    const id = entryIdOf('admin.test3');
    expect(gate.fields(id)).toBeNull();
    expect(gate.reveal(id)).toBeNull();
    const m = gate.match('test 3');
    expect(m).toMatchObject({ id });
    expect(gate.fields(id)).toEqual({ user: 'admin.test3', url: 'https://test3.example.local/' });
    expect(gate.reveal(id)).toBe(pw('3'));
    // another entry never shown, and an id that names nothing
    expect(gate.fields(entryIdOf('admin.test4'))).toBeNull();
    expect(gate.reveal(entryIdOf('admin.test4'))).toBeNull();
    expect(gate.fields('0123456789abcdef')).toBeNull();
    expect(gate.reveal('0123456789abcdef')).toBeNull();
    tick(CREDENTIAL_CARD_MS);
    expect(gate.fields(id)).toBeNull();
    expect(gate.reveal(id)).toBeNull();
  });
  it('checks production again at each answer (the id does not cover loginUrls)', () => {
    const { gate, edit } = setup();
    const id = entryIdOf('admin.test3');
    gate.match('test 3');
    edit(FILE.replace('"username": "admin.test3",', '"username": "admin.test3", "loginUrl": "https://prod.example.com/",'));
    expect(gate.fields(id)).toBeNull();
    expect(gate.reveal(id)).toBeNull();
  });
});

describe(CREDENTIALS_TOOL, () => {
  const setup = (orchestrator: string | null = 'orch') => {
    const shown: { chatId: string; item: Extract<ChatItem, { kind: 'system' }> }[] = [];
    const c = creds();
    const tool = credentialsCardTool({ match: ref => c.cardMatch(ref), orchestratorId: () => orchestrator, show: (chatId, item) => shown.push({ chatId, item }), now: () => 1_000 });
    return { tool, shown, c };
  };
  it('shows a card in the Orchestrator and never returns a value to the model', () => {
    const { tool, shown, c } = setup();
    const out = tool.run({ ref: 'test 3' });
    expect(out).toContain('Air · test3');
    noValues(out);
    expect(shown).toHaveLength(1);
    const { chatId, item } = shown[0]!;
    expect(chatId).toBe('orch');
    expect(item).toMatchObject({ kind: 'system', code: 'credentialCard', at: 1_000, params: { group: 'Air · test3' } });
    // the item (what a transcript, a log or app_chat_items could read) holds no value either
    noValues(JSON.stringify(item));
    // the id it carries is what the renderer asks main for, and main answers the values only to it
    const id = String(item.params!.entryId);
    expect(c.cardFields(id)).toEqual({ user: 'admin.test3', url: 'https://test3.example.local/' });
    expect(c.byId(id)?.password).toBe(pw('3'));
  });
  it('refuses without the Orchestrator, and refusals carry no values', () => {
    expect(() => setup(null).tool.run({ ref: 'test 3' })).toThrow(/only the open Orchestrator/);
    const { tool, shown } = setup();
    for (const ref of ['prod', 'test']) {
      let message = '';
      try { tool.run({ ref }); } catch (e) { message = (e as Error).message; }
      expect(message).toMatch(/Refused/);
      noValues(message);
    }
    expect(shown).toHaveLength(0);
  });
  it('is one of the Orchestrator\'s required tools, and its card lives 10 minutes', () => {
    expect(ORCHESTRATOR_APP_REQUIRED).toContain(CREDENTIALS_TOOL);
    expect(credentialCardItem('abc', 'g', 5).id).toBe('cred-abc-5');
    expect(cardMinutesLeft(0, 0)).toBe(10);
    expect(cardMinutesLeft(0, CREDENTIAL_CARD_MS - 61_000)).toBe(2);
    expect(cardMinutesLeft(0, CREDENTIAL_CARD_MS)).toBe(0);
  });
});
