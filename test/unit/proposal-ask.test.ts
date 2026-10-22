// A Proposte card in plain words (lib/proposal-ask.ts, ADR 0126): every kind of card asks one question with what each
// answer does, role ids become names, the raw scope becomes «nel progetto …», a fact with an empty predicate is its value.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Proposal } from '../../src/shared/proposals';
import type { cardWords as CardWords } from '../../src/renderer/lib/proposal-ask';

let cardWords: typeof CardWords;
beforeAll(async () => {
  const i18n = await import('../../src/renderer/i18n');
  i18n.setLang('it');
  ({ cardWords } = await import('../../src/renderer/lib/proposal-ask'));
});
const card = (x: Partial<Proposal>): Proposal => ({ id: 'x:1', source: 'memory', group: 'fact', applied: false, title: 'setup · note', content: '', facts: [], canApprove: true, canReject: true,
  provenance: { who: { kind: 'role', id: 'scout' }, at: '2026-10-22T13:37:00Z', evidence: [] }, ask: { kind: 'skill', name: 'x' }, ...x });

describe('cardWords', () => {
  it('a fact: who remembers it, where it holds, what each answer does; never «setup · note» or roleId', () => {
    const w = cardWords(card({ content: 'I prompt stanno in tmp/', ask: { kind: 'remember', role: 'scout', subject: 'setup', predicate: 'note', project: 'C:\\Users\\d\\brain-v2' } }));
    expect(w).toMatchObject({ question: 'Scout deve ricordarsi questo?', lead: 'I prompt stanno in tmp/', scope: 'Vale nel progetto «brain-v2».', yes: expect.stringContaining('Scout'), no: 'Scout lo dimentica.' });
    expect(JSON.stringify(w)).not.toMatch(/roleId|setup · note/);
    expect(cardWords(card({ content: 'il prezzo scontato', ask: { kind: 'remember', subject: 'Rimborsi', predicate: 'si calcolano su' } })).lead).toBe('Rimborsi si calcolano su il prezzo scontato');
  });
  it('a contradicted fact says what replace and keep both do', () => {
    const c = card({ content: 'nuovo', ask: { kind: 'remember', role: 'scout', subject: 's', predicate: 'note', conflicts: [{ id: 'o', value: 'vecchio' }] } });
    expect(cardWords(c).yes).toContain('Prima scegli');
    expect(cardWords(c, 'new').yes).toBe('Scout ricorda il nuovo al posto del vecchio.');
    expect(cardWords(c, 'both').yes).toBe('Scout ricorda il nuovo insieme al vecchio.');
  });
  it('a batch of facts, a fact proposed several times and a case-specific one say so in words (ADR 0128)', () => {
    const many = cardWords(card({ content: '- a\n- b\n- c', ask: { kind: 'remember', role: 'artisan', subject: '', predicate: '', many: 3 } }));
    expect(many).toMatchObject({ question: 'Artisan deve ricordarsi questi 3 fatti?', yes: expect.stringContaining('tutti'), no: 'Artisan li dimentica tutti.', lead: '' });
    expect(many.hideBody).toBeFalsy();
    const one = cardWords(card({ content: 'Statistiche: https://localhost:44309', ask: { kind: 'remember', role: 'artisan', subject: 'setup', predicate: 'note', specific: ['url', 'date'], same: 2 } }));
    expect(one.advice).toBe('Sembra legato a un caso solo (un indirizzo con porta o id e una data): vale la pena ricordarlo solo se è una regola che si ripete. Proposto 2 volte: una carta sola per tutte.');
  });
  it('every other kind asks a question in words', () => {
    const qs = [
      card({ ask: { kind: 'skill', name: 'triage' } }),
      card({ applied: true, title: 'Memoria di Sentinel: 4 righe unite', ask: { kind: 'applied', what: 'memory', action: 'merge', name: 'memory', role: 'sentinel' } }),
      card({ applied: true, ask: { kind: 'applied', what: 'script', action: 'create', name: 'conta.mjs' } }),
      card({ source: 'setting', title: 'Battito: budget giornaliero ($)', facts: [{ key: 'target', value: 'pulse.dailyUsd' }], ask: { kind: 'setting', label: 'x', before: '0.25', after: '0.4' } }),
      card({ ask: { kind: 'trial', role: 'scout', version: 4, baseline: 3, advice: 'keep' } }),
      card({ ask: { kind: 'tier', roles: ['scout', 'judge'], tier: 'top', skills: [] } }),
      card({ ask: { kind: 'rule', role: 'artisan' } }),
      card({ ask: { kind: 'policy', domain: 'routing', name: 'stessa area', cases: 24 } }),
    ].map(c => cardWords(c));
    for (const w of qs) { expect(w.question).toMatch(/\?$/); expect(w.yes).toBeTruthy(); expect(w.no).toBeTruthy(); }
    expect(qs.map(w => w.question)).toEqual([
      'Aggiungo la skill «triage» al tuo brain?',
      'L’app ha cambiato da sola la memoria di Sentinel: va bene così?',
      'L’app ha aggiunto da sola lo script «conta.mjs»: va bene così?',
      expect.stringMatching(/^Cambio «.+» da 0.25 a 0.4\?$/),
      'Tieni la nuova versione di Scout?',
      expect.stringMatching(/^Porto Scout e .+ al livello alto\?$/),
      'Artisan deve seguire questa regola?',
      'Cambio il modo in cui l’app sceglie modello e motore per ogni lavoro?',
    ]);
    expect(qs[4]!.no).toBe('Scout torna alla versione 3, quella di prima.');
  });
});
