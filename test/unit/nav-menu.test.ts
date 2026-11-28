// The ☰ menu of the sidebar (lib/nav-menu.ts, ADR 0366, issue #491, ADR 0374): Grindhouse, Piani and Attività pianificate under
// Lavoro, then Impara, Scacchi, Agenti, Memoria, Andamento, Impostazioni in three groups; Registrazioni, Collegamenti and Log
// are hidden from it but remain pages of the app (reachable from the palette and the Orchestrator). «Attività pianificate»
// took Task's place, and Task's old links open it.
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
import { menuAlert, menuLabelKey, MENU_GROUPS, MENU_HIDDEN } from '../../src/renderer/lib/nav-menu';
import { menuNav } from '../../src/renderer/lib/app-map';
import { BRAIN_PAGES, PAGE_ALIAS, parseTarget } from '../../src/renderer/brain';

describe('the ☰ menu', () => {
  it('lists the pages in order, in three groups, «Attività pianificate» under Lavoro', () => {
    expect(MENU_GROUPS.map(g => g.id)).toEqual(['work', 'leisure', 'system']);
    expect(MENU_GROUPS.flatMap(g => g.pages)).toEqual(['home', 'piani', 'attivita', 'impara', 'scacchi', 'agenti', 'memoria', 'andamento', 'impostazioni']);
  });
  it('hides Registrazioni, Collegamenti and Log without removing them', () => {
    const listed = MENU_GROUPS.flatMap(g => g.pages);
    for (const id of MENU_HIDDEN) expect(listed).not.toContain(id);
    const pages = BRAIN_PAGES.map(p => p.id);
    for (const id of [...listed, ...MENU_HIDDEN]) expect(pages).toContain(id);
  });
  it('lights the dot only for waiting memory proposals', () => {
    expect(menuAlert(0)).toBe(false);
    expect(menuAlert(1)).toBe(true);
  });
  it('opens the new page from the old Task, Oggi, Adesso and DevOps links', () => {
    for (const old of ['task', 'oggi', 'adesso', 'dafare', 'devops']) {
      expect(PAGE_ALIAS[old]).toBe('attivita');
      expect(parseTarget(old)).toEqual({ map: false, id: 'attivita', arg: undefined });
    }
  });
  it('names Agenti and Impara as the menu does, every other page by its own label', () => {
    expect(menuLabelKey('agenti')).toBe('catalog.title');
    expect(menuLabelKey('impara')).toBe('dialogs.sidebar.news');
    expect(menuLabelKey('memoria')).toBeNull();
  });
  it('gives the Orchestrator the menu\'s groups, marked ☰, with each page\'s key', () => {
    const nav = menuNav();
    expect(nav.map(g => g.group.startsWith('☰ '))).toEqual([true, true, true]);
    expect(nav.flatMap(g => g.items.map(i => i.page))).toEqual(MENU_GROUPS.flatMap(g => g.pages));
    expect(nav.flatMap(g => g.items).find(i => i.page === 'memoria')).toMatchObject({ key: 'G Y' });
    expect(nav.flatMap(g => g.items).find(i => i.page === 'attivita')).toMatchObject({ key: 'G O' });
  });
});
