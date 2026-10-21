// Finished workers close by themselves (#86, ADR 0084): a worker that mails its final report to its Orchestrator (or ends
// with a run-report block) and goes idle gets its assignment completed and its agent run ended "completed", then the
// main scheduler archives it with closedBy "auto". A worker that waits for the user (question, permission, its report's
// words), for colleagues or for background work stays open, and the scheduler names what it waits for ("In attesa di…").
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { AutoCloseService, autoCloseNow } from '../../../src/main/chats/auto-close';
import { plainOwner } from '../../../src/main/agents/catalog';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

/** A turn of the fake engine: what it mails to its Orchestrator mid-turn, and its final answer. */
interface Turn { mail?: string; answer: string; background?: boolean; question?: boolean }

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-auto-report-')); roots.push(dir);
  const sinks = new Map<string, SessionSink>(), script = new Map<string, Turn[]>();
  let creating: SessionSink | null = null, seq = 0;
  const m: ChatManager = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, env: { CLAUDE_CONFIG_DIR: path.join(dir, 'home') }, sessionFactory: (_h, _o, s) => {
    creating = s; let state = 'idle';
    const self = { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, get busy() { return state === 'running'; },
      start() { s.childrenCoverage?.('complete'); s.changed({ state: 'idle' }); },
      send(text: string) {
        const id = [...sinks.entries()].find(([, v]) => v === s)?.[0];
        const turn: Turn = (id ? script.get(id)?.shift() : undefined) ?? { answer: `Ricevuto: ${text.slice(0, 20)}` };
        state = 'running'; s.changed({ state: 'running' });
        if (turn.mail && id) {
          const orchestrator = m.list().find(c => c.isOrchestrator);
          m.noteMail(id, orchestrator?.id ?? null, turn.mail);
        }
        if (turn.background) s.changed({ background: 1 });
        s.item({ kind: 'assistant', id: `a${++seq}`, at: Date.now(), text: turn.answer }, false);
        if (turn.question) s.pending({ id: `q${seq}`, type: 'question', tool: 'AskUserQuestion', title: 'Quale cartella?', detail: '', input: {}, at: Date.now() });
        s.item({ kind: 'result', id: `r${seq}`, at: Date.now(), isError: false, costUsd: 0, durationMs: 1, turns: 1 }, false);
        state = 'idle'; s.changed({ state: turn.question ? 'waiting' : 'idle' });
      },
      close: async () => { state = 'closed'; s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
      rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    };
    return self as unknown as HarnessSession;
  } });
  managers.push(m);
  const orchestrator = async () => { const c = await m.create({ harness: 'claude', cwd: dir, orchestrator: true }); sinks.set(c.id, creating!); return c; };
  /** A worker its Orchestrator opened (by 'agent'), from a catalog agent (a run), whose first turn follows `turns`. */
  const worker = async (orchestratorId: string, ...turns: Turn[]) => {
    const pending: Turn[] = [...turns];
    const c = await m.create({ harness: 'claude', cwd: dir }, 'agent',
      { owner: { ...plainOwner('claude', null), source: 'catalog', id: 'researcher', version: 1 }, instructions: 'Ricerca.', policy: null });
    sinks.set(c.id, creating!); script.set(c.id, pending);
    await m.send(c.id, 'Cerca tre fonti sul tema e mandami il report.', undefined, false, 'Orchestrator');
    return c;
  };
  const chat = (id: string) => m.list().find(c => c.id === id)!;
  return { m, dir, orchestrator, worker, chat, script, sink: (id: string) => sinks.get(id)! };
}

/** The real scheduler with a fake monotonic clock and an acknowledged warning: runs until the deadline passed. */
async function runScheduler(m: ChatManager, ids: string[]) {
  let clock = autoCloseNow();
  const scheduler = new AutoCloseService({ now: () => clock, delayMs: () => 60_000, candidates: () => m.autoCloseCandidates(() => false), archive: (id, _r, valid) => m.archiveAutomatic(id, valid), emit() {} });
  const presence = () => scheduler.setPresence(ids.map(chatId => {
    const row = scheduler.state().find(r => r.chatId === chatId);
    return { chatId, draft: false, shown: false, browser: false, queued: 0, touchedAt: 0, ...(row?.deadline != null ? { ackGeneration: row.generation, ackDeadline: row.deadline } : {}) };
  }));
  presence();
  for (let i = 0; i <= 14; i++) { presence(); clock += 10_000; presence(); await scheduler.tick(); }
  return scheduler;
}

describe('a worker that delivered its final report closes by itself (#86)', () => {
  it('completes the assignment and the run on the report, then the scheduler archives it with closedBy auto', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { mail: 'Report finale: tre fonti trovate, sintesi nel file notes.md.', answer: 'Report inviato all’Orchestrator.' });
    expect(f.chat(w.id).work?.status).toBe('completed');
    expect(f.chat(w.id).run).toMatchObject({ endReason: 'completed' });
    expect(f.chat(w.id).waitsOn).toBeUndefined();
    await runScheduler(f.m, [w.id]);
    expect(f.chat(w.id)).toMatchObject({ state: 'closed', closedBy: 'auto' });
    expect(f.chat(w.id).run?.endReason).toBe('completed');
    expect(f.chat(r.id).closedAt).toBeUndefined();
  });

  it('takes a run-report block as the final report too', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { answer: 'Fatto.\n\n```run-report\n{"outcome":"done","verified":"yes","summary":"Tool aggiornato, test verdi"}\n```' });
    expect(f.chat(w.id).work?.status).toBe('completed');
    await runScheduler(f.m, [w.id]);
    expect(f.chat(w.id).closedBy).toBe('auto');
  });

  it('without a report it stays assigned and open, waiting for its final report', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { answer: 'Ho trovato due fonti, continuo.' });
    expect(f.chat(w.id).work?.status).toBe('assigned');
    const s = await runScheduler(f.m, [w.id]);
    expect(f.chat(w.id).closedAt).toBeUndefined();
    expect(s.state().find(x => x.chatId === w.id)?.waitingFor).toBe('report');
    expect(f.chat(w.id).run?.endedAt).toBeUndefined();
  });

  it('a report that waits for the user keeps it open with "In attesa dell’utente"', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { mail: 'Bozza pronta in docs/x.md. Aspetto il tuo ok, poi la pubblico.', answer: 'Report inviato.' });
    expect(f.chat(w.id)).toMatchObject({ waitsOn: 'user', work: { status: 'assigned' } });
    const s = await runScheduler(f.m, [w.id]);
    expect(f.chat(w.id).closedAt).toBeUndefined();
    expect(s.state().find(x => x.chatId === w.id)).toMatchObject({ waitingFor: 'user', reason: 'In attesa dell’utente', deadline: null });
  });

  it('a report that waits for colleagues keeps it open with "In attesa dei colleghi"', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { mail: 'Parte mia fatta. Aspetto la risposta della chat Backend per chiudere.', answer: 'Inviato.' });
    expect(f.chat(w.id).waitsOn).toBe('colleagues');
    const s = await runScheduler(f.m, [w.id]);
    expect(f.chat(w.id).closedAt).toBeUndefined();
    expect(s.state().find(x => x.chatId === w.id)?.waitingFor).toBe('colleagues');
  });

  it('an open question keeps it open with "In attesa di una tua risposta", even after its report', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { mail: 'Report: fatto quasi tutto.', answer: 'Una domanda prima di chiudere.', question: true });
    expect(f.chat(w.id).work?.status).toBe('assigned');
    const s = await runScheduler(f.m, [w.id]);
    expect(f.chat(w.id).closedAt).toBeUndefined();
    expect(s.state().find(x => x.chatId === w.id)?.waitingFor).toBe('answer');
  });

  it('a background task still running keeps it open with "In attesa del lavoro in corso"', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { mail: 'Report: analisi lanciata.', answer: 'Report inviato.', background: true });
    expect(f.chat(w.id).work?.status).toBe('assigned');
    const s = await runScheduler(f.m, [w.id]);
    expect(f.chat(w.id).closedAt).toBeUndefined();
    expect(s.state().find(x => x.chatId === w.id)?.waitingFor).toBe('work');
  });

  it('a later clean report after a waiting one completes it', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { mail: 'Aspetto la risposta di «QA rimborsi».', answer: 'Inviato.' });
    expect(f.chat(w.id).waitsOn).toBe('colleagues');
    f.script.get(w.id)!.push({ mail: 'Report finale: QA ok, tutto chiuso.', answer: 'Fatto.' });
    await f.m.send(w.id, 'QA ok.', undefined, false, 'QA rimborsi');
    expect(f.chat(w.id).waitsOn).toBeUndefined();
    expect(f.chat(w.id).work?.status).toBe('completed');
  });

  it('a new message from its Orchestrator assigns it again; mail to someone else is no report', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { mail: 'Report finale: fatto.', answer: 'Fatto.' });
    expect(f.chat(w.id).work?.status).toBe('completed');
    await f.m.assignTask(w.id, 'Ora una seconda ricerca.', { mode: 'continue', source: { kind: 'chat', chatId: r.id } });
    expect(f.chat(w.id).work?.status).toBe('assigned');
    f.m.noteMail(w.id, null, 'Report a una chat fuori dall’app');
    expect(f.chat(w.id).work?.status).toBe('assigned');
  });

  it('never touches the Orchestrator itself', async () => {
    const f = fixture(), r = await f.orchestrator();
    f.m.noteMail(r.id, r.id, 'Report');
    expect(f.m.autoCloseCandidates(() => false).find(c => c.id === r.id)).toMatchObject({ eligible: false });
    expect(f.m.autoCloseCandidates(() => false).find(c => c.id === r.id)?.waitingFor).toBeUndefined();
  });

  it('wiring holds name their wait: a command left to the user, a browser hand-off', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { mail: 'Report finale: fatto.', answer: 'Fatto.' });
    expect(f.m.autoCloseCandidates(() => 'command').find(c => c.id === w.id)).toMatchObject({ eligible: false, waitingFor: 'command' });
    expect(f.m.autoCloseCandidates(() => 'browser').find(c => c.id === w.id)).toMatchObject({ eligible: false, waitingFor: 'browser' });
    expect(f.m.autoCloseCandidates(() => false).find(c => c.id === w.id)).toMatchObject({ eligible: true });
  });
});
