// «Chiedi alla Guida» (ADR 0196): which cards go into the prompt (within the one-shot's limit), the citations kept only
// when they name a card or a file that was given, the answer split into pieces for the page, and the main service with a
// fake engine: the question goes to Flash's engine at the light tier with no tools, the answer comes back with its cost;
// no engine, a failure and an invalid question are told apart. Plus the German report for the maintenance (G5).
import { describe, expect, it, vi } from 'vitest';
import { CONCEPTS, type ConceptCard } from '@shared/concept-guide';
import { GUIDE_DE } from '@shared/concept-guide.de';
import { answerPieces, citations, guidePrompt, rankCards } from '@shared/guide-ask';
import { germanReport, germanReportText } from '@shared/guide-german';
import type { OneShotRequest, OneShotResult } from '../../src/main/agents/oneshot';
import { GuideService } from '../../src/main/guide/service';

const result = (over: Partial<OneShotResult> = {}): OneShotResult => ({ ok: true, text: 'Usa agent_delegate [card:delegation], vedi `src/shared/delegation.ts` e `src/nope.ts` [card:made-up].',
  engine: 'claude', model: 'haiku', costUsd: 0.0012, costBasis: 'reported', tokens: null, durationMs: 5, ...over });

describe('the cards that go into the prompt', () => {
  it('ranks by the question\'s words, the title weighing most', () => {
    expect(rankCards('come funziona la delega tra ruoli?', 'it')[0]!.id).toBe('delegation');
    expect(rankCards('Grindhouse', 'en')[0]!.id).toBe('grindhouse');
    expect(rankCards('?? !!', 'it')).toEqual([]);
  });
  it('stays within the one-shot\'s 12 000 characters, with every card listed and the app map', () => {
    for (const q of ['permessi e tetto', 'come funziona tutto: ruoli, run, metriche, costi, brain, memoria, ricerca', 'xyz']) {
      const { prompt, given } = guidePrompt(q, 'it', 'Left rail: '.repeat(500));
      expect(prompt.length).toBeLessThanOrEqual(12_000);
      expect(given.length).toBeGreaterThan(0);
      for (const c of CONCEPTS) expect(prompt).toContain(`${c.id}: `);
      expect(prompt).toContain('App map (app_guide index)');
    }
    // no word in common: the prominent card goes in
    expect(guidePrompt('xyz', 'en', '').given.map(c => c.id)).toEqual(['every-task-agent']);
  });
});

describe('citations', () => {
  const given = [CONCEPTS.find(c => c.id === 'delegation')!] as ConceptCard[];
  it('keeps known cards and the given cards\' files only', () => {
    expect(citations(result().text, given)).toEqual({ cards: ['delegation'], files: ['src/shared/delegation.ts'] });
  });
  it('splits a line into text, card links, files and plain code', () => {
    expect(answerPieces('A [card:delegation] b `src/x.ts` c `npm run` [card:zzz]', new Set(['delegation']), new Set(['src/x.ts']))).toEqual([
      { kind: 'text', text: 'A ' }, { kind: 'card', id: 'delegation' }, { kind: 'text', text: ' b ' }, { kind: 'file', path: 'src/x.ts' },
      { kind: 'text', text: ' c ' }, { kind: 'code', text: 'npm run' }, { kind: 'text', text: ' ' },
    ]);
  });
});

describe('GuideService.ask (fake engine)', () => {
  const make = (r: OneShotResult, index = async () => 'Left rail: Grindhouse') => {
    const runOnce = vi.fn(async (_req: OneShotRequest) => r);
    return { runOnce, svc: new GuideService({ runOnce, index, repoRoot: null }) };
  };
  it('asks Flash\'s engine at the light tier, no role text, and returns the cited answer with its cost', async () => {
    const { runOnce, svc } = make(result());
    const a = await svc.ask({ question: 'Come delego un lavoro?', lang: 'it' });
    const req = runOnce.mock.calls[0]![0];
    expect(req).toMatchObject({ agentId: 'flash', purpose: 'guide', light: true });
    expect(req.system).toContain('Answer in Italian');
    expect(req.prompt).toContain('Question: Come delego un lavoro?');
    expect(req.prompt).toContain('Left rail: Grindhouse');
    expect(a).toMatchObject({ ok: true, cards: ['delegation'], costUsd: 0.0012, costBasis: 'reported', model: 'haiku' });
  });
  it('tells no engine and a failure apart, and never asks an invalid question', async () => {
    const none = make(result({ ok: false, text: '', noEngine: true, reason: 'Nessun motore isolato disponibile', costUsd: null, costBasis: 'unknown' }));
    expect(await none.svc.ask({ question: 'Ciao?', lang: 'it' })).toMatchObject({ ok: false, noEngine: true });
    const bad = make(result({ ok: false, text: '', reason: 'timeout' }), async () => { throw new Error('no window'); });
    expect(await bad.svc.ask({ question: 'Ciao?', lang: 'en' })).toMatchObject({ ok: false, reason: 'timeout' });
    const skip = make(result());
    expect(await skip.svc.ask({ question: ' ', lang: 'it' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await skip.svc.ask({ question: 'x'.repeat(501), lang: 'it' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(skip.runOnce).not.toHaveBeenCalled();
  });
  it('checks nothing in a packaged build', () => {
    expect(make(result()).svc.stale()).toEqual({ checked: false, cards: [] });
  });
});

describe('German for the maintenance', () => {
  it('has nothing to translate today', () => {
    expect(germanReport(CONCEPTS, GUIDE_DE)).toEqual({ gaps: [], orphans: [] });
    expect(germanReportText(germanReport(CONCEPTS, GUIDE_DE))).toBe('');
  });
  it('lists an English text that changed, with its old German beside it', () => {
    const card = CONCEPTS.find(c => c.id === 'delegation')!;
    const old = card.points[0]!.en;
    const changed = { ...card, points: [{ it: card.points[0]!.it, en: `${old} Also new.` }, ...card.points.slice(1)] };
    const r = germanReport([changed], GUIDE_DE);
    expect(r.gaps).toEqual([{ card: 'delegation', missing: [{ en: `${old} Also new.`, was: { en: old, de: GUIDE_DE[old] } }] }]);
    expect(germanReportText(r)).toContain('card delegation');
  });
});
