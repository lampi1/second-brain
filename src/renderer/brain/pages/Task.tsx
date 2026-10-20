// Task (until 2026-10-19 "DevOps", ADR 0079): the brain's first page, everything the user needs from Azure DevOps with
// the content shown in the app, so a link is opened only for a PR. Laid out like Agenti and Guida (issue #85: same
// cards, spacing, type and colors): the page head (title, subtitle, "Aggiorna ora" and the time of the read); the
// toolbar with the automatic read, its interval and the alerts' sound (ADR 0029); four number cards (to read, my PRs,
// reviews for me, work items not moving) that jump to their section; a bar that stays on top with every section and
// its count. The news as cards with the whole comment or mention; my PRs with who they wait for, a four-step check
// strip (build, votes, discussions, auto-complete), the voters, the last comment and the linked work items' test
// outcomes; "Test e QA" (TaskQa.tsx); the reviews waiting for me and since when; my work items by state, each opening
// in place on its description, last comments and test cases; the tickets I follow with their changes; the stand-up
// sentences. All of it from the brain's read-only script devops-me.mjs --full, kept by main's TaskService (imported
// automatically when the read is on): zero tokens, no AI summary. Each record has "Discuti" (RecordDiscussButton.tsx: a draft for the Orchestrator).
// A failed read says why (az login expired → the command). Why: the user, 2026-10-11 ("vorrei un aggiornamento
// automatico da DevOps"), 2026-10-12 ("falla figa e usabile ... info aggiuntive sempre a costo 0 token"), 2026-10-19
// (#85: "rinomina DevOps in Task", same look as Agenti). Styles: brain.css (dv-*) and worklog.css (tk-*).
// Used by brain/index.tsx (page 'task').
import type { DevopsComment, DevopsDetail, DevopsItem, DevopsNews, DevopsPr, DevopsPrRef, TasksState, DevopsTest } from '@shared/contract';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { markTasksRead, refreshTasks, useTasks } from '../../store/tasks';
import { fmt } from '../lib/format';
import { BUILD_WORDS, byState, daysSince, firstName, hue, initials, lastComment, outcomeLabel, prWait, sinceLabel, stateTone, stuckDays, testSummary } from '../lib/tasks';
import { normTables } from '../types';
import { useBrain } from '../api';
import { ownerOf } from '../lib/text';
import { Empty, Loading } from '../components/States';
import { copyText, ExtLink, IconCopy, IconExternal, Pill, Section, toast, type Navigate, type Tone } from '../components/ui';
import { Standup } from './day';
import { QaSection } from './TaskQa';
import { RecordDiscussButton } from '../components/RecordDiscussButton';
import { HelpTip } from '../../components/HelpTip';
import { IconSettings } from '../../components/Icons';
import { t as tr } from '../../i18n';
import '../../styles/agent-catalog.css';
import './worklog.css';

const VERB: Record<DevopsNews['kind'], string> = {
  mention: 'ti menziona', touched: 'ha cambiato un tuo work item', taken: 'ti ha tolto un work item', review: 'ti chiede una review',
  comment: 'commenta la tua PR', vote: 'ha votato la tua PR', build: 'build fallita sulla tua PR', followed: 'aggiorna un ticket che segui',
};
const KIND_TONE: Partial<Record<DevopsNews['kind'], Tone>> = { mention: 'warn', build: 'bad', review: 'blue', taken: 'warn', comment: 'violet' };
const newsLine = (n: DevopsNews) => (n.who ? `${n.who} ${VERB[n.kind]}` : VERB[n.kind].charAt(0).toUpperCase() + VERB[n.kind].slice(1));
/** "failed (20261011.4)" → "fallita (20261011.4)": the script's build result in Italian. */
const buildDetail = (d: string) => d.replace(/^(\w+)/, w => BUILD_WORDS[w] ?? w);
const ERROR_TITLE: Record<NonNullable<TasksState['error']>['kind'], string> = { login: 'Accesso a DevOps scaduto', script: 'Script di DevOps non trovato', failed: 'Lettura di DevOps non riuscita' };
type SecId = 'news' | 'prs' | 'qa' | 'reviews' | 'items' | 'followed' | 'standup';
/** Scrolls to a section and moves the keyboard focus there (Tab goes on inside it, not back among the tiles). */
const jump = (id: SecId) => { const el = document.getElementById(`dv-${id}`); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); el?.focus({ preventScroll: true }); };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
      {(over || open) && <button type="button" className="bx-go small" onClick={() => setOpen(o => !o)}>{open ? 'Mostra meno' : 'Mostra tutto'}</button>}
    </div>
  );
}

function CommentView({ c, compact = false }: { c: DevopsComment; compact?: boolean }) {
  return (
    <div className={`dv-comment ${c.mine ? 'mine' : ''}`}>
      <Avatar name={c.who} />
      <div className="dv-comment-body">
        <div className="dv-comment-head"><b>{c.mine ? 'Tu' : c.who || 'Qualcuno'}</b><span className="muted" title={fmt.when(c.at)}>{fmt.ago(c.at)}</span></div>
        <Text text={c.text || '(commento vuoto)'} lines={compact ? 3 : 6} />
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
        {d?.createdAt && <span>aperto {fmt.ago(d.createdAt)}</span>}
        {w.assignedTo && <span>assegnato a {w.assignedTo.replace(/\s*<.*$/, '')}</span>}
        {w.iteration && <span>{w.iteration.split('\\').pop()}</span>}
        <span className="sp" />
        <ExtLink href={w.url} className="dv-open">Apri in DevOps <IconExternal /></ExtLink>
      </div>
      {!d ? <p className="small muted">Descrizione e commenti di questo work item non sono stati letti (lo script del brain li legge con --full, per i primi 60): aprilo in DevOps.</p> : (
        <>
          <div className="dv-block"><span className="bx-eyebrow">Descrizione</span>{d.description ? <Text text={d.description} lines={8} testId={`task-desc-${w.id}`} /> : <p className="small muted">Nessuna descrizione.</p>}</div>
          {d.tests.length > 0 && <div className="dv-block"><span className="bx-eyebrow">Test case</span><TestChips tests={d.tests} /></div>}
          <div className="dv-block">
            <span className="bx-eyebrow">Ultimi commenti</span>
            {d.comments.length ? <div className="dv-comments">{d.comments.map((c, i) => <CommentView key={i} c={c} />)}</div> : <p className="small muted">Nessun commento.</p>}
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
            {w.priority !== null && <span className={`dv-prio ${urgent ? 'hot' : ''}`} title={`Priorità ${w.priority}`}>P{w.priority}</span>}
            <b>{w.title}</b>
          </span>
          <span className="dv-item-sub small">
            <span className="muted">{w.type}</span>
            {stuck !== null ? <span className={stuck >= 7 ? 'dv-bad' : 'dv-warn'}>fermo {sinceLabel(stuck)}</span> : w.changedAt ? <span className="muted">mosso {fmt.ago(w.changedAt)}</span> : null}
            {sum && <span className={`dv-${sum.tone || 'muted'}`}>{sum.text}</span>}
            {last && <span className="dv-last bx-clip1" title={last.text}><b>{last.mine ? 'Tu' : firstName(last.who)}:</b> {last.text.replace(/\s+/g, ' ')}</span>}
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
        {n.unread ? <Pill tone={KIND_TONE[n.kind] ?? 'blue'}>nuova</Pill> : <Pill tone="outline">letta</Pill>}
        {n.unread && <button type="button" className="bx-btn s" onClick={() => markTasksRead([n.key])} data-testid={`task-read-${n.key}`}>Letta</button>}
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
          <summary>Descrizione, commenti e test del ticket</summary>
          <DetailView w={n.item} d={d} />
        </details>
      )}
      {n.item && !d && n.kind !== 'followed' && stuckDays(n.item, now) !== null && <p className="small muted">fermo {sinceLabel(stuckDays(n.item, now)!)}</p>}
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
        {first.item?.assignedTo && <span className="small muted">a {first.item.assignedTo.replace(/\s*<.*$/, '')}</span>}
        <span className="sp" />
        {first.item && <RecordDiscussButton rec={{ kind: 'workitem', item: first.item }} />}
        {unread.length > 0 && <button type="button" className="bx-btn s" onClick={() => markTasksRead(unread.map(n => n.key))} data-testid={`task-read-followed-${first.item?.id ?? first.key}`}>Letta</button>}
      </div>
      <ul className="dv-changes">
        {news.map(n => (
          <li key={n.key} className={n.unread ? 'unread' : ''} data-testid={`task-news-${n.key}`} data-unread={n.unread ? '1' : '0'}>
            <Avatar name={n.who} />
            <div className="dv-comment-body">
              <div className="dv-comment-head"><b>{n.who ?? 'Qualcuno'}</b><span className="muted">{(n.detail ?? '').replace(/ · commento: ".*$/, '').replace(/^commento: ".*$/, 'ha commentato') || 'aggiorna un ticket che segui'}</span><span className="muted" title={fmt.when(n.at)}>· {fmt.ago(n.at)}</span>{n.unread && <Pill tone="blue">nuova</Pill>}</div>
              {n.body && <Text text={n.body} lines={4} />}
            </div>
          </li>
        ))}
      </ul>
      {first.item && d && (
        <details className="dv-more">
          <summary>Descrizione, commenti e test del ticket</summary>
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
  if (!b) return <span>nessuna build</span>;
  const word = b.result ?? b.status ?? '';
  const label = b.result === 'succeeded' ? 'build ok' : `build ${BUILD_WORDS[word] ?? word}`;
  return <ExtLink href={b.url} title={`Build ${b.number}${b.at ? `, ${fmt.ago(b.at)}` : ''}`}>{label}</ExtLink>;
}
/** The votes in one line: how many approved, and whether a required reviewer still says no or nothing. */
function voteSummary(rs: DevopsPr['reviewers']): { text: string; tone: Tone } {
  if (!rs.length) return { text: 'nessun revisore', tone: '' };
  const ok = rs.filter(r => r.vote >= 5).length;
  const no = rs.some(r => r.vote <= -10);
  const missing = rs.some(r => r.required && r.vote < 5);
  return { text: `${ok} su ${rs.length} ${ok === 1 ? 'approva' : 'approvano'}`, tone: no ? 'bad' : missing ? 'warn' : 'good' };
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
      <div className="dv-pr-head"><h3><ExtLink href={p.url} title="Apri la PR in DevOps">{p.title} <IconExternal /></ExtLink></h3><RecordDiscussButton rec={{ kind: 'pr', pr: p, mine: true }} /></div>
      <div className="small muted">{p.draft && <Pill tone="outline">bozza</Pill>} {p.repo}{p.target ? ` → ${p.target}` : ''}{age !== null ? ` · aperta ${age === 0 ? 'oggi' : `da ${plural(age, 'giorno', 'giorni')}`}` : ''}</div>
      <div className="dv-checks" data-testid={`task-checks-${p.id}`}>
        <Check k="Build" tone={!p.build ? '' : p.build.result === 'succeeded' ? 'good' : p.build.result === 'failed' ? 'bad' : 'warn'}>{buildLink(p.build)}</Check>
        <Check k="Voti" tone={votes.tone}>{votes.text}</Check>
        <Check k="Discussioni" tone={p.activeThreads ? 'warn' : 'good'}>{p.activeThreads ? plural(p.activeThreads, 'aperta', 'aperte') : 'nessuna aperta'}</Check>
        <Check k={<>Auto-complete<HelpTip label="Auto-complete" title="Auto-complete">Acceso: la PR si unisce da sola appena build, voti obbligatori e controlli sono verdi. Spento: qualcuno deve premere «Complete» in DevOps.</HelpTip></>} tone={p.autoComplete ? 'good' : ''}>{p.autoComplete ? 'auto-complete attivo' : 'senza auto-complete'}</Check>
      </div>
      {p.reviewers.length > 0
        ? <div className="dv-voters">{p.reviewers.map(r => { const v = voteMark(r.vote); return <span key={r.name} className={`dv-voter ${v.tone}`} data-tip={`${r.required ? 'Revisore obbligatorio: senza il suo sì la PR non si unisce' : 'Revisore facoltativo: il suo voto non blocca'}. Voto: ${r.label || 'nessuno'}`}><span className="m">{v.mark}</span>{r.name}: {r.label || 'nessun voto'}{r.required ? <span className="muted"> · obbligatorio</span> : ''}</span>; })}</div>
        : <p className="small muted">Nessun revisore.</p>}
      {p.lastComment && (
        <div className="dv-pr-last">
          <span className="bx-eyebrow">Ultimo commento</span>
          <CommentView c={p.lastComment} compact />
        </div>
      )}
      {p.workItems.length > 0 && (
        <div className="dv-pr-items">
          <span className="bx-eyebrow">Work item collegati</span>
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
        <b>{ERROR_TITLE[e.kind]}</b>
        <span className="cause">{e.message}</span>
        {e.command && (
          <span className="bx-row" style={{ marginTop: 4 }}>
            <code className="bx-kbd" data-testid="task-error-command">{e.command}</code>
            <button type="button" className="bx-btn s" onClick={() => { void copyText(e.command!).then(ok => toast(ok ? 'Comando copiato' : 'Copia non riuscita')); }}><IconCopy /> Copia</button>
          </span>
        )}
      </div>
      <button type="button" className="bx-btn" onClick={refreshTasks}>Aggiorna ora</button>
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

/** A number at a glance, as one of Agenti's cards; a click jumps to its section. */
function Tile({ k, v, s, tone, to, testId, index }: { k: string; v: number; s: ReactNode; tone?: Tone; to: SecId; testId: string; index: number }) {
  return (
    <button type="button" className={`catalog-card tk-tile ${tone || 'none'}`} style={{ ['--row-index' as string]: index }} onClick={() => jump(to)} data-testid={testId}>
      <span className="k"><i aria-hidden="true" />{k}</span>
      <span className="v">{v}</span>
      <span className="s">{s}</span>
    </button>
  );
}

/** A section's place on the page: the anchor the tiles and the section bar jump to. */
function Anchor({ id, children }: { id: SecId; children: ReactNode }) {
  return <div id={`dv-${id}`} className="dv-anchor" tabIndex={-1}>{children}</div>;
}

function Reviews({ list, now }: { list: DevopsPrRef[]; now: number }) {
  return (
    <div className="bx-card tight"><ul className="bx-list">{list.map(p => {
      const d = daysSince(p.createdAt, now);
      return (
        <li key={p.id} data-testid={`task-review-${p.id}`}>
          <Avatar name={p.author} />
          <span className="t"><ExtLink href={p.url} title="Apri la PR in DevOps">{p.title}</ExtLink><span className="small muted"> · {p.author?.replace(/\s*<.*$/, '') ?? ''} · {p.repo}</span></span>
          {d !== null && <Pill tone={d >= 3 ? 'warn' : 'outline'}>aspetta {sinceLabel(d)}</Pill>}
          <RecordDiscussButton rec={{ kind: 'pr', pr: p, mine: false }} />
        </li>
      );
    })}</ul></div>
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

export function TaskPage({ nav }: { nav?: Navigate }) {
  const s = useTasks(x => x);
  const t = useBrain('/api/tables', normTables);
  // the news unread at the last read stay in "Da leggere" (marked "letta" once read) until the next read: a card
  // never jumps away under the pointer or takes the keyboard focus with it
  const top = useRef<{ at: number | null; keys: Set<string> }>({ at: null, keys: new Set() });
  if (!s) return <section className="tk-page"><Head s={null} /><Loading label={tr('brainPages.task.loading')} /></section>;
  if (top.current.at !== s.at || top.current.keys.size === 0) top.current = { at: s.at, keys: new Set(s.news.filter(n => n.unread).map(n => n.key)) };
  const now = Date.now();
  const kept = (n: DevopsNews) => n.unread || top.current.keys.has(n.key);
  const direct = s.news.filter(n => n.kind !== 'followed');
  const fresh = direct.filter(kept);
  const read = direct.filter(n => !kept(n));
  const followed = new Map<string, DevopsNews[]>();
  for (const n of s.news.filter(x => x.kind === 'followed')) { const k = String(n.item?.id ?? n.url); followed.set(k, [...(followed.get(k) ?? []), n]); }
  const reviews = s.reviews;
  const waitMe = s.prs.filter(p => prWait(p).who === 'me');
  const stuck = s.assigned.filter(w => stuckDays(w, now) !== null);
  const hot = s.assigned.filter(w => w.type === 'Bug' && (w.priority ?? 9) <= 2 && stuckDays(w, now) !== null);
  const mentions = s.news.filter(n => n.unread && n.kind === 'mention').length;
  const unreadDirect = direct.filter(n => n.unread);
  const unreadFollowed = s.news.filter(n => n.unread && n.kind === 'followed').length;
  const never = s.at === null;
  const hasQa = s.qa.length > 0 || !!s.qaError;

  const secs: { id: SecId; label: string; n?: number; hot?: boolean }[] = [
    { id: 'news', label: 'Da leggere', n: unreadDirect.length, hot: unreadDirect.length > 0 },
    { id: 'prs', label: 'Le mie PR', n: s.prs.length, hot: waitMe.length > 0 },
    ...(hasQa ? [{ id: 'qa' as const, label: 'Test e QA', n: s.qa.length }] : []),
    { id: 'reviews', label: 'Review', n: reviews.length, hot: reviews.length > 0 },
    { id: 'items', label: 'Work item', n: s.assigned.length, hot: hot.length > 0 },
    ...(followed.size ? [{ id: 'followed' as const, label: 'Ticket che segui', n: followed.size, hot: unreadFollowed > 0 }] : []),
    ...(t.data ? [{ id: 'standup' as const, label: 'Stand-up' }] : []),
  ];
  const lead = s.error
    ? <><b>{ERROR_TITLE[s.error.kind]}</b>{s.at ? <>: qui sotto i dati dell'ultima lettura riuscita ({fmt.ago(s.at)}).</> : '.'}</>
    : never
      ? <b>{s.running ? 'Leggo Azure DevOps per la prima volta…' : 'Task non ancora letti: premi «Aggiorna ora».'}</b>
      : <>
          <b>{unreadDirect.length ? `${unreadDirect.length} novità da leggere` : 'Nessuna novità da leggere'}</b>
          {mentions > 0 && <>, {plural(mentions, 'menzione', 'menzioni')}</>}
          {unreadFollowed > 0 && ` · ${unreadFollowed} sui ticket che segui`}
          {` · ${waitMe.length ? `${plural(waitMe.length, 'PR aspetta', 'PR aspettano')} te` : 'nessuna PR aspetta te'}`}
          {reviews.length > 0 && ` · ${plural(reviews.length, 'review', 'review')} da fare`}
          {hot.length > 0 && <> · <b className="dv-bad">{plural(hot.length, 'bug P1/P2 fermo', 'bug P1/P2 fermi')}</b></>}
        </>;

  return (
    <section className="tk-page" aria-label={tr('brainPages.task.title')} data-testid="task-page">
      <Head s={s} lead={lead} />
      {s.error && <ErrorBanner e={s.error} />}
      <AutoState s={s} />

      {never ? (s.running ? <Loading label={tr('brainPages.task.firstRead')} lines={4} /> : <p className="tk-empty" data-testid="task-never"><b>{tr('brainPages.task.neverTitle')}</b> {tr('brainPages.task.neverBody')}</p>) : (
        <>
          <div className="tk-tiles" data-testid="task-tiles">
            <Tile k="Da leggere" v={unreadDirect.length} to="news" testId="task-tile-news" index={0} tone={mentions ? 'warn' : unreadDirect.length ? 'blue' : ''}
              s={unreadDirect.length ? (mentions ? `${plural(mentions, 'menzione', 'menzioni')} per te` : 'commenti e cambi') : unreadFollowed ? `+ ${unreadFollowed} sui ticket che segui` : 'tutto letto'} />
            <Tile k="Le mie PR" v={s.prs.length} to="prs" testId="task-tile-prs" index={1} tone={s.prs.some(p => prWait(p).tone === 'bad') ? 'bad' : waitMe.length ? 'warn' : ''}
              s={s.prs.length ? (waitMe.length ? `${waitMe.length} ${waitMe.length === 1 ? 'aspetta' : 'aspettano'} te` : 'aspettano gli altri') : 'nessuna attiva'} />
            <Tile k="Review per te" v={reviews.length} to="reviews" testId="task-tile-reviews" index={2} tone={reviews.some(p => (daysSince(p.createdAt, now) ?? 0) >= 3) ? 'warn' : reviews.length ? 'blue' : ''}
              s={reviews.length ? `la più vecchia aspetta ${sinceLabel(Math.max(...reviews.map(p => daysSince(p.createdAt, now) ?? 0)))}` : 'nessuna'} />
            <Tile k="Work item" v={s.assigned.length} to="items" testId="task-tile-items" index={3} tone={hot.length ? 'bad' : stuck.length ? 'warn' : ''}
              s={!s.assigned.length ? 'nessuno aperto' : stuck.length ? `${stuck.length} ferm${stuck.length === 1 ? 'o' : 'i'} da 3+ giorni${hot.length ? `, ${hot.length} P1/P2` : ''}` : 'tutti si muovono'} />
          </div>

          <nav className="dv-secbar" aria-label={tr('brainPages.task.sections')} data-testid="task-sections">
            {secs.map(x => (
              <button key={x.id} type="button" className={x.hot ? 'hot' : ''} onClick={() => jump(x.id)} data-testid={`task-jump-${x.id}`}>
                {x.label}{x.n !== undefined && <span className="n">{x.n}</span>}
              </button>
            ))}
          </nav>

          <Anchor id="news">
            <Section title="Da leggere" count={fresh.length} note="menzioni, commenti e voti sulle tue PR, cambi ai tuoi work item: il testo è qui" testId="task-news"
              actions={unreadDirect.length > 0 ? <button type="button" className="bx-btn s" onClick={() => markTasksRead(unreadDirect.map(n => n.key))} data-testid="task-mark-all">Segna tutte come lette</button> : undefined}>
              {fresh.length > 0
                ? <div className="dv-stack">{fresh.map(n => <NewsCard key={n.key} n={n} details={s.details} now={now} />)}</div>
                : <Empty title="Niente da leggere">Le novità nuove compaiono qui, con il testo intero.</Empty>}
              {read.length > 0 && (
                <details className="bx-details">
                  <summary>Già lette (ultimi 14 giorni) · {read.length}</summary>
                  <div className="body dv-stack">{read.map(n => <NewsCard key={n.key} n={n} details={s.details} now={now} />)}</div>
                </details>
              )}
            </Section>
          </Anchor>

          <Anchor id="prs">
            <Section title="Le mie PR" count={s.prs.length} note="chi aspetta chi, build, voti, discussioni, ultimo commento e test dei work item" testId="task-prs">
              {s.prs.length ? <div className="dv-prs">{[...s.prs].sort((a, b) => Number(prWait(b).who === 'me') - Number(prWait(a).who === 'me')).map(p => <PrCard key={p.id} p={p} details={s.details} now={now} />)}</div> : <Empty title="Nessuna PR attiva" />}
            </Section>
          </Anchor>

          {hasQa && <Anchor id="qa"><QaSection qa={s.qa} error={s.qaError} /></Anchor>}

          <Anchor id="reviews">
            <Section title="Review che aspettano te" count={reviews.length} note="la più vecchia per prima conta di più" testId="task-reviews">
              {reviews.length ? <Reviews list={reviews} now={now} /> : <Empty title="Nessuna review da fare" />}
            </Section>
          </Anchor>

          <Anchor id="items">
            <Section title="I miei work item" count={s.assigned.length} note="clic su una riga: descrizione, commenti e test case" testId="task-assigned">
              {s.assigned.length ? <div className="dv-groups">{byState(s.assigned).map(g => (
                <div key={g.state} className="dv-group" data-testid={`task-state-${g.state}`}>
                  <h3><Pill tone={stateTone(g.state)}>{g.state}</Pill><span className="count">{g.items.length}</span></h3>
                  <div className="dv-items">{g.items.map(w => <ItemRow key={w.id} w={w} d={s.details[String(w.id)]} now={now} state={false} />)}</div>
                </div>
              ))}</div> : <Empty title="Nessun work item aperto" />}
            </Section>
          </Anchor>

          {followed.size > 0 && (
            <Anchor id="followed">
              <Section title="Ticket che segui" count={followed.size} note="stato, assegnatario e commenti degli altri" testId="task-followed">
                <div className="dv-stack">{[...followed.values()].map(ns => <FollowedCard key={ns[0]!.key} news={ns} details={s.details} />)}</div>
              </Section>
            </Anchor>
          )}

          {t.data && (
            <Anchor id="standup">
              <div className="dv-standup">
                <Standup tables={t.data} owner={ownerOf(t.data.ideas)} />
                {nav && <button type="button" className="bx-go" onClick={() => nav('fatto')}>Tutto il fatto e il diario →</button>}
              </div>
            </Anchor>
          )}
        </>
      )}
    </section>
  );
}
