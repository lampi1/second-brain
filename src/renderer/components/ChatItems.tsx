// The transcript of a chat tile: user bubbles (what the user did not type, mail, agents' prompts, app news, Esegui
// results, folds to one muted line: lib/foreign.ts), markdown assistant text (streaming caret), collapsed thinking (open when it is the prose right before a question; a sentence of it can be corrected:
// CorrectThought.tsx, ADR 0058, the correction shown as its own bubble), tool
// rows (a plain Italian line of what the tool does, shared/explain.ts; status icon, +/− counts; the raw command, diff
// or output folded under it), system notices (the "Dove eravamo" recap styled apart; the "continua da qui" divider of a
// cold continuation, with the previous session folded above it: ADR 0031), turn results and the visuals a chat showed
// with show_ui (GenUi.tsx ArtifactCard; one waiting for its question is hidden). Code blocks of assistant messages get their own toolbar (Copia; Esegui on shell blocks of an app
// chat: CodeBlock.tsx; the chat id comes from ItemList's chatId); a click on copyable inline code copies it, on a file path or a link it opens a preview (LinkPeek.tsx). Each row is memoized by its item, so a streaming
// message re-renders only itself (at most once a frame, re-parsing only its last markdown block); tool rows show live
// elapsed time; in a Regia, an "Apri" chip under the chats she opened, wrote to or named (ChatRefChips.tsx, ADR 0034)
// and a "Nuova chat" badge on a message sent with that toggle (shared/newchat.ts); a "sta scrivendo… / sta pensando…" line follows the turn; the list follows the bottom ONLY when the
// user is already there (scrolled up to read, it never jumps: a "nuove righe" pill appears instead). Used by ChatTile
// and RegiaTile.
import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChatItem, FileDiff } from '@shared/contract';
import { diffTotals, duration, formatCost, toolLabel } from '../lib/format';
import { markdownParts, renderMarkdown, splitBlocks, type MdPart } from '../lib/markdown';
import { CodeBlock } from './CodeBlock';
import { explainTool } from '@shared/explain';
import { useNow } from '../lib/clock';
import { IconAlert, IconArrowDown, IconBell, IconCheck, IconChevronRight, IconInfo, IconLink, IconPlus, IconRefresh, IconSend, IconSparkle, IconSpinner, IconTerminal, IconX } from './Icons';
import { splitNotes } from '../lib/sendable';
import { FOREIGN_LABEL, foreignOf, showsSender, type Foreign, type ForeignKind } from '../lib/foreign';
import { ImageStrip } from './ImageStrip';
import { thinkingBeforeAsk } from '../lib/askContext';
import { useApp } from '../store/store';
import { chatRefsOf, titlesKey, toolChatRef } from '../lib/chatrefs';
import { splitNewChat } from '@shared/newchat';
import { NamedChatRefs, ToolChatRef } from './ChatRefChips';
import { openHandoff } from '../store/ui';
import { ArtifactCard } from './GenUi';
import { useLinkPeek } from './LinkPeek';
import { ThoughtText } from './CorrectThought';
import { correctedThoughts, parseCorrection } from '../lib/correction';

type Tool = Extract<ChatItem, { kind: 'tool' }>;

/** One block of a streaming message: a finished block is parsed once and its DOM is never touched again. */
const MdBlock = memo(function MdBlock({ text, tail }: { text: string; tail: boolean }) {
  return <div className="md-b" dangerouslySetInnerHTML={{ __html: renderMarkdown(text, !tail) }} />;
});

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  // the data store already renders at most once a frame (createStore batch), so the text is drawn in that frame (a
  // second requestAnimationFrame here added one more frame of delay, 80+ ms when the PC is busy); while streaming only the last block is re-parsed each frame (the whole answer re-parsed every frame pinned the
  // renderer at 100% with long answers and made typing lag by seconds); the finished message is parsed whole once
  if (streaming) {
    const blocks = splitBlocks(text || '…');
    return <div className="md streaming">{blocks.map((b, i) => <MdBlock key={i} text={b} tail={i === blocks.length - 1} />)}</div>;
  }
  return <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text || '…') }} />;
});

/** The chat whose items are shown (null: no "Esegui", e.g. a list without a chat). */
const ChatIdCtx = createContext<string | null>(null);

/** A fence line (``` or ~~~): a message without one renders as plain Markdown. */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/m;
type Group = { kind: 'md'; parts: { key: string; html: string }[] } | { kind: 'code'; key: string; part: Extract<MdPart, { kind: 'code' }> };

/** An assistant message: markdown and its fenced code blocks with their toolbar (CodeBlock.tsx), in order. While it
 *  streams, only its last block is re-parsed each frame (splitBlocks: the finished blocks hit the caches and their DOM is
 *  never touched again); the markdown between two code blocks lays out as one .md, its pieces as .md-b. */
const Message = memo(function Message({ id, text, streaming }: { id: string; text: string; streaming?: boolean }) {
  const chatId = useContext(ChatIdCtx);
  const t = text || '…';
  if (!FENCE.test(t)) return <Markdown text={t} streaming={streaming} />;
  const blocks = streaming ? splitBlocks(t) : [t];
  const groups: Group[] = [];
  blocks.forEach((b, bi) => markdownParts(b, !streaming || bi < blocks.length - 1).forEach((part, pi) => {
    // an empty piece (the blank line between two fences, parsed whole) is skipped: streaming and finished give the
    // same groups, so a code block keeps its place (and its Esegui panel) when the message ends
    if (part.kind === 'html' && !part.html.trim()) return;
    const key = `${bi}.${pi}`;
    const last = groups[groups.length - 1];
    if (part.kind === 'code') groups.push({ kind: 'code', key, part });
    else if (last?.kind === 'md') last.parts.push({ key, html: part.html });
    else groups.push({ kind: 'md', parts: [{ key, html: part.html }] });
  }));
  return (
    <div className="msg-md">
      {groups.map((g, i) => {
        const tail = !!streaming && i === groups.length - 1;
        return g.kind === 'md'
          ? <div key={i} className={`md ${tail ? 'streaming' : ''}`}>{g.parts.map(x => <div key={x.key} className="md-b" dangerouslySetInnerHTML={{ __html: x.html }} />)}</div>
          : <CodeBlock key={i} chatId={chatId} itemId={id} lang={g.part.lang} code={g.part.code} streaming={tail} />;
      })}
    </div>
  );
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

/** A message from another chat or the Regia: its "[Messaggio … non scritto dall'utente …]" line is for the model; the
 *  bubble's "Da «…»" header already says it to the user */
export const withoutLabel = (text: string): string => text.replace(/^\[Messaggio [^\n]*\]\s*\n+/, '');

const ToolRow = memo(function ToolRow({ item }: { item: Tool }) {
  const [open, setOpen] = useState(false);
  const totals = diffTotals(item.diff);
  const hasMore = !!(item.output || item.diff?.length || (item.input && typeof item.input === 'object' && Object.keys(item.input as object).length));
  const label = toolLabel(item.name);
  // the plain line on top (what it does), the raw command folded under it (Cursor: its title is the summary after "Kind: ")
  const ex = explainTool(item.name, item.input, item.summary.replace(/^[^:]+:\s*/, ''));
  return (
    <div className={`tool tool-${item.status} ${open ? 'open' : ''}`} data-testid={`tool-${item.id}`} data-status={item.status}>
      <button type="button" className="tool-row" data-testid={`tool-toggle-${item.id}`} onClick={() => hasMore && setOpen(o => !o)} aria-expanded={hasMore ? open : undefined} disabled={!hasMore}
        aria-label={`${ex.line} (${item.status === 'running' ? 'in corso' : item.status === 'ok' ? 'fatto' : 'errore'})`} title={item.summary}>
        <span className="tool-icon">{item.status === 'running' ? <IconSpinner size={13} /> : item.status === 'ok' ? <IconCheck size={13} /> : <IconX size={13} />}</span>
        <span className="tool-line" data-testid={`tool-line-${item.id}`}>{ex.line}</span>
        {/^(Bash|PowerShell|Shell)$/.test(item.name) && <span className="tool-name">{label}</span>}
        <span className="sp" />
        {totals && <span className="tool-diff"><span className="add">+{totals.added}</span> <span className="del">−{totals.removed}</span></span>}
        {item.status === 'running' && <Elapsed since={item.at} />}
        {hasMore && <IconChevronRight size={13} className="tool-chev" />}
      </button>
      {open && (
        <div className="tool-body">
          {item.diff?.length ? <DiffView diff={item.diff} /> : null}
          {!item.diff?.length && (ex.raw ? <pre className="tool-pre cmd" data-testid={`tool-raw-${item.id}`}>{ex.raw}</pre>
            : item.input !== undefined && <pre className="tool-pre">{typeof item.input === 'string' ? item.input : JSON.stringify(item.input, null, 2)}</pre>)}
          {item.output && <pre className="tool-pre out">{item.output}</pre>}
        </div>
      )}
    </div>
  );
});

/** A reasoning block, folded; open (and marked) when it is the only prose right before a question: the model wrote there
 *  what the question is about (lib/askContext.ts thinkingBeforeAsk). */
const Thinking = memo(function Thinking({ text, beforeAsk, marks }: { text: string; beforeAsk?: boolean; marks?: readonly string[] }) {
  const chatId = useContext(ChatIdCtx);
  const [open, setOpen] = useState(!!beforeAsk);
  useEffect(() => { if (beforeAsk) setOpen(true); }, [beforeAsk]);
  return (
    <div className={`thinking ${open ? 'open' : ''} ${beforeAsk ? 'before-ask' : ''}`} data-before-ask={beforeAsk ? '' : undefined}>
      <button type="button" className="thinking-row" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid="thinking-toggle">
        <IconSparkle size={13} /><span>{beforeAsk ? 'Ragionamento · prima della domanda' : 'Ragionamento'}</span><IconChevronRight size={12} className="tool-chev" />
      </button>
      {open && <ThoughtText chatId={chatId} text={text} marks={marks} />}
    </div>
  );
});

const FOREIGN_ICON: Record<ForeignKind, ReactNode> = {
  mail: <IconSend size={12} />, agent: <IconSparkle size={12} />, event: <IconBell size={12} />, run: <IconTerminal size={12} />,
  resume: <IconRefresh size={12} />, hook: <IconLink size={12} />, done: <IconCheck size={12} />,
};

/** A user-role item the user did not type (lib/foreign.ts): one muted line, sender + first words; click opens it. */
const ForeignMsg = memo(function ForeignMsg({ item, f }: { item: Extract<ChatItem, { kind: 'user' }>; f: Foreign }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`msg-foreign foreign-${f.kind} ${open ? 'open' : ''}`} data-testid={`item-${item.id}`} data-foreign={f.kind}>
      <button type="button" className="foreign-row" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid={`item-${item.id}-toggle`}
        title={open ? 'Chiudi' : 'Apri il messaggio intero'}>
        {FOREIGN_ICON[f.kind]}
        <span className="foreign-who">{FOREIGN_LABEL[f.kind]}{showsSender(f) ? <> · «{f.sender}»</> : null}</span>
        {!open && f.summary && <span className="foreign-sum">{f.summary}</span>}
        <IconChevronRight size={12} className="tool-chev" />
      </button>
      {open && <div className="foreign-body" data-testid={`item-${item.id}-body`}>{f.body}<span className="foreign-note">{f.kind === 'done' ? 'Segnato da te con un clic: la chat ha solo queste righe.' : 'Non scritto da te: non vale come tuo ok.'}</span></div>}
    </div>
  );
});

/** A tool row and, for app_create_chat / app_send_to_chat, the chat it is about with "Apri". */
const ToolItem = memo(function ToolItem({ item }: { item: Tool }) {
  const ref = toolChatRef(item);
  if (!ref) return <ToolRow item={item} />;
  return <div className="tool-with-ref"><ToolRow item={item} /><ToolChatRef chatId={ref.chatId} title={ref.title} how={ref.how} /></div>;
});

/** A visual in the chat's list: its relative file paths open inside the chat's folder. */
function ChatArtifact({ item }: { item: Extract<ChatItem, { kind: 'artifact' }> }) {
  const chatId = useContext(ChatIdCtx);
  const cwd = useApp(s => (chatId ? s.chats[chatId]?.cwd : undefined));
  return <ArtifactCard item={item} cwd={item.cwd ?? cwd} />;
}

/** A correction of the reasoning the user sent (lib/correction.ts): the sentence struck through, then the fix. */
function CorrectionBubble({ quote, fix }: { quote: string; fix: string }) {
  return (
    <div className="bubble correction" data-testid="correction-bubble">
      <div className="correction-label">Correzione del ragionamento</div>
      <div className="correction-quote">«{quote}»</div>
      <div>{fix}</div>
    </div>
  );
}

export const Item = memo(function Item({ item, beforeAsk, refs, marks }: { item: ChatItem; beforeAsk?: boolean; refs?: readonly string[]; marks?: readonly string[] }) {
  switch (item.kind) {
    case 'user': {
      const f = foreignOf(item);
      if (f && !item.thumbs?.length && !item.images) return <ForeignMsg item={item} f={f} />;
      // "Nuova chat": the line for the Regia is hidden, a badge says it
      const nc = item.from ? null : splitNewChat(item.text);
      // notes riding on the user's message (Mandato / Copiato / Non serve): a muted line under the bubble
      const own = item.from ? { text: withoutLabel(item.text), notes: [] } : splitNotes(nc?.text ?? item.text);
      const text = own.text;
      const fix = item.from ? null : parseCorrection(text);
      return (
      <div className={`msg-user ${item.id.startsWith('local:') ? 'optimistic' : ''}`} data-testid={`item-${item.id}`} data-new-chat={nc?.newChat ? '' : undefined}>
        {item.thumbs?.length ? <ImageStrip images={item.thumbs.map(thumb => ({ thumb }))} testid={`item-${item.id}-images`} /> : item.images ? <span className="msg-images-count">{item.images === 1 ? '1 immagine' : `${item.images} immagini`}</span> : null}
        {item.from && <div className="msg-from" data-testid={`item-${item.id}-from`}>Da «{item.from}» · non scritto da te</div>}
        {nc?.newChat && <div className="msg-newchat" data-testid={`item-${item.id}-newchat`} data-tip="La Regia apre una chat nuova per questa richiesta"><IconPlus size={11} />Nuova chat</div>}
        {fix ? <CorrectionBubble quote={fix.quote} fix={fix.fix} /> : text && <div className="bubble">{text}</div>}
        {own.notes.length > 0 && <div className="msg-notes" data-testid={`item-${item.id}-notes`} title={own.notes.join('\n')}><IconCheck size={11} /> {own.notes.join(' · ')}</div>}
      </div>
      );
    }
    case 'assistant': return <div className="msg-assistant" data-testid={`item-${item.id}`}><Message id={item.id} text={item.text} streaming={item.streaming} />{refs?.length ? <NamedChatRefs ids={refs} /> : null}</div>;
    case 'thinking': return <Thinking text={item.text} beforeAsk={beforeAsk} marks={marks} />;
    case 'tool': return <ToolItem item={item} />;
    case 'system': {
      if (item.continued) return <ColdDivider session={item.continued.session} />;
      const recap = /^dove eravamo/i.test(item.text);
      return (
        <div className={`notice notice-${item.level} ${recap ? 'recap' : ''}`} role={item.level === 'error' ? 'alert' : undefined}>
          {item.level === 'info' ? <IconInfo size={13} /> : <IconAlert size={13} />}<span>{item.text}</span>
        </div>
      );
    }
    case 'artifact': return item.waiting ? null : <ChatArtifact item={item} />;
    case 'result':
      return (
        <div className={`result ${item.isError ? 'err' : ''}`} data-testid={`item-${item.id}`}>
          <span className="result-line" />
          <span>{item.isError ? 'Turno finito con errore' : item.interrupted ? 'Turno interrotto da te' : 'Turno finito'} · {formatCost(item.costUsd)} · {duration(item.durationMs)}{item.turns > 1 ? ` · ${item.turns} passi` : ''}</span>
          <span className="result-line" />
        </div>
      );
  }
});

/** The divider of a cold continuation (ADR 0031): the same chat goes on in a fresh session from its hand-off note. */
function ColdDivider({ session }: { session: string | undefined }) {
  const chatId = useContext(ChatIdCtx);
  return (
    <div className="cold-divider" role="separator" data-testid="cold-divider">
      <span className="result-line" />
      <span>Continua da qui</span>
      {chatId && <button type="button" className="link-btn" onClick={() => openHandoff(chatId, session)} data-tip="La sessione precedente era ferma da più di un'ora: questa riparte dal suo passaggio di consegne invece di rileggerla tutta" data-testid="cold-note">passaggio di consegne</button>}
      <span className="result-line" />
    </div>
  );
}

/** The items before the last cold divider: the previous sessions, folded behind one line until opened. */
function FoldedPast({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button type="button" className="cold-past" onClick={onOpen} data-testid="cold-past">
      <IconChevronRight size={12} /> Sessione precedente · {count === 1 ? '1 riga' : `${count} righe`}
    </button>
  );
}

/** The scrolling list, sticky to the bottom. */
/** What a running turn is doing, from its last item: writing (streaming text), working (a tool runs), thinking. */
export function turnActivity(items: readonly ChatItem[] | undefined): 'scrive' | 'pensa' | 'lavora' {
  const last = items?.[items.length - 1];
  if (last?.kind === 'assistant' && last.streaming) return 'scrive';
  if (last?.kind === 'tool' && last.status === 'running') return 'lavora';
  return 'pensa';
}

// Lists that must follow their bottom, served together once per frame: reading scrollHeight right after each DOM
// change forced one page layout per list per streamed piece (10 streaming chats = 10+ layouts a frame, a third of the
// renderer's time); one pass a frame lays out once and only writes scrollTop, which does not dirty the layout.
const following = new Map<HTMLElement, () => boolean>();
// where we last put each list: the scroll event of our own write arrives a frame later, when more content may have
// grown below it, so it must never read as the user leaving the bottom (only scrolling above this point does)
const wrote = new WeakMap<HTMLElement, number>();
function toBottom(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight;
  wrote.set(el, el.scrollTop);
}
let followFrame = 0;
function follow(el: HTMLElement, stuck: () => boolean): void {
  following.set(el, stuck);
  if (followFrame) return;
  followFrame = requestAnimationFrame(() => {
    followFrame = 0;
    const all = [...following];
    following.clear();
    for (const [e, s] of all) if (s() && e.isConnected) toBottom(e);
  });
}

export function ItemList({ items, empty, footer, chatId = null }: { items: readonly ChatItem[]; empty?: string; footer?: ReactNode; chatId?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const peek = useLinkPeek(chatId);
  const stick = useRef(true);
  const [unseen, setUnseen] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);
  // a cold continuation (ADR 0031): what came before the last divider is the previous session, folded
  const cut = useMemo(() => { for (let i = items.length - 1; i >= 0; i--) { const x = items[i]; if (x?.kind === 'system' && x.continued) return i; } return -1; }, [items]);
  const shown = cut > 0 && !pastOpen ? items.slice(cut) : items;
  const asking = useApp(s => !!chatId && s.pending.some(p => p.chatId === chatId && p.type === 'question'));
  const open = useMemo(() => thinkingBeforeAsk(items, asking), [items, asking]);
  // a Regia's messages get "Apri" chips for the work chats they name (one key of the titles: rebuilt only when they change)
  const tkey = useApp(s => { const c = chatId ? s.chats[chatId] : undefined; return c?.isRegia || c?.appRegia ? titlesKey(s.chats) : ''; });
  const refs = useMemo(() => chatRefsOf(items, tkey), [items, tkey]);
  const fixed = useMemo(() => correctedThoughts(items), [items]);
  const last = items[items.length - 1];
  const lastSig = last ? `${last.id}:${'text' in last ? last.text.length : 0}:${last.kind === 'tool' ? last.status : ''}` : '';
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // first layout: at the bottom before the first paint (never a frame showing the top of the transcript)
    if (!mounted.current) { mounted.current = true; toBottom(el); }
    else if (stick.current) follow(el, () => stick.current);
    else setUnseen(true);
  }, [lastSig, items.length]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // content grows a frame after the item changes (markdown parsed once per frame): follow it, only if at the bottom
    const onChange = () => { if (stick.current) follow(el, () => stick.current); };
    const ro = new ResizeObserver(onChange);
    ro.observe(el);
    const mo = new MutationObserver(onChange);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => { ro.disconnect(); mo.disconnect(); following.delete(el); };
  }, []);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    // back at the bottom by hand: that is the new mark, so scrolling up from here detaches the list again
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) { stick.current = true; wrote.set(el, el.scrollTop); setUnseen(false); }
    else if (el.scrollTop < (wrote.get(el) ?? Infinity)) stick.current = false; // the user scrolled up
  };
  return (
    <ChatIdCtx.Provider value={chatId}>
    <div className="items-wrap">
      <div className="items" ref={ref} onScroll={onScroll} onClick={peek.onClick} onWheel={peek.onWheel} role="log" aria-live="off">
        {cut > 0 && !pastOpen && <FoldedPast count={cut} onOpen={() => setPastOpen(true)} />}
        {items.length === 0 && empty && !footer ? <div className="items-empty">{empty}</div> : shown.map(i => <Item key={i.id} item={i} beforeAsk={open.has(i.id)} refs={refs.get(i.id)} marks={fixed.get(i.id)} />)}
        {footer}
      </div>
      {peek.popover}
      {unseen && (
        <button type="button" className="unseen" data-testid="unseen" onClick={() => { const el = ref.current; if (el) { toBottom(el); stick.current = true; setUnseen(false); } }}>
          <IconArrowDown size={13} /> nuove righe
        </button>
      )}
    </div>
    </ChatIdCtx.Provider>
  );
}
