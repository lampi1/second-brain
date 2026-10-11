// The transcript of a chat tile: user bubbles, markdown assistant text (streaming caret), collapsed thinking, tool
// rows (status icon, +/− counts, expandable diff or output), system notices (the "Dove eravamo" recap styled apart)
// and turn results. Each row is memoized by its item, so a streaming message re-renders only itself (its markdown is
// re-parsed at most once a frame); tool rows show live elapsed time; a "sta scrivendo… / sta pensando…" line follows the
// turn; the list follows the bottom ONLY when the user is already there (scrolled up to read, it never jumps: a
// "nuove righe" pill appears instead). Used by ChatTile and RegiaTile.
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatItem, FileDiff } from '@shared/contract';
import { diffTotals, duration, formatCost, toolLabel } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { useNow } from '../lib/clock';
import { IconAlert, IconArrowDown, IconCheck, IconChevronRight, IconInfo, IconSparkle, IconSpinner, IconX } from './Icons';

type Tool = Extract<ChatItem, { kind: 'tool' }>;

/** While streaming, the text shown follows the latest at most once per animation frame (one markdown parse a frame). */
function useFrameText(text: string, streaming?: boolean): string {
  const [shown, setShown] = useState(text);
  const latest = useRef(text);
  latest.current = text;
  useEffect(() => {
    if (!streaming) { setShown(text); return; }
    const id = requestAnimationFrame(() => setShown(latest.current));
    return () => cancelAnimationFrame(id);
  }, [text, streaming]);
  return streaming ? shown : text;
}

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const t = useFrameText(text, streaming);
  return <div className={`md ${streaming ? 'streaming' : ''}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(t || '…') }} />;
});

/** The live line of a running turn. */
export function Typing({ what, testid }: { what: 'scrive' | 'pensa' | 'lavora'; testid?: string }) {
  const text = what === 'scrive' ? 'sta scrivendo…' : what === 'pensa' ? 'sta pensando…' : 'sta lavorando…';
  return <div className="typing" role="status" aria-live="off" data-testid={testid} data-what={what}><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>{text}</div>;
}

function DiffView({ diff }: { diff: FileDiff[] }) {
  return (
    <div className="diff">
      {diff.map(d => (
        <div className="diff-file" key={d.path}>
          <div className="diff-path"><span className="mono">{d.path}</span><span className="sp" /><span className="add">+{d.added}</span><span className="del">−{d.removed}</span></div>
          {d.patch && (
            <pre className="diff-patch">
              {d.patch.split('\n').map((l, i) => <span key={i} className={l.startsWith('+') ? 'l-add' : l.startsWith('-') ? 'l-del' : l.startsWith('@@') ? 'l-hunk' : ''}>{l || ' '}{'\n'}</span>)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const now = useNow(1000);
  return <span className="tool-meta">{duration(now - since)}</span>;
}

const ToolRow = memo(function ToolRow({ item }: { item: Tool }) {
  const [open, setOpen] = useState(false);
  const totals = diffTotals(item.diff);
  const hasMore = !!(item.output || item.diff?.length || (item.input && typeof item.input === 'object' && Object.keys(item.input as object).length));
  const label = toolLabel(item.name);
  return (
    <div className={`tool tool-${item.status} ${open ? 'open' : ''}`} data-testid={`tool-${item.id}`} data-status={item.status}>
      <button type="button" className="tool-row" data-testid={`tool-toggle-${item.id}`} onClick={() => hasMore && setOpen(o => !o)} aria-expanded={hasMore ? open : undefined} disabled={!hasMore}
        aria-label={`${label}: ${item.summary} (${item.status === 'running' ? 'in corso' : item.status === 'ok' ? 'fatto' : 'errore'})`}>
        <span className="tool-icon">{item.status === 'running' ? <IconSpinner size={13} /> : item.status === 'ok' ? <IconCheck size={13} /> : <IconX size={13} />}</span>
        <span className="tool-name">{label}</span>
        <span className="tool-sum">{item.summary}</span>
        <span className="sp" />
        {totals && <span className="tool-diff"><span className="add">+{totals.added}</span> <span className="del">−{totals.removed}</span></span>}
        {item.status === 'running' && <Elapsed since={item.at} />}
        {hasMore && <IconChevronRight size={13} className="tool-chev" />}
      </button>
      {open && (
        <div className="tool-body">
          {item.diff?.length ? <DiffView diff={item.diff} /> : null}
          {!item.diff?.length && item.input !== undefined && <pre className="tool-pre">{typeof item.input === 'string' ? item.input : JSON.stringify(item.input, null, 2)}</pre>}
          {item.output && <pre className="tool-pre out">{item.output}</pre>}
        </div>
      )}
    </div>
  );
});

const Thinking = memo(function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`thinking ${open ? 'open' : ''}`}>
      <button type="button" className="thinking-row" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid="thinking-toggle">
        <IconSparkle size={13} /><span>Ragionamento</span><IconChevronRight size={12} className="tool-chev" />
      </button>
      {open && <div className="thinking-text">{text}</div>}
    </div>
  );
});

export const Item = memo(function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user': return <div className={`msg-user ${item.id.startsWith('local:') ? 'optimistic' : ''}`} data-testid={`item-${item.id}`}><div className="bubble">{item.text}</div></div>;
    case 'assistant': return <div className="msg-assistant" data-testid={`item-${item.id}`}><Markdown text={item.text} streaming={item.streaming} /></div>;
    case 'thinking': return <Thinking text={item.text} />;
    case 'tool': return <ToolRow item={item} />;
    case 'system': {
      const recap = /^dove eravamo/i.test(item.text);
      return (
        <div className={`notice notice-${item.level} ${recap ? 'recap' : ''}`} role={item.level === 'error' ? 'alert' : undefined}>
          {item.level === 'info' ? <IconInfo size={13} /> : <IconAlert size={13} />}<span>{item.text}</span>
        </div>
      );
    }
    case 'result':
      return (
        <div className={`result ${item.isError ? 'err' : ''}`}>
          <span className="result-line" />
          <span>{item.isError ? 'Turno finito con errore' : 'Turno finito'} · {formatCost(item.costUsd)} · {duration(item.durationMs)}{item.turns > 1 ? ` · ${item.turns} passi` : ''}</span>
          <span className="result-line" />
        </div>
      );
  }
});

/** The scrolling list, sticky to the bottom. */
/** What a running turn is doing, from its last item: writing (streaming text), working (a tool runs), thinking. */
export function turnActivity(items: readonly ChatItem[] | undefined): 'scrive' | 'pensa' | 'lavora' {
  const last = items?.[items.length - 1];
  if (last?.kind === 'assistant' && last.streaming) return 'scrive';
  if (last?.kind === 'tool' && last.status === 'running') return 'lavora';
  return 'pensa';
}

export function ItemList({ items, empty, footer }: { items: readonly ChatItem[]; empty?: string; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [unseen, setUnseen] = useState(false);
  const last = items[items.length - 1];
  const lastSig = last ? `${last.id}:${'text' in last ? last.text.length : 0}:${last.kind === 'tool' ? last.status : ''}` : '';
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (stick.current) el.scrollTop = el.scrollHeight;
    else setUnseen(true);
  }, [lastSig, items.length]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // content grows a frame after the item changes (markdown parsed once per frame): follow it, only if at the bottom
    const follow = () => { if (stick.current) el.scrollTop = el.scrollHeight; };
    const ro = new ResizeObserver(follow);
    ro.observe(el);
    const mo = new MutationObserver(follow);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (stick.current) setUnseen(false);
  };
  return (
    <div className="items-wrap">
      <div className="items" ref={ref} onScroll={onScroll} role="log" aria-live="off">
        {items.length === 0 && empty && !footer ? <div className="items-empty">{empty}</div> : items.map(i => <Item key={i.id} item={i} />)}
        {footer}
      </div>
      {unseen && (
        <button type="button" className="unseen" data-testid="unseen" onClick={() => { const el = ref.current; if (el) { el.scrollTop = el.scrollHeight; stick.current = true; setUnseen(false); } }}>
          <IconArrowDown size={13} /> nuove righe
        </button>
      )}
    </div>
  );
}
