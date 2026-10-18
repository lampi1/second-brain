// Unit tests of the filter that keeps the app's own work out of Fatto (src/renderer/brain/lib/appwork.ts): chat titles
// of "Migliora l'app", "app:" diary lines, app commits, the matching lines of the technical report, the stand-up brief.
import { describe, expect, it } from 'vitest';
import type { Brief, DayReport, JournalRow } from '../../../src/renderer/brain/types';
import { isAppCommit, isAppRow, isAppTitle, withoutAppThreads, withoutAppWork, workJournal } from '../../../src/renderer/brain/lib/appwork';

describe('app work', () => {
  it('titles of the app chats and threads', () => {
    for (const t of ['App · Pagina Procedure', 'Pers · App: versione completa', "Regia dell'app", '**App · Stato**']) expect(isAppTitle(t)).toBe(true);
    for (const t of ['QA ordini', 'Web · Telemetria', 'Regia', 'Apple · Export', 'OS · Mappa 3D']) expect(isAppTitle(t)).toBe(false);
  });
  it('rows: chats by title, diary by "app:", the rest only when it names the app repo', () => {
    expect(isAppRow({ kind: 'chat', title: 'App · Mappa 3D fluida', area: 'Italia' })).toBe(true);
    expect(isAppRow({ kind: 'chat-cursor', title: 'Cursor · App · Grafici', area: 'Italia' })).toBe(true);
    // the chat list puts Claude chats there too: "Claude · App · X · folder · 13/10, 19:48 · finito"
    expect(isAppRow({ kind: 'chat-cursor', title: 'Claude · App · Procedure · procedure · 13/10, 19:48 · finito', area: 'Italia' })).toBe(true);
    expect(isAppRow({ kind: 'chat-cursor', title: "Claude · Regia dell'app · app · 13/10, 19:48 · attiva", area: 'Italia' })).toBe(true);
    expect(isAppRow({ kind: 'chat-cursor', title: 'Claude · QA ordini · repo · 13/10, 10:00 · finito', area: 'Italia' })).toBe(false);
    expect(isAppRow({ kind: 'chat', title: 'Pers · second-brain app', area: 'Personale e OS' })).toBe(true);
    expect(isAppRow({ kind: 'diario', title: 'second-brain app v1 stabile', area: 'Italia' })).toBe(true);
    expect(isAppRow({ kind: 'diario', title: 'app: coda CPU decisa', area: 'Italia' })).toBe(true);
    expect(isAppRow({ kind: 'diario', title: "PR unita: l'app del cliente ora stampa", area: 'Italia' })).toBe(false);
    expect(isAppRow({ kind: 'pr-unita', title: 'fix(orders): apply the discount once', area: 'Italia' })).toBe(false);
  });
  it('chats by project folder: the app repo and its worktrees go, untitled chats with no folder go too', () => {
    const chat = (title: string, cwd?: string) => ({ kind: 'chat', title, area: 'Italia', ...(cwd === undefined ? {} : { cwd }) });
    expect(isAppRow(chat('(senza titolo)', 'C:\\Users\\me\\source\\repos\\second-brain-app-wt\\velocita-claude'))).toBe(true);
    expect(isAppRow(chat('Mappa fluida', 'C:/Users/me/source/repos/second-brain-app'))).toBe(true);
    expect(isAppRow(chat('(senza titolo)'))).toBe(true);
    expect(isAppRow(chat('(senza titolo)', ''))).toBe(true);
    expect(isAppRow(chat('(senza titolo)', 'C:/repo/web'))).toBe(false);
    expect(isAppRow(chat('QA ordini', 'C:/repo/web'))).toBe(false);
    expect(isAppRow(chat('QA ordini', 'C:/repo/second-brain-app-notes'))).toBe(false);
    expect(isAppRow(chat('App · Procedure', 'C:/repo/web'))).toBe(true);
  });
  it('the report line of a dropped untitled chat goes, the same title at other hours stays', () => {
    const rep: DayReport = {
      date: '2026-10-13', day: '2026-10-13', devops: true, areas: ['Italia'],
      rows: [{ kind: 'chat', title: '(senza titolo)', area: 'Italia', from: '09:34', to: '09:40', cwd: 'C:/x/second-brain-app-wt/velocita' },
        { kind: 'chat', title: '(senza titolo)', area: 'Italia', from: '12:00', to: '12:30', cwd: 'C:/repo/web' }],
      commits: [], text: ['## Italia', '- chat Claude "(senza titolo)" 09:34-09:40, 2 messaggi', '- chat Claude "(senza titolo)" 12:00-12:30, 5 messaggi'].join('\n'),
    };
    const w = withoutAppWork(rep);
    expect(w.rows.map(r => r.from)).toEqual(['12:00']);
    expect(w.text.split('\n')).toEqual(['## Italia', '- chat Claude "(senza titolo)" 12:00-12:30, 5 messaggi']);
  });
  it('filters custom checkout paths and nested worktrees without matching sibling prefixes', () => {
    const root = 'C:/projects/try-main';
    const row = (cwd: string) => ({ kind: 'chat', title: 'Neutral title', area: 'work', cwd });
    expect(isAppRow(row(root), root)).toBe(true);
    expect(isAppRow(row('c:\\PROJECTS\\try-main\\.claude\\worktrees\\audit'), root)).toBe(true);
    expect(isAppRow(row(`${root}-other`), root)).toBe(false);
    expect(isAppRow(row('/work/Product'), '/work/product')).toBe(false);
    expect(isAppRow(row(root))).toBe(false);
    const report: DayReport = { date: '', day: '', devops: null, areas: [], commits: [],
      rows: [{ ...row(root), from: '09:00', to: '10:00' }], text: '- chat Codex "Neutral title" 09:00-10:00' };
    expect(withoutAppWork(report, root)).toMatchObject({ rows: [], text: '' });
  });
  it('commits about the app', () => {
    expect(isAppCommit("product: publish the app's page")).toBe(true);
    expect(isAppCommit('routing: resolve like the app')).toBe(true);
    expect(isAppCommit('feat(product): template pages not empty')).toBe(true);
    expect(isAppCommit('app: CLI session over stream-json')).toBe(true);
    expect(isAppCommit('feat(tools): qa-status.mjs')).toBe(false);
    expect(isAppCommit('brain: pulizia regole')).toBe(false);
  });
  it('the report: rows, commits and the matching markdown lines go, headings and work stay', () => {
    const rep: DayReport = {
      date: '2026-10-13', day: '2026-10-13', devops: true, areas: ['Italia'],
      rows: [{ kind: 'chat', title: 'App · Procedure', area: 'Italia' }, { kind: 'chat', title: 'QA ordini', area: 'Italia' }],
      commits: ['brain: pulizia', "product: the app's sync"],
      text: ['## Italia', '- chat Claude "App · Procedure" 18:05-19:35', '- chat Claude "QA ordini" 09:00-10:00', '- diario: 10:57 · decisione · app: coda CPU', '- diario: 11:00 · fatto · PR unita',
        '- chat Cursor Claude · App · Procedure · procedure · 13/10, 19:48 · finito', '- chat Cursor Cursor · QA ordini · finito',
        '| Chat | Messaggi |', '|---|---|', '| App · Procedure | 3 |', '| QA ordini | 6 |', '## cervello (commit non automatici)', '- brain: pulizia', "- product: the app's sync"].join('\n'),
    };
    const w = withoutAppWork(rep);
    expect(w.rows.map(r => r.title)).toEqual(['QA ordini']);
    expect(w.commits).toEqual(['brain: pulizia']);
    expect(w.text.split('\n')).toEqual(['## Italia', '- chat Claude "QA ordini" 09:00-10:00', '- diario: 11:00 · fatto · PR unita', '- chat Cursor Cursor · QA ordini · finito', '| Chat | Messaggi |', '|---|---|', '| QA ordini | 6 |', '## cervello (commit non automatici)', '- brain: pulizia']);
  });
  it('the diary table and the brief threads', () => {
    const j = (testo: string): JournalRow => ({ data: '2026-10-13', ora: '10:00', tag: 'fatto', area: 'lavoro', testo });
    expect(workJournal([j('app: coda CPU'), j('QA ordini: 9 passati')]).map(r => r.testo)).toEqual(['QA ordini: 9 passati']);
    const br = { threads: [{ section: 'Lavoro', label: 'App · Procedure', date: '', next: '', stale: false, done: false, area: 'Italia' }, { section: 'Lavoro', label: 'QA ordini', date: '', next: '', stale: false, done: false, area: 'Italia' }] } as unknown as Brief;
    expect(withoutAppThreads(br).threads.map(t => t.label)).toEqual(['QA ordini']);
  });
});
