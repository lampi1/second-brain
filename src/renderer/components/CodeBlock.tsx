// A code block of a chat message with its toolbar: "Copia" on every block, "Esegui" on shell blocks (bash, powershell…)
// of an app chat, "Mandato" on a text for the user to send (a mail, Teams or PR comment: lib/sendable.ts; ADR 0038).
// Esegui runs the block in Windows PowerShell 5.1 inside the app (main/run/runner.ts) only when the user clicks; the
// live output shows right under the block like a small terminal (Ferma stops it), and when it ends main sends the
// outcome to the chat by itself (main/run/results.ts, setting runResults): the panel says when it got there, "Rimanda"
// sends it again (with the setting off it is the only way, "Manda l'esito alla chat"). A block that looks like
// production asks a second click that says why (me.md "Safety": production commands are the user's alone). On a text
// to send, Copia leaves "Copiato hh:mm" (the chat hears it with the user's next message: copying is not sending) and
// Mandato leaves "Mandato ✓ hh:mm" and, after a few seconds to undo it, tells the chat "[Mandato] <first words…>"
// (store/store.ts markSent). A text tagged md / mail / teams / comment shows formatted and Copia copies it formatted
// (lib/richtext.ts). Inside a work chat's own tile there is no Esegui (ADR 0269, the owner 2026-11-12: «non voglio mai
// domande o comandi nei singoli agenti»): the command waits in the Orchestrator and the block says so («Vai»).
// One command, one panel (ADR 0299): a block whose command another block already left for Esegui, or runs now, gets no
// Esegui: it is a reference to that one, with its state («in attesa», «in corso», «finito, exit N»), «Apri», and the
// original's live output. When main's guard refuses a click (the identical command runs: «Già in corso da N s, avviato
// da «chat»», with its live output; or it ended recently: «Eseguito N min fa, exit X. Rieseguire?» + «Riesegui»), the
// block says so in place.
// Used by ChatItems.tsx (assistant messages), OrchestratorTile.tsx and AskContext.tsx.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RunInfo, RunStart } from '@shared/contract';
import { isRunnable, MAX_RUN_CODE, prodRisk, runReport } from '@shared/runnable';
import { sb } from '../sb';
import { useBlockRun, useCommandRef, useRunById, type CommandRef } from '../lib/runs';
import { blockKey, hhmm, isSendable, UNDO_MS } from '../lib/sendable';
import { useMark } from '../lib/marks';
import { duration, folderName } from '../lib/format';
import { useNow } from '../lib/clock';
import { app, markCopied, markSent, send, undoSent, useApp } from '../store/store';
import { copyText } from '../brain/components/ui';
import { renderMarkdown } from '../lib/markdown';
import { clipboardHtml, copyRich, isRich } from '../lib/richtext';
import { IconAlert, IconArrowRight, IconCheck, IconCopy, IconPlay, IconSend, IconSpinner, IconStop, IconTerminal, IconX } from './Icons';
import { t } from '../i18n';
import { openQueue } from '../lib/later';
import { openChatRef } from '../actions';

/** a chat as the user reads it in one line */
const chatTitle = (chatId: string): string => { const c = app.get().chats[chatId]; return c?.isOrchestrator ? 'Orchestrator' : c?.title ?? chatId; };
const chatName = (chatId: string): string => (app.get().chats[chatId]?.isOrchestrator ? 'Orchestrator' : `«${chatTitle(chatId)}»`);

/** ADR 0299: main's guard did not start the click: the identical command runs, or it ended recently (one yes first) */
function GuardLine({ guard, busy, onRerun }: { guard: RunStart; busy: boolean; onRerun: () => void }) {
  const now = useNow(1000);
  return (
    <div className="cb-err cb-guard" role="status" data-testid="cb-guard" data-already={guard.already}>
      {guard.already === 'running'
        ? t('chat.codeblock.guard.running', { secs: Math.max(0, Math.round((now - guard.startedAt) / 1000)), chat: chatTitle(guard.chatId) })
        : <>{t('chat.codeblock.guard.done', { mins: Math.max(1, Math.round((now - (guard.endedAt ?? guard.startedAt)) / 60_000)), exit: guard.state === 'stopped' ? t('chat.codeblock.guard.stopped') : `exit ${guard.exitCode ?? '?'}` })}
          {' '}<button type="button" className="cb-btn" disabled={busy} onClick={onRerun} data-testid="cb-rerun"><IconPlay size={11} /> {t('chat.codeblock.guard.rerun')}</button></>}
    </div>
  );
}

/** ADR 0299: the line of a repeated block, in place of its Esegui */
function RefLine({ cref }: { cref: CommandRef }) {
  const o = cref.original, chat = chatName(o.chatId), r = cref.run;
  const text = cref.ask ? t('chat.codeblock.ref.waiting', { chat })
    : r?.state === 'running' ? t('chat.codeblock.ref.running', { chat })
      : r?.state === 'stopped' ? t('chat.codeblock.ref.stopped', { chat }) : t('chat.codeblock.ref.done', { chat, code: r?.exitCode });
  const open = () => { if (cref.ask) openQueue(`${cref.ask.chatId}/${cref.ask.id}`); else openChatRef(o.chatId); };
  return (
    <span className="cb-ref" data-testid="cb-ref" data-state={cref.ask ? 'waiting' : r?.state ?? ''} title={t('chat.codeblock.ref.tip')}>
      <IconTerminal size={11} /> {text}
      <button type="button" className="cb-btn" onClick={open} data-testid="cb-ref-open"><IconArrowRight size={11} /> {t('chat.codeblock.ref.open')}</button>
    </span>
  );
}

/** the key of the chat's first command waiting for Esegui in the Orchestrator, if any */
const firstCommandAsk = (chatId: string | null): string | null => {
  const r = app.get().pending.find(p => p.chatId === chatId && p.type === 'command');
  return r ? `${r.chatId}/${r.id}` : null;
};

/** Did the automatic outcome of this run reach the chat (main/run/results.ts labels it "[esito di Esegui")? */
const RUN_TOLD = /^\[esito di Esegui/;

const LANG: Record<string, string> = { bash: 'bash', sh: 'shell', shell: 'shell', powershell: 'PowerShell', ps: 'PowerShell', ps1: 'PowerShell', pwsh: 'PowerShell', cmd: 'cmd', console: 'console' };

function RunPanel({ run, chatId }: { run: RunInfo; chatId: string }) {
  const now = useNow(run.state === 'running' ? 1000 : 60_000);
  const out = useRef<HTMLPreElement>(null);
  const [reported, setReported] = useState<{ id: string; how: 'sent' | 'queued' } | null>(null);
  const auto = useApp(s => s.settings?.runResults !== false);
  const firstLine = run.code.split('\n')[0] ?? '';
  // the chat's outcome messages of this command: one more than while it ran = this run's arrived (no clock: a frozen
  // demo stamps items with its own time); a panel first seen already ended falls back to the times
  const results = useApp(s => {
    let n = 0, last = 0;
    for (const it of s.items[chatId] ?? []) if (it.kind === 'user' && RUN_TOLD.test(it.text) && it.text.includes(firstLine)) { n++; last = it.at; }
    return `${n}:${last}`;
  });
  const [count, lastAt] = results.split(':').map(Number) as [number, number];
  const base = useRef<{ id: string; n: number } | null>(null);
  if (run.state === 'running' && base.current?.id !== run.id) base.current = { id: run.id, n: count };
  const ended = run.endedAt ?? null;
  const told = auto && ended !== null && (base.current?.id === run.id ? count > base.current.n : count > 0 && lastAt >= ended);
  useEffect(() => { const el = out.current; if (el) el.scrollTop = el.scrollHeight; }, [run.output]);
  const running = run.state === 'running';
  const took = duration((run.endedAt ?? now) - run.startedAt);
  const status = running ? <><IconSpinner size={12} /> {t('chat.codeblock.runStatus.running', { time: took })}</>
    : run.state === 'ok' ? <><IconCheck size={12} /> {t('chat.codeblock.runStatus.ok', { time: took })}</>
      : run.state === 'stopped' ? <><IconX size={12} /> {t('chat.codeblock.runStatus.stopped', { time: took })}</>
        : <><IconX size={12} /> {t('chat.codeblock.runStatus.error', { code: run.exitCode, time: took })}</>;
  return (
    <div className={`cb-run cb-run-${run.state}`} data-testid="cb-run" data-state={run.state} data-exit={run.exitCode ?? ''}>
      <div className="cb-run-head">
        <IconTerminal size={13} /><span className="cb-run-name">{t('chat.codeblock.powerShell')}</span>
        <span className="cb-run-cwd" title={run.cwd}>{folderName(run.cwd)}</span>
        <span className="sp" />
        <span className="cb-run-status" data-testid="cb-run-status">{status}</span>
        {running && <button type="button" className="cb-btn cb-stop" onClick={() => { void sb.invoke('run:stop', { runId: run.id }); }} data-testid="cb-stop"><IconStop size={11} /> {t('chat.codeblock.stopButton')}</button>}
      </div>
      <pre className="cb-out" ref={out} data-testid="cb-out" tabIndex={0} aria-label={t('chat.codeblock.outputLabel')}>{run.output || (running ? ' ' : t('chat.codeblock.noOutput'))}</pre>
      {!running && (
        <div className="cb-run-foot">
          {auto && reported?.id !== run.id && (
            <span className={`cb-told ${told ? 'ok' : ''}`} data-testid="cb-told" data-told={told ? '1' : '0'}>
              {told ? <><IconCheck size={12} /> {t('chat.codeblock.runResultAuto')}</> : t('chat.codeblock.runResultWaiting')}
            </span>
          )}
          {/* with the automatic outcome still on its way, a manual one would reach the chat twice: resend only after */}
          {(!auto || told || reported?.id === run.id) && <button type="button" className="cb-btn" disabled={reported?.id === run.id} data-testid="cb-report"
            onClick={() => { const how = send(chatId, runReport(run)); if (how !== 'empty') setReported({ id: run.id, how }); }}>
            {reported?.id !== run.id ? (auto ? t('chat.codeblock.runResend') : t('chat.codeblock.runSendFull'))
              : reported.how === 'sent' ? <><IconCheck size={12} /> {t('chat.codeblock.runSent')}</> : <><IconCheck size={12} /> {t('chat.codeblock.runQueued')}</>}
          </button>}
        </div>
      )}
    </div>
  );
}

/** `label`: what the header calls the block instead of its language (the questions window: "Testo da approvare"). */
/** false inside a work chat's own tile (ChatTile.tsx): commands are run from the Orchestrator only (ADR 0269) */
export const RunHereCtx = createContext(true);

export function CodeBlock({ chatId, itemId, lang, code, streaming, label }: { chatId: string | null; itemId: string; lang: string; code: string; streaming?: boolean; label?: string }) {
  const run = useBlockRun(chatId, itemId, code);
  const [copied, setCopied] = useState(false);
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const risk = prodRisk(code);
  const hasChat = useApp(s => !!chatId && !!s.chats[chatId]);
  const key = chatId && hasChat && !streaming && isSendable(lang) && code.trim() ? blockKey(chatId, code) : null;
  const mark = useMark(key);
  const [undoable, setUndoable] = useState(false);
  // the keyboard never falls out of the block (a question card keeps its keys): Mandato → Annulla → Copia / Mandato
  const head = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    head.current?.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.focus();
  });
  useEffect(() => {
    if (!undoable) return;
    const t = setTimeout(() => {
      if (document.activeElement?.closest('.cb-undo')) refocus.current = 'cb-copy';
      setUndoable(false);
    }, UNDO_MS);
    return () => clearTimeout(t);
  }, [undoable]);
  const rich = isRich(lang);
  const doCopy = () => (rich ? copyRich(clipboardHtml(code), code) : copyText(code));
  const runHere = useContext(RunHereCtx);
  const runnable = !!chatId && isRunnable(lang) && !streaming && !!code.trim();
  const tooLong = code.length > MAX_RUN_CODE;
  const running = run?.state === 'running';
  // ADR 0299: a repeat of another block's command (waiting or running) is a reference, never a second Esegui
  const pending = useApp(s => s.pending);
  const cref = useCommandRef(chatId, itemId, code, pending, !runnable || !!run);
  // main's guard refused the click: the identical run going on, or one that ended recently (a yes first)
  const [guard, setGuard] = useState<(RunStart & { at: number }) | null>(null);
  const guardRun = useRunById(guard?.already === 'running' ? guard.id : null);
  // the run it pointed to ended, or this block ran since the click: the notice is past
  const guardLive = !!guard && (!run || run.startedAt < guard.at) && !(guard.already === 'running' && guardRun && guardRun.state !== 'running');
  useEffect(() => { if (guard && !guardLive) setGuard(null); }, [guard, guardLive]);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 8000); return () => clearTimeout(t); }, [armed]);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(t); }, [copied]);

  const doRun = async (confirmRerun = false) => {
    if (!chatId || busy) return;
    if (risk && !armed && !confirmRerun) { setArmed(true); return; }
    setArmed(false); setErr(null); setBusy(true); setGuard(null);
    try {
      const r = await sb.invoke('run:start', { chatId, itemId, code, lang, ...(risk ? { confirmProd: true } : {}), ...(confirmRerun ? { confirmRerun: true } : {}) });
      if (r?.already) setGuard({ ...r, at: Date.now() });
    }
    catch (e) { setErr(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    finally { setBusy(false); }
  };

  return (
    <div className={`codeblock ${risk ? 'prod' : ''}`} data-testid="codeblock" data-lang={lang}>
      <div className="cb-head" ref={head}>
        <span className="cb-lang">{label ?? (rich ? t('chat.codeblock.formattedText') : Object.hasOwn(LANG, lang.toLowerCase()) ? LANG[lang.toLowerCase()] : (lang || t('chat.codeblock.genericText')))}</span>
        {risk && <span className="cb-prod" data-testid="cb-prod" title={t('chat.codeblock.productionWarning', { warning: risk })}><IconAlert size={11} /> {t('chat.codeblock.productionBadge')}</span>}
        <span className="sp" />
        <button type="button" className="cb-btn" onClick={() => { void doCopy().then(ok => { setCopied(ok); if (ok && key && chatId) markCopied(chatId, key, code); }); }} data-testid="cb-copy"
          aria-label={key ? t('chat.codeblock.copyLabel') : t('chat.codeblock.copyCodeLabel')} data-mark={mark?.kind === 'copied' ? 'copied' : undefined}>
          {copied ? <><IconCheck size={12} /> {t('chat.codeblock.copied')}</>
            : mark?.kind === 'copied' ? <><IconCheck size={12} /> {t('chat.codeblock.copiedTime', { time: hhmm(mark.at) })}</> : <><IconCopy size={12} /> {t('chat.codeblock.copyButton')}</>}
        </button>
        {key && chatId && (mark?.kind === 'sent' ? (
          <span className="cb-sent" data-testid="cb-sent" role="status">
            {t('chat.codeblock.sentMark', { time: hhmm(mark.at) })}
            {undoable && <button type="button" className="cb-btn cb-undo" data-testid="cb-undo" onClick={() => { if (undoSent(key)) { refocus.current = 'cb-mandato'; setUndoable(false); } }}>{t('chat.codeblock.sentUndo')}</button>}
          </span>
        ) : (
          <button type="button" className="cb-btn cb-send-btn" data-testid="cb-mandato" onClick={e => { if (e.currentTarget === document.activeElement) refocus.current = 'cb-undo'; markSent(chatId, key, code); setUndoable(true); }}
            data-tip={t('chat.codeblock.sendTip')}>
            <IconSend size={11} /> {t('chat.codeblock.send')}
          </button>
        ))}
        {cref && <RefLine cref={cref} />}
        {runnable && !cref && !runHere && !running && (
          <button type="button" className="cb-btn" onClick={() => openQueue(firstCommandAsk(chatId))} data-testid="cb-in-orchestrator" data-tip={t('chat.codeblock.inOrchestratorTip')}>
            <IconPlay size={11} /> {t('chat.codeblock.inOrchestrator')}
          </button>
        )}
        {runnable && !cref && runHere && (running ? null : (
          <button type="button" className={`cb-btn cb-run-btn ${armed ? 'armed' : ''}`} onClick={() => { void doRun(); }} disabled={busy || tooLong} data-testid="cb-exec"
            data-tip={tooLong ? t('chat.codeblock.execTipLong', { max: MAX_RUN_CODE }) : armed ? undefined : t('chat.codeblock.execTip')}>
            {armed ? <><IconAlert size={12} /> {t('chat.codeblock.execConfirm', { warning: risk ?? '' })}</> : <><IconPlay size={11} /> {run ? t('chat.codeblock.execAgain') : t('chat.codeblock.execLabel')}</>}
          </button>
        ))}
      </div>
      {rich
        ? <div className="cb-rich md" data-testid="cb-rich" dangerouslySetInnerHTML={{ __html: renderMarkdown(code, !streaming) }} />
        : <pre className="cb-code"><code>{code}</code></pre>}
      {err && <div className="cb-err" role="alert" data-testid="cb-err">{err}</div>}
      {guard && guardLive && <GuardLine guard={guard} busy={busy} onRerun={() => { void doRun(true); }} />}
      {guard && guardLive && guardRun && guardRun.id !== run?.id && <RunPanel run={guardRun} chatId={guardRun.chatId} />}
      {!guard && cref?.run && !run && <RunPanel run={cref.run} chatId={cref.run.chatId} />}
      {run && chatId && <RunPanel run={run} chatId={chatId} />}
    </div>
  );
}
