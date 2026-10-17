// Home regressions: missing observations never become zero/success; reuse documented quality semantics and i18n.
import { afterEach, describe, expect, it } from 'vitest';
import { HOME_CARDS, homeCost, homeTables } from './home-cards';
import { setLang } from '../../i18n';

afterEach(() => setLang('it'));
const read = (id: string, data: unknown) => HOME_CARDS.find(c => c.id === id)!.read({ cost: null, tables: homeTables(data) });
describe('Home card registry', () => {
  it('keeps four distinct card IDs and existing detail destinations', () => {
    expect(HOME_CARDS.map(c => c.id)).toEqual(['spend', 'works', 'errors', 'ideas']);
    expect(HOME_CARDS.map(c => c.target)).toEqual(['costi/7', 'qualita', 'qualita', 'idee']);
  });
  it('does not invent zero cost from an empty or malformed response', () => {
    for (const raw of [null, {}, { total: 0 }, { total: -1, calls: 1, from: '2026-10-10', to: '2026-10-17' }]) expect(homeCost(raw)).toBeNull();
  });
  it('accepts observed zero and explains list-price rather than actual billing', () => {
    const cost = homeCost({ total: 0, calls: 0, from: '2026-10-10', to: '2026-10-17' });
    const card = HOME_CARDS[0]!.read({ cost, tables: null });
    expect(card?.explanation).toContain('non è una fattura');
    expect(card?.value).toContain('0');
    expect(card?.source).toContain('2026-10-10');
  });
  it('distinguishes absent ideas/errors/rules from a valid empty inventory', () => {
    for (const id of ['ideas', 'errors', 'works']) expect(read(id, {})).toBeNull();
    expect(read('ideas', { ideas: [] })?.value).toBe('0');
    expect(read('errors', { errors: [], today: '2026-10-17' })?.value).toBe('0');
    expect(read('ideas', { ideas: [{}] })).toBeNull();
  });
  it('uses actual idea statuses and keeps work in progress distinct', () => {
    const r = read('ideas', { ideas: [{ stato: 'aperta' }, { stato: 'in corso' }, { stato: 'fatta' }, { stato: 'scartata' }] });
    expect(r?.value).toBe('1');
    expect(r?.explanation).toContain('altre 1');
  });
  it('does not count unjudged rules as observed successes', () => {
    const q = { windowDays: 14, from: '2026-10-01', to: '2026-10-17', rules: [
      { status: 'non-tornato' }, { status: 'tornato' }, { status: 'troppo-presto' }, { status: 'senza-tipo' },
    ] };
    const r = read('works', { quality: q });
    expect(r?.value).toBe('1/2');
    expect(r?.explanation).toContain('2 non valutabili');
    expect(r?.explanation).toContain('Non dimostra');
    expect(read('works', { quality: { ...q, rules: [] } })?.value).toBe('—');
  });
  it('renders all four titles and explanations in English', () => {
    setLang('en');
    expect(HOME_CARDS.map(c => c.title())).toEqual(['List-price spend', 'What works', 'Recurring errors', 'Open ideas']);
    expect(read('ideas', { ideas: [] })?.explanation).toContain('Ideas still');
  });
});
