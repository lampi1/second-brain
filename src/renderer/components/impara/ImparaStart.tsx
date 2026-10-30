// The start of Impara (ADR 0185; one field and one line of options since ADR 0204, report «Impara v3» I1): at the top
// the overall score (ImparaScore.tsx: a ring and four tiles), then «Cosa vuoi capire davvero, oggi?» with ONE field
// that grows (Enter goes to a new line, Ctrl+Enter starts): what it holds decides the kind by itself
// (shared/impara-start.ts: a GitHub or Azure DevOps PR link = a PR, a long text = a text to explain, else a topic; a
// small chip says which and lets the user pick another); files and folders dropped on it or added with «Aggiungi
// fonte» are the lesson's sources (lib/impara-files.ts, read here; main/learn/user-files.ts); the options in one line
// (ImparaOptions.tsx) and one primary button. Under it the review (ImparaReviewHome.tsx, ADR 0189: what is due today,
// the subjects with their level and quiz), the user's PRs with how far each was studied, and the saved lessons (their
// diagram as a thumbnail, how far they got, their subject, filtered by subject), each reopening where it was left.
// Another page can send the user here with the field filled in (ADR 0190: «Capiscila» from Task, «Spiegamelo» from
// Memoria, «Imparalo» from the Guide; lib/impara.ts learnAbout), with the subject it belongs to; the user starts it.
// Used by ImparaPage.tsx.
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { LessonFile, LessonKind, LessonStart, LessonSummary } from '@shared/lesson';
import { detectKind, startOf } from '@shared/impara-start';
import { impara, imparaDraft, imparaPrefs, removeLesson, startLesson } from '../../lib/impara';
import { dragHasFiles, mergeFiles, readDropped, readPicked } from '../../lib/impara-files';
import { useTasks } from '../../store/tasks';
import { go } from '../../actions';
import { askConfirm, toast } from '../../store/ui';
import { locale, t } from '../../i18n';
import { Button, Kbd, MenuItem, MenuLabel, Popover } from '../ui';
import { IconBook, IconBranch, IconChevronDown, IconEdit, IconFile, IconFolder, IconLightbulb, IconPlus, IconSparkle, IconSpinner, IconTrash, IconX } from '../Icons';
import { ImparaReviewHome, SubjectChip } from './ImparaReviewHome';
import { ImparaOptions } from './ImparaOptions';
import { ImparaScoreBand } from './ImparaScore';

const KIND_ICON: Record<LessonKind, ReactNode> = { pr: <IconBranch size={12} />, topic: <IconLightbulb size={12} />, text: <IconEdit size={12} /> };

function when(at: number): string {
  const d = new Date(at), today = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(today) - day(d)) / 86_400_000);
  if (diff === 0) return t('impara.today');
  if (diff === 1) return t('impara.yesterday');
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}

/** A saved lesson's diagram, small (drawn once by the app's viewer). */
function Thumb({ code }: { code: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!code.trim()) return;
    let alive = true;
    import('../../lib/viz/mermaid').then(m => m.drawMermaid(code)).then(d => { if (alive) setSrc(d.src); }, () => {});
    return () => { alive = false; };
  }, [code]);
  return <div className="ip-thumb" aria-hidden="true">{src ? <img src={src} alt="" draggable={false} /> : <span className="ip-thumb-empty"><IconSparkle size={16} /></span>}</div>;
}

function stateChip(s: LessonSummary) {
  if (s.state === 'preparing') return <span className="ip-tag blue"><IconSpinner size={10} />{t('impara.state.preparing')}</span>;
  if (s.state === 'failed') return <span className="ip-tag red">{t('impara.state.failed')}</span>;
  if (s.done) return <span className="ip-tag green">{t('impara.state.done')}</span>;
  return s.seen ? <span className="ip-tag amber">{t('impara.state.half')}</span> : <span className="ip-tag">{t('impara.state.new')}</span>;
}

function LessonCard({ s, subjects }: { s: LessonSummary; subjects: readonly string[] }) {
  const pct = s.planned ? Math.round((s.seen / s.planned) * 100) : 0;
  return (
    <div className="ip-card" data-testid={`impara-lesson-${s.id}`}>
      <button type="button" className="ip-card-open" onClick={() => go({ page: 'impara', arg: s.id })} aria-label={s.title}>
        <Thumb code={s.diagram} />
        <span className="ip-card-in">
          <span className="ip-card-t">{s.title}</span>
          <span className="ip-card-meta">{KIND_ICON[s.kind]} {when(s.updatedAt)} · {t(`impara.depth.${s.depth}.short`)} {stateChip(s)}</span>
          <span className="ip-bar"><i style={{ width: `${s.done ? 100 : pct}%` }} className={s.done ? '' : 'half'} /></span>
        </span>
      </button>
      <span className="ip-card-subj"><SubjectChip lessonId={s.id} subject={s.subject} subjects={subjects} /></span>
      <button type="button" className="ip-card-del" onClick={() => askConfirm({ title: t('impara.removeTitle'), body: t('impara.removeBody', { title: s.title }), confirmLabel: t('impara.remove'), danger: true, onConfirm: () => void removeLesson(s.id) })}
        aria-label={t('impara.remove')} data-tip={t('impara.remove')} data-testid={`impara-del-${s.id}`}><IconTrash size={12} /></button>
    </div>
  );
}

/** The kind chip under the field: what the field will start, and a menu to pick another. */
function KindChip({ field, force, pasted, onForce }: { field: string; force: LessonKind | null; pasted: boolean; onForce: (k: LessonKind | null) => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const d = detectKind(field);
  const kind = force ?? (pasted ? 'text' : d.kind);
  const label = kind === 'pr'
    ? (d.pr ? t('impara.go.kindPr', { n: d.pr.number }) : t('impara.go.kindPrNone'))
    : kind === 'text' ? (pasted ? t('impara.go.kindPasted') : t('impara.go.kindText', { n: field.trim().length.toLocaleString(locale()) })) : t('impara.go.kindTopic');
  return (
    <>
      <button ref={anchor} type="button" className={`ip-kind ${kind}`} onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} data-testid="impara-kind" data-kind={kind} data-tip={t('impara.go.kindTip')}>
        {KIND_ICON[kind]}<span>{label}</span><span className="ip-kind-how">· {force ? t('impara.go.forced') : t('impara.go.detected')}</span><IconChevronDown size={11} />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} testid="impara-kind-pop" width={240} align="start">
        <MenuLabel>{t('impara.go.kindLabel')}</MenuLabel>
        <MenuItem checked={!force} onSelect={() => { onForce(null); setOpen(false); }} testid="impara-kind-auto">{t('impara.go.kindAuto')}</MenuItem>
        {(['topic', 'pr', 'text'] as LessonKind[]).map(k => <MenuItem key={k} checked={force === k} onSelect={() => { onForce(k); setOpen(false); }} testid={`impara-kind-${k}`}>{t(`impara.kindPick.${k}`)}</MenuItem>)}
      </Popover>
    </>
  );
}

/** «Aggiungi fonte»: a file or a whole folder, read in the page. */
function AddSource({ onAdd }: { onAdd: (files: LessonFile[]) => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null), dir = useRef<HTMLInputElement>(null);
  const read = async (list: FileList | null) => { if (list?.length) onAdd(await readPicked(list)); };
  return (
    <>
      <button ref={anchor} type="button" className="ip-addsrc" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} data-testid="impara-add-source"><IconPlus size={11} />{t('impara.go.addSource')}</button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} testid="impara-add-source-pop" width={220} align="start">
        <MenuItem onSelect={() => { setOpen(false); file.current?.click(); }} testid="impara-add-file">{t('impara.go.addFile')}</MenuItem>
        <MenuItem onSelect={() => { setOpen(false); dir.current?.click(); }} testid="impara-add-folder">{t('impara.go.addFolder')}</MenuItem>
      </Popover>
      <input ref={file} type="file" multiple hidden onChange={e => { void read(e.target.files); e.target.value = ''; }} data-testid="impara-file-input" />
      <input ref={dir} type="file" hidden {...{ webkitdirectory: '' }} onChange={e => { void read(e.target.files); e.target.value = ''; }} data-testid="impara-folder-input" />
    </>
  );
}

const nameOf = (p: string) => p.split('/').pop() || p;

export function ImparaStart() {
  const state = impara.use(s => s.state);
  const prefs = imparaPrefs.use(s => s);
  const prs = useTasks(s => s?.prs ?? []);
  const [field, setField] = useState('');
  const [force, setForce] = useState<LessonKind | null>(null);
  const [pasted, setPasted] = useState<{ text: string; from: string } | null>(null);
  const [files, setFiles] = useState<LessonFile[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [only, setOnly] = useState<string | null>(null);
  const [subject, setSubject] = useState<{ name: string; from: string } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // the field grows with what it holds, up to a limit (then it scrolls)
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [field]);
  // sent here by another page: the field opens filled in, the start button ready (one click starts it)
  const draft = imparaDraft.use(d => d);
  useEffect(() => {
    if (!draft) return;
    imparaDraft.set(() => null);
    setForce(null); setFiles([]);
    if (draft.kind === 'text' && draft.text) { setPasted({ text: draft.text, from: draft.from }); setField(draft.ask); }
    else { setPasted(null); setField([draft.ask, draft.kind === 'pr' ? draft.prUrl : ''].filter(Boolean).join('\n')); if (draft.kind === 'pr') setForce('pr'); }
    setSubject(draft.subject ? { name: draft.subject, from: draft.from } : null);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-testid="impara-start-btn"]')?.focus());
  }, [draft]);
  const lessons = state?.lessons ?? [];
  const subjects = [...new Set(lessons.map(l => l.subject))].sort((a, b) => a.localeCompare(b));
  const shown = only && subjects.includes(only) ? lessons.filter(l => l.subject === only) : lessons;
  const byPr = new Map(lessons.filter(l => l.pr).map(l => [l.pr!.url, l]));
  const can = state?.canTeach !== false;
  const req = startOf(field, force, { ...(pasted ? { pasted: pasted.text } : {}), hasFiles: files.length > 0, filesAsk: t('impara.go.filesAsk') });
  const ready = !!req;

  const begin = async (over: Partial<LessonStart> | null = null) => {
    const base = over ?? req;
    if (busy || !base) return;
    setBusy(true);
    const l = await startLesson({ ...base, depth: prefs.depth, level: prefs.level, ...(prefs.teacher ? { teacher: prefs.teacher } : {}), ...(subject ? { subject: subject.name } : {}),
      ...(!over && files.length ? { files } : {}) } as LessonStart);
    setBusy(false);
    if (l) go({ page: 'impara', arg: l.id });
  };
  const add = (more: LessonFile[]) => {
    if (!more.length) { toast(t('impara.go.noText'), 'warn'); return; }
    setFiles(f => mergeFiles(f, more));
    input.current?.focus();
  };
  const onDragOver = (e: DragEvent) => { if (!dragHasFiles(e.dataTransfer)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDrag(true); };
  const onDrop = (e: DragEvent) => { if (!dragHasFiles(e.dataTransfer)) return; e.preventDefault(); setDrag(false); void readDropped(e.dataTransfer).then(add); };

  return (
    <div className="ip-start" data-testid="impara-start">
      {state?.review?.score && <ImparaScoreBand score={state.review.score} />}
      <section className="ip-hero">
        <div className="ip-kicker">{t('impara.kicker')}</div>
        <h1>{t('impara.hero')}</h1>
        <p className="ip-lead">{t('impara.lead')}</p>
        <form className="ip-go" onSubmit={e => { e.preventDefault(); if (ready && can) void begin(); }}>
          <div className={`ip-field ${drag ? 'drag' : ''}`} onDragOver={onDragOver} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false); }} onDrop={onDrop} data-testid="impara-field">
            <textarea ref={input} value={field} onChange={e => setField(e.target.value)} rows={2} maxLength={200_000} data-testid="impara-ask-what"
              placeholder={t(pasted ? 'impara.askText' : 'impara.go.placeholder')} aria-label={t('impara.askLabel')}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (ready && can) void begin(); } }} />
            <div className="ip-field-foot">
              <KindChip field={field} force={force} pasted={!!pasted} onForce={setForce} />
              {pasted && <span className="ip-src-chip" data-testid="impara-pasted"><IconEdit size={11} />{t('impara.go.pastedFrom', { from: pasted.from })}<button type="button" onClick={() => setPasted(null)} aria-label={t('impara.go.remove')}><IconX size={10} /></button></span>}
              {files.slice(0, 6).map(f => (
                <span key={f.name} className="ip-src-chip" data-tip={f.name} data-testid="impara-source-chip">
                  {f.name.includes('/') ? <IconFolder size={11} /> : <IconFile size={11} />}{nameOf(f.name)}
                  <button type="button" onClick={() => setFiles(x => x.filter(y => y.name !== f.name))} aria-label={t('impara.go.remove')}><IconX size={10} /></button>
                </span>
              ))}
              {files.length > 6 && <span className="ip-src-chip more" data-tip={files.slice(6).map(f => f.name).join('\n')}>+{files.length - 6}</span>}
              {files.length > 1 && <button type="button" className="ip-link ip-src-clear" onClick={() => setFiles([])}>{t('impara.go.clearSources')}</button>}
              <AddSource onAdd={add} />
            </div>
            {drag && <div className="ip-drop" aria-hidden="true"><IconFolder size={18} />{t('impara.go.drop')}</div>}
          </div>
          {subject && (
            <div className="ip-from" data-testid="impara-from">
              <span className="ip-muted">{t('impara.from', { from: subject.from })}</span>
              <span className="ip-subject on">{subject.name}<button type="button" onClick={() => setSubject(null)} aria-label={t('impara.fromClear')} data-tip={t('impara.fromClear')}>×</button></span>
            </div>
          )}
          <div className="ip-go-row">
            {state?.teachers?.length ? <ImparaOptions teachers={state.teachers} /> : <span />}
            <span className="sp" />
            <Button variant="primary" type="submit" disabled={!ready || !can || busy} testid="impara-start-btn" className="ip-go-btn">
              {busy ? <IconSpinner size={12} /> : null}{t('impara.start')} <Kbd>Ctrl ↵</Kbd>
            </Button>
          </div>
        </form>
        {!can && <p className="ip-warn" data-testid="impara-cannot">{state?.why}</p>}
      </section>

      {state?.review && <ImparaReviewHome review={state.review} />}

      <div className="ip-cols">
        {prs.length > 0 && (
          <section className="ip-col-prs">
            <h3>{t('impara.yourPrs')}</h3>
            <div className="ip-prs" data-testid="impara-prs">
              {prs.slice(0, 8).map(p => {
                const l = byPr.get(p.url);
                return (
                  <div key={p.url} className="ip-pr">
                    <span className="ip-pr-n">!{p.id}</span>
                    <span className="ip-pr-in"><b>{p.title}</b><span className="ip-muted">{p.repo} · {p.source ?? '?'} → {p.target}</span></span>
                    {l ? stateChip(l) : <span className="ip-tag amber">{t('impara.state.notStudied')}</span>}
                    <Button size="s" disabled={!can || busy} onClick={() => (l ? go({ page: 'impara', arg: l.id }) : void begin({ kind: 'pr', prUrl: p.url, ask: '' }))} testid={`impara-pr-${p.id}`}>{l ? t('impara.resume') : t('impara.learn')}</Button>
                  </div>
                );
              })}
            </div>
          </section>
        )}
        <section className="ip-col-lessons">
          <h3>{t('impara.yourLessons')} <span className="ip-muted">· {t('impara.savedHint')}</span></h3>
          {subjects.length > 1 && (
            <div className="ip-chips ip-filter" role="radiogroup" aria-label={t('impara.rv.filter')} data-testid="impara-filter">
              <button type="button" role="radio" aria-checked={!only} className={`ip-chip ${!only ? 'on' : ''}`} onClick={() => setOnly(null)}>{t('impara.rv.all')}</button>
              {subjects.map(n => <button key={n} type="button" role="radio" aria-checked={only === n} className={`ip-chip ${only === n ? 'on' : ''}`} onClick={() => setOnly(n)} data-testid="impara-filter-subject">{n}</button>)}
            </div>
          )}
          {lessons.length
            ? <div className="ip-grid" data-testid="impara-lessons">{shown.map(s => <LessonCard key={s.id} s={s} subjects={subjects} />)}</div>
            : <div className="ip-empty" data-testid="impara-empty"><IconBook size={18} /><p>{t('impara.empty')}</p></div>}
        </section>
      </div>
    </div>
  );
}
