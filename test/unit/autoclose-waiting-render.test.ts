// The one status of a held work chat (#86, ADR 0084, #359): AutoCloseNotice renders what main says it waits for, in
// place of the countdown, short (at most three words in every language), and nothing for a chat that waits for nothing. Rendered without a browser.
import { createElement } from 'react';
import { AUTO_CLOSE_WAITING, type AutoCloseStatus } from '../../src/shared/auto-close';
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
import { waitingLabel } from '../../src/renderer/lib/waiting-label';

afterEach(() => setLang('it'));
const html = () => renderToStaticMarkup(createElement(AutoCloseNotice, { chatId: 'w' }));

const row = (p: Partial<AutoCloseStatus>): AutoCloseStatus => ({ chatId: 'w', deadline: null, clockAt: 1, warningStartedAt: null, generation: 1, keptOpen: false, reason: null, ...p });

it('shows one short status from what main says it waits for (#359)', () => {
  autoCloseState.set([row({ waitingFor: 'answer', reason: 'Aspetta una tua risposta' })]);
  const answer = html();
  expect(answer).toContain('data-testid="autoclose-waiting-w"');
  expect(answer).toContain('data-waiting="answer"');
  expect(answer).toContain('Aspetta te: domanda');
  expect(answer).toContain('class="agent-waiting-text"'); // the label is cut by its own box, never widens the tile (#157)
  autoCloseState.set([row({ waitingFor: 'children', waitingN: 2 })]);
  expect(html()).toContain('Aspetta 2 sotto-chat');
  autoCloseState.set([row({ waitingFor: 'children', waitingN: 1 })]);
  expect(html()).toContain('Aspetta 1 sotto-chat');
  autoCloseState.set([row({ waitingFor: 'command' })]);
  expect(html()).toContain('Aspetta Esegui');
  // a step of the user's (a report's userAction) has its own words, never «domanda» (#411)
  autoCloseState.set([row({ waitingFor: 'step' })]);
  expect(html()).toContain('Aspetta te: passo');
  expect(html()).toContain('data-waiting="step"');
  autoCloseState.set([row({ waitingFor: 'report' })]);
  expect(html()).toContain('Senza report');
  setLang('en'); expect(html()).toContain('No report');
});

it('shows nothing for a chat that waits for nothing, once kept open, or for a wait the strip\'s head already says (#411)', () => {
  autoCloseState.set([row({})]);
  expect(html()).toBe('');
  autoCloseState.set([row({ waitingFor: 'answer', keptOpen: true })]);
  expect(html()).not.toContain('autoclose-waiting');
  autoCloseState.set([row({ waitingFor: 'permission' })]);
  expect(renderToStaticMarkup(createElement(AutoCloseNotice, { chatId: 'w', said: true }))).toBe('');
  autoCloseState.set([row({ waitingFor: 'background', waitingN: 1 })]);
  expect(renderToStaticMarkup(createElement(AutoCloseNotice, { chatId: 'w', said: true }))).toBe('');
  expect(html()).toContain('In background: 1');
});

it('every status is at most three words, in it, en and de (#359), and none speaks of «the user» in third person', () => {
  for (const lang of ['it', 'en', 'de'] as const) {
    setLang(lang);
    for (const w of AUTO_CLOSE_WAITING) {
      const label = waitingLabel({ waitingFor: w, waitingN: 12, keptOpen: false, deadline: null })!;
      expect(label.trim().split(/\s+/).length, `${lang} ${w}: ${label}`).toBeLessThanOrEqual(3);
      expect(label).not.toMatch(/utente|the user|Benutzer|colleghi|colleagues|Kollegen/i);
    }
  }
});
