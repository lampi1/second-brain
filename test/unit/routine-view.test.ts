// What the Routine page shows (ADR 0153), on the e2e fixture: only a prod command, a gate or a block the runner will not
// heal is «Tocca a te»; a self-healing run is working; steps look done/now/retry/you/sent; queues skip restarts.
import { expect, it } from 'vitest';
import { routineSnapshot } from '../e2e/routine.fixture';
import { needsYou, working, retrying, stepLook, queued, ruleFor, prodSteps, activeVersion, itemOf, list } from '../../src/renderer/lib/routine-view';
import { HOLD } from '../../src/shared/routine';

const snap = routineSnapshot(1_800_000_000_000), run = (id: string) => snap.runs.find(r => r.id === id)!;

it('asks the user only for a prod command, never for a run that heals by itself', () => {
  expect(needsYou(snap, run('run-prod'))).toBe(true);
  expect(needsYou(snap, run('run-heal'))).toBe(false); expect(working(snap, run('run-heal'))).toBe(true);
  expect(needsYou(snap, run('run-done'))).toBe(false); expect(working(snap, run('run-done'))).toBe(false);
  expect(needsYou(snap, { ...run('run-prod'), paused: { at: 1 } })).toBe(false);
});
it('turns a block the runner will not heal into «Tocca a te»', () => {
  const healing = run('run-heal'), i = healing.currentStep;
  const blocked = { ...healing, status: 'blocked' as const, steps: healing.steps.map((s, n) => n === i ? { ...s, status: 'blocked' as const, decisionPending: true, attempts: 1, reason: 'exit 1' } : s) };
  expect(retrying(snap, blocked)).toBe(true); expect(needsYou(snap, blocked)).toBe(false); expect(stepLook(snap, blocked, i)).toBe('retry');
  const held = { ...blocked, steps: blocked.steps.map((s, n) => n === i ? { ...s, reason: `${HOLD}manca la cartella` } : s) };
  expect(retrying(snap, held)).toBe(false); expect(needsYou(snap, held)).toBe(true); expect(stepLook(snap, held, i)).toBe('you');
});
it('shows each step plainly and reads routines, queues and items from the snapshot', () => {
  const prod = run('run-prod');
  expect(stepLook(snap, prod, 0)).toBe('done'); expect(stepLook(snap, prod, prod.currentStep)).toBe('you');
  const bugfix = ruleFor(snap, 'bugfix')!;
  expect(queued(snap, bugfix.id)).toHaveLength(6);
  expect(prodSteps(activeVersion(snap, 'deploy-prod')!.definition).length).toBe(activeVersion(snap, 'deploy-prod')!.definition.steps.filter(s => s.env === 'prod').length);
  expect(itemOf(run('run-heal'))).toMatchObject({ id: expect.any(String), url: expect.stringContaining('_workitems/edit/') });
  expect(list('a, b;\nc,,')).toEqual(['a', 'b', 'c']);
});
