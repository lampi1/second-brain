// The start of Impara (ADR 0181; mockup /mnt/project-files/ui-review/impara/1-pagina-impara.png): «Cosa vuoi capire
// davvero, oggi?» with what to learn (a PR: one of the Task page's, or a GitHub link; a technical topic; a pasted text),
// how much the user knows already (the lesson adapts from the first piece), how deep, and the two voices; under it the
// user's PRs with how far each was studied, and the saved lessons (their diagram as a thumbnail, how far they got),
// each reopening where it was left. Used by ImparaPage.tsx.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LESSON_DEPTHS, LESSON_LEVELS, type LessonKind, type LessonStart, type LessonSummary } from '@shared/lesson';
import { impara, imparaPrefs, removeLesson, setImparaPrefs, startLesson } from '../../lib/impara';
import { useTasks } from '../../store/tasks';
import { go } from '../../actions';
import { askConfirm } from '../../store/ui';
import { locale, t } from '../../i18n';
import { Button } from '../ui';
import { IconArrowRight, IconBook, IconBranch, IconEdit, IconLightbulb, IconSparkle, IconSpinner, IconTrash } from '../Icons';
import { ImparaSwitch } from './ImparaSwitch';

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

function LessonCard({ s }: { s: LessonSummary }) {
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
      <button type="button" className="ip-card-del" onClick={() => askConfirm({ title: t('impara.removeTitle'), body: t('impara.removeBody', { title: s.title }), confirmLabel: t('impara.remove'), danger: true, onConfirm: () => void removeLesson(s.id) })}
        aria-label={t('impara.remove')} data-tip={t('impara.remove')} data-testid={`impara-del-${s.id}`}><IconTrash size={12} /></button>
    </div>
  );
}

export function ImparaStart() {
  const state = impara.use(s => s.state);
  const prefs = imparaPrefs.use(s => s);
  const prs = useTasks(s => s?.prs ?? []);
  const [kind, setKind] = useState<LessonKind>('pr');
  const [ask, setAsk] = useState('');
  const [prUrl, setPrUrl] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const lessons = state?.lessons ?? [];
  const byPr = new Map(lessons.filter(l => l.pr).map(l => [l.pr!.url, l]));
  const can = state?.canTeach !== false;
  const ready = kind === 'topic' ? !!ask.trim() : kind === 'pr' ? !!prUrl.trim() : !!text.trim();

  const begin = async (req: Partial<LessonStart> = {}) => {
    if (busy) return;
    setBusy(true);
    const l = await startLesson({ kind, ask: ask.trim(), depth: prefs.depth, level: prefs.level, ...(kind === 'pr' ? { prUrl: prUrl.trim() } : {}), ...(kind === 'text' ? { text } : {}), ...req } as LessonStart);
    setBusy(false);
    if (l) go({ page: 'impara', arg: l.id });
  };

  return (
    <div className="ip-start" data-testid="impara-start">
      <section className="ip-hero">
        <div className="ip-kicker">{t('impara.kicker')}</div>
        <h1>{t('impara.hero')}</h1>
        <p className="ip-lead">{t('impara.lead')}</p>
        <form className="ip-ask" onSubmit={e => { e.preventDefault(); if (ready && can) void begin(); }}>
          <IconSparkle size={14} />
          <input ref={input} value={ask} onChange={e => setAsk(e.target.value)} maxLength={600} data-testid="impara-ask-what"
            placeholder={t(kind === 'pr' ? 'impara.askPr' : kind === 'text' ? 'impara.askText' : 'impara.askTopic')} aria-label={t('impara.askLabel')} />
          <Button variant="primary" type="submit" disabled={!ready || !can || busy} testid="impara-start-btn">{busy ? <IconSpinner size={12} /> : null}{t('impara.start')} <IconArrowRight size={13} /></Button>
        </form>
        <div className="ip-chips" role="radiogroup" aria-label={t('impara.whatLabel')}>
          {(['pr', 'topic', 'text'] as LessonKind[]).map(k => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={`ip-chip ${kind === k ? 'on' : ''}`} onClick={() => { setKind(k); input.current?.focus(); }} data-testid={`impara-kind-${k}`}>{KIND_ICON[k]}{t(`impara.kindPick.${k}`)}</button>
          ))}
        </div>
        {kind === 'pr' && (
          <div className="ip-source">
            <input value={prUrl} onChange={e => setPrUrl(e.target.value)} placeholder={t('impara.prUrl')} maxLength={500} data-testid="impara-pr-url" aria-label={t('impara.prUrl')} />
            {prs.length > 0 && <span className="ip-muted">{t('impara.orPick')}</span>}
          </div>
        )}
        {kind === 'text' && <textarea className="ip-source-text" value={text} onChange={e => setText(e.target.value)} rows={5} placeholder={t('impara.pastePlaceholder')} data-testid="impara-text-input" aria-label={t('impara.pastePlaceholder')} />}
        <div className="ip-opts">
          <ImparaSwitch on={prefs.voice} onChange={on => setImparaPrefs({ voice: on })} label={t('impara.voiceApp')} testid="impara-start-voice" />
          <ImparaSwitch on={prefs.mic} onChange={on => setImparaPrefs({ mic: on })} label={t('impara.voiceMe')} testid="impara-start-mic" />
          <span className="sp" />
          <span className="ip-seg" role="radiogroup" aria-label={t('impara.levelLabel')}>
            {LESSON_LEVELS.map(l => <button key={l} type="button" role="radio" aria-checked={prefs.level === l} className={prefs.level === l ? 'on' : ''} onClick={() => setImparaPrefs({ level: l })} data-testid={`impara-level-${l}`}>{t(`impara.level.${l}`)}</button>)}
          </span>
          <span className="ip-seg" role="radiogroup" aria-label={t('impara.depthLabel')}>
            {LESSON_DEPTHS.map(d => <button key={d} type="button" role="radio" aria-checked={prefs.depth === d} className={prefs.depth === d ? 'on' : ''} onClick={() => setImparaPrefs({ depth: d })} data-testid={`impara-depth-${d}`}>{t(`impara.depth.${d}.label`)}</button>)}
          </span>
        </div>
        {!can && <p className="ip-warn" data-testid="impara-cannot">{state?.why}</p>}
      </section>

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
          {lessons.length
            ? <div className="ip-grid" data-testid="impara-lessons">{lessons.map(s => <LessonCard key={s.id} s={s} />)}</div>
            : <div className="ip-empty" data-testid="impara-empty"><IconBook size={18} /><p>{t('impara.empty')}</p></div>}
        </section>
      </div>
    </div>
  );
}
