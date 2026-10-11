// Text helpers of the brain pages (src/renderer/brain/lib/text.ts): names not numbers, DevOps links in free text,
// decisions, the stand-up sentences (first person, names instead of numbers).
import { describe, expect, it } from 'vitest';
import { bugName, clean, countBy, devopsIndex, firstPerson, isDecision, isWorkArea, lastDiaryDay, linkify, ownerOf, prName, standupText, topicOf } from '../../../src/renderer/brain/lib/text';
import type { Brief, DayReport } from '../../../src/renderer/brain/types';

const PR = (n: number) => `https://dev.example.com/proj/_git/app/pullrequest/${n}`;
const WI = (n: number) => `https://dev.example.com/proj/_workitems/edit/${n}`;
const brief: Brief = {
  date: '2026-10-11', day: '2026-10-11', devops: true, areas: ['Prodotto', 'Personale e OS', 'Altro'],
  prs: [{ title: 'fix(orders): apply the discount once', target: 'main', url: PR(4102), area: 'Prodotto', votes: 'nessuno (4 revisori)', items: [
    { type: 'Bug', title: '[Fatture] - Sconto applicato due volte', state: 'Resolved', url: WI(90680) },
    { type: 'P-', title: 'test item', state: 'Active', url: WI(90720) }] }],
  items: [{ type: 'Bug', title: '[Login] - Sessione scaduta', state: 'New', url: WI(90750), aiFound: false, area: 'Prodotto' }],
  threads: [
    { section: 'Lavoro', label: 'Prodotto · Fix sconto', date: '2026-10-11', next: 'prossimo: aspetta la revisione della !4102', stale: false, done: false, area: 'Prodotto' },
    { section: 'Lavoro', label: 'Prodotto · Stampa', date: '2026-10-11', next: 'prossimo: rieseguire il test dopo il fix #90680', stale: false, done: false, area: 'Prodotto' },
    { section: 'Lavoro', label: 'Clienti · Export', date: '2026-10-10', next: 'prossimo: Alex decide se il PDF entra', stale: false, done: false, area: 'Prodotto' },
    { section: 'Agenti e sessioni attive', label: 'Regia', date: '2026-10-11', next: 'prossimo: scaletta', stale: false, done: false, area: 'Personale e OS' },
  ],
  text: '',
};
const rep: DayReport = {
  date: '2026-10-10', day: '2026-10-10', devops: true, areas: ['Prodotto', 'Personale e OS'], commits: [], text: '',
  rows: [
    { kind: 'pr-unita', title: '#90680 fix(orders): apply the discount once', area: 'Prodotto', url: PR(4101) },
    { kind: 'diario', title: 'Web · Export: CSV verificato', tag: 'fatto', area: 'Prodotto' },
    { kind: 'chat', title: 'QA note', his: 3, area: 'Prodotto' },
    { kind: 'diario', title: 'OS · Mappa: vista essenziale', tag: 'fatto', area: 'Personale e OS' },
  ],
};

describe('names not numbers', () => {
  it('clean drops a leading id, the commit prefix and double spaces', () => {
    expect(clean('#4242 fix(api):  send the orders')).toBe('send the orders');
    expect(clean('feat!: big change')).toBe('big change');
  });
  it('bugName drops the [Area] - prefix; topicOf reads it', () => {
    expect(bugName('[Fatture] - Sconto applicato due volte')).toBe('Sconto applicato due volte');
    expect(topicOf('[Fatture] - Nota')).toBe('Fatture');
  });
  it('a PR is named after the bug it fixes (P- items skipped), else after its title', () => {
    expect(prName(brief.prs[0]!)).toBe('Sconto applicato due volte');
    expect(prName({ title: 'chore(print): list layout', items: [] })).toBe('list layout');
  });
});

describe('owner', () => {
  it('ownerOf is the most common non-AI author; firstPerson drops the name', () => {
    expect(ownerOf([{ chi: 'IA' }, { chi: 'Alex' }, { chi: 'Alex' }, { chi: 'Sam' }])).toBe('Alex');
    expect(ownerOf([{ chi: 'IA' }])).toBe('');
    expect(firstPerson('Alex decide se Alex parte', 'Alex')).toBe('decide se parte');
    expect(firstPerson('nessun nome', '')).toBe('nessun nome');
  });
  it('a decision waits for the owner; agents and done threads never are', () => {
    expect(isDecision(brief.threads[2]!, 'Alex')).toBe(true);
    expect(isDecision({ next: 'prossimo: scegli il layout', done: false, section: 'Lavoro' })).toBe(true);
    expect(isDecision({ next: 'prossimo: aspetta Alex', done: false, section: 'Lavoro' }, 'Alex')).toBe(true);
    expect(isDecision({ next: 'prossimo: decide', done: true, section: 'Lavoro' })).toBe(false);
    expect(isDecision({ next: 'decide', done: false, section: 'Agenti e sessioni attive' })).toBe(false);
  });
  it('work areas leave out the personal one and the catch-all', () => {
    expect(['Prodotto', 'Personale e OS', 'Altro', 'Produzione'].filter(isWorkArea)).toEqual(['Prodotto', 'Produzione']);
  });
});

describe('DevOps links', () => {
  const idx = devopsIndex(brief);
  it('indexes PRs, their work items and your work items by id', () => {
    expect(idx.get('4102')).toMatchObject({ kind: 'PR', name: 'Sconto applicato due volte' });
    expect(idx.get('90680')).toMatchObject({ kind: 'Bug', url: WI(90680) });
    expect(idx.get('90750')?.name).toBe('Sessione scaduta');
  });
  it('linkify turns known numbers into named links; a bare 4-digit number stays text', () => {
    const parts = linkify('aspetta la !4102, poi il fix #90680; nel 2026 e 4102 da solo', idx);
    const links = parts.filter(p => typeof p !== 'string');
    expect(links.map(l => (typeof l === 'string' ? '' : l.label))).toEqual(['PR «Sconto applicato due volte»', '«Sconto applicato due volte»']);
    expect(parts.filter(p => typeof p === 'string').join('')).toContain('nel 2026 e 4102 da solo');
    expect(linkify('niente', new Map())).toEqual(['niente']);
  });
});

describe('stand-up', () => {
  const text = standupText(rep, brief, 'Alex');
  const lines = text.split('\n');
  it('says what was done on the work day, by work area only', () => {
    expect(lines[0]).toMatch(/^\w{3} 10\/10 · Prodotto: ho unito la PR «apply the discount once»/);
    expect(lines[0]).toContain('ho chiuso «Export»');
    expect(lines[0]).not.toContain('Mappa');
  });
  it('open PRs named after their bug, today next steps and what you wait for, with names instead of numbers', () => {
    expect(text).toContain('Ho una PR aperta: «Sconto applicato due volte», aspettano revisione.');
    expect(text).toMatch(/Oggi: .*Stampa \(rieseguire il test dopo il fix «Sconto applicato due volte»\)/);
    expect(text).toMatch(/Aspetto: .*Fix sconto \(aspetta la revisione della PR «Sconto applicato due volte»\)/);
    expect(text).not.toMatch(/4102|90680/);
    expect(text).not.toContain('Alex');
  });
  it('an empty day is said, never invented', () => {
    expect(standupText({ rows: [], day: '2026-10-10', areas: [] }, null)).toMatch(/niente di registrato sul lavoro/);
  });
});

describe('small helpers', () => {
  it('countBy sorts by count then name; empty keys count as —', () => {
    expect(countBy([{ k: 'b' }, { k: 'a' }, { k: 'b' }, { k: '' }], r => r.k)).toEqual([['b', 2], ['—', 1], ['a', 1]]);
  });
  it('lastDiaryDay is the last day before today with a diary line', () => {
    expect(lastDiaryDay([{ data: '2026-10-08' }, { data: '2026-10-11' }, { data: '2026-10-09' }], '2026-10-11')).toBe('2026-10-09');
    expect(lastDiaryDay([], '2026-10-11')).toBe('2026-10-11');
  });
});
