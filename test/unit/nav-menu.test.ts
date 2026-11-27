// The ☰ menu of the sidebar (lib/nav-menu.ts, ADR 0366, issue #491): exactly Grindhouse, Piani, Impara, Scacchi, Agenti,
// Memoria, Andamento, Impostazioni in three groups; Task, Registrazioni, Collegamenti and Log are hidden from it but
// remain pages of the app (reachable from the palette and the Orchestrator).
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
import { MENU_GROUPS, MENU_HIDDEN } from '../../src/renderer/lib/nav-menu';
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
});
