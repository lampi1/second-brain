// Unit tests of main/appctl/digest.ts and the tool app_digest (appctl/tools.ts): the Regia's whole status in one call,
// zero tokens. Waiting and failed chats always listed with what they ask; `since` keeps only what changed; closed chats,
// the user's command runs, PRs with QA failures first and unread DevOps news; the caller and the other space left out.
import { describe, expect, it } from 'vitest';
import type { ChatSummary, DevopsState, PendingRequest, RunInfo } from '../../src/shared/contract';
import { ago, askLine, digest, prLines } from '../../src/main/appctl/digest';
import { appControlTools } from '../../src/main/appctl/tools';
import type { BrainService, BrowserService, ChatService } from '../../src/main/services';

const NOW = Date.parse('2026-10-13T18:00:00Z');
const MIN = 60_000;
const chat = (id: string, o: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'claude', origin: 'app', title: `Web · ${id}`, cwd: `C:\\repo\\${id}`, sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isRegia: false, lastText: '', updatedAt: NOW - 5 * MIN, browserTabIds: [], ...o,
});
const q = (chatId: string, text: string, at = NOW - 12 * MIN): PendingRequest =>
  ({ id: `q-${chatId}`, chatId, type: 'question', tool: 'AskUserQuestion', title: 'Domanda', detail: '', input: {}, at, questions: [{ question: text, options: [], multiSelect: false }] }) as PendingRequest;
const devops = (o: Partial<DevopsState> = {}): DevopsState => ({
  enabled: true, everyMin: 15, sound: false, running: false, at: NOW - 10 * MIN, nextAt: null, error: null, news: [], assigned: [], urgent: [],
  oldReviews: [], reviews: [], prs: [], details: {}, unread: 0, qa: [], qaError: null, repoDirs: {}, ...o,
}) as DevopsState;
const base = { pending: [] as PendingRequest[], runs: [] as RunInfo[], devops: null, now: NOW, since: null, warnTokens: 200_000 };

describe('app_digest', () => {
  it('one line per chat: waiting with the question, failed with its error, working, finished with its last line', () => {
    const t = digest({ ...base,
      chats: [
        chat('sms', { pending: 1, lastText: 'Ti chiedo sotto.' }),
        chat('ord', { state: 'error', lastError: 'ECONNRESET' }),
        chat('map', { state: 'running', background: 2, contextTokens: 420_000 }),
        chat('qa', { lastText: 'Report pronto: 8 test su 9.', lastResult: { at: NOW - 30 * MIN, isError: false } }),
        chat('regia', { isRegia: true, title: 'Regia' }),
      ],
      pending: [q('sms', 'Apro il bug?')], selfId: 'regia', branch: cwd => (cwd.endsWith('map') ? 'feat/map' : null),
    });
    expect(t).toMatch(/^Stato alle \d\d:\d\d: 4 chat aperte, 1 richieste per l'utente, 1 in errore, 1 al lavoro\./);
    expect(t).toContain("- «Web · sms» (Claude, sms): aspetta l'utente da 12 min: domanda «Apro il bug?»");
    expect(t).toContain('- «Web · ord» (Claude, ord): ferma su un errore: ECONNRESET');
    expect(t).toContain('- «Web · map» (Claude, map): al lavoro (aggiornata 5 min fa) · ramo feat/map · contesto lungo 420k · 2 attività in background');
    expect(t).toContain('- «Web · qa» (Claude, qa): turno finito 30 min fa · ultima riga «Report pronto: 8 test su 9.»');
    expect(t).not.toContain('Regia'); // the caller is left out
    expect(t).toContain('DevOps: non letto dall\'app');
  });

  it('since: unchanged chats in one line, waiting and failed ones always listed', () => {
    const t = digest({ ...base, since: NOW - 3 * MIN,
      chats: [chat('old', { updatedAt: NOW - 60 * MIN }), chat('new', { updatedAt: NOW - MIN, lastText: 'Fatto.' }), chat('err', { state: 'error', updatedAt: NOW - 60 * MIN, lastError: 'x' }), chat('wait', { updatedAt: NOW - 60 * MIN })],
      pending: [q('wait', 'Unisco?', NOW - 60 * MIN)],
    });
    expect(t).toContain('(novità dalle');
    expect(t).toContain('Hanno finito il turno da allora:');
    expect(t).toContain('«Web · new»');
    expect(t).toContain('Invariate: «Web · old».');
    expect(t).toContain('«Web · err» (Claude, err): ferma su un errore');
    expect(t).toContain('domanda «Unisco?»');
  });

  it('closed chats and the commands the user ran', () => {
    const t = digest({ ...base,
      chats: [chat('done', { closedAt: NOW - 20 * MIN, closedBy: 'auto', lastText: 'Merge fatto.' }), chat('ancient', { closedAt: NOW - 48 * 3600_000 })],
      runs: [{ id: 'r', chatId: 'done', itemId: 'i', code: 'npm run check\nmore', cwd: 'C:/x', state: 'ok', exitCode: 0, output: '', startedAt: NOW - 25 * MIN, endedAt: NOW - 22 * MIN }],
    });
    expect(t).toContain('- «Web · done» chiusa 20 min fa (da sola, finita) · ultima riga «Merge fatto.»');
    expect(t).not.toContain('ancient');
    expect(t).toContain('- «Web · done»: `npm run check` ok, uscita 0');
    // a secret in the command line never reaches the Regia's context
    const s = digest({ ...base, chats: [chat('done')], runs: [{ id: 'r', chatId: 'done', itemId: 'i', code: 'curl -H "Authorization: Bearer abcdefghijklmnop" https://x', cwd: 'C:/x', state: 'ok', exitCode: 0, output: '', startedAt: NOW - 5 * MIN, endedAt: NOW - 4 * MIN }] });
    expect(s).not.toContain('abcdefghijklmnop');
    expect(s).toContain('[redacted]');
  });

  it('PRs named after their bug, QA failures first; unread news; reviews waiting', () => {
    const wi = (id: number, title: string) => ({ id, type: 'Bug', title, state: 'Active', project: 'P', priority: 2, assignedTo: null, iteration: null, changedAt: null, url: `u${id}` });
    const pr = (id: number, w: ReturnType<typeof wi>, o = {}) => ({ id, title: `PR ${id}`, repo: 'Shop.Web', project: 'P', author: null, createdAt: '', url: `https://dev/pr/${id}`, target: 'main', draft: false, autoComplete: false, reviewers: [], build: null, workItems: [w], ...o });
    const d = devops({
      prs: [pr(1, wi(10, 'Totale ordini sbagliato'), { build: { result: 'succeeded', status: 'completed', number: '1', url: '', at: null }, reviewers: [{ name: 'Paolo Rossi', vote: 10, label: '', required: true }, { name: 'Sara Bianchi', vote: 0, label: '', required: true }] }),
        pr(2, wi(20, 'Rimborso con sconto'))],
      details: { 20: { tests: [{ id: 1, title: 't', outcome: 'Failed', url: '' }, { id: 2, title: 't2', outcome: 'Blocked', url: '' }] } } as unknown as DevopsState['details'],
      news: [{ key: 'n', at: new Date(NOW - MIN).toISOString(), kind: 'comment', who: 'Anna Verdi', title: 'Rimborso con sconto', detail: 'non va', url: 'https://dev/n', unread: true }],
      reviews: [{ id: 3, title: 'x', repo: 'r', project: 'p', author: null, createdAt: '', url: '' }],
    });
    const lines = prLines(d);
    expect(lines[0]).toBe('- Rimborso con sconto (Shop.Web → main): QA: 1 test falliti, 1 bloccati https://dev/pr/2');
    expect(lines[1]).toBe('- Totale ordini sbagliato (Shop.Web → main): build succeeded · Paolo approvata · aspetta Sara https://dev/pr/1');
    const t = digest({ ...base, chats: [], devops: d });
    expect(t).toContain('Novità DevOps non lette (1):');
    expect(t).toContain('- comment · Anna: Rimborso con sconto — non va https://dev/n');
    expect(t).toContain('Review che aspettano il suo voto: 1.');
  });

  it('helpers: ago, askLine for permissions and commands', () => {
    expect([ago(5 * MIN), ago(130 * MIN), ago(50 * 3600_000)]).toEqual(['5 min', '2 h', '2 g']);
    expect(askLine({ id: 'p', chatId: 'c', type: 'permission', tool: 'Bash', title: 'Bash · git push', detail: '', input: {}, at: 0 })).toBe('permesso «Bash · git push»');
    expect(askLine({ id: 'c', chatId: 'c', type: 'command', tool: 'Esegui', title: 'Comando', detail: '', input: {}, at: 0, command: { itemId: 'i', code: 'npm run promote\nx', lang: 'powershell' } })).toBe('comando da eseguire `npm run promote`');
  });

  it('the tool: since "last" remembers the previous call per caller; the other space is never shown', async () => {
    let list: ChatSummary[] = [chat('w', { updatedAt: NOW - 60 * MIN }), chat('fix', { space: 'app', lastText: 'segreto' })];
    const chats = { list: () => list, pending: () => [], items: () => [] } as unknown as ChatService;
    const brain = { settings: () => ({ contextWarnTokens: 200_000 }) } as unknown as BrainService;
    const tool = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0', devops: () => null }).find(t => t.name === 'app_digest')!;
    const first = String(await tool.run({}));
    expect(first).toContain('«Web · w»');
    expect(first).not.toContain('fix');
    list = [chat('w', { updatedAt: Date.now() - 60 * MIN })];
    const second = String(await tool.run({ since: 'last' }));
    expect(second).toContain('Invariate: «Web · w».');
    await expect(Promise.resolve().then(() => tool.run({ since: 'ieri' }))).rejects.toThrow(/since/);
  });
});
