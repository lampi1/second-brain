// The one notice of a connector the gateway marks needs-login or broken (ADR 0370, service.ts marked): a feed card with
// «Accedi» (connector-login → mcpservers:login) for a remote server whose 401 asks for the OAuth login, a token fix or
// «Prova» otherwise; one card per run of failures, none for the chats held back after it. The card's action survives the
// feed's validator (live.ts feedAction). A fake upstream; no network, no process.
import { describe, expect, it, vi } from 'vitest';
import { McpServersService } from '../../../src/main/mcp-servers/service';
import { McpClientError } from '../../../src/main/mcp-servers/client';
import { McpServer } from '../../../src/main/mcp/server';
import type { FeedInput } from '../../../src/main/services';
import type { SecretCipher } from '../../../src/main/engines/secrets';
import { feedAction, stamp } from '../../../src/main/brain/live';
import { log } from '../../../src/main/log';
import { tmp } from '../chats/helpers';

const cipher: SecretCipher = { unavailable: () => null, encrypt: s => Buffer.from(s), decrypt: b => b.toString() };

function service(err: () => Error | null) {
  vi.spyOn(log, 'info').mockImplementation(() => {}); vi.spyOn(log, 'warn').mockImplementation(() => {});
  const notices: FeedInput[] = [];
  const svc = new McpServersService({ userData: tmp('mcp-notice'), cipher, mcp: new McpServer({ name: 't', version: '1' }), context: () => ({ roles: [null], policy: null }), now: () => 5_000,
    announce: e => notices.push(e),
    connect: () => ({ serverInfo: undefined, tools: async () => { const e = err(); if (e) throw e; return []; }, call: async () => ({ content: [] }), close() {} }) });
  const list = (chatId: string, id: string) => (svc.gateway as unknown as { toolsFor(c: string, s: string): Promise<unknown> }).toolsFor(chatId, id);
  return { svc, notices, list };
}

describe('the notice of a marked connector', () => {
  it('a remote server whose 401 asks for the login: ONE card with «Accedi», whatever the number of chats after it', async () => {
    const s = service(() => new McpClientError('auth', 'Accesso rifiutato (HTTP 401).', 'premi «Accedi».', true));
    s.svc.save({ def: { id: 'air-mcp-test', label: 'Air test', transport: 'http', url: 'https://mcp.example.com/mcp', secrets: [], enabled: true } });
    for (let i = 0; i < 10; i++) await expect(s.list(`c${i}`, 'air-mcp-test')).rejects.toThrow();
    expect(s.notices).toHaveLength(1);
    expect(s.notices[0]).toMatchObject({ kind: 'connector-broken', title: '«Air test» chiede di accedere di nuovo', action: { kind: 'connector-login', server: 'air-mcp-test' } });
    expect(s.notices[0]!.detail).toMatch(/HTTP 401.*2 tentativi di fila.*smette di aprirlo a ogni chat.*«Accedi».*6 h/);
    const card = stamp(s.notices[0]!);
    expect(card).toMatchObject({ label: 'Connettore da sistemare', priority: 'normal', action: { kind: 'connector-login', server: 'air-mcp-test' } });
    expect(s.svc.state().servers[0]!.lastTest?.error).toMatchObject({ code: 'auth', login: true });   // its card offers «Accedi» too
  });

  it('a program that does not start: a card without «Accedi», pointing to «Prova»', async () => {
    const s = service(() => new McpClientError('spawn', 'Il comando «kb.exe» non è partito (ENOENT).', 'Controlla il percorso.'));
    s.svc.save({ def: { id: 'oris-knowledge', label: 'Oris KB', transport: 'stdio', command: 'kb.exe', args: [], secrets: [], enabled: true } });
    for (let i = 0; i < 5; i++) await expect(s.list(`c${i}`, 'oris-knowledge')).rejects.toThrow();
    expect(s.notices).toHaveLength(1);
    expect(s.notices[0]).toMatchObject({ title: '«Oris KB» non funziona' });
    expect(s.notices[0]!.action).toBeUndefined();
    expect(s.notices[0]!.detail).toMatch(/kb\.exe.*riprova da sola tra 15 min.*«Prova»/);
  });

  it('the user edits it: tried again at once, and a new run of failures is a new card', async () => {
    const s = service(() => new McpClientError('auth', 'Accesso rifiutato (HTTP 403).', 'token', false));
    s.svc.save({ def: { id: 'tok', label: 'Tok', transport: 'http', url: 'https://mcp.example.com/mcp', secrets: [], enabled: true } });
    await expect(s.list('c1', 'tok')).rejects.toThrow(); await expect(s.list('c2', 'tok')).rejects.toThrow();
    expect(s.notices[0]!.action).toBeUndefined();               // a pasted-token server: the fix is its token, no «Accedi»
    expect(s.notices[0]!.detail).toMatch(/token valido/);
    await expect(s.list('c3', 'tok')).rejects.toThrow(/needs the user's sign-in/);
    s.svc.save({ def: { id: 'tok', label: 'Tok', transport: 'http', url: 'https://mcp.example.com/mcp', secrets: [], enabled: true }, previousId: 'tok' });
    await expect(s.list('c4', 'tok')).rejects.toThrow(/refused the access/);   // opened again
    await expect(s.list('c5', 'tok')).rejects.toThrow();
    expect(s.notices).toHaveLength(2);
  });

  it('the feed validator keeps only a well-formed server id', () => {
    expect(feedAction({ kind: 'connector-login', server: 'air-mcp-test' })).toEqual({ kind: 'connector-login', server: 'air-mcp-test' });
    expect(feedAction({ kind: 'connector-login', server: '../x' })).toBeUndefined();
    expect(feedAction({ kind: 'connector-login' })).toBeUndefined();
  });
});
