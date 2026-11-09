// Long chats: the hand-off helpers (handoff.ts) and the ChatManager flows on both fake engines: the hand-off turn,
// the token-free fallback, "Riprendi" in a new linked chat, persistence
// of the links and of the context size, and the Cursor context estimate.
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatItem } from '../../../src/shared/contract';
import type { ChatManager } from '../../../src/main/chats/manager';
import { autoHandoff, continuePrompt, extractHandoff, handoffRequest, HandoffStore, nextTitle, safeLabel, tokensLabel } from '../../../src/main/chats/handoff';
import { tmp } from './helpers';

const managers: ChatManager[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.shutdown())); });

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
