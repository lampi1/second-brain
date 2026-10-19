// Unit tests of lib/stats.ts (ADR 0037): the plain-Italian reading of a number against its previous period, the AI
// errors grouped by pattern (count, weeks, areas, chats, owner, rules from rows and from recurrence.mjs, recurring vs
// once vs quiet) and the spend of the period before from a 2×days cost answer; plus the quote topic of lib/discuss.ts.
import { describe, expect, it } from 'vitest';
import type { ErrorRow, QRule } from '../../../src/renderer/brain/types';
import { errorPatterns, normType, previousSpend, rowType, trend } from '../../../src/renderer/brain/lib/stats';
import { chatPrompt, chatTitle, discussText, ERROR_QUESTION, topicKey, type Topic } from '../../../src/renderer/brain/lib/discuss';
import { caughtWeeks, type Caught } from '../../../src/renderer/brain/lib/quality';

const row = (o: Partial<ErrorRow>): ErrorRow => ({ data: '2026-10-13', ora: '10:00', chi: 'Orchestrator', area: 'QA', tipo: 'fatto-non-verificato', detto: 'd', vero: 'v', visto: 'Alex', regola: '', ...o });

describe('trend', () => {
  it('says down, up and stable in words, with the tone from lowerIsBetter', () => {
    const o = { what: 'errori', now: 'questa settimana', before: 'la scorsa' };
    expect(trend(3, 7, o)).toEqual({ dir: 'giu', good: true, text: 'in calo: 3 errori questa settimana contro 7 la scorsa' });
    expect(trend(7, 3, o)).toMatchObject({ dir: 'su', good: false, text: 'in aumento: 7 errori questa settimana contro 3 la scorsa' });
    expect(trend(10, 10.5, o)).toMatchObject({ dir: 'uguale', good: null });
    expect(trend(0, 0, o).text).toBe('stabile: 0 errori questa settimana contro 0 la scorsa');
    expect(trend(5, 2, { ...o, lowerIsBetter: false }).good).toBe(true);
  });
  it('never guesses a missing previous period', () => {
    expect(trend(4, null, { what: '', now: 'oggi', before: 'ieri' })).toEqual({ dir: null, good: null, text: '4 oggi; ieri nessun dato per confrontare' });
  });
});

describe('errorPatterns', () => {
  const rows = [
    row({ data: '2026-10-13', ora: '18:00', chi: 'QA ordini', area: 'QA', detto: 'passato', vero: 'fallito' }),
    row({ data: '2026-10-12', chi: 'Orchestrator', area: 'QA', visto: 'agente stesso' }),
    row({ data: '2026-10-03', chi: 'Orchestrator', area: 'PR', regola: 'rules/qa.md "screenshot"' }),
    row({ data: '2026-10-10', tipo: 'Regola ignorata', area: 'memoria' }),
    row({ data: '2026-10-01', tipo: 'regola-ignorata', area: 'memoria' }),
    row({ data: '2026-10-11', tipo: 'non-capito' }),
    row({ data: '2026-08-01', tipo: 'fuori-ruolo' }), row({ data: '2026-08-02', tipo: 'fuori-ruolo' }),
    row({ data: '2026-10-09', tipo: 'gergo strano' }),
    row({ data: '2026-10-09', tipo: '' }),
  ];
  const q: QRule[] = [{ date: '2026-09-20', type: 'fatto-non-verificato', area: 'QA', rule: 'rules/qa.md "verifica"', status: 'tornato', ageDays: 23, again: [] }];
  const p = errorPatterns(rows, q, '2026-10-13', 'Alex');

  it('groups by normalized type, busiest week first, with weeks, areas, chats and the owner count', () => {
    expect(p.recurring.map(g => g.type)).toEqual(['fatto-non-verificato', 'regola-ignorata']);
    const g = p.recurring[0]!;
    expect(g).toMatchObject({ count: 3, week: 2, prevWeek: 1, first: '2026-10-03', last: '2026-10-13', lastTime: '18:00', byOwner: 2, official: true });
    expect(g.areas).toEqual([['QA', 2], ['PR', 1]]);
    expect(g.chats[0]).toEqual(['Orchestrator', 2]);
    expect(g.latest.detto).toBe('passato');
  });
  it('joins the rules of recurrence.mjs (with outcome) and of the rows, newest first', () => {
    expect(p.recurring[0]!.rules).toEqual([
      { rule: 'rules/qa.md "screenshot"', status: null, date: '2026-10-03' },
      { rule: 'rules/qa.md "verifica"', status: 'tornato', date: '2026-09-20' },
    ]);
  });
  it('folds patterns seen once, quiet for 30 days and rows without a type', () => {
    expect(p.once).toBe(2); // non-capito, gergo-strano
    expect(p.quiet.map(g => g.type)).toEqual(['fuori-ruolo']);
    expect(p.unknown.map(r => r.data)).toEqual(['2026-10-09']);
    expect(p.week).toBe(6); // every dated row, the unreadable one too
    expect(p.from).toBe('2026-08-01');
  });
  it('normType reads labels as recurrence.mjs does', () => {
    expect(normType(' Regola ignorata ')).toBe('regola-ignorata');
    expect(normType('Fatto non verificato (dedotto)')).toBe('fatto-non-verificato');
    expect(normType('così_così')).toBe('cosi-cosi');
  });
});

describe('previousSpend', () => {
  const by = { '2026-10-01': { usd: 1 }, '2026-10-05': { usd: 2 }, '2026-10-06': { usd: 3 }, '2026-10-13': { usd: 4 } };
  it('sums the days before the current period', () => {
    expect(previousSpend(by, '2026-10-13', 7, '2026-09-30')).toEqual({ usd: 6, since: null }); // 2026-09-30 … 2026-10-06
    expect(previousSpend(by, '2026-10-13', 7, '2026-10-01')).toEqual({ usd: 6, since: '2026-10-01' }); // data starts inside
    expect(previousSpend(by, '2026-10-13', 1, '2026-10-12')).toBeNull(); // yesterday has no row
  });
  it('null when the previous window is empty', () => expect(previousSpend({}, '2026-10-13', 7, '2026-09-30')).toBeNull());
});

describe('caughtWeeks', () => {
  it('per 100 turns in the last 7 days against the 7 before', () => {
    const c = { to: '2026-10-13', days: [
      { date: '2026-10-01', turns: 100, caught: 4, others: 0 }, { date: '2026-10-06', turns: 100, caught: 2, others: 0 },
      { date: '2026-10-07', turns: 200, caught: 1, others: 0 }, { date: '2026-10-13', turns: 0, caught: 1, others: 0 },
    ] } as unknown as Caught;
    expect(caughtWeeks(c)).toEqual({ cur: 1, prev: 3, curDays: 2, prevDays: 2 });
  });
});

describe('quote topics', () => {
  const t: Topic = { kind: 'quote', quote: { id: 'err|fatto-non-verificato', what: 'errore', title: 'fatto non verificato', source: 'ai-errors.md', facts: ['3 volte', '', 'aree: QA (2)'] } };
  it('quotes source and facts and ends with the error question', () => {
    expect(discussText(t, null)).toBe(`Let's discuss the recurring error «fatto non verificato» (source: ai-errors.md).\n\n- 3 volte\n- aree: QA (2)\n\n${ERROR_QUESTION}`);
  });
  it('keys by id and titles the chat by kind', () => {
    expect(topicKey(t)).toBe('quote|err|fatto-non-verificato');
    expect(chatTitle(t)).toBe('Errore · fatto non verificato');
    expect(chatTitle({ kind: 'quote', quote: { ...(t as { quote: object }).quote, what: 'numero', title: 'spesa' } as never })).toBe('Numero · spesa');
    expect(chatPrompt(t, null)).toContain('on the recurring error «fatto non verificato» (source: ai-errors.md');
  });
});

// Lines shaped like the real ones of ai-errors.md (made up, no names) the brain's parser (brain-site/parse.mjs aiErrors) leaves without a type: no "detto:" /
// "vero:" labels, or no type field at all. The old Qualità table showed them as "—" (the owner, 2026-10-13).
describe('rowType on off-format lines', () => {
  const off = (riga: string): ErrorRow => row({ tipo: '', chi: '', area: '', detto: '', riga });
  it('reads the official type from the raw line when it is there', () => {
    expect(rowType(off('2026-10-07 21:40 · Orchestrator · hub · posto-sbagliato · bozza di un messaggio messa solo nell\'anteprima di un pannello · il proprietario non vede pannelli da dove segue · il proprietario ("che messaggio?")'))).toBe('posto-sbagliato');
    expect(rowType(off('2026-10-08 17:27 · Orchestrator + chat di rilascio · fatto-non-verificato · detto: \'impostazione rotta\' · vero: confermato · visto da: il proprietario'))).toBe('fatto-non-verificato');
  });
  it('has no type when the line has none: the page groups it as "Formato non riconosciuto" with the line', () => {
    const r = off('2026-10-11 · Orchestrator · app · detto: per la revisione la chat chiede al proprietario di lanciarla · vero: la chat ha i suoi reviewer · visto da: il proprietario');
    expect(rowType(r)).toBe('');
    const p = errorPatterns([r], [], '2026-10-13', 'proprietario');
    expect(p.unknown).toEqual([r]);
    expect(p.recurring).toEqual([]);
  });
  it('keeps a written type', () => expect(rowType(row({ tipo: 'Regola ignorata' }))).toBe('regola-ignorata'));
});

describe('rowType: more real shapes', () => {
  const off = (riga: string): ErrorRow => row({ tipo: '', riga });
  it('takes the field before an English "said:" when chat and area come first', () =>
    expect(rowType(off('2026-10-13 13:10 · App barra-fullscreen · second-brain top bar · regression · said: top bar fit fix done · true: broke after merge'))).toBe('regression'));
  it('reads "<tipo>: detto …" glued in one field', () =>
    expect(rowType(off('2026-10-13 11:20 · Orchestrator dell\'app · github · fatto-non-verificato: detto che il repo non va su GitHub · vero: va'))).toBe('fatto-non-verificato'));
  it('never takes the area for a type (chat · area · detto)', () =>
    expect(rowType(off('2026-10-11 · Orchestrator · second-brain app · detto: v1 pronta · vero: no'))).toBe(''));
});

describe('errorPatterns: a rule written on an alias row', () => {
  it('goes to the group that wrote it, with the outcome of recurrence.mjs', () => {
    const rows = [row({ tipo: 'fatto-presunto', regola: 'X' }), row({ tipo: 'fatto-presunto', data: '2026-10-12' }), row({}), row({ data: '2026-10-12' })];
    const q: QRule[] = [{ date: '2026-10-13', type: 'fatto-non-verificato', area: 'QA', rule: 'X', status: 'troppo-presto', ageDays: 0, again: [] }];
    const p = errorPatterns(rows, q, '2026-10-13', 'Alex');
    expect(p.recurring.find(g => g.type === 'fatto-presunto')!.rules).toEqual([{ rule: 'X', status: 'troppo-presto', date: '2026-10-13' }]);
    expect(p.recurring.find(g => g.type === 'fatto-non-verificato')!.rules).toEqual([]);
  });
});
