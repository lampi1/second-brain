// AcpSession as OpenCode (`opencode acp`, ADR 0216) against the fake ACP agent in its OpenCode shape
// (test/fixtures/fake-cursor-acp.mjs, FAKE_ACP_OPENCODE=1): the model and the mode are config options, set on the session
// after every open; without modelOption the same answers give no model choice. No real engine ever runs here.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { AcpSession, permissionView, streamErrorOf, type AcpOptions } from '../../../src/main/chats/acp';
import { autoPermit } from '../../../src/main/chats/auto-permit';
import { SYS_IT } from '../../../src/shared/sys';
import { TOOL_CLASSES } from '../../../src/shared/agents';
import { FAKE_CURSOR, cursorLog, recSink, tmp, waitFor, type RecSink } from './helpers';

const open: AcpSession[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(s => s.close(500))); });

function start(extra: Partial<AcpOptions> = {}): { s: AcpSession; sink: RecSink; logFile: string } {
  const logFile = path.join(tmp('log'), 'opencode.jsonl');
  const sink = recSink();
  const s = new AcpSession({ engineId: 'kimi', label: 'Kimi', args: ['acp'], acpCommand: 'kimi', chatId: 'c_oc', cwd: tmp('cwd'), pathOverride: FAKE_CURSOR, ...extra, env: { FAKE_CURSOR_LOG: logFile, ...extra.env } }, sink);
  open.push(s);
  s.start();
  return { s, sink, logFile };
}
describe('AcpSession as OpenCode (modelOption, ADR 0216)', () => {
  const OPENCODE = { engineId: 'opencode', label: 'OpenCode', args: ['acp', '--print-logs'], acpCommand: 'opencode', loginCommand: 'opencode auth login', modelOption: true } satisfies Partial<AcpOptions>;
  const sets = (logFile: string) => cursorLog(logFile).filter(l => l.method === 'session/set_config_option').map(l => [l.params?.configId, l.params?.value]);

  it.each([
    [{ kind: 'permission', allow: true }, 'allow-once'],
    [{ kind: 'permission', allow: true, always: true }, 'allow-once'],
    [{ kind: 'permission', allow: false, always: true }, 'reject-once'],
  ] as const)('maps only the explicit user choice %j to %s', async (answer, optionId) => {
    const { s, sink, logFile } = start({ ...OPENCODE, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('perm');
    const request = await waitFor(() => sink.pendings[0], 'permission');
    expect(request.noAlways).toBe(true);
    expect(request.alwaysRules).toBeUndefined();
    expect(cursorLog(logFile).some(l => l.answer)).toBe(false);
    s.answer(request.id, answer);
    await waitFor(() => s.state === 'idle', 'answered');
    expect(cursorLog(logFile).find(l => l.answer)?.answer?.outcome).toMatchObject({ outcome: 'selected', optionId });
  });

  it.each([
    {},
    { ceiling: 'default' },
    { ceiling: 'acceptEdits' },
    { ceiling: 'plan' },
    { readOnly: true },
    { permissionMode: 'plan' },
    { toolPolicy: { allow: ['read', 'shell-read'] } },
    { toolPolicy: { allow: [...TOOL_CLASSES], mcp: ['limited'] } },
  ] satisfies Partial<AcpOptions>[])('keeps restricted or unverified sessions once-only: %j', async extra => {
    const { s, sink, logFile } = start({ ...OPENCODE, ...extra, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('perm');
    const request = await waitFor(() => sink.pendings[0], 'permission');
    expect(request.noAlways).toBe(true);
    s.answer(request.id, { kind: 'permission', allow: true, always: true });
    await waitFor(() => s.state === 'idle', 'answered');
    expect(cursorLog(logFile).find(l => l.answer)?.answer?.outcome?.optionId).toBe('allow-once');
  });

  it('does not invent an always option, or ignore a manager gate that removes it', async () => {
    const { s, sink, logFile } = start({ ...OPENCODE, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    for (const text of ['locked', 'perm']) {
      const index = sink.pendings.length;
      s.send(text);
      const request = await waitFor(() => sink.pendings[index], 'permission');
      if (text === 'locked') expect(request.noAlways).toBe(true);
      request.noAlways = true; // the same narrowing the manager applies to shell-read requests
      s.answer(request.id, { kind: 'permission', allow: true, always: true });
      await waitFor(() => s.state === 'idle', 'answered');
    }
    expect(cursorLog(logFile).filter(l => l.answer).map(l => l.answer?.outcome?.optionId)).toEqual(['allow-once', 'allow-once']);
  });

  it('the upstream-cache fixture suppresses Asked for a forbidden command covered by a prior wildcard grant', async () => {
    const { s, sink, logFile } = start({ ...OPENCODE, env: { FAKE_ACP_OPENCODE: '1', FAKE_ACP_APPROVED_PATTERN: 'git push *' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('force-push-perm');
    await waitFor(() => s.state === 'idle', 'cached simulated execution');
    expect(sink.pendings).toHaveLength(0);
    expect(cursorLog(logFile).find(l => l.method === 'fake/permission-result')?.params).toEqual({
      command: 'git push --force origin topic', alwaysPattern: 'git push *', cached: true, allowed: true,
    });
  });

  it('keeps a later force push behind the hard deny after an attempted always grant for normal push', async () => {
    const cwd = tmp('push-gate');
    const { s, sink, logFile } = start({ ...OPENCODE, cwd, toolPolicy: { allow: [...TOOL_CLASSES] }, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('push-perm');
    const request = await waitFor(() => sink.pendings[0], 'permission');
    expect(autoPermit(request, { cwd, ceiling: null, undoable: false }).kind).toBe('ask');
    // Simulate a stale client sending always even though the panel no longer offers it.
    s.answer(request.id, { kind: 'permission', allow: true, always: true });
    await waitFor(() => s.state === 'idle', 'first turn');
    s.send('force-push-perm');
    // A cached upstream grant ends the turn WITHOUT requesting permission: fail promptly in that case.
    await waitFor(() => sink.pendings.length === 2 || s.state === 'idle', 'second permission or cached execution');
    expect(sink.pendings).toHaveLength(2);
    const forbidden = sink.pendings[1]!;
    expect(autoPermit(forbidden, { cwd, ceiling: null, undoable: false }).kind).toBe('deny');
    s.answer(forbidden.id, { kind: 'permission', allow: false });
    await waitFor(() => s.state === 'idle', 'denied turn');
    expect(cursorLog(logFile).filter(l => l.method === 'fake/permission-result').map(l => l.params)).toEqual([
      { command: 'git push origin topic', alwaysPattern: 'git push *', cached: false, allowed: true },
      { command: 'git push --force origin topic', alwaysPattern: 'git push *', cached: false, allowed: false },
    ]);
    expect(cursorLog(logFile).filter(l => l.answer).map(l => l.answer?.outcome?.optionId)).toEqual(['allow-once', 'reject-once']);
  });

  it('preserves permission locations when the preceding tool update has no raw input', async () => {
    const cwd = tmp('permission-cwd');
    const { s, sink } = start({ ...OPENCODE, cwd, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('readgate=a.txt');
    const request = await waitFor(() => sink.pendings[0], 'read permission');
    expect(request.input).toMatchObject({ locations: [{ path: path.join(cwd, 'a.txt') }] });
    expect(autoPermit(request, { cwd, ceiling: null, undoable: false })).toEqual({ kind: 'allow' });
    expect(autoPermit(request, { cwd, ceiling: 'default', undoable: false })).toEqual({ kind: 'ask' });
    expect(autoPermit(request, { cwd: tmp('other-cwd'), ceiling: null, undoable: false })).toEqual({ kind: 'ask' });
    expect(sink.resolvedIds).toEqual([]);
  });

  it('never upgrades an opaque tool from its title and never selects a remembered grant', async () => {
    const { s, sink, logFile } = start({ ...OPENCODE, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('opaquegate');
    const request = await waitFor(() => sink.pendings[0], 'opaque permission');
    expect(request.tool).toBe('Tool');
    expect(request.noAlways).toBe(true);
    expect(autoPermit(request, { cwd: tmp('opaque'), ceiling: null, undoable: false }).kind).toBe('ask');
    s.answer(request.id, { kind: 'permission', allow: true, always: true });
    await waitFor(() => cursorLog(logFile).some(l => l.answer), 'answer');
    expect(cursorLog(logFile).find(l => l.answer)?.answer?.outcome?.optionId).toBe('once');
  });

  it('a Cursor MCP permission whose content is a ```json block shows its arguments, never the fences (real run 2026-10-31)', () => {
    const text = (t: string) => [{ type: 'content', content: { type: 'text', text: t } }];
    const title = 'Second-brain-agent_catalog: agent_catalog';
    expect(permissionView({ title, content: text('```json\n{}\n```') }, undefined, 'Tool').detail).toBe('');
    expect(permissionView({ title, content: text('```json\n{\n  "query": "acp cancel",\n  "limit": 5\n}\n```') }, undefined, 'Tool').detail).toBe('query: acp cancel\nlimit: 5');
    const mixed = permissionView({ title, content: text('Reads two files\n```\nmarker.txt\nnotes.md\n```') }, undefined, 'Tool').detail;
    expect(mixed).toBe('Reads two files\nmarker.txt\nnotes.md');
    expect(permissionView({ title, content: text('```json\n[1, 2]\n```') }, undefined, 'Tool').detail).toBe('[1,2]');
  });

  it('a fenced payload never hides or merges what will run: multi-line commands, inline, nested and unclosed fences', () => {
    const text = (t: string) => [{ type: 'content', content: { type: 'text', text: t } }];
    const view = (t: string) => permissionView({ title: 'Shell', content: text(t) }, undefined, 'Tool').detail;
    expect(view('```json\n{"command":"git status\\ngit push --force"}\n```')).toBe('command: git status\ngit push --force');
    expect(view('Run ```rm -rf /tmp/x```')).toBe('Run\nrm -rf /tmp/x');
    expect(view('```whoami```')).toBe('whoami');
    expect(view('````md\nPlan\n```json\n{"limit": 5}\n```\n````')).toBe('Plan\nlimit: 5');
    expect(view('```json\n{"query": "x"')).toBe('{"query": "x"');
    // an unclosed fence or a first line that is no language never hides a word of what runs
    expect(view('```reboot')).toBe('reboot');
    expect(view('Esegui:\n```shutdown\n')).toBe('Esegui:\nshutdown');
    expect(view('```whoami\nrm -rf /\n```')).toBe('whoami\nrm -rf /');
    expect(view('```bash\nrm -rf /\n```')).toBe('rm -rf /');
    expect(view('```python')).toBe('python');
  });

  it('a multi-line command keeps one line per command in the panel, never one flattened line', () => {
    const v = permissionView({ title: 'bash', rawInput: { command: 'git status\r\ngit push   --force origin main', description: 'two steps' } }, undefined, 'Execute');
    expect(v.detail.split('\n').slice(0, 2)).toEqual(['git status', 'git push --force origin main']);
    expect(v.detail).toContain('description: two steps');
  });

  it('shows an OpenCode MCP permission by its name and real arguments, still asking once', async () => {
    const { s, sink, logFile } = start({ ...OPENCODE, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('mcpgate');
    const request = await waitFor(() => sink.pendings[0], 'mcp permission');
    expect(request.tool).toBe('Tool');
    expect(request.title).toBe('Strumento github_search_issues: acp cancel');
    expect(request.detail).toBe('query: acp cancel\nrepo: lampi1/second-brain-app');
    expect(request.noAlways).toBe(true);
    expect(autoPermit(request, { cwd: tmp('mcp'), ceiling: null, undoable: false }).kind).toBe('ask');
    s.answer(request.id, { kind: 'permission', allow: true, always: true });
    await waitFor(() => cursorLog(logFile).some(l => l.answer), 'answer');
    expect(cursorLog(logFile).find(l => l.answer)?.answer?.outcome?.optionId).toBe('once');
  });

  it('shows an OpenCode outside-folder permission with its folder and asks', async () => {
    const { s, sink } = start({ ...OPENCODE, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('outsidegate');
    const request = await waitFor(() => sink.pendings[0], 'outside permission');
    expect(request.title).toBe('Accesso fuori dalla cartella: /home/u/other');
    expect(request.detail).toContain('filepath: /home/u/other/a.txt');
    expect(autoPermit(request, { cwd: tmp('outside'), ceiling: null, undoable: false }).kind).toBe('ask');
  });

  it('retains both raw input and locations and cancels when only remembered grants are offered', async () => {
    const { s, sink, logFile } = start({ ...OPENCODE, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('rawlocationsgate');
    const request = await waitFor(() => sink.pendings[0], 'read permission');
    expect(request.input).toMatchObject({ path: 'local.txt', locations: [{ path: '../outside.txt' }] });
    s.answer(request.id, { kind: 'permission', allow: true });
    await waitFor(() => cursorLog(logFile).some(l => l.answer), 'answer');
    expect(cursorLog(logFile).find(l => l.answer)?.answer?.outcome).toEqual({ outcome: 'cancelled' });
  });

  it('lists the model option\'s models and sets the chat\'s model there, no model flag, then its effort', async () => {
    const { s, sink, logFile } = start({ ...OPENCODE, model: 'openrouter/qwen/qwen3-coder', effort: 'high', env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    expect(cursorLog(logFile).find(l => l.argv)?.argv).toEqual(['acp', '--print-logs']);
    expect(sink.modelLists.at(-1)?.map(m => m.id)).toEqual(['opencode/big-pickle', 'openrouter/qwen/qwen3-coder', 'anthropic/claude-sonnet-5-5']);
    expect(sets(logFile)).toEqual([['model', 'openrouter/qwen/qwen3-coder'], ['effort', 'high']]);
    expect(sink.patch).toMatchObject({ model: 'openrouter/qwen/qwen3-coder[effort=high]', effortObserved: 'high' });
    expect([...sink.items.values()].some(i => i.kind === 'system' && i.level === 'warn')).toBe(false);
  });

  it('a model it does not offer is a visible warning; the default model keeps running', async () => {
    const { s, sink, logFile } = start({ ...OPENCODE, model: 'nope/model', env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    expect(sets(logFile)).toEqual([]);
    expect(sink.patch.model).toBe('opencode/big-pickle');
    expect([...sink.items.values()].some(i => i.kind === 'system' && i.level === 'warn')).toBe(true);
  });

  it('plan goes through the mode option (build back for the working mode); a resume sets the model again', async () => {
    const first = start({ ...OPENCODE, permissionMode: 'plan', env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => first.s.state === 'idle', 'ready');
    await waitFor(() => first.sink.patch.permissionMode === 'plan', 'plan mode');
    expect(sets(first.logFile)).toEqual([['mode', 'plan']]);
    await first.s.setPermissionMode('default');
    expect(sets(first.logFile).at(-1)).toEqual(['mode', 'build']);
    expect(cursorLog(first.logFile).some(l => l.method === 'session/set_mode')).toBe(false);
    const sessionId = first.sink.patch.sessionId!;
    const again = start({ ...OPENCODE, resume: true, sessionId, model: 'anthropic/claude-sonnet-5-5', env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => again.s.state === 'idle', 'resumed');
    expect(cursorLog(again.logFile).some(l => l.method === 'session/load')).toBe(true);
    expect(sets(again.logFile)[0]).toEqual(['model', 'anthropic/claude-sonnet-5-5']);
    expect(again.sink.patch.model).toMatch(/^anthropic\/claude-sonnet-5-5/);
  });

  it('without modelOption the same answers give no model list (Cursor never sets a model on the session)', async () => {
    const { s, sink, logFile } = start({ model: 'openrouter/qwen/qwen3-coder', env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    expect(sink.modelLists).toEqual([]);
    expect(sets(logFile).some(([id]) => id === 'model')).toBe(false);
  });

  // OpenCode has no question tool over ACP (its `question` tool is for its app/cli/desktop clients only): the app's
  // ask_user tool asks for it, with the same yes/no panel and brief gate, and the answer is the user's next message
  const prompts = (logFile: string) => cursorLog(logFile).filter(l => l.method === 'session/prompt').map(l => (l.params?.prompt as { text?: string }[] | undefined)?.map(p => p.text ?? '').join(''));

  it('ask_user: a Sì/No panel with the recommended option marked; the answer goes back as the next message', async () => {
    const { s, sink, logFile } = start({ ...OPENCODE, appAsk: true, briefReady: () => true, yesNo: true, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    expect(await s.askUser({ question: 'Parto con la correzione?', recommended: 'yes', header: 'Correzione' })).toBeNull();
    const q = await waitFor(() => sink.pendings[0], 'question');
    expect(q).toMatchObject({ type: 'question', tool: 'AskUser', questions: [{ question: 'Parto con la correzione?', header: 'Correzione', options: [{ label: 'Sì (consigliato)' }, { label: 'No' }], multiSelect: false }] });
    expect(s.state).toBe('waiting');
    expect(s.answer(q.id, { kind: 'question', answers: { 'Parto con la correzione?': 'Sì (consigliato)' } })).toBe(true);
    await waitFor(() => prompts(logFile).length === 1 && s.state === 'idle', 'answer prompted');
    expect(prompts(logFile)[0]).toContain('«Parto con la correzione?»: Sì');
    expect(sink.resolvedIds).toContain(q.id);
    // answered once: a second click finds nothing
    expect(s.answer(q.id, { kind: 'question', answers: { 'Parto con la correzione?': 'No' } })).toBe(false);
  });

  it('ask_user: "Altro…" carries the user\'s words; a stop takes the panel away without a message', async () => {
    const { s, sink, logFile } = start({ ...OPENCODE, appAsk: true, briefReady: () => true, yesNo: true, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    await s.askUser({ question: 'Uso il modello economico?', recommended: 'no' });
    const q = await waitFor(() => sink.pendings[0], 'question');
    expect(q.questions?.[0]?.options.map(o => o.label)).toEqual(['Sì', 'No (consigliato)']);
    s.answer(q.id, { kind: 'question', answers: { 'Uso il modello economico?': 'solo per i test' } });
    await waitFor(() => prompts(logFile).length === 1 && s.state === 'idle', 'answer prompted');
    expect(prompts(logFile)[0]).toContain(': solo per i test');
    await s.askUser({ question: 'Riprovo?', recommended: 'yes' });
    const q2 = await waitFor(() => sink.pendings[1], 'second question');
    await s.interrupt({ byUser: true });
    expect(sink.resolvedIds).toContain(q2.id);
    expect(s.state).toBe('idle');
    expect(prompts(logFile)).toHaveLength(1);
  });

  it('ask_user on an engine being restarted after an ignored stop is refused, never a panel whose answer goes nowhere', async () => {
    const { s, sink } = start({ ...OPENCODE, appAsk: true, briefReady: () => true, yesNo: true, cancelGraceMs: 200, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('deafcancel');
    await waitFor(() => [...sink.items.values()].some(i => i.kind === 'assistant' && i.text.includes('lavoro sordo')), 'the deaf turn');
    await s.interrupt({ byUser: true });
    await waitFor(() => sink.patches.some(p => p.restart), 'the restart');
    await expect(s.askUser({ question: 'Procedo?', recommended: 'yes' })).rejects.toThrow();
    expect(sink.pendings.filter(p => p.type === 'question')).toHaveLength(0);
  });

  it('a provider refusal only on stderr (free limit reached) ends the turn as failed with a readable error, never hangs', async () => {
    const { s, sink, logFile } = start({ ...OPENCODE, streamErrorGraceMs: 50, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('nocredit');
    await waitFor(() => sink.trace.includes('result') && s.state === 'idle', 'the failed turn', 8000);
    expect(cursorLog(logFile).some(l => l.method === 'session/cancel')).toBe(true);
    expect([...sink.items.values()].filter(i => i.kind === 'result').map(i => (i as { isError: boolean }).isError)).toEqual([true]);
    const sys = [...sink.items.values()].filter(i => i.kind === 'system');
    expect(sys.map(i => i.code)).toEqual(['outOfCredits']);
    const params = sys[0]?.params as { label: string; error: string };
    expect(SYS_IT['sys.outOfCredits'](params)).toBe('OpenCode: crediti esauriti (Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go).');
    // the next message runs as usual
    s.send('ciao');
    await waitFor(() => sink.trace.filter(t => t === 'result').length === 2, 'the next turn');
    expect(sink.last('assistant')?.text).toBe('Ciao dal motore');
  });

  it('streamErrorOf reads only the running session\'s main stream errors', () => {
    const line = (extra: string) => `timestamp=2026-11-01T10:18:29.000Z level=ERROR run=x message="stream error" providerID=opencode modelID=m session.id=ses_a ${extra}`;
    expect(streamErrorOf(line('small=false agent=build mode=primary error.error="AI_APICallError: Free usage limit reached."'), 'ses_a')).toEqual({ error: 'Free usage limit reached.', credits: true });
    expect(streamErrorOf(line('small=false agent=build error.error="AI_APICallError: Bad \\"gateway\\""'), 'ses_a')).toEqual({ error: 'Bad "gateway"', credits: false });
    expect(streamErrorOf(line('small=false error.error="insufficient_quota: You exceeded your current quota"'), 'ses_a')?.credits).toBe(true);
    expect(streamErrorOf(line('small=true agent=title error.error="AI_RetryError: x"'), 'ses_a')).toBeNull();
    expect(streamErrorOf(line('small=false error.error="x"'), 'ses_b')).toBeNull();
    expect(streamErrorOf(line('small=false error.error="x"'), null)).toBeNull();
    expect(streamErrorOf(line('small=false error.error="x"').replace('level=ERROR', 'level=WARN'), 'ses_a')).toBeNull();
  });

  it('a stream error the engine recovers from (the turn goes on) is not a failure', async () => {
    const { s, sink, logFile } = start({ ...OPENCODE, streamErrorGraceMs: 2000, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('streamhiccup');
    await waitFor(() => sink.trace.includes('result') && s.state === 'idle', 'the turn', 8000);
    expect(cursorLog(logFile).some(l => l.method === 'session/cancel')).toBe(false);
    expect([...sink.items.values()].filter(i => i.kind === 'result').map(i => (i as { isError: boolean }).isError)).toEqual([false]);
    expect([...sink.items.values()].filter(i => i.kind === 'system')).toHaveLength(0);
    expect(sink.last('assistant')?.text).toBe('Ripreso dopo il riprovo');
  });

  it('ask_user without its brief is sent back (with how to ask) at most twice, then shown; never on an engine with its own tool', async () => {
    const { s, sink } = start({ ...OPENCODE, appAsk: true, briefReady: () => false, yesNo: true, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    const ask = { question: 'Procedo?', recommended: 'yes' } as const;
    expect(await s.askUser(ask)).toMatch(/show_ui with component "brief" and target "next-ask".*call ask_user again/s);
    expect(await s.askUser(ask)).toMatch(/brief/);
    expect(sink.pendings).toHaveLength(0);
    expect(await s.askUser(ask)).toBeNull();
    expect(sink.pendings).toHaveLength(1);
    const cursorLike = start({ engineId: 'cursor', env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => cursorLike.s.state === 'idle', 'ready');
    expect(await cursorLike.s.askUser(ask)).toMatch(/own question tool/);
    expect(cursorLike.sink.pendings).toHaveLength(0);
  });
});
