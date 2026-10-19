// The Orchestrator's "N novità in attesa" (renderer/components/HeldNews.tsx, #88), server-rendered: hidden when nothing
// waits, the count in Italian, the tooltip naming the first ones, the open list with chat, kind, since when and why;
// and the retired "Novità" feed's remembered toggle dropped from the prefs (store/ui.ts loadPrefs).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { HeldNewsItem } from '@shared/contract';
import { heldSummary, HeldNewsView } from '../../src/renderer/components/HeldNews';
import { loadPrefs } from '../../src/renderer/store/ui';

const NOW = Date.parse('2026-10-19T10:00:00Z');
const item = (p: Partial<HeldNewsItem>): HeldNewsItem => ({ orchestratorId: 'orchestrator', chatId: 'mappa', title: 'App · Mappa 3D', kind: 'done', at: NOW, why: 'user', ...p });
const view = (items: HeldNewsItem[], open: boolean) => renderToStaticMarkup(createElement(HeldNewsView, { items, open, now: NOW, onToggle: vi.fn(), onOpenChat: vi.fn() }));

describe('HeldNewsView', () => {
  it('shows nothing when nothing waits', () => {
    expect(view([], false)).toBe('');
  });

  it('closed: the count only, with the first ones in its tooltip', () => {
    const html = view([item({}), item({ chatId: 'fb', title: 'Feedback', kind: 'permission', why: 'quiet', at: NOW - 3 * 60_000 })], false);
    expect(html).toContain('2 novità in attesa');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-tip="App · Mappa 3D: Finita · Feedback: Permesso"');
    expect(html).not.toContain('orchestrator-held-list');
  });

  it('open: each held news with its chat, kind, since when and why; mail without a chat cannot be opened', () => {
    const html = view([item({}), item({ chatId: null, title: 'Fuori app', kind: 'mail', why: 'group', at: NOW - 3 * 60_000 })], true);
    expect(html).toContain('2 novità in attesa');
    expect(html).toContain('Finita'); expect(html).toContain('App · Mappa 3D'); expect(html).toContain('adesso');
    expect(html).toContain('aspetta la tua risposta all’Orchestrator');
    expect(html).toContain('Messaggio'); expect(html).toContain('da 3 min'); expect(html).toContain('arriva tra pochi secondi, insieme alle altre');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="orchestrator-held-mail"/);
  });

  it('the tooltip names three and counts the rest', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map(id => item({ chatId: id, title: id }));
    expect(heldSummary(many)).toBe('a: Finita · b: Finita · c: Finita · +2');
  });
});

it('the retired "Novità" feed toggle is dropped from the remembered prefs', () => {
  expect(loadPrefs(JSON.stringify({ feedOpen: true }), 0)).not.toHaveProperty('feedOpen');
});
