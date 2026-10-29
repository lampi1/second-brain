// Fatto's log (src/renderer/brain/lib/done-log.ts, ADR 0079): the day report's rows as entries with what, who, when and
// a link; lessons and frictions left in the diary; the app's chats merged so one chat is listed once (the report's row
// gets the in-app link and the agent's name); newest first within a day and across days.
import { describe, expect, it } from 'vitest';
import type { ChatSummary } from '../../../src/shared/contract';
import type { DayReport } from '../../../src/renderer/brain/types';
import { buildLog, chatEntry, lastDays, localDay, rowEntry } from '../../../src/renderer/brain/lib/done-log';
import { shiftDay } from '../../../src/renderer/brain/lib/format';

const names = { you: 'Tu', claude: 'Claude', cursor: 'Cursor' };
const engine = (h: string) => (h === 'codex' ? 'Codex' : h === 'claude' ? 'Claude' : h);
const report = (rows: DayReport['rows']): DayReport => ({ date: '2026-10-18', day: '2026-10-18', devops: true, areas: [], rows, commits: [], text: '' });
const at = (day: string, hm: string) => new Date(`${day}T${hm}:00`).getTime();
const chat = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({
  harness: 'claude', origin: 'app', title: p.id, cwd: 'C:/x', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
} as ChatSummary);

describe('done log', () => {
  it('a row of each kind: who, when, link; a lesson stays out', () => {
    expect(rowEntry({ kind: 'pr-unita', time: '9:05', title: 'fix(orders): once', area: 'Prodotto', url: 'https://x/pr/1' }, '2026-10-18', 0, names))
      .toMatchObject({ kind: 'pr-merged', time: '09:05', who: 'Tu', url: 'https://x/pr/1', what: 'fix(orders): once' });
    expect(rowEntry({ kind: 'work-item', title: 'Bug', state: 'Resolved', area: 'A', url: 'u' }, 'd', 1, names)).toMatchObject({ kind: 'work-item', time: '', state: 'Resolved' });
    expect(rowEntry({ kind: 'diario', time: '11:15', tag: 'decisione', title: 'Si chiudono', area: 'A' }, 'd', 2, names)).toMatchObject({ kind: 'decision', who: 'Tu' });
    expect(rowEntry({ kind: 'diario', time: '12:30', tag: 'lezione', title: 'x', area: 'A' }, 'd', 3, names)).toBe(null);
    expect(rowEntry({ kind: 'chat', title: 'QA ordini', from: '09:02', to: '11:40', area: 'A' }, 'd', 4, names)).toMatchObject({ kind: 'chat', time: '11:40', who: 'Claude' });
    expect(rowEntry({ kind: 'chat-cursor', title: 'Cursor · Ricerca librerie · finito', area: 'A' }, 'd', 5, names)).toMatchObject({ kind: 'chat', what: 'Ricerca librerie', who: 'Cursor' });
  });

  it('an app chat counts when a turn ended well or its work completed; never an Orchestrator', () => {
    const t = at('2026-10-18', '14:20');
    expect(chatEntry(chat({ id: 'a', title: 'Fix', lastResult: { at: t, isError: false }, agent: { name: 'Correzione bug' } as ChatSummary['agent'] }), engine))
      .toMatchObject({ day: '2026-10-18', time: '14:20', who: 'Correzione bug', chatId: 'a', what: 'Fix' });
    expect(chatEntry(chat({ id: 'b', harness: 'codex', work: { status: 'completed', updatedAt: t } }), engine)).toMatchObject({ who: 'Codex' });
    expect(chatEntry(chat({ id: 'c', lastResult: { at: t, isError: true } }), engine)).toBe(null);
    expect(chatEntry(chat({ id: 'd', lastResult: { at: t, isError: false, interrupted: true } }), engine)).toBe(null);
    expect(chatEntry(chat({ id: 'o', isOrchestrator: true, lastResult: { at: t, isError: false } }), engine)).toBe(null);
  });

  it('days newest first; within a day newest first, untimed last; one entry per chat', () => {
    const day = '2026-10-18', prev = '2026-10-17';
    const reports = {
      [day]: report([
        { kind: 'diario', time: '08:50', tag: 'fatto', title: 'Export verificato', area: 'Clienti' },
        { kind: 'chat', title: 'QA ordini', from: '09:00', to: '11:40', area: 'Prodotto' },
        { kind: 'work-item', title: 'Bug sconto', state: 'Resolved', area: 'Prodotto', url: 'u' },
        { kind: 'pr-unita', time: '12:05', title: 'fix', area: 'Prodotto', url: 'p' },
      ]),
      [prev]: report([{ kind: 'diario', time: '18:30', tag: 'fatto', title: 'Mappa', area: 'OS' }]),
    };
    const chats = [
      chat({ id: 'qa', title: 'QA ordini', lastResult: { at: at(day, '11:38'), isError: false }, agent: { name: 'Analisi' } as ChatSummary['agent'] }),
      chat({ id: 'new', title: 'Nota rilascio', lastResult: { at: at(day, '15:00'), isError: false } }),
      chat({ id: 'old', title: 'Fuori intervallo', lastResult: { at: at('2026-10-01', '10:00'), isError: false } }),
    ];
    const log = buildLog([prev, day], reports, chats, names, engine);
    expect(log.map(d => d.day)).toEqual([day, prev]);
    expect(log[0]!.entries.map(e => [e.time, e.what, e.who, e.chatId ?? null])).toEqual([
      ['15:00', 'Nota rilascio', 'Claude', 'new'],
      ['12:05', 'fix', 'Tu', null],
      ['11:40', 'QA ordini', 'Analisi', 'qa'],
      ['08:50', 'Export verificato', 'Tu', null],
      ['', 'Bug sconto', 'Tu', null],
    ]);
    expect(log[1]!.entries).toHaveLength(1);
    expect(buildLog([day], {}, null, names, engine)[0]!.entries).toEqual([]);
  });

  it('the days to show and a time\'s local day', () => {
    expect(lastDays('2026-10-18', 3, shiftDay)).toEqual(['2026-10-18', '2026-10-17', '2026-10-16']);
    expect(lastDays('2026-10-01', 0, shiftDay)).toEqual(['2026-10-01']);
    expect(localDay(at('2026-10-18', '07:05'))).toEqual({ day: '2026-10-18', time: '07:05' });
  });
});
