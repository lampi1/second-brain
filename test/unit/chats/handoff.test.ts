// Long chats: the hand-off helpers (handoff.ts) and the ChatManager flows on both fake engines: the hand-off turn,
// the token-free fallback, "Riprendi" in a new linked chat, persistence
// of the links and of the context size, and the Cursor context estimate.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { ChatItem } from '../../../src/shared/contract';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import { autoHandoff, continuePrompt, extractHandoff, handoffRequest, HandoffStore, nextTitle, safeLabel, tokensLabel } from '../../../src/main/chats/handoff';
import { FAKE, FAKE_CURSOR, fakeLog, recEmitter, tmp, waitFor } from './helpers';

const managers: ChatManager[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.shutdown())); });

function setup(extra: Partial<ChatManagerOptions> = {}, envExtra: Record<string, string> = {}) {
  const userData = tmp('ud'), home = tmp('home'), cwd = tmp('cwd'), log = path.join(userData, 'fake.jsonl');
  const make = () => {
    const m = new ChatManager({
      emitter: recEmitter(), userData, enginePaths: { claude: FAKE, cursor: FAKE_CURSOR }, claudeHome: home,
      env: { CLAUDE_CONFIG_DIR: home, FAKE_CLAUDE_LOG: log, FAKE_CURSOR_LOG: log, CURSOR_CONFIG_DIR: tmp('cursor-user'), ...envExtra }, ...extra,
    });
    managers.push(m);
    return m;
  };
  return { userData, cwd, log, make };
}
const results = (m: ChatManager, id: string) => m.items(id).filter(i => i.kind === 'result');
const summary = (m: ChatManager, id: string) => m.list().find(c => c.id === id);

describe('handoff helpers', () => {
  it('asks for the five sections between the markers, with the now.md line only when there is a mem tool', () => {
    const r = handoffRequest({ title: 'Fix "x"', reason: 'threshold', contextTokens: 214_000, memTool: 'C:/b/ops/tools/mem.mjs' });
    expect(r).toContain('214k');
    expect(r).toContain('<<<PASSAGGIO');
    for (const h of ['## Stato', '## File e worktree', '## Decisioni prese', '## Provato e scartato', '## Prossimo passo']) expect(r).toContain(h);
    expect(r).toContain('--label "Fix x"');
    expect(handoffRequest({ title: 't', reason: 'manual' })).not.toContain('now.md');
    // a title is never shell: no $(…), backticks, quotes or redirections reach the command the chat runs
    expect(safeLabel('Fix $(curl x|sh) `id` "a" > b')).toBe('Fix (curl xsh) id a  b');
    expect(safeLabel('Pers · App: contesto (2)')).toBe('Pers · App: contesto (2)');
  });

  it('extracts the last block, refuses the echoed template, accepts a bare answer with the headings', () => {
    expect(extractHandoff('bla\n<<<PASSAGGIO\n## Stato\nok\n## Prossimo passo\nx\nPASSAGGIO>>>\nfine')).toBe('## Stato\nok\n## Prossimo passo\nx');
    expect(extractHandoff(handoffRequest({ title: 't', reason: 'manual' }))).toBeNull();
    expect(extractHandoff('## Stato\nfatto\n## Prossimo passo\nPR')).toBe('## Stato\nfatto\n## Prossimo passo\nPR');
    expect(extractHandoff('nessun formato')).toBeNull();
    expect(extractHandoff('<<<PASSAGGIO\n## Stato\nFatto il fi')).toBeNull(); // cut (stopped, max tokens): not a hand-off
    expect(extractHandoff(`<<<PASSAGGIO\n${'a'.repeat(7000)}\nPASSAGGIO>>>`)!.length).toBeLessThan(6100);
  });

  it('builds a token-free note from what the app saw', () => {
    const items: ChatItem[] = [
      { kind: 'user', id: 'u1', at: 1, text: 'Sistema il totale' },
      { kind: 'tool', id: 't1', at: 2, name: 'Edit', summary: 'a.ts', input: {}, status: 'ok', diff: [{ path: 'src/a.ts', added: 3, removed: 1, patch: '' }] },
      { kind: 'tool', id: 't2', at: 3, name: 'Bash', summary: 'npm test', input: { command: 'npm test' }, status: 'error' },
      { kind: 'user', id: 'u2', at: 4, text: '[app] <<<PASSAGGIO richiesta' },
      { kind: 'assistant', id: 'a1', at: 5, text: 'Fatto il fix.' },
    ];
    const t = autoHandoff({ title: 'Fix', cwd: 'C:/r', harness: 'claude', lastText: '' }, items);
    expect(t).toContain('Passaggio automatico');
    expect(t).toContain('> Sistema il totale');
    expect(t).toContain('- src/a.ts (+3 −1)');
    expect(t).toContain('✗ npm test');
    expect(t).toContain('Fatto il fix.');
    expect(t).not.toContain('<<<PASSAGGIO');
  });

  it('titles, labels, the continue prompt and the store round trip', () => {
    expect(nextTitle('Fix', ['Fix (2)'])).toBe('Fix (3)');
    expect(nextTitle('Fix (2)', [])).toBe('Fix (3)');
    expect(tokensLabel(1_250_000)).toBe('1,3M');
    expect(tokensLabel(214_400)).toBe('214k');
    const store = new HandoffStore(tmp('ud'));
    const h = store.write('c-1', { title: 'Fix', text: '## Stato\nok', at: 42, source: 'chat', contextTokens: 9 });
    expect(store.read('c-1')).toEqual(h);
    expect(store.read('missing')).toBeNull();
    expect(() => store.pathOf('../x')).toThrow();
    const p = continuePrompt({ title: 'Fix', harness: 'claude', cwd: 'C:/r' }, h);
    expect(p.startsWith('Riprendi un lavoro')).toBe(true);
    expect(p).toContain(h.path);
    expect(p).toContain('## Stato\nok');
    expect(p).not.toContain('worktree');
    expect(continuePrompt({ title: 'Fix', harness: 'claude', cwd: 'C:/r', inWorktree: true }, h)).toContain('git worktree list');
  });
});

describe('ChatManager long chats', () => {
  it('Claude: the chat writes its hand-off in one turn that is not a job turn', async () => {
    let jobTurns = 0;
    const { make, cwd } = setup({ onTurnEnd: () => { jobTurns++; } });
    const m = make();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'hello' });
    await waitFor(() => results(m, c.id).length === 1 && summary(m, c.id)?.state === 'idle', 'first turn');
    await waitFor(() => jobTurns === 1, 'job turn');
    const h = await m.handoff(c.id);
    await new Promise(r => setTimeout(r, 100));
    expect(jobTurns).toBe(1);
    expect(h).toMatchObject({ chatId: c.id, source: 'chat' });
    expect(h.text).toContain('## Prossimo passo\nAprire la PR.');
    expect(fs.readFileSync(h.path, 'utf8')).toContain('# Passaggio di consegne');
    expect(summary(m, c.id)).toMatchObject({ handoffAt: h.at, handoffSource: 'chat' });
    expect(summary(m, c.id)?.handoffBusy).toBeUndefined();
    expect(m.readHandoff(c.id)).toEqual(h);
    // shown as an app line, never as the user's message
    expect(m.items(c.id).filter(i => i.kind === 'user')).toHaveLength(1);
    // fresh: ensureHandoff does not ask again
    expect(await m.ensureHandoff(c.id)).toEqual(h);
  });

  it('falls back to the app note when the chat answers off format, and when it has no turn yet', async () => {
    const { make, cwd } = setup({}, { FAKE_CLAUDE_HANDOFF: 'off' });
    const m = make();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'edit' });
    await waitFor(() => results(m, c.id).length === 1 && summary(m, c.id)?.state === 'idle', 'first turn');
    const h = await m.handoff(c.id);
    expect(h.source).toBe('auto');
    expect(h.text).toContain('a.txt');
    const empty = await m.create({ harness: 'claude', cwd });
    expect((await m.handoff(empty.id)).source).toBe('auto');
  });

  it('ask false (the automatic closing): a running chat is not asked, no extra turn, the token-free note', async () => {
    const { make, cwd } = setup();
    const m = make();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'hello' });
    await waitFor(() => results(m, c.id).length === 1 && summary(m, c.id)?.state === 'idle', 'first turn');
    const h = await m.ensureHandoff(c.id, { ask: false });
    expect(h.source).toBe('auto');
    expect(results(m, c.id)).toHaveLength(1);
    expect(await m.ensureHandoff(c.id, { ask: false })).toEqual(h);
  });

  it('"Riprendi" opens a linked new chat from the hand-off, closes the old session, and survives a restart', async () => {
    const { make, cwd } = setup();
    const m = make();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'hello', title: 'Fix totale', model: 'sonnet' });
    await waitFor(() => results(m, c.id).length === 1 && summary(m, c.id)?.state === 'idle', 'first turn');
    const n = await m.continueChat(c.id, { promptPrefix: '[agente]' });
    expect(n).toMatchObject({ harness: 'claude', cwd, title: 'Fix totale (2)', model: 'sonnet', continuedFrom: { id: c.id, title: 'Fix totale' } });
    expect(summary(m, c.id)).toMatchObject({ continuedBy: { id: n.id, title: 'Fix totale (2)' } });
    await waitFor(() => m.items(n.id).some(i => i.kind === 'assistant' && i.text.startsWith('Ripreso dal passaggio')), 'new chat answered');
    const first = m.items(n.id).find(i => i.kind === 'user');
    expect(first?.kind === 'user' && first.text.startsWith('[agente]\n\nRiprendi un lavoro')).toBe(true);
    expect(first?.kind === 'user' && first.text).toContain('Aprire la PR.');
    await waitFor(() => summary(m, c.id)?.state === 'closed', 'old session closed');
    // idempotent: a second "Riprendi" returns the same chat
    expect((await m.continueChat(c.id)).id).toBe(n.id);
    await m.shutdown();
    const again = make();
    expect(again.list().find(x => x.id === c.id)).toMatchObject({ continuedBy: { id: n.id }, handoffSource: 'chat', contextTokens: 1234 });
    expect(again.list().find(x => x.id === n.id)).toMatchObject({ continuedFrom: { id: c.id } });
    expect(again.readHandoff(c.id)?.text).toContain('Aprire la PR.');
  });

  it('a Cursor hand-off cut by a network error is not retried by itself (the app writes its own note)', async () => {
    const { make, cwd, log } = setup({}, { FAKE_CURSOR_NETERR_HANDOFF: '1' });
    const m = make();
    const c = await m.create({ harness: 'cursor', cwd, prompt: 'hello' });
    await waitFor(() => results(m, c.id).length === 1 && summary(m, c.id)?.state === 'idle', 'first turn');
    const h = await m.handoff(c.id);
    expect(h.source).toBe('auto');
    await waitFor(() => summary(m, c.id)?.state === 'idle', 'idle after the cut hand-off');
    await new Promise(r => setTimeout(r, 6000)); // past the first automatic retry's 5 s
    const prompts = fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { method?: string }).filter(l => l.method === 'session/prompt');
    expect(prompts).toHaveLength(2);
    expect(summary(m, c.id)?.state).toBe('idle');
  }, 20000);

  it('refuses the Regia and a busy chat', async () => {
    const { make, cwd } = setup();
    const m = make();
    const r = await m.create({ harness: 'claude', cwd, regia: true });
    await expect(m.continueChat(r.id)).rejects.toThrow(/Orchestrator/);
    const c = await m.create({ harness: 'claude', cwd, prompt: 'slow' });
    await waitFor(() => summary(m, c.id)?.state === 'running', 'running');
    await expect(m.handoff(c.id)).rejects.toThrow(/lavorando/);
    await m.stop(c.id);
    await waitFor(() => results(m, c.id).length === 1, 'interrupted');
  });

  it('"Riprendi" waits for the turn even with a fresh note, and a double request gives one new chat', async () => {
    const { make, cwd } = setup();
    const m = make();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'hello' });
    await waitFor(() => results(m, c.id).length === 1 && summary(m, c.id)?.state === 'idle', 'first turn');
    await m.handoff(c.id);
    const before = results(m, c.id).length;
    await m.send(c.id, 'slow');
    await waitFor(() => summary(m, c.id)?.state === 'running', 'running');
    await expect(m.continueChat(c.id)).rejects.toThrow(/lavorando/);
    await m.stop(c.id);
    await waitFor(() => results(m, c.id).length === before + 1 && summary(m, c.id)?.state === 'idle', 'stopped');
    const [a, b] = await Promise.all([m.continueChat(c.id), m.continueChat(c.id)]);
    expect(a.id).toBe(b.id);
    expect(m.list().filter(x => x.continuedFrom?.id === c.id)).toHaveLength(1);
  });

  it('a chat in a separate worktree passes the worktree hint down the chain A → B → C', async () => {
    const { make, cwd } = setup();
    const m = make();
    const firstUser = (id: string) => { const u = m.items(id).find(i => i.kind === 'user'); return u?.kind === 'user' ? u.text : ''; };
    const a = await m.create({ harness: 'claude', cwd, prompt: 'hello', worktree: true });
    await waitFor(() => results(m, a.id).length === 1 && summary(m, a.id)?.state === 'idle', 'A turn');
    const b = await m.continueChat(a.id);
    expect(firstUser(b.id)).toContain('git worktree list');
    await waitFor(() => results(m, b.id).length === 1 && summary(m, b.id)?.state === 'idle', 'B turn');
    const c = await m.continueChat(b.id);
    expect(firstUser(c.id)).toContain('git worktree list');
  });

  it('Cursor: estimated context from what crossed ACP, a hand-off turn, and no start of a stopped engine when not allowed', async () => {
    const { make, cwd, log } = setup();
    const m = make();
    const c = await m.create({ harness: 'cursor', cwd, prompt: 'big' });
    const s = await waitFor(() => { const x = summary(m, c.id); return x?.state === 'idle' && (x.contextTokens ?? 0) > 200_000 ? x : undefined; }, 'estimated context', 15_000);
    expect(s.contextEstimated).toBe(true);
    const h = await m.handoff(c.id);
    expect(h).toMatchObject({ source: 'chat' });
    expect(h.text).toContain('Scrivere il test.');
    await m.shutdown();
    const again = make();
    expect(again.list().find(x => x.id === c.id)).toMatchObject({ state: 'closed', contextEstimated: true });
    const starts = fakeLog(log).filter(l => Array.isArray(l.argv) && (l.argv as string[]).at(-1) === 'acp').length;
    const auto = await again.handoff(c.id, { allowStart: false });
    expect(auto.source).toBe('auto');
    expect(fakeLog(log).filter(l => Array.isArray(l.argv) && (l.argv as string[]).at(-1) === 'acp').length).toBe(starts);
  });
});
