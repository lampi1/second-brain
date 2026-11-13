// The right half of the first-run setup (FirstInterview.tsx, ADR 0279): the stage. In the first two moments it is a
// fixed PREVIEW, marked as such: one request, the Orchestrator's answer and the team with one role at work, so a person
// who has never seen the app knows what they are setting up (it greets them by the name they are typing). In the
// third moment the same frame is the REAL Orchestrator chat (store items, `send`): the first request is typed here,
// inside the setup, and the answer streams in place. The team row under its head is real too: a role lights up while
// a chat the Orchestrator delegated to it works (the chat's delegation role, else its catalog agent). A question or a
// permission the first request raises is not answered here: one line offers to enter the app, where the Orchestrator
// shows it (QuestionsWindow.tsx). Nothing here creates a chat or spends tokens by itself.
import { useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent, Ref } from 'react';
import type { ChatSummary } from '@shared/contract';
import { ORCHESTRATOR_ROLE_ID, WORK_ROLE_IDS, roleName } from '@shared/roles';
import type { WorkRoleId } from '@shared/roles';
import { t } from '../i18n';
import { teamStates, type RoleState } from '../lib/setup-wizard';
import { isBusy, sameList } from '../store/state';
import { send, stop, useApp } from '../store/store';
import { AgentAvatar } from './AgentAvatar';
import { ItemList, Typing, turnActivity } from './ChatItems';
import { IconSend, IconStop } from './Icons';
import { StatePill } from './ui';

function Team({ states, preview }: { states: Record<WorkRoleId, RoleState>; preview?: boolean }) {
  return <ul className="sw-team" aria-label={t('setup.stage.team')} data-testid="setup-team">{WORK_ROLE_IDS.map(r => {
    const state = states[r];
    return <li key={r} className={`sw-role is-${state}`} data-role={r} data-state={state} aria-hidden={preview || undefined}>
      <AgentAvatar avatar={{ kind: 'character', value: r }} name={roleName(r)} size={34}/>
      <span><b>{roleName(r)}</b><small>{t(`setup.stage.role.${state}`)}</small></span>
    </li>;
  })}</ul>;
}

/** the fixed preview: never a real chat, never tokens */
export function StagePreview({ name }: { name: string }) {
  const states = useMemo(() => ({ ...teamStates([]), scout: 'working' as const }), []);
  return <section className="sw-stage is-preview" aria-label={t('setup.stage.previewLabel')} data-testid="setup-preview">
    <header className="sw-stage-head">
      <AgentAvatar avatar={{ kind: 'character', value: ORCHESTRATOR_ROLE_ID }} name={roleName(ORCHESTRATOR_ROLE_ID)} size={30}/>
      <b>{roleName(ORCHESTRATOR_ROLE_ID)}</b>
      <span className="sw-stage-tag">{t('setup.stage.previewTag')}</span>
    </header>
    <Team states={states} preview/>
    <div className="sw-demo" aria-hidden="true">
      <p className="sw-demo-user">{t('setup.stage.demoAsk')}</p>
      <div className="sw-demo-orch">
        <AgentAvatar avatar={{ kind: 'character', value: ORCHESTRATOR_ROLE_ID }} name={roleName(ORCHESTRATOR_ROLE_ID)} size={22}/>
        <p data-testid="setup-preview-reply">{name ? t('setup.stage.demoReplyNamed', { name }) : t('setup.stage.demoReply')}</p>
      </div>
      <div className="sw-demo-work"><AgentAvatar avatar={{ kind: 'character', value: 'scout' }} name={roleName('scout')} size={22}/><span><b>{roleName('scout')}</b>{t('setup.stage.demoWork')}</span><i/></div>
    </div>
    <div className="sw-demo-input" aria-hidden="true">{t('setup.first.placeholder')}</div>
    <p className="sw-stage-caption">{t('setup.stage.caption')}</p>
  </section>;
}

/** whether a chat was delegated, directly or through other chats, by `rootId` (a parent chain is short; 8 bounds a loop) */
function descendsFrom(chats: Readonly<Record<string, ChatSummary | undefined>>, chat: ChatSummary, rootId: string): boolean {
  let at = chat.parentId;
  for (let i = 0; at && i < 8; i++) { if (at === rootId) return true; at = chats[at]?.parentId; }
  return false;
}

/** the real Orchestrator chat, inside the setup */
export function StageLive({ chatId, text, onText: setText, input, onAnswer }: { chatId: string; text: string; onText: (text: string) => void; input: Ref<HTMLTextAreaElement>; onAnswer: () => void }) {
  const chat = useApp(s => s.chats[chatId]);
  const items = useApp(s => s.items[chatId]);
  // the open chats this Orchestrator delegated (a setup repeated later shows no role «done» from old, closed work)
  const all = useApp(s => Object.values(s.chats).filter((c): c is ChatSummary => !!c && !c.closedAt && descendsFrom(s.chats, c, chatId)), sameList);
  const asks = useApp(s => s.pending.length);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const states = useMemo(() => teamStates(all), [all]);
  useEffect(() => { box.current?.focus(); }, [!!chat]);
  if (!chat) return <section className="sw-stage" data-testid="setup-live"><p className="sw-stage-wait" role="status">{t('setup.first.starting')}</p></section>;
  const busy = isBusy(chat);
  const submit = () => { if (send(chat.id, text) !== 'empty') setText(''); };
  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } };
  const bind = (el: HTMLTextAreaElement | null) => { box.current = el; if (typeof input === 'function') input(el); else if (input) input.current = el; };
  return <section className="sw-stage is-live" aria-label={t('setup.stage.liveLabel')} data-testid="setup-live" data-chat-id={chat.id}>
    <header className="sw-stage-head">
      <AgentAvatar avatar={chat.agent?.avatar ?? { kind: 'character', value: ORCHESTRATOR_ROLE_ID }} name={chat.agent?.name || chat.title} size={30}/>
      <b>{chat.agent?.name || chat.title}</b>
      <StatePill chat={chat} testid="setup-live-state"/>
    </header>
    <Team states={states}/>
    <ItemList chatId={chat.id} items={items ?? []} empty={t('setup.first.empty')} footer={busy ? <Typing what={turnActivity(items)} testid="setup-live-typing" items={items}/> : null}/>
    {asks > 0 && <p className="sw-stage-ask" role="status" data-testid="setup-live-ask"><span>{t('setup.first.ask', { n: asks })}</span><button type="button" className="btn btn-m btn-primary" onClick={onAnswer}>{t('setup.first.answer')}</button></p>}
    <div className="sw-stage-input">
      <textarea ref={bind} rows={2} value={text} onChange={e => setText(e.target.value)} onKeyDown={key} placeholder={t('setup.first.placeholder')} aria-label={t('setup.first.inputAria')} data-testid="setup-first-input"/>
      {busy && !text.trim()
        ? <button type="button" className="sw-send is-stop" aria-label={t('setup.first.stop')} onClick={() => void stop(chat.id)} data-testid="setup-first-stop"><IconStop size={14}/></button>
        : <button type="button" className="sw-send" aria-label={t('setup.first.send')} disabled={!text.trim()} onClick={submit} data-testid="setup-first-send"><IconSend size={15}/></button>}
    </div>
  </section>;
}
