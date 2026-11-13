// "Discuti" on a DevOps record (brain/lib/record-discuss.ts): the ready message for the Orchestrator, never a work chat:
// the record (link, type, state, numbers), its area ("DevOps" when none), the folder hint (the repo's local clone, else
// the brain folder), the first step per kind, the suggested work chat title "Area · <record title>", and the key of its
// "Discussa" mark.
import { describe, expect, it } from 'vitest';
import type { DevopsItem, DevopsPrRef, QaPlan, QaPoint } from '../../src/shared/contract';
import { areaOf, recordDiscussText, recordId, recordKey, recordTitle } from '../../src/renderer/brain/lib/record-discuss';

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

describe('recordTitle and recordKey', () => {
  it('"Area · <title>", "DevOps" without one, a long title clipped; the key by kind and id', () => {
    expect(recordTitle({ kind: 'workitem', item: item() })).toBe('Shop · Rimborso sbagliato con sconto');
    const long = recordTitle({ kind: 'workitem', item: item({ project: '', title: 'x'.repeat(200) }) });
    expect(long.startsWith('DevOps · x')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(recordTitle({ kind: 'pr', pr: pr() })).toBe('shop-web · Rimborso: lo sconto entra nel totale');
    expect(recordKey({ kind: 'workitem', item: item() })).toBe('devops|workitem|4711');
    expect(recordKey({ kind: 'testcase', point, plan, pr: null })).toBe('devops|testcase|9');
    expect(recordId({ kind: 'testplan', plan, pr: null })).toBe(5100);
  });
});

describe('recordDiscussText', () => {
  it('a bug: link, type and state, area, the brain folder; the Orchestrator decides and opens the chat itself', () => {
    const m = recordDiscussText({ kind: 'workitem', item: item() });
    expect(m).toContain('Let\'s discuss this bug from Azure DevOps: «Rimborso sbagliato con sconto».');
    expect(m).toContain(`Link: ${ORG}/Shop/_workitems/edit/4711`);
    expect(m).toContain('Type: Bug · status: New · priority 2 · assigned to Giulia Bianchi');
    expect(m).not.toContain('giulia@example.com');
    expect(m).toContain('Area: Shop');
    expect(m).toContain('Folder: the brain folder');
    expect(m).toContain('Tell me in a few lines what you would do. If it needs work, open a work chat yourself («Shop · Rimborso sbagliato con sconto»)');
    expect(m).toContain('then a plan in a few lines before touching anything');
  });
  it('another work item type says its type', () => {
    expect(recordDiscussText({ kind: 'workitem', item: item({ type: 'User Story' }) })).toContain('work item (User Story)');
  });
  it('a PR to review: review + QA, the repo\'s clone as the folder', () => {
    const m = recordDiscussText({ kind: 'pr', pr: pr(), mine: false }, { 'shop-web': 'C:/src/shop-web' });
    expect(m).toContain('Type: pull request (to review) · repo shop-web · author Marco Verdi');
    expect(m).toContain('Folder: the local clone of shop-web, C:/src/shop-web.');
    expect(m).toContain(', in that folder) and brief it to review the PR');
    expect(m).toContain('what to test in QA');
  });
  it('my own PR without a clone: what is missing to close it, the folder unknown', () => {
    const m = recordDiscussText({ kind: 'pr', pr: pr(), mine: true }, {});
    expect(m).toContain('(mine)');
    expect(m).toContain('what is missing to close it');
    expect(m).toContain('Folder: no local clone of shop-web found');
    expect(m).not.toContain('in that folder');
  });
  it('a test plan and a test case: their numbers and links, run or check', () => {
    const p = recordDiscussText({ kind: 'testplan', plan, pr: pr() }, { 'shop-web': 'C:/src/O' });
    expect(p).toContain('test plan from Azure DevOps: «Rimborsi», from the PR «Rimborso: lo sconto entra nel totale»');
    expect(p).toContain('2 test cases executed out of 4, 1 failed, 2 to do');
    expect(p).toContain(`PR: ${ORG}/Shop/_git/shop-web/pullrequest/21`);
    expect(p).toContain('which ones to run or re-run');
    const c = recordDiscussText({ kind: 'testcase', point, plan, pr: null });
    expect(c).toContain(`Link: ${ORG}/Shop/_workitems/edit/5101`);
    expect(c).toContain(`Test plan: ${plan.url}`);
    expect(c).toContain('result: Failed (by Anna) · 1 related bugs');
    expect(c).toContain('Area: DevOps');
    expect(c).toContain('how to run or verify it');
  });
});
