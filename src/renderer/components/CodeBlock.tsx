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
// (lib/richtext.ts). Used by ChatItems.tsx (assistant messages), OrchestratorTile.tsx and AskContext.tsx.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RunInfo } from '@shared/contract';
import { isRunnable, MAX_RUN_CODE, prodRisk, runReport } from '@shared/runnable';
import { sb } from '../sb';
import { useBlockRun } from '../lib/runs';
import { blockKey, hhmm, isSendable, UNDO_MS } from '../lib/sendable';
import { useMark } from '../lib/marks';
import { duration, folderName } from '../lib/format';
import { useNow } from '../lib/clock';
import { markCopied, markSent, send, undoSent, useApp } from '../store/store';
import { copyText } from '../brain/components/ui';
import { renderMarkdown } from '../lib/markdown';
import { clipboardHtml, copyRich, isRich } from '../lib/richtext';
import { IconAlert, IconCheck, IconCopy, IconPlay, IconSend, IconSpinner, IconStop, IconTerminal, IconX } from './Icons';
import { t } from '../i18n';

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
  const runnable = !!chatId && isRunnable(lang) && !streaming && !!code.trim();
  const tooLong = code.length > MAX_RUN_CODE;
  const running = run?.state === 'running';
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 8000); return () => clearTimeout(t); }, [armed]);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(t); }, [copied]);

  const doRun = async () => {
    if (!chatId || busy) return;
    if (risk && !armed) { setArmed(true); return; }
    setArmed(false); setErr(null); setBusy(true);
    try { await sb.invoke('run:start', { chatId, itemId, code, lang, ...(risk ? { confirmProd: true } : {}) }); }
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
        {runnable && (running ? null : (
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
      {run && chatId && <RunPanel run={run} chatId={chatId} />}
    </div>
  );
}
