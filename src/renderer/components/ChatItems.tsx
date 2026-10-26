// The transcript of a chat tile: user bubbles (what the user did not type, mail, agents' prompts, app news, Esegui
// results, folds to one muted line: lib/foreign.ts), markdown assistant text (streaming caret), collapsed thinking (open when it is the prose right before a question; a sentence of it can be corrected:
// CorrectThought.tsx, ADR 0058, the correction shown as its own bubble), tool
// rows (a plain Italian line of what the tool does, shared/explain.ts; status icon, +/− counts; the raw command, diff
// or output folded under it), system notices (the "Dove eravamo" recap styled apart; the "continua da qui" divider of a
// cold continuation, with the previous session folded above it: ADR 0031), turn results, ```mermaid / ```chart blocks drawn (VisualBlock.tsx) and the visuals a chat showed
// with show_ui (GenUi.tsx ArtifactCard; one waiting for its question is hidden). Code blocks of assistant messages get their own toolbar (Copia; Esegui on shell blocks of an app
// chat: CodeBlock.tsx; the chat id comes from ItemList's chatId); a click on copyable inline code copies it, on a file path or a link it opens a preview (LinkPeek.tsx). Each row is memoized by its item, so a streaming
// message re-renders only itself (at most once a frame, re-parsing only its last markdown block); tool rows show live
// elapsed time; in an Orchestrator, an "Apri" chip under the chats she opened, wrote to or named (ChatRefChips.tsx, ADR 0034)
// and a "Strategist" badge (or an older "Veloce") on a message sent with that mode (shared/newchat.ts); its thinking and tool rows fold
// behind one "Ragionamento" row, and an emoji-only reply sticks to the user's bubble as a reaction (lib/chat-view.ts); a "sta scrivendo… / sta pensando…" line follows the turn; the list follows the bottom ONLY when the
// user is already there (scrolled up to read, it never jumps: a "nuove righe" pill appears instead). Used by ChatTile
// and OrchestratorTile.
import { readToolOutput, toolOutputLoader } from '../lib/tool-output';
import { sb } from '../sb';
import { t as auditText } from '../i18n';
import {useFollowBottom} from '../lib/use-follow-bottom';
import '../styles/follow-bottom.css';
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChatItem, FileDiff } from '@shared/contract';
import { diffTotals, duration, formatCost, toolLabel } from '../lib/format';
import { markdownParts, renderMarkdown, splitBlocks, type MdPart } from '../lib/markdown';
import { CodeBlock } from './CodeBlock';
import { VisualBlock, isVisualLang } from './VisualBlock';
import { explainTool } from '@shared/explain';
import { useNow } from '../lib/clock';
import { LINE_MS, typingText } from '../lib/typing-line';
import { useDailyPhrases } from '../store/daily-phrases';
import { IconAlert, IconArrowDown, IconArrowRight, IconBell, IconBolt, IconBranch, IconCheck, IconChevronDown, IconChevronRight, IconInfo, IconLink, IconPlus, IconRefresh, IconSend, IconSparkle, IconSpinner, IconTerminal, IconX } from './Icons';
import { splitNotes } from '../lib/sendable';
import { getForeignLabel, foreignOf, showsSender, type Foreign, type ForeignKind } from '../lib/foreign';
import { ImageStrip } from './ImageStrip';
import {MessageImages} from './MessageImages';
import { thinkingBeforeAsk } from '../lib/askContext';
import { useApp, synthesizeResult } from '../store/store';
import { chatRefsOf, reportOutput, titlesKey, toolChatRef } from '../lib/chatrefs';
import { splitMode } from '@shared/newchat';
import { isRoleId, ROLE_DEFAULTS, ROLE_IDS } from '@shared/roles';
import { isReaction } from '@shared/reaction';
import { chatView } from '../lib/chat-view';
import { AgentAvatar } from './AgentAvatar';
import { NamedChatRefs, ToolChatRef } from './ChatRefChips';
import { openHandoff } from '../store/ui';
import { openChatRef } from '../actions';
import { ArtifactCard } from './GenUi';
import { useLinkPeek } from './LinkPeek';
import { sysText, t } from '../i18n';
import { ThoughtText } from './CorrectThought';
import { correctedThoughts, parseCorrection } from '../lib/correction';
import { agents } from '../store/agents';
import { guideChatId, visibleGuideItems } from '../../modules/ai-first/presentation';

type Tool = Extract<ChatItem, { kind: 'tool' }>;

/** One compact row: who has the result, «Agente →» to its chat, and a tab under the row that unfolds the exact result
 *  here (owner, 2026-10-21: «una linguetta per espanderla e il pulsante "Vai ad agente"»). */
function ResultReady({ item }: { item: Extract<ChatItem, { kind: 'system' }> }) {
  const sourceId = typeof item.params?.chatId === 'string' ? item.params.chatId : undefined;
  const source = useApp(s => sourceId ? s.chats[sourceId] : undefined);
  const [open, setOpen] = useState(false);
  const name = source?.title ?? String(item.params?.title ?? item.params?.role ?? 'Chat');
  const role = source?.agent?.name ?? String(item.params?.role ?? '');
  const recordedRole = String(item.params?.role ?? '').trim().toLowerCase();
  const roleId = isRoleId(source?.agent?.id) ? source.agent.id
    : ROLE_IDS.find(id => id === recordedRole || ROLE_DEFAULTS[id].name.toLowerCase() === recordedRole);
  const avatar = source?.agent?.avatar ?? (roleId ? { kind: 'character' as const, value: roleId } : undefined);
  const legacyOutput = typeof item.params?.summary === 'string' && item.params.summary.trim() ? item.params.summary : sysText(item);
  return <div className={`notice result-ready${open ? ' is-open' : ''}`} data-testid="result-ready">
    <AgentAvatar avatar={avatar} name={role} size={24} />
    <span className="result-ready-text" role="status"><span className="result-ready-name" title={name}>{name}</span><small>{role ? t('chat.resultFrom', { role }) : t('chat.resultReady')}</small></span>
    {sourceId && <button type="button" className="result-ready-go" data-testid="chatref-open" data-chat-id={sourceId}
      aria-label={t('chat.chatref.ariaOpen', { verb: t('chat.resultGoAgent'), name })} onClick={() => openChatRef(sourceId)}>
      {t('chat.resultGoAgent')}<IconArrowRight size={12} />
    </button>}
    {open && !item.result && <div className="result-ready-full"><Markdown text={legacyOutput} /></div>}
    {open && item.result && <div className="result-ready-full" data-testid="canonical-result">
      <Markdown text={item.result.output} />
      {!!item.result.questions?.length && <ul>{item.result.questions.map((question, i) => <li key={i}>{question}</li>)}</ul>}
      {!!item.result.doneWhen.length && <ul className="result-criteria">{item.result.doneWhen.map((criterion, i) => <li key={i} className={criterion.met ? 'met' : ''}><span aria-hidden="true">{criterion.met ? '✓' : '—'}</span><span className="sr-only">{t(criterion.met ? 'chat.criterionMet' : 'chat.criterionNotMet')}</span> <b>{criterion.criterion}</b> {criterion.evidence}</li>)}</ul>}
      <ResultSynthesis runId={item.result.runId} />
    </div>}
    <button type="button" className="result-ready-tab" aria-expanded={open} data-testid="result-ready-toggle" onClick={() => setOpen(!open)}>
      <IconChevronDown size={12} />{t(open ? 'chat.resultHide' : 'chat.resultShow')}
    </button>
  </div>;
}

function ResultSynthesis({ runId }: { runId: string }) {
  const chatId = useContext(ChatIdCtx);
  const available = useApp(s => !!chatId && !!s.chats[chatId]?.availableResultIds?.includes(runId));
  const pending = useApp(s => !!chatId && !!s.chats[chatId]?.pendingResultIds?.includes(runId));
  const [busy, setBusy] = useState(false);
  if (!available && !pending) return null;
  return <div className="result-synthesis">
    <button type="button" className="result-synth-btn" disabled={busy || pending} onClick={async () => { setBusy(true); try { await synthesizeResult(runId); } finally { setBusy(false); } }}>
      <IconSparkle size={13} />{t(pending || busy ? 'chat.resultDeliveryPending' : 'chat.resultSynthesize')}
    </button>
    <small>{t('chat.resultSynthesizeCost')}</small>
  </div>;
}

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
  if (!FENCE.test(t)) return <><Markdown text={t} streaming={streaming} /><MessageImages chatId={chatId} text={t} id={id} streaming={streaming}/></>;
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
      <MessageImages chatId={chatId} text={t} id={id} streaming={streaming}/>
      {groups.map((g, i) => {
        const tail = !!streaming && i === groups.length - 1;
        return g.kind === 'md'
          ? <div key={i} className={`md ${tail ? 'streaming' : ''}`}>{g.parts.map(x => <div key={x.key} className="md-b" dangerouslySetInnerHTML={{ __html: x.html }} />)}</div>
          : isVisualLang(g.part.lang) ? <VisualBlock key={i} chatId={chatId} itemId={id} lang={g.part.lang} code={g.part.code} streaming={tail} />
          : <CodeBlock key={i} chatId={chatId} itemId={id} lang={g.part.lang} code={g.part.code} streaming={tail} />;
      })}
    </div>
  );
});

/** The running turn's line: a turning spark and, while it thinks or works, a workshop phrase picked by the task's kind of
 *  work (lib/typing-line.ts; `topic` = the task's title or request), "sta scrivendo…" while it writes. `children`
 *  replaces the words with what the chat does (a collapsed strip's step, StripActivity.tsx); the data-what hook stays. */
export function Typing({ what, testid, topic = '', children }: { what: 'scrive' | 'pensa' | 'lavora'; testid?: string; topic?: string; children?: ReactNode }) {
  const now = useNow(LINE_MS);
  const daily = useDailyPhrases();
  const line = what === 'scrive' ? t('chat.items.typing.writing') : typingText(topic, now, daily);
  return <div className="typing" role="status" aria-live="off" data-testid={testid} data-what={what}><TypingSpark />{children ?? <span key={line} className="typing-line">{line}</span>}</div>;
}

/** The working mark: a four-point spark that turns and breathes (transform and opacity only: the compositor draws it). */
export function TypingSpark() {
  return <span className="typing-spark" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 0.8 9.6 6.4 15.2 8 9.6 9.6 8 15.2 6.4 9.6 0.8 8 6.4 6.4Z" fill="currentColor" /></svg></span>;
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

/** A message from another chat or the Orchestrator: its "[Messaggio … non scritto dall'utente …]" line is for the model; the
 *  bubble's "Da «…»" header already says it to the user */
export const withoutLabel = (text: string): string => text.replace(/^\[Messaggio [^\n]*\]\s*\n+/, '');

function ToolOutput({ item }: { item: Tool }) {
  const chatId = useContext(ChatIdCtx);
  const [full, setFull] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const loader = useRef<ReturnType<typeof toolOutputLoader> | null>(null);
  const preview = item.outputPreviewChars !== undefined;
  useEffect(() => {
    setFull(null); setFailed(false);
    if (!preview) return;
    if (!chatId) { setFailed(true); return; }
    const next = toolOutputLoader(() => readToolOutput(chatId, item.id, args => sb.invoke('chat:items', args)), output => { setFull(output); setFailed(false); }, () => setFailed(true));
    loader.current = next; next.refresh();
    return () => { next.dispose(); loader.current = null; };
  }, [chatId, item.id, preview]);
  useEffect(() => { loader.current?.refresh(); }, [item]);
  return <>{preview && (full === null || failed) && <div role="status">{t(failed ? 'chat.items.outputFailed' : 'chat.items.outputLoading')}{failed && <button type="button" onClick={() => loader.current?.refresh()}>{t('brainText.common.retry')}</button>}</div>}
    <pre className="tool-pre out">{full ?? item.output}</pre></>;
}

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
        aria-label={`${ex.line} (${t(`chat.items.toolStatus.${item.status}`)})`} title={item.summary}>
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
          {item.output && <ToolOutput item={item} />}
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
        <IconSparkle size={13} /><span>{beforeAsk ? t('chat.items.thinkingBeforeAskLabel') : t('chat.items.thinkingLabel')}</span><IconChevronRight size={12} className="tool-chev" />
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
        title={open ? t('common.close') : t('chat.items.foreignOpen')}>
        {FOREIGN_ICON[f.kind]}
        <span className="foreign-who">{getForeignLabel()[f.kind]}{showsSender(f) ? <> · «{f.sender}»</> : null}</span>
        {!open && f.summary && <span className="foreign-sum">{f.summary}</span>}
        <IconChevronRight size={12} className="tool-chev" />
      </button>
      {open && <div className="foreign-body" data-testid={`item-${item.id}-body`}>{f.body}<span className="foreign-note">{f.kind === 'done' ? t('chat.items.foreignDoneNote') : t('chat.items.foreignNotYoursNote')}</span></div>}
    </div>
  );
});

/** A tool row and, for app_create_chat / app_send_to_chat, the chat it is about with "Apri". */
const ToolItem = memo(function ToolItem({ item }: { item: Tool }) {
  // an agent_report's deliverable is the chat's answer, shown once here (the agent does not write it again)
  const report = reportOutput(item);
  if (report) return <><ToolRow item={item} /><div className="msg-assistant" data-testid={`report-${item.id}`}><Markdown text={report} /></div></>;
  const ref = toolChatRef(item);
  if (!ref) return <ToolRow item={item} />;
  return <div className="tool-with-ref"><ToolRow item={item} /><ToolChatRef chatId={ref.chatId} title={ref.title} how={ref.how} /></div>;
});

/** An Orchestrator's reasoning and tool rows, folded behind one "Ragionamento" row (the owner, 2026-10-20: seen only
 *  when opened); open by itself when it holds the thinking right before a question. The "Apri" chips of the chats it
 *  opened or wrote to stay visible while it is closed. */
const ProcessGroup = memo(function ProcessGroup({ id, items, open: openIds, marks }: { id: string; items: readonly ChatItem[]; open: ReadonlySet<string>; marks: ReadonlyMap<string, readonly string[]> }) {
  const beforeAsk = items.some(i => openIds.has(i.id));
  const [open, setOpen] = useState(beforeAsk);
  useEffect(() => { if (beforeAsk) setOpen(true); }, [beforeAsk]);
  const running = items.some(i => i.kind === 'tool' && i.status === 'running');
  const steps = items.filter(i => i.kind === 'tool').length;
  const chips = open ? [] : items.flatMap(i => { const r = i.kind === 'tool' ? toolChatRef(i) : null; return r ? [{ id: i.id, ...r }] : []; });
  return (
    <div className={`thinking process ${open ? 'open' : ''}`} data-testid={id}>
      <button type="button" className="thinking-row" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid="process-toggle">
        {running ? <IconSpinner size={13} /> : <IconSparkle size={13} />}<span>{t('chat.items.thinkingLabel')}{steps ? t('chat.items.processSteps', { n: steps }) : ''}</span><IconChevronRight size={12} className="tool-chev" />
      </button>
      {open && <div className="process-body">{items.map(i => <Item key={i.id} item={i} beforeAsk={openIds.has(i.id)} marks={marks.get(i.id)} />)}</div>}
      {chips.map(c => <ToolChatRef key={c.id} chatId={c.chatId} title={c.title} how={c.how} />)}
    </div>
  );
});

/** A visual in the chat's list: its relative file paths open inside the chat's folder. */
function ChatArtifact({ item }: { item: Extract<ChatItem, { kind: 'artifact' }> }) {
  const chatId = useContext(ChatIdCtx);
  const cwd = useApp(s => (chatId ? s.chats[chatId]?.cwd : undefined));
  return <ArtifactCard item={item} cwd={item.cwd ?? cwd} chatId={chatId??undefined}/>;
}

/** A correction of the reasoning the user sent (lib/correction.ts): the sentence struck through, then the fix. */
function CorrectionBubble({ quote, fix }: { quote: string; fix: string }) {
  return (
    <div className="bubble correction" data-testid="correction-bubble">
      <div className="correction-label">{t('chat.correct.label')}</div>
      <div className="correction-quote">«{quote}»</div>
      <div>{fix}</div>
    </div>
  );
}

export const Item = memo(function Item({ item, beforeAsk, refs, marks, reaction }: { item: ChatItem; beforeAsk?: boolean; refs?: readonly string[]; marks?: readonly string[]; reaction?: string }) {
  switch (item.kind) {
    case 'user': {
      const f = foreignOf(item);
      if (f && !item.thumbs?.length && !item.images) return <ForeignMsg item={item} f={f} />;
      // "Strategist" (or an older "Veloce" / "Nuova chat"): the line for the Orchestrator is hidden, a badge says it
      const nc = item.from ? null : splitMode(item.text);
      // notes riding on the user's message (Mandato / Copiato / Non serve): a muted line under the bubble
      const own = item.from ? { text: withoutLabel(item.text), notes: [] } : splitNotes(nc?.text ?? item.text);
      const text = own.text;
      const fix = item.from ? null : parseCorrection(text);
      return (
      <div className={`msg-user ${item.id.startsWith('local:') ? 'optimistic' : ''}`} data-testid={`item-${item.id}`} data-mode={nc?.mode ?? undefined}>
        {item.thumbs?.length ? <ImageStrip images={item.thumbs.map(thumb => ({ thumb }))} testid={`item-${item.id}-images`} /> : item.images ? <span className="msg-images-count">{t('chat.items.userImages', { n: item.images })}</span> : null}
        {item.from && <div className="msg-from" data-testid={`item-${item.id}-from`}>{t('chat.items.from', { source: item.from })}</div>}
        {nc?.mode && <div className="msg-newchat" data-testid={`item-${item.id}-mode`} data-tip={t(`chat.items.modeTip.${nc.mode}`)}>{nc.mode === 'quick' ? <IconBolt size={11} /> : nc.mode === 'plan' ? <IconBranch size={11} /> : <IconPlus size={11} />}{t(`chat.mode.${nc.mode}`)}</div>}
        {fix ? <CorrectionBubble quote={fix.quote} fix={fix.fix} /> : text && <div className="bubble">{text}</div>}
        {reaction && <div className="msg-react" data-testid={`item-${item.id}-reaction`} data-reaction="">{reaction}</div>}
        {own.notes.length > 0 && <div className="msg-notes" data-testid={`item-${item.id}-notes`} title={own.notes.join('\n')}><IconCheck size={11} /> {own.notes.join(' · ')}</div>}
      </div>
      );
    }
    // a reply of one or two emoji only that chatView did not stick to the user's message: a big emoji, no bubble
    case 'assistant': return !item.streaming && isReaction(item.text) ? <div className="msg-reaction" data-testid={`item-${item.id}`} data-reaction="">{item.text.trim()}</div>
      : <div className="msg-assistant" data-testid={`item-${item.id}`}><Message id={item.id} text={item.text} streaming={item.streaming} />{refs?.length ? <NamedChatRefs ids={refs} /> : null}</div>;
    case 'thinking': return <Thinking text={item.text} beforeAsk={beforeAsk} marks={marks} />;
    case 'tool': return <ToolItem item={item} />;
    case 'system': {
      if (item.continued) return <ColdDivider session={item.continued.session} />;
      if (item.code === 'resultReady') return <ResultReady item={item} />;
      const recap = item.code === 'recap' || /^dove eravamo/i.test(item.text);
      return (
        <div className={`notice notice-${item.level} ${recap ? 'recap' : ''}`} role={item.level === 'error' ? 'alert' : undefined}>
          {item.level === 'info' ? <IconInfo size={13} /> : <IconAlert size={13} />}<span>{sysText(item)}</span>
        </div>
      );
    }
    case 'artifact': return item.waiting ? null : <ChatArtifact item={item} />;
    case 'result':
      return (
        <div className={`result ${item.isError ? 'err' : ''}`} data-testid={`item-${item.id}`}>
          <span className="result-line" />
          <span>{item.isError ? t('chat.items.resultError') : item.interrupted ? t('chat.items.resultInterrupted') : t('chat.items.resultSuccess')} · {formatCost(item.costUsd)} · {duration(item.durationMs)}{item.turns > 1 ? t('chat.items.resultSteps', { n: item.turns }) : ''}</span>
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
      <span>{t('chat.items.coldDividerStart')}</span>
      {chatId && <button type="button" className="link-btn" onClick={() => openHandoff(chatId, session)} data-tip={t('chat.items.coldDividerNote')} data-testid="cold-note">{t('chat.items.coldNoteButton')}</button>}
      <span className="result-line" />
    </div>
  );
}

/** The items before the last cold divider: the previous sessions, folded behind one line until opened. */
function FoldedPast({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button type="button" className="cold-past" onClick={onOpen} data-testid="cold-past">
      <IconChevronRight size={12} /> {t('chat.items.coldPastSession', { count })}
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

type ItemListProps={items:readonly ChatItem[];empty?:string;footer?:ReactNode;chatId?:string|null};
export function ItemList(props:ItemListProps){
  const guideId=agents.use(s=>guideChatId(s.setup));
  const items=useMemo(()=>visibleGuideItems(props.items,props.chatId??null,guideId),[props.items,props.chatId,guideId]);
  return <ItemListFor key={props.chatId??'unowned'} {...props} items={items}/>;
}
function ItemListFor({ items, empty, footer, chatId = null }: ItemListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const peek = useLinkPeek(chatId);
  const content=useRef<HTMLDivElement>(null);
  const [pastOpen, setPastOpen] = useState(false);
  // a cold continuation (ADR 0031): what came before the last divider is the previous session, folded
  const cut = useMemo(() => { for (let i = items.length - 1; i >= 0; i--) { const x = items[i]; if (x?.kind === 'system' && x.continued) return i; } return -1; }, [items]);
  const shown = cut > 0 && !pastOpen ? items.slice(cut) : items;
  const asking = useApp(s => !!chatId && s.pending.some(p => p.chatId === chatId && p.type === 'question'));
  const open = useMemo(() => thinkingBeforeAsk(items, asking), [items, asking]);
  // an Orchestrator's messages get "Apri" chips for the work chats they name (one key of the titles: rebuilt only when they change)
  const tkey = useApp(s => { const c = chatId ? s.chats[chatId] : undefined; return c?.isOrchestrator ? titlesKey(s.chats) : ''; });
  const orch = useApp(s => !!chatId && !!s.chats[chatId]?.isOrchestrator);
  const view = useMemo(() => chatView(shown, { foldProcess: orch }), [shown, orch]);
  const refs = useMemo(() => chatRefsOf(items, tkey), [items, tkey]);
  const fixed = useMemo(() => correctedThoughts(items), [items]);
  const last = items[items.length - 1];
  const lastSig = last ? `${last.id}:${'text' in last ? last.text.length : 0}:${last.kind === 'tool' ? last.status : ''}` : '';
  const follow=useFollowBottom(ref,content,chatId,`${items.length}:${lastSig}`);
  return (
    <ChatIdCtx.Provider value={chatId}>
    <div className="items-wrap">
      <div className="items" ref={ref} data-chat-log={chatId??undefined} tabIndex={0} aria-label={auditText('audit.ChatItems.messages')} onClick={peek.onClick} onWheel={peek.onWheel} role="log" aria-live="off">
        <div ref={content} className="items-content">
        {cut > 0 && !pastOpen && <FoldedPast count={cut} onOpen={() => setPastOpen(true)} />}
        {items.length === 0 && empty && !footer ? <div className="items-empty">{empty}</div> : view.map(v => v.kind === 'process'
          ? <ProcessGroup key={v.id} id={v.id} items={v.items} open={open} marks={fixed} />
          : <Item key={v.item.id} item={v.item} beforeAsk={open.has(v.item.id)} refs={refs.get(v.item.id)} marks={fixed.get(v.item.id)} reaction={v.reaction} />)}
        {footer}
        </div>
      </div>
      {peek.popover}
      {!follow.following && (
        <button type="button" className="unseen" data-testid="unseen" onClick={follow.jump}>
          <IconArrowDown size={13} /> {follow.unseen ? auditText('auditExpression.ChatItems.text16') : auditText('auditExpression.ChatItems.text17')}
        </button>
      )}
    </div>
    </ChatIdCtx.Provider>
  );
}
