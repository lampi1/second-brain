// Finished workers close by themselves (#86, ADR 0084): a worker that submits agent_report (or ends
// with a run-report block) and goes idle gets its assignment completed and its agent run ended "completed", then the
// main scheduler archives it with closedBy "auto". A worker that waits for the user (question, permission, its report's
// words), for colleagues or for background work stays open; the scheduler names what it waits for only from real state
// (#359): the words of a report or answer still hold it open, but never give it a «waits for you» tag.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { AutoCloseService, autoCloseNow } from '../../../src/main/chats/auto-close';
import { plainOwner } from '../../../src/main/agents/catalog';
import { readRun } from '../../../src/main/agents/runs';
import { readDelegation } from '../../../src/shared/delegation';
import type { StrategyPlan } from '../../../src/shared/strategy';
import type { Harness } from '../../../src/shared/contract';

class TestManager extends ChatManager {
  seedPlan(id: string, plan: StrategyPlan) { this.chats.get(id)!.s.plan = plan; }
}

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

/** A turn of the fake engine: what it mails to its Orchestrator mid-turn, and its final answer. */
interface Turn { mail?: string; report?: string; outcome?: 'done' | 'partial' | 'blocked'; answer: string; background?: boolean; question?: boolean }

function fixture(harness: Harness = 'claude', extra: Partial<ConstructorParameters<typeof ChatManager>[0]> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-auto-report-')); roots.push(dir);
  const sinks = new Map<string, SessionSink>(), script = new Map<string, Turn[]>();
  let creating: SessionSink | null = null, seq = 0;
  const m = new TestManager({ ...extra, userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, env: { CLAUDE_CONFIG_DIR: path.join(dir, 'home') }, sessionFactory: (_h, _o, s) => {
    creating = s; let state = 'idle';
    const self = { harness, sessionId: null, pid: null, root: null, alive: true, get busy() { return state === 'running'; },
      start() { s.childrenCoverage?.('complete'); s.changed({ state: 'idle' }); },
      send(text: string) {
        const id = [...sinks.entries()].find(([, v]) => v === s)?.[0];
        const turn: Turn = (id ? script.get(id)?.shift() : undefined) ?? { answer: `Ricevuto: ${text.slice(0, 20)}` };
        state = 'running'; s.changed({ state: 'running' });
        if (turn.report && id) m.reportRoot(id, { outcome: turn.outcome ?? 'done', summary: turn.report, output: turn.report, doneWhen: [] });
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
    const c = await m.create({ harness, cwd: dir }, 'agent',
      { owner: { ...plainOwner(harness, null), source: 'catalog', id: 'researcher', version: 1 }, instructions: 'Ricerca.', policy: null });
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
  it('progress mail with an active child and unfinished plan does not complete the assignment', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { answer: 'Lavoro avviato.' });
    f.m.seedPlan(w.id, { phase: 'running', clarified: [], steps: [{ title: 'Implement', state: 'now' }, { title: 'Review', state: 'todo' }], at: Date.now() });
    await f.m.create({ harness: 'claude', cwd: f.dir, parentId: w.id, delegation: { role: 'artisan', goal: 'Implement', doneWhen: ['Tests pass'], at: Date.now() } }, 'agent');
    f.m.noteMail(w.id, r.id, 'Analisi conclusa, correzione avviata e verifica predisposta.');
    expect(f.chat(w.id).work?.status).toBe('assigned');
    expect(f.chat(w.id).run?.endedAt).toBeUndefined();
    expect(f.chat(w.id).plan?.phase).toBe('running');
  });

  it.each(['claude', 'cursor', 'opencode', 'codex'] as const)('%s: plain progress mail alone is not a final report, including on later clean turns', async harness => {
    const f = fixture(harness), r = await f.orchestrator();
    const w = await f.worker(r.id, { mail: 'Prima parte verificata.', answer: 'Proseguo.' });
    expect(f.chat(w.id).work?.status).toBe('assigned');
    await f.m.send(w.id, 'Aggiornamento', undefined, false, 'Orchestrator');
    expect(f.chat(w.id).run?.endedAt).toBeUndefined();
  });

  it.each(['plan', 'child'] as const)('a legacy final block cannot finish with unfinished %s work', async pending => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { answer: 'Avviato.' });
    if (pending === 'plan') f.m.seedPlan(w.id, { phase: 'running', clarified: [], steps: [{ title: 'Review', state: 'todo' }], at: Date.now() });
    else await f.m.create({ harness: 'claude', cwd: f.dir, parentId: w.id, delegation: { role: 'artisan', goal: 'Implement', doneWhen: ['Tests pass'], at: Date.now() } }, 'agent');
    f.script.get(w.id)!.push({ answer: '```run-report\n{"outcome":"done","verified":"yes","summary":"Done"}\n```' });
    await f.m.send(w.id, 'Stato', undefined, false, 'Orchestrator');
    expect(f.chat(w.id).work?.status).toBe('assigned');
    expect(f.chat(w.id).run?.endedAt).toBeUndefined();
  });

  it.each(['claude', 'cursor', 'opencode', 'codex'] as const)('%s: completes an explicit report and archives it with closedBy auto', async harness => {
    const f = fixture(harness), r = await f.orchestrator();
    const w = await f.worker(r.id, { report: 'Tre fonti trovate, sintesi nel file notes.md.', mail: 'Report finale disponibile.', answer: 'Report inviato all’Orchestrator.' });
    expect(f.chat(w.id).work?.status).toBe('completed');
    expect(f.chat(w.id).run).toMatchObject({ endReason: 'completed' });
    expect(f.chat(w.id).waitsOn).toBeUndefined();
    await runScheduler(f.m, [w.id]);
    expect(f.chat(w.id)).toMatchObject({ state: 'closed', closedBy: 'auto' });
    expect(f.chat(w.id).run?.endReason).toBe('completed');
    expect(f.chat(r.id).closedAt).toBeUndefined();
  });

  it('a completed plan can finish with an explicit final report', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { answer: 'Avviato.' });
    f.m.seedPlan(w.id, { phase: 'done', clarified: [], steps: [{ title: 'Review', state: 'done' }], at: Date.now() });
    f.script.get(w.id)!.push({ report: 'Verifica conclusa.', answer: 'Fatto.' });
    await f.m.send(w.id, 'Risultato', undefined, false, 'Orchestrator');
    expect(f.chat(w.id).work?.status).toBe('completed');
    expect(f.chat(w.id).run?.endReason).toBe('completed');
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

  it('mail that says it waits for the user keeps it open, tagged by its real state: no final report yet', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { mail: 'Bozza pronta in docs/x.md. Aspetto il tuo ok, poi la pubblico.', answer: 'Report inviato.' });
    expect(f.chat(w.id)).toMatchObject({ waitsOn: 'user', work: { status: 'assigned' } });
    const s = await runScheduler(f.m, [w.id]);
    expect(f.chat(w.id).closedAt).toBeUndefined();
    expect(s.state().find(x => x.chatId === w.id)).toMatchObject({ waitingFor: 'report', deadline: null });
  });

  it('mail that says it waits for colleagues keeps it open, never with a colleagues tag', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { mail: 'Parte mia fatta. Aspetto la risposta della chat Backend per chiudere.', answer: 'Inviato.' });
    expect(f.chat(w.id).waitsOn).toBe('colleagues');
    const s = await runScheduler(f.m, [w.id]);
    expect(f.chat(w.id).closedAt).toBeUndefined();
    expect(s.state().find(x => x.chatId === w.id)?.waitingFor).toBe('report');
  });

  // #359 regression: the observed Artisan answer (a request for its parent, already handled), agent_report sent,
  // nothing pending, no children, no background: no «waits for you» tag; the words still keep it open (never earlier)
  it('a sent report whose answer asks its parent for an ok shows no wait (the tile reads done), and stays open', async () => {
    const f = fixture(), r = await f.orchestrator();
    const answer = 'La regola «modifiche all’app → issue su GitHub, le fa l’agente in cloud» invece non è applicata: serve un tuo ok diretto.\n\nIl filo «Telefono» va chiuso dall’Orchestrator con l’hash `330699fb`: io non ho lo strumento per chiuderlo.';
    const w = await f.worker(r.id, { report: 'Parte fatta, il resto spetta all’Orchestrator.', outcome: 'done', answer });
    expect(f.chat(w.id).waitsOn).toBe('user'); // the words' guess: it holds, it does not tag
    const s = await runScheduler(f.m, [w.id]);
    expect(f.chat(w.id).closedAt).toBeUndefined();
    expect(s.state().find(x => x.chatId === w.id)?.waitingFor).toBeUndefined();
  });

  it('«Aspetto il tuo ok sul testo «nota.md».» with nothing pending gives no user or colleagues tag', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { report: 'Testo pronto.', answer: 'Aspetto il tuo ok sul testo «nota.md».' });
    const s = await runScheduler(f.m, [w.id]);
    expect(s.state().find(x => x.chatId === w.id)?.waitingFor).toBeUndefined();
  });

  it('an open question keeps it open with «Aspetta te: domanda», even after its report', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { mail: 'Report: fatto quasi tutto.', answer: 'Una domanda prima di chiudere.', question: true });
    expect(f.chat(w.id).work?.status).toBe('assigned');
    const s = await runScheduler(f.m, [w.id]);
    expect(f.chat(w.id).closedAt).toBeUndefined();
    expect(s.state().find(x => x.chatId === w.id)?.waitingFor).toBe('answer');
  });

  it('a background task still running keeps it open with «In background: 1»', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { mail: 'Report: analisi lanciata.', answer: 'Report inviato.', background: true });
    expect(f.chat(w.id).work?.status).toBe('assigned');
    const s = await runScheduler(f.m, [w.id]);
    expect(f.chat(w.id).closedAt).toBeUndefined();
    expect(s.state().find(x => x.chatId === w.id)).toMatchObject({ waitingFor: 'background', waitingN: 1 });
  });

  // The guards below hold an explicit agent_report too, not only mail (which never completes on its own).
  it('an explicit report that waits for the user keeps it assigned (its words hold it, #359 shows no tag for them)', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { report: 'Bozza pronta in docs/x.md. Aspetto il tuo ok, poi la pubblico.', answer: 'Report inviato.' });
    expect(f.chat(w.id)).toMatchObject({ waitsOn: 'user', work: { status: 'assigned' } });
    expect(f.chat(w.id).run?.endedAt).toBeUndefined();
  });

  it('an explicit report with an open question keeps it assigned', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { report: 'Fatto quasi tutto.', answer: 'Una domanda prima di chiudere.', question: true });
    expect(f.chat(w.id).work?.status).toBe('assigned');
    const s = await runScheduler(f.m, [w.id]);
    expect(s.state().find(x => x.chatId === w.id)?.waitingFor).toBe('answer');
  });

  it('an explicit report with background work still running keeps it assigned', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { report: 'Analisi conclusa.', answer: 'Report inviato.', background: true });
    expect(f.chat(w.id).work?.status).toBe('assigned');
    expect(f.chat(w.id).run?.endedAt).toBeUndefined();
  });

  it('an explicit report with a delegated child still owing its result keeps it assigned', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { answer: 'Avviato.' });
    await f.m.create({ harness: 'claude', cwd: f.dir, parentId: w.id, delegation: { role: 'artisan', goal: 'Implement', doneWhen: ['Tests pass'], at: Date.now() } }, 'agent');
    f.script.get(w.id)!.push({ report: 'Tutto fatto.', answer: 'Fatto.' });
    await f.m.send(w.id, 'Risultato', undefined, false, 'Orchestrator');
    expect(f.chat(w.id).work?.status).toBe('assigned');
    expect(f.chat(w.id).run?.endedAt).toBeUndefined();
  });

  it('a blocked explicit report keeps it assigned', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { report: 'Manca l’accesso al repository.', outcome: 'blocked', answer: 'Bloccato.' });
    expect(f.chat(w.id).work?.status).toBe('assigned');
    expect(f.chat(w.id).run?.endedAt).toBeUndefined();
  });

  it('a blocked agent_report wins over a later contradictory run-report done block', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { report: 'Manca l’accesso al repository.', outcome: 'blocked', answer: 'Bloccato.\n\n```run-report\n{"outcome":"done","verified":"yes","summary":"Done"}\n```' });
    expect(f.chat(w.id).work?.status).toBe('assigned');
    expect(f.chat(w.id).run?.report).toMatchObject({ via: 'agent_report', outcome: 'blocked' });
  });

  it('progress mail after an accepted final report does not replace it', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { report: 'Verifica conclusa.', mail: 'Prima parte verificata, proseguo.', answer: 'Fatto.' });
    expect(f.chat(w.id).work?.status).toBe('completed');
  });

  it('an explicit non-blocked report finalizes a running plan before the plan guard, then completes', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { answer: 'Avviato.' });
    f.m.seedPlan(w.id, { phase: 'running', clarified: [], steps: [{ title: 'Review', state: 'todo' }], at: Date.now() });
    f.script.get(w.id)!.push({ report: 'Chiuso con quello che c’è.', answer: 'Fatto.' });
    await f.m.send(w.id, 'Risultato', undefined, false, 'Orchestrator');
    expect(f.chat(w.id).plan?.phase).toBe('done');
    expect(f.chat(w.id).work?.status).toBe('completed');
  });

  it('a later clean report after a waiting one completes it', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { mail: 'Aspetto la risposta di «QA rimborsi».', answer: 'Inviato.' });
    expect(f.chat(w.id).waitsOn).toBe('colleagues');
    f.script.get(w.id)!.push({ report: 'QA ok, tutto chiuso.', answer: 'Fatto.' });
    await f.m.send(w.id, 'QA ok.', undefined, false, 'QA rimborsi');
    expect(f.chat(w.id).waitsOn).toBeUndefined();
    expect(f.chat(w.id).work?.status).toBe('completed');
  });

  it('a new message from its Orchestrator assigns it again; mail to someone else is no report', async () => {
    const f = fixture(), r = await f.orchestrator();
    const w = await f.worker(r.id, { report: 'Fatto.', answer: 'Fatto.' });
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
    const w = await f.worker(r.id, { report: 'Fatto.', answer: 'Fatto.' });
    expect(f.m.autoCloseCandidates(() => 'command').find(c => c.id === w.id)).toMatchObject({ eligible: false, waitingFor: 'command' });
    expect(f.m.autoCloseCandidates(() => 'browser').find(c => c.id === w.id)).toMatchObject({ eligible: false, waitingFor: 'browser' });
    // the command run (or the hand-off over): the tag goes at once, without a new turn (#359)
    expect(['command', 'browser']).not.toContain(f.m.autoCloseCandidates(() => false).find(c => c.id === w.id)?.waitingFor);
    expect(f.m.autoCloseCandidates(() => false).find(c => c.id === w.id)).toMatchObject({ eligible: true });
  });
});

describe('the brain journal gets a «fatto» line for every result (#375)', () => {
  type Entry = { role: string; title: string; summary: string; outcome: 'done' | 'partial' };
  it.each(['claude', 'codex', 'cursor'] as const)('%s: done and partial write one line each assignment, blocked none, a correction no second', async harness => {
    const lines: Entry[] = [];
    const f = fixture(harness, { journalFatto: async e => { lines.push(e); } }), r = await f.orchestrator();
    const w = await f.worker(r.id, { report: 'Tre fonti trovate.', answer: 'Fatto.' });
    expect(lines).toEqual([expect.objectContaining({ title: f.chat(w.id).title, summary: 'Tre fonti trovate.', outcome: 'done' })]);
    // the same assignment corrected: still one line
    f.m.reportRoot(w.id, { outcome: 'blocked', summary: 'Una fonte non regge.', output: 'x', doneWhen: [], amends: true });
    f.m.reportRoot(w.id, { outcome: 'done', summary: 'Tre fonti, corrette.', output: 'x', doneWhen: [], amends: true });
    expect(lines).toHaveLength(1); // done → blocked → done is one assignment
    expect(f.chat(w.id).run?.report?.journaled).toBe(true); // saved with the result: a restart in between changes nothing
    expect(readRun(JSON.parse(JSON.stringify(f.chat(w.id).run)))?.report?.journaled).toBe(true); // and read back after a restart
    // a refused second report writes nothing either
    expect(() => f.m.reportRoot(w.id, { outcome: 'done', summary: 'Di nuovo.', output: 'x', doneWhen: [] })).toThrow();
    expect(lines).toHaveLength(1);
    const p = await f.worker(r.id, { report: 'Metà fatta.', outcome: 'partial', answer: 'Parziale.' });
    const b = await f.worker(r.id, { report: 'Manca l’accesso.', outcome: 'blocked', answer: 'Bloccato.' });
    expect(lines.map(l => [l.title, l.outcome])).toEqual([[f.chat(w.id).title, 'done'], [f.chat(p.id).title, 'partial']]);
    expect(f.chat(b.id).run?.report?.outcome).toBe('blocked');
    // a delegated chat's mark is read back too
    expect(readDelegation({ role: 'artisan', goal: 'g', doneWhen: [], at: 1, result: { outcome: 'done', summary: 's', at: 2, journaled: true } })?.result?.journaled).toBe(true);
    // a blocked result corrected to done is the work done now: its line is written then, once
    f.m.reportRoot(b.id, { outcome: 'done', summary: 'Accesso avuto, fatto.', output: 'x', doneWhen: [], amends: true });
    f.m.reportRoot(b.id, { outcome: 'done', summary: 'Fatto, ricontrollato.', output: 'x', doneWhen: [], amends: true });
    expect(lines.map(l => [l.title, l.outcome])).toEqual([[f.chat(w.id).title, 'done'], [f.chat(p.id).title, 'partial'], [f.chat(b.id).title, 'done']]);
  });

  it('a journal that cannot be written never fails the report', async () => {
    const f = fixture('claude', { journalFatto: async () => { throw new Error('no mem.mjs'); } }), r = await f.orchestrator();
    const w = await f.worker(r.id, { report: 'Fatto tutto.', answer: 'Fatto.' });
    await new Promise(res => setImmediate(res));
    expect(f.chat(w.id).run?.report).toMatchObject({ outcome: 'done', via: 'agent_report' });
  });
});
