// Unit tests of «one command, one panel» (ADR 0299): the normalization (shared/command-dupes.ts), the run-time guard in
// main (run/runner.ts start, with a fake process: nothing real starts), the asks that never offer a command twice
// (run/asks.ts), and the reference a repeated code block becomes (shared/command-dupes.ts commandRefOf, kept by
// renderer/lib/runs.ts). The incident of
// 2026-11-13 replayed with invented commands: a work chat leaves command X, the Orchestrator repeats X in a block.
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatItem, ChatSummary, EventMap, PendingRequest, RunInfo } from '../../src/shared/contract';
import { alreadyRunningText, commandRefOf as refOf, normCommand, originalOf, RERUN_MS, rerunText, sameCommand, type CommandOriginal } from '../../src/shared/command-dupes';
import { CommandRunner, flaggedCommand } from '../../src/main/run/runner';
import { CommandAsks } from '../../src/main/run/asks';

const fence = (lang: string, code: string) => '```' + lang + '\n' + code + '\n```';
const DEPLOY = 'az deployment group create -g rg-demo -f main.bicep';

describe('normCommand: the same command, whatever its whitespace', () => {
  it('trailing whitespace and line endings do not make another command; a different argument does', () => {
    expect(sameCommand('npm run build  ', 'npm run build')).toBe(true);
    expect(sameCommand('Get-Item a\r\nGet-Item b\r\n', 'Get-Item a\nGet-Item b')).toBe(true);
    expect(sameCommand('  npm   run build\t', 'npm run build')).toBe(true);
    expect(sameCommand(DEPLOY, DEPLOY.replace('rg-demo', 'rg-other'))).toBe(false);
    expect(sameCommand('npm run build', 'npm run build -- --watch')).toBe(false);
    expect(sameCommand('', '   ')).toBe(false);
    expect(normCommand('a \r\n b')).toBe('a b');
  });

  it('the guard\'s words', () => {
    expect(alreadyRunningText({ startedAt: 1_000 }, 'Deploy demo', 106_000)).toBe('Già in corso da 105 s, avviato da «Deploy demo»');
    expect(rerunText({ startedAt: 0, endedAt: 60_000, exitCode: 0, state: 'ok' }, 4 * 60_000)).toBe('Eseguito 3 min fa, exit 0. Rieseguire?');
  });
});

// ---------------------------------------------------------------- the runner, with a fake process

class FakeProc extends EventEmitter { stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough(); pid = undefined; kill() { return true; } }

function runner(texts: Record<string, string>) {
  let now = 1_000_000;
  const procs: FakeProc[] = [];
  const r = new CommandRunner({
    itemText: (c, i) => texts[`${c}/${i}`] ?? null, cwdOf: () => null, emit: () => {},
    spawn: (() => { const p = new FakeProc(); procs.push(p); return p; }) as never,
    now: () => now, shell: 'fake-shell',
  });
  return { r, procs, tick: (ms: number) => { now += ms; }, finish: (i: number, code: number) => { procs[i]!.emit('close', code); } };
}

describe('CommandRunner: an identical command never runs twice by accident (ADR 0299)', () => {
  const texts = { 'worker/w1': `Lancia:\n${fence('powershell', DEPLOY)}`, 'orch/o1': `Il deploy:\n${fence('powershell', `${DEPLOY}  \r\n`)}`,
    'w/a': fence('powershell', 'npm run build'), 'o/b': fence('powershell', 'npm run build\r\n') };

  it('a second Esegui on an identical running command starts no process and returns the «already running» state', () => {
    const x = runner(texts);
    const first = x.r.start({ chatId: 'worker', itemId: 'w1', code: DEPLOY, confirmProd: true });
    expect(first.state).toBe('running');
    expect(first.already).toBeUndefined();
    x.tick(105_000);
    const second = x.r.start({ chatId: 'orch', itemId: 'o1', code: `${DEPLOY}  \r\n`, confirmProd: true });
    expect(second.already).toBe('running');
    expect(second.id).toBe(first.id);
    expect(second.chatId).toBe('worker');
    expect(x.procs).toHaveLength(1);
    expect(x.r.list().filter(r => r.state === 'running')).toHaveLength(1);
    // the same block clicked twice: the same answer, never an error and never a process
    expect(x.r.start({ chatId: 'worker', itemId: 'w1', code: DEPLOY, confirmProd: true }).already).toBe('running');
    expect(x.procs).toHaveLength(1);
  });

  it('a re-run within 10 minutes asks one confirmation; after 10 minutes it runs; the re-run carries duplicateOf', () => {
    const x = runner(texts);
    const first = x.r.start({ chatId: 'w', itemId: 'a', code: 'npm run build' });
    x.finish(0, 2);
    x.tick(3 * 60_000);
    const again = x.r.start({ chatId: 'o', itemId: 'b', code: 'npm run build\r\n' });
    expect(again.already).toBe('done');
    expect(again.exitCode).toBe(2);
    expect(x.procs).toHaveLength(1);
    const yes = x.r.start({ chatId: 'o', itemId: 'b', code: 'npm run build\r\n', confirmRerun: true });
    expect(yes.already).toBeUndefined();
    expect(yes.state).toBe('running');
    expect(yes.duplicateOf).toBe(first.id);
    expect(x.procs).toHaveLength(2);
    x.finish(1, 0);
    x.tick(RERUN_MS + 1);
    expect(x.r.start({ chatId: 'w', itemId: 'a', code: 'npm run build' }).already).toBeUndefined();
    expect(x.procs).toHaveLength(3);
  });

  it('a production, database or Azure command asks the confirmation with no time limit in the session', () => {
    expect(flaggedCommand(DEPLOY)).toBe(true);
    expect(flaggedCommand('npm run build')).toBe(false);
    const x = runner(texts);
    x.r.start({ chatId: 'worker', itemId: 'w1', code: DEPLOY, confirmProd: true });
    x.finish(0, 0);
    x.tick(5 * 60 * 60_000);   // five hours later
    const again = x.r.start({ chatId: 'orch', itemId: 'o1', code: DEPLOY, confirmProd: true });
    expect(again.already).toBe('done');
    expect(x.procs).toHaveLength(1);
    expect(x.r.start({ chatId: 'orch', itemId: 'o1', code: DEPLOY, confirmProd: true, confirmRerun: true }).state).toBe('running');
    expect(x.procs).toHaveLength(2);
  });

  it('a shell that could not start ran nothing: no confirmation, and no duplicateOf pointing at it', () => {
    const x = runner(texts);
    let fail = true;
    const r = new CommandRunner({ itemText: (c, i) => (texts as Record<string, string>)[`${c}/${i}`] ?? null, cwdOf: () => null, emit: () => {}, shell: 'fake-shell',
      spawn: (() => { if (fail) throw new Error('ENOENT'); return new FakeProc(); }) as never });
    expect(r.start({ chatId: 'w', itemId: 'a', code: 'npm run build' }).state).toBe('error');
    fail = false;
    const next = r.start({ chatId: 'w', itemId: 'a', code: 'npm run build' });
    expect(next.already).toBeUndefined();
    expect(next.duplicateOf).toBeUndefined();
    expect(x.procs).toHaveLength(0);
  });

  it('a different argument is another command: it runs at once', () => {
    const x = runner({ ...texts, 'o/c': fence('powershell', 'npm run build -- --watch') });
    x.r.start({ chatId: 'w', itemId: 'a', code: 'npm run build' });
    expect(x.r.start({ chatId: 'o', itemId: 'c', code: 'npm run build -- --watch' }).already).toBeUndefined();
    expect(x.procs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- the asks and the reference: the incident

const chat = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({
  harness: 'claude', origin: 'app', title: 'Lavoro', cwd: 'C:/x', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
});
const asst = (id: string, text: string): ChatItem => ({ kind: 'assistant', id, at: 1, text });

function world(runs: RunInfo[] = []) {
  const s = new CommandAsks({
    emit: () => {}, ran: () => false, settleMs: 10, now: () => 2_000_000,
    // the Orchestrator's folder is not the worker's (that is why the old rule let it through)
    cwdOf: id => (id === 'orch' ? 'C:/work/home' : 'C:/repo/demo-app'), runs: () => runs,
    firstRunOf: code => runs.find(r => normCommand(r.code) === normCommand(code))?.id,
  });
  const ev = <K extends keyof EventMap>(ch: K, p: EventMap[K]) => s.observe(ch, p);
  const turn = (id: string, items: ChatItem[], extra: Partial<ChatSummary> = {}) => {
    ev('chat:updated', chat({ id, state: 'running', ...extra }));
    for (const it of items) ev('chat:item', { chatId: id, item: it });
    ev('chat:updated', chat({ id, state: 'idle', ...extra }));
    vi.advanceTimersByTime(20);
  };
  return { s, turn };
}

const memo = new Map<string, CommandOriginal>();
const commandRefOf = (chatId: string, itemId: string, code: string, pending: readonly PendingRequest[], runs: readonly RunInfo[]) => refOf(chatId, itemId, code, pending, runs, memo);

describe('the incident: a worker queues X, the Orchestrator repeats X in a code block (ADR 0299)', () => {
  beforeEach(() => { vi.useFakeTimers(); memo.clear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('exactly one runnable entry exists', () => {
    const w = world();
    w.turn('worker', [asst('w1', `Pronto. Lancia il deploy:\n${fence('powershell', DEPLOY)}`)], { title: 'Deploy demo' });
    w.turn('orch', [asst('o1', `Il lavoro è pronto; ora va lanciato:\n${fence('powershell', `${DEPLOY}  `)}`)], { isOrchestrator: true, title: 'Orchestrator' });
    const pending = w.s.pending();
    // one command request, the worker's
    expect(pending.map(p => p.chatId)).toEqual(['worker']);
    // the Orchestrator's block is a reference to it, not a second Esegui; the worker's own block is no repeat
    const ref = commandRefOf('orch', 'o1', `${DEPLOY}  `, pending, []);
    expect(ref?.original).toMatchObject({ kind: 'ask', chatId: 'worker', itemId: 'w1' });
    expect(ref?.ask?.id).toBe(pending[0]!.id);
    expect(commandRefOf('worker', 'w1', DEPLOY, pending, [])).toBeNull();
    // the worker's run started: the reference follows it («in corso»), then «finito, exit 0», after the request left
    const run: RunInfo = { id: 'run-1', chatId: 'worker', itemId: 'w1', code: DEPLOY, cwd: 'C:/repo/demo-app', state: 'running', exitCode: null, output: '', startedAt: 2_000_000 };
    expect(commandRefOf('orch', 'o1', DEPLOY, [], [run])?.run?.state).toBe('running');
    expect(commandRefOf('orch', 'o1', DEPLOY, [], [{ ...run, state: 'ok', exitCode: 0 }])?.run?.exitCode).toBe(0);
  });

  it('while the identical command runs, another chat\'s block is never offered', () => {
    const live: RunInfo = { id: 'run-2', chatId: 'worker', itemId: 'w1', code: DEPLOY, cwd: 'C:/repo/demo-app', state: 'running', exitCode: null, output: '', startedAt: 1_990_000 };
    const w = world([live]);
    w.s.useResults(() => true);
    w.turn('orch', [asst('o1', `Lancia:\n${fence('powershell', DEPLOY)}`)], { isOrchestrator: true });
    expect(w.s.pending()).toEqual([]);
  });

  it('a request whose command already ran in this session carries duplicateOf; a different argument is another command', () => {
    const done: RunInfo = { id: 'run-0', chatId: 'old', itemId: 'z', code: 'npm run seed:demo', cwd: 'C:/elsewhere', state: 'error', exitCode: 1, output: '', startedAt: 1_000 };
    const w = world([done]);
    w.turn('worker', [asst('w1', `Lancia:\n${fence('powershell', 'npm run seed:demo')}`)]);
    w.turn('orch', [asst('o1', `Lancia:\n${fence('powershell', 'npm run seed:demo -- --fresh')}`)], { isOrchestrator: true });
    const p = w.s.pending();
    expect(p.map(x => [x.chatId, x.command?.duplicateOf ?? null])).toEqual([['worker', 'run-0'], ['orch', null]]);
  });

  it('originalOf never points a block to itself, and picks the first identical entry', () => {
    const ask = (chatId: string, itemId: string, at: number): PendingRequest => ({ id: `cmd-${itemId}-0`, chatId, type: 'command', tool: 'Esegui', title: '', detail: 'x', input: null, at, command: { itemId, code: 'echo demo', lang: 'powershell' } });
    expect(originalOf('echo demo', { chatId: 'a', itemId: 'a1' }, [ask('a', 'a1', 1)], [])).toBeNull();
    expect(originalOf('echo demo ', { chatId: 'c', itemId: 'c1' }, [ask('b', 'b1', 5), ask('a', 'a1', 2)], [])?.chatId).toBe('a');
  });
});
