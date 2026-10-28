// app_guide and the screen outline (src/main/appctl/guide.ts, ADR 0149): the map is read from the running UI and the
// code at the moment it is asked (no hand-kept text), a topic returns only its matching entries, and the window's
// silence is said plainly.
import { describe, expect, it } from 'vitest';
import type { BrowserWindow } from 'electron';
import { entries, guideTool, routineLines, screenOutline, search, type GuideDeps } from '../../src/main/appctl/guide';
import { DEFAULTS, schema } from '../../src/main/brain/config';
import type { FlowSnapshot } from '../../src/shared/flows';

const UI = {
  lang: 'it',
  nav: [{ group: '', items: [{ page: 'home', label: 'Grindhouse', key: 'G H' }] }, { group: 'Brain', items: [{ page: 'memoria', label: 'Memoria', key: 'G Y' }] }],
  pages: [{ id: 'memoria', label: 'Memoria', key: 'G Y', aliases: ['dashboard'], about: 'Proposte e conoscenza' }, { id: 'impostazioni', label: 'Impostazioni', key: 'G P' }],
  memoria: [{ tab: 'proposte', label: 'Proposte' }, { tab: 'skill', label: 'Skill' }],
  settings: [{ id: 'appearance', title: 'Aspetto', description: 'Tema e densità', keywords: 'Tema Lingua Densità' }],
  actions: [{ group: 'Azioni', title: 'Cambia tema', sub: 'Ora: scuro' }, { group: 'Azioni', title: 'Scorciatoie', shortcut: 'Ctrl+/' }],
  help: [{ id: 'toasts', title: 'Urgenti o normali', text: 'Le notifiche di Windows' }],
  view: { theme: 'dark' },
};
const win = (answer: unknown) => ({ isDestroyed: () => false, webContents: { executeJavaScript: async (expr: string) => (expr.includes('__sbScreen') ? 'page: memoria · window 1600×900' : answer) } }) as unknown as BrowserWindow;
const deps = (over: Partial<GuideDeps> = {}): GuideDeps => ({ window: () => win(UI), settings: { schema, get: () => DEFAULTS }, tools: () => [{ name: 'app_config', description: 'Read and change the configuration. More text.' }], ...over });

describe('app_guide', () => {
  it('explains MCP forms and their explicit user answer boundary', async () => {
    const out = String(await guideTool(deps()).run({ topic: 'MCP elicitation' }));
    expect(out).toContain('up to eight');
    expect(out).toContain('defaults never approve');
    expect(out).toContain('app_pending');
  });
  it('without a topic: the rail as drawn, Memoria tabs, Settings sections, actions and the hint to ask more', async () => {
    const out = String(await guideTool(deps()).run({}));
    expect(out).toContain('Memoria [memoria, G Y]');
    expect(out).toContain('Aspetto [appearance]');
    expect(out).toContain('Scorciatoie (Ctrl+/)');
    expect(out).toMatch(/app_ui action "outline"/);
    expect(out.length).toBeLessThan(6000);
  });

  it('a topic returns the matching page, setting and help entries with how to reach them', async () => {
    const out = String(await guideTool(deps()).run({ topic: 'tema' }));
    expect(out).toContain('[setting]');
    expect(out).toMatch(/Tema.*\(theme\)/);
    expect(out).toContain('Impostazioni › Aspetto');
    const page = String(await guideTool(deps()).run({ topic: 'memoria' }));
    expect(page).toContain('app_ui page memoria');
    expect(page).toContain('left rail › Brain');
  });

  it('works when the window does not answer: the main-side entries are still there', async () => {
    const out = String(await guideTool(deps({ window: () => null })).run({}));
    expect(out).toContain('the window did not answer');
    expect(String(await guideTool(deps({ window: () => null })).run({ topic: 'chiusura automatica' }))).toContain('autoCloseMin');
  });

  it('the description\'s own example finds the theme setting; question words are not matched', async () => {
    const out = String(await guideTool(deps({ window: () => null })).run({ topic: 'dove cambio il tema' }));
    expect(out.split('\n')[0]).toMatch(/\(theme\)/);
    expect(String(await guideTool(deps()).run({ topic: 'come si fa' }))).toMatch(/^Nothing on/);
  });

  it('search ranks title matches first and needs at least half the words', () => {
    const list = entries(UI, deps(), 'it');
    expect(search(list, 'proposte memoria')[0]!.title).toMatch(/Memoria/);
    expect(search(list, 'zzz qqq')).toEqual([]);
  });

  it('names the active routines with how to start them', async () => {
    const snap = { contextKey: 'k', drafts: [], active: { standup: 2 }, runs: [{ flowId: 'standup', status: 'completed', updatedAt: Date.parse('2026-10-24T08:00:00Z') }],
      versions: [{ version: 2, draftRevision: 1, digest: 'd', activatedAt: 1, definition: { id: 'standup', title: 'Standup del mattino', description: 'Prepara lo standup', aliases: ['standup'], scope: {}, steps: [{}, {}] } }] } as unknown as FlowSnapshot;
    const lines = routineLines(snap);
    expect(lines[0]!.title).toContain('Standup del mattino');
    expect(lines[0]!.text).toContain('app_flow_start');
    expect(lines[0]!.text).toContain('last run 2026-10-24T08:00:00.000Z completed');
    expect(String(await guideTool(deps({ flows: () => snap })).run({}))).toContain('Routines (page Routine, active): Standup del mattino');
  });

  it('says a routine\'s trigger state, filters and queue, and how pauses work', async () => {
    const snap = { contextKey: 'k', drafts: [], active: { fix: 1 }, runs: [],
      versions: [{ version: 1, definition: { id: 'fix', title: 'Air bug auto-fix', description: '', aliases: [], scope: {}, steps: [{}] } }],
      automation: { revision: 1, paused: false, background: false, rules: [{ id: 'r1', revision: 1, status: 'paused', config: { flowId: 'fix', trigger: { kind: 'devops', everyMinutes: 5, areaPath: 'Air', workItemType: 'Bug', states: ['New'], workItemIds: [7] } } }],
        events: [{ ruleId: 'r1', status: 'pending', sourceKey: 'a' }, { ruleId: 'r1', status: 'started', sourceKey: 'b' }] } } as unknown as FlowSnapshot;
    expect(routineLines(snap)[0]!.text).toMatch(/trigger paused: DevOps Bug in Air .*filters only ids 7, queue 1; .*app_config area routine/);
    const how = String(await guideTool(deps({ flows: () => snap })).run({ topic: 'routine trigger filtri' }));
    expect(how).toMatch(/starts a run for each new work item it finds/);
    expect(how).toMatch(/tags all of, excluded tags, work item ids/);
    expect(how).toMatch(/app_config area routine switches and pauses only the old routines/);
  });
});

describe('screen outline', () => {
  it('returns the renderer\'s outline, and says when the personal browser is shown', async () => {
    expect(await screenOutline(deps())).toContain('page: memoria');
    expect(await screenOutline(deps({ personalShown: () => true }))).toMatch(/personal Browser page .* private/);
    expect(await screenOutline(deps({ window: () => null }))).toMatch(/did not answer/);
  });
});

it('returns the complete live description for an exact tool name, including its approval contract', async () => {
  const description = 'Propose the recovery. The user alone confirms Sì/No; the host resumes under the existing grant.';
  const tool = guideTool(deps({ tools: () => [{ name: 'app_flow_cancel_propose', description }] }));
  expect(await tool.run({ topic: 'app_flow_cancel_propose' })).toContain(description);
});

it('knows the review switch (no daily limit, never a review of a review) and how completed work and levels are counted', async () => {
  const tool = guideTool(deps());
  const reviews = String(await tool.run({ topic: 'revisioni automatiche' }));
  expect(reviews).toContain('no daily limit'); expect(reviews).toContain('judging'); expect(reviews).not.toContain('Revisioni indipendenti al giorno');
  const levels = String(await tool.run({ topic: 'livelli lavori conclusi' }));
  expect(levels).toMatch(/Orchestrator.*root jobs/); expect(levels).toContain('Pulse');
  expect(schema().some(x => String(x.key) === 'delegation.judgeDaily')).toBe(false);
});
