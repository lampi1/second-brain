// Explicit coordinator focus must leave full-width maps so keyboard and draft entry points stay visible.
import { beforeEach, expect, it, vi } from 'vitest';
import type { ChatSummary } from '../../src/shared/contract';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: () => () => {} } }));
import { focusChat, go, toggleRegia } from '../../src/renderer/actions';
import { dispatch } from '../../src/renderer/store/store';
import { ui } from '../../src/renderer/store/ui';

beforeEach(() => {
  dispatch({ type: 'init', chats: [{ id: 'r', title: 'Regia', isRegia: true, orchestrator: true, state: 'idle', browserTabIds: [] } as unknown as ChatSummary], pending: [], tabs: [], feed: [], usage: null, info: null });
});
it('reveals the coordinator when focusing it from Dashboard', () => {
  go({ page: 'dashboard' });
  focusChat('r');
  expect(ui.get().page).toBe('home');
  expect(ui.get().map).toBe(false);
});
it('leaves the full-screen map on the coordinator shortcut', () => {
  go({ page: 'mappa' });
  toggleRegia();
  expect(ui.get().page).toBe('home');
  expect(ui.get().map).toBe(false);
});
it('keeps detail pages where the coordinator is already visible', () => {
  go({ page: 'procedure' });
  focusChat('r');
  expect(ui.get().page).toBe('procedure');
});
