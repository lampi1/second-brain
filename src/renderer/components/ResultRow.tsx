// A result another agent sent to the Orchestrator, as ONE thin row like the «Evento app» rows (ADR 0367, owner
// 2026-11-27: «discreti, come la UI dei messaggi delle altre chat, non così grassi»): the agent's head (18 px), the chat's
// title, its outcome in one line (the first sentence, ellipsis) and › to unfold the whole result here. A result the user
// was waiting for reads «✓ Finito quello che aspettavi» instead of the head. The whole result, its open questions and
// criteria, and «Apri la chat» are one click away. Replaces the fat «risultato pronto» card (#351). Used by
// ChatItems.tsx (system items with code resultReady); its body (the markdown) is given by ChatItems.
import { useState, type ReactNode } from 'react';
import type { ChatItem } from '@shared/contract';
import { isRoleId, ROLE_DEFAULTS, ROLE_IDS } from '@shared/roles';
import { useApp } from '../store/store';
import { openChatRef } from '../actions';
import { sysText, t } from '../i18n';
import { outcomeLine } from '../lib/orch-lines';
import { AgentAvatar } from './AgentAvatar';
import { IconArrowRight, IconCheck, IconChevronRight } from './Icons';

type Sys = Extract<ChatItem, { kind: 'system' }>;

/** What the row shows of a resultReady item: the source chat, its title, the role, the one-line outcome, the full text. */
export function resultRowOf(item: Sys, source?: { title?: string; agent?: { id?: string; name?: string; avatar?: unknown } }) {
  const p = item.params ?? {};
  const title = source?.title ?? String(p.title ?? p.role ?? 'Chat');
  const role = source?.agent?.name ?? String(p.role ?? '');
  const recorded = String(p.role ?? '').trim().toLowerCase();
  const roleId = isRoleId(source?.agent?.id) ? source!.agent!.id : ROLE_IDS.find(id => id === recorded || ROLE_DEFAULTS[id].name.toLowerCase() === recorded);
  const full = item.result?.output ?? (typeof p.summary === 'string' && p.summary.trim() ? p.summary : '');
  return { title, role, roleId, full, line: outcomeLine(item.result?.summary || full), waited: p.waited === 1 || p.waited === '1' };
}

export function ResultRow({ item, body }: { item: Sys; body: (text: string) => ReactNode }) {
  const sourceId = typeof item.params?.chatId === 'string' ? item.params.chatId : undefined;
  const source = useApp(s => (sourceId ? s.chats[sourceId] : undefined));
  const [open, setOpen] = useState(false);
  const r = resultRowOf(item, source);
  const avatar = source?.agent?.avatar ?? (r.roleId ? { kind: 'character' as const, value: r.roleId } : undefined);
  const full = r.full || sysText(item);
  return (
    <div className={`oc-evt-wrap${open ? ' oc-open' : ''}`} data-testid="result-ready" data-chat-id={sourceId}>
      <button type="button" className={`oc-evt${r.waited ? ' oc-ok' : ''}`} onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid="result-ready-toggle"
        title={r.line || undefined}>
        {r.waited ? <IconCheck size={14} /> : <AgentAvatar avatar={avatar} name={r.role} size={18} />}
        {r.waited ? <b>{t('chat.evt.waitedDone')}</b> : <b className="oc-evt-title" title={r.title}>{r.title}</b>}
        <span className="oc-grow" data-testid="result-ready-line">{r.waited ? `${r.title}${r.line ? `: ${r.line}` : ''}` : r.line}</span>
        <IconChevronRight size={12} className="oc-chev" />
      </button>
      {open && (
        <div className="oc-evt-body" data-testid="canonical-result">
          {body(full)}
          {!!item.result?.questions?.length && <ul>{item.result.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>}
          {!!item.result?.doneWhen.length && <ul className="result-criteria">{item.result.doneWhen.map((c, i) => <li key={i} className={c.met ? 'met' : ''}><span aria-hidden="true">{c.met ? '✓' : '—'}</span><span className="sr-only">{t(c.met ? 'chat.criterionMet' : 'chat.criterionNotMet')}</span> <b>{c.criterion}</b> {c.evidence}</li>)}</ul>}
          {sourceId && <button type="button" className="link-btn oc-evt-go" data-testid="chatref-open" data-chat-id={sourceId} onClick={() => openChatRef(sourceId)}
            aria-label={t('chat.chatref.ariaOpen', { verb: t('chat.resultGoAgent'), name: r.title })}>{t('chat.resultGoAgentTip')} <IconArrowRight size={12} /></button>}
        </div>
      )}
    </div>
  );
}
