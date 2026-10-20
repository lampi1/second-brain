// The comparison's hidden read-only runs (src/main/compare/headless.ts, ADR 0046 §4) against the fakes only
// (test/fixtures/fake-claude.mjs as Claude, fake-cursor-acp.mjs as Cursor): the read tools allowed, editing, the shell
// and questions refused, Claude started in plan mode with only the read tools and no transcript, Cursor in its "ask"
// mode with a config copy without allow rules, the answer and its cost collected, a run past its time killed, an engine
// the user did not turn on refused, the prompt and the answer never in the logs, the denied folders (the other side's
// answers, the verdicts) never read: as deny rules for each engine and as refusals. Plus the pure helpers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DENIED_READ, HeadlessRunner, NO_NETWORK_PATH, NO_PLAN, NO_QUESTIONS, READ_ONLY_REFUSAL, RunCollector, askRefusal, checkModel, effortFor, isNetworkPath, readOnlyAnswer, readsDenied, refusal, shortError, type HeadlessDeps } from '../../../src/main/compare/headless';
import type { ModelRegistry } from '../../../src/shared/contract';
import { cursorReadRule, noAllowRules } from '../../../src/main/chats/acp';
import { claudeReadRule } from '../../../src/main/chats/claude';
import { addRedaction, log } from '../../../src/main/log';
import { engineOrThrow } from '../../../src/main/engines/registry';
import { FAKE, FAKE_CURSOR, alive, cursorLog, fakeLog, tmp, waitFor } from '../chats/helpers';

const ON = { engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: true } };
let claudeLog = '', cursorLogFile = '', claudeHome = '', userData = '';

beforeEach(() => {
  claudeLog = path.join(tmp('hl-log'), 'claude.jsonl');
  cursorLogFile = path.join(tmp('hl-log'), 'cursor.jsonl');
  claudeHome = tmp('hl-claude-home');
  userData = tmp('hl-userdata');
  // the user's Cursor config, with an allow rule a read-only run must not inherit
  const cursorHome = tmp('hl-cursor-home');
  fs.writeFileSync(path.join(cursorHome, 'cli-config.json'), JSON.stringify({ permissions: { allow: ['Shell(npm test)'], deny: ['Shell(rm)'] }, model: 'x' }));
  vi.stubEnv('FAKE_CLAUDE_LOG', claudeLog);
  vi.stubEnv('FAKE_CURSOR_LOG', cursorLogFile);
  vi.stubEnv('CLAUDE_CONFIG_DIR', claudeHome);
  vi.stubEnv('CURSOR_CONFIG_DIR', cursorHome);
});
afterEach(() => { vi.unstubAllEnvs(); });

function runner(o: Partial<HeadlessDeps> = {}): HeadlessRunner {
  return new HeadlessRunner({ userData, settings: () => ON, keyFor: () => null, enginePaths: () => ({ claude: FAKE, cursor: FAKE_CURSOR }), ...o });
}
const req = (engine: string, prompt: string, o: Partial<{ model: string | null; effort: string | null; cwd: string }> = {}) =>
  ({ engine, prompt, cwd: o.cwd ?? tmp('hl-cwd'), model: o.model ?? null, effort: o.effort ?? null, round: 'r1' });
/** the answers this module gave in a run, from its own log lines */
const answered = () => log.recent.filter(e => e.msg === 'headless permission answered').map(e => e.data as { tool: string; allow: boolean });

describe('read-only answers (pure)', () => {
  it('allows only the read tools of each adapter; refuses the rest and every question', () => {
    for (const tool of ['Read', 'Grep', 'Glob']) expect(readOnlyAnswer('claude', { type: 'permission', tool })).toEqual({ kind: 'permission', allow: true });
    for (const tool of ['Bash', 'Edit', 'Write', 'WebFetch', 'mcp__x__y', 'Task']) expect(readOnlyAnswer('claude', { type: 'permission', tool })).toEqual({ kind: 'permission', allow: false, message: READ_ONLY_REFUSAL });
    expect(readOnlyAnswer('claude', { type: 'permission', tool: 'ExitPlanMode' })).toEqual({ kind: 'permission', allow: false, message: NO_PLAN });
    for (const tool of ['Read', 'Search', 'Think']) expect(readOnlyAnswer('acp', { type: 'permission', tool })).toMatchObject({ allow: true });
    for (const tool of ['Shell', 'Edit', 'Delete', 'Move', 'Fetch', 'Mode', 'Tool']) expect(readOnlyAnswer('acp', { type: 'permission', tool })).toMatchObject({ allow: false });
    expect(readOnlyAnswer('api', { type: 'permission', tool: 'Read' })).toMatchObject({ allow: false });
    expect(readOnlyAnswer('claude', { type: 'question', tool: 'AskUserQuestion' })).toEqual({ kind: 'permission', allow: false, message: NO_QUESTIONS });
    expect(readOnlyAnswer('acp', { type: 'question', tool: 'CreatePlan' })).toMatchObject({ allow: false, message: NO_QUESTIONS });
  });

  it('passes a model only when it cannot be read as a flag; effort only where the engine takes one', () => {
    expect(checkModel(null)).toEqual({ model: null });
    expect(checkModel('opus')).toEqual({ model: 'opus' });
    expect(checkModel('gpt-5.6-sol[reasoning=high]')).toEqual({ model: 'gpt-5.6-sol[reasoning=high]' });
    for (const bad of ['--dangerously-skip-permissions', '-x', 'a b', 'a;b', 'x"y']) expect(checkModel(bad)).toHaveProperty('error');
    expect(effortFor(engineOrThrow('claude'), 'medium')).toBe('medium');
    expect(effortFor(engineOrThrow('claude'), 'huge')).toBeNull();
    expect(effortFor(engineOrThrow('cursor'), 'medium')).toBe('medium'); // its model's thought_level option (#97)
    expect(effortFor(engineOrThrow('anthropic'), 'medium')).toBeNull();
  });

  it('refuses an engine that is off, untrusted, unknown or not for agents, and anything but a fake under tests', () => {
    const env = { VITEST: 'true' };
    expect(refusal('claude', ON, FAKE, env)).toBeNull();
    expect(refusal('claude', { ...ON, engineOn: { claude: false } }, FAKE, env)).toMatch(/Claude è spento/);
    expect(refusal('anthropic', { engineOn: { anthropic: true }, engines: { anthropic: true } }, FAKE_CURSOR, env)).toMatch(/Anthropic API è spento/); // on, but its definition never trusted
    // on, but «Gli Orchestrator possono usare Claude» off: the run comes from files agents write
    expect(refusal('claude', { ...ON, engines: { claude: false } }, FAKE, env)).toMatch(/Gli Orchestrator possono usare Claude/);
    expect(refusal('nope', ON, undefined, env)).toBe('motore sconosciuto: nope');
    expect(refusal('claude', ON, undefined, env)).toMatch(/serve il fake \(SB_CLAUDE_PATH\)/);
    expect(refusal('cursor', ON, 'C:/x/agent.exe', env)).toMatch(/serve il fake/);
    expect(refusal('claude', ON, undefined, {})).toBeNull(); // the app: the installed engine
  });

  it('never Fable nor effort max, as the routing table', () => {
    const reg = { models: [{ id: 'claude-fable-1', harness: 'claude', aliases: ['bard'] }] } as unknown as ModelRegistry;
    expect(askRefusal('opus', 'medium', reg)).toBeNull();
    expect(askRefusal('claude-fable-1', null, null)).toMatch(/Fable/);
    expect(askRefusal('bard', null, reg)).toMatch(/Fable/); // an alias of a Fable row
    expect(askRefusal('opus', 'max', reg)).toMatch(/sforzo max/);
    const r = runner({ registry: () => reg });
    expect(r.refuses({ engine: 'claude', model: 'bard', effort: null })).toMatch(/Fable/);
    expect(r.refuses({ engine: 'claude', model: '--x', effort: null })).toMatch(/^modello non valido/);
    expect(r.refuses({ engine: 'claude', model: 'opus', effort: 'high' })).toBeNull();
  });

  it('collects the last answer, cost, turns and the tokens summed over the turns; the run ends only when a finished turn left the session idle', () => {
    const c = new RunCollector();
    expect(c.changed({ state: 'idle' })).toBe(false); // started, no turn yet
    c.changed({ state: 'running', model: 'opus' });
    c.item({ kind: 'assistant', id: 'a1', at: 0, text: 'Guardo i file' });
    c.item({ kind: 'tool', id: 't1', at: 0, name: 'Read', summary: '', input: {}, status: 'ok' });
    c.item({ kind: 'assistant', id: 'a2', at: 0, text: 'Trovati 2 problemi', streaming: true });
    c.item({ kind: 'assistant', id: 'a2', at: 0, text: 'Trovati 3 problemi' });
    c.item({ kind: 'result', id: 'r', at: 0, costUsd: 0.25, durationMs: 9, turns: 4, isError: false });
    c.changed({ call: { context: 1200, cacheWrite: 0, usd: 0.1 } }); // one call's context: never the run's tokens
    c.changed({ turnTokens: { input: 10, cacheRead: 1000, cacheWrite: 100, output: 50 } });
    c.changed({ turnTokens: { input: 5, cacheRead: 2000, cacheWrite: 0, output: 20 } });
    expect(c.changed({ state: 'idle' })).toBe(true);
    expect(c.outcome()).toEqual({ ok: true, text: 'Trovati 3 problemi', costUsd: 0.25, turns: 4 });
    expect([c.model, c.tokens]).toEqual(['opus', { input: 15, cacheRead: 3000, cacheWrite: 100, output: 70 }]);
    const acp = new RunCollector();
    acp.item({ kind: 'assistant', id: 'a', at: 0, text: 'ok' });
    acp.item({ kind: 'result', id: 'r', at: 0, costUsd: 0, durationMs: 9, turns: 1, isError: false });
    acp.changed({ costKnown: false, contextTokens: 900, contextEstimated: true });
    expect(acp.outcome()).toMatchObject({ ok: true, costUsd: null });
    expect(acp.tokens).toBeNull(); // an estimate is no count, and no turn reported tokens
    const failed = new RunCollector();
    failed.item({ kind: 'system', id: 's', at: 0, text: 'Invalid API key', level: 'error' });
    failed.item({ kind: 'result', id: 'r', at: 0, costUsd: 0, durationMs: 1, turns: 0, isError: true });
    expect(failed.outcome()).toEqual({ ok: false, error: 'Invalid API key' });
  });

  it('shortError: one line, at most 300 characters, never a key the app holds', () => {
    addRedaction('k-0123456789abcdef');
    expect(shortError('rifiutato:\n  chiave k-0123456789abcdef')).toBe('rifiutato: chiave [redacted]');
    expect(shortError('x'.repeat(400))).toHaveLength(300);
  });

  it('refuses a read or a search that reaches a denied folder (the other side\'s answers, the verdicts)', () => {
    const brain = tmp('hl-brain');
    const denied = path.join(brain, 'reviews', 'compare');
    fs.mkdirSync(path.join(denied, 'r1'), { recursive: true });
    fs.mkdirSync(path.join(brain, 'src'));
    const scope = { cwd: brain, deny: [denied] };
    const ask = (tool: string, input: unknown, detail = '') => readOnlyAnswer('claude', { type: 'permission', tool, input, detail }, scope);
    const refused = { kind: 'permission', allow: false, message: DENIED_READ };
    expect(ask('Read', { file_path: path.join(brain, 'src', 'a.ts') })).toEqual({ kind: 'permission', allow: true });
    expect(ask('Read', { file_path: path.join(denied, 'r1', 'b.json') })).toEqual(refused);
    expect(ask('Read', { file_path: 'reviews/compare/r1/a.json' })).toEqual(refused); // relative to the run's folder
    expect(ask('Read', { file_path: path.join(brain, 'src', '..', 'reviews', 'compare', 'x') })).toEqual(refused);
    if (process.platform === 'win32') expect(ask('Read', { file_path: path.join(brain, 'REVIEWS', 'Compare', 'x') })).toEqual(refused);
    expect(ask('Glob', { pattern: 'reviews/**/*.json' })).toEqual(refused); // a glob that leads into it
    expect(ask('Grep', { pattern: 'TODO' })).toEqual(refused); // a search over the run's folder, which contains it
    expect(ask('Grep', { pattern: 'TODO', path: brain })).toEqual(refused);
    expect(ask('Grep', { pattern: 'TODO', path: path.join(brain, 'src') })).toEqual({ kind: 'permission', allow: true });
    // a junction into it is the same folder
    fs.symlinkSync(denied, path.join(brain, 'link'), 'junction');
    expect(ask('Read', { file_path: path.join(brain, 'link', 'r1', 'b.json') })).toEqual(refused);
    // ACP: the request's location (its detail)
    expect(readOnlyAnswer('acp', { type: 'permission', tool: 'Read', input: {}, detail: path.join(denied, 'b.json') }, scope)).toEqual(refused);
    expect(readOnlyAnswer('acp', { type: 'permission', tool: 'Search', input: {}, detail: '' }, { cwd: path.join(brain, 'src'), deny: [denied] })).toMatchObject({ allow: true });
    expect(readsDenied({ tool: 'Read', input: { file_path: path.join(denied, 'x') } }, brain, [])).toBe(false); // nothing denied
  });

  it('refuses every network or device path: a share reaches any folder, the denied ones too', () => {
    const net = { kind: 'permission', allow: false, message: NO_NETWORK_PATH };
    for (const p of ['\\\\localhost\\C$\\brain\\reviews\\compare\\b.json', '\\\\127.0.0.1\\c$\\x', '\\\\server\\share\\x', '//localhost/C$/x',
      '\\\\?\\UNC\\localhost\\C$\\x', '\\\\?\\C:\\brain\\x', '\\\\.\\C:\\x', 'file://localhost/C$/x', 'file:////server/share/x']) {
      expect(isNetworkPath(p)).toBe(true);
      expect(readOnlyAnswer('claude', { type: 'permission', tool: 'Read', input: { file_path: p } })).toEqual(net);
    }
    expect(readOnlyAnswer('claude', { type: 'permission', tool: 'Grep', input: { pattern: 'x', path: '\\\\localhost\\c$' } })).toEqual(net);
    expect(readOnlyAnswer('acp', { type: 'permission', tool: 'Read', input: {}, detail: 'Read b.json\n\\\\localhost\\C$\\b.json' })).toEqual(net);
    for (const p of ['C:\\brain\\a.ts', 'src/a.ts', '/c/brain/a.ts', 'file:///C:/brain/a.ts']) expect(isNetworkPath(p)).toBe(false);
  });

  it.runIf(process.platform === 'win32')('turns the denied folders into each engine\'s own deny rules', () => {
    expect(claudeReadRule('C:\\brain\\reviews\\compare\\')).toBe('Read(//c/brain/reviews/compare/**)');
    expect(cursorReadRule('C:\\brain\\reviews\\compare')).toBe('Read(C:/brain/reviews/compare/**)');
    expect(JSON.parse(noAllowRules('{}', ['C:\\b\\r'])!)).toEqual({ permissions: { allow: [], deny: ['Read(C:/b/r/**)'] } });
    expect((JSON.parse(noAllowRules(JSON.stringify({ permissions: { deny: ['Shell(rm)'] } }), ['C:\\b\\r'])!) as { permissions: { deny: string[] } }).permissions.deny).toEqual(['Shell(rm)', 'Read(C:/b/r/**)']);
  });

  it('a Cursor config copy for a read-only run keeps no allow rule', () => {
    expect(JSON.parse(noAllowRules(JSON.stringify({ permissions: { allow: ['Shell(*)'], deny: ['Shell(rm)'] }, allow: ['x'], model: 'm' }))!))
      .toEqual({ permissions: { allow: [], deny: ['Shell(rm)'] }, allow: [], model: 'm' });
    expect(noAllowRules('not json')).toBeNull();
  });
});

// every case starts a fake engine (1-5 s each on a busy Windows machine)
describe('hidden read-only runs on the fakes', { timeout: 60e3 }, () => {
  it('Claude: plan mode, read tools only, no MCP, no hooks, no transcript; Read allowed, Bash and questions refused', async () => {
    const cwd = tmp('hl-cwd');
    log.recent.length = 0;
    const r = await runner().run(req('claude', 'ask bash readgate SEGRETO-PROMPT', { cwd, model: 'opus', effort: 'medium' }));
    // tokens: the turn's total from the result's usage (the fake's), never a context size
    expect(r).toMatchObject({ ok: true, text: 'Letto a.txt', model: 'opus', effort: 'medium', costUsd: 0.01, turns: 1, tokens: { input: 10, cacheRead: 3000, cacheWrite: 200, output: 40 } });
    expect(answered()).toEqual([
      expect.objectContaining({ tool: 'AskUserQuestion', allow: false }), expect.objectContaining({ tool: 'Bash', allow: false }), expect.objectContaining({ tool: 'Read', allow: true }),
    ]);
    const argv = fakeLog(claudeLog).find(l => l.argv)!.argv!;
    expect(argv.slice(argv.indexOf('--permission-mode'), argv.indexOf('--permission-mode') + 2)).toEqual(['--permission-mode', 'plan']);
    expect(argv.slice(argv.indexOf('--tools'), argv.indexOf('--tools') + 2)).toEqual(['--tools', 'Read,Grep,Glob']);
    expect(argv).toEqual(expect.arrayContaining(['--strict-mcp-config', '--no-session-persistence']));
    expect(argv).not.toContain('--mcp-config');
    const settings = JSON.parse(argv[argv.indexOf('--settings') + 1]!) as { permissions: { deny: string[] }; disableAllHooks: boolean };
    expect(settings.disableAllHooks).toBe(true);
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write', 'WebFetch']));
    expect(fs.existsSync(path.join(claudeHome, 'projects'))).toBe(false); // no transcript: never an external chat
    // the logs carry engine, round, cost and duration, never the prompt nor the answer
    const lines = JSON.stringify(log.recent);
    expect(lines).not.toContain('SEGRETO-PROMPT');
    expect(lines).not.toContain('Letto a.txt');
    expect(log.recent.find(e => e.msg === 'headless run end')?.data).toMatchObject({ engine: 'claude', round: 'r1', ok: true, costUsd: 0.01 });
  });

  it('Claude: ExitPlanMode is refused with the request to answer as text', async () => {
    const r = await runner().run(req('claude', 'planexit'));
    expect(r).toMatchObject({ ok: true, text: `Piano rifiutato: ${NO_PLAN}` });
  });

  it('Cursor: its "ask" mode, no allow rules in its config copy; reading allowed, editing and the shell refused, questions skipped', async () => {
    const r = await runner().run(req('cursor', 'readgate writegate'));
    expect(r).toMatchObject({ ok: true, text: 'edit rifiutato', costUsd: null, turns: 1 });
    const lines = cursorLog(cursorLogFile);
    expect(lines.filter(l => l.method === 'session/set_mode').map(l => l.params?.modeId)).toEqual(['ask']);
    expect(lines.filter(l => 'answer' in l).map(l => (l.answer?.outcome as { optionId?: string }).optionId)).toEqual(['allow-once', 'reject-once']);
    // a config folder of its own for this run, without allow rules, removed when the run ended
    const start = lines.find(l => l.argv) as unknown as { configDir: string; cliConfig: { permissions: unknown } };
    expect(path.dirname(start.configDir)).toBe(path.join(userData, 'cursor-config-readonly'));
    expect(path.basename(start.configDir)).toMatch(/^cmp_[0-9a-f]{10}$/);
    expect(start.cliConfig.permissions).toEqual({ allow: [], deny: ['Shell(rm)'] });
    await waitFor(() => !fs.existsSync(start.configDir), 'the run\'s config folder removed');
    const shell = await runner().run(req('cursor', 'perm'));
    expect(shell).toMatchObject({ ok: true, text: 'Ok, non lo eseguo.' });
    const ask = await runner().run(req('cursor', 'ask'));
    expect(ask).toMatchObject({ ok: true, text: `Domande: skipped (${NO_QUESTIONS})` });
  });

  // the tree kill is a detached taskkill: on a loaded machine it can take a while to land (as in manager.test.ts)
  it('a run past its time is killed, with its process tree', { timeout: 200e3 }, async () => {
    vi.stubEnv('FAKE_CLAUDE_SLOW_TICKS', '5000');
    const r = await runner({ timeoutMs: 400 }).run(req('claude', 'slow'));
    expect(r).toMatchObject({ ok: false, error: 'tempo scaduto (<1 min): fermato' });
    const pid = fakeLog(claudeLog).find(l => l.argv)!.pid;
    await waitFor(() => !alive(pid), 'the timed-out engine gone', 180000);
  });

  it('an engine the user did not turn on, or not for agents, and a Fable model never start (a refusal, not a run error)', async () => {
    const r = await runner({ settings: () => ({ ...ON, engineOn: { claude: false, cursor: true } }) }).run(req('claude', 'ciao'));
    expect(r).toMatchObject({ ok: false, refused: true, error: expect.stringMatching(/Claude è spento/) });
    const agents = await runner({ settings: () => ({ ...ON, engines: { claude: false } }) }).run(req('claude', 'ciao'));
    expect(agents).toMatchObject({ ok: false, refused: true, error: expect.stringMatching(/Gli Orchestrator possono usare Claude/) });
    expect(await runner().run(req('claude', 'ciao', { model: 'claude-fable-1' }))).toMatchObject({ ok: false, refused: true, error: expect.stringMatching(/Fable/) });
    expect(await runner().run(req('claude', 'ciao', { effort: 'max' }))).toMatchObject({ ok: false, refused: true });
    expect(fakeLog(claudeLog)).toEqual([]);
  });

  it('an ACP engine without a read-only mode, or refusing it, is stopped before the prompt', async () => {
    vi.stubEnv('FAKE_CURSOR_MODES', 'agent');
    const none = await runner().run(req('cursor', 'readgate'));
    expect(none).toMatchObject({ ok: false, error: expect.stringMatching(/non offre una modalità in sola lettura/) });
    vi.stubEnv('FAKE_CURSOR_MODES', '');
    vi.stubEnv('FAKE_CURSOR_SET_MODE_FAILS', '1');
    const failed = await runner().run(req('cursor', 'readgate'));
    expect(failed).toMatchObject({ ok: false, error: expect.stringMatching(/non ha accettato la modalità in sola lettura \(ask\)/) });
    expect(cursorLog(cursorLogFile).filter(l => l.method === 'session/prompt')).toEqual([]); // the prompt never sent
  });

  it('a run in a network folder never starts', async () => {
    expect(await runner().run(req('claude', 'ciao', { cwd: '\\\\localhost\\C$\\Windows' }))).toMatchObject({ ok: false, error: expect.stringMatching(/^cartella di rete/) });
    expect(fakeLog(claudeLog)).toEqual([]);
  });

  it('a missing folder, a model that looks like a flag and a crash end as failures', async () => {
    expect(await runner().run(req('claude', 'ciao', { cwd: path.join(tmp('hl'), 'nope') }))).toMatchObject({ ok: false, error: expect.stringMatching(/^cartella non trovata/) });
    expect(await runner().run(req('claude', 'ciao', { model: '--dangerously-skip-permissions' }))).toMatchObject({ ok: false, error: expect.stringMatching(/^modello non valido/) });
    expect(fakeLog(claudeLog)).toEqual([]);
    const crash = await runner().run(req('claude', 'crash'));
    expect(crash.ok).toBe(false);
  });

  it('the denied folders: deny rules for Claude and Cursor, a read there refused, a run inside one never started', async () => {
    const brain = tmp('hl-brain');
    const denied = path.join(brain, 'reviews', 'compare');
    const sideA = path.join(brain, 'runs', 'a-out');
    fs.mkdirSync(path.join(denied, 'r1'), { recursive: true });
    fs.mkdirSync(sideA, { recursive: true });
    const r = runner({ denyRead: () => [denied] });
    const claude = await r.run({ ...req('claude', 'readgate=reviews/compare/r1/a.json', { cwd: brain }), denyRead: [sideA] });
    expect(claude).toMatchObject({ ok: true, text: `Lettura negata: ${DENIED_READ}` });
    const argv = fakeLog(claudeLog).find(l => l.argv)!.argv!;
    const deny = (JSON.parse(argv[argv.indexOf('--settings') + 1]!) as { permissions: { deny: string[] } }).permissions.deny;
    expect(deny).toEqual(expect.arrayContaining([claudeReadRule(denied), claudeReadRule(sideA)]));
    const sideARead = await r.run({ ...req('claude', 'readgate=runs/a-out/out.md', { cwd: brain }), denyRead: [sideA] });
    expect(sideARead).toMatchObject({ ok: true, text: `Lettura negata: ${DENIED_READ}` });
    const cursor = await r.run({ ...req('cursor', 'readgate=reviews/compare/r1/a.json', { cwd: brain }), denyRead: [sideA] });
    expect(cursor).toMatchObject({ ok: true, text: 'read rifiutato' });
    const cfg = (cursorLog(cursorLogFile).find(l => l.argv) as unknown as { cliConfig: { permissions: { deny: string[] } } }).cliConfig;
    expect(cfg.permissions.deny).toEqual(expect.arrayContaining(['Shell(rm)', cursorReadRule(denied), cursorReadRule(sideA)]));
    const starts = fakeLog(claudeLog).filter(l => l.argv).length;
    expect(await r.run(req('claude', 'ciao', { cwd: path.join(denied, 'r1') }))).toMatchObject({ ok: false, error: expect.stringMatching(/^cartella vietata/) });
    expect(fakeLog(claudeLog).filter(l => l.argv)).toHaveLength(starts);
  });

  it('two Cursor runs at once each get their own config folder, with their own deny rules', async () => {
    const a = tmp('hl-a'), b = tmp('hl-b');
    const r = runner();
    await Promise.all([r.run({ ...req('cursor', 'ciao'), denyRead: [a] }), r.run({ ...req('cursor', 'ciao'), denyRead: [b] })]);
    const starts = cursorLog(cursorLogFile).filter(l => l.argv) as unknown as { configDir: string; cliConfig: { permissions: { deny: string[] } } }[];
    expect(starts).toHaveLength(2);
    expect(starts[0]!.configDir).not.toBe(starts[1]!.configDir);
    // each run denies its own folder (by its path and, when it differs, its real path) and never the other's
    const denyOf = (dir: string) => starts.find(s => s.cliConfig.permissions.deny.includes(cursorReadRule(dir)))?.cliConfig.permissions.deny;
    expect(denyOf(a)).toBeDefined();
    expect(denyOf(b)).toBeDefined();
    expect(denyOf(a)).not.toContain(cursorReadRule(b));
    expect(denyOf(b)).not.toContain(cursorReadRule(a));
  });

  it('after killAll (app quit) no run starts', async () => {
    const r = runner();
    r.killAll();
    expect(await r.run(req('claude', 'ciao'))).toMatchObject({ ok: false, error: "l'app si sta chiudendo" });
  });
});
