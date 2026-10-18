// The "Stato" view's pure logic: one answer to "a che punto siamo / come siamo messi" built from what the app already
// holds, with zero tokens and no network: per open chat its state, name, last line, the questions/permissions/commands
// waiting for the user (the same data as app_chats/app_pending), its folder's git branch; plus the user's open PRs from
// the last DevOps read (who each one waits for, build, votes, QA-blocked = a linked work item with a failed or blocked
// test case). Names, not ids: a PR is named after the bug it fixes. Why: the owner, 2026-10-13, asked "a che punto
// siamo" ~8 times a day, ~80 s and millions of cache-read tokens each. Used by components/StatoDialog.tsx; unit-tested
// in test/unit/stato.test.ts.
import type { ChatSummary, DevopsPr, DevopsState, Harness, PendingRequest } from '@shared/contract';
import { chatName } from '@shared/regia';
import { BUILD_WORDS, firstName, prWait, type Wait } from '../brain/lib/devops';
import { bugName, clean } from '../brain/lib/text';
import type { Tone } from '../brain/components/ui';
import { stateInfo } from './format';

export interface StatoAsk { key: string; kind: PendingRequest['type']; text: string; req: PendingRequest }
export interface StatoChat {
  id: string; name: string; harness: Harness; regia: boolean; app: boolean;
  state: { label: string; tone: string };
  lastLine: string; asks: StatoAsk[]; folder: string; branch: string | null; updatedAt: number;
}
export interface StatoReviewer { name: string; vote: string; tone: Tone; required: boolean }
export interface StatoPr {
  id: number; name: string; url: string; repo: string; wait: Wait;
  build: { label: string; tone: Tone; url: string } | null;
  reviewers: StatoReviewer[];
  /** a linked work item has failed/blocked test cases: what QA found, by name */
  qa: string | null;
}
export interface Stato {
  chats: StatoChat[];
  prs: StatoPr[];
  devops: { at: number | null; error: string | null; read: boolean };
  counts: { asks: number; waiting: number; running: number; errors: number; prs: number; prsMine: number; qa: number };
}

export interface StatoInput {
  chats: Readonly<Record<string, ChatSummary>>;
  order: readonly string[];
  pending: readonly PendingRequest[];
  /** chats being closed (the undo toast is running): not shown */
  hidden?: readonly string[];
  branches: Readonly<Record<string, string | null>>;
  devops: DevopsState | null;
}

const folderOf = (cwd: string): string => cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? cwd;
const oneLine = (s: string, n = 160): string => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** What a waiting request asks, in one line: the question itself, else its title. */
export function askText(r: PendingRequest): string {
  const q = r.type === 'question' ? r.questions?.[0]?.question : null;
  return oneLine(q || r.title || r.tool);
}

// waiting first (the user unblocks them), then failed, working, starting, finished; the Regie last among equals
const RANK: Record<string, number> = { wait: 0, err: 1, run: 2, off: 3, done: 4, regia: 5 };

/** The open chats (not closed, not being closed), the ones that wait for the user first, then newest. */
export function statoChats(inp: StatoInput): StatoChat[] {
  const hidden = new Set(inp.hidden ?? []);
  const rows: StatoChat[] = [];
  for (const id of inp.order) {
    const c = inp.chats[id];
    if (!c || c.closedAt || c.state === 'closed' || hidden.has(id)) continue;
    const asks = inp.pending.filter(p => p.chatId === id).map(r => ({ key: `${r.chatId}/${r.id}`, kind: r.type, text: askText(r), req: r }));
    // a command left to run does not block the chat (ChatSummary.pending skips it) but still waits for the user
    const st = stateInfo({ ...c, pending: c.pending + asks.length });
    rows.push({
      id, name: c.appRegia ? 'Orchestrator' : chatName(c), harness: c.harness, regia: c.isRegia || c.appRegia === true, app: c.route?.area === 'App',
      state: st, lastLine: oneLine(c.lastError && c.state === 'error' ? c.lastError : c.lastText ?? ''), asks,
      folder: folderOf(c.cwd), branch: inp.branches[c.cwd] ?? null, updatedAt: c.updatedAt,
    });
  }
  return rows.sort((a, b) => (RANK[a.state.tone] ?? 9) - (RANK[b.state.tone] ?? 9) || Number(a.regia) - Number(b.regia) || b.updatedAt - a.updatedAt);
}

/** A PR is named after the bug (or work item) it fixes, what QA and colleagues know; else its own cleaned title. */
export function prName(p: Pick<DevopsPr, 'title' | 'workItems'>): string {
  const w = p.workItems.find(i => /bug/i.test(i.type)) ?? p.workItems[0];
  return (w && bugName(w.title)) || clean(p.title) || p.title;
}

const VOTE: Record<string, { vote: string; tone: Tone }> = {
  '10': { vote: 'approvata', tone: 'good' }, '5': { vote: 'approvata con suggerimenti', tone: 'good' }, '0': { vote: 'non ha votato', tone: 'outline' },
  '-5': { vote: 'chiede modifiche', tone: 'warn' }, '-10': { vote: 'rifiutata', tone: 'bad' },
};

/** "Rimborso con sconto: 1 test fallito" for the work items of the PR whose test cases failed or are blocked; the
 *  work item the PR is already named after (`named`) is not named twice. */
export function qaBlock(p: Pick<DevopsPr, 'workItems'>, details: DevopsState['details'], named = ''): string | null {
  const parts: string[] = [];
  for (const w of p.workItems) {
    const tests = details[String(w.id)]?.tests ?? [];
    const failed = tests.filter(t => t.outcome === 'Failed').length;
    const blocked = tests.filter(t => t.outcome === 'Blocked').length;
    if (!failed && !blocked) continue;
    const what = [failed && `${failed} ${failed === 1 ? 'test fallito' : 'test falliti'}`, blocked && `${blocked} ${blocked === 1 ? 'test bloccato' : 'test bloccati'}`].filter(Boolean).join(', ');
    const name = bugName(w.title) || w.title;
    parts.push(name === named ? what : `${name}: ${what}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

export function statoPr(p: DevopsPr, details: DevopsState['details']): StatoPr {
  const b = p.build;
  const word = b ? BUILD_WORDS[b.result ?? b.status] ?? b.result ?? b.status : '';
  const tone: Tone = b?.result === 'failed' ? 'bad' : b?.result === 'succeeded' ? 'good' : b?.result ? 'warn' : 'blue';
  const name = prName(p);
  return {
    id: p.id, name, url: p.url, repo: p.repo, wait: prWait(p),
    build: b ? { label: `build ${word}`, tone, url: b.url } : null,
    reviewers: p.reviewers.map(r => ({ name: firstName(r.name), required: r.required, ...(VOTE[String(r.vote)] ?? { vote: r.label || String(r.vote), tone: 'outline' as Tone }) })),
    qa: qaBlock(p, details, name),
  };
}

/** QA-blocked first (they come before any new work), then the ones that wait for the user, then the rest. */
export function statoPrs(d: DevopsState | null): StatoPr[] {
  if (!d) return [];
  const rank = (p: StatoPr) => (p.qa ? 0 : p.wait.who === 'me' ? 1 : 2);
  return d.prs.map(p => statoPr(p, d.details)).sort((a, b) => rank(a) - rank(b));
}

export function buildStato(inp: StatoInput): Stato {
  const chats = statoChats(inp);
  const prs = statoPrs(inp.devops);
  const d = inp.devops;
  return {
    chats, prs,
    devops: { at: d?.at ?? null, error: d?.error?.message ?? null, read: !!d?.at },
    counts: {
      asks: chats.reduce((n, c) => n + c.asks.length, 0),
      waiting: chats.filter(c => c.state.tone === 'wait').length,
      running: chats.filter(c => c.state.tone === 'run').length,
      errors: chats.filter(c => c.state.tone === 'err').length,
      prs: prs.length, prsMine: prs.filter(p => p.wait.who === 'me').length, qa: prs.filter(p => p.qa).length,
    },
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The one-sentence answer at the top: "2 chat ti aspettano, 3 al lavoro · 4 PR: 1 bloccata dalla QA". */
export function headline(s: Stato): string {
  const c = s.counts;
  const chats = [
    c.waiting && plural(c.waiting, 'chat ti aspetta', 'chat ti aspettano'),
    c.errors && plural(c.errors, 'in errore', 'in errore'),
    c.running && `${c.running} al lavoro`,
  ].filter(Boolean).join(', ') || (s.chats.length ? 'nessuna chat ti aspetta' : 'nessuna chat aperta');
  if (!s.devops.read) return chats;
  const prs = !c.prs ? 'nessuna PR aperta'
    : `${plural(c.prs, 'PR aperta', 'PR aperte')}${c.qa ? `: ${plural(c.qa, 'bloccata dalla QA', 'bloccate dalla QA')}` : c.prsMine ? `: ${plural(c.prsMine, 'aspetta te', 'aspettano te')}` : ''}`;
  return `${chats} · ${prs}`;
}
