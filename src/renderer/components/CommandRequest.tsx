// "Comando da eseguire": a shell block a chat left for the user (main/run/asks.ts), as a request card in the same four
// sizes as questions and permissions (lane card, chat tile, questions window and global layer, the Orchestrator's decision,
// compact). It shows
// who proposed it, the chat's explanation right before the block (`command.lead`, in sight; the turn's prose under
// "Contesto", one click away, AskContext.tsx) and the command (first lines, the rest one click away), with Esegui /
// Copia / Vai alla chat / "Rispondi dopo" / Non serve, and a free text field (like the other questions) whose words go
// to the chat instead of the run.
// Esegui runs the block in the chat that proposed it (run:start with that chat and message: the run, its output and
// "Manda l'esito alla chat" stay under the block in that chat); a block that looks like production asks a second click
// that says why, like under the block. Keys on the focused card: Enter = Esegui, Esc = what the host says (the window:
// later). In the questions window (`window`, ADR 0049) two words say what the command does (Gist.tsx), the chat's
// explanation is the large title, the whole command a readable block under it and the context open under that (never
// folded, the owner 2026-10-22). Used by RequestPanel.tsx (it hands over every request of type 'command').
// In the questions window it is a «Bivio» decision card (ADR 0259, WindowCommand): «Eseguo questo comando sul tuo PC?»,
// the chat's reason, the command with its folder, Sì = run it (the result goes to the chat by itself, and answers the
// question the chat stopped on right after the block) and «Non serve»; the run then shows in RunWatch.tsx.
import { t as auditText } from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Harness, PendingRequest } from '@shared/contract';
import { copyText } from '../brain/components/ui';
import { ago } from '../lib/format';
import { useNow } from '../lib/clock';
import { claimFocus, reqKey } from '../actions';
import { dismissCommand, runCommand, useApp } from '../store/store';
import { AskContext, AskThought } from './AskContext';
import { HarnessMark, IconAlert, IconArrowRight, IconCheck, IconCopy, IconPlay, IconTerminal } from './Icons';
import { Kbd } from './ui';
import { Gist } from './Gist';
import { DecisionCard } from './DecisionCard';
import { watchRun } from '../lib/run-watch';
import { t } from '../i18n';

export type CommandVariant = 'lane' | 'tile' | 'orchestrator' | 'compact' | 'window';

export interface CommandHandlers {
  /** Esegui through someone else (the layer relays to the app page); resolves false when it did not start */
  onRun?: (confirmProd: boolean) => Promise<boolean> | boolean;
  onDismiss?: () => void;
  /** "Vai alla chat": shown only when given (never on the chat's own tile, where the block already is) */
  onOpen?: () => void;
  onEscape?: () => void;
  /** "Rispondi dopo": sets the request aside without answering (shown only when given) */
  onLater?: () => void;
  /** the user's own words instead of running it (default: dismissCommand with the text, sent to the chat at once) */
  onReply?: (text: string) => void;
}

export function CommandRequest({ req, variant, chatTitle, harness = 'claude', testid, withContext, onRun, onDismiss, onOpen, onEscape, onLater, onReply }: {
  req: PendingRequest; variant: CommandVariant; chatTitle?: string; harness?: Harness; testid?: string;
  /** the "Contesto" toggle with the turn's prose (not in the global layer: its page can not read the chat) */
  withContext?: boolean;
} & CommandHandlers) {
  const cmd = req.command;
  const code = cmd?.code ?? req.detail;
  const prod = cmd?.prod ?? null;
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  // Ctrl+J asked for this card before it was drawn: the keyboard comes here as it mounts (actions.ts claimFocus)
  useLayoutEffect(() => { if (claimFocus(reqKey(req))) ref.current?.focus({ preventScroll: true }); }, [req]);
  const now = useNow(15_000);
  const testBase = testid ?? (variant === 'lane' ? `lane-card-${req.chatId}-${req.id}` : `request-${req.chatId}-${req.id}`);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 8000); return () => clearTimeout(t); }, [armed]);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(t); }, [copied]);

  const armedAt = useRef(0);
  /** keyboard flow only: the next card of the lane (or the next panel) takes the focus, like AskPanel */
  const focusNext = () => {
    const here = ref.current;
    // in the questions window the window itself gives the next card the keyboard (QuestionsWindow.tsx), as in AskPanel
    if (!here || !here.contains(document.activeElement) || here.closest('.qwin')) return;
    const all = [...document.querySelectorAll<HTMLElement>(variant === 'lane' ? '[data-lane][data-request-key]' : '[data-request-key]')];
    const next = all[all.indexOf(here) + 1] ?? all.find(x => x !== here);
    requestAnimationFrame(() => { if (next && next.isConnected) next.focus(); });
  };
  const run = async (viaKey = false) => {
    if (busy) return;
    if (prod && !armed) { armedAt.current = Date.now(); setArmed(true); return; }
    // a double click or a held key is not a second, read confirmation
    if (prod && Date.now() - armedAt.current < 600) return;
    setArmed(false); setBusy(true);
    if (viaKey) focusNext();
    const ok = await (onRun ? onRun(!!prod) : runCommand(req, !!prod));
    if (!ok) setBusy(false); // started: the card leaves by itself (main resolves the request)
    else if (variant === 'window') watchRun(req); // its run shows in the strip at the bottom (RunWatch.tsx)
  };
  const dismiss = () => { setBusy(true); if (onDismiss) onDismiss(); else void dismissCommand(req); };
  const copy = () => { void copyText(code).then(ok => setCopied(ok)); };
  const answer = () => { const text = reply.trim(); if (!text || busy) return; setBusy(true); if (onReply) onReply(text); else void dismissCommand(req, text); };
  // free text, like the other questions: the chat gets the user's words instead of the run (not in the one-line lane card)
  const replyField = (big: boolean) => !onDismiss || onReply ? <form className={`cmd-reply ${big ? 'big' : ''}`} onSubmit={e => { e.preventDefault(); answer(); }}>
    <input type="text" value={reply} maxLength={4000} onChange={e => setReply(e.target.value)} disabled={busy} placeholder={t('chat.command.replyHint')}
      aria-label={t('chat.command.replyLabel')} data-testid={`${testBase}-reply`} onKeyDown={e => e.stopPropagation()} />
    <button type="submit" className={`btn btn-ghost ${big ? 'btn-l' : 'btn-m'}`} disabled={busy || !reply.trim()} data-testid={`${testBase}-reply-send`}>{t('chat.command.replySend')}</button>
  </form> : null;
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // a focused button handles its own Enter
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) void run(true); }
    // Esc first takes back an armed confirmation (wherever the card is), then goes to the host
    else if (e.key === 'Escape' && (armed || onEscape)) { e.preventDefault(); e.stopPropagation(); if (armed) setArmed(false); else onEscape?.(); }
  };

  const lines = code.split('\n');
  const small = variant === 'lane' || variant === 'compact';
  const shown = open ? code : lines.slice(0, small ? 1 : 3).join('\n');
  const more = lines.length > (small ? 1 : 3) || shown.length > 110;
  const age = ago(req.at, now);
  const prodBadge = <span className="cb-prod" data-testid={`${testBase}-prod`} title={t('chat.codeblock.productionWarning', { warning: prod ?? '' })}><IconAlert size={11} /> {t('chat.codeblock.productionBadge')}</span>;
  const cls = variant === 'orchestrator' ? 'decision cmd-ask' : small ? 'need-card cmd-ask cmd-small' : 'ask cmd-ask';

  if (variant === 'window') return <WindowCommand req={req} chatTitle={chatTitle} testBase={testBase} withContext={!!withContext} prod={prod} armed={armed} busy={busy}
    cardRef={ref} onRun={viaKey => { void run(!!viaKey); }} onDismiss={dismiss} onCopy={copy} copied={copied} onEscape={() => { if (armed) setArmed(false); else onEscape?.(); }}
    onReply={text => { if (busy) return; setBusy(true); if (onReply) onReply(text); else void dismissCommand(req, text); }} />;

  return (
    <div ref={ref} tabIndex={0} onKeyDown={onKey} className={`${cls} ${busy ? 'sent' : ''}`} role="group" data-request-key={reqKey(req)} data-testid={testBase} data-kind="command"
      aria-busy={busy} aria-label={t('chat.command.askLabel', { chatTitle: chatTitle ?? auditText('cmp.commandRequest.aChat'), command: lines[0] ?? '' })} {...(variant === 'lane' ? { 'data-lane': '' } : {})}>
      {variant === 'lane' ? (
        // the lane: who first, like the other lane cards
        <div className="need-head">
          <HarnessMark harness={harness} size={16} /><b className="need-title" data-testid={`${testBase}-from`}>{chatTitle}</b>
          {prod && prodBadge}
          <span className="need-age">{age}</span>
        </div>
      ) : null}
      <div className="cmd-head">
        {variant !== 'lane' && <span className="ask-icon"><IconTerminal size={14} /></span>}
        <span className="cmd-kind">{t('chat.command.title')}</span>
        {prod && variant !== 'lane' && prodBadge}
        <span className="sp" />
        {variant !== 'lane' && <span className="ask-age">{age}</span>}
      </div>
      {cmd?.lead && <p className={`cmd-lead ${small ? 'small' : ''}`} title={cmd.lead} data-testid={`${testBase}-lead`}>{cmd.lead}</p>}
      <div className={`ask-raw ${open ? 'open' : ''}`}>
        <pre className="ask-cmd cmd-code" data-testid={`${testBase}-code`}>{shown}</pre>
        {more && (
          <button type="button" className="ask-raw-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid={`${testBase}-code-toggle`}>
            {open ? t('chat.command.showLess') : lines.length > 1 ? t('chat.command.showMore', { lines: lines.length }) : t('chat.command.showAll')}
          </button>
        )}
      </div>
      {withContext && <AskContext req={req} defaultOpen={false} testBase={testBase} thinking="last" onToggle={() => requestAnimationFrame(() => ref.current?.focus())} />}
      {!small && replyField(false)}
      <div className="cmd-actions">
        <button type="button" className={`btn btn-primary ${small ? 'btn-s' : 'btn-m'} ${armed ? 'armed' : ''}`} onClick={() => { void run(); }} disabled={busy} data-testid={`${testBase}-run`}
          data-tip={armed ? undefined : t('chat.command.help')}>
          {armed ? <><IconAlert size={12} /> {t('chat.command.execConfirm', { warning: prod ?? '' })}</> : <><IconPlay size={11} /> {t('chat.command.exec')}</>}{!small && !armed && <Kbd>{auditText('audit.CommandRequest.enter')}</Kbd>}
        </button>
        <button type="button" className={`btn btn-ghost ${small ? 'btn-s' : 'btn-m'}`} onClick={copy} data-testid={`${testBase}-copy`}>
          {copied ? <><IconCheck size={12} /> {t('chat.codeblock.copied')}</> : <><IconCopy size={12} /> {t('chat.command.copy')}</>}
        </button>
        {onOpen && (
          <button type="button" className={`btn btn-ghost ${small ? 'btn-s' : 'btn-m'}`} onClick={onOpen} data-testid={`${testBase}-open`}>{t('chat.command.openChat')} <IconArrowRight size={12} /></button>
        )}
        <span className="sp" />
        {onLater && (
          <button type="button" className={`btn btn-ghost ${small ? 'btn-s' : 'btn-m'}`} onClick={onLater} disabled={busy} data-testid={`${testBase}-later`}>{t('chat.command.later')}{!small && onEscape && <Kbd>Esc</Kbd>}</button>
        )}
        <button type="button" className={`btn btn-ghost ${small ? 'btn-s' : 'btn-m'} cmd-dismiss`} onClick={dismiss} disabled={busy} data-testid={`${testBase}-dismiss`}
          data-tip={t('chat.command.dismissTip')}>{t('chat.command.dismiss')}</button>
      </div>
    </div>
  );
}

/** The questions window's command card (ADR 0259, «Bivio»): «Eseguo questo comando sul tuo PC?», the chat's reason as
 *  the context, the command whole with its folder and Copia, then the two roads: Sì runs it here and the result goes to
 *  the chat by itself; «Non serve» lets the chat go on without it. A production command asks a second, read
 *  confirmation on the same button. The run then shows in the strip at the bottom of the window (RunWatch.tsx). */
function WindowCommand({ req, chatTitle, testBase, withContext, prod, armed, busy, cardRef, onRun, onDismiss, onCopy, copied, onEscape, onReply }: {
  req: PendingRequest; chatTitle?: string; testBase: string; withContext: boolean; prod: string | null; armed: boolean; busy: boolean;
  cardRef: React.RefObject<HTMLDivElement | null>; onRun: (viaKey?: boolean) => void; onDismiss: () => void; onCopy: () => void; copied: boolean;
  onEscape: () => void; onReply: (text: string) => void;
}) {
  const cmd = req.command;
  const code = cmd?.code ?? req.detail;
  const who = useApp(s => { const c = s.chats[req.chatId]; return c?.isOrchestrator ? 'Orchestrator' : c?.agent?.name ?? chatTitle ?? c?.title ?? 'chat'; });
  const cwd = useApp(s => s.chats[req.chatId]?.cwd ?? '');
  const lead = (cmd?.lead ?? '').trim();
  // the chat wrote its own question right before the block («Lo lanci?»): it stays the question
  const own = /\?$/.test(lead) && lead.length <= 160;
  const head = (
    <>
      <Gist tool="command" input={null} command={code} testid={`${testBase}-gist`} />
      <span className="wq-kind"><IconTerminal size={12} /><span>{t('chat.command.title')}</span></span>
      {prod && <span className="cb-prod" data-testid={`${testBase}-prod`} title={t('chat.codeblock.productionWarning', { warning: prod })}><IconAlert size={11} /> {t('chat.codeblock.productionBadge')}</span>}
    </>
  );
  return (
    <DecisionCard ref={cardRef} testBase={testBase} head={head} question={own ? lead : t('chat.command.askQ')} why={own ? undefined : lead || undefined}
      className={`wq cmd-ask ${armed ? 'armed' : ''}`} busy={busy}
      rootProps={{ 'data-request-key': reqKey(req), 'data-kind': 'command', 'aria-label': t('chat.command.windowAskLabel', { chatTitle: chatTitle ?? auditText('cmp.commandRequest.aChat'), command: code.split('\n')[0] ?? '' }) }}
      yesSteps={[t('chat.command.stepRun'), t('chat.command.stepResult', { who })]} noSteps={[t('chat.command.stepSkip'), t('chat.command.stepOn', { who })]}
      yes={{ onChoose: onRun, recommended: true, testid: `${testBase}-run`, label: armed ? t('chat.command.execConfirm', { warning: prod ?? '' }) : t('chat.command.yesLabel') }}
      no={{ onChoose: onDismiss, testid: `${testBase}-dismiss`, label: t('chat.command.dismiss') }}
      write={{ onSend: text => onReply(text), hint: t('chat.command.replyHint'), testids: { input: `${testBase}-reply`, send: `${testBase}-reply-send` } }}
      onLater={onEscape} laterButton={false} speakFrom={who}>
      <div className="cmd-box" data-testid={`${testBase}-box`}>
        <div className="cmd-box-h">
          <span>{t('chat.command.where', { cwd })}</span>
          <span className="sp" />
          <button type="button" className="btn btn-ghost btn-s" onClick={onCopy} data-testid={`${testBase}-copy`}>
            {copied ? <><IconCheck size={12} /> {t('chat.codeblock.copied')}</> : <><IconCopy size={12} /> {t('chat.command.copy')}</>}
          </button>
        </div>
        <pre className="ask-cmd cmd-code" data-testid={`${testBase}-code`}>{code}</pre>
      </div>
      {/* the yes/no card's reasoning (the owner, 2026-11-10): only the last piece, open; none in the fold */}
      {withContext && <AskThought req={req} testBase={testBase} />}
      {withContext && <AskContext req={req} defaultOpen={false} testBase={testBase} noVisuals thinking="none" label={t('genui.decision.chatText')} />}
    </DecisionCard>
  );
}
