// Impara's «Pull Request» tab (ADR 0265; the learn-from-my-PRs flow of ADR 0185, owner 2026-11-10: «le notizie e le
// PR … circa la stessa UI ma su tab separate»): the same three columns as the «Giornale» (news/NewsPage.tsx). Left the
// filters (to study, half studied, studied, all) with their counts; in the middle the user's PRs (the Task page's,
// live); on the right the open PR: repository, branches, author and date, reviewers and build, its work items, the
// link, and its lesson (how far it got, «Studiala» or «Riprendi», which starts or opens it: the click is the ask).
// With no PR yet, «Leggi le PR ora» reads them (the Task page's refresh). Keys: J/K move, E studies, O opens the PR. Used by ImparaPage.tsx; styles news.css (.nw-*).
import { useEffect, useMemo, useState } from 'react';
import type { DevopsPr } from '@shared/contract';
import type { LessonStart, LessonSummary } from '@shared/lesson';
import { impara, imparaPrefs, startLesson } from '../../lib/impara';
import { refreshTasks, useTasks } from '../../store/tasks';
import { go } from '../../actions';
import { locale, t } from '../../i18n';
import { Button, Kbd } from '../ui';
import { IconBook, IconBranch, IconExternal } from '../Icons';
import { lessonState } from './lesson-state';
import { isTyping } from './news/keys';

type PrFilter = 'todo' | 'half' | 'done' | 'all';
const FILTERS: PrFilter[] = ['todo', 'half', 'done', 'all'];
const stageOf = (l: LessonSummary | undefined): Exclude<PrFilter, 'all'> => (!l ? 'todo' : l.done ? 'done' : 'half');

function PrView({ pr, lesson }: { pr: DevopsPr; lesson: LessonSummary | undefined }) {
  const can = impara.use(s => s.state?.canTeach !== false);
  const [busy, setBusy] = useState(false);
  const study = async () => {
    if (lesson) { go({ page: 'impara', arg: lesson.id }); return; }
    if (busy) return;
    setBusy(true);
    const p = imparaPrefs.get();
    const l = await startLesson({ kind: 'pr', prUrl: pr.url, ask: '', depth: p.depth, level: p.level, mode: p.mode, ...(p.teacher ? { teacher: p.teacher } : {}) } as LessonStart);
    setBusy(false);
    if (l) go({ page: 'impara', arg: l.id });
  };
  const pct = lesson?.planned ? Math.round((lesson.seen / lesson.planned) * 100) : 0;
  return (
    <div className="nw-story" data-testid="impara-pr-view">
      <span className="nw-sec prs">{pr.repo}</span>
      <h2 className="nw-h">{pr.title}</h2>
      <div className="nw-meta">
        <span className="nw-src">!{pr.id}</span>
        <span><IconBranch size={11} /> {pr.source ?? '?'} → {pr.target}</span>
        {pr.author && <span>{pr.author}</span>}
        <span>{new Date(pr.createdAt).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })}</span>
        {pr.draft && <span className="nw-chip">{t('impara.prs.draft')}</span>}
      </div>
      <div className="nw-why prs">
        <b>{t('impara.prs.lesson')}</b>
        {lesson
          ? <span className="nw-lesson">{lessonState(lesson)}<span className="ip-bar"><i style={{ width: `${lesson.done ? 100 : pct}%` }} className={lesson.done ? '' : 'half'} /></span><span>{t('impara.prs.seen', { seen: lesson.seen, planned: lesson.planned })}</span></span>
          : t('impara.prs.notYet')}
      </div>
      <div className="nw-acts">
        <Button variant="primary" onClick={() => void study()} disabled={busy || (!lesson && !can)} testid={`impara-pr-${pr.id}`}><IconBook size={13} />{lesson ? t('impara.resume') : t('impara.prs.study')} <Kbd>E</Kbd></Button>
        <a className="btn btn-ghost btn-m nw-open" href={pr.url} target="_blank" rel="noopener noreferrer" data-testid="impara-pr-open"><IconExternal size={13} />{t('impara.prs.open')} <Kbd>O</Kbd></a>
      </div>
      {pr.reviewers.length > 0 && (
        <div className="nw-block">
          <h3>{t('impara.prs.reviewers')}</h3>
          <ul className="nw-kv">{pr.reviewers.map(r => <li key={r.name}><span>{r.name}{r.required ? ' *' : ''}</span><b className={r.vote > 0 ? 'ok' : r.vote < 0 ? 'bad' : ''}>{r.label}</b></li>)}</ul>
        </div>
      )}
      {pr.build && (
        <div className="nw-block">
          <h3>{t('impara.prs.build')}</h3>
          <ul className="nw-kv"><li><span>{pr.build.number}</span><b className={pr.build.result === 'succeeded' ? 'ok' : pr.build.result === 'failed' ? 'bad' : ''}>{pr.build.result ?? pr.build.status}</b></li></ul>
        </div>
      )}
      {pr.workItems.length > 0 && (
        <div className="nw-block">
          <h3>{t('impara.prs.items')}</h3>
          <div className="nw-links">{pr.workItems.map(w => <a key={w.id} href={w.url} target="_blank" rel="noopener noreferrer"><b>#{w.id} {w.title}</b><span>{w.state}</span></a>)}</div>
        </div>
      )}
    </div>
  );
}

export function ImparaPrTab() {
  const prs = useTasks(s => s?.prs ?? []);
  const lessons = impara.use(s => s.state?.lessons ?? []);
  const [filter, setFilter] = useState<PrFilter>('all');
  const [sel, setSel] = useState(0);
  const byPr = useMemo(() => new Map(lessons.filter(l => l.pr).map(l => [l.pr!.url, l])), [lessons]);
  const count = (f: PrFilter) => (f === 'all' ? prs.length : prs.filter(p => stageOf(byPr.get(p.url)) === f).length);
  const list = filter === 'all' ? prs : prs.filter(p => stageOf(byPr.get(p.url)) === filter);
  const pr = list[Math.min(sel, list.length - 1)];

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('.modal-backdrop, .backdrop')) return;
      const k = e.key.toLowerCase();
      if (k === 'j' || k === 'arrowdown') { e.preventDefault(); setSel(i => Math.min(list.length - 1, i + 1)); }
      else if (k === 'k' || k === 'arrowup') { e.preventDefault(); setSel(i => Math.max(0, i - 1)); }
      // E only: Enter belongs to the focused control (a filter, a tab, a link), a row handles its own
      else if (k === 'e' && pr) { e.preventDefault(); document.querySelector<HTMLButtonElement>(`[data-testid="impara-pr-${pr.id}"]`)?.click(); }
      else if (k === 'o' && pr) { e.preventDefault(); document.querySelector<HTMLAnchorElement>('[data-testid="impara-pr-open"]')?.click(); }
      else if (/^[1-4]$/.test(k)) { e.preventDefault(); setFilter(FILTERS[Number(k) - 1]!); setSel(0); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  useEffect(() => { document.querySelector('.nw-item.sel')?.scrollIntoView({ block: 'nearest' }); }, [sel, filter]);

  return (
    <div className="nw-cols-host" data-testid="impara-pr-tab"><div className="nw-cols">
      <nav className="nw-nav" aria-label={t('impara.prs.filters')}>
        <div className="nw-lbl">{t('impara.prs.filters')}</div>
        {FILTERS.map((f, i) => (
          <button key={f} type="button" className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => { setFilter(f); setSel(0); }} data-testid={`impara-pr-filter-${f}`}>
            <span className={`nw-dotsec ${f}`} />{t(`impara.prs.filter.${f}`)}<span className="n">{count(f) || ''}</span><Kbd>{String(i + 1)}</Kbd>
          </button>
        ))}
      </nav>
      <div className="nw-list" role="listbox" aria-label={t('impara.prs.list')} data-testid="impara-prs">
        {list.length === 0 && (
          <div className="nw-empty-list">
            <p>{prs.length ? t('impara.prs.noneHere') : t('impara.prs.none')}</p>
            {!prs.length && <Button size="s" onClick={() => refreshTasks()} testid="impara-prs-refresh">{t('impara.prs.refresh')}</Button>}
          </div>
        )}
        {list.map((p, i) => {
          const l = byPr.get(p.url);
          return (
            <div key={p.url} role="option" aria-selected={p === pr} tabIndex={0} className={`nw-item ${p === pr ? 'sel' : ''} ${l?.done ? 'read' : ''}`} onClick={() => setSel(i)} onKeyDown={e => { if (e.key === 'Enter') setSel(i); }} data-testid={`impara-pr-row-${p.id}`}>
              <h3><span className="nw-num">!{p.id}</span>{p.title}</h3>
              <div className="nw-meta"><span className="nw-src">{p.repo}</span><span>{p.source ?? '?'} → {p.target}</span>{l ? lessonState(l) : <span className="ip-tag amber">{t('impara.state.notStudied')}</span>}</div>
            </div>
          );
        })}
      </div>
      <article className="nw-reader">{pr ? <PrView key={pr.url} pr={pr} lesson={byPr.get(pr.url)} /> : <div className="nw-empty-read">{t('impara.prs.pick')}</div>}</article>
    </div></div>
  );
}
