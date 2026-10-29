// «Per te» (ADR 0196): the local counters ("?" opens, cards opened, questions to the Orchestrator) and the ranking of the
// three cards a user needs most, zero tokens; plus the diagrams the Guida draws from the code (roles, delegation, IPC).
import { beforeEach, describe, expect, it } from 'vitest';
import { CONCEPTS, textOf } from '@shared/concept-guide';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract';
import { DELEGATION_DEFAULTS, ROLE_DEFAULTS, WORK_ROLE_IDS } from '@shared/roles';
import { codeDiagram, delegationDiagram, ipcDiagram, ipcGroups, rolesDiagram } from '@shared/guide-diagrams';
import { distinctiveWords, errorsByCard, forYou, noteCardOpen, noteHelpOpen, noteOrchestratorText, readUsage, type GuideUsage } from '../../src/renderer/lib/guide-usage';

const cards = CONCEPTS.map(c => ({ id: c.id, titles: [c.title.it, c.title.en, textOf(c.title, 'de')] }));
const none: GuideUsage = { help: {}, open: {}, asked: [] };

describe('«Per te» ranking', () => {
  it('shows nothing without data', () => {
    expect(forYou(none, {}, cards)).toEqual([]);
  });
  it('puts where the user got stuck ("?" and questions) before errors, and errors before plain reading', () => {
    const usage: GuideUsage = { help: { permissions: 2 }, open: { costs: 5, search: 1 }, asked: ['Come funziona la Grindhouse?', 'e la grindhouse?'] };
    const out = forYou(usage, { voice: 2 }, cards);
    expect(out.map(x => x.id)).toEqual(['permissions', 'grindhouse', 'costs']);
    expect(out[1]!.why).toEqual({ help: 0, open: 0, asked: 2, errors: 0 });
    expect(forYou(usage, { voice: 2 }, cards, 5).map(x => x.id)).toEqual(['permissions', 'grindhouse', 'costs', 'voice', 'search']);
  });
  it('matches only words one title owns («Orchestrator» is in two titles)', () => {
    const words = distinctiveWords(cards);
    expect(words.get('orchestrator')).not.toContain('orchestrator');
    expect(words.get('grindhouse')).toContain('grindhouse');
    expect(forYou({ ...none, asked: ['cosa fa l’Orchestrator?'] }, {}, cards)).toEqual([]);
  });
  it('counts the Log\'s errors by the area\'s kind or a title word', () => {
    const errs = errorsByCard([
      { kind: 'classifier', level: 'error', title: 'regola non valida' },
      { kind: 'app', level: 'error', title: 'Registrazioni: trascrizione fallita' },
      { kind: 'app', level: 'info', title: 'Registrazioni pronte' },
    ], cards);
    expect(errs).toEqual({ classifiers: 1, recordings: 1 });
  });
});

describe('the local counters', () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  });
  it('count "?" opens, cards opened and only the questions sent to the Orchestrator', () => {
    noteHelpOpen('permissions'); noteHelpOpen('permissions'); noteCardOpen('costs');
    noteOrchestratorText('fai il deploy'); noteOrchestratorText('come cambio i permessi?');
    expect(readUsage()).toEqual({ help: { permissions: 2 }, open: { costs: 1 }, asked: ['come cambio i permessi?'] });
  });
  it('reads broken or missing storage as no data', () => {
    localStorage.setItem('sb.guideUsage.v1', '{bad');
    expect(readUsage()).toEqual(none);
    delete (globalThis as Record<string, unknown>).localStorage;
    expect(readUsage()).toEqual(none);
    noteHelpOpen('x'); // no throw
  });
});

describe('diagrams from the code', () => {
  it('draws every role with its tier and an arrow for each launch', () => {
    const d = rolesDiagram('it');
    for (const id of WORK_ROLE_IDS) {
      expect(d).toContain(`${id}["${ROLE_DEFAULTS[id].name} · ${ROLE_DEFAULTS[id].tier}"]`);
      for (const to of ROLE_DEFAULTS[id].launches) expect(d).toContain(`${id} --> ${to}`);
      expect(d).toContain(`orchestrator --> ${id}`);
    }
  });
  it('draws delegation down to the configured depth', () => {
    const d = delegationDiagram('en', { ...DELEGATION_DEFAULTS, maxDepth: 3 });
    expect(d).toContain('l2 -->|"agent_delegate"| l3');
    expect(d).not.toContain('l4');
    expect(delegationDiagram('de')).toContain(`höchstens ${DELEGATION_DEFAULTS.maxParallel}`);
  });
  it('groups the contract\'s channels by area', () => {
    const g = ipcGroups();
    expect(g.reduce((n, x) => n + x.count, 0)).toBe(INVOKE_CHANNELS.length);
    expect(g.some(x => x.area === 'guide' && x.count === 2)).toBe(true);
    const d = ipcDiagram('it');
    expect(d).toContain(`${INVOKE_CHANNELS.length} canali per area`);
    expect(d).toContain(`${EVENT_CHANNELS.length} eventi`);
  });
  it('is attached to the cards about roles, delegation and the app, and every label is quoted', () => {
    expect(codeDiagram('every-task-agent', 'it')).toBe(rolesDiagram('it'));
    expect(codeDiagram('delegation', 'en')).toContain('flowchart TB');
    expect(codeDiagram('search', 'it')).toBeNull();
    for (const id of ['every-task-agent', 'delegation', 'orchestrator-app']) {
      for (const label of codeDiagram(id, 'de')!.matchAll(/\[([^\]]*)\]/g)) expect(label[1]).toMatch(/^".*"$/);
    }
  });
});
