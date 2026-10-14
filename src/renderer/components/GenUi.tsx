// Generative UI, the views (ADR 0033): the catalog of trusted components a chat can show (show_ui, or an ```sb-ui fence
// in a question option's preview), drawn from checked props (shared/genui.ts), never from HTML: table, cards (decision
// options), board (lanes of items: QA cases, chat status), diffList (changed files by area, clickable), barChart (inline
// SVG). Each view sits in an error boundary whose fallback is the plain summary. ArtifactCard = a visual in a chat's
// list (compact; click or ⤢ = full width over the app, Esc closes); AskArtifacts = the visuals attached to a question;
// UiPreview = an option's preview with its sb-ui fences drawn. None of them answers anything: their keys stay theirs
// (Esc in the full view never reaches a question panel). Used by ChatItems.tsx and AskContext.tsx.
import { Component, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChatItem, PendingRequest, UiBarChart, UiBoard, UiCards, UiDiffList, UiLink, UiSpec, UiStatus, UiTable } from '@shared/contract';
import { describeUi, safeHref, splitUiFences, textOfUi } from '@shared/genui';
import { renderMarkdown } from '../lib/markdown';
import { sb } from '../sb';
import { useApp } from '../store/store';
import { closeModal, openModal, toast, ui } from '../store/ui';
import { IconAlert, IconChart, IconCheck, IconColumns, IconCopy, IconFile, IconGlobe, IconLayers, IconList, IconMaximize, IconX } from './Icons';
import { Modal } from './ui';
import { copyText } from '../brain/components/ui';

type Art = Extract<ChatItem, { kind: 'artifact' }>;

/** A local file named by a chat, opened on the user's click (main/open-path.ts decides how: documents open, the rest
 *  is only shown in its folder). */
export async function openFile(href: string): Promise<void> {
  try {
    const r = await sb.invoke('app:openPath', { path: href });
    if (r.how === 'folder') toast('Mostrato nella sua cartella: non è un documento da aprire qui.', 'info');
    else if (r.how === 'missing' || r.how === 'refused') toast(r.reason, 'err');
  } catch (e) { toast(`File non aperto: ${e instanceof Error ? e.message : String(e)}`, 'err'); }
}

const STATUS: Record<UiStatus, string> = { ok: 'OK', fail: 'Fallito', blocked: 'Bloccato', running: 'In corso', todo: 'Da fare', info: 'Info', warn: 'Attenzione' };
const KIND: Record<UiSpec['component'], { label: string; icon: ReactNode }> = {
  table: { label: 'Tabella', icon: <IconList size={13} /> },
  cards: { label: 'Opzioni', icon: <IconColumns size={13} /> },
  board: { label: 'Bacheca', icon: <IconLayers size={13} /> },
  diffList: { label: 'File cambiati', icon: <IconFile size={13} /> },
  barChart: { label: 'Grafico', icon: <IconChart size={13} /> },
};
const RISK = { low: 'basso', medium: 'medio', high: 'alto' } as const;

function Status({ s }: { s: UiStatus }) {
  return <span className={`gu-status gu-${s}`}><i aria-hidden="true" />{STATUS[s]}</span>;
}

function Link({ l }: { l: UiLink }) {
  const kind = safeHref(l.href);
  if (kind === 'web') return <a className="gu-link" href={l.href} target="_blank" rel="noopener noreferrer" title={l.href}><IconGlobe size={11} />{l.label}</a>;
  if (kind === 'file') return <button type="button" className="gu-link" onClick={() => void openFile(l.href)} title={l.href}><IconFile size={11} />{l.label}</button>;
  return <span className="gu-link off">{l.label}</span>;
}

function Table({ p }: { p: UiTable }) {
  const status = p.rows.some(r => r.status), link = p.rows.some(r => r.link);
  return (
    <div className="gu-table-wrap">
      <table className="gu-table">
        <thead><tr>{status && <th>Stato</th>}{p.columns.map((c, i) => <th key={i}>{c}</th>)}{link && <th />}</tr></thead>
        <tbody>
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
  return (
    <div className="gu-cards">
      {p.options.map((o, i) => (
        <div key={i} className={`gu-card ${o.recommended ? 'rec' : ''}`}>
          <div className="gu-card-head"><b>{o.title}</b>{o.recommended && <span className="gu-rec">Consigliata</span>}</div>
          {o.summary && <p className="gu-card-sum">{o.summary}</p>}
          {!!o.pros?.length && <ul className="gu-pros">{o.pros.map((x, j) => <li key={j}><IconCheck size={11} />{x}</li>)}</ul>}
          {!!o.cons?.length && <ul className="gu-cons">{o.cons.map((x, j) => <li key={j}><IconX size={11} />{x}</li>)}</ul>}
          {(o.effort || o.risk) && (
            <div className="gu-card-foot">
              {o.effort && <span>Sforzo: <b>{o.effort}</b></span>}
              {o.risk && <span className={`gu-risk gu-risk-${o.risk}`}>Rischio: <b>{RISK[o.risk]}</b></span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** A lane's status: the dot, and its word unless the lane's title already says it ("Falliti" for fail), never color alone. */
function LaneStatus({ s, title }: { s: UiStatus; title: string }) {
  const said = title.toLowerCase().includes(STATUS[s].toLowerCase().slice(0, 5));
  return said ? <i className={`gu-dot gu-${s}`} aria-hidden="true" /> : <Status s={s} />;
}

function Board({ p }: { p: UiBoard }) {
  return (
    <div className="gu-board">
      {p.lanes.map((l, i) => (
        <div key={i} className={`gu-lane ${l.status ? `gu-lane-${l.status}` : ''}`}>
          <div className="gu-lane-head">{l.status && <LaneStatus s={l.status} title={l.title} />}<b>{l.title}</b><span className="gu-count">{l.items.length}</span></div>
          {l.items.map((it, j) => (
            <div key={j} className="gu-item">
              <div className="gu-item-title">{it.status && <Status s={it.status} />}<span>{it.title}</span></div>
              {it.detail && <div className="gu-item-detail">{it.detail}</div>}
              {!!it.links?.length && <div className="gu-item-links">{it.links.map((x, k) => <Link key={k} l={x} />)}</div>}
            </div>
          ))}
          {!l.items.length && <div className="gu-empty">vuota</div>}
        </div>
      ))}
    </div>
  );
}

/** A file's own link, else its path when absolute, else the path inside the chat's folder. */
function fileHref(f: UiDiffList['groups'][number]['files'][number], cwd?: string): string | null {
  if (f.href) return f.href;
  if (safeHref(f.path) === 'file') return f.path;
  return cwd && !/^[\\/]|\.\./.test(f.path) ? `${cwd.replace(/[\\/]+$/, '')}\\${f.path.replace(/\//g, '\\')}` : null;
}

/** Copia: the text to the clipboard, a check for a moment. */
function CopyBtn({ text, label, testid }: { text: string; label: string; testid?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 1500); return () => clearTimeout(t); }, [done]);
  return (
    <button type="button" className="gu-btn gu-copy" onClick={() => { void copyText(text).then(ok => (ok ? setDone(true) : toast('Copia non riuscita', 'err'))); }}
      aria-label={done ? 'Copiato' : label} data-tip={done ? 'Copiato' : label} data-testid={testid}>
      {done ? <IconCheck size={12} /> : <IconCopy size={12} />}
    </button>
  );
}

function DiffList({ p, cwd }: { p: UiDiffList; cwd?: string }) {
  return (
    <div className="gu-diff">
      {p.groups.map((g, i) => (
        <div key={i} className="gu-diff-group">
          <div className="gu-diff-area"><b>{g.area}</b><span className="gu-count">{g.files.length}</span></div>
          {g.files.map((f, j) => {
            const h = fileHref(f, cwd);
            const name = <span className="mono">{f.path}</span>;
            return (
              <div key={j} className="gu-diff-file">
                {h ? (safeHref(h) === 'web'
                  ? <a className="gu-path" href={h} target="_blank" rel="noopener noreferrer" title={h}>{name}</a>
                  : <button type="button" className="gu-path" onClick={() => void openFile(h)} title={h}>{name}</button>)
                  : <span className="gu-path off">{name}</span>}
                {(f.added !== undefined || f.removed !== undefined) && <span className="gu-diff-n"><span className="add">+{f.added ?? 0}</span> <span className="del">−{f.removed ?? 0}</span></span>}
                <CopyBtn text={f.path} label={`Copia il percorso ${f.path}`} />
                {f.why && <span className="gu-why">{f.why}</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('it-IT') : v.toLocaleString('it-IT', { maximumFractionDigits: 2 }));

/** One series of horizontal bars (inline SVG): one hue, rounded data end, 2 px gap, value at the bar's end, a tooltip
 *  per bar; a zero line when values go negative. */
function BarChart({ p }: { p: UiBarChart }) {
  const W = 640, LABEL = 170, VAL = 80, ROW = 22, BAR = 14;
  const lo = Math.min(0, ...p.bars.map(b => b.value)), hi = Math.max(0, ...p.bars.map(b => b.value));
  const span = hi - lo || 1;
  const plot = W - LABEL - VAL;
  const x = (v: number) => LABEL + ((v - lo) / span) * plot;
  const H = p.bars.length * ROW + 4;
  const unit = p.unit ? ` ${p.unit}` : '';
  return (
    <svg className="gu-bars" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={p.bars.map(b => `${b.label}: ${fmt(b.value)}${unit}`).join('; ')}>
      <line x1={x(0)} x2={x(0)} y1={0} y2={H} className="gu-axis" />
      {p.bars.map((b, i) => {
        const y = i * ROW + 4, x0 = x(Math.min(0, b.value)), w = Math.max(2, Math.abs(x(b.value) - x(0)));
        const r = Math.min(4, w / 2);
        // rounded only at the data end (the end away from zero)
        const d = b.value >= 0
          ? `M${x0},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${BAR - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z`
          : `M${x0 + w},${y}h-${w - r}a${r},${r} 0 0 0 -${r},${r}v${BAR - 2 * r}a${r},${r} 0 0 0 ${r},${r}h${w - r}z`;
        return (
          <g key={i} className="gu-bar">
            <title>{`${b.label}: ${fmt(b.value)}${unit}${b.note ? ` · ${b.note}` : ''}`}</title>
            <rect x={0} y={y - 3} width={W} height={ROW} className="gu-hit" />
            <text x={LABEL - 8} y={y + BAR / 2} className="gu-label" textAnchor="end" dominantBaseline="central">{b.label.length > 26 ? `${b.label.slice(0, 25)}…` : b.label}</text>
            <path d={d} className="gu-fill" />
            <text x={(b.value >= 0 ? x0 + w : x0) + (b.value >= 0 ? 6 : -6)} y={y + BAR / 2} className="gu-value" textAnchor={b.value >= 0 ? 'start' : 'end'} dominantBaseline="central">{fmt(b.value)}{unit}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function UiView({ spec, cwd }: { spec: UiSpec; cwd?: string }) {
  switch (spec.component) {
    case 'table': return <Table p={spec.props} />;
    case 'cards': return <Cards p={spec.props} />;
    case 'board': return <Board p={spec.props} />;
    case 'diffList': return <DiffList p={spec.props} cwd={cwd} />;
    case 'barChart': return <BarChart p={spec.props} />;
  }
}

/** A view that fails to draw shows its plain summary instead (and never takes the chat down with it). */
class Boundary extends Component<{ fallback: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() {
    return this.state.failed ? <div className="gu-fallback" role="note"><IconAlert size={12} />{this.props.fallback}</div> : this.props.children;
  }
}

export function SafeView({ spec, summary, cwd }: { spec: UiSpec; summary: string; cwd?: string }) {
  return <Boundary fallback={summary}><UiView spec={spec} cwd={cwd} /></Boundary>;
}

/** The full-width view over the app (the user's click): an app dialog (ui.modal 'visual'), so the questions window hides
 *  under it and a new question never takes its keyboard; Modal traps Tab, Esc or ✕ closes it and the keyboard goes back
 *  where it was. Another dialog opening (Ctrl+K) closes it. */
function FullView({ item, cwd, onClose }: { item: Art; cwd?: string; onClose: () => void }) {
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
          {KIND[item.ui.component].icon}<b className="gu-title">{item.title}</b><span className="gu-kind">{KIND[item.ui.component].label}</span>
          {item.from && <span className="gu-from">da «{item.from}»</span>}
          <span className="sp" />
          <CopyBtn text={textOfUi(item.ui, item.title)} label="Copia come testo" />
          <button type="button" className="gu-btn" onClick={onClose} aria-label="Chiudi (Esc)" data-autofocus data-testid={`artifact-close-${item.key}`}><IconX size={14} /></button>
        </div>
        <p className="gu-sum">{item.summary}</p>
        <div className="gu-full-body"><SafeView spec={item.ui} summary={item.summary} cwd={cwd} /></div>
      </Modal>
    </span>
  );
}

/** A visual in a list (a chat's items, a question's context): compact, the whole of it a click away. */
export const ArtifactCard = memo(function ArtifactCard({ item, cwd, attached }: { item: Art; cwd?: string; attached?: boolean }) {
  const [full, setFull] = useState(false);
  const close = useCallback(() => setFull(false), []);
  const k = KIND[item.ui.component];
  return (
    <div className={`gu-art ${attached ? 'attached' : ''}`} data-testid={`artifact-${item.key}`} data-component={item.ui.component}>
      <div className="gu-head">
        {k.icon}<b className="gu-title">{item.title}</b><span className="gu-kind">{k.label}</span>
        {item.from && <span className="gu-from" data-testid={`artifact-from-${item.key}`}>da «{item.from}»</span>}
        {item.askId && !attached && <span className="gu-kind">sulla domanda</span>}
        <span className="sp" />
        <CopyBtn text={textOfUi(item.ui, item.title)} label="Copia come testo" testid={`artifact-copy-${item.key}`} />
        <button type="button" className="gu-btn" onClick={() => setFull(true)} aria-label={`Apri «${item.title}» a tutta larghezza`} data-tip="Apri a tutta larghezza"
          data-testid={`artifact-expand-${item.key}`}><IconMaximize size={13} /></button>
      </div>
      <p className="gu-sum">{item.summary}</p>
      <div className="gu-body" onClick={e => { if (!(e.target as HTMLElement).closest('a, button')) setFull(true); }}>
        <SafeView spec={item.ui} summary={item.summary} cwd={cwd} />
      </div>
      {full && <FullView item={item} cwd={cwd} onClose={close} />}
    </div>
  );
});

/** The visuals a chat attached to this question (show_ui target next-ask), always in sight above its context. */
export function AskArtifacts({ req, testBase }: { req: PendingRequest; testBase: string }) {
  const arts = useApp(s => s.items[req.chatId]);
  const cwd = useApp(s => s.chats[req.chatId]?.cwd);
  const mine = useMemo(() => (arts ?? []).filter((i): i is Art => i.kind === 'artifact' && i.askId === req.id), [arts, req.id]);
  if (!mine.length) return null;
  return <div className="gu-ask" data-testid={`${testBase}-visuals`}>{mine.map(a => <ArtifactCard key={a.id} item={a} cwd={cwd} attached />)}</div>;
}

/** An option's preview: its markdown, with each ```sb-ui fence drawn as a catalog view (a wrong one shows its error). */
export function UiPreview({ text }: { text: string }) {
  const parts = useMemo(() => splitUiFences(text), [text]);
  return (
    <>
      {parts.map((p, i) => p.kind === 'md'
        ? <div key={i} className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(p.text) }} />
        : p.kind === 'ui'
          ? <div key={i} className="gu-preview" data-testid="preview-visual" data-component={p.spec.component}>{p.title && <b className="gu-title">{p.title}</b>}<SafeView spec={p.spec} summary={describeUi(p.spec)} /></div>
          : <div key={i} className="gu-fallback" role="note" data-testid="preview-visual-bad"><IconAlert size={12} />{p.error}<pre className="tool-pre">{p.raw}</pre></div>)}
    </>
  );
}
