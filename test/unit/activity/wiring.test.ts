// The Log's mapping of the app's other events (main/activity/wiring.ts, records.ts): the brain feed's errors, notes and
// role changes; the technical warnings; the memory store's new facts and status changes; estimates, the mail
// classifier and Battito in readable Italian.
import { describe, expect, it } from 'vitest';
import { entryToLog, feedToLog, memoryDiff } from '../../../src/main/activity/wiring';
import { estimateRecords, mailRecord, pulseRecord } from '../../../src/main/activity/records';
import type { FeedEvent } from '../../../src/shared/contract';
import type { TaskEstimate } from '../../../src/shared/task-estimate';

const feed = (kind: string, extra: Partial<FeedEvent> = {}): FeedEvent => ({ id: 'f', at: 1, kind, label: 'Errore registrato', priority: 'normal', title: 'Test sul ramo sbagliato', detail: 'Vero: prima git status', who: 'Artisan', ...extra });

describe('activity mapping', () => {
  it('maps the brain feed, skipping what the chats already say', () => {
    expect(feedToLog(feed('error'))).toMatchObject({ kind: 'error', title: 'Errore registrato nel brain: Test sul ramo sbagliato', text: 'Vero: prima git status · Artisan' });
    expect(feedToLog(feed('idea', { label: 'Idea aggiunta' }))).toMatchObject({ kind: 'memory', title: 'Idea aggiunta: Test sul ramo sbagliato' });
    expect(feedToLog(feed('agent-updated', { label: 'Ruolo aggiornato' }))?.kind).toBe('brain');
    expect(feedToLog(feed('chat-done'))).toBeNull();
  });

  it('keeps only warnings and errors of the technical log', () => {
    expect(entryToLog({ t: '', lvl: 'info', scope: 'chats', msg: 'x' })).toBeNull();
    expect(entryToLog({ t: '', lvl: 'warn', scope: 'browser', msg: 'page slow', cause: 'timeout', hint: 'retry', chat: 'c1' }))
      .toEqual({ kind: 'app', level: 'warn', title: 'browser: page slow', error: 'timeout', text: 'Prossimo passo: retry', chatId: 'c1' });
  });

  it('reports new memory facts and status changes', () => {
    const before = new Map([['m1', 'proposed'], ['m2', 'confirmed']]);
    const out = memoryDiff(before, [
      { memoryId: 'm1', status: 'confirmed', value: 'Usa xUnit', scope: { roleId: 'scout' } },
      { memoryId: 'm2', status: 'confirmed', value: 'Invariato' },
      { memoryId: 'm3', status: 'proposed', value: 'Nuovo', scope: { roleId: 'artisan' } },
    ]);
    expect(out.map(e => e.title)).toEqual(['Memoria di scout: fatto confermata', 'Memoria di artisan aggiornata: Nuovo']);
  });

  it('writes estimates, the mail class and Battito readably', () => {
    const e: TaskEstimate = { kind: 'review', basis: 'agent-kind', n: 9, timeMs: 360_000, timeLowMs: 1, timeHighMs: 2, costUsd: 0.21, costLowUsd: 0.1, costHighUsd: 0.3, confidence: 'medium', parts: 1, quick: false, path: 'one-agent', why: 'One part.' } as TaskEstimate;
    const [cls, est] = estimateRecords(e, 'Analizza la PR', 'per la tua richiesta');
    expect(cls).toMatchObject({ kind: 'classifier', title: 'Classificatore stime: «review»', text: '1 parte nella richiesta' });
    expect(est!.title).toBe('Stima (per la tua richiesta): ~6 min · ~$0.21 · 9 lavori simili, affidabilità media');
    expect(est!.text).toContain('un solo agente');
    expect(estimateRecords({ ...e, basis: null, timeMs: null }, 'x', 'y')[1]!.title).toContain('nessuna cifra');
    expect(mailRecord('Scout', 'Orchestrator', 'now', 'Bloccato', 'adesso').title).toBe('Classificatore posta: Scout → Orchestrator: urgente, consegnato subito');
    expect(pulseRecord('pulse', '08:00', { ok: true }, { cards: 3, usd: 0.01, engine: 'claude' })).toMatchObject({ kind: 'pulse', title: 'Battito: 3 carte con claude', text: 'Turno 08:00', costUsd: 0.01 });
    expect(pulseRecord('pulse', 'manual', { ok: false, error: 'Nessuna novità nel digest.' }, {}).title).toBe('Battito non ha lavorato: Nessuna novità nel digest.');
  });
});
