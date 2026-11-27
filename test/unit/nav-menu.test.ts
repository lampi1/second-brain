// The ☰ menu of the sidebar (lib/nav-menu.ts, ADR 0366, issue #491): exactly Grindhouse, Piani, Impara, Scacchi, Agenti,
// Memoria, Andamento, Impostazioni in three groups; Task, Registrazioni, Collegamenti and Log are hidden from it but
// remain pages of the app (reachable from the palette and the Orchestrator); Task returns while it has unread items.
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
import { menuAlert, menuGroups, MENU_GROUPS, MENU_HIDDEN } from '../../src/renderer/lib/nav-menu';
import { BRAIN_PAGES } from '../../src/renderer/brain';

describe('the ☰ menu', () => {
  it('lists the eight pages of the issue, in order, in three groups', () => {
    expect(MENU_GROUPS.map(g => g.id)).toEqual(['work', 'leisure', 'system']);
    expect(MENU_GROUPS.flatMap(g => g.pages)).toEqual(['home', 'piani', 'impara', 'scacchi', 'agenti', 'memoria', 'andamento', 'impostazioni']);
  });
  it('hides Task, Registrazioni, Collegamenti and Log without removing them', () => {
    const listed = MENU_GROUPS.flatMap(g => g.pages);
    for (const id of MENU_HIDDEN) expect(listed).not.toContain(id);
    const pages = BRAIN_PAGES.map(p => p.id);
    for (const id of [...listed, ...MENU_HIDDEN]) expect(pages).toContain(id);
  });
  it('brings Task back under Lavoro while it has unread items, and those light the dot', () => {
    expect(menuGroups(0)).toBe(MENU_GROUPS);
    expect(menuGroups(3).find(g => g.id === 'work')!.pages).toEqual(['home', 'piani', 'task']);
    expect(menuGroups(3).flatMap(g => g.pages).filter(id => id === 'task')).toHaveLength(1);
    expect(MENU_GROUPS.find(g => g.id === 'work')!.pages).toEqual(['home', 'piani']); // never mutated
    expect(menuAlert(0, 0)).toBe(false);
    expect(menuAlert(0, 2)).toBe(true);
    expect(menuAlert(1, 0)).toBe(true);
    expect(menuAlert(0, -1)).toBe(false);
  });
});
