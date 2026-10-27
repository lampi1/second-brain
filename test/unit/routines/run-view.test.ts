// The app's live run view renders a run's events.jsonl with the shared reducer: the step it shows is the one
// `progressFrom` (the terminal `routine watch` line) computes, a person needed is a red card with the DevOps link,
// and a finished run offers its report.md.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseEvents, progressFrom } from '../../../packages/routine-runtime/src/events';
import { RoutineRunView } from '../../../src/renderer/components/RoutineRun';
import { createDemoRoutines } from '../../../src/main/routines/demo';
import type { RoutineRunDetail } from '../../../src/shared/routines';
import { tempDir } from '../routine-runtime/fakes';

const at = Date.UTC(2026, 9, 27, 9, 0);
const jsonl = [
  { type: 'run-start', at, runId: 'r1', routine: 'air-bugfix', total: 3, workItem: 7 },
  { type: 'step-start', at: at + 1, n: 1, total: 3, id: 'reproduce', title: 'Riproduci', attempt: 1 },
  { type: 'step-end', at: at + 2, n: 1, id: 'reproduce', status: 'done' },
  { type: 'step-start', at: at + 3, n: 2, total: 3, id: 'fix', title: 'Correggi il bug', attempt: 1 },
  { type: 'action', at: at + 4, n: 2, text: 'Modifico InvoiceTotals.cs' },
  { type: 'write', at: at + 5, n: 2, what: 'commento sul work item 7', status: 'not-verified' },
  { type: 'waiting-human', at: at + 6, n: 2, url: 'https://dev.azure.com/o/p/_workitems/edit/7#c1', question: 'Prima o dopo l’IVA?' },
].map(e => JSON.stringify(e)).join('\n') + '\n{"type":"act';

const detail = (events: RoutineRunDetail['events'], extra: Partial<RoutineRunDetail> = {}): RoutineRunDetail => ({
  source: 'app', routineId: 'air-bugfix', runId: 'r1', title: 'Air', status: 'waiting-human', createdAt: at, updatedAt: at + 6,
  dir: '/runs/r1', events, steps: [], resume: 'routine resume --run-dir /runs/r1', cancellable: false, ...extra,
});
const render = (run: RoutineRunDetail) => renderToStaticMarkup(createElement(RoutineRunView, { run, onOpenFile: () => {}, onCopy: () => {} }));
const text = (html: string, testid: string) => html.match(new RegExp(`data-testid="${testid}"[^>]*>(.*?)</div>`))?.[1]?.replace(/<[^>]+>/g, '') ?? '';

describe('routine run view', () => {
  it('shows the same current step as the shared reducer for a fake events.jsonl', () => {
    const events = parseEvents(jsonl), p = progressFrom(events);
    const html = render(detail(events));
    expect(p.step).toMatchObject({ n: 2, total: 3, title: 'Correggi il bug' });
    expect(text(html, 'run-current-step')).toContain(`Step ${p.step!.n} di ${p.step!.total} ${p.step!.title}`);
    expect(html).toContain('data-testid="run-waiting"');
    expect(html).toContain('href="https://dev.azure.com/o/p/_workitems/edit/7#c1"');
    expect(html).toContain('commento sul work item 7');
    expect(html).toContain('routine resume --run-dir /runs/r1');
    expect(html).not.toContain('data-testid="run-report"');
  });

  it('renders the demo runs read from their folders: waiting in red, finished with its report', () => {
    const routines = createDemoRoutines(tempDir('routines-view-'), Date.UTC(2026, 9, 27, 10, 0));
    const runs = routines.snapshot().runs;
    const waiting = routines.run(runs.find(r => r.status === 'waiting-human')!);
    const html = render(waiting);
    expect(text(html, 'run-current-step')).toContain(progressFrom(waiting.events).step!.title);
    expect(html).toContain('data-testid="run-waiting"');
    expect(waiting.lastShot?.dataUrl).toMatch(/^data:image\/png;base64,/);
    const done = routines.run(runs.find(r => r.status === 'done')!);
    expect(done.reportPath).toMatch(/report\.md$/);
    expect(render(done)).toContain('data-testid="run-report"');
    expect(render(done)).not.toContain('data-testid="run-waiting"');
  });
});
