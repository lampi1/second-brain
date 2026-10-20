// The always-visible input of every tile: Enter sends, Shift+Enter is a new line; while the chat is busy or waiting
// on a request the message is queued (shown as chips) and sent when the chat goes idle. Each chip has "Invia subito"
// (interrupts the turn and sends that message first, the others follow in their order: store.sendQueuedNow) and ✕;
// Enter again on an empty input does "Invia subito" on the last queued message (the user, 2026-10-12: "l'invia subito
// deve essere con il doppio invio").
// Screenshots: Ctrl+V or drag them onto the input; they show as previews above it (✕ removes, click enlarges) and go
// with the message (also queued ones), up to IMAGE_MAX_COUNT; a paste with no image item asks main for the clipboard's
// image (lib/images.ts pasteKind). Drafts and their images survive view switches and
// remounts (kept per chat in memory); setDraft puts a ready text in a chat's input from elsewhere (a brain page's
// "Discuti"), with a callback when the user sends it. "/" at the start opens the chat's commands and skills (ADR 0018:
// ↑↓ choose, Tab or Invio completes "/<name> ", Esc closes; lib/slash.ts), read from main ('chat:commands') when the
// list opens. An Orchestrator's input also has "Veloce" and "Strategist" (ADR 0034, 2026-10-20): one ticked, the message
// goes with the line that asks her for the quick path or for a Strategist's plan (shared/newchat.ts); Ctrl+Shift+Invio
// sends as "Veloce" at once; it resets after a send.
// Used by ChatTile and OrchestratorTile (also the Orchestrator docked with Ctrl+R).
import { t as auditText } from '../i18n';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { splitMode, withMode, type SendMode } from '@shared/newchat';
import { IMAGES_MAX_TOTAL, type ChatCommand, type ChatSummary, type ImageAttachment } from '@shared/contract';
import { applyCommand, filterCommands, slashQuery } from '../lib/slash';
import { fullSrc, imageFiles, pasteKind, roomFor, toAttachment } from '../lib/images';
import { isBusy, type QueuedMsg } from '../store/state';
import { send, sendQueuedNow, unqueue, useApp } from '../store/store';
import { toast } from '../store/ui';
import { IconBolt, IconBranch, IconSend, IconSpinner, IconX } from './Icons';
import { ImageStrip } from './ImageStrip';
import { Kbd } from './ui';
import { t } from '../i18n';
import {validateRecoveryRaster} from '../lib/recovery-raster';
import {updateIsFrozen} from '../lib/update-barrier';
import { reviewedContextDraft, withReviewedContext } from '../lib/reviewed-context';
import { ReviewedContextPreview } from './ReviewedContextPreview';

// per chat, outside the component: a draft, its images and the screenshots still being read outlive a remount (the
// Orchestrator moving to the dock) and never follow the input to another chat
// After restart recovery, keep its private durable draft copy current to prevent replaying sent text.
class CheckpointMap<K,V> extends Map<K,V>{override set(key:K,value:V){super.set(key,value);persistChatRecovery();return this;}override delete(key:K){const result=super.delete(key);persistChatRecovery();return result;}override clear(){super.clear();persistChatRecovery();}}
let recoveredDrafts=false,draftStorageProblem=false;
const drafts = new CheckpointMap<string, string>();
/** per chat: what to run when the draft set by setDraft is sent, and a piece of it that must still be in the message */
const onSentHooks = new Map<string, { fn: () => void; sig: string }>();
const draftSubs = new Set<(chatId: string) => void>();
const freshDrafts = new Set<string>(); // set from elsewhere, not yet shown: the input takes the focus with the caret at the end
const modeOn = new CheckpointMap<string, SendMode>(); // the Orchestrators with "Veloce" or "Strategist" ticked (kept across a remount, like the draft)

/** Put `text` in the chat's input, not sent; what the user was already writing there stays above it. `onSent` runs
 *  once when a message that still contains the text's first line is sent or queued (an emptied input forgets it). */
export function setDraft(chatId: string, text: string, onSent?: () => void): void {
  if(updateIsFrozen())return;
  const old = (drafts.get(chatId) ?? '').trim();
  drafts.set(chatId, old && !old.includes(text.trim()) ? `${old}\n\n${text}` : text);
  const sig = (text.trim().split('\n')[0] ?? '').slice(0, 60);
  if (onSent) onSentHooks.set(chatId, { fn: onSent, sig }); else onSentHooks.delete(chatId);
  freshDrafts.add(chatId);
  for (const fn of draftSubs) fn(chatId);
}
const draftImages = new CheckpointMap<string, ImageAttachment[]>();
const readingN = new Map<string, number>();
const watchers = new Set<() => void>();
const changed = () => { for (const w of watchers) w(); };
const bumpReading = (chatId: string, d: number) => {
  const n = (readingN.get(chatId) ?? 0) + d;
  if (n > 0) readingN.set(chatId, n); else readingN.delete(chatId);
  changed();
};
const EMPTY: readonly QueuedMsg[] = [];
/** per chat: its "/" commands and when they were read (read again after 30 s: the engine may have reported its own) */
const commandCache = new Map<string, { at: number; list: ChatCommand[] }>();
function loadCommands(chatId: string, done: (list: ChatCommand[]) => void): void {
  const c = commandCache.get(chatId);
  if (c) done(c.list);
  if (c && Date.now() - c.at < 30_000) return;
  void window.sb.invoke('chat:commands', { chatId }).then(list => { commandCache.set(chatId, { at: Date.now(), list }); done(list); }, () => { /* no list: the menu stays closed */ });
}

/** The "/" list above the input: the commands matching the typed word; a click picks one. */
function SlashMenu({ items, sel, onPick, testid }: { items: ChatCommand[]; sel: number; onPick: (c: ChatCommand) => void; testid: string }) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => { list.current?.querySelector<HTMLElement>('.slash-item.on')?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  return (
    <div className="slash-menu" data-testid={`${testid}-slash`} onMouseDown={e => e.preventDefault()}>
      <ul ref={list} role="listbox" aria-label={t('chat.input.slashMenu')} id={`${testid}-slash-list`}>
        {items.map((c, i) => (
          <li key={c.name} id={`${testid}-slash-o${i}`} role="option" aria-selected={i === sel} className={`slash-item ${i === sel ? 'on' : ''}`} onClick={() => onPick(c)} data-testid={`${testid}-slash-${c.name}`}>
            <b>/{c.name}{c.hint && <i>{c.hint}</i>}{c.skill && <em>skill</em>}</b>
            <span title={c.description}>{c.description}</span>
          </li>
        ))}
      </ul>
      <div className="slash-foot">{t('chat.input.slashHelp')}</div>
    </div>
  );
}
const NO_IMAGES: readonly ImageAttachment[] = [];
/** Text or images not sent, also for a chat whose input is not on screen (the auto-close keeps it open). */
export const hasDraft = (chatId: string): boolean =>
  !!drafts.get(chatId)?.trim() || !!draftImages.get(chatId)?.length || (readingN.get(chatId) ?? 0) > 0;

export interface ChatInputHandle { focus(): void }
type Props = { chat: ChatSummary; orchestrator?: boolean; testid: string };

// keyed by chat: a view that swaps the chat in place (focus mode) gets a fresh input, never the other chat's draft
export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput(props, handle) {
  return <ChatInputFor key={props.chat.id} {...props} ref={handle} />;
});

const ChatInputFor = forwardRef<ChatInputHandle, Props>(function ChatInputFor({ chat, orchestrator, testid }, handle) {
  const [text, setText] = useState(() => drafts.get(chat.id) ?? '');
  const context = reviewedContextDraft(text), visibleText = context?.message ?? text;
  const [mode, setModeState] = useState<SendMode | null>(() => (orchestrator ? modeOn.get(chat.id) ?? null : null));
  const setMode = (m: SendMode | null) => { if (m) modeOn.set(chat.id, m); else modeOn.delete(chat.id); setModeState(m); };
  const [, rerender] = useState(0);
  useEffect(() => {
    const w = () => rerender(n => n + 1);
    watchers.add(w);
    return () => { watchers.delete(w); };
  }, []);
  const images = draftImages.get(chat.id) ?? NO_IMAGES;
  const reading = readingN.get(chat.id) ?? 0;
  const [dragging, setDragging] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  // "/" list: the caret (the list shows only while it is in the first word), the commands, the choice, Esc for this word
  const [caret, setCaret] = useState(0);
  const [cmds, setCmds] = useState<ChatCommand[] | null>(null);
  const [sel, setSel] = useState(0);
  const [slashOff, setSlashOff] = useState<string | null>(null);
  const query = slashQuery(visibleText, caret);
  const matches = query !== null && cmds && query !== slashOff ? filterCommands(cmds, query) : [];
  const slashOpen = matches.length > 0;
  const slashing = query !== null;
  useEffect(() => { if (slashing) loadCommands(chat.id, setCmds); }, [slashing, chat.id]);
  const [chose, setChose] = useState(false); // the arrows moved the choice
  useEffect(() => { setSel(0); setChose(false); }, [query]);
  const pick = (c: ChatCommand) => {
    const r = applyCommand(visibleText, c.name), next = withReviewedContext(r.text, context);
    setText(next);
    drafts.set(chat.id, next);
    setCaret(r.caret);
    requestAnimationFrame(() => { const el = ta.current; if (el) { el.focus(); el.setSelectionRange(r.caret, r.caret); } });
  };
  const queued = useApp(s => s.queued[chat.id] ?? EMPTY);
  // the message being sent now (first in the queue while the turn is interrupted: a spinner on its chip) and whether
  // the stop is still on its way (the other buttons wait for it). The engine may first finish messages it already
  // held (an agent's app_send_to_chat): meanwhile the chip can still be removed and another one sent now.
  const [pushing, setPushing] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  // done once it left the queue; also when the chat stopped without sending it (error, closed, idle with it still
  // queued): the button comes back instead of a spinner forever
  const settled = chat.state === 'error' || chat.state === 'closed' || chat.state === 'idle';
  useEffect(() => { if (pushing !== null && (queued[0]?.id !== pushing || settled)) setPushing(null); }, [queued, pushing, settled]);
  useImperativeHandle(handle, () => ({ focus: () => ta.current?.focus() }), []);
  useEffect(() => {
    const fn = (id: string) => {
      if (id !== chat.id) return;
      freshDrafts.delete(id);
      const t = drafts.get(id) ?? '';
      setText(t);
      requestAnimationFrame(() => { const el = ta.current; if (el) { el.focus(); el.setSelectionRange(t.length, t.length); el.scrollTop = el.scrollHeight; } });
    };
    draftSubs.add(fn);
    if (freshDrafts.has(chat.id)) fn(chat.id); // mounted by the same action (the Orchestrator docked to show the draft)
    return () => { draftSubs.delete(fn); };
  }, [chat.id]);
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);
  const setImages = (next: (cur: readonly ImageAttachment[]) => ImageAttachment[]) => {
    const v = next(draftImages.get(chat.id) ?? NO_IMAGES);
    if (v.length) draftImages.set(chat.id, v); else draftImages.delete(chat.id);
    changed();
  };
  const busy = isBusy(chat) || chat.state === 'waiting' || chat.pending > 0;
  const enterNow = queued.length > 0 && !text.trim() && !images.length; // Enter = "Invia subito" on the last queued
  const placeholder = enterNow ? t('chat.input.placeholderEnter') : orchestrator && mode ? t(mode === 'quick' ? 'chat.input.placeholderQuick' : 'chat.input.placeholderPlan') : orchestrator ? t('chat.input.placeholderOrchestrator') : chat.pending > 0 ? t('chat.input.placeholderPending') : busy ? t('chat.input.placeholderBusy') : chat.state === 'closed' ? t('chat.input.placeholderClosed') : t('chat.input.placeholderDefault');
  const ready = (text.trim() !== '' || images.length > 0) && reading === 0;
  const submit = (as = mode) => {
    if(updateIsFrozen())return;
    if (reading) return; // a screenshot is still being read: it goes with this message, so wait for it
    if (as && !text.trim()) { toast(t('chat.input.emptyMode'), 'info'); return; } // a mode needs a request in words
    const r = send(chat.id, as && orchestrator ? withMode(as, text) : text, images);
    if (r === 'empty') return;
    if (orchestrator) setMode(null);
    setText('');
    drafts.delete(chat.id);
    const hook = onSentHooks.get(chat.id);
    onSentHooks.delete(chat.id);
    if (hook && text.includes(hook.sig)) hook.fn(); // another message written over the draft: not the draft
    setImages(() => []);
  };
  /** Reads the image files of a paste or a drop; returns false when there were none (a text paste goes on as usual). */
  const addFiles = (files: File[]): boolean => {
    if (!files.length) return false;
    const room = roomFor((draftImages.get(chat.id)?.length ?? 0) + (readingN.get(chat.id) ?? 0));
    if (room === 0) { toast(t('chat.input.maxImages'), 'info'); return true; }
    const take = files.slice(0, room);
    if (files.length > room) toast(t('chat.input.partialImages', { room, total: files.length }), 'info');
    const chatId = chat.id;
    bumpReading(chatId, take.length);
    for (const f of take) {
      void toAttachment(f)
        .then(im => {
          // into this chat's draft, whichever input shows it now (or none: the image waits there)
          const cur = draftImages.get(chatId) ?? NO_IMAGES;
          const weight = [...cur, im].reduce((n, x) => n + (x.data.length * 3) / 4, 0);
          if (weight > IMAGES_MAX_TOTAL) { toast(t('chat.input.imagesTooHeavy', { max: IMAGES_MAX_TOTAL / 1e6 }), 'info'); return; }
          draftImages.set(chatId, [...cur, im]);
        })
        .catch((e: unknown) => toast(t('chat.input.imageFailed', { error: e instanceof Error ? e.message : String(e) }), 'err'))
        .finally(() => bumpReading(chatId, -1));
    }
    return true;
  };
  // text wins; a paste with no image item (a fresh Win+Shift+S screenshot) asks main for the clipboard's image
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const p = pasteKind(e.clipboardData);
    if (p.kind === 'text') return;
    e.preventDefault();
    if (p.kind === 'files') { addFiles(p.files); return; }
    const chatId = chat.id;
    bumpReading(chatId, 1);
    void window.sb.invoke('clipboard:image', { seen: p.seen }).then(
      im => {
        bumpReading(chatId, -1);
        if (!im) { toast(t('chat.input.clipboardNoImage'), 'info'); return; }
        addFiles([new File([im.bytes as Uint8Array<ArrayBuffer>], 'immagine', { type: im.mimeType })]);
      },
      () => { bumpReading(chatId, -1); toast(t('chat.input.clipboardUnreadable'), 'err'); },
    );
  };
  const hasImages = (e: DragEvent) => [...e.dataTransfer.items].some(i => i.kind === 'file' && i.type.startsWith('image/'));
  const onDragOver = (e: DragEvent<HTMLDivElement>) => { if (!hasImages(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragging(true); };
  const onDrop = (e: DragEvent<HTMLDivElement>) => { setDragging(false); if (addFiles(imageFiles(e.dataTransfer))) { e.preventDefault(); ta.current?.focus(); } };
  const sendNow = (id: string) => {
    if (stopping || !queued.some(q => q.id === id)) return;
    setPushing(id);
    setStopping(true);
    void sendQueuedNow(chat.id, id).then(r => { setStopping(false); if (r !== 'interrupting') setPushing(null); });
  };
  /** Enter on an empty input with messages in the queue: the last one goes now (true = handled) */
  const emptyEnter = (): boolean => {
    if (text.trim() || images.length || reading || !queued.length) return false;
    const last = queued[queued.length - 1]!;
    if (pushing !== last.id) sendNow(last.id);
    return true;
  };
  return (
    <div className={`composer ${orchestrator ? 'composer-orchestrator' : ''}`}>
      {queued.length > 0 && (
        <div className="queued" aria-label={t('chat.input.queuedLabel')}>
          {queued.map((q, i) => {
            const going = pushing === q.id && i === 0;
            const nc = splitMode(q.text);
            const label = (nc.mode ? t('chat.input.queuedModeLabel', { mode: t(`chat.mode.${nc.mode}`), text: nc.text }) : q.text) || t('chat.input.queuedImagesWord', { n: q.images?.length ?? 1 });
            return (
              <span className={`queued-chip ${going ? 'is-going' : ''}`} key={q.id} data-testid={`${testid}-queued-${i}`} title={label}>
                <span className="queued-k">{going ? <><IconSpinner size={10} /> {t('chat.input.queuedSending')}</> : queued.length > 1 ? t('chat.input.queuedPosition', { n: i + 1 }) : t('chat.input.queuedInQueue')}</span>
                {q.images?.length ? <span className="queued-img" data-tip={t('chat.input.queuedImages', { n: q.images.length })}>{q.images[0]?.thumb && <img src={q.images[0].thumb} alt="" />}{q.images.length > 1 && <b>{q.images.length}</b>}</span> : null}
                <span className="queued-t">{label}</span>
                {!going && (
                  <button
                    type="button" className="queued-now" onClick={() => sendNow(q.id)} disabled={stopping}
                    aria-label={t('chat.input.sendNowLabel')} data-tip={t('chat.input.sendNowTip')} data-testid={`${testid}-sendnow-${i}`}
                  ><IconBolt size={11} /><span>{t('chat.input.sendNowButton')}</span></button>
                )}
                <button type="button" className="queued-x" aria-label={t('chat.input.unqueueLabel')} onClick={() => unqueue(chat.id, q.id)} data-testid={`${testid}-unqueue-${i}`}><IconX size={11} /></button>
              </span>
            );
          })}
        </div>
      )}
      <div className={`composer-box ${dragging ? 'is-drop' : ''}`} onDragOver={onDragOver} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        {context && <ReviewedContextPreview context={context} onRemove={() => { setText(context.message); drafts.set(chat.id, context.message); onSentHooks.delete(chat.id); ta.current?.focus(); }}/>}
        {(images.length > 0 || reading > 0) && (
          <div className="composer-images">
            <ImageStrip images={images.map(im => ({ thumb: im.thumb ?? fullSrc(im), full: fullSrc(im) }))} onRemove={i => setImages(cur => cur.filter((_, k) => k !== i))} testid={`${testid}-images`} />
            {reading > 0 && <span className="img-reading" aria-live="polite">{t('chat.input.readingImage', { n: reading })}</span>}
          </div>
        )}
        <div className="composer-row">
          {slashOpen && <SlashMenu items={matches} sel={Math.min(sel, matches.length - 1)} onPick={pick} testid={testid} />}
          <textarea
            ref={ta} rows={1} value={visibleText} placeholder={placeholder} aria-label={orchestrator ? t('chat.input.messageToOrchestrator') : t('chat.input.messageToChat', { title: chat.title })} data-testid={testid} spellCheck={false}
            aria-expanded={slashOpen} aria-controls={slashOpen ? `${testid}-slash-list` : undefined} aria-autocomplete="list"
            aria-activedescendant={slashOpen ? `${testid}-slash-o${Math.min(sel, matches.length - 1)}` : undefined}
            onChange={e => { const next = withReviewedContext(e.target.value, context); setText(next); setCaret(e.target.selectionStart); drafts.set(chat.id, next); if (!next.trim()) onSentHooks.delete(chat.id); if (!e.target.value.startsWith('/')) setSlashOff(null); }}
            onSelect={e => setCaret(e.currentTarget.selectionStart)}
            onPaste={onPaste}
            onKeyDown={e => {
              if (slashOpen && !e.nativeEvent.isComposing) {
                const cur = matches[Math.min(sel, matches.length - 1)]!;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setChose(true); setSel(i => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length); return; }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSlashOff(query); return; }
                // Invio completes a name that contains the typed word, or one chosen with the arrows; else the text goes as
                // typed (a command the list does not know yet, "/tmp/log"…)
                const byName = cur.name !== query && cur.name.toLowerCase().includes((query ?? '').toLowerCase());
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && (byName || (chose && cur.name !== query)))) { e.preventDefault(); pick(cur); return; }
              }
              if (orchestrator && e.key === 'Enter' && e.shiftKey && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); submit('quick'); return; }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!emptyEnter()) submit(); }
            }}
          />
          {orchestrator && (['quick', 'plan'] as const).map(m => (
            <button type="button" key={m} className={`newchat-toggle ${mode === m ? 'on' : ''}`} aria-pressed={mode === m} onClick={() => { setMode(mode === m ? null : m); ta.current?.focus(); }}
              data-tip={mode === m ? t('chat.input.modeTipOff') : t(m === 'quick' ? 'chat.input.quickTip' : 'chat.input.planTip')}
              data-testid={`${testid}-mode-${m}`}>{m === 'quick' ? <IconBolt size={12} /> : <IconBranch size={12} />}<span>{t(`chat.mode.${m}`)}</span></button>
          ))}
          {ready ? (
            <button type="button" className="send" onClick={() => submit()} aria-label={mode ? t(busy ? 'chat.input.queueAsMode' : 'chat.input.sendAsMode', { mode: t(`chat.mode.${mode}`) }) : busy ? t('chat.input.queue') : t('chat.input.send')} data-tip={mode ? t(busy ? 'chat.input.queueAsModeTip' : 'chat.input.sendAsModeTip', { mode: t(`chat.mode.${mode}`) }) : busy ? t('chat.input.queueShort') : t('chat.input.sendShort')} data-testid={`${testid}-send`}><IconSend size={14} /></button>
          ) : (
            <span className="composer-hint" aria-hidden="true">{enterNow ? t('chat.input.hintNow') : busy && !orchestrator ? t('chat.input.queuedInQueue') : ''} <Kbd>{auditText('audit.ChatInput.enter')}</Kbd></span>
          )}
        </div>
      </div>
    </div>
  );
});

interface ChatDraftCopy{version:1;entries:{id:string;text:string;images:ImageAttachment[];newChat:boolean;mode?:SendMode}[]}
const CHAT_RECOVERY_KEY='sb.update.chat-drafts.v1';
export function chatDraftCheckpointProblem():string|null{
  if(readingN.size)return auditText('cmp.chatInput.waitAttachments');
  if(onSentHooks.size)return auditText('cmp.chatInput.pendingDrafts');
  if(draftStorageProblem)return auditText('cmp.chatInput.draftCopyFailed');
  return null;
}
export function chatDraftCheckpoint():ChatDraftCopy{
  const ids=new Set([...drafts.keys(),...draftImages.keys(),...modeOn.keys()]);
  return {version:1,entries:[...ids].map(id=>{const mode=modeOn.get(id);return {id,text:drafts.get(id)??'',images:[...(draftImages.get(id)??[])],newChat:!!mode,...(mode?{mode}:{})};})};
}
export function validateChatDraftCopy(value:unknown):ChatDraftCopy{
  const copy=value as ChatDraftCopy;
  if(!copy||copy.version!==1||!Array.isArray(copy.entries)||copy.entries.length>1000)throw Error(auditText('cmp.chatInput.invalidCopy'));
  const ids=new Set<string>();
  for(const entry of copy.entries){
    if(!entry||typeof entry.id!=='string'||!entry.id||entry.id.length>160||ids.has(entry.id)||typeof entry.text!=='string'||entry.text.length>1000000||typeof entry.newChat!=='boolean'||entry.mode!==undefined&&entry.mode!=='quick'&&entry.mode!=='plan'||!Array.isArray(entry.images)||entry.images.length>10)throw Error(auditText('cmp.chatInput.invalidCopy'));
    ids.add(entry.id);
    for(const image of entry.images){if(!image||!['image/png','image/jpeg','image/gif','image/webp'].includes(image.mimeType)||typeof image.data!=='string'||image.data.length>5000000||!/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)||image.thumb!==undefined&&(typeof image.thumb!=='string'||image.thumb.length>120000||!/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(image.thumb)))throw Error(auditText('cmp.chatInput.invalidAttachment'));}
    for(const image of entry.images){validateRecoveryRaster(`data:${image.mimeType};base64,${image.data}`,1920,1,3750000);if(image.thumb)validateRecoveryRaster(image.thumb,240,1,90000);}
  }
  return copy;
}
export function restoreChatDraftCopy(value:unknown):void{
  const copy=validateChatDraftCopy(value);recoveredDrafts=false;
  drafts.clear();draftImages.clear();modeOn.clear();
  // a copy from before the modes has only newChat: the old "one new chat" is the quick path
  for(const entry of copy.entries){drafts.set(entry.id,entry.text);if(entry.images.length)draftImages.set(entry.id,entry.images);if(entry.mode||entry.newChat)modeOn.set(entry.id,entry.mode??'quick');}
  recoveredDrafts=true;persistChatRecovery();
}
function persistChatRecovery():void{
  if(!recoveredDrafts)return;
  try{localStorage.setItem(CHAT_RECOVERY_KEY,JSON.stringify(chatDraftCheckpoint()));draftStorageProblem=false;}
  catch{draftStorageProblem=true;}
}

export function enableChatDraftRecovery():void{recoveredDrafts=true;persistChatRecovery();}
