// Coordinator focus preserves the workspace beside its persistent column; used by navigation regressions.
import { beforeEach, expect, it, vi } from 'vitest';
import type { ChatSummary } from '../../src/shared/contract';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: () => () => {} } }));
import { brainBridge, focusChat, go, showTab, toggleFocusMode, toggleMaximize, toggleOrchestrator } from '../../src/renderer/actions';
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
it.each([toggleOrchestrator, () => focusChat('r')])('keeps the 3D map open when focusing the coordinator (%#)', focus => {
  go({ page: 'memoria' });
  go({ page: 'mappa' });
  focus();
  expect(ui.get().page).toBe('memoria');
  expect(ui.get().map).toBe(true);
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
  go({ page: 'regole' }); // a Memoria tab since ADR 0122
  focusChat('r');
  expect(ui.get().page).toBe('memoria');
  expect(ui.get().pageArg).toBe('regole');
});

it('opens routine chats and owned browsers only in Routine, including focus shortcuts', () => {
  dispatch({ type: 'chat:updated', chat: { id: 'routine-worker', title: 'Routine worker', state: 'running', routine: { runId: 'run', stepId: 'inspect' }, browserTabIds: [] } as unknown as ChatSummary });
  focusChat('routine-worker'); expect(ui.get().page).toBe('flussi'); expect(ui.get().pageArg).toBe('chat:routine-worker');
  go({ page: 'home' }); ui.set(state => ({ ...state, focused: 'chat:routine-worker', focusMode: null })); toggleFocusMode();
  expect(ui.get().page).toBe('flussi'); expect(ui.get().focusMode).toBeNull();
  go({ page: 'home' }); toggleMaximize('chat:routine-worker'); expect(ui.get().page).toBe('flussi'); expect(ui.get().maximized).toBeNull();
  dispatch({ type: 'browser:tabs', tabs: [{ id: 'routine-browser', ownerChatId: 'routine-worker' }] as never });
  showTab('routine-browser'); expect(ui.get().page).toBe('flussi'); expect(ui.get().pageArg).toBe('chat:routine-worker/browser:routine-browser');
});
