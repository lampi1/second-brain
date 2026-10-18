// Coordinator focus preserves the workspace beside its persistent column; used by navigation regressions.
import { beforeEach, expect, it, vi } from 'vitest';
import type { ChatSummary } from '../../src/shared/contract';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: () => () => {} } }));
import { brainBridge, focusChat, go, toggleRegia } from '../../src/renderer/actions';
import { dispatch } from '../../src/renderer/store/store';
import { ui } from '../../src/renderer/store/ui';

beforeEach(() => {
  dispatch({ type: 'init', chats: [{ id: 'r', title: 'Regia', isRegia: true, orchestrator: true, state: 'idle', browserTabIds: [] } as unknown as ChatSummary], pending: [], tabs: [], feed: [], usage: null, info: null });
});
it('focuses the coordinator without leaving Dashboard', () => {
  go({ page: 'dashboard' });
  focusChat('r');
  expect(ui.get().page).toBe('dashboard');
  expect(ui.get().map).toBe(false);
  expect(ui.get().focusReq?.chatId).toBe('r');
});
it.each([toggleRegia, () => focusChat('r')])('keeps the 3D map open when focusing the coordinator (%#)', focus => {
  go({ page: 'dashboard' });
  go({ page: 'mappa' });
  focus();
  expect(ui.get().page).toBe('dashboard');
  expect(ui.get().map).toBe(true);
  expect(ui.get().focusReq?.chatId).toBe('r');
});
it('keeps Dashboard on the coordinator shortcut', () => {
  go({ page: 'dashboard' });
  toggleRegia();
  expect(ui.get().page).toBe('dashboard');
  expect(ui.get().map).toBe(false);
  expect(ui.get().focusReq?.chatId).toBe('r');
});
it('prepares discussion beside Dashboard without navigating or sending', () => {
  go({ page: 'dashboard' });
  const onSent = vi.fn();
  expect(brainBridge.draftToRegia('Discuss this brain note', onSent)).toBe(true);
  expect(ui.get().page).toBe('dashboard');
  expect(ui.get().map).toBe(false);
  expect(ui.get().focusReq?.chatId).toBe('r');
  expect(onSent).not.toHaveBeenCalled();
});
it('keeps detail pages where the coordinator is already visible', () => {
  go({ page: 'procedure' });
  focusChat('r');
  expect(ui.get().page).toBe('procedure');
});
