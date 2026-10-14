// Unit tests of main/run/results.ts ("Esito alla chat"): a run of Esegui that ends goes back to the chat that proposed
// the block (command, exit code, output tail, labelled as the app's); a busy chat gets it when it is free; runs that end
// together go in one message; off with the setting; a stopped run says so; long code and output are cut.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary, RunInfo } from '../../src/shared/contract';
import { RUN_RESULT_LABEL, RunResults, runResultText } from '../../src/main/run/results';

const chat = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({
  harness: 'claude', origin: 'app', title: p.id, cwd: 'C:/x', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isRegia: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
});
const run = (p: Partial<RunInfo> & { id: string }): RunInfo => ({
  chatId: 'c1', itemId: 'a1', code: 'npm run check', cwd: 'C:/repo', state: 'ok', exitCode: 0, output: 'tutto verde\n', startedAt: 1000, endedAt: 13_000, ...p,
});

function make(opts: { enabled?: boolean; list?: ChatSummary[] } = {}) {
  const sent: { chatId: string; text: string }[] = [];
  let on = opts.enabled ?? true;
  const s = new RunResults({ send: async (chatId, text) => { sent.push({ chatId, text }); }, enabled: () => on, groupMs: 100, ...(opts.list ? { list: () => opts.list! } : {}) });
  return { s, sent, setOn: (v: boolean) => { on = v; } };
}

describe('RunResults', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a run that ends goes back to its chat: command, exit code, output, labelled as the app\'s', async () => {
    const { s, sent } = make();
    s.observe('chat:updated', chat({ id: 'c1' }));
    s.observe('run:updated', run({ id: 'r1', state: 'running', exitCode: null, endedAt: undefined }));
    await vi.advanceTimersByTimeAsync(500);
    expect(sent).toEqual([]);
    s.observe('run:updated', run({ id: 'r1' }));
    s.observe('run:updated', run({ id: 'r1' })); // a repeated update: told once
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toBe('c1');
    expect(sent[0]!.text.startsWith(RUN_RESULT_LABEL)).toBe(true);
    expect(sent[0]!.text).toContain('npm run check');
    expect(sent[0]!.text).toContain('Esito: riuscito (exit code 0) · 12 s');
    expect(sent[0]!.text).toContain('tutto verde');
  });

  it('a busy chat gets it when it is free, with every run that ended meanwhile in one message', async () => {
    const { s, sent } = make();
    s.observe('chat:updated', chat({ id: 'c1', state: 'running' }));
    s.observe('run:updated', run({ id: 'r1', state: 'error', exitCode: 1, output: 'Errore: file non trovato' }));
    s.observe('run:updated', run({ id: 'r2', code: 'Get-Date' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toEqual([]);
    s.observe('chat:updated', chat({ id: 'c1', state: 'waiting', pending: 1 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toEqual([]);
    s.observe('chat:updated', chat({ id: 'c1', state: 'idle' }));
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('Esito: fallito (exit code 1)');
    expect(sent[0]!.text).toContain('Errore: file non trovato');
    expect(sent[0]!.text).toContain('Get-Date');
  });

  it('a chat not seen since the start is found in the list; a closed one gets it too (it resumes)', async () => {
    const { s, sent } = make({ list: [chat({ id: 'c1', state: 'closed' })] });
    s.observe('run:updated', run({ id: 'r1', state: 'stopped', exitCode: null }));
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('fermato dall\'utente prima della fine');
  });

  it('nothing when off or for a removed chat', async () => {
    const off = make({ enabled: false });
    off.s.observe('chat:updated', chat({ id: 'c1' }));
    off.s.observe('run:updated', run({ id: 'r1' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(off.sent).toEqual([]);

    const { s, sent } = make();
    s.observe('chat:updated', chat({ id: 'c1', state: 'running' }));
    s.observe('run:updated', run({ id: 'r1' }));
    s.observe('chat:removed', { chatId: 'c1' });
    s.observe('chat:updated', chat({ id: 'c1' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(sent).toEqual([]);
  });

  it('long code and output are cut; a production run says it was confirmed', () => {
    const t = runResultText(run({ id: 'r', code: Array.from({ length: 30 }, (_, i) => `echo ${i}`).join('\n'), output: `${'x'.repeat(5000)}FINE`, prod: 'Azure' }));
    expect(t).toContain('… (15 righe in più)');
    expect(t).not.toContain('echo 20');
    expect(t).toContain('FINE');
    expect(t.length).toBeLessThan(3600);
    expect(t).toContain('comando di produzione, confermato dall\'utente');
  });
});
