// A chat the user starts with "Nuova chat" or a new Orchestrator (src/main/chats/routed.ts, chat:createRouted): the
// routing table's row picks engine, model and effort; no row = the user's last "Nuova chat" choice; the kind and area
// come from the title and first message (the brain pages send no hints since "Discuti" goes to the Orchestrator); an engine that is off is never picked, nor one the Orchestrators may not use unless the user names it for a work chat; the chat carries its route (so the ledger gets it); bad input throws.
import { describe, expect, it } from 'vitest';
import { createRoutedChat } from '../../src/main/chats/routed';
import { routeChat, type RouteRequest } from '../../src/main/brain/routing';
import { DEMO_REGISTRY } from '../../src/main/brain/routing-demo';
import type { ChatSummary, NewChat, RoutedNewChat, RoutingTable } from '../../src/shared/contract';

const table: RoutingTable = { version: 11, appliedAt: null, by: null, exploration: 0, costWeight: 7, routes: [
  { kind: 'bug-fix', harness: 'claude', model: 'claude-opus-5-5', effort: 'medium', why: 'bug: Opus', since: '2026-10-14', evidence: 'n=2' },
  { kind: 'qa-run', harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', why: 'QA: Sonnet', since: '2026-10-14', evidence: 'n=1' },
  { kind: 'orchestrator', harness: 'claude', model: 'claude-sonnet-5-5', effort: 'high', why: 'Orchestrator: Sonnet', since: '2026-10-14', evidence: 'prova' },
  { kind: 'review', area: 'Shop', harness: 'claude', model: 'claude-haiku-5-5', effort: 'low', why: 'review di quel repo', since: '2026-10-14', evidence: 'prova' },
] };
const rules = { tasks: [['review', String.raw`\breview\b`, 'i'], ['qa-run', String.raw`\b(test ?case|qa)\b`, 'i'], ['bug-fix', String.raw`\b(fix|bug)\b`, 'i']] as [string, string, string][] };

function deps(engines = { claude: true, cursor: true }, orchestrators = { claude: true, cursor: true }) {
  const made: NewChat[] = [];
  return {
    made,
    d: {
      route: (req: RouteRequest) => routeChat(req, table, DEMO_REGISTRY, rules, 7),
      engineOn: (h: string) => engines[h as keyof typeof engines] !== false,
      agentsMayOpen: (h: string) => engines[h as keyof typeof engines] !== false && orchestrators[h as keyof typeof orchestrators] !== false,
      create: async (req: NewChat) => { made.push(req); return { id: `c${made.length}`, title: req.title } as ChatSummary; },
    },
  };
}
const BUG = 'fix del rimborso sbagliato';
const base = (o: Partial<RoutedNewChat> = {}): RoutedNewChat => ({ title: 'Shop · Rimborso sbagliato', prompt: 'Lavoriamo su questo bug… (PR, test case, work item collegati)', cwd: 'C:/brain',
  defaults: { harness: 'cursor', model: 'grok-4.7' }, ...o });

describe('createRoutedChat', () => {
  it('a bug: the bug-fix row, with its route on the chat', async () => {
    const { d, made } = deps();
    await createRoutedChat(d, base({ prompt: BUG, permissionMode: 'acceptEdits', defaults: { harness: 'claude' } }));
    expect(made[0]).toMatchObject({ harness: 'claude', model: 'claude-opus-5-5', effort: 'medium', cwd: 'C:/brain', permissionMode: 'acceptEdits',
      route: { policy: 'routing', source: 'table', kind: 'bug-fix', area: 'Shop', version: 11, at: 7 } });
    expect(made[0]!.prompt).toBe(BUG);
  });

  it('the kind comes from the first message; no rule = the user’s last choice', async () => {
    const { d, made } = deps();
    // the prompt names "test case": a QA
    await createRoutedChat(d, base());
    expect(made[0]!.route).toMatchObject({ kind: 'qa-run' });
    await createRoutedChat(d, base({ prompt: 'Esporta il listino' }));
    // no row for "altro": the user's last choice (Cursor, grok), no effort, no permission mode on Cursor
    expect(made[1]).toMatchObject({ harness: 'cursor', model: 'grok-4.7', route: { source: 'default', kind: 'altro' } });
    expect(made[1]).not.toHaveProperty('effort');
  });

  it('a permission mode only when the chat stays on the Claude the user chose', async () => {
    const { d, made } = deps();
    // last "Nuova chat" on Cursor with a stale Claude permission mode: the bug-fix row moves it to Claude, without it
    await createRoutedChat(d, base({ prompt: BUG, permissionMode: 'bypassPermissions' }));
    expect(made[0]).toMatchObject({ harness: 'claude' });
    expect(made[0]).not.toHaveProperty('permissionMode');
    await createRoutedChat(d, base({ prompt: BUG, permissionMode: 'acceptEdits', defaults: { harness: 'claude' } }));
    expect(made[1]).toMatchObject({ harness: 'claude', permissionMode: 'acceptEdits' });
  });

  it('the title’s area picks an area row', async () => {
    const { d, made } = deps();
    await createRoutedChat(d, base({ title: 'Shop · Login', prompt: 'review della PR del login' }));
    expect(made[0]).toMatchObject({ model: 'claude-haiku-5-5', effort: 'low', route: { kind: 'review', area: 'Shop', source: 'table' } });
  });

  it('an unavailable row or default falls back to an allowed engine; an explicit pick is refused', async () => {
    const { d, made } = deps({ claude: false, cursor: true });
    await createRoutedChat(d, base({ prompt: BUG }));
    expect(made[0]).toMatchObject({ harness: 'cursor', route: { source: 'default' } });
    const off = deps({ claude: true, cursor: false });
    await createRoutedChat(off.d, base({ prompt: 'x' }));
    expect(off.made[0]).toMatchObject({ harness: 'claude' });
    await expect(createRoutedChat(off.d, base({ prompt: 'x', ask: { harness: 'cursor' } }))).rejects.toThrow(/spento/);
    expect(off.made).toHaveLength(1);
  });

  it('«Gli Orchestrator possono usare Cursor» off: a table row or a default on Cursor is not used, the user’s own pick is; a Orchestrator never moves there', async () => {
    const cursorRow: RoutingTable = { ...table, routes: [{ kind: 'bug-fix', harness: 'cursor', model: 'composer-2.5', effort: null, why: 'bug: Cursor', since: '2026-10-14', evidence: 'n=1' }] };
    const { d, made } = deps({ claude: true, cursor: true }, { claude: true, cursor: false });
    d.route = (req: RouteRequest) => routeChat(req, cursorRow, DEMO_REGISTRY, rules, 7);
    await createRoutedChat(d, base({ prompt: BUG }));
    expect(made.pop()).toMatchObject({ harness: 'claude', route: { source: 'default' } });
    await createRoutedChat(d, base({ prompt: BUG, defaults: { harness: 'claude' } }));
    expect(made[0]).toMatchObject({ harness: 'claude', route: { source: 'default' } });
    await createRoutedChat(d, base({ prompt: BUG, defaults: { harness: 'claude' }, ask: { harness: 'cursor', reason: 'scelta mia' } }));
    expect(made[1]).toMatchObject({ harness: 'cursor' }); // the user named it: the row that agrees is used
    await expect(createRoutedChat(d, { title: 'Orchestrator · lavoro', cwd: 'C:/brain', orchestrator: true, defaults: { harness: 'claude' }, ask: { harness: 'cursor', reason: 'Cambia motore' } }))
      .rejects.toThrow(/Gli Orchestrator possono usare Cursor/);
    expect(made).toHaveLength(2);
  });

  it('a Orchestrator: kind orchestrator whatever its text, no first message needed, its role passed on; the engine the user picked beats the row', async () => {
    const { d, made } = deps();
    await createRoutedChat(d, { title: 'Orchestrator · lavoro', cwd: 'C:/brain', orchestrator: true, replaces: 'old1', defaults: { harness: 'claude' }, ask: { harness: 'claude', reason: 'Ricomincia' } });
    expect(made[0]).toMatchObject({ harness: 'claude', model: 'claude-sonnet-5-5', effort: 'high', orchestrator: true, replaces: 'old1', route: { kind: 'orchestrator', source: 'table' } });
    expect(made[0]).not.toHaveProperty('prompt');
    // Cambia motore to Cursor: an override with its reason, the engine's default model, no effort
    await createRoutedChat(d, { title: 'Orchestrator · lavoro', cwd: 'C:/brain', orchestrator: true, prompt: 'fix del bug: handoff', defaults: { harness: 'cursor' }, ask: { harness: 'cursor', reason: 'Cambia motore' } });
    expect(made[1]).toMatchObject({ harness: 'cursor', orchestrator: true, route: { kind: 'orchestrator', source: 'override', reason: 'Cambia motore' } });
    expect(made[1]).not.toHaveProperty('effort');
    // a long title (renamed by the user) is the Orchestrator's address: kept whole
    const long = `Orchestrator · ${'x'.repeat(120)}`;
    await createRoutedChat(d, { title: long, cwd: 'C:/brain', orchestrator: true, defaults: { harness: 'claude' } });
    expect(made[2]!.title).toBe(long);
    // a work chat still needs its first message
    await expect(createRoutedChat(d, { title: 'Shop · x', cwd: 'C:/brain', defaults: { harness: 'claude' } })).rejects.toThrow(/primo messaggio/);
  });

  it('bad input throws before anything starts', async () => {
    const { d, made } = deps();
    await expect(createRoutedChat(d, base({ prompt: 'x'.repeat(8001) }))).rejects.toThrow(/8000/);
    await expect(createRoutedChat(d, base({ cwd: '' }))).rejects.toThrow(/cartella/);
    // a kind sent by an old caller is ignored (the rules decide on the first message), never passed on
    await createRoutedChat(d, { ...base({ prompt: 'qa del rimborso' }), kind: 'bug-fix' } as RoutedNewChat);
    expect(made[0]!.route).toMatchObject({ kind: 'qa-run' });
  });
});

describe('"Nuova chat" through the table (2026-10-14)', () => {
  it('no title: the kind comes from the prompt and the manager names the chat', async () => {
    const { d, made } = deps();
    await createRoutedChat(d, base({ title: ' ', prompt: 'fix del rimborso', defaults: { harness: 'claude' } }));
    expect(made[0]).toMatchObject({ harness: 'claude', model: 'claude-opus-5-5', route: { source: 'table', kind: 'bug-fix' } });
    expect(made[0]).not.toHaveProperty('title');
  });

  it('a model or effort the user picks beats the row, as an override with its reason', async () => {
    const { d, made } = deps();
    await createRoutedChat(d, base({ prompt: BUG, defaults: { harness: 'claude' }, ask: { effort: 'high', reason: 'scelta dell’utente (Nuova chat)' } }));
    expect(made[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'high', route: { source: 'override', reason: 'scelta dell’utente (Nuova chat)' } });
    await createRoutedChat(d, base({ prompt: BUG, defaults: { harness: 'claude' }, ask: { model: 'claude-haiku-5-5' } }));
    expect(made[1]).toMatchObject({ model: 'claude-haiku-5-5', route: { source: 'override' } });
    // an effort that is not one is dropped, never passed on
    await createRoutedChat(d, base({ prompt: BUG, defaults: { harness: 'claude' }, ask: { effort: 'turbo' as never } }));
    expect(made[2]).toMatchObject({ effort: 'medium', route: { source: 'table' } });
  });

  it('a separate worktree only on an engine that has one', async () => {
    const { d, made } = deps();
    await createRoutedChat(d, base({ prompt: BUG, worktree: true, defaults: { harness: 'claude' } }));
    expect(made[0]).toMatchObject({ harness: 'claude', worktree: true });
    await createRoutedChat(d, base({ prompt: 'Task', worktree: true }));
    expect(made[1]).toMatchObject({ harness: 'cursor' });
    expect(made[1]).not.toHaveProperty('worktree');
  });

  it('started by the user: no cap on the first message, no dice roll, the picked permission mode kept on the routed engine', async () => {
    const { d, made } = deps();
    const asked: RouteRequest[] = [];
    const spy = { ...d, route: (r: RouteRequest) => { asked.push(r); return d.route(r); } };
    const long = 'fix '.repeat(3000);
    await expect(createRoutedChat(spy, base({ prompt: long }))).rejects.toThrow(/troppo lungo/);
    // the defaults say Cursor, the table says Claude: the plan mode picked on the Claude the dialog showed stays
    await createRoutedChat(spy, base({ prompt: long, defaults: { harness: 'cursor' }, permissionMode: 'plan' }), { byUser: true });
    expect(made[0]).toMatchObject({ harness: 'claude', permissionMode: 'plan' });
    expect(asked.at(-1)).toHaveProperty('counts', undefined);
  });
});
