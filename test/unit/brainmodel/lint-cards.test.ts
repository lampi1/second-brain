// The brain lint's cards (ADR 0194, brainmodel/lint-cards.ts): each finding asks one plain question in the UI language;
// a link becomes its plain text; a revert card states the numbers; the Proposte deck files them under the right chip and
// says «riuscito se…» with what to expect.
import { describe, expect, it } from 'vitest';
import { lintCard, plainLink, revertCard } from '../../../src/main/brainmodel/lint-cards';
import { SOURCES, type ProposalPorts } from '../../../src/main/proposals/sources';
import type { ResearchProposal } from '../../../src/shared/maintenance-research';

describe('lint cards', () => {
  it('words each check as a question, in Italian or English', () => {
    expect(lintCard({ check: 'stale-fact', key: 'k', memoryId: 'm', target: 'docs/a.md', about: 'Fatto' }, 'it')).toMatchObject({ kind: 'lint', title: 'Il file citato non c\'è più: tolgo il fatto', removes: 'Fatto', lint: { lang: 'it' } });
    expect(lintCard({ check: 'stale-cite', key: 'k', file: 'rules/x.md', target: 'a/b.md', line: '- vedi a/b.md' }, 'en').title).toBe('The rule «rules/x.md» cites a file that is gone: remove the line');
    expect(lintCard({ check: 'concept', key: 'k', target: 'Saldo', about: '4', citedBy: ['a.md', 'b/c.md'] }, 'it')).toMatchObject({ title: '«Saldo» compare in 4 note senza una nota sua: la creo', adds: expect.stringContaining('Citato in: [[a]], [[c]].') });
    expect(lintCard({ check: 'broken-link', key: 'k', file: 'n.md', target: 'X', line: 'vedi [qui](x.md) ora', about: '[qui](x.md)' }, 'it')).toMatchObject({ adds: 'vedi qui ora', removes: 'vedi [qui](x.md) ora' });
  });
  it('turns a link into its text', () => {
    expect(plainLink('a [[T|alias]] b', '[[T|alias]]')).toBe('a alias b');
    expect(plainLink('a [[T#h]] b', '[[T#h]]')).toBe('a T b');
    expect(plainLink('a ![img](p.png) b', '![img](p.png)')).toBe('a img b');
  });
  it('a revert card states what got worse', () => {
    const c = revertCard({ changeId: 'c1', kind: 'skill', summary: 'Nuova skill «x»', criterion: { metric: 'skill-used', skill: 'x', n: 3 }, check: { at: 1, before: 0, after: 1, nBefore: 0, nAfter: 1, verdict: 'worse' } }, 'en');
    expect(c).toMatchObject({ kind: 'revert', title: 'This change did not help: undo it («Nuova skill «x»»)', why: 'The skill «x» was used 1 time in the week after (3 wanted).' });
  });
});

describe('the Proposte deck', () => {
  const research = SOURCES.find(s => s.id === 'research')!;
  const card = (x: Partial<ResearchProposal>): ResearchProposal => ({ id: 'r-1', chatId: null, at: 0, kind: 'lint', title: 't', adds: '', removes: '', why: 'w', evidence: [], sources: [], expected: 'e', risk: '', state: 'open', ...x });
  const ports = (list: ResearchProposal[]): ProposalPorts => ({ now: () => 0, runs: () => [], chats: () => [], reviewed: { has: () => false, mark: () => {} }, research: { list: () => list, approve: () => {}, reject: () => {} } });
  it('files lint and revert cards under their chip and says «riuscito se…»', async () => {
    const out = await research.list(ports([
      card({ id: 'a', lint: { check: 'stale-fact', key: 'k', about: 'Il fatto' } }), card({ id: 'b', lint: { check: 'orphan', key: 'o', file: 'x.md' } }),
      card({ id: 'c', lint: { check: 'stale-cite', key: 's', file: '.claude/skills/x/SKILL.md', line: '- riga' } }),
      card({ id: 'd', kind: 'revert', revert: { changeId: 'z', kind: 'agent', summary: 's', criterion: { metric: 'fewer-corrections' }, check: { at: 0, before: 1, after: 2, nBefore: 3, nAfter: 3, verdict: 'worse' } } }),
      card({ id: 'e', kind: 'rule', change: { target: 'rule', text: 'x' }, success: { metric: 'fewer-corrections', text: 'Riuscito se calano.' } }),
    ]));
    expect(out.map(c => [c.id, c.group])).toEqual([['research:a', 'fact'], ['research:b', 'note'], ['research:c', 'skill'], ['research:d', 'role'], ['research:e', 'rule']]);
    expect(out[0]!.content).toBe('> Il fatto');
    expect(out[2]!.content).toBe('> - riga');
    expect(out[1]!.provenance.files).toEqual(['x.md']);
    expect(out[4]!.ask).toMatchObject({ kind: 'research', expected: 'e Riuscito se calano.' });
  });
});
