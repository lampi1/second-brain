// The "In attesa di…" label of a held work chat (#86, ADR 0076): AutoCloseNotice renders what main says it waits for,
// in place of the countdown, and nothing for a chat that waits for nothing. Rendered without a browser.
import { createElement } from 'react';
import type { AutoCloseStatus } from '../../src/shared/auto-close';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: {} }));
vi.mock('../../src/renderer/actions', () => ({ focusChat: () => {} }));
vi.mock('../../src/renderer/store/store', () => ({ useApp: () => ({}) }));
let rows: AutoCloseStatus[] = [];
vi.mock('../../src/renderer/store/auto-close', () => ({
  autoCloseState: { set: (next: AutoCloseStatus[]) => { rows = next; }, use: <T>(pick: (r: AutoCloseStatus[]) => T) => pick(rows) },
  autoCloseRemaining: (r: AutoCloseStatus) => r.deadline === null ? Infinity : r.deadline - r.clockAt, keepAgentOpen: async () => true,
}));
vi.mock('../../src/renderer/lib/clock', () => ({ useNow: () => 100_000, now: () => 100_000 }));
import { renderToStaticMarkup } from 'react-dom/server';
import { AutoCloseNotice } from '../../src/renderer/components/AutoCloseNotice';
import { autoCloseState } from '../../src/renderer/store/auto-close';
import { setLang } from '../../src/renderer/i18n';

afterEach(() => setLang('it'));
const html = () => renderToStaticMarkup(createElement(AutoCloseNotice, { chatId: 'w' }));

const row = (p: Partial<AutoCloseStatus>): AutoCloseStatus => ({ chatId: 'w', deadline: null, clockAt: 1, warningStartedAt: null, generation: 1, keptOpen: false, reason: null, ...p });

it('shows what the chat waits for, amber when it waits for the user', () => {
  autoCloseState.set([row({ waitingFor: 'user', reason: 'In attesa dell’utente' })]);
  const user = html();
  expect(user).toContain('data-testid="autoclose-waiting-w"');
  expect(user).toContain('data-waiting="user"');
  expect(user).toContain('In attesa dell’utente');
  autoCloseState.set([row({ waitingFor: 'colleagues' })]);
  expect(html()).toContain('In attesa dei colleghi');
  autoCloseState.set([row({ waitingFor: 'report' })]);
  expect(html()).toContain('In attesa del report finale');
  setLang('en'); expect(html()).toContain('Waiting for the final report');
});

it('shows nothing for a chat that waits for nothing, and no label once kept open', () => {
  autoCloseState.set([row({})]);
  expect(html()).toBe('');
  autoCloseState.set([row({ waitingFor: 'user', keptOpen: true })]);
  expect(html()).not.toContain('autoclose-waiting');
});
