// A plan step on the map says who does it (role · preset, never the model: ADR 0346), a parallel group says
// how many run live, and plan_propose takes a preset per step (project-map/plan-words.tsx whoOf/groupLabel, strategy.ts checkProposal,
// projectmap/service.ts works()).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: () => () => {} } }));
import type { ChatSummary } from '../../src/shared/contract';
import type { StrategyPlan } from '../../src/shared/strategy';
import { checkProposal } from '../../src/shared/strategy';
import { groupLabel, whoOf, type StepWords } from '../../src/renderer/components/project-map/plan-words';
import { ProjectMaps } from '../../src/main/projectmap/service';
import { ProjectMapStore } from '../../src/main/projectmap/store';

const step = (n: number, state: StepWords['state'], wave: number, more: Partial<StepWords> = {}): StepWords => ({ n, state, wave, ...more });

describe('whoOf', () => {
  it('tells role · preset and never a model (ADR 0346), started or not', () => {
    expect(whoOf(step(1, 'todo', 1, { role: 'artisan', preset: 'base' }))).toBe('Artisan · Base');
    expect(whoOf(step(2, 'now', 1, { role: 'scout', preset: 'min', chatIds: ['c'] }))).toBe('Scout · Minimo');
    expect(whoOf(step(3, 'todo', 1, { role: 'scout' }))).toBe('Scout');
    // a model that reached the words by mistake is not shown
    expect(whoOf({ ...step(4, 'todo', 1, { role: 'artisan', preset: 'max' }), model: 'claude-sonnet-5-5' } as StepWords)).toBe('Artisan · Massimo');
  });
  it('is nothing for a step the Strategist does itself', () => {
    expect(whoOf(step(1, 'todo', 1))).toBeNull();
  });
});

describe('groupLabel', () => {
  const five = (states: StepWords['state'][]) => states.map((s, i) => step(i + 1, s, 1));
  it('counts live: 1 at work of 5', () => {
    expect(groupLabel(five(['now', 'todo', 'todo', 'todo', 'todo']), 1)).toBe('5 in parallelo · 1 al lavoro, 4 da far partire');
  });
  it('follows the steps as they finish', () => {
    expect(groupLabel(five(['now', 'now', 'now', 'done', 'done']), 1)).toBe('5 in parallelo · 3 al lavoro, 2 fatti');
    expect(groupLabel(five(['done', 'done', 'done', 'done', 'blocked']), 1)).toBe('5 in parallelo · 4 fatti, 1 bloccato');
  });
  it('is nothing for a wave of one step or a wave that is not there', () => {
    expect(groupLabel([step(1, 'now', 1), step(2, 'todo', 2)], 1)).toBeNull();
    expect(groupLabel([step(1, 'now', 1)], 7)).toBeNull();
  });
});

describe('plan_propose preset', () => {
  const steps = (s: Record<string, unknown>) => ({ steps: [{ title: 'a', role: 'scout', ...s }, { title: 'b', role: 'artisan' }] });
  it('keeps a valid preset on its step', () => {
    expect(checkProposal(steps({ preset: 'max' })).steps[0]).toMatchObject({ role: 'scout', preset: 'max' });
    expect(checkProposal(steps({})).steps[0]).not.toHaveProperty('preset');
  });
  it('refuses a preset that is not min, base or max', () => {
    expect(() => checkProposal(steps({ preset: 'huge' }))).toThrow(/preset/);
  });
});

describe('the map flow tells the preset, never the model', () => {
  let dir: string, maps: ProjectMaps, chats: ChatSummary[];
  const chat = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({ harness: 'claude', origin: 'app', title: p.id, cwd: '/repo/shop', sessionId: null, model: null, effort: null, permissionMode: null,
    state: 'running', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-planwho-'));
    chats = [];
    maps = new ProjectMaps({ store: new ProjectMapStore(() => dir), chats: () => chats, items: () => [], pending: () => [], emit: () => {}, stateFile: path.join(dir, 's.json') });
    maps.save({ title: 'Shop', root: '/repo/shop', map: { elements: [{ id: 'web', name: 'Web', kind: 'system', state: 'ok' }], links: [] } as never, by: 'Scout', summary: 'x' });
  });
  afterEach(() => { maps.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('a step not started shows the preset the plan asks (Base when none); a started one its chat\'s preset; no model', () => {
    const plan: StrategyPlan = { phase: 'running', clarified: [], at: 1, map: 'shop', steps: [
      { title: 'Faccio', role: 'artisan', preset: 'max', state: 'todo' },
      { title: 'Provo', role: 'artisan', state: 'todo' },
      { title: 'Leggo', role: 'scout', state: 'now', chatIds: ['a1'] }] };
    chats = [chat({ id: 's1', title: 'Strategist', plan }), chat({ id: 'a1', model: 'claude-haiku-5-5', run: { runId: 'r1', presetChoice: { preset: 'min' } } as never })];
    const flow = maps.view('shop')!.plans[0]!.flow;
    expect(flow[0]).toMatchObject({ role: 'artisan', preset: 'max' });
    expect(flow[1]).toMatchObject({ preset: 'base' });
    expect(flow[2]).toMatchObject({ role: 'scout', preset: 'min' });
    for (const f of flow) { expect(f).not.toHaveProperty('model'); expect(f).not.toHaveProperty('planned'); }
  });
});
