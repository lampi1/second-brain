// «Flash» (was «Lampo», ADR 0105, 0107; owner, 2026-10-20: «forse manca una fast chat: la velocità di risposta non è la
// stessa di Claude Code o Codex»): the quick lane in the Orchestrator's column, beside it. One always-on chat on Flash's
// card (its engine and model, the chip above to change it) with read-only tools (main: ChatManager LAMPO_POLICY, plan
// mode): it answers questions, explanations and quick reads in seconds, sees the Orchestrator's chat like a "btw"
// (ADR 0106), changes nothing and starts no work. «Fanne un lavoro» drafts the last question and its answer into the Orchestrator's
// input (never sent by itself): work still starts only from the Orchestrator (ADR 0083). Used by OrchestratorOverlay.tsx.
import { useEffect, useRef, useState } from 'react';
import { isBusy } from '../store/state';
import { createChat, stop, useApp } from '../store/store';
import { t } from '../i18n';
import { brainBridge } from '../actions';
import { ItemList, turnActivity, Typing } from './ChatItems';
import { ChatInput, type ChatInputHandle } from './ChatInput';
import { IconButton, StatePill } from './ui';
import { AgentAvatar } from './AgentAvatar';
import { ModelChip } from './ModelChip';
import { FLASH_ID } from '@shared/roles';
import { IconStop } from './Icons';
import { lastExchange } from '../lib/lampo';

/** Lampo's tile, or the button that opens it (on the Orchestrator's engine, the user's fast model). */
export function LampoTile({ onWork }: { onWork: () => void }) {
  const lampo = useApp(s => Object.values(s.chats).find(c => c?.quick && !c.closedAt));
  const items = useApp(s => (lampo ? s.items[lampo.id] : undefined));
  const orchestrator = useApp(s => Object.values(s.chats).find(c => c?.isOrchestrator && !c.closedAt));
  const info = useApp(s => s.info);
  const input = useRef<ChatInputHandle>(null);
  const [opening, setOpening] = useState(false);
  useEffect(() => { if (lampo) input.current?.focus(); }, [lampo?.id]);

  const open = async () => {
    const harness = orchestrator?.harness ?? 'claude', cwd = info?.brainRoot ?? orchestrator?.cwd;
    if (!cwd || opening) return;
    setOpening(true);
    // engine and model come from Flash's card (main: AgentCatalog.resolve); the harness is only a fallback
    try { await createChat({ harness, cwd, quick: true }); } finally { setOpening(false); }
  };

  if (!lampo) {
    return <section className="tile orchestrator-tile lampo-tile empty" role="region" aria-label={t('lampo.title')} data-testid="tile-lampo">
      <div className="empty-state orchestrator-setup">
        <span className="orchestrator-column-mark" aria-hidden="true">⚡</span>
        <h2>{t('lampo.title')}</h2>
        <p>{t('lampo.intro')}</p>
        <button type="button" className="btn btn-primary btn-m" disabled={opening || !(info?.brainRoot ?? orchestrator?.cwd)} onClick={() => void open()} data-testid="lampo-open">{t('lampo.start')}</button>
      </div>
    </section>;
  }

  const busy = isBusy(lampo), last = lastExchange(items);
  const toWork = () => {
    if (!last) return;
    if (brainBridge.draftToOrchestrator(t('lampo.draft', last), () => {})) onWork();
  };
  return <section className="tile orchestrator-tile lampo-tile" role="region" aria-label={t('lampo.title')} data-testid="tile-lampo" data-chat-id={lampo.id}>
    <header className="tile-head">
      <div className="th-row">
        <AgentAvatar avatar={{ kind: 'character', value: FLASH_ID }} name={t('lampo.title')} size={24} />
        <h3 className="th-title">{t('lampo.title')}</h3>
        <StatePill chat={lampo} testid="lampo-state" />
        <span className="sp" />
        <button type="button" className="btn btn-ghost btn-s" disabled={!last || busy} title={t('lampo.toWorkTip')} onClick={toWork} data-testid="lampo-to-work">{t('lampo.toWork')}</button>
        {busy && <IconButton label={t('dialogs.orchestrator.stopLabel')} tone="danger" onClick={() => void stop(lampo.id)} testid="lampo-stop"><IconStop size={14} /></IconButton>}
      </div>
      <div className="chat-topic-row"><ModelChip chat={lampo} profileId={FLASH_ID} testid="lampo-model" /><span className="chat-topic">{t('lampo.hint')}</span></div>
    </header>
    <ItemList chatId={lampo.id} items={items ?? []} empty={t('lampo.empty')} footer={busy ? <Typing what={turnActivity(items)} testid="typing-lampo" /> : null} />
    <ChatInput ref={input} chat={lampo} testid="lampo-input" />
  </section>;
}
