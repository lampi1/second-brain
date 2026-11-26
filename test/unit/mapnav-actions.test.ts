// Coordinator focus preserves the workspace beside its persistent column; used by navigation regressions.
import { beforeEach, expect, it, vi } from 'vitest';
import type { ChatSummary } from '../../src/shared/contract';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: () => () => {} } }));
import { brainBridge, focusChat, go, toggleOrchestrator } from '../../src/renderer/actions';
import { dispatch } from '../../src/renderer/store/store';
import { ui } from '../../src/renderer/store/ui';

beforeEach(() => {
  dispatch({ type: 'init', chats: [{ id: 'r', title: 'Orchestrator', isOrchestrator: true, orchestrator: true, state: 'idle', browserTabIds: [] } as unknown as ChatSummary], pending: [], tabs: [], feed: [], usage: null, info: null });
});
it('focuses the coordinator without leaving Memoria', () => {
  go({ page: 'memoria' });
  focusChat('r');
  expect(ui.get().page).toBe('memoria');
  expect(ui.get().map).toBe(false);
  expect(ui.get().focusReq?.chatId).toBe('r');
});
it.each([toggleOrchestrator, () => focusChat('r')])('redirects legacy mappa to 2D collegamenti and keeps it open when focusing the coordinator (%#)', focus => {
  go({ page: 'memoria' });
  go({ page: 'mappa' });
  focus();
  expect(ui.get().page).toBe('collegamenti');
  expect(ui.get().map).toBe(false);
  expect(ui.get().focusReq?.chatId).toBe('r');
});
it('keeps Memoria on the coordinator shortcut', () => {
  go({ page: 'memoria' });
  toggleOrchestrator();
  expect(ui.get().page).toBe('memoria');
  expect(ui.get().map).toBe(false);
  expect(ui.get().focusReq?.chatId).toBe('r');
});
it('prepares discussion beside Memoria without navigating or sending', () => {
  go({ page: 'memoria' });
  const onSent = vi.fn();
  expect(brainBridge.draftToOrchestrator('Discuss this brain note', onSent)).toBe(true);
  expect(ui.get().page).toBe('memoria');
  expect(ui.get().map).toBe(false);
  expect(ui.get().focusReq?.chatId).toBe('r');
  expect(onSent).not.toHaveBeenCalled();
});
it('keeps detail pages where the coordinator is already visible', () => {
  go({ page: 'skill' }); // a Memoria tab since ADR 0122
  focusChat('r');
  expect(ui.get().page).toBe('memoria');
  expect(ui.get().pageArg).toBe('skill');
});
