// The strip of the commands just run from a question card (ADR 0259, lib/run-watch.ts): at the bottom of the window,
// one line per run: «In esecuzione» with the seconds and the last output line, then «Fatto: esito mandato a …» (gone by
// itself after a few seconds) or the error with its last line, Riprova and Apri chat. The result already went to the
// chat by itself (run/results.ts): the strip only shows it. Mounted by App.tsx; pinned by test/e2e/command-bivio.spec.ts.
import { useEffect } from 'react';
import type { RunInfo } from '@shared/contract';
import { focusChat } from '../actions';
import { useNow } from '../lib/clock';
import { useBlockRun } from '../lib/runs';
import { unwatchRun, useWatchedRuns, watchRun, type Watched } from '../lib/run-watch';
import { runCommand, useApp } from '../store/store';
import { t } from '../i18n';
import { IconAlert, IconCheck, IconPlay, IconX } from './Icons';
import '../styles/run-watch.css';

/** how long «Fatto» stays before the strip goes */
const OK_MS = 4000;

const lastLine = (out: string) => out.trimEnd().split('\n').filter(l => l.trim()).pop()?.slice(0, 160) ?? '';

export function RunWatch() {
  const runs = useWatchedRuns();
  if (!runs.length) return null;
  return <div className="run-watch" role="status" aria-live="polite" data-testid="run-watch">{runs.map(w => <Strip key={w.key} w={w} />)}</div>;
}

function Strip({ w }: { w: Watched }) {
  const c = w.req.command!;
  const run: RunInfo | null = useBlockRun(w.req.chatId, c.itemId, c.code);
  // a run from before this click (an older one of the same block) is not this one
  const mine = run && run.startedAt >= w.at - 5000 ? run : null;
  const who = useApp(s => { const ch = s.chats[w.req.chatId]; return ch?.isOrchestrator ? 'Orchestrator' : ch?.agent?.name ?? ch?.title ?? 'chat'; });
  const auto = useApp(s => s.settings?.runResults !== false);
  const now = useNow(1000);
  const state = mine?.state ?? 'running';
  useEffect(() => {
    if (state !== 'ok') return;
    const tm = setTimeout(() => unwatchRun(w.key), OK_MS);
    return () => clearTimeout(tm);
  }, [state, w.key]);
  const secs = Math.max(0, Math.round(((mine?.endedAt ?? now) - (mine?.startedAt ?? w.at)) / 1000));
  const line = mine ? lastLine(mine.output) : '';
  // a production command needs its two clicks: its retry is in the chat, next to the block
  const retry = async () => { if (await runCommand(w.req, false, false)) watchRun(w.req); };
  return (
    <div className={`rw-strip ${state}`} data-testid="run-watch-strip" data-state={state}>
      <span className="rw-icon" aria-hidden="true">{state === 'ok' ? <IconCheck size={13} /> : state === 'running' ? <IconPlay size={11} /> : state === 'stopped' ? <IconX size={13} /> : <IconAlert size={13} />}</span>
      <span className="rw-main">
        <span className="rw-head">
          <b>{state === 'running' ? t('chat.command.watch.running') : state === 'ok' ? (auto ? t('chat.command.watch.ok', { who }) : t('chat.command.watch.done'))
            : state === 'stopped' ? t('chat.command.watch.stopped') : t(auto ? 'chat.command.watch.fail' : 'chat.command.watch.failSelf', { who, code: mine?.exitCode != null ? ` ${mine.exitCode}` : '' })}</b>
          <span className="rw-time">{secs} s</span>
        </span>
        <code className="rw-code">{c.code.split('\n')[0]}</code>
        {line && <span className="rw-out" data-testid="run-watch-out">{line}</span>}
      </span>
      <span className="rw-acts">
        {(state === 'error' || state === 'stopped') && !c.prod && <button type="button" className="btn btn-ghost btn-s" onClick={() => { void retry(); }} data-testid="run-watch-retry">{t('chat.command.watch.retry')}</button>}
        {state !== 'running' && state !== 'ok' && <button type="button" className="btn btn-ghost btn-s" onClick={() => { unwatchRun(w.key); focusChat(w.req.chatId); }}>{t('chat.command.watch.openChat')}</button>}
        <button type="button" className="btn btn-ghost btn-s rw-close" onClick={() => unwatchRun(w.key)} aria-label={t('chat.command.watch.close')} data-testid="run-watch-close"><IconX size={12} /></button>
      </span>
    </div>
  );
}
