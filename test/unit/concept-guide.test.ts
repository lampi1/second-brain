// The Guida's content (src/shared/concept-guide.ts) and its «Discutine» plan (renderer/lib/concept-discuss.ts): every card
// is complete in both languages, cites source files that exist, keeps diagram labels short, and the Discuss action sends
// the card's content to an explainer agent when one can start, else to the Orchestrator with the Explainer instruction.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentCatalog, AgentModelChoice, AgentProfile } from '@shared/agents';
import { CONCEPTS, cardText, discussText, isExplainer, orchestratorText, type Bi } from '@shared/concept-guide';
import { explainerOf, planDiscuss } from '../../src/renderer/lib/concept-discuss';

const root = path.resolve(import.meta.dirname, '../..');
const full = (b: Bi) => b.it.trim().length > 0 && b.en.trim().length > 0;

describe('concept guide content', () => {
  it('has unique ids and the prominent card «Ogni compito passa da un agente» first', () => {
    expect(new Set(CONCEPTS.map(c => c.id)).size).toBe(CONCEPTS.length);
    expect(CONCEPTS.filter(c => c.prominent)).toHaveLength(1);
    expect(CONCEPTS[0]!.prominent).toBe(true);
    expect(CONCEPTS[0]!.title.it).toBe('Ogni compito passa da un agente');
    // the target (not today's behaviour) is stated apart on the prominent card
    expect(CONCEPTS[0]!.target?.length).toBeGreaterThan(0);
  });

  it('covers the core concepts the guide promises', () => {
    const ids = CONCEPTS.map(c => c.id);
    for (const id of ['agents', 'orchestrator', 'runs', 'metrics', 'errors-rules', 'milestones', 'classifiers', 'permissions', 'questions',
      'grindhouse', 'dashboard', 'task-fatto', 'brain', 'search', 'file-viewer', 'routing', 'costs', 'updates']) expect(ids).toContain(id);
  });

  for (const c of CONCEPTS) {
    it(`card ${c.id}: summary, 4-8 points, analogy, technical part, all in it and en`, () => {
      expect(full(c.title)).toBe(true);
      expect(full(c.summary)).toBe(true);
      expect(c.points.length).toBeGreaterThanOrEqual(4);
      expect(c.points.length).toBeLessThanOrEqual(8);
      expect(c.points.every(full)).toBe(true);
      expect(full(c.analogy)).toBe(true);
      expect(c.tech.length).toBeGreaterThan(0);
      expect(c.tech.every(x => full(x.label) && full(x.text))).toBe(true);
      expect((c.target ?? []).every(full)).toBe(true);
      expect((c.coming ?? []).every(x => Number.isInteger(x.pr) && x.pr > 0 && full(x.text))).toBe(true);
    });

    it(`card ${c.id}: cites source files that exist in the repo`, () => {
      expect(c.sources.length).toBeGreaterThan(0);
      for (const s of c.sources) expect(existsSync(path.join(root, s)), s).toBe(true);
    });

    if (c.diagram) it(`card ${c.id}: diagram has 2-6 short steps`, () => {
      expect(c.diagram!.steps.length).toBeGreaterThanOrEqual(2);
      expect(c.diagram!.steps.length).toBeLessThanOrEqual(6);
      for (const s of c.diagram!.steps) { expect(full(s)).toBe(true); expect(s.it.length).toBeLessThanOrEqual(24); expect(s.en.length).toBeLessThanOrEqual(24); }
    });
  }
});

describe('card text for a chat', () => {
  it('marks what is still in a pull request apart from today\'s behaviour', () => {
    const search = CONCEPTS.find(c => c.id === 'search')!;
    // the hybrid search is on main (ADR 0068): the card describes it as today's behaviour
    expect(search.coming).toBeUndefined();
    expect(search.summary.it).toContain('significato');
    const pending = { ...search, coming: [{ pr: 99, text: { it: 'In arrivo', en: 'Coming' } }] };
    expect(cardText(pending, 'it')).toContain('- PR #99: In arrivo');
  });
  const card = CONCEPTS.find(c => c.id === 'every-task-agent')!;
  it('carries title, numbered points, analogy, technical details, target and sources', () => {
    const txt = cardText(card, 'it');
    expect(txt).toContain(`# ${card.title.it}`);
    card.points.forEach((p, i) => expect(txt).toContain(`${i + 1}. ${p.it}`));
    expect(txt).toContain(card.analogy.it);
    expect(txt).toContain(card.tech[0]!.text.it);
    expect(txt).toContain(card.target![0]!.it);
    expect(txt).toContain(card.sources.join(', '));
  });
  it('is written in the language asked for', () => {
    const en = discussText(card, 'en');
    expect(en).toContain(card.title.en);
    expect(en).toContain('How it works:');
    expect(en).not.toContain(card.points[0]!.it);
  });
});

const choice = (over: Partial<AgentModelChoice> = {}): AgentModelChoice => ({
  engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, models: [], source: 'registry', installed: true, authenticated: true,
  defaultModel: true, modelSelectable: true, modelReason: null, ...over,
});
const profile = (id: string, name: string, over: Partial<AgentProfile> = {}): AgentProfile => ({
  id, name, purpose: 'p', instructions: 'i', engine: 'claude', model: null, avatar: { kind: 'symbol', symbol: 'spark', tone: 'blue' },
  origin: { kind: 'user' }, version: 1, activeVersion: 1, lastEditedBy: 'user', userLocked: true, status: 'active', ...over,
} as AgentProfile);
const catalog = (profiles: AgentProfile[], models = [choice()]): AgentCatalog => ({
  profiles, archived: [], models, problem: null, legacyRouting: { preserved: true, imported: 0, remaining: 0 },
  imageGeneration: { available: false, reason: '' },
} as AgentCatalog);

describe('«Discutine» plan', () => {
  const card = CONCEPTS[0]!;
  it('recognises only an explicitly named explainer, never incidental purpose prose', () => {
    expect(isExplainer({ id: 'x', name: 'Explainer' })).toBe(true);
    expect(isExplainer({ id: 'x', name: 'Spiegazioni' })).toBe(true);
    expect(isExplainer({ id: 'explainer', name: 'Tutor' })).toBe(true);
    expect(isExplainer({ id: 'x', name: 'Spiegazioni tecniche' })).toBe(false);
    expect(isExplainer({ id: 'x', name: 'Tutor', role: 'spiega i concetti' })).toBe(false);
    expect(isExplainer({ id: 'default-research', name: 'Ricerca' })).toBe(false);
  });

  it('goes to an explainer agent that can start, with the card as its draft', () => {
    const plan = planDiscuss(card, 'it', catalog([profile('default-general', 'Assistente'), profile('a1', 'Explainer')]), 'C:\\brain');
    expect(plan).toMatchObject({ via: 'agent', agentId: 'a1', harness: 'claude', cwd: 'C:\\brain', title: `Guida · ${card.title.it}` });
    expect(plan.draft).toBe(discussText(card, 'it'));
    expect(plan.draft).toContain(card.points[0]!.it);
  });

  it('goes to the Orchestrator with the Explainer instruction when no explainer exists', () => {
    const plan = planDiscuss(card, 'en', catalog([profile('default-general', 'Assistente')]), '/brain');
    expect(plan.via).toBe('orchestrator');
    expect(plan.draft).toBe(orchestratorText(card, 'en'));
    expect(plan.draft).toContain('agent_catalog');
    expect(plan.draft).toContain('"Explainer"');
    expect(plan.draft).toContain(card.points[0]!.en);
  });

  it('skips an explainer whose engine cannot start, and goes to the Orchestrator without a folder', () => {
    const off = catalog([profile('a1', 'Explainer')], [choice({ enabled: false })]);
    expect(explainerOf(off)).toBeNull();
    expect(planDiscuss(card, 'it', off, '/brain').via).toBe('orchestrator');
    expect(planDiscuss(card, 'it', catalog([profile('a1', 'Explainer')]), null).via).toBe('orchestrator');
    expect(planDiscuss(card, 'it', null, '/brain').via).toBe('orchestrator');
  });
});
