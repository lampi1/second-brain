// Memoria → Proposte (ADR 0123): every item the app puts in front of the user, one card at a time, newest first. Drag
// the top card (pointer events: right = approve or keep, left = reject or undo, with its stamp while dragging, a threshold
// and a spring back), or the round buttons under it, or ← / →; Z or Ctrl+Z takes the last decision back while it is held
// (lib/proposals.ts). Each card: its kind, a plain question with what each answer does (ADR 0126, lib/proposal-ask.ts),
// the content and any script or query code (expandable), who proposed it, in which chat or run,
// when, and the evidence, with links to the chat and the file. Filter chips by group with their counts; a done state
// with the session's counts and an empty state. Decisions go to main (proposals:decide), which checks them again and
// runs them through their own source. Each card says why it is still asked («Te la chiedo perché: …», never a guessed
// answer); under the deck, «Applicate da sole» lists the cards the app applied by itself with Annulla and the cards
// saved this week (ADR 0193). Rendered by MemoryPage.tsx (the Proposte tab).
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Proposal, ProposalAutoApplied, ProposalDecision, ProposalGroup, ProposalKeep } from '@shared/proposals';
import { characterOf } from '@shared/characters';
import { roleName } from '@shared/roles';
import { t, locale } from '../../i18n';
import { renderMarkdown } from '../../lib/markdown';
import { canUndo, decide, dismissRefusal, groupCounts, openCards, refreshProposals, reportShown, tally, undoAuto, undoLast, useDeck } from '../../lib/proposals';
import { cardWords, whyText } from '../../lib/proposal-ask';
import { go, openChatRef, openFileViewer } from '../../actions';
import { app } from '../../store/store';
import { AgentAvatar } from '../AgentAvatar';
import { LearningEvidenceInspector } from './LearningEvidence';
import { CandidateBody, ProposalDiffs } from './ProposalDiffs';
import { track } from '../../lib/use-counter';
import '../../styles/proposals.css';

const reduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const FLY_MS = 280;

/** «22/10 08:48» in the UI's language. */
export function shortWhen(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const p = (k: Intl.DateTimeFormatPartTypes) => parts.find(x => x.type === k)?.value ?? '';
  return `${p('day')}${locale().startsWith('de') ? '.' : '/'}${p('month')} ${p('hour')}:${p('minute')}`;
}
export function whoName(c: Proposal): string {
  const w = c.provenance.who;
  if (w.kind === 'role') return w.id === 'pulse' ? t('alive.pulse.title') : roleName(w.id);
  if (w.kind === 'maintenance' && (w.id === 'research' || w.id === 'cleanup')) return t(`proposals.who.${w.id}`);
  if (w.kind === 'maintenance') return (['corrections', 'repeated-task', 'merge-skills', 'merge-memory', 'migration', 'upgrade'] as const).includes(w.id as never) ? t(`proposals.job.${w.id as 'corrections'}`) : t('proposals.who.maintenance');
  return w.id === 'lifecycle' ? t('proposals.who.lifecycle') : w.id === 'improve' ? t('proposals.who.improve') : t('proposals.who.agent');
}
const factValue = (c: Proposal, key: string, value: string): string => {
  if (key === 'action' && (['create', 'update', 'merge', 'link', 'unlink', 'remove', 'keep', 'revert', 'tier'] as const).includes(value as never)) return t(`proposals.action.${value as 'create'}`);
  if ((key === 'tier' || (key === 'before' && c.source === 'tier')) && (['light', 'mid', 'top'] as const).includes(value as never)) return t(`proposals.tier.${value as 'light'}`);
  return value;
};
const labels = (c: Proposal) => (c.applied ? { yes: t('proposals.keep'), no: t('proposals.undo'), yesStamp: t('proposals.stamp.keep'), noStamp: t('proposals.stamp.undo') }
  : { yes: t('proposals.approve'), no: t('proposals.reject'), yesStamp: t('proposals.stamp.approve'), noStamp: t('proposals.stamp.reject') });
/** The card's kind chip: a query change says «Query», not «Script». */
const kindLabel = (c: Proposal): string => (c.ask.kind === 'applied' && c.ask.what === 'query' ? t('proposals.kind.query') : t(`proposals.kind.${c.group}`));
/** A log line, JSON or code: never the quote on the card (it stays in «Mostra tutto»). */
const rawText = (e: string): boolean => /^\s*[[{]/.test(e) || /"\w+"\s*:/.test(e) || /^\s*\w+\s*\|/.test(e);
const blockedText = (code: string): string => (code === 'changed-since' ? t('proposals.blocked.changed-since') : code === 'noRepo' ? t('proposals.blocked.noRepo') : (['missing-provenance', 'invalid-steps', 'missing-verified-example', 'missing-holdout-replay', 'already-promoted'] as const).includes(code as never) ? t(`lr.problem.${code as 'missing-provenance'}`) : t('lr.problem.unknown'));
/** A skill draft's header (--- name / description ---) apart from its body: the description is the card's lead. */
export function splitHeader(md: string): { lead: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { lead: '', body: md };
  const lead = /^description:\s*(.+)$/m.exec(m[1]!)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
  return { lead, body: md.slice(m[0].length).trim() };
}
const absolute = (file: string): string => {
  if (/^([a-zA-Z]:)?[\\/]/.test(file)) return file;
  const root = app.get().info?.brainRoot;
  return root ? `${root.replace(/[\\/]+$/, '')}/${file}` : file;
};

function WhoAvatar({ c, size = 34 }: { c: Proposal; size?: number }) {
  const w = c.provenance.who, name = whoName(c);
  if (w.kind === 'role') return <AgentAvatar avatar={{ kind: 'character', value: characterOf(w.id) }} name={name} size={size} />;
  return <span className={`pd-glyph pd-glyph-${w.kind}`} role="img" aria-label={name} style={{ width: size, height: size }}>
    {w.kind === 'maintenance'
      ? <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
      : <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
  </span>;
}

/** A maintenance finding (ADR 0132): what it adds and removes, why, what to expect, the risk, the evidence and the pages
 *  it rests on, in the words the research wrote. Only the top card lists the sources as links. */
function ResearchBody({ a, top }: { a: Extract<Proposal['ask'], { kind: 'research' }>; top: boolean }) {
  return <div className="pd-research" data-testid={top ? 'pd-research' : undefined}>
    {(a.adds || a.removes) && <div className="pd-delta">
      {a.adds && <div className="pd-delta-add" data-testid={top ? 'pd-adds' : undefined}><span className="pd-label">{t('proposals.research.adds')}</span><p>{a.adds}</p></div>}
      {a.removes && <div className="pd-delta-del" data-testid={top ? 'pd-removes' : undefined}><span className="pd-label">{t('proposals.research.removes')}</span><p>{a.removes}</p></div>}
    </div>}
    <div className="pd-rs"><span className="pd-label">{t('proposals.research.why')}</span><p>{a.why}</p></div>
    {a.expected && <div className="pd-rs"><span className="pd-label">{t('proposals.research.expected')}</span><p>{a.expected}</p></div>}
    {a.risk && <div className="pd-rs"><span className="pd-label">{t('proposals.research.risk')}</span><p>{a.risk}</p></div>}
    {a.sources.length > 0 && <div className="pd-rs"><span className="pd-label">{t('proposals.research.sources')}</span>
      <ul className="pd-sources">{a.sources.map(x => <li key={x.url}>{top ? <a href={x.url} target="_blank" rel="noreferrer">{x.title}</a> : x.title}</li>)}</ul></div>}
  </div>;
}

export interface CardHandle { fling(d: ProposalDecision): void }
interface CardProps { card: Proposal; depth: number; returning: 'left' | 'right' | null; onDecide(d: ProposalDecision, note?: string, keep?: ProposalKeep): void; onBlocked(text: string): void }

/** One card; only the top one (depth 0) moves. */
export const ProposalCard = forwardRef<CardHandle, CardProps>(function ProposalCard({ card: c, depth, returning, onDecide, onBlocked }, ref) {
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [leaving, setLeaving] = useState<ProposalDecision | null>(null);
  const [open, setOpen] = useState(false), [read, setRead] = useState(false), [note, setNote] = useState(''), [shake, setShake] = useState(0), [keep, setKeep] = useState<ProposalKeep | null>(null);
  const conflicts = c.ask.kind === 'remember' ? c.ask.conflicts ?? [] : [];
  const el = useRef<HTMLElement>(null), start = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const top = depth === 0, l = labels(c);
  const why = (d: ProposalDecision): string | null => {
    if (d === 'approve' && !c.canApprove) return c.blocked?.map(blockedText).join(' ') || t('proposals.blocked.title');
    if (d === 'reject' && !c.canReject) return c.blocked?.map(blockedText).join(' ') || t('proposals.blocked.undoTitle');
    if (d === 'approve' && c.readFirst && !read) return t('proposals.readFirst');
    if (d === 'approve' && conflicts.length && !keep) return t('proposals.conflict.pick');
    return null;
  };
  const fling = (d: ProposalDecision) => {
    if (leaving) return;
    const no = why(d);
    if (no) { setDrag(null); setShake(n => n + 1); onBlocked(c.blocked?.length && no !== t('proposals.readFirst') && no !== t('proposals.conflict.pick') ? (d === 'approve' ? t('proposals.blocked.title') : t('proposals.blocked.undoTitle')) : no); return; }
    setDrag(null); setLeaving(d);
    const n = note, k = conflicts.length && d === 'approve' ? keep ?? undefined : undefined;
    if (reduced()) onDecide(d, n, k); else setTimeout(() => onDecide(d, n, k), FLY_MS);
  };
  useImperativeHandle(ref, () => ({ fling }));
  const width = () => el.current?.offsetWidth ?? 480;
  const threshold = () => Math.max(90, width() * 0.28);
  const onDown = (e: ReactPointerEvent) => {
    if (!top || leaving || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, input, label, textarea, select, summary, .pd-scroll')) return;
    start.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    el.current?.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    const s = start.current; if (!s || s.id !== e.pointerId) return;
    setDrag({ dx: e.clientX - s.x, dy: (e.clientY - s.y) * 0.25 });
  };
  const onUp = (e: ReactPointerEvent) => {
    const s = start.current; if (!s || s.id !== e.pointerId) return;
    start.current = null;
    const dx = e.clientX - s.x, v = dx / Math.max(1, performance.now() - s.t);
    if (dx > threshold() || (v > 0.9 && dx > 40)) fling('approve');
    else if (dx < -threshold() || (v < -0.9 && dx < -40)) fling('reject');
    else setDrag(null); // spring back (the transition does it)
  };
  const dx = drag?.dx ?? 0, k = Math.max(-1, Math.min(1, dx / threshold()));
  const style = leaving
    ? { transform: `translate(${(leaving === 'approve' ? 1 : -1) * width() * 1.4}px, ${(drag?.dy ?? 0) - 30}px) rotate(${leaving === 'approve' ? 22 : -22}deg)`, opacity: 0 }
    : top ? { transform: `translate(${dx}px, ${drag?.dy ?? 0}px) rotate(${Math.max(-14, Math.min(14, dx * 0.045))}deg)` }
      : { transform: `translateY(${depth * 14}px) scale(${1 - depth * 0.045})`, opacity: depth > 2 ? 0 : 1 - depth * 0.18 };
  const evidence = c.provenance.evidence;
  // the quote under who proposed it is words, never a bare run id or file:line (those stay in «Mostra tutto»)
  const quote = evidence.find(e => /\s/.test(e.trim()) && !/^run \S+$/.test(e.trim()) && !rawText(e));
  const root = app.use(s => s.info?.brainRoot ?? null);
  const files = c.provenance.files ?? [];
  const words = useMemo(() => cardWords(c, keep), [c, keep]);
  const { lead: draftLead, body } = useMemo(() => splitHeader(c.content), [c.content]);
  const lead = words.lead || draftLead;
  const html = useMemo(() => (body && !words.hideBody ? renderMarkdown(body) : ''), [body, words.hideBody]);
  const code = c.code ?? [];
  const asked = whyText(c.why);
  return <article ref={el} className={`pd-card pd-g-${c.group}${top ? ' pd-top' : ''}${drag ? ' pd-dragging' : ''}${leaving ? ' pd-leaving' : ''}${returning && top ? ` pd-return-${returning}` : ''}${open ? ' pd-open' : ''}${shake ? ` pd-shake-${shake % 2}` : ''}`}
    style={{ ...style, zIndex: 10 - depth, ['--k' as string]: String(k) }} aria-hidden={top ? undefined : true}
    data-testid={top ? 'pd-card-top' : undefined} data-card={c.id} data-group={c.group} data-applied={c.applied || undefined}
    onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { start.current = null; setDrag(null); }}>
    <span className="pd-tint pd-tint-yes" style={{ opacity: Math.max(0, k) * 0.9 }} aria-hidden="true" />
    <span className="pd-tint pd-tint-no" style={{ opacity: Math.max(0, -k) * 0.9 }} aria-hidden="true" />
    <span className="pd-stamp pd-stamp-yes" style={{ opacity: Math.max(0, k) }} aria-hidden="true" data-testid={top ? 'pd-stamp-yes' : undefined}>{l.yesStamp}</span>
    <span className="pd-stamp pd-stamp-no" style={{ opacity: Math.max(0, -k) }} aria-hidden="true" data-testid={top ? 'pd-stamp-no' : undefined}>{l.noStamp}</span>
    <header className="pd-card-head">
      <span className="pd-kind">{kindLabel(c)}</span>
      {c.applied && <span className="pd-applied">{t('proposals.applied')}</span>}
      <time className="pd-when" dateTime={c.provenance.at}>{shortWhen(c.provenance.at)}</time>
    </header>
    <h3 className="pd-title" data-testid={top ? 'pd-question' : undefined}>{words.question}</h3>
    {asked && <p className="pd-asked" data-testid={top ? 'pd-asked' : undefined}><span>{t('proposals.why.lead')}</span> {asked}</p>}
    <div className={`pd-body${open ? ' pd-scroll' : ''}`}>
      {code.map((x, i) => <figure key={`${i}:${x.file}`} className="pd-code" data-testid={top ? 'pd-code' : undefined}>
        <figcaption><span className="pd-label">{t('proposals.code')}</span><code>{x.file}</code></figcaption>
        <pre className="pd-scroll" data-lang={x.lang}><code>{x.text}</code></pre>
      </figure>)}
      {c.ask.kind === 'research' && <ResearchBody a={c.ask} top={top} />}
      {c.ask.kind === 'candidate' && <CandidateBody a={c.ask} top={top} />}
      {top && c.diffs && c.diffs.length > 0 && <ProposalDiffs diffs={c.diffs} role={c.ask.kind === 'research' && !!c.ask.trial} />}
      {lead && <p className="pd-lead">{lead}</p>}
      {html && <div className={`pd-why${c.ask.kind === 'research' ? ' pd-exact' : ''}`}>{words.bodyLabel && <span className="pd-label">{words.bodyLabel}</span>}<div className="md pd-md" dangerouslySetInnerHTML={{ __html: html }} /></div>}
      {(words.scope || words.advice) && <p className="pd-scope">{[words.scope, words.advice].filter(Boolean).join(' ')}</p>}
      {open && c.facts.length > 0 && <div className="pd-tech"><span className="pd-label">{t('proposals.details')}</span><dl className="pd-facts">{c.facts.map((f, i) => <div key={i} className={`pd-fact pd-fact-${f.key}`}><dt>{t(`proposals.fact.${f.key}`)}</dt><dd>{factValue(c, f.key, f.value)}</dd></div>)}</dl></div>}
      {open && evidence.some(e => e !== quote) && <ul className="pd-evidence-all">{evidence.filter(e => e !== quote).map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {open && files.length > 0 && <ul className="pd-files">{files.map(f => <li key={f}><code>{f}</code></li>)}</ul>}
      {open && top && root && c.evidenceRuns?.map(id => <LearningEvidenceInspector key={id} root={root} runId={id} />)}
      {open && top && c.source === 'memory' && <label className="pd-note">{t('proposals.note')}<input value={note} maxLength={900} onChange={e => setNote(e.target.value)} data-testid="pd-note" /></label>}
    </div>
    {(html.length > 220 || code.length > 0 || c.ask.kind === 'research' || c.ask.kind === 'candidate' || c.facts.length > 0 || evidence.some(e => e !== quote) || files.length > 0 || c.readFirst || c.source === 'memory') && top &&
      <button type="button" className="pd-more" aria-expanded={open} data-testid="pd-more" onClick={() => { setOpen(o => !o); setRead(true); }}>
        {open ? t('proposals.less') : c.readFirst && !read ? t('proposals.readFirstOpen') : t('proposals.more')}
      </button>}
    {conflicts.length > 0 && <fieldset className="pd-conflict" data-testid={top ? 'pd-conflict' : undefined}>
      <legend>{t('proposals.conflict.title', { who: words.who ?? '', n: conflicts.length })}</legend>
      <ul>{conflicts.map(x => <li key={x.id}>{x.value}</li>)}</ul>
      <div className="pd-conflict-choices" role="radiogroup" aria-label={t('proposals.conflict.question')}>
        {(['new', 'both'] as const).map(k => <label key={k} className={keep === k ? 'on' : ''}>
          <input type="radio" name={`keep-${c.id}`} value={k} checked={keep === k} disabled={!top} onChange={() => setKeep(k)} data-testid={top ? `pd-keep-${k}` : undefined} />
          {t(`proposals.conflict.${k}`, { n: conflicts.length })}</label>)}
      </div>
    </fieldset>}
    {c.blocked && <p className="pd-blocked" role="note">{c.blocked.map(blockedText).join(' ')}</p>}
    <footer className="pd-prov" data-testid={top ? 'pd-provenance' : undefined}>
      <div className="pd-who"><WhoAvatar c={c} />
        <p><b>{t('proposals.from', { who: whoName(c) })}</b>{c.provenance.chat && c.provenance.chat.title !== whoName(c) && <> · <span className="pd-chat">{t('proposals.inChat', { title: c.provenance.chat.title })}</span></>}
          {!c.provenance.chat && c.provenance.runId && <> · <span>{t('proposals.run', { id: c.provenance.runId })}</span></>} · <time dateTime={c.provenance.at}>{shortWhen(c.provenance.at)}</time></p>
      </div>
      {quote && <blockquote className="pd-quote" title={t('proposals.evidence')}>{quote}</blockquote>}
      {top && (c.provenance.chat || files[0]) && <div className="pd-links">
        {c.provenance.chat && <button type="button" className="pd-link" onClick={() => openChatRef(c.provenance.chat!.id)}>{t('proposals.openChat')} ↗</button>}
        {files[0] && <button type="button" className="pd-link" onClick={() => openFileViewer(absolute(files[0]!))}>{t('proposals.openFile')} ↗</button>}
      </div>}
    </footer>
  </article>;
});

/** «Applicate da sole» (ADR 0193): the cards the app applied by itself lately, each with Annulla while it still works,
 *  and how many cards it spared the user this week. */
function AutoApplied({ items, saved }: { items: readonly ProposalAutoApplied[]; saved: number }) {
  const [busy, setBusy] = useState<string | null>(null);
  const undo = async (x: ProposalAutoApplied) => { setBusy(x.id); try { await undoAuto(x.id, x.title); } finally { setBusy(null); } };
  return <section className="pd-auto" aria-labelledby="pd-auto-title" data-testid="pd-auto">
    <header className="pd-auto-head">
      <h3 id="pd-auto-title">{t('proposals.auto.title')}</h3>
      <span className="pd-auto-saved" data-testid="pd-auto-saved">{t('proposals.auto.saved', { n: saved })}</span>
    </header>
    <p className="pd-auto-lead">{items.length ? t('proposals.auto.lead') : t('proposals.auto.none')}</p>
    {items.length > 0 && <ul className="pd-auto-list">{items.map(x => <li key={x.id} className={`pd-g-${x.group}${x.undoneAt ? ' pd-auto-off' : ''}`} data-testid="pd-auto-item">
      <span className="pd-kind">{t(`proposals.kind.${x.group}`)}</span>
      <b title={x.title}>{x.title}</b>
      <time dateTime={new Date(x.at).toISOString()}>{shortWhen(new Date(x.at).toISOString())}</time>
      {x.undoneAt ? <span className="pd-auto-state">{t('proposals.auto.undone')}</span>
        : x.canUndo ? <button type="button" className="btn btn-s" disabled={busy !== null} aria-label={`${t('proposals.auto.undo')}: ${x.title}`} data-testid="pd-auto-undo" onClick={() => void undo(x)}>{t('proposals.auto.undo')}</button>
          : <span className="pd-auto-state">{t('proposals.auto.cannot')}</span>}
    </li>)}</ul>}
  </section>;
}

function Confetti() {
  return <div className="pd-confetti" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ ['--i' as string]: String(i) }} />)}</div>;
}

export function ProposalsDeck() {
  const s = useDeck();
  const [filter, setFilter] = useState<ProposalGroup | 'all'>('all');
  const [hint, setHint] = useState<string | null>(null), [returning, setReturning] = useState<{ id: string; side: 'left' | 'right' } | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const topRef = useRef<CardHandle>(null);
  const all = openCards(s), chips = groupCounts(all);
  const cards = filter === 'all' ? all : all.filter(c => c.group === filter);
  const top = cards[0];
  // what each answer does, on its button (the lines under the card are gone: owner, 2026-10-23)
  const topWords = top ? cardWords(top) : null;
  const sum = tally(s), done = sum.approved + sum.rejected, undoable = canUndo(s);
  useEffect(() => { if (filter !== 'all' && !chips.some(g => g.group === filter) && !all.length) setFilter('all'); }, [filter, chips, all.length]);
  useEffect(() => { if (!hint) return; const id = setTimeout(() => setHint(null), 3200); return () => clearTimeout(id); }, [hint]);
  const undo = () => {
    const card = undoLast(); if (!card) return;
    const last = s.decided.find(d => d.card.id === card.id);
    setReturning({ id: card.id, side: last?.decision === 'approve' ? 'right' : 'left' });
    if (filter !== 'all' && card.group !== filter) setFilter('all');
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // a radio of the card (replace / keep both) keeps ← → for the deck, never for switching the choice
      if (el && (el.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && (el as HTMLInputElement).type !== 'radio'))) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (e.key === 'ArrowRight' && !e.altKey && !e.ctrlKey && !e.metaKey) { if (topRef.current) { e.preventDefault(); topRef.current.fling('approve'); } }
      else if (e.key === 'ArrowLeft' && !e.altKey && !e.ctrlKey && !e.metaKey) { if (topRef.current) { e.preventDefault(); topRef.current.fling('reject'); } }
      else if ((e.key === 'z' || e.key === 'Z') && !e.altKey && !e.shiftKey) { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // the card on top is reported once: the ledger keeps how long the decision took (ADR 0193)
  const topId = top?.id;
  useEffect(() => { if (topId) reportShown(topId); }, [topId]);
  const onDecide = (card: Proposal) => (d: ProposalDecision, note?: string, keep?: ProposalKeep) => { setReturning(null); track('proposal'); decide(card, d, note, keep); };

  if (!s.data && s.loading) return <section className="pd pd-center" data-testid="proposals-deck"><p className="pd-muted">{t('proposals.loading')}</p></section>;
  if (!s.data && s.error) return <section className="pd pd-center" data-testid="proposals-deck"><p role="alert">{t('proposals.error', { error: s.error })}</p><button type="button" className="btn btn-s" onClick={() => void refreshProposals()}>{t('proposals.retry')}</button></section>;

  const position = Math.min(done + 1, done + all.length), total = done + all.length;
  return <section className="pd" data-testid="proposals-deck" aria-label={t('proposals.deckLabel')}>
    {all.length > 0 && <header className="pd-head">
      <div className="pd-chips" role="group" aria-label={t('proposals.filters')}>
        <button type="button" className="pd-chip" aria-pressed={filter === 'all'} data-testid="pd-chip-all" onClick={() => setFilter('all')}>{t('proposals.filter.all')}<span>{all.length}</span></button>
        {chips.map(g => <button key={g.group} type="button" className={`pd-chip pd-g-${g.group}`} aria-pressed={filter === g.group} data-testid={`pd-chip-${g.group}`} onClick={() => setFilter(g.group)}>{t(`proposals.group.${g.group}`)}<span>{g.n}</span></button>)}
      </div>
      {all.length > 0 && <div className="pd-progress" aria-label={t('proposals.position', { i: position, n: total })} data-testid="pd-position">
        <span>{t('proposals.position', { i: position, n: total })}</span><i style={{ ['--p' as string]: String(total ? done / total : 0) }} />
      </div>}
    </header>}
    {s.data && s.data.problems.length > 0 && <p className="pd-banner pd-warn" role="status">{t('proposals.problem')}</p>}
    {s.refused && <p className="pd-banner pd-err" role="alert" data-testid="pd-refused">{t('proposals.refused', s.refused)}<button type="button" className="pd-x" aria-label={t('common.close')} onClick={dismissRefusal}>×</button></p>}

    {top ? <div className="pd-stage">
      <div className="pd-stack">
        {cards.slice(0, 3).map((c, i) => <ProposalCard key={c.id} ref={i === 0 ? topRef : undefined} card={c} depth={i} returning={returning?.id === c.id ? returning.side : null}
          onDecide={onDecide(c)} onBlocked={setHint} />).reverse()}
      </div>
      <p className="pd-hint" role="status" aria-live="polite">{hint ?? (undoable ? t('proposals.held') : '')}</p>
      <div className="pd-controls">
        <button type="button" className="pd-round pd-no" data-testid="pd-reject" aria-label={labels(top).no} title={`${topWords?.no ?? labels(top).no} (←)`} disabled={!top.canReject} onClick={() => topRef.current?.fling('reject')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg><span>{labels(top).no}</span></button>
        <button type="button" className="pd-round pd-undo" data-testid="pd-undo" aria-label={t('proposals.undoLast')} title={`${t('proposals.undoLast')} (Z)`} disabled={!undoable} onClick={undo}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg></button>
        <button type="button" className="pd-round pd-yes" data-testid="pd-approve" aria-label={labels(top).yes} title={`${topWords?.yes ?? labels(top).yes} (→)`} disabled={!top.canApprove} onClick={() => topRef.current?.fling('approve')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg><span>{labels(top).yes}</span></button>
      </div>
      <p className="pd-keys">{t('proposals.keys')}</p>
    </div>
      : all.length > 0 ? <div className="pd-center pd-filter-empty"><p className="pd-muted">{t('proposals.filterEmpty')}</p><button type="button" className="btn btn-s" onClick={() => setFilter('all')}>{t('proposals.showAll')}</button></div>
        : done > 0 ? <div className="pd-done" data-testid="pd-done">
          <Confetti />
          <div className="pd-done-mark" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="23" /><path d="M15 27l7 7 15-16" /></svg></div>
          <h3>{t('proposals.done.title')}</h3>
          <p className="pd-muted">{t('proposals.done.lead')}</p>
          <div className="pd-tally">
            <span className="pd-tally-yes" data-testid="pd-count-approved"><b>{sum.approved}</b>{t('proposals.done.approved', { n: sum.approved })}</span>
            <span className="pd-tally-no" data-testid="pd-count-rejected"><b>{sum.rejected}</b>{t('proposals.done.rejected', { n: sum.rejected })}</span>
          </div>
          <div className="pd-done-actions">
            {undoable && <button type="button" className="btn btn-m" data-testid="pd-done-undo" onClick={undo}>{t('proposals.undoLast')}</button>}
            <button type="button" className="btn btn-m btn-primary" data-testid="pd-to-approved" onClick={() => go({ page: 'memoria', arg: 'approvate' })}>{t('proposals.done.toApproved')}</button>
            {sum.rejected > 0 && <button type="button" className="btn btn-m btn-ghost" aria-expanded={showRejected} data-testid="pd-review-rejected" onClick={() => setShowRejected(v => !v)}>{showRejected ? t('proposals.done.hideRejected') : t('proposals.done.reviewRejected')}</button>}
          </div>
          {showRejected && <ul className="pd-rejected" aria-label={t('proposals.done.rejectedList')} data-testid="pd-rejected-list">{sum.rejectedCards.map(c => <li key={c.id} className={`pd-g-${c.group}`}>
            <WhoAvatar c={c} size={28} />
            <div className="pd-rej-main"><span><span className="pd-kind">{kindLabel(c)}</span><b title={cardWords(c).question}>{cardWords(c).question}</b></span>
              <small>{t('proposals.from', { who: whoName(c) })} · {shortWhen(c.provenance.at)}</small></div>
            {c.provenance.chat ? <button type="button" className="pd-link" onClick={() => openChatRef(c.provenance.chat!.id)}>{t('proposals.openChat')} ↗</button> : <span />}
          </li>)}</ul>}
        </div>
          : <div className="pd-empty" data-testid="pd-empty">
            <div className="pd-empty-art" aria-hidden="true"><i /><i /><i /></div>
            <h3>{t('proposals.empty.title')}</h3>
            <p className="pd-muted">{t('proposals.empty.lead')}</p>
          </div>}
    {s.data && <AutoApplied items={s.data.auto ?? []} saved={s.data.saved ?? 0} />}
  </section>;
}
