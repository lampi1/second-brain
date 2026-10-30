// The morning block, "Mentre eri via" (ADR 0102): a zero-token summary the app draws by itself at the first presence of
// the day or after 4 h away (main/morning/, one 'morning:brief' channel): the runs finished since then with their
// outcome, what waits for the user (requests, "Da approvare"), the user's PRs with a red build or waiting for a vote,
// ideas due, cloud agents finished, what the maintenance changed (with Annulla), yesterday's spend, a stalled chat.
// Each row opens its place; "Parliamone" prepares a draft for the Orchestrator and never sends it; Esc / Ok dismiss it
// for the day. In the empty Grindhouse it is the block (GrindhouseEmpty, mounted by AgentStrips.tsx); with strips open
// (or on another page) one compact line atop the Orchestrator column (MorningLine, OrchestratorTile.tsx) that unfolds
// into the same rows. Without any history the Grindhouse keeps its first-run text.
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { MorningBrief, MorningRun } from '@shared/contract';
import { briefEmpty } from '@shared/morning';
import { brainBridge, focusChat, go, nextThing, openMorningNext } from '../actions';
import { dismissMorning, morning, useMorning } from '../store/morning';
import { useApp } from '../store/store';
import { useCloudIds } from '../store/cloud';
import { ui } from '../store/ui';
import { locale, t } from '../i18n';
import { formatCost } from '../lib/format';
import { undoChanges } from './AgentFeedAction';
import { PulseBoard } from './ContextPulse';
import '../styles/alive.css';

const usd = (v: number) => formatCost(v);
const hhmm = (at: number) => new Date(at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
/** "08:12", "ieri 18:40", "18/10 09:00" */
export function whenText(at: number, now: number): string {
  const a = new Date(at), b = new Date(now), y = new Date(now - 86_400_000);
  if (a.toDateString() === b.toDateString()) return hhmm(at);
  if (a.toDateString() === y.toDateString()) return t('alive.m.yesterday', { time: hhmm(at) });
  return `${dayMonth(a)} ${hhmm(at)}`;
}
const dayMonth = (d: Date) => d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' });
/** The block's start as a phrase: "dalle 08:12", "da ieri alle 18:40", "dal 18/10 alle 09:00" */
export function sinceText(at: number, now: number): string {
  const a = new Date(at), y = new Date(now - 86_400_000);
  if (a.toDateString() === new Date(now).toDateString()) return t('alive.m.since', { when: hhmm(at) });
  if (a.toDateString() === y.toDateString()) return t('alive.m.sinceYesterday', { time: hhmm(at) });
  return t('alive.m.sinceDay', { day: dayMonth(a), time: hhmm(at) });
}
const outcome = (r: MorningRun) => t(`alive.m.outcome.${r.outcome}`);

interface Row { key: string; tone?: string; text: string; sub?: string; open: () => void; extra?: ReactNode }

/** The rows, most actionable first; each opens its place. */
function rows(b: MorningBrief, undo: { done: boolean; busy: boolean; run: () => void }): Row[] {
  const out: Row[] = [];
  if (b.pending) out.push({ key: 'pending', tone: 'warn', text: t('alive.m.pending', { n: b.pending }), open: () => nextThing() });
  for (const p of b.prs.filter(x => x.why === 'build')) out.push({ key: `pr-${p.id}`, tone: 'bad', text: t('alive.m.prBuild', { title: p.title }), sub: b.tasksAt ? t('alive.m.tasksAt', { when: whenText(b.tasksAt, b.at) }) : undefined, open: () => openMorningNext({ kind: 'pr', pr: p }) });
  if (b.approvals) out.push({ key: 'approvals', tone: 'warn', text: t('alive.m.approvals', { n: b.approvals }), open: () => openMorningNext({ kind: 'approvals', n: b.approvals }) });
  for (const c of b.stalled.slice(0, 2)) out.push({ key: `stalled-${c.chatId}`, tone: 'warn', text: t('alive.m.stalled', { title: c.title, min: c.quietMin }), open: () => focusChat(c.chatId) });
  if (b.runs.length) {
    const one = b.runs.length === 1 ? b.runs[0]! : null;
    const listed = b.runs.slice(0, 3).map(r => `${r.title} · ${outcome(r)}`).join(' — ') + (b.runs.length > 3 ? ` — ${t('alive.m.more', { n: b.runs.length - 3 })}` : '');
    out.push({ key: 'runs', tone: b.runs.some(r => r.outcome === 'blocked') ? 'bad' : b.runs.every(r => r.outcome === 'done') ? 'good' : '', text: t('alive.m.runs', { n: b.runs.length }), sub: listed,
      open: () => (one?.open ? focusChat(one.chatId) : go({ page: 'log' })) });
  }
  for (const p of b.prs.filter(x => x.why === 'vote').slice(0, 2)) out.push({ key: `vote-${p.id}`, text: t('alive.m.prVote', { title: p.title }), open: () => go({ page: 'task' }) });
  for (const i of b.ideas.slice(0, 2)) out.push({ key: `idea-${i.title}`, text: t('alive.m.idea', { title: i.title }), sub: i.due, open: () => openMorningNext({ kind: 'idea', idea: i }) });
  for (const c of b.cloud.slice(0, 2)) out.push({ key: `cloud-${c.id}`, tone: c.status === 'done' ? 'good' : c.status === 'failed' ? 'bad' : '', text: t('alive.m.cloud', { title: c.title, status: t(`alive.m.cloud.${c.status}`) }), open: () => go({ page: 'home' }) });
  if (b.changes.length) {
    const can = b.changes.some(c => c.canRollback);
    out.push({ key: 'changes', text: t('alive.m.maintenance', { n: b.changes.length }), sub: b.changes.slice(0, 2).map(c => c.summary).join(' · '), open: () => go({ page: 'log' }),
      extra: can || undo.done ? <button type="button" className="btn btn-ghost btn-s" disabled={undo.busy || undo.done} onClick={undo.run} data-testid="morning-undo">{t(undo.done ? 'alive.m.undone' : 'alive.m.undo')}</button> : null });
  }
  if (b.spendYesterdayUsd !== null && b.spendYesterdayUsd > 0) out.push({ key: 'spend', text: t('alive.m.spend', { usd: usd(b.spendYesterdayUsd) }), open: () => go({ page: 'andamento', arg: 'costi' }) });
  return out;
}

/** The brief as plain lines, for the Orchestrator's draft ("Parliamone"). */
export function draftOf(b: MorningBrief): string {
  const lines = rows(b, { done: false, busy: false, run: () => {} }).map(r => `- ${r.text}${r.sub ? ` (${r.sub})` : ''}`);
  return t('alive.m.draft', { since: sinceText(b.since, b.at), lines: lines.join('\n') || `- ${t('alive.m.nothing')}` });
}

export function MorningBlock({ brief, compact }: { brief: MorningBrief; compact?: boolean }) {
  const [busy, setBusy] = useState(false), [done, setDone] = useState(false), [missing, setMissing] = useState(false), [error, setError] = useState('');
  const undo = { busy, done, run: () => {
    if (busy || done) return;
    setBusy(true); setError('');
    void undoChanges(brief.changes.filter(c => c.canRollback).map(c => c.id)).then(() => setDone(true), e => setError(String(e))).finally(() => setBusy(false));
  } };
  const list = rows(brief, undo);
  const onKey = (e: KeyboardEvent<HTMLElement>) => { if (e.key === 'Escape') { e.stopPropagation(); void dismissMorning(); } };
  return <section className={`morning${compact ? ' is-compact' : ''}`} aria-labelledby="morning-title" data-testid="morning-block" onKeyDown={onKey}>
    <header className="morning-head">
      <h2 id="morning-title">{t('alive.m.title')}</h2>
      <span className="morning-since">{sinceText(brief.since, brief.at)}</span>
    </header>
    {briefEmpty(brief) && !(brief.spendYesterdayUsd && brief.spendYesterdayUsd > 0)
      ? <p className="morning-note" data-testid="morning-nothing">{t('alive.m.nothing')}</p>
      : <ul className="morning-rows">{list.map(r => <li key={r.key} className="morning-row" data-tone={r.tone || undefined} data-testid={`morning-row-${r.key}`}>
        <button type="button" className="morning-open" onClick={r.open}><span className="morning-mark" aria-hidden="true" /><span className="morning-text">{r.text}</span>{r.sub && <span className="morning-sub">{r.sub}</span>}</button>
        {r.extra}
      </li>)}</ul>}
    {error && <p className="morning-note" role="alert">{error}</p>}
    <div className="morning-actions">
      {missing && <span className="morning-note" role="status">{t('alive.m.talkMissing')}</span>}
      <button type="button" className="btn btn-ghost btn-s" onClick={() => setMissing(!brainBridge.draftToOrchestrator(draftOf(brief), () => {}))} data-testid="morning-talk">{t('alive.m.talk')}</button>
      <button type="button" className="btn btn-primary btn-s" onClick={() => void dismissMorning()} data-testid="morning-ok">{t('alive.m.ok')}</button>
    </div>
  </section>;
}

/** The empty Grindhouse: the morning block (and the Battito's board) for a user with history, the first-run text otherwise. */
export function GrindhouseEmpty() {
  const st = useMorning();
  const block = !!st?.show && !!st.brief;
  useEffect(() => { morning.set(s => ({ ...s, block })); return () => morning.set(s => ({ ...s, block: false })); }, [block]);
  if (!st) return null;
  if (!st.history) return <p className="home-calm" data-testid="agents-empty">{t('home.emptyAgents')}</p>;
  return <div className="grindhouse-empty" data-testid="agents-idle">
    {st.show && st.brief ? <MorningBlock brief={st.brief} /> : <p className="home-calm">{t('alive.idle')}</p>}
    <PulseBoard />
  </div>;
}

/** One line atop the Orchestrator column while the block is open but the Grindhouse shows strips (or another page). */
export function MorningLine() {
  const st = useMorning();
  const [open, setOpen] = useState(false);
  const strips = useApp(s => Object.values(s.chats).some(c => !!c && !c.isOrchestrator && !c.closedAt && !c.parentId));
  const clouds = useCloudIds().length;
  const page = ui.use(s => (s.map ? 'mappa' : s.page));
  const block = morning.use(s => !!s.block);
  if (!st?.show || !st.brief || (page === 'home' && (block || (!strips && !clouds)))) return null;
  const b = st.brief;
  const bits = [b.runs.length ? t('alive.m.runs', { n: b.runs.length }) : '', b.pending ? t('alive.m.pending', { n: b.pending }) : '', b.approvals ? t('alive.m.approvals', { n: b.approvals }) : '',
    b.prs.some(p => p.why === 'build') ? t('alive.m.prBuild', { title: b.prs.find(p => p.why === 'build')!.title }) : ''].filter(Boolean);
  return <div className={open ? 'morning-line-open' : undefined} data-testid="morning-line">
    <div className="morning-line" role="group" aria-label={t('alive.m.lineLabel')}>
      <span className="morning-line-text"><b>{t('alive.m.title')}</b>{' · '}{bits.join(' · ') || t('alive.m.nothing')}</span>
      <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen(o => !o)} data-testid="morning-line-details">{t(open ? 'alive.m.less' : 'alive.m.details')}</button>
      <button type="button" className="link-btn" onClick={() => void dismissMorning()} data-testid="morning-line-ok">{t('alive.m.ok')}</button>
    </div>
    {open && <MorningBlock brief={b} compact />}
  </div>;
}
