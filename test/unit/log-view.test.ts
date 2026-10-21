// The Log page's chains and flags (renderer/lib/log-view.ts): a chat's consecutive turns fold into one step, delegated
// chats are indented, a request carries its end, an unverified finished task says so, and the three automatic flags.
import { describe, expect, it } from 'vitest';
import { buildTasks, byDay, filterEvents, money, span } from '../../src/renderer/lib/log-view';
import type { LogEvent } from '../../src/shared/activity-log';

let n = 0;
const ev = (at: number, e: Partial<LogEvent>): LogEvent => ({ id: `e${n++}`, at, kind: 'task', level: 'info', title: 't', rootId: 'r', task: 'Incarico', ...e }) as LogEvent;

describe('log view', () => {
  it('builds a chain: folded turns, depth, request end, no verification', () => {
    const [t] = buildTasks([
      ev(1, { step: 'open', chatId: 'r', title: 'Orchestrator sceglie Strategist' }),
      ev(2, { step: 'work', chatId: 'r', costUsd: 0.1, ms: 1000, tools: ['Read'] }),
      ev(3, { step: 'work', chatId: 'r', costUsd: 0.2, ms: 2000, tools: ['Read', 'Edit'], toolErrors: 1, level: 'warn' }),
      ev(4, { step: 'open', chatId: 'k', parentId: 'r', title: 'Strategist sceglie Scout' }),
      ev(5, { step: 'request', chatId: 'k', reqId: 'q', reqType: 'question', title: 'Scout ti fa una domanda' }),
      ev(6, { step: 'resolved', chatId: 'k', reqId: 'q', reqType: 'question', by: 'user', title: 'Hai risposto a Scout' }),
      ev(7, { step: 'result', chatId: 'k', output: 'Trovati tre punti nel codice degli sconti' }),
    ]);
    expect(t!.steps.map(s => s.kind)).toEqual(['open', 'work', 'open', 'request', 'result', 'unverified']);
    expect(t!.steps[1]).toMatchObject({ turns: 2, tools: ['Read', 'Edit'], toolErrors: 1, level: 'warn' });
    expect(t!.steps[1]!.costUsd).toBeCloseTo(0.3);
    expect(t!.steps[2]!.depth).toBe(1);
    expect(t!.steps[3]).toMatchObject({ level: 'ok', text: 'Hai risposto a Scout' });
    expect(t!.flags).toEqual([]);
    expect(t!.verified).toBe(false);
  });

  it('flags a duplicate reply, a hidden approval and a review without a verdict', () => {
    const [t] = buildTasks([
      ev(1, { step: 'result', chatId: 'r', output: 'La PR si può unire, test verdi' }),
      ev(2, { step: 'result', chatId: 'r', output: 'La  PR si può unire, test verdi' }),
      ev(3, { step: 'request', chatId: 'r', reqId: 'p', reqType: 'permission' }),
      ev(4, { step: 'resolved', chatId: 'r', reqId: 'p', reqType: 'permission', by: 'other', text: 'Bash · rm' }),
      ev(5, { step: 'review', chatId: 'v' }),
      ev(6, { step: 'closed', chatId: 'v' }),
    ]);
    expect(t!.flags.map(f => f.kind)).toEqual(['duplicate', 'hidden-approval', 'review-no-verdict']);
    const [ok] = buildTasks([ev(1, { step: 'review', chatId: 'v' }), ev(2, { step: 'verdict', chatId: 'v', verdict: 'success' }), ev(3, { step: 'closed', chatId: 'v' })]);
    expect(ok!.flags).toEqual([]);
    expect(ok!.verified).toBe(true);
    expect(ok!.steps.some(s => s.kind === 'unverified')).toBe(false);
  });

  it('filters, groups by day and formats', () => {
    const list = [ev(Date.UTC(2026, 9, 20, 10), { kind: 'pulse', title: 'Battito: 3 carte', rootId: undefined }), ev(Date.UTC(2026, 9, 21, 10), { kind: 'error', title: 'Errore registrato', tools: ['Bash'] })];
    expect(filterEvents(list, 'bash', 'all').map(e => e.kind)).toEqual(['error']);
    expect(filterEvents(list, '', 'pulse')).toHaveLength(1);
    expect(filterEvents(list, 'càrte', 'all')).toHaveLength(1);
    expect(byDay(list).map(([, l]) => l[0]!.kind)).toEqual(['error', 'pulse']);
    expect(money(0.004)).toBe('$0,004');
    expect(money(1.5)).toBe('$1,50');
    expect(span(125_000)).toBe('2 min 5 s');
  });
});
