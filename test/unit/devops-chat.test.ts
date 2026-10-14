// "Apri chat" on a DevOps record (brain/lib/devops-chat.ts): the title "Area · <record title>" (area: the repo or
// project, "DevOps" when none), the first message with link, type, state and the right first step per kind, and the
// folder (the repo's local clone, else none).
import { describe, expect, it } from 'vitest';
import type { DevopsItem, DevopsPrRef, QaPlan, QaPoint } from '../../src/shared/contract';
import { areaOf, recordChat } from '../../src/renderer/brain/lib/devops-chat';

const ORG = 'https://dev.azure.com/o';
const item = (o: Partial<DevopsItem> = {}): DevopsItem => ({ id: 4711, type: 'Bug', title: 'Rimborso sbagliato con sconto', state: 'New', project: 'Shop', priority: 2,
  assignedTo: 'Giulia Bianchi <giulia@example.com>', iteration: null, changedAt: null, url: `${ORG}/Shop/_workitems/edit/4711`, ...o });
const pr = (o: Partial<DevopsPrRef> = {}): DevopsPrRef => ({ id: 21, title: 'Rimborso: lo sconto entra nel totale', repo: 'shop-web', project: 'shop-web', author: 'Marco Verdi', createdAt: '', url: `${ORG}/Shop/_git/shop-web/pullrequest/21`, ...o });
const totals = { total: 4, done: 2, missing: 2, passed: 1, failed: 1, blocked: 0, notApplicable: 0, other: 0, byPerson: [] };
const plan: QaPlan = { id: 5100, name: 'Rimborsi', url: `${ORG}/Shop/_testPlans/execute?planId=5100`, points: [], totals };
const point: QaPoint = { id: 9, suite: 'S', testCase: { id: 5101, title: 'Reso parziale con sconto', url: `${ORG}/Shop/_workitems/edit/5101` }, outcome: 'Failed', ranBy: 'Anna', ranAt: null, tester: null, bugs: [4711] };

describe('areaOf', () => {
  it('the repo or project name, none is DevOps', () => {
    expect(areaOf('shop-web')).toBe('shop-web');
    expect(areaOf(' Magazzino ')).toBe('Magazzino');
    expect(areaOf('')).toBe('DevOps');
    expect(areaOf(null)).toBe('DevOps');
  });
});

describe('recordChat', () => {
  it('a bug: title, link, type and state, read it all then a plan; the brain folder (no cwd)', () => {
    const c = recordChat({ kind: 'workitem', item: item() });
    expect(c.title).toBe('Shop · Rimborso sbagliato con sconto');
    expect(c.prompt).toContain('questo bug di Azure DevOps: «Rimborso sbagliato con sconto»');
    expect(c.prompt).toContain(`Link: ${ORG}/Shop/_workitems/edit/4711`);
    expect(c.prompt).toContain('Tipo: Bug · stato: New · priorità 2 · assegnato a Giulia Bianchi');
    expect(c.prompt).toContain('proponimi un piano');
    expect(c.cwd).toBeUndefined();
  });
  it('a work item with no project is "DevOps"; a long title is clipped', () => {
    const c = recordChat({ kind: 'workitem', item: item({ project: '', type: 'User Story', title: 'x'.repeat(200) }) });
    expect(c.title.startsWith('DevOps · x')).toBe(true);
    expect(c.title.length).toBeLessThanOrEqual(80);
    expect(c.prompt).toContain('work item (User Story)');
  });
  it('a PR to review: review + QA, in the repo\'s clone when known', () => {
    const c = recordChat({ kind: 'pr', pr: pr(), mine: false }, { 'shop-web': 'C:/src/shop-web' });
    expect(c.title).toBe('shop-web · Rimborso: lo sconto entra nel totale');
    expect(c.prompt).toContain('fai la review della PR');
    expect(c.prompt).toContain('cosa testare in QA');
    expect(c.prompt).toContain(`Link: ${ORG}/Shop/_git/shop-web/pullrequest/21`);
    expect(c.cwd).toBe('C:/src/shop-web');
  });
  it('my own PR: what is missing to close it; no clone → no cwd', () => {
    const c = recordChat({ kind: 'pr', pr: pr({ repo: 'shop-web', project: 'Shop' }), mine: true }, {});
    expect(c.title).toBe('shop-web · Rimborso: lo sconto entra nel totale');
    expect(c.prompt).toContain('cosa manca per chiuderla');
    expect(c.cwd).toBeUndefined();
  });
  it('a test plan and a test case: run or check, with the PR and the plan link', () => {
    const p = recordChat({ kind: 'testplan', plan, pr: pr() }, { 'shop-web': 'C:/src/O' });
    expect(p.title).toBe('shop-web · Rimborsi');
    expect(p.prompt).toContain('test plan di Azure DevOps: «Rimborsi», della PR «Rimborso: lo sconto entra nel totale»');
    expect(p.prompt).toContain('2 test case eseguiti su 4, 1 falliti, 2 da fare');
    expect(p.prompt).toContain('quali eseguire o rieseguire');
    expect(p.cwd).toBe('C:/src/O');
    const t = recordChat({ kind: 'testcase', point, plan, pr: null });
    expect(t.title).toBe('DevOps · Reso parziale con sconto');
    expect(t.prompt).toContain(`Link: ${ORG}/Shop/_workitems/edit/5101`);
    expect(t.prompt).toContain('esito: Failed (da Anna) · 1 bug collegati');
    expect(t.prompt).toContain('come eseguirlo o verificarlo');
  });
});
