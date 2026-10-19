// The «Guida» page: the app's core concepts as a responsive grid of cards (content: src/shared/concept-guide.ts). A
// card shows its own glyph, the title, one plain summary line and what it holds (points, diagram, badges); clicking it
// («Come funziona») opens a reading panel that slides in over the grid with the numbered points, the diagram, an
// everyday analogy, the technical details with the source files, what is in an open pull request («in arrivo») and what
// is still a target. Esc, the close button or a click outside closes it and gives the focus back to the card.
// «Discuti» puts the card, as a ready message, in the Orchestrator's input: it never opens a work chat. The prominent
// card («Ogni compito passa da un ruolo») sits on top as a wide hero with its
// diagram always visible. A filter narrows the cards by any text of theirs. Mounted by App.tsx PageFrame for the page
// 'guida' (left rail, Ctrl+K, G E). Hooks in GuidePage and Card stay useId/useMemo/useState: the unit test
// test/unit/concept-discuss-click.test.ts renders them without a DOM.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CONCEPTS, orchestratorText, textOf, type ConceptCard, type ConceptDiagram, type GuideLang } from '@shared/concept-guide';
import { lang, t } from '../i18n';
import { toast } from '../store/ui';
import { brainBridge } from '../actions';
import { IconChevronRight } from './Icons';
import '../styles/guide.css';

/** «Discuti»: the card goes to the Orchestrator's input as a ready message; no work chat is opened. */
function discuss(card: ConceptCard, l: GuideLang): void {
  if (brainBridge.draftToOrchestrator(orchestratorText(card, l), () => {})) toast(t('guide.toOrchestrator'), 'ok');
  else toast(t('guide.noOrchestrator'), 'warn');
}

/** A small line glyph per concept (24×24, stroke = currentColor): the card's picture, drawn here, no package. */
const GLYPHS: Record<string, ReactNode> = {
  'every-task-agent': <><circle cx="12" cy="12" r="3" /><circle cx="5" cy="5" r="2" /><circle cx="19" cy="5" r="2" /><circle cx="12" cy="20" r="2" /><path d="M6.5 6.5l3.4 3.4M17.5 6.5l-3.4 3.4M12 15v3" /></>,
  'mcp-servers': <><rect x="3" y="4" width="7" height="7" rx="2" /><rect x="14" y="4" width="7" height="7" rx="2" /><rect x="8.5" y="14" width="7" height="7" rx="2" /><path d="M6.5 11v1.5h11V11M12 12.5V14" /></>,
  agents: <><rect x="5" y="8" width="14" height="11" rx="3" /><path d="M12 4v4M3 13v2M21 13v2" /><circle cx="9.5" cy="13.5" r="1" /><circle cx="14.5" cy="13.5" r="1" /></>,
  skills: <><path d="M7 4h10v16l-5-3-5 3z" /><path d="M10 9h4M10 12h4" /></>,
  orchestrator: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="5.5" r="2.5" /><circle cx="18" cy="18.5" r="2.5" /><path d="M8.3 10.8l7.4-4M8.3 13.2l7.4 4" /></>,
  runs: <><circle cx="12" cy="12" r="9" /><path d="M10 8.5l5 3.5-5 3.5z" /></>,
  metrics: <><path d="M4 20h16" /><path d="M7 17v-6M12 17V6M17 17v-9" /></>,
  'errors-rules': <><path d="M12 3.5l9 16H3z" /><path d="M12 10v4M12 16.8v.2" /></>,
  milestones: <><path d="M6 21V4" /><path d="M6 4h11l-2.5 4L17 12H6" /></>,
  classifiers: <><path d="M4 5h16l-6 7.5V18l-4 2v-7.5z" /></>,
  permissions: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3M12 15v2" /></>,
  questions: <><path d="M5 4.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3.5v-3.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" /><path d="M10 9a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2M12 14v.2" /></>,
  grindhouse: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  dashboard: <><path d="M3.5 17a8.5 8.5 0 0 1 17 0" /><path d="M12 17l4.5-5.5" /><circle cx="12" cy="17" r="1.3" /></>,
  setup: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 12l3 3 5-6" /></>,
  brain: <><path d="M12 5.5a3 3 0 0 0-5.5-1.2A3 3 0 0 0 4 8.5a3.2 3.2 0 0 0 0 5.5A3 3 0 0 0 7 19a3 3 0 0 0 5 .5z" /><path d="M12 5.5a3 3 0 0 1 5.5-1.2A3 3 0 0 1 20 8.5a3.2 3.2 0 0 1 0 5.5A3 3 0 0 1 17 19a3 3 0 0 1-5 .5" /><path d="M12 5.5v14" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.3-4.3" /></>,
  'file-viewer': <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h4" /></>,
  routing: <><path d="M12 21v-7.5M12 13.5L6.5 8M12 13.5L17.5 8" /><path d="M5 11.5V6.5h5M19 11.5V6.5h-5" /></>,
  costs: <><circle cx="12" cy="12" r="9" /><path d="M14.6 9.3c-.4-.9-1.4-1.5-2.6-1.5-1.5 0-2.6.8-2.6 2s1 1.7 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.2 0-2.2-.6-2.6-1.5M12 6.3v1.5M12 16.2v1.5" /></>,
  updates: <><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></>,
};
const FALLBACK_GLYPH = <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.8v.2" /></>;

/** The accent of each card, by position: token colors only, so both themes stay in contrast. */
const ACCENTS = ['--blue', '--violet', '--pair-0', '--green', '--amber', '--pair-4', '--pair-1', '--pair-6'];
const accentOf = (i: number): CSSProperties => ({ '--guide-accent': `var(${ACCENTS[i % ACCENTS.length]})` }) as CSSProperties;

function Glyph({ id, size = 20 }: { id: string; size?: number }) {
  return (
    <span className="guide-glyph" aria-hidden="true">
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        {GLYPHS[id] ?? FALLBACK_GLYPH}
      </svg>
    </span>
  );
}

function Diagram({ d, title, l }: { d: ConceptDiagram; title: string; l: GuideLang }) {
  return (
    <figure className={`guide-diagram guide-diagram-${d.kind}`} data-testid="guide-diagram">
      <ol aria-label={t('guide.diagram', { title })}>
        {d.steps.map((s, i) => <li key={i}><span className="guide-step-n" aria-hidden="true">{i + 1}</span><span>{textOf(s, l)}</span></li>)}
      </ol>
      {d.kind === 'cycle' && <figcaption className="guide-diagram-back" aria-hidden="true"><span>↺</span> {textOf(d.steps[0]!, l)} · {t('guide.back')}</figcaption>}
    </figure>
  );
}

function Badges({ card }: { card: ConceptCard }) {
  if (!card.coming?.length && !card.target?.length) return null;
  return (
    <span className="guide-badges">
      {card.coming?.map(x => <span key={x.pr} className="guide-badge guide-badge-coming" data-testid="guide-coming-badge">{t('guide.comingBadge', { pr: x.pr })}</span>)}
      {card.target?.length ? <span className="guide-badge" data-testid="guide-target-badge">{t('guide.targetBadge')}</span> : null}
    </span>
  );
}

function DiscussButton({ card, l, compact }: { card: ConceptCard; l: GuideLang; compact?: boolean }) {
  const title = textOf(card.title, l);
  return (
    <button type="button" className={`btn btn-ghost btn-s guide-discuss${compact ? ' guide-discuss-compact' : ''}`} onClick={() => discuss(card, l)}
      data-testid={compact ? `guide-panel-discuss-${card.id}` : `guide-discuss-${card.id}`} data-tip={t('guide.discussTip')} aria-label={`${t('guide.discuss')}: ${title}`}>
      <span aria-hidden="true">↗</span> {t('guide.discuss')}
    </button>
  );
}

function Card({ card, index, l, open, panel, onToggle }: { card: ConceptCard; index: number; l: GuideLang; open: boolean; panel: string; onToggle: () => void }) {
  const L = (x: Parameters<typeof textOf>[0]) => textOf(x, l);
  const title = L(card.title);
  const heading = useId();
  return (
    <article className={`guide-card${card.prominent ? ' guide-prominent' : ''}${open ? ' open' : ''}`} style={accentOf(index)}
      data-testid={`guide-card-${card.id}`} aria-labelledby={heading}>
      <div className="guide-card-top">
        <Glyph id={card.id} size={card.prominent ? 24 : 20} />
        <Badges card={card} />
      </div>
      {card.prominent && <span className="guide-hero-eyebrow">{t('guide.startHere')}</span>}
      <h3 id={heading}>{title}</h3>
      <p className="guide-summary">{L(card.summary)}</p>
      {card.prominent && card.diagram && <Diagram d={card.diagram} title={title} l={l} />}
      <span className="guide-meta">{t('guide.pointsCount', { count: card.points.length })}{!card.prominent && card.diagram ? ` · ${t('guide.withDiagram')}` : ''}</span>
      <div className="guide-card-foot">
        <button type="button" className="guide-toggle" aria-expanded={open} aria-controls={panel} onClick={onToggle} data-testid={`guide-toggle-${card.id}`}>
          {t('guide.howItWorks')} <IconChevronRight size={13} />
        </button>
        <span className="sp" />
        <DiscussButton card={card} l={l} />
      </div>
    </article>
  );
}

/** The reading panel of the opened card: slides in over the grid, Esc or a click outside closes it. */
function DetailPanel({ id, card, index, l, onClose }: { id: string; card: ConceptCard; index: number; l: GuideLang; onClose: () => void }) {
  const L = (x: Parameters<typeof textOf>[0]) => textOf(x, l);
  const title = L(card.title);
  const heading = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    scroller.current?.scrollTo({ top: 0 });
  }, [card.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <>
      <button type="button" className="guide-backdrop" aria-label={t('guide.close')} tabIndex={-1} onClick={onClose} data-testid="guide-backdrop" />
      <aside className="guide-panel" id={id} style={accentOf(index)} role="dialog" aria-modal="false" aria-labelledby={`${id}-h`} data-testid="guide-panel">
        <header className="guide-panel-head">
          <Glyph id={card.id} size={22} />
          <div className="guide-panel-title">
            <h2 id={`${id}-h`} ref={heading} tabIndex={-1}>{title}</h2>
            <Badges card={card} />
          </div>
          <button type="button" className="guide-close" onClick={onClose} aria-label={t('guide.close')} data-testid="guide-close" data-tip={t('guide.close')}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </header>
        <div className="guide-panel-scroll" ref={scroller}>
          <p className="guide-panel-summary">{L(card.summary)}</p>
          <div className="guide-body" data-testid={`guide-body-${card.id}`}>
            <section className="guide-sec" aria-label={t('guide.howItWorks')}>
              <h4>{t('guide.howItWorks')}</h4>
              <ol className="guide-points">{card.points.map((p, i) => <li key={i}>{L(p)}</li>)}</ol>
            </section>
            {card.diagram && <section className="guide-sec"><Diagram d={card.diagram} title={title} l={l} /></section>}
            <div className="guide-analogy"><strong>{t('guide.analogy')}</strong><p>{L(card.analogy)}</p></div>
            {card.coming?.length ? (
              <section className="guide-coming" data-testid="guide-coming">
                <h4><span aria-hidden="true">◷</span> {t('guide.coming')}</h4>
                <ul>{card.coming.map(x => <li key={x.pr}><strong>PR #{x.pr}</strong> · {L(x.text)}</li>)}</ul>
              </section>
            ) : null}
            {card.target?.length ? (
              <section className="guide-target" data-testid="guide-target">
                <h4><span aria-hidden="true">⚑</span> {t('guide.target')}</h4>
                <ul>{card.target.map((x, i) => <li key={i}>{L(x)}</li>)}</ul>
              </section>
            ) : null}
            <section className="guide-tech" aria-label={t('guide.technical')}>
              <h4>{t('guide.technical')}</h4>
              <dl>{card.tech.map((x, i) => <div key={i}><dt>{L(x.label)}</dt><dd>{L(x.text)}</dd></div>)}</dl>
              <h5>{t('guide.sources')}</h5>
              <ul className="guide-sources">{card.sources.map(s => <li key={s}><code>{s}</code></li>)}</ul>
            </section>
          </div>
        </div>
        <footer className="guide-panel-foot">
          <DiscussButton card={card} l={l} compact />
        </footer>
      </aside>
    </>
  );
}

/** The card's every text in one language, lower case, for the filter. */
const haystack = (c: ConceptCard, l: GuideLang): string =>
  [c.title, c.summary, c.analogy, ...c.points, ...(c.target ?? []), ...c.tech.flatMap(x => [x.label, x.text])].map(x => textOf(x, l)).join(' ').toLowerCase();

/** Back to the card's own button when the panel closes, so keyboard users keep their place. */
function refocus(id: string): void {
  if (typeof document === 'undefined') return;
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="guide-toggle-${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
}

export function GuidePage() {
  const l: GuideLang = lang();
  const panel = useId();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? CONCEPTS.filter(c => { const h = haystack(c, l); return words.every(w => h.includes(w)); }) : CONCEPTS;
  }, [q, l]);
  const close = () => { if (open) refocus(open); setOpen(null); };
  const toggle = (id: string) => { if (open === id) close(); else setOpen(id); };
  const opened = open ? CONCEPTS.findIndex(c => c.id === open) : -1;
  return (
    <div className="guide" role="region" aria-label={t('guide.title')} data-testid="guide-page">
      <div className="guide-scroll">
        <header className="guide-header">
          <div>
            <span className="guide-eyebrow">{t('guide.eyebrow')}</span>
            <h1>{t('guide.title')}</h1>
            <p>{t('guide.lead')}</p>
          </div>
          <label className="guide-filter">
            <span className="sr-only">{t('guide.filter')}</span>
            <span className="guide-filter-box">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.3-4.3" /></svg>
              <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('guide.filterPlaceholder')} data-testid="guide-filter" />
            </span>
            <small>{t('guide.count', { count: shown.length })}</small>
          </label>
        </header>
        {shown.length === 0
          ? <p className="guide-none" role="status">{t('guide.none')}</p>
          : <div className="guide-grid">{shown.map(c => <Card key={c.id} card={c} index={CONCEPTS.indexOf(c)} l={l} open={open === c.id} panel={panel} onToggle={() => toggle(c.id)} />)}</div>}
      </div>
      {opened >= 0 && <DetailPanel id={panel} card={CONCEPTS[opened]!} index={opened} l={l} onClose={close} />}
    </div>
  );
}
