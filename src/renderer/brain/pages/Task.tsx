// Task (until 2026-10-19 "DevOps", ADR 0079): everything the user needs from Azure DevOps with the content shown in the
// app, laid out as a list and a detail (ADR 0182, mockup C the owner picked on 2026-10-29: "una striscia per task o
// notifica"). On top the page head (title with the read's dot, one line of what waits, "Aggiorna ora"), the automatic
// read in one line (its settings live in Settings → Notifiche, ADR 0101) and a failed read with why (az login expired →
// the command). Left: tabs (Per te, Notifiche, PR, Work item, Test e QA, Tutto) over one strip per record: a news item,
// a ticket I follow (its changes together), my PR, a review waiting for me, my work item, a QA report; those that ask
// something of me first, then the unread, then the newest. Right: the chosen strip in full (the whole comment, the PR's
// four checks, voters and last comment, the work item's description, comments and test cases, the test plans), with
// "Discuti" (RecordDiscussButton.tsx: a draft for the Orchestrator) and "Segna letta". J/K or the arrows move, E marks
// read. All of it from the brain's read-only script devops-me.mjs --full, kept by main's TaskService: zero tokens, no AI
// summary. Why: the user, 2026-10-11 ("vorrei un aggiornamento automatico da DevOps"), 2026-10-12 ("falla figa e usabile
// ... info aggiuntive sempre a costo 0 token"), 2026-10-29 ("molto più pulita e usabile"). Styles: brain.css (dv-*) and
// worklog.css (tk-*).
// Used by brain/index.tsx (page 'task').
import type { DevopsComment, DevopsDetail, DevopsItem, DevopsNews, DevopsPr, DevopsPrRef, TasksState, DevopsTest } from '@shared/contract';
import { Fragment, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { markTasksRead, refreshTasks, useTasks } from '../../store/tasks';
import { fmt } from '../lib/format';
import { BUILD_WORDS, daysSince, firstName, hue, initials, lastComment, outcomeLabel, prWait, sinceLabel, stateTone, stuckDays, testSummary } from '../lib/tasks';
import { Loading } from '../components/States';
import { copyText, ExtLink, IconCopy, IconExternal, Pill, toast, type Tone } from '../components/ui';
import { QaCard } from './TaskQa';
import { qaHeadline } from '../lib/qa';
import { RecordDiscussButton } from '../components/RecordDiscussButton';
import { HelpTip } from '../../components/HelpTip';
import { IconSettings } from '../../components/Icons';
import { t as tr, type TextKey } from '../../i18n';
import '../../styles/agent-catalog.css';
import './worklog.css';

const VERB: Record<DevopsNews['kind'], TextKey> = {
  mention: 'brainText.task.verb.mention', touched: 'brainText.task.verb.touched', taken: 'brainText.task.verb.taken', review: 'brainText.task.verb.review',
  comment: 'brainText.task.verb.comment', vote: 'brainText.task.verb.vote', build: 'brainText.task.verb.build', followed: 'brainText.task.verb.followed',
};
const KIND_TONE: Partial<Record<DevopsNews['kind'], Tone>> = { mention: 'warn', build: 'bad', review: 'blue', taken: 'warn', comment: 'violet' };
const newsLine = (n: DevopsNews) => { const v = tr(VERB[n.kind]); return n.who ? `${n.who} ${v}` : v.charAt(0).toUpperCase() + v.slice(1); };
/** "failed (20261011.4)" → "fallita (20261011.4)": the script's build result in Italian. */
const buildDetail = (d: string) => d.replace(/^(\w+)/, w => BUILD_WORDS[w] ?? w);
const ERROR_TITLE: Record<NonNullable<TasksState['error']>['kind'], TextKey> = { login: 'brainText.task.error.login', script: 'brainText.task.error.script', failed: 'brainText.task.error.failed' };

// ---- small pieces ------------------------------------------------------------------------------------------------

function Avatar({ name }: { name: string | null }) {
  return <span className={`dv-av c${hue(name)}`} aria-hidden="true">{initials(name)}</span>;
}

/** A text from DevOps, shown as text (never HTML), its lines kept; one longer than its box folded with "Mostra tutto"
 *  (measured, so a long line on a wide card is not folded; re-measured when a closed <details> opens or the card resizes). */
function Text({ text, lines = 6, testId }: { text: string; lines?: number; testId?: string }) {
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);
  return (
    <div className="dv-text-wrap">
      <div ref={ref} className={`dv-text ${open ? '' : 'clamp'}`} style={{ ['--lines' as string]: lines }} data-testid={testId}>{text}</div>
      {(over || open) && <button type="button" className="bx-go small" onClick={() => setOpen(o => !o)}>{open ? tr('brainText.task.showLess') : tr('brainText.task.showAll')}</button>}
    </div>
  );
}

function CommentView({ c, compact = false }: { c: DevopsComment; compact?: boolean }) {
  return (
    <div className={`dv-comment ${c.mine ? 'mine' : ''}`}>
      <Avatar name={c.who} />
      <div className="dv-comment-body">
        <div className="dv-comment-head"><b>{c.mine ? tr('brainText.task.you') : c.who || tr('brainText.task.someone')}</b><span className="muted" title={fmt.when(c.at)}>{fmt.ago(c.at)}</span></div>
        <Text text={c.text || tr('brainText.task.emptyComment')} lines={compact ? 3 : 6} />
      </div>
    </div>
  );
}

function TestChips({ tests }: { tests: DevopsTest[] }) {
  const sum = testSummary(tests);
  if (!sum) return null;
  return (
    <div className="dv-tests" data-testid="task-tests">
      <Pill tone={sum.tone}>{sum.text}</Pill>
      <ul>
        {tests.map(t => { const o = outcomeLabel(t.outcome); return <li key={t.id}><Pill tone={o.tone}>{o.label}</Pill><span className="t">{t.title}</span></li>; })}
      </ul>
    </div>
  );
}

/** What a work item holds, read in the app: dates, description, test cases, last comments; DevOps one click away. */
function DetailView({ w, d }: { w: DevopsItem; d: DevopsDetail | undefined }) {
  const since = daysSince(d?.stateSince);
  return (
    <div className="dv-detail" data-testid={`task-detail-${w.id}`}>
      <div className="dv-facts small muted">
        {since !== null && <span>{w.state} {sinceLabel(since)}</span>}
        {d?.createdAt && <span>{tr('brainText.task.opened', { ago: fmt.ago(d.createdAt) })}</span>}
        {w.assignedTo && <span>{tr('brainText.common.assignedTo', { name: w.assignedTo.replace(/\s*<.*$/, '') })}</span>}
        {w.iteration && <span>{w.iteration.split('\\').pop()}</span>}
        <span className="sp" />
        <ExtLink href={w.url} className="dv-open">{tr('brainText.task.openInDevops')} <IconExternal /></ExtLink>
      </div>
      {!d ? <p className="small muted">{tr('brainText.task.notRead')}</p> : (
        <>
          <div className="dv-block"><span className="bx-eyebrow">{tr('brainText.task.description')}</span>{d.description ? <Text text={d.description} lines={8} testId={`task-desc-${w.id}`} /> : <p className="small muted">{tr('brainText.task.noDescription')}</p>}</div>
          {d.tests.length > 0 && <div className="dv-block"><span className="bx-eyebrow">{tr('brainText.task.testCases')}</span><TestChips tests={d.tests} /></div>}
          <div className="dv-block">
            <span className="bx-eyebrow">{tr('brainText.task.lastComments')}</span>
            {d.comments.length ? <div className="dv-comments">{d.comments.map((c, i) => <CommentView key={i} c={c} />)}</div> : <p className="small muted">{tr('brainText.task.noComments')}</p>}
          </div>
        </>
      )}
    </div>
  );
}

/** A work item as a row that opens in place on its details. */
/** `state` false inside a state group (its heading already says it). */
function ItemRow({ w, d, now, state = true }: { w: DevopsItem; d: DevopsDetail | undefined; now: number; state?: boolean }) {
  const stuck = stuckDays(w, now);
  const last = lastComment(d);
  const sum = d ? testSummary(d.tests) : null;
  const urgent = w.type === 'Bug' && (w.priority ?? 9) <= 2;
  return (
    <details className="dv-item" data-testid={`task-item-${w.id}`}>
      <summary>
        {state && <Pill tone={stateTone(w.state)}>{w.state || '—'}</Pill>}
        <span className="dv-item-main">
          <span className="dv-item-title">
            {w.priority !== null && <span className={`dv-prio ${urgent ? 'hot' : ''}`} title={tr('brainText.task.priority', { n: w.priority })}>P{w.priority}</span>}
            <b>{w.title}</b>
          </span>
          <span className="dv-item-sub small">
            <span className="muted">{w.type}</span>
            {stuck !== null ? <span className={stuck >= 7 ? 'dv-bad' : 'dv-warn'}>{tr('brainText.task.stuck', { since: sinceLabel(stuck) })}</span> : w.changedAt ? <span className="muted">{tr('brainText.task.moved', { ago: fmt.ago(w.changedAt) })}</span> : null}
            {sum && <span className={`dv-${sum.tone || 'muted'}`}>{sum.text}</span>}
            {last && <span className="dv-last bx-clip1" title={last.text}><b>{last.mine ? tr('brainText.task.you') : firstName(last.who)}:</b> {last.text.replace(/\s+/g, ' ')}</span>}
          </span>
        </span>
        <RecordDiscussButton rec={{ kind: 'workitem', item: w }} />
      </summary>
      <DetailView w={w} d={d} />
    </details>
  );
}

// ---- news -------------------------------------------------------------------------------------------------------

function NewsCard({ n, details, now }: { n: DevopsNews; details: TasksState['details']; now: number }) {
  const d = n.item ? details[String(n.item.id)] : undefined;
  const text = n.body ?? (n.kind === 'build' && n.detail ? buildDetail(n.detail) : n.detail);
  return (
    <article className={`dv-news ${n.unread ? 'unread' : ''} k-${n.kind}`} data-testid={`task-news-${n.key}`} data-unread={n.unread ? '1' : '0'}>
      <div className="dv-news-head">
        <Avatar name={n.who ?? (n.kind === 'build' ? 'Build' : null)} />
        <span className="dv-news-who"><b>{newsLine(n)}</b><span className="muted" title={fmt.when(n.at)}> · {fmt.ago(n.at)}</span></span>
        <span className="sp" />
        {n.item ? <RecordDiscussButton rec={{ kind: 'workitem', item: n.item }} /> : n.pr ? <RecordDiscussButton rec={{ kind: 'pr', pr: n.pr, mine: n.kind !== 'review' }} /> : null}
        {n.unread ? <Pill tone={KIND_TONE[n.kind] ?? 'blue'}>{tr('brainText.task.new')}</Pill> : <Pill tone="outline">{tr('brainText.task.read')}</Pill>}
        {n.unread && <button type="button" className="bx-btn s" onClick={() => markTasksRead([n.key])} data-testid={`task-read-${n.key}`}>{tr('brainText.task.markRead')}</button>}
      </div>
      <div className="dv-news-what">
        {n.item && <Pill tone={stateTone(n.item.state)}>{n.item.state}</Pill>}
        {n.pr && <Pill tone="outline">PR</Pill>}
        <ExtLink href={n.url} onClick={() => { if (n.unread) markTasksRead([n.key]); }}>{n.title}</ExtLink>
        {n.item?.priority != null && <span className="small muted">{n.item.type} · P{n.item.priority}</span>}
      </div>
      {text && <blockquote className="dv-quote"><Text text={text} lines={8} testId={`task-body-${n.key}`} /></blockquote>}
      {n.item && d && (
        <details className="dv-more">
          <summary>{tr('brainText.task.ticketDetails')}</summary>
          <DetailView w={n.item} d={d} />
        </details>
      )}
      {n.item && !d && n.kind !== 'followed' && stuckDays(n.item, now) !== null && <p className="small muted">{tr('brainText.task.stuck', { since: sinceLabel(stuckDays(n.item, now)!) })}</p>}
    </article>
  );
}

/** The tickets I follow: one card per ticket with its changes (state, assignee, comments) newest first. */
function FollowedCard({ news, details }: { news: DevopsNews[]; details: TasksState['details'] }) {
  const first = news[0]!;
  const unread = news.filter(n => n.unread);
  const d = first.item ? details[String(first.item.id)] : undefined;
  return (
    <article className={`dv-news ${unread.length ? 'unread' : ''} k-followed`} data-testid={`task-followed-${first.item?.id ?? first.key}`}>
      <div className="dv-news-what">
        {first.item && <Pill tone={stateTone(first.item.state)}>{first.item.state}</Pill>}
        <ExtLink href={first.url}>{first.title}</ExtLink>
        {first.item?.assignedTo && <span className="small muted">{tr('brainText.common.to', { name: first.item.assignedTo.replace(/\s*<.*$/, '') })}</span>}
        <span className="sp" />
        {first.item && <RecordDiscussButton rec={{ kind: 'workitem', item: first.item }} />}
        {unread.length > 0 && <button type="button" className="bx-btn s" onClick={() => markTasksRead(unread.map(n => n.key))} data-testid={`task-read-followed-${first.item?.id ?? first.key}`}>{tr('brainText.task.markRead')}</button>}
      </div>
      <ul className="dv-changes">
        {news.map(n => (
          <li key={n.key} className={n.unread ? 'unread' : ''} data-testid={`task-news-${n.key}`} data-unread={n.unread ? '1' : '0'}>
            <Avatar name={n.who} />
            <div className="dv-comment-body">
              <div className="dv-comment-head"><b>{n.who ?? tr('brainText.task.someone')}</b><span className="muted">{(n.detail ?? '').replace(/ · commento: ".*$/, '').replace(/^commento: ".*$/, tr('brainText.task.commented')) || tr('brainText.task.verb.followed')}</span><span className="muted" title={fmt.when(n.at)}>· {fmt.ago(n.at)}</span>{n.unread && <Pill tone="blue">{tr('brainText.task.new')}</Pill>}</div>
              {n.body && <Text text={n.body} lines={4} />}
            </div>
          </li>
        ))}
      </ul>
      {first.item && d && (
        <details className="dv-more">
          <summary>{tr('brainText.task.ticketDetails')}</summary>
          <DetailView w={first.item} d={d} />
        </details>
      )}
    </article>
  );
}

// ---- PRs --------------------------------------------------------------------------------------------------------

function voteMark(vote: number): { mark: string; tone: Tone } {
  if (vote >= 10) return { mark: '✓', tone: 'good' };
  if (vote === 5) return { mark: '✓', tone: 'good' };
  if (vote === -5) return { mark: '✎', tone: 'warn' };
  if (vote <= -10) return { mark: '✗', tone: 'bad' };
  return { mark: '·', tone: 'outline' };
}
/** The build's result as a link to its run ("build ok", "build fallita", "build in corso"). */
function buildLink(b: DevopsPr['build']) {
  if (!b) return <span>{tr('brainText.task.noBuild')}</span>;
  const word = b.result ?? b.status ?? '';
  const label = b.result === 'succeeded' ? tr('brainText.task.buildOk') : tr('brainText.task.build', { word: BUILD_WORDS[word] ?? word });
  return <ExtLink href={b.url} title={`Build ${b.number}${b.at ? `, ${fmt.ago(b.at)}` : ''}`}>{label}</ExtLink>;
}
/** The votes in one line: how many approved, and whether a required reviewer still says no or nothing. */
function voteSummary(rs: DevopsPr['reviewers']): { text: string; tone: Tone } {
  if (!rs.length) return { text: tr('brainText.task.noReviewers'), tone: '' };
  const ok = rs.filter(r => r.vote >= 5).length;
  const no = rs.some(r => r.vote <= -10);
  const missing = rs.some(r => r.required && r.vote < 5);
  return { text: tr('brainText.task.approve', { ok, n: rs.length }), tone: no ? 'bad' : missing ? 'warn' : 'good' };
}
/** One step of a PR's check strip: a dot in its tone, its name, its state. */
function Check({ k, tone, children }: { k: ReactNode; tone: Tone; children: ReactNode }) {
  return (
    <div className={`dv-check ${tone}`}>
      <span className="k"><i aria-hidden="true" />{k}</span>
      <span className="v">{children}</span>
    </div>
  );
}

function PrCard({ p, details, now }: { p: DevopsPr; details: TasksState['details']; now: number }) {
  const wait = prWait(p);
  const age = daysSince(p.createdAt, now);
  const votes = voteSummary(p.reviewers);
  return (
    <article className={`dv-pr t-${wait.tone || 'none'}`} data-testid={`task-pr-${p.id}`}>
      <div className={`dv-wait ${wait.tone}`} data-testid={`task-wait-${p.id}`}>{wait.text}</div>
      <div className="dv-pr-head"><h3><ExtLink href={p.url} title={tr('brainText.common.openPr')}>{p.title} <IconExternal /></ExtLink></h3><RecordDiscussButton rec={{ kind: 'pr', pr: p, mine: true }} /></div>
      <div className="small muted">{p.draft && <Pill tone="outline">{tr('brainText.task.draft')}</Pill>} {p.repo}{p.target ? ` → ${p.target}` : ''}{age !== null ? (age === 0 ? tr('brainText.task.openedToday') : tr('brainText.task.openedDays', { n: age })) : ''}</div>
      <div className="dv-checks" data-testid={`task-checks-${p.id}`}>
        <Check k={tr('brainText.task.check.build')} tone={!p.build ? '' : p.build.result === 'succeeded' ? 'good' : p.build.result === 'failed' ? 'bad' : 'warn'}>{buildLink(p.build)}</Check>
        <Check k={tr('brainText.task.check.votes')} tone={votes.tone}>{votes.text}</Check>
        <Check k={tr('brainText.task.check.threads')} tone={p.activeThreads ? 'warn' : 'good'}>{p.activeThreads ? tr('brainText.task.threadsOpen', { n: p.activeThreads }) : tr('brainText.task.threadsNone')}</Check>
        <Check k={<>Auto-complete<HelpTip label="Auto-complete" title="Auto-complete">{tr('brainText.task.autoHelp')}</HelpTip></>} tone={p.autoComplete ? 'good' : ''}>{p.autoComplete ? tr('brainText.task.autoOn') : tr('brainText.task.autoOff')}</Check>
      </div>
      {p.reviewers.length > 0
        ? <div className="dv-voters">{p.reviewers.map(r => { const v = voteMark(r.vote); return <span key={r.name} className={`dv-voter ${v.tone}`} data-tip={tr('brainText.task.voteTip', { kind: r.required ? tr('brainText.task.reviewerRequired') : tr('brainText.task.reviewerOptional'), vote: r.label || tr('brainText.task.voteNobody') })}><span className="m">{v.mark}</span>{r.name}: {r.label || tr('brainText.task.noVote')}{r.required ? <span className="muted">{tr('brainText.task.required')}</span> : ''}</span>; })}</div>
        : <p className="small muted">{tr('brainText.task.noReviewer')}</p>}
      {p.lastComment && (
        <div className="dv-pr-last">
          <span className="bx-eyebrow">{tr('brainText.task.lastComment')}</span>
          <CommentView c={p.lastComment} compact />
        </div>
      )}
      {p.workItems.length > 0 && (
        <div className="dv-pr-items">
          <span className="bx-eyebrow">{tr('brainText.task.linkedItems')}</span>
          {p.workItems.map(w => <ItemRow key={w.id} w={w} d={details[String(w.id)]} now={now} />)}
        </div>
      )}
    </article>
  );
}

// ---- head -------------------------------------------------------------------------------------------------------

function ErrorBanner({ e }: { e: NonNullable<TasksState['error']> }) {
  return (
    <div className="bx-error" role="alert" data-testid="task-error">
      <div className="t">
        <b>{tr(ERROR_TITLE[e.kind])}</b>
        <span className="cause">{e.message}</span>
        {e.command && (
          <span className="bx-row" style={{ marginTop: 4 }}>
            <code className="bx-kbd" data-testid="task-error-command">{e.command}</code>
            <button type="button" className="bx-btn s" onClick={() => { void copyText(e.command!).then(ok => toast(ok ? tr('brainText.common.commandCopied') : tr('brainText.common.copyFailed'))); }}><IconCopy /> {tr('brainText.common.copy')}</button>
          </span>
        )}
      </div>
      <button type="button" className="bx-btn" onClick={refreshTasks}>{tr('brainPages.task.refresh')}</button>
    </div>
  );
}

/** The automatic read in one line, with a link to its settings (Settings → Notifiche, components/TaskReadSettings.tsx):
 *  the controls left the top of this work page (ADR 0101). */
function AutoState({ s }: { s: TasksState }) {
  const every = s.everyMin < 60 ? `${s.everyMin} min` : `${s.everyMin / 60} h`;
  return (
    <p className="tk-auto-state small muted" data-testid="task-auto-state">
      <span>{tr('brainPages.task.readState', { on: s.enabled, every })}{s.enabled && s.nextAt ? ` · ${tr('brainPages.task.next', { when: fmt.when(s.nextAt) })}` : ''}</span>
      {' · '}<button type="button" className="link-btn" data-testid="task-settings-link" onClick={() => { void import('../../actions').then(a => a.go({ page: 'impostazioni', arg: 'notifications' })); }}>
        <IconSettings /> {tr('brainPages.task.settingsLink')}</button>
    </p>
  );
}

/** A review waiting for me, in the detail pane: who asked, where, since when; Discuti and the PR one click away. */
function ReviewDetail({ p, now }: { p: DevopsPrRef; now: number }) {
  const d = daysSince(p.createdAt, now);
  return (
    <article className="tk-review" data-testid={`task-review-${p.id}`}>
      <div className="dv-pr-head"><h3><ExtLink href={p.url} title={tr('brainText.common.openPr')}>{p.title} <IconExternal /></ExtLink></h3><RecordDiscussButton rec={{ kind: 'pr', pr: p, mine: false }} /></div>
      <div className="tk-review-who"><Avatar name={p.author} /><span><b>{p.author?.replace(/\s*<.*$/, '') ?? tr('brainText.task.someone')}</b> <span className="muted">· {p.repo}</span></span>
        {d !== null && <Pill tone={d >= 3 ? 'warn' : 'outline'}>{tr('brainText.task.waits', { since: sinceLabel(d) })}</Pill>}</div>
    </article>
  );
}

/** A work item in the detail pane: its title, state and priority on top, then what DetailView reads. */
function ItemDetail({ w, d, now }: { w: DevopsItem; d: DevopsDetail | undefined; now: number }) {
  const stuck = stuckDays(w, now);
  return (
    <article className="tk-item" data-testid={`task-item-${w.id}`}>
      <div className="dv-pr-head"><h3><ExtLink href={w.url}>{w.title} <IconExternal /></ExtLink></h3><RecordDiscussButton rec={{ kind: 'workitem', item: w }} /></div>
      <div className="bx-row">
        <Pill tone={stateTone(w.state)}>{w.state || '—'}</Pill>
        <span className="small muted">{w.type}{w.priority !== null ? ` · P${w.priority}` : ''}</span>
        {stuck !== null && <span className={`small ${stuck >= 7 ? 'dv-bad' : 'dv-warn'}`}>{tr('brainText.task.stuck', { since: sinceLabel(stuck) })}</span>}
      </div>
      <DetailView w={w} d={d} />
    </article>
  );
}

// ---- page -------------------------------------------------------------------------------------------------------

/** The page's head, as on Agenti: the title with the read's state dot, the subtitle, the time of the read and the refresh. */
function Head({ s, lead }: { s: TasksState | null; lead?: ReactNode }) {
  const dot = !s ? '' : s.running ? 'run' : s.error ? 'bad' : s.at ? 'good' : '';
  return (
    <header className="catalog-head">
      <div>
        <h2>{tr('brainPages.task.title')}{dot && <i className={`tk-dot ${dot}`} aria-hidden="true" />}</h2>
        <p>{tr('brainPages.task.subtitle')}</p>
        {lead && <p className="dv-lead" data-testid="bx-lead">{lead}</p>}
      </div>
      {s && (
        <div className="tk-head-side">
          {s.at ? <span className="when" title={fmt.when(s.at)}>{tr('brainPages.task.updated', { ago: fmt.ago(s.at) })}</span> : null}
          <button type="button" className="btn btn-primary" disabled={s.running} onClick={refreshTasks} data-testid="task-refresh">{s.running ? tr('brainPages.task.reading') : tr('brainPages.task.refresh')}</button>
        </div>
      )}
    </header>
  );
}


// ---- the list and the detail -------------------------------------------------------------------------------------

type TabId = 'mine' | 'news' | 'prs' | 'items' | 'qa' | 'all';
type Glyph = 'mention' | 'comment' | 'build' | 'pr' | 'review' | 'item' | 'bug' | 'follow' | 'qa';
/** One strip of the list: what it is, which tabs hold it, and what the detail pane shows when it is chosen. */
interface Row {
  key: string; tabs: TabId[]; mine: boolean; unread: boolean; at: number | null;
  /** unread at the last read: keeps its place (and its tab) until the next read, read or not */
  fresh: boolean;
  glyph: Glyph; tone: Tone; kind: string; title: string; sub: string; subTone?: Tone;
  /** the news this strip marks read (E, "Segna letta") */
  readKeys: string[];
  detail: () => ReactNode;
}
const NEWS_GLYPH: Record<DevopsNews['kind'], Glyph> = { mention: 'mention', touched: 'item', taken: 'item', review: 'review', comment: 'comment', vote: 'review', build: 'build', followed: 'follow' };
/** The news that ask something of me: someone named me, asked my vote, took my item, broke my build. */
const NEWS_MINE = new Set<DevopsNews['kind']>(['mention', 'review', 'taken', 'build']);
const ms = (iso: string | null | undefined): number | null => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : null; };
const oneLine = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** A strip's small icon: a stroke drawing per kind, in the strip's tone. */
function GlyphIcon({ g }: { g: Glyph }) {
  const d: Record<Glyph, ReactNode> = {
    mention: <><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" /></>,
    comment: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
    build: <><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></>,
    pr: <><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M6 8.5v7M18 15.5V10a3 3 0 0 0-3-3h-4" /></>,
    review: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
    item: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 9h8M8 13h8M8 17h5" /></>,
    bug: <><rect x="8" y="6" width="8" height="13" rx="4" /><path d="M12 10v9M4 13h4M16 13h4M5 7l3 2M19 7l-3 2M5 19l3-2M19 19l-3-2" /></>,
    follow: <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4" />,
    qa: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d[g]}</svg>;
}

/** Every record of the read as one strip: news (a followed ticket is one strip with its changes), my PRs, the reviews
 *  waiting for me, my work items, the QA reports. Those that ask something of me first, then the unread, then the newest. */
function buildRows(s: TasksState, now: number, kept: (n: DevopsNews) => boolean): Row[] {
  const rows: Row[] = [];
  for (const n of s.news.filter(x => x.kind !== 'followed')) {
    const text = n.body ?? (n.kind === 'build' && n.detail ? buildDetail(n.detail) : n.detail);
    const fresh = kept(n);
    const mine = fresh && NEWS_MINE.has(n.kind);
    rows.push({
      key: `news:${n.key}`, tabs: ['news', 'all', ...(mine ? ['mine' as const] : [])], mine, unread: n.unread, fresh, at: ms(n.at),
      glyph: NEWS_GLYPH[n.kind], tone: n.unread ? KIND_TONE[n.kind] ?? 'blue' : '', kind: newsLine(n), title: n.title, sub: oneLine(text),
      readKeys: n.unread ? [n.key] : [], detail: () => <NewsCard n={n} details={s.details} now={now} />,
    });
  }
  const followed = new Map<string, DevopsNews[]>();
  for (const n of s.news.filter(x => x.kind === 'followed')) { const k = String(n.item?.id ?? n.url.match(/edit\/(\d+)/)?.[1] ?? n.url); followed.set(k, [...(followed.get(k) ?? []), n]); }
  for (const [k, ns] of followed) {
    const first = ns[0]!;
    const unread = ns.filter(n => n.unread);
    rows.push({
      key: `followed:${k}`, tabs: ['news', 'all'], mine: false, unread: unread.length > 0, fresh: ns.some(kept), at: ms(first.at),
      glyph: 'follow', tone: unread.length ? 'blue' : '', kind: tr('brainText.task.sec.followed'), title: first.title,
      sub: oneLine(`${first.who ?? ''} ${(first.detail ?? '').replace(/ · commento: ".*$/, '')}`),
      readKeys: unread.map(n => n.key), detail: () => <FollowedCard news={ns} details={s.details} />,
    });
  }
  for (const p of s.prs) {
    const w = prWait(p);
    const mine = w.who === 'me' && (w.tone === 'bad' || w.tone === 'warn');
    rows.push({
      key: `pr:${p.id}`, tabs: ['prs', 'all', ...(mine ? ['mine' as const] : [])], mine, unread: false, fresh: false, at: ms(p.lastComment?.at) ?? ms(p.createdAt),
      glyph: 'pr', tone: mine ? w.tone : '', kind: tr('brainText.task.sec.prs'), title: p.title, sub: w.text, subTone: w.tone,
      readKeys: [], detail: () => <PrCard p={p} details={s.details} now={now} />,
    });
  }
  for (const p of s.reviews) {
    const d = daysSince(p.createdAt, now);
    rows.push({
      key: `review:${p.id}`, tabs: ['prs', 'all', 'mine'], mine: true, unread: false, fresh: false, at: ms(p.createdAt),
      glyph: 'review', tone: 'violet', kind: tr('brainText.task.tab.review'), title: p.title,
      sub: [p.author?.replace(/\s*<.*$/, ''), d !== null ? tr('brainText.task.waits', { since: sinceLabel(d) }) : ''].filter(Boolean).join(' · '), subTone: d !== null && d >= 3 ? 'warn' : '',
      readKeys: [], detail: () => <ReviewDetail p={p} now={now} />,
    });
  }
  for (const w of s.assigned) {
    const stuck = stuckDays(w, now);
    const hot = w.type === 'Bug' && (w.priority ?? 9) <= 2 && stuck !== null;
    const sum = testSummary(s.details[String(w.id)]?.tests ?? []);
    rows.push({
      key: `item:${w.id}`, tabs: ['items', 'all', ...(hot ? ['mine' as const] : [])], mine: hot, unread: false, fresh: false, at: ms(w.changedAt),
      glyph: w.type === 'Bug' ? 'bug' : 'item', tone: hot ? 'bad' : stuck !== null ? 'warn' : '', kind: `${w.type}${w.priority !== null ? ` · P${w.priority}` : ''}`, title: w.title,
      sub: [w.state, stuck !== null ? tr('brainText.task.stuck', { since: sinceLabel(stuck) }) : '', sum?.text ?? ''].filter(Boolean).join(' · '), subTone: stuck !== null ? (stuck >= 7 ? 'bad' : 'warn') : '',
      readKeys: [], detail: () => <ItemDetail w={w} d={s.details[String(w.id)]} now={now} />,
    });
  }
  for (const r of s.qa) {
    const h = qaHeadline(r);
    rows.push({
      key: `qa:${r.pr?.id ?? r.plans[0]?.id}`, tabs: ['qa', 'all'], mine: false, unread: false, fresh: false, at: null,
      glyph: 'qa', tone: h.tone === 'bad' ? 'bad' : '', kind: tr('brainText.taskQa.title'), title: r.pr?.title ?? r.plans[0]?.name ?? '', sub: h.text, subTone: h.tone,
      readKeys: [], detail: () => <QaCard r={r} />,
    });
  }
  return rows.sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.fresh) - Number(a.fresh) || (b.at ?? 0) - (a.at ?? 0));
}

function Strip({ r, on, onPick, now }: { r: Row; on: boolean; onPick: () => void; now: number }) {
  return (
    <li role="option" aria-selected={on} id={`tk-row-${r.key}`} className={`tk-strip ${on ? 'on' : ''} ${r.unread ? 'unread' : ''} t-${r.tone || 'none'}`}
      onClick={onPick} data-testid={`task-row-${r.key}`} data-unread={r.unread ? '1' : '0'}>
      <span className="tk-glyph" aria-hidden="true"><GlyphIcon g={r.glyph} /></span>
      <span className="tk-strip-text">
        <span className="tk-strip-top"><span className="tk-strip-kind">{r.kind}</span>{r.at !== null && <time className="tk-strip-when" dateTime={new Date(r.at).toISOString()} title={fmt.when(r.at)}>{fmt.ago(r.at, now)}</time>}</span>
        <b className="tk-strip-title">{r.title}</b>
        {r.sub && <span className={`tk-strip-sub ${r.subTone ? `dv-${r.subTone}` : ''}`}>{r.sub}</span>}
      </span>
    </li>
  );
}

export function TaskPage() {
  const s = useTasks(x => x);
  // the news unread at the last read stay unread-looking ("letta" once read) until the next read: a strip never jumps
  // away under the pointer or takes the keyboard focus with it
  const top = useRef<{ at: number | null; keys: Set<string> }>({ at: null, keys: new Set() });
  const [tab, setTab] = useState<TabId | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  if (!s) return <section className="tk-page"><Head s={null} /><Loading label={tr('brainPages.task.loading')} /></section>;
  if (top.current.at !== s.at || top.current.keys.size === 0) top.current = { at: s.at, keys: new Set(s.news.filter(n => n.unread).map(n => n.key)) };
  const now = Date.now();
  const kept = (n: DevopsNews) => n.unread || top.current.keys.has(n.key);
  const rows = buildRows(s, now, kept);
  const count = (id: TabId) => rows.filter(r => r.tabs.includes(id)).length;
  const mineN = count('mine');
  const tabs: { id: TabId; label: string; n: number }[] = [
    { id: 'mine', label: tr('brainText.task.tab.mine'), n: mineN },
    { id: 'news', label: tr('brainText.task.tab.news'), n: count('news') },
    { id: 'prs', label: tr('brainText.task.tab.prs'), n: count('prs') },
    { id: 'items', label: tr('brainText.task.sec.items'), n: count('items') },
    ...(s.qa.length || s.qaError ? [{ id: 'qa' as const, label: tr('brainText.taskQa.title'), n: count('qa') }] : []),
    { id: 'all', label: tr('brainText.task.tab.all'), n: rows.length },
  ];
  const cur: TabId = tab && tabs.some(x => x.id === tab) ? tab : mineN ? 'mine' : 'all';
  const shown = rows.filter(r => r.tabs.includes(cur));
  const sel = shown.find(r => r.key === picked) ?? shown[0] ?? null;
  const unreadNews = s.news.filter(n => n.unread);
  const unreadDirect = unreadNews.filter(n => n.kind !== 'followed');
  const unreadFollowed = unreadNews.length - unreadDirect.length;
  const mentions = unreadNews.filter(n => n.kind === 'mention').length;
  const waitMe = s.prs.filter(p => prWait(p).who === 'me').length;
  const never = s.at === null;

  const pick = (key: string) => { setPicked(key); requestAnimationFrame(() => document.getElementById(`tk-row-${key}`)?.scrollIntoView({ block: 'nearest' })); };
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.altKey || e.ctrlKey || e.metaKey) return;
    const i = sel ? shown.indexOf(sel) : -1;
    const k = e.key.toLowerCase();
    if ((k === 'j' || k === 'arrowdown') && i < shown.length - 1) { e.preventDefault(); pick(shown[i + 1]!.key); }
    else if ((k === 'k' || k === 'arrowup') && i > 0) { e.preventDefault(); pick(shown[i - 1]!.key); }
    else if (k === 'e' && sel?.readKeys.length) { e.preventDefault(); markTasksRead(sel.readKeys); }
  };

  const lead = s.error
    ? <><b>{tr(ERROR_TITLE[s.error.kind])}</b>{s.at ? <>{tr('brainText.task.lead.lastOk', { ago: fmt.ago(s.at) })}</> : '.'}</>
    : never
      ? <b>{s.running ? tr('brainText.task.lead.firstRead') : tr('brainText.task.lead.never')}</b>
      : <>
          <b>{mineN ? tr('brainText.task.lead.mine', { n: mineN }) : tr('brainText.task.lead.noMine')}</b>
          {' · '}{unreadDirect.length ? tr('brainText.task.lead.unread', { n: unreadDirect.length }) : tr('brainText.task.lead.noUnread')}
          {mentions > 0 && <>, {tr('brainText.task.mentions', { n: mentions })}</>}
          {unreadFollowed > 0 && tr('brainText.task.lead.followed', { n: unreadFollowed })}
          {waitMe ? tr('brainText.task.lead.waitMe', { n: waitMe }) : tr('brainText.task.lead.noWait')}
        </>;

  return (
    <section className="tk-page" aria-label={tr('brainPages.task.title')} data-testid="task-page">
      <Head s={s} lead={lead} />
      {s.error && <ErrorBanner e={s.error} />}
      <AutoState s={s} />

      {never ? (s.running ? <Loading label={tr('brainPages.task.firstRead')} lines={4} /> : <p className="tk-empty" data-testid="task-never"><b>{tr('brainPages.task.neverTitle')}</b> {tr('brainPages.task.neverBody')}</p>) : (
        <div className="tk-split" onKeyDown={onKey}>
          <div className="tk-side">
            <div className="tk-tabs" role="tablist" aria-label={tr('brainPages.task.sections')} data-testid="task-tabs">
              {tabs.map(x => (
                <button key={x.id} type="button" role="tab" aria-selected={x.id === cur} className={x.id === cur ? 'on' : ''} onClick={() => { setTab(x.id); setPicked(null); }} data-testid={`task-tab-${x.id}`}>
                  {x.label}<span className="n">{x.n}</span>
                </button>
              ))}
            </div>
            {s.qaError && cur === 'qa' && <p className="small dv-bad" role="status" data-testid="qa-error">{s.qaError}{s.qa.length ? tr('brainText.taskQa.previous') : ''}</p>}
            {shown.length
              ? <ul ref={list} className="tk-list" role="listbox" tabIndex={0} aria-label={tabs.find(x => x.id === cur)?.label} aria-activedescendant={sel ? `tk-row-${sel.key}` : undefined} data-testid="task-list">
                  {shown.map((r, i) => <Fragment key={r.key}>
                    {i > 0 && cur !== 'mine' && shown[i - 1]!.mine && !r.mine && <li className="tk-sep" role="presentation" aria-hidden="true" />}
                    <Strip r={r} on={r === sel} onPick={() => { setPicked(r.key); list.current?.focus({ preventScroll: true }); }} now={now} />
                  </Fragment>)}
                </ul>
              : <p className="tk-empty" data-testid="task-list-empty"><b>{tr('brainText.task.list.empty')}</b> {tr('brainText.task.list.emptyBody')}</p>}
            <div className="tk-side-foot">
              {unreadDirect.length > 0 && <button type="button" className="bx-btn s" onClick={() => markTasksRead(unreadDirect.map(n => n.key))} data-testid="task-mark-all">{tr('brainText.task.news.markAll')}</button>}
              <span className="tk-keys small muted"><kbd>J</kbd> <kbd>K</kbd> {tr('brainText.task.keys.move')} · <kbd>E</kbd> {tr('brainText.task.keys.read')}</span>
            </div>
          </div>
          <div className="tk-detail" data-testid="task-detail" aria-live="polite">
            {sel ? <Fragment key={sel.key}>{sel.detail()}</Fragment> : <p className="tk-empty"><b>{tr('brainText.task.list.pick')}</b></p>}
          </div>
        </div>
      )}
    </section>
  );
}
