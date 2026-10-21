// The Task page's pure logic (Azure DevOps today): reads the JSON of the brain's devops-me.mjs (news, assigned work items, PRs), keeps the
// news of the last 14 days by key (the script's window always overlaps the previous read), tells what is unread, turns
// the new unread news into feed events (one summary line when there are many, so a first read never floods the feed),
// and maps a failed run to a clear Italian error (az login expired → the command to run); also checks the "Test e QA"
// reports of qa-status.mjs --mine --json (my PRs' test plans: outcomes, testers, QA bugs). No I/O: service.ts runs the
// scripts and stores the state. Also which new news interrupt the user (alertsFor: a mention, a change on his items or
// PRs, a state/assignee change on a ticket he follows; never twice, by key; ADR 0029). Why: the user, 2026-10-11, "vorrei un aggiornamento automatico da DevOps per vedere
// tutte le cose aperte, aggiornamenti ai ticket che seguo ... non troppo token consuming". Unit-tested (tasks.test.ts).
import type { DevopsComment, DevopsDetail, DevopsItem, DevopsNews, DevopsNewsKind, DevopsPr, DevopsPrRef, TasksState, DevopsTest, QaBug, QaPlan, QaPoint, QaReport, QaTotals } from '../../shared/contract';
import type { FeedInput } from '../services';
import type { RunResult } from '../brain/node';

export const KEEP_DAYS = 14;
const DAY = 864e5;
const KINDS: readonly DevopsNewsKind[] = ['mention', 'touched', 'taken', 'review', 'comment', 'vote', 'build', 'followed'];

export type StoredNews = Omit<DevopsNews, 'unread'>;
export interface NewsRun { news: StoredNews[]; assigned: DevopsItem[]; urgent: DevopsItem[]; oldReviews: DevopsPrRef[]; details: Record<string, DevopsDetail> }

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const httpUrl = (v: unknown): string | null => { const s = str(v); return s && /^https:\/\//.test(s) ? s : null; };

export function itemOf(v: unknown): DevopsItem | null {
  const o = obj(v);
  const id = num(o.id); const url = httpUrl(o.url); const title = str(o.title);
  if (id === null || !url || title === null) return null;
  return { id, type: str(o.type) ?? '', title, state: str(o.state) ?? '', project: str(o.project) ?? '', priority: num(o.priority),
    assignedTo: str(o.assignedTo), iteration: str(o.iteration), changedAt: str(o.changedAt), url };
}

export function prRefOf(v: unknown): DevopsPrRef | null {
  const o = obj(v);
  const id = num(o.id); const url = httpUrl(o.url); const title = str(o.title);
  if (id === null || !url || title === null) return null;
  return { id, title, repo: str(o.repo) ?? '', project: str(o.project) ?? '', author: str(o.author), createdAt: str(o.createdAt) ?? '', url };
}

const some = <T>(xs: unknown[], f: (v: unknown) => T | null): T[] => xs.map(f).filter((x): x is T => x !== null);

export function newsOf(v: unknown): StoredNews | null {
  const o = obj(v);
  const key = str(o.key); const at = str(o.at); const url = httpUrl(o.url); const kind = str(o.kind) as DevopsNewsKind | null;
  if (!key || !at || Number.isNaN(Date.parse(at)) || !url || !kind || !KINDS.includes(kind)) return null;
  const item = o.item ? itemOf(o.item) : null;
  const pr = o.pr ? prRefOf(o.pr) : null;
  const detail = str(o.detail);
  const body = str(o.body)?.slice(0, TEXT_MAX);
  return { key, at, kind, who: str(o.who), title: str(o.title) ?? item?.title ?? pr?.title ?? '', url,
    ...(detail ? { detail } : {}), ...(body ? { body } : {}), ...(item ? { item } : {}), ...(pr ? { pr } : {}) };
}

const TEXT_MAX = 4000;
const date = (v: unknown): string | null => { const s = str(v); return s && !Number.isNaN(Date.parse(s)) ? s : null; };

export function commentOf(v: unknown): DevopsComment | null {
  const o = obj(v);
  const at = date(o.at); const text = str(o.text);
  if (!at || text === null) return null;
  return { who: str(o.who) ?? '', mine: o.mine === true, at, text: text.slice(0, TEXT_MAX) };
}

function testOf(v: unknown): DevopsTest | null {
  const o = obj(v);
  const id = num(o.id); const url = httpUrl(o.url); const title = str(o.title);
  return id === null || !url || title === null ? null : { id, title, outcome: str(o.outcome), url };
}

/** One work item's --full details (description, last comments, test cases); null when unusable. */
export function detailOf(v: unknown): DevopsDetail | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = obj(v);
  return { description: str(o.description)?.slice(0, TEXT_MAX) || null, stateSince: date(o.stateSince), createdAt: date(o.createdAt),
    comments: some(arr(o.comments), commentOf).slice(0, 5), tests: some(arr(o.tests), testOf).slice(0, 30) };
}

/** The `details` object of a --full output (or of tasks.json): work item id → details; anything else dropped. */
export function detailsOf(v: unknown): Record<string, DevopsDetail> {
  const out: Record<string, DevopsDetail> = {};
  for (const [k, d] of Object.entries(obj(v))) { const x = /^\d+$/.test(k) ? detailOf(d) : null; if (x) out[k] = x; }
  return out;
}

/** `devops-me.mjs --json` → its parts; throws on output that is not that JSON. */
export function parseNewsRun(stdout: string): NewsRun {
  const o = obj(JSON.parse(stdout));
  if (!Array.isArray(o.news) || !Array.isArray(o.assigned)) throw new Error('risposta di devops-me.mjs non riconosciuta (manca news/assigned)');
  return { news: some(o.news, newsOf), assigned: some(o.assigned, itemOf), urgent: some(arr(o.urgent), itemOf), oldReviews: some(arr(o.oldReviews), prRefOf), details: detailsOf(o.details) };
}

/** `devops-me.mjs --prs --json [--full]` → my active PRs and the details of their work items. */
export function parsePrsRun(stdout: string): { prs: DevopsPr[]; details: Record<string, DevopsDetail> } {
  const o = obj(JSON.parse(stdout));
  if (!Array.isArray(o.prs)) throw new Error('risposta di devops-me.mjs --prs non riconosciuta (manca prs)');
  return { prs: some(o.prs, prOf), details: detailsOf(o.details) };
}

/** One PR of `--prs --json` (with reviewers, build, work items); null when unusable. */
export function prOf(v: unknown): DevopsPr | null {
  {
    const ref = prRefOf(v);
    if (!ref) return null;
    const p = obj(v);
    const b = p.build ? obj(p.build) : null;
    const bUrl = b ? httpUrl(b.url) : null;
    const lc = p.lastComment ? commentOf(p.lastComment) : null;
    const lcUrl = p.lastComment ? httpUrl(obj(p.lastComment).url) : null;
    return {
      ...ref, target: str(p.target) ?? '', draft: p.draft === true, autoComplete: p.autoComplete === true,
      reviewers: arr(p.reviewers).map(obj).filter(r => str(r.name)).map(r => ({ name: str(r.name)!, vote: num(r.vote) ?? 0, label: str(r.label) ?? '', required: r.required === true })),
      build: b && bUrl ? { result: str(b.result), status: str(b.status) ?? '', number: str(b.number) ?? '', url: bUrl, at: str(b.at) } : null,
      workItems: some(arr(p.workItems), itemOf),
      ...(num(p.activeThreads) !== null ? { activeThreads: num(p.activeThreads)! } : {}),
      ...(lc && lcUrl ? { lastComment: { ...lc, url: lcUrl } } : {}),
    };
  }
}

/** How many days to ask the script for: since the last good read (at least 1, at most 14; 3 the first time). */
export function windowDays(lastOk: number | null, now: number): number {
  if (lastOk === null) return 3;
  return Math.min(KEEP_DAYS, Math.max(1, Math.ceil((now - lastOk) / DAY)));
}

/** Known news + a fresh read → all of them (by key, newest first, last 14 days) and the ones never seen before. */
export function mergeNews(prev: readonly StoredNews[], fresh: readonly StoredNews[], now: number): { all: StoredNews[]; added: StoredNews[] } {
  const known = new Set(prev.map(n => n.key));
  const byKey = new Map(prev.map(n => [n.key, n]));
  const added: StoredNews[] = [];
  for (const n of fresh) {
    if (!known.has(n.key) && !added.some(a => a.key === n.key)) added.push(n);
    byKey.set(n.key, n);
  }
  // the 14 days apply to what the script no longer reports: a fresh vote on an old PR carries the PR's date
  const freshKeys = new Set(fresh.map(n => n.key));
  const all = [...byKey.values()].filter(n => freshKeys.has(n.key) || Date.parse(n.at) >= now - KEEP_DAYS * DAY).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 300);
  const kept = new Set(all.map(n => n.key));
  return { all, added: added.filter(n => kept.has(n.key)) };
}

const VERB: Record<DevopsNewsKind, string> = {
  mention: 'ti menziona', touched: 'ha cambiato un tuo work item', taken: 'ti ha tolto un work item', review: 'ti chiede una review',
  comment: 'commenta la tua PR', vote: 'ha votato la tua PR', build: 'build fallita sulla tua PR', followed: 'aggiorna un ticket che segui',
};

/** One Italian line for a news item: "Paolo ti menziona" / "Build fallita sulla tua PR". */
export function newsLine(n: Pick<StoredNews, 'kind' | 'who'>): string {
  const v = VERB[n.kind];
  return n.who ? `${n.who} ${v}` : v.charAt(0).toUpperCase() + v.slice(1);
}

/** Feed events for the new unread news: one each up to `max` (3), else one summary (the page has the list). */
export function feedFor(added: readonly StoredNews[], read: ReadonlySet<string>, max = 3): FeedInput[] {
  const fresh = added.filter(n => !read.has(n.key));
  if (fresh.length === 0) return [];
  if (fresh.length > max) {
    const kinds = [...new Set(fresh.map(n => newsLine({ kind: n.kind, who: null }).toLowerCase()))].slice(0, 3).join(', ');
    return [{ kind: 'task', title: `${fresh.length} novità su DevOps`, detail: `${kinds}… Apri la pagina Task` }];
  }
  return fresh.map(n => ({ kind: 'task', title: `${newsLine(n)}: ${n.title}`.slice(0, 200), detail: `${n.detail ? `${n.detail} · ` : ''}${n.url}`.slice(0, 300) }));
}

// ---- alerts (ADR 0029): what interrupts the user, with a toast and a short sound, vs what stays in the page's list

/** Kinds that are about the user's own things: a mention, his work items, his PRs (comment, vote, failed build). A
 *  review asked on someone else's PR and a comment-only change on a followed ticket stay pull-only (ADR 0022). */
const ALERT_KINDS: ReadonlySet<DevopsNewsKind> = new Set(['mention', 'touched', 'taken', 'comment', 'vote', 'build']);

/** Does this news interrupt the user? A followed ticket only when its state or assignee changed (the script's detail
 *  says "stato A → B" / "assegnato a X" before any comment). */
export function isAlert(n: Pick<StoredNews, 'kind' | 'detail'>): boolean {
  if (ALERT_KINDS.has(n.kind)) return true;
  // the script writes state, assignee, then the comment: a comment quoting "stato" never counts
  return n.kind === 'followed' && /(^|· )(stato |assegnato a )/.test((n.detail ?? '').replace(/(^|· )commento: ".*$/s, ''));
}

export const MAX_NOTIFIED = 3000;

/** The news of a read that interrupt the user: alert kinds never notified before (the key is the item id plus the change:
 *  a revision, a comment id, a vote value, a build id, so the same change never notifies twice). The first read ever is
 *  the baseline: nothing interrupts, every key is remembered. Returns the alerts and the keys to remember. */
export function alertsFor(fresh: readonly StoredNews[], notified: readonly string[], baseline: boolean): { alerts: StoredNews[]; notified: string[] } {
  const known = new Set(notified);
  const alerts = baseline ? [] : fresh.filter((n, i) => isAlert(n) && !known.has(n.key) && fresh.findIndex(x => x.key === n.key) === i);
  for (const n of fresh) { known.delete(n.key); known.add(n.key); } // re-seen keys move to the end: the trim drops the oldest
  return { alerts, notified: [...known].slice(-MAX_NOTIFIED) };
}

/** Feed events for the alerts (kind task-alert: a toast with a sound, renderer lib/notify.ts): one each up to `max`,
 *  else one summary. Titles, never bare ids; the link in the detail. */
export function alertEvents(alerts: readonly StoredNews[], max = 3): FeedInput[] {
  if (!alerts.length) return [];
  if (alerts.length > max) {
    const kinds = [...new Set(alerts.map(n => newsLine({ kind: n.kind, who: null }).toLowerCase()))].slice(0, 3).join(', ');
    return [{ kind: 'task-alert', title: `${alerts.length} novità per te su DevOps`, detail: `${kinds}… Apri la pagina Task` }];
  }
  return alerts.map(n => ({ kind: 'task-alert', title: `${newsLine(n)}: ${n.title}`.slice(0, 200), detail: `${n.detail ? `${n.detail} · ` : ''}${n.url}`.slice(0, 300) }));
}

/** A failed run → what the page shows. Exit 2 (or Azure's own wording) = sign in again with `az login`. */
/** A script's stderr without Node's own warnings (`(node:123) [DEP0190] DeprecationWarning: …` and the `(Use \`node
 *  --trace-deprecation …\`)` hint after it): they come first and hid the real error in the log and on the page (#149). */
export function scriptStderr(stderr: string): string {
  return stderr.split('\n').filter(l => !/^\s*\(node:\d+\) (\[[A-Z0-9]+\] )?\w*Warning\b/.test(l) && !/^\s*\(Use `\S+ --trace-[\w-]+ /.test(l)).join('\n').trim();
}

/** What a failed run logs as its cause: the end of its stderr (the error, after any stack noise), at most 300 characters. */
export function causeOf(r: RunResult): string {
  return (scriptStderr(r.stderr) || r.error || `code ${r.code}`).slice(-300);
}

export function errorOf(r: RunResult, what: string): NonNullable<TasksState['error']> {
  const stderr = scriptStderr(r.stderr);
  const text = `${stderr}\n${r.error ?? ''}`;
  // az missing first: the script exits 2 on any token failure, also when az itself is not installed
  if (/'az' is not recognized|az: command not found|ENOENT.*\baz\b/i.test(text)) {
    return { kind: 'failed', message: 'Azure CLI (az) non trovato: installalo o mettilo nel PATH, poi «Aggiorna ora».' };
  }
  if (r.code === 2 || /az login|AADSTS|get-access-token|expired|TokenExpired|refresh token/i.test(text)) {
    return { kind: 'login', message: 'Accesso ad Azure DevOps scaduto o mancante: lancia il comando qui sotto in un terminale, poi «Aggiorna ora».', command: 'az login' };
  }
  const first = (stderr.split('\n').map(l => l.trim()).find(Boolean) ?? r.error ?? `uscito con codice ${r.code ?? '?'}`).slice(0, 240);
  return { kind: 'failed', message: `${what} non riuscita: ${first}` };
}

// ---- "Test e QA": the JSON of the brain's qa-status.mjs --mine --json (my active PRs' test plans), checked row by row

const COUNTS = ['total', 'done', 'missing', 'passed', 'failed', 'blocked', 'notApplicable', 'other'] as const;
const count = (v: unknown): number => Math.max(0, Math.floor(num(v) ?? 0));

function qaTotalsOf(v: unknown): QaTotals {
  const o = obj(v);
  const t = Object.fromEntries(COUNTS.map(k => [k, count(o[k])])) as Omit<QaTotals, 'byPerson'>;
  const byPerson = arr(o.byPerson).map(obj).filter(p => str(p.name)).slice(0, 20)
    .map(p => ({ name: str(p.name)!, done: count(p.done), passed: count(p.passed), failed: count(p.failed), blocked: count(p.blocked) }));
  return { ...t, byPerson };
}

function qaPointOf(v: unknown): QaPoint | null {
  const o = obj(v); const tc = obj(o.testCase);
  const id = num(o.id); const tcId = num(tc.id); const url = httpUrl(tc.url); const title = str(tc.title);
  if (id === null || tcId === null || !url || title === null) return null;
  const suite = obj(o.suite);
  return { id, suite: str(suite.name) ?? str(o.suite) ?? '', testCase: { id: tcId, title, url }, outcome: str(o.outcome), ranBy: str(o.ranBy),
    ranAt: date(o.ranAt), tester: str(o.tester), bugs: arr(o.bugs).map(num).filter((x): x is number => x !== null) };
}

function qaBugOf(v: unknown): QaBug | null {
  const o = obj(v);
  const id = num(o.id); const url = httpUrl(o.url); const title = str(o.title);
  if (id === null || !url || title === null) return null;
  return { id, title, state: str(o.state) ?? '', open: o.open !== false, assignedTo: str(o.assignedTo), createdAt: date(o.createdAt), url,
    testCases: arr(o.testCases).map(num).filter((x): x is number => x !== null) };
}

function qaPlanOf(v: unknown): QaPlan | null {
  const o = obj(v);
  const id = num(o.id); const url = httpUrl(o.url);
  if (id === null || !url) return null;
  return { id, name: str(o.name) ?? '', url, points: some(arr(o.points), qaPointOf).slice(0, 300), totals: qaTotalsOf(o.totals) };
}

/** One report (a PR and its plans); null when unusable. Also reads back tasks.json. */
export function qaReportOf(v: unknown): QaReport | null {
  const o = obj(v);
  const pr = o.pr ? prRefOf(o.pr) : null;
  const plans = some(arr(o.plans), qaPlanOf);
  if (!pr && !plans.length) return null;
  const t = obj(o.totals);
  return { pr, plans, bugs: some(arr(o.bugs), qaBugOf).slice(0, 100), totals: { ...qaTotalsOf(t), bugs: count(t.bugs), openBugs: count(t.openBugs) } };
}

/** `qa-status.mjs --mine --json` → the reports; throws on output that is not that JSON. */
export function parseQaRun(stdout: string): QaReport[] {
  const o = obj(JSON.parse(stdout));
  if (!Array.isArray(o.reports)) throw new Error('risposta di qa-status.mjs non riconosciuta (manca reports)');
  return some(o.reports, qaReportOf);
}
