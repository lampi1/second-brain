// The discussion bar of an idea or an AI suggestion (Idee), of a recurring AI error and of a number (Qualità, Costi,
// Confronto; ADR 0037): "Discutine" opens the Orchestrator next to the page with a
// ready draft in its input (quotes the topic with its source and numbers, or its file and line; ends with an opening
// question; the user edits it and sends it with Enter); "Apri una chat" opens an inline box with the first message of a
// dedicated work chat ("Idea · <titolo>", "Errore · <tipo>"), editable, created with Ctrl+Invio. After either, the topic shows "Discussa" with a link to the chat.
// The app passes the Orchestrator and chat actions through DiscussBridge (BrainPage prop → context); without it (the
// standalone test route) the draft is sent from an inline box and the chat is created through 'chat:createRouted'.
// The idea's state in ideas.md is never changed here. Used by pages/Idee.tsx, Qualita.tsx, Costi.tsx, Confronto.tsx,
// and components/Charts.tsx.
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RoutedNewChat } from '@shared/contract';
import { brainClient } from '../api';
import { normFile } from '../types';
import { fmt } from '../lib/format';
import {
  addDiscussed, chatPrompt, chatTitle, discussText, fileOf, lineOf, readDiscussed, titleOf, topicKey, writeDiscussed,
  type Discussed, type DiscussedMap, type KV, type Topic,
} from '../lib/discuss';
import { useAppChats } from './Composer';
import { toast, useEsc } from './ui';
import { t } from '../../i18n';

/** What a record tells the routing table about its chat: the kind of work, the area, the text the kind is read from. */
export type ChatRoute = Pick<RoutedNewChat, 'kind' | 'area' | 'routeText'>;

/** What the app does for the brain pages (actions.ts builds it). */
export interface DiscussBridge {
  /** Open the Orchestrator next to the page with `text` as a draft in its input, not sent. `onSent` runs when the user sends
   *  it. False when no Orchestrator is open. */
  draftToOrchestrator(text: string, onSent: (chat: { id: string; title: string }) => void): boolean;
  /** Create a work chat that starts with `prompt` (in `opts.cwd`, else the brain folder) and say so with a toast; null
   *  when it was not created. The routing table picks its engine, model and effort (ADR 0032), with what `opts.route` says. */
  newChat(title: string, prompt: string, opts?: { cwd?: string; route?: ChatRoute }): Promise<{ id: string; title: string } | null>;
  /** Bring a chat on screen (the Orchestrator docks next to the page). */
  showChat(chatId: string): void;
}
export const DiscussContext = createContext<DiscussBridge | null>(null);

// ── the "discussa" records, shared by every bar and table on screen ──────────────────────────────────────────────────
const kv = (): KV | null => { try { return window.localStorage; } catch { return null; } };
let records: DiscussedMap | null = null;
const subs = new Set<() => void>();
const current = (): DiscussedMap => (records ??= readDiscussed(kv()));
export function markDiscussed(key: string, d: Discussed): void {
  records = addDiscussed(current(), key, d);
  writeDiscussed(kv(), records);
  for (const fn of subs) fn();
}
/** Every topic's discussions, live. */
export function useDiscussed(): DiscussedMap {
  return useSyncExternalStore(fn => { subs.add(fn); return () => { subs.delete(fn); }; }, current);
}

/** The topic's line in its file (from the brain's cache, fetched when missing); null when unknown. */
async function topicLine(t: Topic): Promise<number | null> {
  const file = fileOf(t);
  if (!file) return null; // a quote names its source, not a line
  try {
    const e = await brainClient().get(`/api/file?p=${encodeURIComponent(file)}`);
    return e.data ? lineOf(normFile(e.data).text, t) : null;
  } catch { return null; }
}

const IconChat = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z" />
  </svg>
);
const IconNew = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8.5 2.5h-6v11h11v-6M10.5 2.5h3v3M13.5 2.5 8 8" />
  </svg>
);
const IconCheck = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" /></svg>
);

type Box = null | { kind: 'orchestrator' | 'chat'; text: string };

/** "Discutine" + "Apri una chat" + the "Discussa" mark, for one idea, reflection, error pattern or number. */
export function DiscussBar({ topic, testId = 'bx-discuss', onOrchestrator }: {
  topic: Topic;
  testId?: string;
  /** after the draft went to the Orchestrator (the Idee peek steps aside so the docked Orchestrator shows) */
  onOrchestrator?: () => void;
}) {
  const bridge = useContext(DiscussContext);
  const chats = useAppChats();
  // the Orchestrator even when closed: after a restart every chat is 'closed' until its first message, and it resumes on send
  const orchestrator = chats?.find(c => c.isOrchestrator) ?? null;
  const done = useDiscussed()[topicKey(topic)] ?? [];
  const [box, setBox] = useState<Box>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const chatBtn = useRef<HTMLButtonElement>(null);
  /** close the box; the keyboard goes back to "Apri una chat" unless it moves elsewhere (the Orchestrator) */
  const closeBox = (refocus = true) => { setBox(null); if (refocus) requestAnimationFrame(() => chatBtn.current?.focus()); };
  useEsc(!!box, () => closeBox()); // above the Idee peek's own Esc: closes only the box
  useEffect(() => { if (box) { const el = ta.current; el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); } }, [box?.kind]);

  const key = topicKey(topic);
  const discuss = async () => {
    setErr(null);
    if (bridge) setBox(null); // the keyboard goes to the Orchestrator: no hidden box left to catch Esc
    const text = discussText(topic, await topicLine(topic));
    if (bridge) {
      const ok = bridge.draftToOrchestrator(text, chat => markDiscussed(key, { via: 'orchestrator', chatId: chat.id, chatTitle: chat.title, at: Date.now() }));
      if (!ok) toast(t('brainPages.discuss.errorOrchestratorNotOpen'));
      else onOrchestrator?.();
      return;
    }
    setBox({ kind: 'orchestrator', text });
  };
  const openChat = async () => {
    setErr(null);
    if (box?.kind === 'chat') { closeBox(); return; } // a toggle: never rewrites what the user typed
    const text = chatPrompt(topic, await topicLine(topic));
    setBox(b => (b?.kind === 'chat' ? b : { kind: 'chat', text }));
  };
  const confirm = async () => {
    if (!box || !box.text.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      if (box.kind === 'chat') {
        const title = chatTitle(topic);
        const c = bridge ? await bridge.newChat(title, box.text.trim()) : await createDirect(title, box.text.trim());
        if (!c) throw new Error(t('brainPages.discuss.errorChatFailed'));
        markDiscussed(key, { via: 'chat', chatId: c.id, chatTitle: c.title, at: Date.now() });
        if (!bridge) toast(t('brainPages.discuss.successChatCreated', { title: c.title }));
      } else {
        if (!orchestrator) throw new Error(t('brainPages.discuss.errorNoOrchestrator'));
        await window.sb.invoke('chat:send', { chatId: orchestrator.id, text: box.text.trim() });
        markDiscussed(key, { via: 'orchestrator', chatId: orchestrator.id, chatTitle: 'Orchestrator', at: Date.now() });
        toast(t('brainPages.discuss.successOrchestratorSent'));
      }
      closeBox();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const last = done[0];
  const lastChat = last ? chats?.find(c => c.id === last.chatId) ?? (last.via === 'orchestrator' ? orchestrator : null) : null;
  const show = (id: string) => { if (bridge) bridge.showChat(id); };
  return (
    <div className="bx-discuss" data-testid={testId}>
      <div className="bx-discuss-row">
        <button type="button" className="bx-btn primary" onClick={() => void discuss()} data-testid={`${testId}-orchestrator`} aria-label={t('brainPages.discuss.discussButtonLabel', { topic: titleOf(topic) })}
          title={orchestrator ? t('brainPages.discuss.discussButtonTitle') : t('brainPages.discuss.discussButtonTitleDisabled')} disabled={!!chats && !orchestrator && !!bridge}>
          <IconChat /> {t('brainPages.discuss.discussBtn')}
        </button>
        <button ref={chatBtn} type="button" className="bx-btn ghost" onClick={() => void openChat()} data-testid={`${testId}-chat`} aria-label={t('brainPages.discuss.openChatLabel', { topic: titleOf(topic) })} aria-expanded={box?.kind === 'chat'}
          title={topic.kind === 'idea' ? t('brainPages.discuss.openChatTitleIdea') : topic.kind === 'reflection' ? t('brainPages.discuss.openChatTitleReflection')
              : topic.quote.what === 'errore' ? t('brainPages.discuss.openChatTitleError') : t('brainPages.discuss.openChatTitleNumber')}>
          <IconNew /> {t('brainPages.discuss.openChatBtn')}
        </button>
        <span className="sp" />
        {last && (
          <span className="bx-discussed" data-testid={`${testId}-mark`}>
            <IconCheck />
            <span>{topic.kind === 'quote' ? t('brainPages.discuss.discussedNeutral') : t('brainPages.discuss.discussed')}{done.length > 1 ? t('brainPages.discuss.discussedTimes', { n: done.length }) : ''}</span>
            {lastChat && bridge
              ? <button type="button" className="bx-go" onClick={() => show(lastChat.id)} data-testid={`${testId}-open`}>{last.via === 'orchestrator' ? t('brainPages.discuss.withOrchestrator') : t('brainPages.discuss.inChat', { title: lastChat.title })} →</button>
              : <span className="muted">{last.via === 'orchestrator' ? t('brainPages.discuss.withOrchestrator') : <>{t('brainPages.discuss.inChat', { title: last.chatTitle })}{chats && !lastChat ? ' ' + t('brainPages.discuss.chatClosed') : ''}</>}</span>}
            <span className="muted">· {fmt.day(localDay(last.at))}</span>
          </span>
        )}
      </div>
      {box && (
        <div className="bx-confirm bx-discuss-box" role="group" aria-label={box.kind === 'chat' ? t('brainPages.discuss.boxAriaLabelChat', { title: chatTitle(topic) }) : t('brainPages.discuss.boxAriaLabelOrchestrator')} data-testid={`${testId}-box`}>
          <p className="small"><b>{box.kind === 'chat' ? t('brainPages.discuss.boxTitleChat', { title: chatTitle(topic) }) : t('brainPages.discuss.boxTitleOrchestrator')}</b> <span className="muted">· {box.kind === 'chat' ? t('brainPages.discuss.boxDescChat') : t('brainPages.discuss.boxDescOrchestrator')}</span></p>
          <textarea ref={ta} className="bx-textarea" rows={box.kind === 'chat' ? 4 : 7} value={box.text} maxLength={4000} aria-label={t('brainPages.discuss.boxLabel')}
            onChange={e => setBox({ ...box, text: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void confirm(); }
            }} />
          {err && <p className="small" style={{ color: 'var(--bx-red)' }}>{err}</p>}
          <div className="bx-row">
            <button type="button" className="bx-btn primary" disabled={busy || !box.text.trim()} onClick={() => void confirm()} data-testid={`${testId}-confirm`}>
              {box.kind === 'chat' ? t('brainPages.discuss.boxConfirmChat') : t('brainPages.discuss.boxConfirmOrchestrator')}
            </button>
            <button type="button" className="bx-btn ghost" onClick={() => closeBox()}>{t('brainPages.discuss.boxCancelBtn')}</button>
            <span className="sp" />
            <span className="small muted"><kbd>{t('brainPages.discuss.shortcutKey')}</kbd> {box.kind === 'chat' ? t('brainPages.discuss.shortcutCreate') : t('brainPages.discuss.shortcutSend')} · <kbd>{t('brainPages.discuss.shortcutEscKey')}</kbd> {t('brainPages.discuss.shortcutCancel')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** The local calendar day of a time (not the UTC one: 01:00 in Rome is still today). */
const localDay = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Without the app's bridge: the chat is created in the brain folder through 'chat:createRouted'. */
async function createDirect(title: string, prompt: string): Promise<{ id: string; title: string } | null> {
  const info = await window.sb.invoke('app:info', undefined).catch(() => null);
  const cwd = info?.brainRoot;
  if (!cwd) return null;
  const settings = await window.sb.invoke('settings:get', undefined);
  const h = settings.orchestratorChats.harness;
  const model = h === 'claude' ? settings.orchestratorChats.claudeModel : h === 'cursor' ? settings.orchestratorChats.cursorModel : '';
  const c = await window.sb.invoke('chat:createRouted', { title, prompt, cwd, defaults: { harness: h, model } });
  return { id: c.id, title: c.title };
}
