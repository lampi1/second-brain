// Generative UI, the views (ADR 0033): the catalog of trusted components a chat can show (show_ui, or an ```sb-ui fence
// in a question option's preview), drawn from checked props (shared/genui.ts), never from HTML: table, cards (decision
// options), board (lanes of items: QA cases, chat status), diffList (changed files by area, clickable), barChart (inline
// SVG). Each view sits in an error boundary whose fallback is the plain summary. ArtifactCard = a visual in a chat's
// list (compact; click or ⤢ = full width over the app, Esc closes); AskArtifacts = the visuals attached to a question;
// UiPreview = an option's preview with its sb-ui fences drawn; a question's brief (ADR 0150) is drawn by DecisionCard.tsx,
// here only when it shows as a plain card. None of them answers anything: their keys stay theirs
// (Esc in the full view never reaches a question panel). Used by ChatItems.tsx and AskContext.tsx.
import { Component, createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChatItem, PendingRequest, UiBoard, UiBrief, UiCards, UiDiffList, UiLink, UiSpec, UiStatus, UiTable } from '@shared/contract';
import { describeUi, safeHref, splitUiFences, textOfUi } from '@shared/genui';
import { renderMarkdown } from '../lib/markdown';
import { useApp } from '../store/store';
import { closeModal, openModal, toast, ui } from '../store/ui';
import { IconAlert, IconChart, IconCheck, IconColumns, IconCopy, IconFile, IconGlobe, IconLayers, IconList, IconMaximize, IconX } from './Icons';
import { Modal } from './ui';
import { BarChart } from './genui/BarChart';
import { BriefEvidence } from './DecisionCard';
import { copyText } from '../brain/components/ui';
import { t } from '../i18n';
import { openFileViewer } from '../actions';

type Art = Extract<ChatItem, { kind: 'artifact' }>;
const FileChat=createContext<string|undefined>(undefined);

const getStatus = (): Record<UiStatus, string> => ({ ok: t('tools.genui.statusOk'), fail: t('tools.genui.statusFail'), blocked: t('tools.genui.statusBlocked'), running: t('tools.genui.statusRunning'), todo: t('tools.genui.statusTodo'), info: t('tools.genui.statusInfo'), warn: t('tools.genui.statusWarn') });

const getKind = (): Record<UiSpec['component'], { label: string; icon: ReactNode }> => ({
  table: { label: t('tools.genui.kindTable'), icon: <IconList size={13} /> },
  cards: { label: t('tools.genui.kindCards'), icon: <IconColumns size={13} /> },
  board: { label: t('tools.genui.kindBoard'), icon: <IconLayers size={13} /> },
  diffList: { label: t('tools.genui.kindDiffList'), icon: <IconFile size={13} /> },
  barChart: { label: t('tools.genui.kindBarChart'), icon: <IconChart size={13} /> },
  brief: { label: t('tools.genui.kindBrief'), icon: <IconCheck size={13} /> },
});

const getRisk = () => ({ low: t('tools.genui.riskLow'), medium: t('tools.genui.riskMedium'), high: t('tools.genui.riskHigh') } as const);

/** A local file named by a chat, opened on the user's click (main/open-path.ts decides how: documents open, the rest
 *  is only shown in its folder). */
export async function openFile(href: string,chatId?:string): Promise<void> {
  openFileViewer(href,chatId);
}

function Status({ s }: { s: UiStatus }) {
  const STATUS = getStatus();
  return <span className={`gu-status gu-${s}`}><span aria-hidden="true" className="gu-status-icon">{({ ok: '✓', fail: '×', blocked: '⊘', running: '↻', todo: '○', info: 'i', warn: '!' })[s]}</span>{STATUS[s]}</span>;
}

function Link({ l }: { l: UiLink }) {
  const chatId=useContext(FileChat);
  const kind = safeHref(l.href);
  if (kind === 'web') return <a className="gu-link" href={l.href} target="_blank" rel="noopener noreferrer" title={l.href}><IconGlobe size={11} />{l.label}</a>;
  if (kind === 'file') return <button type="button" className="gu-link" onClick={() => void openFile(l.href,chatId)} title={l.href}><IconFile size={11} />{l.label}</button>;
  return <span className="gu-link off">{l.label}</span>;
}

function Table({ p }: { p: UiTable }) {
  const status = p.rows.some(r => r.status), link = p.rows.some(r => r.link);
  return (
    <div className="gu-table-wrap" tabIndex={0} role="region" aria-label={t('genui.table.region')}>
      <table className="gu-table">
        <thead><tr>{status && <th scope="col">{t('tools.genui.stateHeader')}</th>}{p.columns.map((c, i) => <th scope="col" key={i}>{c}</th>)}{link && <th scope="col"><span className="sr-only">{t('genui.table.links')}</span></th>}</tr></thead>
        <tbody>
          {!p.rows.length && <tr><td colSpan={p.columns.length + Number(status) + Number(link)} className="gu-empty">{t('tools.genui.empty')}</td></tr>}
          {p.rows.map((r, i) => (
            <tr key={i} className={r.status ? `gu-row-${r.status}` : undefined}>
              {status && <td>{r.status && <Status s={r.status} />}</td>}
              {p.columns.map((_, j) => <td key={j}>{r.cells[j] ?? ''}</td>)}
              {link && <td>{r.link && <Link l={r.link} />}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cards({ p }: { p: UiCards }) {
  const RISK = getRisk();
  return (
    <div className="gu-cards">
      {p.options.map((o, i) => (
        <div key={i} className={`gu-card ${o.recommended ? 'rec' : ''}`}>
          <div className="gu-card-head"><b>{o.title}</b>{o.recommended && <span className="gu-rec">{t('tools.genui.recommended')}</span>}</div>
          {o.summary && <p className="gu-card-sum">{o.summary}</p>}
          {!!o.pros?.length && <div className="gu-tradeoffs"><b>{t('genui.cards.pros')}</b><ul className="gu-pros">{o.pros.map((x, j) => <li key={j}><IconCheck size={11} />{x}</li>)}</ul></div>}
          {!!o.cons?.length && <div className="gu-tradeoffs"><b>{t('genui.cards.cons')}</b><ul className="gu-cons">{o.cons.map((x, j) => <li key={j}><IconX size={11} />{x}</li>)}</ul></div>}
          {(o.effort || o.risk) && (
            <div className="gu-card-foot">
              {o.effort && <span>{t('tools.genui.effort')} <b>{o.effort}</b></span>}
              {o.risk && <span className={`gu-risk gu-risk-${o.risk}`}>{t('tools.genui.risk')} <b>{RISK[o.risk]}</b></span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Board({ p }: { p: UiBoard }) {
  return (
    <div className="gu-board">
      {p.lanes.map((l, i) => (
        <div key={i} className={`gu-lane ${l.status ? `gu-lane-${l.status}` : ''}`}>
          <div className="gu-lane-head">{l.status && <Status s={l.status} />}<b>{l.title}</b><span className="gu-count">{l.items.length}</span></div>
          {l.items.map((it, j) => (
            <div key={j} className="gu-item">
              <div className="gu-item-title">{it.status && <Status s={it.status} />}<span>{it.title}</span></div>
              {it.detail && <div className="gu-item-detail">{it.detail}</div>}
              {!!it.links?.length && <div className="gu-item-links">{it.links.map((x, k) => <Link key={k} l={x} />)}</div>}
            </div>
          ))}
          {!l.items.length && <div className="gu-empty">{t('tools.genui.empty')}</div>}
        </div>
      ))}
    </div>
  );
}

/** A file's own link, else its path when absolute, else the path inside the chat's folder. */
function fileHref(f: UiDiffList['groups'][number]['files'][number], cwd?: string): string | null {
  if (f.href) return f.href;
  if (safeHref(f.path) === 'file') return f.path;
  if (!cwd || /^[\\/]|\.\./.test(f.path)) return null;
  // the folder's own separator: a Windows folder joins with \, a macOS/Linux one with / (ADR 0054)
  return cwd.startsWith('/') ? `${cwd.replace(/\/+$/, '')}/${f.path.replace(/\\/g, '/')}` : `${cwd.replace(/[\\/]+$/, '')}\\${f.path.replace(/\//g, '\\')}`;
}

/** Copia: the text to the clipboard, a check for a moment. */
function CopyBtn({ text, label, testid }: { text: string; label: string; testid?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 1500); return () => clearTimeout(t); }, [done]);
  return (
    <button type="button" className="gu-btn gu-copy" onClick={() => { void copyText(text).then(ok => (ok ? setDone(true) : toast(t('tools.genui.copyFailed'), 'err'))); }}
      aria-label={done ? t('tools.genui.copyDone') : label} data-tip={done ? t('tools.genui.copyDone') : label} data-testid={testid}>
      {done ? <IconCheck size={12} /> : <IconCopy size={12} />}
    </button>
  );
}

function DiffList({ p, cwd }: { p: UiDiffList; cwd?: string }) {
  const chatId=useContext(FileChat);
  return (
    <div className="gu-diff">
      {p.groups.map((g, i) => (
        <div key={i} className="gu-diff-group">
          <div className="gu-diff-area"><b>{g.area}</b><span className="gu-count">{g.files.length}</span></div>
          {g.files.map((f, j) => {
            const h = fileHref(f, cwd);
            const name = <span className="mono">{f.path}</span>;
            return (
              <div key={j} className="gu-diff-file"><IconFile size={15} />
                {h ? (safeHref(h) === 'web'
                  ? <a className="gu-path" href={h} target="_blank" rel="noopener noreferrer" title={h}>{name}</a>
                  : <button type="button" className="gu-path" onClick={() => void openFile(h,chatId)} title={h}>{name}</button>)
                  : <span className="gu-path off">{name}</span>}
                {(f.added !== undefined || f.removed !== undefined) && <span className="gu-diff-n"><span className="add">+{f.added ?? 0}</span> <span className="del">−{f.removed ?? 0}</span></span>}
                <CopyBtn text={f.path} label={t('tools.genui.copyPath', { path: f.path })} />
                {f.why && <span className="gu-why">{f.why}</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function UiView({ spec, cwd }: { spec: UiSpec; cwd?: string }) {
  switch (spec.component) {
    case 'table': return <Table p={spec.props} />;
    case 'cards': return <Cards p={spec.props} />;
    case 'board': return <Board p={spec.props} />;
    case 'diffList': return <DiffList p={spec.props} cwd={cwd} />;
    case 'barChart': return <BarChart p={spec.props} />;
    case 'brief': return <BriefCard p={spec.props} />;
  }
}

/** A brief that never met its question (shown as a plain card after the wait): the evidence and what Sì / No would do. */
function BriefCard({ p }: { p: UiBrief }) {
  const chatId = useContext(FileChat);
  return (
    <div className="gu-brief">
      <BriefEvidence brief={p} testBase="brief" size="m" onFile={h => void openFile(h, chatId)} />
      <p className="gu-brief-fx"><b>{t('genui.decision.ifYes')}:</b> {p.ifYes}<br /><b>{t('genui.decision.ifNo')}:</b> {p.ifNo}</p>
    </div>
  );
}

/** A view that fails to draw shows its plain summary instead (and never takes the chat down with it). */
class Boundary extends Component<{ fallback: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidUpdate(prev: Readonly<{ fallback: string; children: ReactNode }>) {
    if (this.state.failed && prev.children !== this.props.children) this.setState({ failed: false });
  }
  override render() {
    return this.state.failed ? <div className="gu-fallback" role="note"><IconAlert size={12} />{this.props.fallback}</div> : this.props.children;
  }
}

export function SafeView({ spec, summary, cwd,chatId }: { spec: UiSpec; summary: string; cwd?: string;chatId?:string }) {
  return <FileChat.Provider value={chatId}><Boundary fallback={summary}><UiView spec={spec} cwd={cwd} /></Boundary></FileChat.Provider>;
}

/** The full-width view over the app (the user's click): an app dialog (ui.modal 'visual'), so the questions window hides
 *  under it and a new question never takes its keyboard; Modal traps Tab, Esc or ✕ closes it and the keyboard goes back
 *  where it was. Another dialog opening (Ctrl+K) closes it. */
function FullView({ item, cwd, onClose,chatId }: { item: Art; cwd?: string; onClose: () => void;chatId?:string }) {
  const modal = ui.use(s => s.modal);
  const seen = useRef(false);
  useLayoutEffect(() => {
    openModal('visual');
    return () => { if (ui.get().modal === 'visual') closeModal(); };
  }, []);
  // closes only once its own dialog state was in place and something else replaced it
  useLayoutEffect(() => { if (modal === 'visual') seen.current = true; else if (seen.current) onClose(); }, [modal, onClose]);
  // React events bubble through the portal to the card's ancestors (a question panel's digits, the questions window's
  // click): they stop here, so a key or a click in the visual never answers anything
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <span className="gu-full-events" onKeyDown={stop} onMouseDown={stop} onPointerDown={stop} onClick={stop}>
      <Modal onClose={onClose} label={item.title} testid={`artifact-full-${item.key}`} className="gu-full">
        <div className="gu-head">
          {getKind()[item.ui.component].icon}<b className="gu-title">{item.title}</b><span className="gu-kind">{getKind()[item.ui.component].label}</span>
          {item.from && <span className="gu-from">{t('tools.genui.fromItem', { from: item.from })}</span>}
          <span className="sp" />
          <CopyBtn text={textOfUi(item.ui, item.title)} label={t('tools.genui.copyAsText')} />
          <button type="button" className="gu-btn" onClick={onClose} aria-label={t('tools.genui.closeEsc')} data-autofocus data-testid={`artifact-close-${item.key}`}><IconX size={14} /></button>
        </div>
        <p className="gu-sum">{item.summary}</p>
        <div className="gu-full-body"><SafeView spec={item.ui} summary={item.summary} cwd={cwd} chatId={chatId}/></div>
      </Modal>
    </span>
  );
}

/** A visual in a list (a chat's items, a question's context): compact, the whole of it a click away. */
export const ArtifactCard = memo(function ArtifactCard({ item, cwd, attached,chatId }: { item: Art; cwd?: string; attached?: boolean;chatId?:string }) {
  const [full, setFull] = useState(false);
  const close = useCallback(() => setFull(false), []);
  const k = getKind()[item.ui.component];
  return (
    <div className={`gu-art ${attached ? 'attached' : ''}`} data-testid={`artifact-${item.key}`} data-component={item.ui.component}>
      <div className="gu-head">
        {k.icon}<b className="gu-title">{item.title}</b><span className="gu-kind">{k.label}</span>
        {item.from && <span className="gu-from" data-testid={`artifact-from-${item.key}`}>{t('tools.genui.fromItem', { from: item.from })}</span>}
        {item.askId && !attached && <span className="gu-kind">{t('tools.genui.onTheQuestion')}</span>}
        <span className="sp" />
        <CopyBtn text={textOfUi(item.ui, item.title)} label={t('tools.genui.copyAsText')} testid={`artifact-copy-${item.key}`} />
        <button type="button" className="gu-btn" onClick={() => setFull(true)} aria-label={t('tools.genui.openFullWidthTitle', { title: item.title })} data-tip={t('tools.genui.openFullWidth')}
          data-testid={`artifact-expand-${item.key}`}><IconMaximize size={13} /></button>
      </div>
      <p className="gu-sum" role="status" aria-live="polite" aria-atomic="true">{item.summary}</p>
      <div className="gu-body" onClick={e => { if (!(e.target as HTMLElement).closest('a, button')) setFull(true); }}>
        <SafeView spec={item.ui} summary={item.summary} cwd={cwd} chatId={chatId}/>
      </div>
      {full && <FullView item={item} cwd={cwd} onClose={close} chatId={chatId}/>}
    </div>
  );
});

/** The visuals a chat attached to this question (show_ui target next-ask), always in sight above its context
 *  (`noBrief`: without its brief, which the decision card draws on its own). */
export function AskArtifacts({ req, testBase, noBrief }: { req: PendingRequest; testBase: string; noBrief?: boolean }) {
  const arts = useApp(s => s.items[req.chatId]);
  const cwd = useApp(s => s.chats[req.chatId]?.cwd);
  const mine = useMemo(() => (arts ?? []).filter((i): i is Art => i.kind === 'artifact' && i.askId === req.id && !(noBrief && i.ui.component === 'brief')), [arts, req.id, noBrief]);
  if (!mine.length) return null;
  return <div className="gu-ask" data-testid={`${testBase}-visuals`}>{mine.map(a => <ArtifactCard key={a.id} item={a} cwd={cwd} chatId={req.chatId} attached />)}</div>;
}

/** An option's preview: its markdown, with each ```sb-ui fence drawn as a catalog view (a wrong one shows its error). */
export function UiPreview({ text,chatId }: { text: string;chatId?:string }) {
  const parts = useMemo(() => splitUiFences(text), [text]);
  return (
    <>
      {parts.map((p, i) => p.kind === 'md'
        ? <div key={i} className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(p.text) }} />
        : p.kind === 'ui'
          ? <div key={i} className="gu-preview" data-testid="preview-visual" data-component={p.spec.component}>{p.title && <b className="gu-title">{p.title}</b>}<SafeView spec={p.spec} summary={describeUi(p.spec)} chatId={chatId}/></div>
          : <div key={i} className="gu-fallback" role="note" data-testid="preview-visual-bad"><IconAlert size={12} />{p.error}<pre className="tool-pre">{p.raw}</pre></div>)}
    </>
  );
}
