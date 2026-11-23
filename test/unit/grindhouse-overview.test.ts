// The Grindhouse entries (menu click, Ctrl+1, Esc) always land on the all-agents overview, never on one open chat
// (owner, 2026-11-23). Opening a single chat from the sidebar tree still expands it.
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: () => () => {} } }));
import { escapeOne, focusTile, go, showOverview } from '../../src/renderer/actions';
import { collapseAllChats, setCenter, setChatExpanded, setFocusMode, setMaximized, ui } from '../../src/renderer/store/ui';

const openIds = () => Object.entries(ui.get().prefs.chatExpanded).filter(([, v]) => v === true).map(([id]) => id);

beforeEach(() => { collapseAllChats(); go({ page: 'home' }); });

it('the menu entry folds every open chat and shows the overview, from another page too', () => {
  setChatExpanded('a', true); setChatExpanded('b', true);
  go({ page: 'andamento' });
  showOverview();
  expect(ui.get().page).toBe('home');
  expect(openIds()).toEqual([]);
});

it('the menu entry also leaves focus mode, a maximized tile and the centre view (they would reopen the chat full screen)', () => {
  setChatExpanded('a', true);
  setFocusMode('a'); setCenter(true);
  showOverview();
  expect(ui.get().focusMode).toBeNull();
  expect(ui.get().center).toBe(false);
  expect(ui.get().maximized).toBeNull();
  setMaximized('chat:a');
  showOverview();
  expect(ui.get().maximized).toBeNull();
});

it('Ctrl+1 does the same', () => {
  setChatExpanded('a', true);
  focusTile(1);
  expect(openIds()).toEqual([]);
  expect(ui.get().page).toBe('home');
});

it('Esc on an open chat folds it (one level back), then has nothing left to back out of', () => {
  setChatExpanded('a', true);
  expect(escapeOne()).toBe(true);
  expect(openIds()).toEqual([]);
  expect(escapeOne()).toBe(false);
});

it('collapseAllChats says whether anything was open and keeps the other prefs', () => {
  expect(collapseAllChats()).toBe(false);
  setChatExpanded('a', true);
  expect(collapseAllChats()).toBe(true);
  expect(ui.get().prefs.chatExpanded.a).toBe(false);
  expect(openIds()).toEqual([]);
});
