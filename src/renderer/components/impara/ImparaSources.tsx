// «Fonti» of a lesson (ADR 0188; owner, 2026-10-29: «che siano visibili da qualche parte le fonti che ha trovato, sia
// file del mio pc che link web»): every source the research found and the verification kept, in one drawer over the
// lesson, grouped by where it came from: the standards and references searched for the public topics of the user's
// files (ADR 0206: each fact says «trovato perché il tuo file usa …», the topic, never the file), the web pages (opened
// in the user's browser), the files of this PC (opened in the app's read-only viewer at the cited line), the model's own
// knowledge, and the lesson's material (the PR, the pasted text). Each source lists its facts with their check and the pieces that use them (a click goes there).
// `SourceChips` is the short list the Preparing screen shows once the facts are checked. Used by ImparaPlayer.tsx and
// ImparaPrep.tsx; styles impara.css (.ip-srcs*).
import { useEffect } from 'react';
import { stepKey, type Lesson, type LessonFact } from '@shared/lesson';
import { openFileViewer } from '../../actions';
import { moveTo } from '../../lib/impara';
import { t } from '../../i18n';
import { Button } from '../ui';
import { IconBook, IconExternal, IconFile, IconGlobe, IconLightbulb, IconX } from '../Icons';

/** A file reference as the viewer opens it: `path:line` (a range keeps its first line). */
export const fileOf = (ref: string) => {
  const m = /^(.*?)(?::(\d+)(?:[-:]\d+)?)?$/.exec(ref.trim());
  return { path: m?.[1] || ref.trim(), line: m?.[2] ? Number(m[2]) : null };
};
export const openFact = (ref: string) => { const f = fileOf(ref); openFileViewer(f.line ? `${f.path}:${f.line}` : f.path); };
export const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const pathOf = (u: string) => { try { const x = new URL(u); return `${x.pathname}${x.search}`.replace(/\/$/, ''); } catch { return ''; } };
const nameOf = (p: string) => p.split(/[\\/]/).pop() || p;
const dirOf = (p: string) => p.slice(0, Math.max(0, p.length - nameOf(p).length)).replace(/[\\/]$/, '');

type Group = { key: string; facts: LessonFact[] };
function groups(facts: readonly LessonFact[], keyOf: (f: LessonFact) => string): Group[] {
  const by = new Map<string, LessonFact[]>();
  for (const f of facts) { const k = keyOf(f); by.set(k, [...(by.get(k) ?? []), f]); }
  return [...by].map(([key, list]) => ({ key, facts: list }));
}

/** Which main pieces cite each fact: their numbers, from 1. */
function usage(lesson: Lesson): Map<string, number[]> {
  const out = new Map<string, number[]>();
  lesson.steps.filter(s => !s.extra).forEach((s, i) => { for (const id of s.cites ?? []) out.set(id, [...(out.get(id) ?? []), i + 1]); });
  return out;
}

function Fact({ f, lesson, used, onGo }: { f: LessonFact; lesson: Lesson; used: number[]; onGo: () => void }) {
  const main = lesson.steps.filter(s => !s.extra);
  return (
    <li className={f.check} data-testid="impara-src-fact">
      <span className={`ip-tag ${f.check === 'ok' ? 'green' : f.check === 'fixed' ? 'blue' : 'amber'}`}>{t(`impara.fact.${f.check}`)}</span>
      <span className="ip-fact-c">{f.claim}</span>
      {f.quote && <q className="ip-fact-q">{f.quote}</q>}
      {f.topic && <span className="ip-fact-why" data-testid="impara-src-why">{t('impara.src.why', { topic: f.topic })}</span>}
      {f.from === 'file' && fileOf(f.ref).line && <button type="button" className="ip-srcs-line" onClick={() => openFact(f.ref)} data-testid="impara-src-line">{t('impara.src.line', { n: fileOf(f.ref).line! })}</button>}
      {used.length > 0 && (
        <span className="ip-srcs-used">{t('impara.src.usedIn')} {used.map(n => (
          <button key={n} type="button" className="ip-srcs-piece" onClick={() => { const s = main[n - 1]; if (s) { void moveTo(lesson.id, stepKey(s.id)); onGo(); } }} data-testid="impara-src-used">{n}</button>
        ))}</span>
      )}
    </li>
  );
}

export function ImparaSources({ lesson, onClose }: { lesson: Lesson; onClose: () => void }) {
  const facts = lesson.facts ?? [];
  const used = usage(lesson);
  const refs = groups(facts.filter(f => f.from === 'web' && f.topic), f => f.ref);
  const web = groups(facts.filter(f => f.from === 'web' && !f.topic), f => f.ref);
  const files = groups(facts.filter(f => f.from === 'file'), f => fileOf(f.ref).path);
  const known = facts.filter(f => f.from === 'known');
  // Esc closes the drawer before anything else (the full screen, the page)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.vw-layer, .modal-backdrop, .backdrop, .qwin')) return;
      e.preventDefault(); e.stopPropagation(); onClose();
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onClose]);
  const list = (g: Group) => <ul className="ip-facts">{g.facts.map(f => <Fact key={f.id} f={f} lesson={lesson} used={used.get(f.id) ?? []} onGo={onClose} />)}</ul>;
  return (
    <>
      <div className="ip-srcs-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="ip-srcs" role="dialog" aria-label={t('impara.src.title')} data-testid="impara-sources">
        <header className="ip-srcs-head">
          <div>
            <h3>{t('impara.src.title')}</h3>
            <p className="ip-muted">{t('impara.src.summary', { web: web.length + refs.length, files: files.length, facts: facts.length })}</p>
          </div>
          <Button variant="ghost" size="s" onClick={onClose} testid="impara-sources-close" aria-label={t('impara.src.close')}><IconX size={13} /></Button>
        </header>
        <div className="ip-srcs-body">
          {!facts.length && <p className="ip-muted" data-testid="impara-sources-none">{t('impara.src.none')}</p>}
          {refs.length > 0 && <section data-testid="impara-src-refs">
            <div className="ip-label"><IconBook size={11} /> {t('impara.src.refs')}</div>
            {refs.map(g => (
              <div key={g.key} className="ip-srcs-item" data-testid="impara-src-ref">
                <a href={g.key} target="_blank" rel="noreferrer" className="ip-srcs-link" data-tip={g.key}>
                  <b>{hostOf(g.key)}</b><span>{pathOf(g.key)}</span><IconExternal size={11} />
                </a>
                {list(g)}
              </div>
            ))}
          </section>}
          {web.length > 0 && <section>
            <div className="ip-label"><IconGlobe size={11} /> {t('impara.src.web')}</div>
            {web.map(g => (
              <div key={g.key} className="ip-srcs-item" data-testid="impara-src-web">
                <a href={g.key} target="_blank" rel="noreferrer" className="ip-srcs-link" data-tip={g.key}>
                  <b>{hostOf(g.key)}</b><span>{pathOf(g.key)}</span><IconExternal size={11} />
                </a>
                {list(g)}
              </div>
            ))}
          </section>}
          {files.length > 0 && <section>
            <div className="ip-label"><IconFile size={11} /> {t('impara.src.files')}</div>
            {files.map(g => (
              <div key={g.key} className="ip-srcs-item" data-testid="impara-src-file">
                <button type="button" className="ip-srcs-link" onClick={() => openFact(g.facts.find(f => fileOf(f.ref).line)?.ref ?? g.key)} data-tip={g.key} data-testid="impara-src-file-open">
                  <b>{nameOf(g.key)}</b><span>{dirOf(g.key)}</span><IconExternal size={11} />
                </button>
                {list(g)}
              </div>
            ))}
          </section>}
          {known.length > 0 && <section>
            <div className="ip-label"><IconLightbulb size={11} /> {t('impara.src.known')}</div>
            <div className="ip-srcs-item">{list({ key: 'known', facts: known })}</div>
          </section>}
          {(lesson.pr || lesson.sources.length > 0) && <section>
            <div className="ip-label">{t('impara.src.material')}</div>
            <div className="ip-srcs-item ip-srcs-material">
              {lesson.pr && <a href={lesson.pr.url} target="_blank" rel="noreferrer" className="ip-srcs-link"><b>{lesson.pr.repo} #{lesson.pr.number}</b><span>{lesson.pr.url}</span><IconExternal size={11} /></a>}
              {lesson.sources.map(s => <div key={s} className="ip-muted">{s}</div>)}
            </div>
          </section>}
        </div>
      </aside>
    </>
  );
}

/** The sources found, short: one chip per page or file, on the Preparing screen once the facts are checked; the
 *  standards and references (ADR 0206) on a line of their own, each saying which topic it was searched for. */
export function SourceChips({ facts }: { facts: readonly LessonFact[] }) {
  const seen = new Map<string, LessonFact>(), refs = new Map<string, LessonFact>();
  for (const f of facts) {
    if (f.from === 'known') continue;
    const into = f.topic ? refs : seen, k = f.from === 'web' ? f.ref : fileOf(f.ref).path;
    if (!into.has(k)) into.set(k, f);
  }
  if (!seen.size && !refs.size) return null;
  const row = (label: string, map: Map<string, LessonFact>, testid: string) => {
    const all = [...map];
    return (
      <div className="ip-prep-srcs" data-testid={testid}>
        <span className="ip-muted">{label}</span>
        {all.slice(0, 10).map(([k, f]) => (
          <span key={k} className={`ip-cite ${f.check}`} data-tip={f.topic ? `${t('impara.src.why', { topic: f.topic })} · ${k}` : k}>
            {f.topic ? <IconBook size={10} /> : f.from === 'web' ? <IconGlobe size={10} /> : <IconFile size={10} />}{f.from === 'web' ? hostOf(k) : nameOf(k)}
          </span>
        ))}
        {all.length > 10 && <span className="ip-muted">+{all.length - 10}</span>}
      </div>
    );
  };
  return (
    <>
      {seen.size > 0 && row(t('impara.src.found'), seen, 'impara-prep-sources')}
      {refs.size > 0 && row(t('impara.src.refs'), refs, 'impara-prep-refs')}
    </>
  );
}
