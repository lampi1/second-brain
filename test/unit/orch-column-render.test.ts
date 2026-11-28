// The Orchestrator column's restyled parts (ADR 0367), rendered: a result is one thin row (head, title, one-line
// outcome, ›) folded by default; «Finito quello che aspettavi» for a waited result; the credentials card shows the mask
// and no value before main answers; «Stai aspettando» chips are a dot and coloured text; the command card is one line
// of head, one mono line with Copia, one sentence and Esegui / No; a yes/no card has Sì / No / «Cosa cambia?»; the
// user's bubble keeps his words and the estimate is a closed chip under it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatItem, ChatSummary, PendingRequest } from '../../src/shared/contract';

const state = { chats: {} as Record<string, unknown>, items: {}, pending: [] };
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(() => Promise.resolve(null)) } }));
vi.mock('../../src/renderer/store/store', () => ({ useApp: (sel: (s: typeof state) => unknown) => sel(state), runCommand: vi.fn(), dismissCommand: vi.fn(), app: { get: () => state } }));
vi.mock('../../src/renderer/actions', () => ({ openChatRef: vi.fn(), openHandoff: vi.fn() }));
vi.mock('../../src/renderer/components/AgentAvatar', () => ({ AgentAvatar: () => createElement('i', { 'data-testid': 'head' }) }));
vi.mock('../../src/renderer/brain/components/ui', () => ({ copyText: vi.fn(() => Promise.resolve(true)) }));
import { ResultRow, resultRowOf } from '../../src/renderer/components/ResultRow';
import { CredentialCard } from '../../src/renderer/components/CredentialCard';
import { WaitingChips } from '../../src/renderer/components/WaitingRow';
import { CommandCard, QuestionCard, commandHead } from '../../src/renderer/components/OrchAskCard';
import { credentialCardItem } from '../../src/main/appctl/credential-card-tool';

type Sys = Extract<ChatItem, { kind: 'system' }>;
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('a result from another agent', () => {
  const item: Sys = { kind: 'system', id: 'r1', at: 1, level: 'info', code: 'resultReady', text: '', params: { role: 'Artisan', title: 'Air refactoring · PaymentService', summary: 'x', chatId: 'c1' },
    result: { output: 'Branch feature/127268 pushato. Restano 2 test da sistemare.\n\nDettagli lunghi…', summary: 'Branch pushato, 2 test da sistemare. Altro.', outcome: 'partial', doneWhen: [], at: 1, taskId: 't', runId: 'r', taskVersion: 1 } as unknown as Sys['result'] };
  it('is one folded row: head, title, the first sentence, ›', () => {
    const out = html(createElement(ResultRow, { item, body: (t: string) => createElement('div', { className: 'full' }, t) }));
    expect(out).toContain('data-testid="head"');
    expect(out).toContain('Air refactoring · PaymentService');
    // the row names its source chat even folded (the smoke script and e2e find it by it)
    expect(out).toContain('data-testid="result-ready" data-chat-id="c1"');
    expect(out).toContain('>Branch pushato, 2 test da sistemare</span>');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('Dettagli lunghi');
    expect(out).not.toContain('risultato pronto');
  });
  it('reads «Finito quello che aspettavi» when the user waited for it', () => {
    const waited = { ...item, params: { ...item.params, waited: 1 } } as Sys;
    expect(resultRowOf(waited).waited).toBe(true);
    const out = html(createElement(ResultRow, { item: waited, body: () => null }));
    expect(out).toContain('Finito quello che aspettavi');
    expect(out).not.toContain('data-testid="head"');
  });
});

describe('the credentials card', () => {
  it('shows the group, the countdown and the mask, and no value before main answers', () => {
    const item = credentialCardItem('e1', 'Air · test3', Date.now());
    const out = html(createElement(CredentialCard, { item }));
    expect(out).toContain('Credenziali · Air · test3');
    expect(out).toContain('si chiude tra 10 min');
    expect(out).toContain('••••••••••••');
    expect(out).toContain('data-testid="credential-show"');
    expect(out).toContain('data-testid="credential-copy-user"');
    expect(out).toContain('data-testid="credential-copy-password"');
  });
  it('hides itself after 10 minutes', () => {
    const out = html(createElement(CredentialCard, { item: credentialCardItem('e1', 'Air · test3', Date.now() - 11 * 60_000) }));
    expect(out).toContain('data-testid="credential-card-closed"');
    expect(out).not.toContain('credential-password');
  });
});

describe('«Stai aspettando»', () => {
  it('is a dot or a ✓ and coloured text per chat, never a box', () => {
    const chats = [
      { id: 'a', title: 'Controllo DB di test', state: 'idle', pending: 0, userWait: { since: 1, doneAt: 2 } },
      { id: 'b', title: 'Refactoring', state: 'running', pending: 0, userWait: { since: 1 }, plan: { steps: [{ state: 'done' }, { state: 'todo' }] } },
    ] as unknown as ChatSummary[];
    const out = html(createElement(WaitingChips, { chats }));
    expect(out).toContain('Stai aspettando');
    expect(out).toContain('oc-t-done');
    expect(out).toContain('✓');
    expect(out).toContain('· finito');
    expect(out).toContain('· passo 1 di 2');
    expect(html(createElement(WaitingChips, { chats: [] }))).toBe('');
  });
  it('the header\'s state word has no box either (owner, 2026-11-27)', () => {
    const css = readFileSync(path.resolve('src/renderer/styles/orch-chat.css'), 'utf8');
    expect(css).toMatch(/\.pill\[data-testid="orchestrator-state"\] \{[^}]*background: none/);
    expect(css).toMatch(/\.oc-wchip \{[^}]*background: none/);
  });
});

describe('the waiting list\'s short cards', () => {
  const req = { id: 'q1', chatId: 'c1', type: 'command', tool: 'Esegui', title: 'x', detail: '', input: null, at: 1,
    command: { itemId: 'a1', code: 'sqlcmd -S test3 -d Oris -i add-birthdate.sql\nGO', lang: 'powershell', lead: 'Aggiunge la colonna; c\'è lo script di rollback. Poi altro.' } } as PendingRequest;
  it('a command: head, one mono line with Copia, one sentence, Esegui / No', () => {
    state.chats = { c1: { id: 'c1', cwd: 'C:\\progetti\\dentia' } };
    const out = html(createElement(CommandCard, { req, who: 'Artisan', onOpen: () => {} }));
    expect(out).toContain('Esegui · ');
    expect(out).toContain('dentia');
    expect(out).toContain('sqlcmd -S test3 -d Oris -i add-birthdate.sql …');
    expect(out).toContain('data-testid="orchestrator-cmd-copy"');
    // one sentence on the card (the whole reason on hover)
    expect(out).toContain('>Aggiunge la colonna; c&#x27;è lo script di rollback</span>');
    expect(out).toContain('data-testid="orchestrator-cmd-run"');
    expect(out).toContain('data-testid="orchestrator-cmd-no"');
    expect(commandHead('Get-Content x.txt', '', null).risk).toBe('read');
    expect(commandHead('rm -rf build', 'C:/a/b', 'prod').risk).toBe('prod');
  });
  it('a yes/no question: who · topic, the question, Sì / No / Cosa cambia?', () => {
    const out = html(createElement(QuestionCard, { who: 'Stratega', topic: 'Air MCP', question: 'Approvi i passi 6 e 7?', sent: false, onYes: () => {}, onNo: () => {}, onExplain: () => {}, onOpen: () => {} }));
    expect(out).toContain('Stratega · Air MCP');
    expect(out).toContain('Approvi i passi 6 e 7?');
    expect(out).toContain('>Sì</button>');
    expect(out).toContain('>No</button>');
    expect(out).toContain('Cosa cambia?');
  });
});
