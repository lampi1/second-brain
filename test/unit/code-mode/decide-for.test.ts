// Code Mode's internal calls through the real ChatManager (ADR 0331): run_code (code-mode/tool.ts) calls each tool
// through ChatManager.decideFor, the same gates as a native request (gateDecision). A refused call is an error in the
// script; a call only the user runs (a brain rule «esegui») stops the script with the usual «write the command in a
// fenced block» message, from which the chat's reply gets its Esegui button; a call left to the user waits for his
// panel, and his answer settles it; with the setting off a chat has no run_code at all. No engine runs: a fake session.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions, SessionSink } from '../../../src/main/chats/session';
import type { ChatItem, PendingRequest } from '../../../src/shared/contract';
import type { CallCtx } from '../../../src/main/mcp/server';
import { runCodeTool, type RunCodeDeps } from '../../../src/main/code-mode/tool';
import type { NativeEnv } from '../../../src/main/code-mode/natives';
import { stableGuards } from '../../../src/main/chats/claude';

const dirs: string[] = [], managers: ChatManager[] = [];
const tmp = (): string => { const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cm-'))); dirs.push(d); return d; };
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(50); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const RULES = [
  { id: 'db-write', action: 'esegui', why: 'database writes are the user\'s', tools: ['command'], match: ['sqlcmd .*DELETE'] },
  { id: 'push', action: 'ask-user', why: 'a push leaves the PC', tools: ['command'], match: ['^git push'] },
  { id: 'secret', action: 'never-print', why: 'secrets are never printed', tools: ['command'], match: ['cat .*\\.env'] },
];

interface Setup { m: ChatManager; id: string; cwd: string; events: { ch: string; p: unknown }[]; seen: SessionOptions[]; ran: string[]; envs: NativeEnv[]; sink: SessionSink; claude: Claude }
/** what the fake Claude session tells run_code (ClaudeSession.toolContext): its settings files, its --settings, the
 *  folder it works in (null: a worktree not named yet), its env */
interface Claude { files: string[]; inline: Record<string, unknown> | null; cwd?: string | null; context?: false }

async function setup(on: boolean, guard: (tool: string) => string | null = () => null, harness: 'claude' | 'cursor' | 'antigravity' = 'claude', claude: Claude = { files: [], inline: null }): Promise<Setup> {
  const userData = tmp(), cwd = tmp(), brain = tmp();
  fs.writeFileSync(path.join(brain, 'permissions.json'), JSON.stringify({ version: 1, rules: RULES }));
  const events: Setup['events'] = [], seen: SessionOptions[] = [], ran: string[] = [];
  let sink!: SessionSink;
  const m = new ChatManager({
    userData, emitter: { emit: (ch: string, p: unknown) => { events.push({ ch, p }); } } as never, brainRoot: () => brain,
    mcpUrlFor: id => `http://127.0.0.1:4000/mcp/chat/${id}`, codeMode: () => on, productGuard: c => guard(c.tool),
    sessionFactory: (h, options, s): HarnessSession => { seen.push(options); sink = s; return { harness: h, state: 'idle', sessionId: options.sessionId ?? null, pid: null, root: null, busy: false, alive: true,
      start: () => { s.changed({ state: 'idle' }); }, send: () => {}, answer: () => false, interrupt: async () => {}, setModel: async () => {}, setPermissionMode: async () => {}, setEffort: async () => {},
      rename: async () => {}, contextUsage: async () => null, usage: async () => null, close: async () => {}, killNow: () => {},
      ...(claude.context === false ? {} : { toolContext: () => ({ files: claude.files, inline: claude.inline, cwd: claude.cwd === undefined ? options.cwd : claude.cwd, env: { SB_CHAT_ENV: options.chatId } }) }) }; },
  });
  managers.push(m);
  const chat = await m.create({ harness, cwd, title: 'Code Mode' });
  await m.send(chat.id, 'ciao');
  return { m, id: chat.id, cwd, events, seen, ran, envs: [], sink, claude };
}

type Body = { ok: boolean; value?: unknown; stopped?: string; error?: string; calls: { tool: string; decision: string; ok: boolean }[]; text: string };
/** the last run's structured result (onResult), with the text the model read */
let last: Omit<Body, 'text'> | null = null;
function tool(s: Setup, over: Partial<RunCodeDeps> = {}) {
  return runCodeTool({
    onResult: (r, calls) => { last = { ok: r.ok, value: r.value, ...(r.stopped ? { stopped: r.stopped } : {}), ...(r.error ? { error: r.error } : {}), calls: [...calls] }; },
    decideFor: (c, t, i, o) => s.m.decideFor(c, t, i, o),
    row: (c, item, replace) => s.m.codeModeRow(c, item, replace),
    appTools: () => [], extServers: () => [], extTools: async () => [], context: c => s.m.codeModeContext(c),
    native: async (t, input, env) => { s.ran.push(`${t} ${String(input.command ?? input.file_path ?? '')}`); s.envs.push(env); return t === 'Bash' ? { exitCode: 0, stdout: 'done', stderr: '' } : 'ok'; },
    progressEveryMs: 1e9, ...over,
  });
}

const ctx = (chatId: string): CallCtx => ({ mount: 'chat', params: { chatId }, sessionId: 's', signal: new AbortController().signal, progress: () => true });
const body = (o: unknown): Body => ({ ...last!, text: ((o as { raw: { content: { text: string }[] } }).raw.content[0]!).text });
const rows = (s: Setup): Extract<ChatItem, { kind: 'tool' }>[] => s.events.filter(e => e.ch === 'chat:item').map(e => (e.p as { item: ChatItem }).item).filter((i): i is Extract<ChatItem, { kind: 'tool' }> => i.kind === 'tool');
const sysCodes = (s: Setup): string[] => s.events.filter(e => e.ch === 'chat:item').map(e => (e.p as { item: ChatItem }).item).filter(i => i.kind === 'system').map(i => String((i as { code?: unknown }).code ?? ''));

describe('run_code internal calls through ChatManager.decideFor', () => {
  it('an allowed call runs and shows one compact row', async () => {
    const s = await setup(true);
    const out = body(await tool(s).run({ code: 'const r = await tools.Bash({ command: "ls" }); return r.stdout;' }, ctx(s.id)));
    expect(out).toMatchObject({ ok: true, value: 'done', calls: [{ tool: 'Bash', decision: 'allowed', ok: true }] });
    expect(s.ran).toEqual(['Bash ls']);
    const last = rows(s).at(-1)!;
    expect(last).toMatchObject({ name: 'run_code · Bash', status: 'ok', summary: 'consentito' });
  });

  it('a denied call is an error the script sees, and never runs', async () => {
    const s = await setup(true);
    const out = body(await tool(s).run({ code: 'try { await tools.Bash({ command: "cat ~/.env" }); } catch (e) { return "caught: " + e.message; }' }, ctx(s.id)));
    expect(out.ok).toBe(true);
    expect(String(out.value)).toMatch(/^caught: Refused by the user's rule "secret"/);
    expect(out.calls).toEqual([{ tool: 'Bash', decision: 'denied', ok: false }]);
    expect(s.ran).toEqual([]);
    expect(rows(s).at(-1)).toMatchObject({ status: 'error', summary: 'negato' });
    expect(sysCodes(s)).toContain('policyNeverPrint');
  });

  it('the brain\'s product guard refuses an internal call as it does a native one', async () => {
    const s = await setup(true, t => (t === 'Write' ? 'Product rule: no writes here.' : null));
    const out = body(await tool(s).run({ code: 'await tools.Write({ file_path: "a.txt", content: "x" }); return 1;' }, ctx(s.id)));
    expect(out).toMatchObject({ ok: false, calls: [{ tool: 'Write', decision: 'denied', ok: false }] });
    expect(out.error).toMatch(/no writes here/);
    expect(s.ran).toEqual([]);
  });

  it('an Esegui call stops the script there, with the usual fenced-command message for the Esegui button', async () => {
    const s = await setup(true);
    const code = 'await tools.Bash({ command: "ls" }); try { await tools.Bash({ command: \'sqlcmd -S prod -Q "DELETE FROM t"\' }); } catch (e) { } await tools.Bash({ command: "echo after" }); return "end";';
    const out = body(await tool(s).run({ code }, ctx(s.id)));
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/^Stopped: [\s\S]*Only the user runs this, by pressing Esegui[\s\S]*fenced code block/);
    // the call after it never ran, even though the script caught the stop
    expect(s.ran).toEqual(['Bash ls']);
    expect(out.calls.map(c => c.decision)).toEqual(['allowed', 'esegui']);
    expect(rows(s).at(-1)).toMatchObject({ status: 'error', summary: 'solo con Esegui: script fermato' });
    expect(sysCodes(s)).toContain('policyEsegui');
  });

  it('a call left to the user waits for his panel; his yes lets it run, and the wait is reported', async () => {
    const s = await setup(true);
    const waited: number[] = [];
    const t = tool(s, {
      decideFor: (c, name, i, o) => s.m.decideFor(c, name, i, { ...o, waited: ms => { waited.push(ms); o.waited?.(ms); } }),
      native: async (n, input) => { s.ran.push(`${n} ${String(input.command)}`); return { exitCode: 0, stdout: 'pushed', stderr: '' }; },
    });
    const running = t.run({ code: 'return (await tools.Bash({ command: "git push origin main" })).stdout;' }, ctx(s.id));
    const panel = await waitPending(s);
    expect(panel).toMatchObject({ type: 'permission', tool: 'Bash', noAlways: true });
    expect(panel.title).toMatch(/^\(run_code\)/);
    expect(s.ran).toEqual([]);
    await s.m.answer(s.id, panel.id, { kind: 'permission', allow: true });
    const out = body(await running);
    expect(out).toMatchObject({ ok: true, value: 'pushed', calls: [{ tool: 'Bash', decision: 'allowed by the user', ok: true }] });
    expect(waited).toHaveLength(1);
    expect(rows(s).at(-1)).toMatchObject({ status: 'ok', summary: 'consentito dall’utente' });
  });

  it('his no is an error in the script', async () => {
    const s = await setup(true);
    const running = tool(s).run({ code: 'await tools.Bash({ command: "git push" }); return 1;' }, ctx(s.id));
    const panel = await waitPending(s);
    await s.m.answer(s.id, panel.id, { kind: 'permission', allow: false, message: 'non ora' });
    const out = body(await running);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/The user refused this call: non ora/);
    expect(s.ran).toEqual([]);
    expect(rows(s).at(-1)).toMatchObject({ status: 'error', summary: 'rifiutato dall’utente' });
  });

  it('the script\'s call cancelled takes the panel away', async () => {
    const s = await setup(true);
    const ac = new AbortController();
    const running = tool(s).run({ code: 'await tools.Bash({ command: "git push" }); return 1;' }, { ...ctx(s.id), signal: ac.signal });
    const panel = await waitPending(s);
    ac.abort();
    const out = body(await running);
    expect(out.ok).toBe(false);
    expect(s.events.some(e => e.ch === 'pending:resolved' && (e.p as { requestId?: string; id?: string }).requestId === panel.id)).toBe(true);
  });
});

describe('run_code meets what a native call meets (Sentinel review fixes)', () => {
  const settingsFile = (permissions: object): string => { const f = path.join(tmp(), 'settings.json'); fs.writeFileSync(f, JSON.stringify({ permissions })); return f; };

  it('a deny rule of the user\'s Claude settings refuses the call, which never runs', async () => {
    const s = await setup(true, () => null, 'claude', { files: [settingsFile({ deny: ['Bash(az webapp deploy:*)'] })], inline: null });
    const out = body(await tool(s).run({ code: 'try { await tools.Bash({ command: "ls; az webapp deploy -n prod" }); } catch (e) { return e.message; }' }, ctx(s.id)));
    expect(String(out.value)).toMatch(/denied by the user's Claude settings \(Bash\(az webapp deploy:\*\)\)/);
    expect(s.ran).toEqual([]);
  });

  it('the stable app\'s guard rails (its --settings) refuse a kill', async () => {
    const s = await setup(true, () => null, 'claude', { files: [], inline: stableGuards(tmp()) });
    const out = body(await tool(s).run({ code: 'await tools.Bash({ command: "taskkill /F /PID 1" }); return 1;' }, ctx(s.id)));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Claude settings \(Bash\(taskkill:\*\)\)/);
    expect(s.ran).toEqual([]);
  });

  it('rules that cannot be read refuse every call (fail closed)', async () => {
    const bad = path.join(tmp(), 'settings.json'); fs.writeFileSync(bad, '{ broken');
    const s = await setup(true, () => null, 'claude', { files: [bad], inline: null });
    expect(await s.m.decideFor(s.id, 'Bash', { command: 'ls' })).toMatchObject({ kind: 'deny', message: expect.stringMatching(/cannot be read/) });
    const none = await setup(true, () => null, 'claude', { files: [], inline: null, context: false });
    expect(await none.m.decideFor(none.id, 'Read', { file_path: 'a' })).toMatchObject({ kind: 'deny' });
  });

  it('an ask rule sends a call the gates would allow to the user', async () => {
    const s = await setup(true, () => null, 'claude', { files: [settingsFile({ ask: ['Bash(ls:*)'] })], inline: null });
    const running = tool(s).run({ code: 'return (await tools.Bash({ command: "ls -la" })).stdout;' }, ctx(s.id));
    const panel = await waitPending(s);
    expect(panel.tool).toBe('Bash');
    await s.m.answer(s.id, panel.id, { kind: 'permission', allow: true });
    expect(body(await running)).toMatchObject({ ok: true, value: 'done' });
  });

  it('the wrappers run in the folder the engine works in (a --worktree chat), with the chat\'s env and the time left', async () => {
    const wt = tmp();
    const s = await setup(true, () => null, 'claude', { files: [], inline: null, cwd: wt });
    body(await tool(s).run({ code: 'await tools.Bash({ command: "ls" }); return 1;' }, ctx(s.id)));
    expect(s.envs[0]).toMatchObject({ cwd: wt, env: { SB_CHAT_ENV: s.id } });
    expect(s.envs[0]!.maxMs).toBeGreaterThan(0);
    expect(s.envs[0]!.maxMs).toBeLessThanOrEqual(280_000);
    // a worktree not named yet: nothing runs in a guessed folder
    const early = await setup(true, () => null, 'claude', { files: [], inline: null, cwd: null });
    const out = body(await tool(early).run({ code: 'await tools.Read({ file_path: "a" }); return 1;' }, ctx(early.id)));
    expect(out.error).toMatch(/worktree is not known yet/);
    expect(early.ran).toEqual([]);
  });

  it('plan mode: no Write, no Edit, no command that writes; a reading command runs', async () => {
    const s = await setup(true);
    s.sink.changed({ permissionMode: 'plan' });
    expect(await s.m.decideFor(s.id, 'Write', { file_path: 'a', content: 'x' })).toMatchObject({ kind: 'deny', message: expect.stringMatching(/plan mode/) });
    expect(await s.m.decideFor(s.id, 'Edit', { file_path: 'a', old_string: 'a', new_string: 'b' })).toMatchObject({ kind: 'deny' });
    expect(await s.m.decideFor(s.id, 'Bash', { command: 'rm -rf src' })).toMatchObject({ kind: 'deny', message: expect.stringMatching(/plan mode/) });
    expect(await s.m.decideFor(s.id, 'Bash', { command: 'git status' })).toMatchObject({ kind: 'allow' });
    // PowerShell is a command too: in plan mode only a reading one runs
    expect(await s.m.decideFor(s.id, 'PowerShell', { command: 'Remove-Item -Recurse src' })).toMatchObject({ kind: 'deny', message: expect.stringMatching(/plan mode: only commands that read/) });
    expect(await s.m.decideFor(s.id, 'PowerShell', { command: 'git status' })).toMatchObject({ kind: 'allow' });
  });

  it('a call still waiting when the script ends loses its panel and never runs', async () => {
    const s = await setup(true);
    const out = body(await tool(s).run({ code: 'tools.Bash({ command: "git push" }).catch(() => {}); await tools.Bash({ command: "ls" }); return 1;' }, ctx(s.id)));
    expect(out.ok).toBe(true);
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    const added = s.events.filter(e => e.ch === 'pending:added').map(e => (e.p as PendingRequest).id);
    const gone = s.events.filter(e => e.ch === 'pending:resolved').map(e => (e.p as { requestId?: string }).requestId);
    for (const id of added) expect(gone).toContain(id);
    expect(s.ran).toEqual(['Bash ls']);
  });
});

describe('the Code Mode setting', () => {
  it('off: the chat has no run_code, Claude keeps its native tools, and decideFor refuses', async () => {
    const s = await setup(false);
    expect(s.m.chatToolShown(s.id, 'run_code')).toBe(false);
    const args = s.seen.at(-1)?.extraArgs ?? [];
    expect(args.join(' ')).not.toMatch(/run_code/);
    expect(args).not.toContain('--disallowedTools');
    expect(s.seen.at(-1)?.codeMode).toBeUndefined();
    expect(await s.m.decideFor(s.id, 'Bash', { command: 'ls' })).toMatchObject({ kind: 'deny' });
  });

  it('on: Claude gets run_code pre-allowed and its native file and shell tools hidden', async () => {
    const s = await setup(true);
    expect(s.m.chatToolShown(s.id, 'run_code')).toBe(true);
    const args = s.seen.at(-1)?.extraArgs ?? [];
    expect(args[args.indexOf('--allowedTools') + 1]).toMatch(/mcp__second-brain__run_code/);
    expect(args[args.indexOf('--disallowedTools') + 1]!.split(',')).toEqual(expect.arrayContaining(['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob']));
    expect(s.seen.at(-1)?.codeMode).toBe(true);
  });

  it('on: a Cursor chat gets run_code too (its engine keeps its natives; the prompt asks to prefer run_code)', async () => {
    const s = await setup(true, () => null, 'cursor');
    expect(s.m.chatToolShown(s.id, 'run_code')).toBe(true);
    expect(s.seen.at(-1)?.codeMode).toBe(true);
    expect((s.seen.at(-1)?.extraArgs ?? []).join(' ')).not.toMatch(/disallowedTools/);
  });

  it('on/off: an Antigravity chat gets run_code when on (natives kept, decideFor works) and none when off', async () => {
    const on = await setup(true, () => null, 'antigravity');
    expect(on.m.chatToolShown(on.id, 'run_code')).toBe(true);
    expect(on.seen.at(-1)?.codeMode).toBe(true);
    expect((on.seen.at(-1)?.extraArgs ?? []).join(' ')).not.toMatch(/disallowedTools/);
    expect(await on.m.decideFor(on.id, 'Bash', { command: 'ls' })).toEqual({ kind: 'allow' });

    const off = await setup(false, () => null, 'antigravity');
    expect(off.m.chatToolShown(off.id, 'run_code')).toBe(false);
    expect(off.seen.at(-1)?.codeMode).toBeUndefined();
    expect(await off.m.decideFor(off.id, 'Bash', { command: 'ls' })).toMatchObject({ kind: 'deny' });
  });
});

async function waitPending(s: Setup): Promise<PendingRequest> {
  for (;;) {
    const e = s.events.find(x => x.ch === 'pending:added');
    if (e) return e.p as PendingRequest;
    await new Promise(r => setImmediate(r));
  }
}
