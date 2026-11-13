// The discussion bar of an idea or an AI suggestion (Idee), of a recurring AI error and of a number (Qualità, Costi;
// ADR 0037): one button, "Discuti", that opens the Orchestrator next to the page with a ready draft in its input
// (quotes the topic with its source and numbers, or its file and line; ends with an opening question; the user edits it and
// sends it with Enter). It never creates a work chat: the Orchestrator decides and delegates (owner, 2026-10-19: every
// "Apri chat" entry point became "Discuti"). Once sent, the topic shows "Discussa" with a link to the Orchestrator.
// The app passes the Orchestrator actions through DiscussBridge (BrainPage prop → context); without it (the standalone
// test route) the draft is sent from an inline box. The idea's state in ideas.md is never changed here. Used by
// pages/Idee.tsx, Qualita.tsx, Costi.tsx, components/Charts.tsx and components/RecordDiscussButton.tsx.
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { brainClient } from '../api';
import { normFile } from '../types';
import { fmt } from '../lib/format';
import {
  addDiscussed, discussText, fileOf, lineOf, readDiscussed, titleOf, topicKey, writeDiscussed,
  type Discussed, type DiscussedMap, type KV, type Topic,
} from '../lib/discuss';
import { useAppChats } from '../lib/app-chats';
import { toast, useEsc } from './ui';
import { t } from '../../i18n';

/** What the app does for the brain pages (actions.ts builds it). */
export interface DiscussBridge {
  /** Open the Orchestrator next to the page with `text` as a draft in its input, not sent. `onSent` runs when the user sends
   *  it. False when no Orchestrator is open. */
  draftToOrchestrator(text: string, onSent: (chat: { id: string; title: string }) => void): boolean;
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

export const IconChat = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z" />
  </svg>
);
export const IconCheck = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" /></svg>
);

/** "Discuti" + the "Discussa" mark, for one idea, reflection, error pattern or number. */
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
  // the inline box exists only without the app (the standalone test route): the draft is sent from there
  const [box, setBox] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const closeBox = () => { setBox(null); requestAnimationFrame(() => btn.current?.focus()); };
  useEsc(box !== null, closeBox); // above the Idee peek's own Esc: closes only the box
  useEffect(() => { if (box !== null) { const el = ta.current; el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); } }, [box !== null]);

  const key = topicKey(topic);
  const discuss = async () => {
    setErr(null);
    const text = discussText(topic, await topicLine(topic));
    if (bridge) {
      const ok = bridge.draftToOrchestrator(text, chat => markDiscussed(key, { via: 'orchestrator', chatId: chat.id, chatTitle: chat.title, at: Date.now() }));
      if (!ok) toast(t('brainPages.discuss.errorOrchestratorNotOpen'));
      else onOrchestrator?.();
      return;
    }
    setBox(text);
  };
  const confirm = async () => {
    if (box === null || !box.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      if (!orchestrator) throw new Error(t('brainPages.discuss.errorNoOrchestrator'));
      await window.sb.invoke('chat:send', { chatId: orchestrator.id, text: box.trim() });
      markDiscussed(key, { via: 'orchestrator', chatId: orchestrator.id, chatTitle: 'Orchestrator', at: Date.now() });
      toast(t('brainPages.discuss.successOrchestratorSent'));
      closeBox();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const last = done[0];
  // an old record may name a work chat (before 2026-10-19 the bar could open one): still linked while that chat exists
  const lastChat = last ? chats?.find(c => c.id === last.chatId) ?? (last.via === 'orchestrator' ? orchestrator : null) : null;
  return (
    <div className="bx-discuss" data-testid={testId}>
      <div className="bx-discuss-row">
        <button ref={btn} type="button" className="bx-btn primary" onClick={() => void discuss()} data-testid={`${testId}-orchestrator`} aria-label={t('brainPages.discuss.discussButtonLabel', { topic: titleOf(topic) })}
          title={orchestrator ? t('brainPages.discuss.discussButtonTitle') : t('brainPages.discuss.discussButtonTitleDisabled')} disabled={!!chats && !orchestrator && !!bridge}>
          <IconChat /> {t('brainPages.discuss.discussBtn')}
        </button>
        <span className="sp" />
        {last && (
          <span className="bx-discussed" data-testid={`${testId}-mark`}>
            <IconCheck />
            <span>{topic.kind === 'quote' ? t('brainPages.discuss.discussedNeutral') : t('brainPages.discuss.discussed')}{done.length > 1 ? t('brainPages.discuss.discussedTimes', { n: done.length }) : ''}</span>
            {lastChat && bridge
              ? <button type="button" className="bx-go" onClick={() => bridge.showChat(lastChat.id)} data-testid={`${testId}-open`}>{last.via === 'orchestrator' ? t('brainPages.discuss.withOrchestrator') : t('brainPages.discuss.inChat', { title: lastChat.title })} →</button>
              : <span className="muted">{last.via === 'orchestrator' ? t('brainPages.discuss.withOrchestrator') : <>{t('brainPages.discuss.inChat', { title: last.chatTitle })}{chats && !lastChat ? ' ' + t('brainPages.discuss.chatClosed') : ''}</>}</span>}
            <span className="muted">· {fmt.day(localDay(last.at))}</span>
          </span>
        )}
      </div>
      {box !== null && (
        <div className="bx-confirm bx-discuss-box" role="group" aria-label={t('brainPages.discuss.boxAriaLabelOrchestrator')} data-testid={`${testId}-box`}>
          <p className="small"><b>{t('brainPages.discuss.boxTitleOrchestrator')}</b> <span className="muted">· {t('brainPages.discuss.boxDescOrchestrator')}</span></p>
          <textarea ref={ta} className="bx-textarea" rows={7} value={box} maxLength={4000} aria-label={t('brainPages.discuss.boxLabel')}
            onChange={e => setBox(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void confirm(); }
            }} />
          {err && <p className="small" style={{ color: 'var(--bx-red)' }}>{err}</p>}
          <div className="bx-row">
            <button type="button" className="bx-btn primary" disabled={busy || !box.trim()} onClick={() => void confirm()} data-testid={`${testId}-confirm`}>
              {t('brainPages.discuss.boxConfirmOrchestrator')}
            </button>
            <button type="button" className="bx-btn ghost" onClick={closeBox}>{t('brainPages.discuss.boxCancelBtn')}</button>
            <span className="sp" />
            <span className="small muted"><kbd>{t('brainPages.discuss.shortcutKey')}</kbd> {t('brainPages.discuss.shortcutSend')} · <kbd>{t('brainPages.discuss.shortcutEscKey')}</kbd> {t('brainPages.discuss.shortcutCancel')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** The local calendar day of a time (not the UTC one: 01:00 in Rome is still today). */
export const localDay = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
