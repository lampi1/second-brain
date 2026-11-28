// The short cards of the Orchestrator's waiting list (ADR 0367, mockup nuova-ui.html, owner 2026-11-27), drawn in
// place of a closed row for the two commonest asks:
// - a command left for Esegui: one line «▶ Esegui · what it does · where · risk», the command in one mono line with its
//   «Copia», the chat's reason in one sentence, Esegui / No. A production command asks a second click on Esegui that
//   says why, as everywhere (CommandRequest.tsx). Clicking the head opens the full card (more lines, «Già fatto»…).
// - a yes/no question of an agent: who (role · topic), the question in one line, Sì / No / «Cosa cambia?» (the
//   Orchestrator explains it first, QuestionsWindow requestExplainFirst).
// The run, the answer and the copy go through the store's usual paths (runCommand, dismissCommand, answer). Used by
// QuestionsWindow.tsx (AskRow); the words come from lib/orch-lines.ts and the gist from shared/gist.ts.
import { useEffect, useRef, useState } from 'react';
import type { PendingRequest } from '@shared/contract';
import { commandGist } from '@shared/gist';
import { copyText } from '../brain/components/ui';
import { dismissCommand, runCommand, useApp } from '../store/store';
import { folderName } from '../lib/format';
import { commandRisk, outcomeLine } from '../lib/orch-lines';
import { t } from '../i18n';
import { IconAlert, IconCheck, IconChevronRight } from './Icons';

/** What the command card's head says: the gist, the folder, the risk. Pure (exported for tests). */
export function commandHead(code: string, cwd: string, prod: string | null | undefined): { gist: string; where: string; risk: 'prod' | 'write' | 'read' } {
  const gist = commandGist(code) ?? 'command';
  return { gist: t(`genui.gist.${gist}`), where: cwd ? folderName(cwd) : '', risk: commandRisk(gist, prod) };
}

export function CommandCard({ req, who, onOpen }: { req: PendingRequest; who: string; onOpen: () => void }) {
  const cmd = req.command;
  const code = cmd?.code ?? req.detail;
  const prod = cmd?.prod ?? null;
  const cwd = useApp(s => s.chats[req.chatId]?.cwd ?? '');
  const head = commandHead(code, cwd, prod);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const armedAt = useRef(0);
  useEffect(() => { if (!armed) return; const h = setTimeout(() => setArmed(false), 8000); return () => clearTimeout(h); }, [armed]);
  useEffect(() => { if (!copied) return; const h = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(h); }, [copied]);
  const run = async () => {
    if (busy) return;
    if (prod && !armed) { armedAt.current = Date.now(); setArmed(true); return; }
    if (prod && Date.now() - armedAt.current < 600) return; // a double click is not a second, read confirmation
    setArmed(false); setBusy(true);
    if (!(await runCommand(req, !!prod))) setBusy(false);
  };
  const lines = code.split('\n');
  const lead = outcomeLine(cmd?.lead ?? '');
  return (
    <div className={`oc-card oc-exe${busy ? ' oc-sent' : ''}`} data-testid="orchestrator-cmd-card" data-request-key={`${req.chatId}/${req.id}`}>
      <button type="button" className="oc-exe-head" onClick={onOpen} title={who} data-testid="orchestrator-cmd-head">
        <span aria-hidden="true">▶</span> {[t('chat.command.exec'), head.gist, head.where].filter(Boolean).join(' · ')} · <span className={`oc-risk oc-r-${head.risk}`}>{t(`chat.cmdcard.risk.${head.risk}`)}</span>
        <IconChevronRight size={11} className="oc-chev" />
      </button>
      <div className="oc-cmd-row">
        <div className="oc-cmd" title={code} data-testid="orchestrator-cmd-code">{lines[0]}{lines.length > 1 ? ' …' : ''}</div>
        <button type="button" className="oc-copy" onClick={() => { void copyText(code).then(setCopied); }} data-testid="orchestrator-cmd-copy">
          {copied ? <><IconCheck size={11} /> {t('chat.cred.copied')}</> : t('chat.cred.copy')}
        </button>
      </div>
      <div className="oc-row">
        <span className="oc-grow oc-exe-lead" title={cmd?.lead}>{lead}</span>
        <button type="button" className={`oc-btn oc-amb${armed ? ' oc-armed' : ''}`} onClick={() => { void run(); }} disabled={busy} data-testid="orchestrator-cmd-run"
          title={armed ? t('chat.command.execConfirm', { warning: prod ?? '' }) : undefined}>
          {armed ? <><IconAlert size={12} /> {t('chat.cmdcard.confirm')}</> : t('chat.command.exec')}
        </button>
        <button type="button" className="oc-btn" onClick={() => { setBusy(true); void dismissCommand(req); }} disabled={busy} data-testid="orchestrator-cmd-no">{t('chat.questions.no')}</button>
      </div>
    </div>
  );
}

export function QuestionCard({ who, topic, question, sent, onYes, onNo, onExplain, onOpen }: {
  who: string; topic: string; question: string; sent: boolean; onYes: () => void; onNo: () => void; onExplain?: () => void; onOpen: () => void;
}) {
  return (
    <div className="oc-card oc-ask" data-testid="orchestrator-ask-card">
      <button type="button" className="oc-who oc-ask-who" onClick={onOpen} data-testid="orchestrator-ask-toggle">{[who, topic].filter(Boolean).join(' · ')}</button>
      <div className="oc-ask-q" title={question}>{question}</div>
      <div className="oc-row">
        <button type="button" className="oc-btn oc-pri" disabled={sent} onClick={onYes} data-testid="orchestrator-ask-yes">{t('chat.questions.yes')}</button>
        <button type="button" className="oc-btn" disabled={sent} onClick={onNo} data-testid="orchestrator-ask-no">{t('chat.questions.no')}</button>
        {onExplain && <button type="button" className="oc-btn oc-ghost" onClick={onExplain} data-testid="orchestrator-ask-explain">{t('chat.cmdcard.whatChanges')}</button>}
      </div>
    </div>
  );
}
