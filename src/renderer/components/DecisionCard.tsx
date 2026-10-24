// The one card every question and approval uses (ADR 0149, proposal A «Scheda decisione», the owner 2026-10-24: «la
// prima, spingi tanto nella generative UI» · «l'importante è che sia sempre chiaro il contesto della domanda»). Top to
// bottom: who asks, the question large, the evidence (a chat's `brief`: what it did as ✓ lines, its screenshots, checks
// and files, plus any other visual it attached; a plan's steps; a proposal's text), what Sì and No do, then always the
// same four answers: Sì, No, «Scrivi una risposta…» and «Non voglio rispondere»; Esc = «Ci penso dopo». Keys: 1 / S
// (Y, J) yes, 2 / N no, 3 / T write, Enter the recommended one. Presentational: each host decides what an answer does
// (RequestPanel.tsx for agents' questions, PlanApproval.tsx, WorkApproval.tsx, FlowApproval.tsx). BriefEvidence draws
// a brief; it is also GenUi.tsx's view of one shown as a plain chat card.
import { forwardRef, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { UiBrief } from '@shared/contract';
import { t } from '../i18n';
import { AskImages } from './AskImages';
import { IconCheck, IconEdit, IconX } from './Icons';
import { Kbd } from './ui';
import '../styles/decision.css';

export interface DecisionChoice { onChoose: () => void; label?: string; recommended?: boolean; disabled?: boolean; testid?: string }

export interface DecisionProps {
  testBase: string;
  /** who asks: avatar, name, chat and age on one line */
  head: ReactNode;
  question: string;
  /** the evidence block (brief, plan steps, a proposal's text…) */
  children?: ReactNode;
  ifYes?: string; ifNo?: string;
  yes: DecisionChoice; no: DecisionChoice;
  /** the free-text answer; absent = no box */
  write?: { onSend: (text: string) => void; disabled?: boolean; hint?: string; initial?: string; onDraft?: (text: string) => void; testids?: { open?: string; input?: string; send?: string } };
  /** «Non voglio rispondere»: hint = what it does */
  skip?: { onChoose: () => void; hint: string; testid?: string };
  /** «Ci penso dopo» (Esc); laterButton false = only the key (the questions window has its own button) */
  onLater?: () => void;
  laterButton?: boolean;
  className?: string;
  busy?: boolean;
  compact?: boolean;
  /** extra attributes on the root (data-request-key, data-kind…) */
  rootProps?: Record<string, unknown>;
  /** under the answers (a turn's commands) */
  footer?: ReactNode;
}

const YES_KEYS = new Set(['1', 's', 'y', 'j']);
const NO_KEYS = new Set(['2', 'n']);
const WRITE_KEYS = new Set(['3', 't']);

export const DecisionCard = forwardRef<HTMLDivElement, DecisionProps>(function DecisionCard(p, ref) {
  const [writing, setWriting] = useState(!!p.write?.initial);
  const [text, setText] = useState(p.write?.initial ?? '');
  const box = useRef<HTMLTextAreaElement>(null);
  const writeBtn = useRef<HTMLButtonElement>(null);
  const back = useRef(false);
  useEffect(() => { if (!writing && back.current) { back.current = false; writeBtn.current?.focus(); } }, [writing]);
  const busy = !!p.busy;
  const draft = (v: string) => { setText(v); p.write?.onDraft?.(v); };
  const send = () => { const v = text.trim(); if (v && !busy && !p.write?.disabled) p.write?.onSend(v); };
  const close = () => { back.current = true; setWriting(false); };
  const choose = (c: DecisionChoice) => { if (!busy && !c.disabled) c.onChoose(); };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (busy || e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLElement;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return; // the box handles its own keys
    if (el.closest('.codeblock, [data-option-preview], .gu-art')) return; // a visual or a command keeps its keys
    if ((el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'SUMMARY') && (e.key === 'Enter' || e.key === ' ')) return;
    const k = e.key.toLowerCase();
    let done = true;
    if (e.key === 'Escape' && p.onLater) p.onLater();
    else if (YES_KEYS.has(k)) choose(p.yes);
    else if (NO_KEYS.has(k)) choose(p.no);
    else if (WRITE_KEYS.has(k) && p.write && !p.write.disabled) setWriting(true);
    else if (e.key === 'Enter' && !e.shiftKey && (p.yes.recommended || p.no.recommended)) { if (!e.repeat) choose(p.yes.recommended ? p.yes : p.no); }
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); }
  };

  const answer = (c: DecisionChoice, kind: 'yes' | 'no', key: string) => (
    <button type="button" className={`dc-answer ${kind} ${c.recommended ? 'rec' : ''}`} onClick={() => choose(c)} disabled={busy || c.disabled} data-testid={c.testid}>
      <span className="dc-answer-icon" aria-hidden="true">{kind === 'yes' ? <IconCheck size={16} /> : <IconX size={16} />}</span>
      <strong>{c.label ?? t(kind === 'yes' ? 'genui.decision.yes' : 'genui.decision.no')}</strong>
      {c.recommended && <span className="dc-rec">{t('tools.genui.recommended')}</span>}
      <span className="dc-key" aria-hidden="true">{key}</span>
    </button>
  );

  return (
    <div ref={ref} tabIndex={0} role="group" onKeyDown={onKey} aria-busy={busy} aria-label={p.question}
      className={`dc ${p.compact ? 'compact' : ''} ${busy ? 'sent' : ''} ${p.className ?? ''}`} data-testid={p.testBase} data-decision="" {...p.rootProps}>
      <div className="dc-head">{p.head}</div>
      <h2 className="dc-q" data-testid={`${p.testBase}-q`}>{p.question}</h2>
      {p.children && <div className="dc-evidence" data-testid={`${p.testBase}-evidence`}>{p.children}</div>}
      {(p.ifYes || p.ifNo) && (
        <dl className="dc-effects" data-testid={`${p.testBase}-effects`}>
          {p.ifYes && <div className="dc-effect yes"><dt><IconCheck size={12} />{t('genui.decision.ifYes')}</dt><dd>{p.ifYes}</dd></div>}
          {p.ifNo && <div className="dc-effect no"><dt><IconX size={12} />{t('genui.decision.ifNo')}</dt><dd>{p.ifNo}</dd></div>}
        </dl>
      )}
      <div className="dc-answers">
        {answer(p.yes, 'yes', t('genui.decision.yesKey'))}
        {answer(p.no, 'no', t('genui.decision.noKey'))}
      </div>
      {writing && p.write ? (
        <div className="dc-write" data-testid={`${p.testBase}-other-box`}>
          <textarea ref={box} className="dc-write-input" autoFocus rows={p.compact ? 2 : 3} maxLength={2000} value={text} disabled={busy}
            placeholder={t('genui.decision.write')} aria-label={t('genui.decision.write')} data-testid={p.write.testids?.input ?? `${p.testBase}-other-input`}
            onChange={e => draft(e.target.value)}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) send(); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
            }} />
          <div className="dc-write-foot">
            {p.write.hint && <span className="dc-hint">{p.write.hint}</span>}
            <span className="sp" />
            <button type="button" className="btn btn-ghost btn-s" onClick={close} disabled={busy} data-testid={`${p.testBase}-other-cancel`}>{t('genui.decision.cancel')}</button>
            <button type="button" className="btn btn-primary btn-s" onClick={send} disabled={busy || !text.trim() || p.write.disabled} data-testid={p.write.testids?.send ?? `${p.testBase}-other-send`}>{t('genui.decision.send')} <Kbd>{t('genui.request.enter')}</Kbd></button>
          </div>
        </div>
      ) : (
        <div className="dc-more">
          {p.write && (
            <button ref={writeBtn} type="button" className="dc-write-open" onClick={() => setWriting(true)} disabled={busy || p.write.disabled} data-testid={p.write.testids?.open ?? `${p.testBase}-other`}>
              <IconEdit size={13} /><span>{t('genui.decision.write')}</span><span className="dc-key" aria-hidden="true">T</span>
            </button>
          )}
          {p.skip && (
            <button type="button" className="dc-skip" onClick={() => { if (!busy) p.skip!.onChoose(); }} disabled={busy} data-tip={p.skip.hint} title={p.skip.hint} data-testid={p.skip.testid ?? `${p.testBase}-skip`}>
              {t('genui.decision.skip')}
            </button>
          )}
          {p.onLater && p.laterButton !== false && (
            <button type="button" className="dc-later" onClick={p.onLater} disabled={busy} data-testid={`${p.testBase}-later`}>
              {t('genui.request.later')} <Kbd>Esc</Kbd>
            </button>
          )}
        </div>
      )}
      {p.footer}
    </div>
  );
});

/** A chat's brief (show_ui brief): what it did, then its evidence (screenshots, checks, files). */
export function BriefEvidence({ brief, testBase, onFile, size = 'l' }: { brief: UiBrief; testBase: string; onFile?: (path: string) => void; size?: 'l' | 'm' }) {
  return (
    <div className="dc-brief" data-testid={`${testBase}-brief`}>
      <div className="dc-brief-k">{t('genui.decision.done')}</div>
      <ul className="dc-done">{brief.done.map((d, i) => <li key={i}><IconCheck size={13} /><span>{d}</span></li>)}</ul>
      {!!brief.checks?.length && (
        <div className="dc-checks" data-testid={`${testBase}-checks`}>
          {brief.checks.map((c, i) => (
            <span key={i} className={`dc-check gu-${c.status}`} title={c.detail}>
              <span aria-hidden="true">{({ ok: '✓', fail: '×', blocked: '⊘', running: '↻', todo: '○', info: 'i', warn: '!' })[c.status]}</span>{c.label}{c.detail && <em>{c.detail}</em>}
            </span>
          ))}
        </div>
      )}
      {!!brief.images?.length && <AskImages images={brief.images.map(i => ({ path: i.path, caption: i.caption ?? i.path.split(/[\\/]/).pop() ?? '' }))} testBase={testBase} size={size} />}
      {!!brief.files?.length && (
        <ul className="dc-files" data-testid={`${testBase}-files`}>
          {brief.files.map((f, i) => (
            <li key={i}>
              {onFile ? <button type="button" className="dc-file mono" onClick={() => onFile(f.href ?? f.path)} title={f.href ?? f.path}>{f.path}</button> : <span className="dc-file mono">{f.path}</span>}
              {(f.added !== undefined || f.removed !== undefined) && <span className="gu-diff-n"><span className="add">+{f.added ?? 0}</span> <span className="del">−{f.removed ?? 0}</span></span>}
              {f.why && <span className="dc-why">{f.why}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
