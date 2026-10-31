// The one engine/model picker (owner, 2026-10-31: one selector, with search and the catalog, for the Orchestrator, the
// Agenti page and the Grindhouse strip, the four engines in it): a dialog over its anchor with a search, the engines as
// groups (lib/model-catalog.ts: the current engine first, its state and why it cannot take a model, where the list comes
// from), each model with its context window and effort levels, the effort for the chosen row (what a run really gets
// when the model lacks the level asked) and the actions of its scope, each saying what it changes:
// - a chat (the Orchestrator's and Flash's chip, a strip's ⋯ menu): «Solo questa chat» changes that chat only (its own
//   engine: a chat never moves engine); on the Orchestrator «Predefinito dell'Orchestrator» saves engine and model on its
//   card instead (the next Orchestrator on that engine starts with it, catalog.ts resolve); Flash follows its card at
//   every question (ChatManager.flashFollow), so its only action is «Predefinito di Flash»;
// - a role (the back of an Agenti card): «Salva nel ruolo», the default of the role's new chats.
// The default row says which default it is: «Predefinito della CLI» on a chat (the engine picks), «Modello del livello»
// on a role (resolved at launch from the tier). Loading, error (with «Riprova»), no engine and no match are always said.
// Used by ModelChip, ChatMenu (through ChatTile) and AgentCardModel. Styles: styles/model-picker.css.
import { useEffect, useMemo, useState, type KeyboardEvent, type RefObject } from 'react';
import type { ChatSummary, Effort } from '@shared/contract';
import type { AgentProfile } from '@shared/agents';
import { FLASH_ID, ORCHESTRATOR_ROLE_ID } from '@shared/roles';
import { EFFORTS } from '../lib/format';
import { engineName } from '../lib/engines';
import { agentDraftOf } from '../lib/agent-drafts';
import { catalogGroups, findRow, kTokens, realEffort, rowEfforts, searchGroups, type CatalogRow, type EngineGroup } from '../lib/model-catalog';
import { refreshAgents, saveAgent, useAgents } from '../store/agents';
import { setChat } from '../store/store';
import { HarnessMark } from './Icons';
import { Popover } from './ui';
import { t } from '../i18n';
import '../styles/model-picker.css';

/** What the picker changes: one chat (with, on the Orchestrator and Flash, their card as the lasting default), or a role. */
export type PickerScope =
  | { kind: 'chat'; chat: ChatSummary; card?: AgentProfile | null }
  | { kind: 'role'; profile: AgentProfile };

interface Pick { engine: ChatSummary['harness']; id: string | null; effort: Effort | null }

/** Where the picker starts: what the scope runs on now (Flash: its card, which it follows). */
export function startOf(scope: PickerScope): Pick {
  if (scope.kind === 'role') return { engine: scope.profile.engine, id: scope.profile.model, effort: scope.profile.effort ?? null };
  if (scope.card?.id === FLASH_ID) return { engine: scope.card.engine, id: scope.card.model, effort: scope.card.effort ?? null };
  return { engine: scope.chat.harness, id: scope.chat.model || null, effort: scope.chat.effort ?? null };
}

export function ModelPicker({ scope, anchor, open, onClose, testid }: {
  scope: PickerScope; anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void; testid: string;
}) {
  const { catalog, error: loadError } = useAgents();
  const [query, setQuery] = useState('');
  const [pick, setPick] = useState<Pick>(() => startOf(scope));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // every opening starts from what runs now, with an empty search
  useEffect(() => { if (open) { setPick(startOf(scope)); setQuery(''); setError(null); } }, [open]);

  const card = scope.kind === 'chat' ? scope.card ?? null : null;
  const flash = card?.id === FLASH_ID;
  const orchestrator = card?.id === ORCHESTRATOR_ROLE_ID;
  // a chat can be changed by itself everywhere but on Flash (it follows its card)
  const chatApply = scope.kind === 'chat' && !flash;
  // only a card may move engine: a strip without one keeps its engine
  const engineFree = scope.kind === 'role' || !!card;
  const defaultName = scope.kind === 'role' || flash
    ? t('mp.tierDefault', { tier: t(`roles.tier.${(scope.kind === 'role' ? scope.profile : card!).tier}`) })
    : t('mp.cliDefault');
  const current = startOf(scope);
  const groups = useMemo(() => catalogGroups(catalog?.models ?? [], { engine: current.engine, model: current.id }, defaultName),
    [catalog, current.engine, current.id, defaultName]);
  const shown = useMemo(() => searchGroups(groups, query), [groups, query]);
  const group = groups.find(g => g.engine === pick.engine);
  const row = findRow(groups, pick.engine, pick.id);
  const chatEngine = scope.kind === 'chat' ? scope.chat.harness : null;
  const choose = (g: EngineGroup, r: CatalogRow) => setPick(p => {
    // a level the new model lacks stays asked (the note says what runs); another engine without effort drops it
    return { engine: g.engine, id: r.id, effort: g.effort ? p.effort : null };
  });
  // a chat's effort cannot go back to nothing (chat:set): «Predefinito» only where it can mean something
  // Flash too: its open chat keeps an effort it has, a card without one does not reset it (flashFollow)
  const effortDefault = scope.kind === 'role' || !(scope.kind === 'chat' && scope.chat.effort);
  const real = realEffort(pick.effort, row);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); onClose(); anchor.current?.focus(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const applyChat = () => run(async () => {
    if (scope.kind !== 'chat') return;
    await setChat(scope.chat.id, { model: pick.id ?? '', ...(pick.effort ? { effort: pick.effort } : {}) });
  });
  const saveCard = (p: AgentProfile, withEffort: boolean) => run(async () => {
    const { effort: _old, ...base } = agentDraftOf(p); void _old;
    const effort = withEffort ? pick.effort : p.effort ?? null;
    await saveAgent({ ...base, engine: pick.engine, model: pick.id, ...(effort && group?.effort ? { effort } : {}) }, p.id);
    // Flash on its engine takes the effort at once (its model follows the card at the next question)
    if (flash && scope.kind === 'chat' && pick.engine === scope.chat.harness && pick.effort) await setChat(scope.chat.id, { effort: pick.effort });
  });

  // ↑/↓ move between the rows (the radios), like a list; Tab leaves the list
  const arrows = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])')];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  // the list's one Tab stop: the picked row when shown and enabled, else the first enabled one (a search can hide the pick)
  const rowBlocked = (g: EngineGroup, r: CatalogRow) =>
    g.block === 'off' || g.block === 'untrusted' || (g.block === 'not-selectable' && r.id !== null) || (!engineFree && g.engine !== chatEngine);
  const enabled = shown.flatMap(g => g.rows.filter(r => !rowBlocked(g, r)).map(r => ({ engine: g.engine, id: r.id })));
  const stop = enabled.find(r => r.engine === pick.engine && r.id === pick.id) ?? enabled[0];
  // ↓ from the search goes into the list
  const intoList = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowDown') return;
    const first = e.currentTarget.parentElement?.querySelector<HTMLElement>('.mp-list [role="radio"][tabindex="0"]');
    if (first) { e.preventDefault(); first.focus(); }
  };

  const title = scope.kind === 'role' ? t('mp.scope.role', { name: scope.profile.name })
    : flash ? t('mp.scope.flash') : t('mp.scope.chat', { title: scope.chat.title });
  return <Popover anchor={anchor} open={open} onClose={onClose} testid={`${testid}-pop`} width={380} kind="dialog" label={t('studio.model')}>
    <div className="mp" data-testid={`${testid}-picker`}>
      <p className="mp-scope" data-testid={`${testid}-scope`}>{title}</p>
      <input className="mp-search" type="search" value={query} placeholder={t('mp.search')} aria-label={t('mp.search')}
        onChange={e => setQuery(e.target.value)} onKeyDown={intoList} data-testid={`${testid}-search`} />
      {loadError && <div className="mp-state mp-error" role="alert" data-testid={`${testid}-load-error`}>
        <span>{t('mp.error', { error: loadError })}</span>
        <button type="button" className="mp-retry" onClick={() => void refreshAgents()} data-testid={`${testid}-retry`}>{t('mp.retry')}</button>
      </div>}
      {!catalog && !loadError && <p className="mp-state" role="status" data-testid={`${testid}-loading`}>{t('mp.loading')}</p>}
      {catalog && !groups.length && <p className="mp-state" data-testid={`${testid}-empty`}>{t('mp.noEngines')}</p>}
      {catalog && !!groups.length && !shown.length && <p className="mp-state" data-testid={`${testid}-nomatch`}>{t('mp.noMatch', { q: query.trim() })}</p>}
      {!!shown.length && <div className="mp-list" role="radiogroup" aria-label={t('studio.model')} onKeyDown={arrows}>
        {shown.map(g => <section key={g.engine} className="mp-group" data-testid={`${testid}-group-${g.engine}`}>
          <header className="mp-group-head">
            <HarnessMark harness={g.engine} size={13} /><b>{g.label}</b>
            <span className="mp-tag">{t(`mp.source.${g.source}`)}</span>
            {g.block && <span className="mp-tag mp-warn" title={g.reason ?? undefined} data-testid={`${testid}-block-${g.engine}`}>
              {t(g.block === 'off' ? 'mp.block.off' : g.block === 'untrusted' ? 'mp.block.untrusted' : 'mp.block.notSelectable')}</span>}
          </header>
          {!engineFree && g.engine !== chatEngine && <p className="mp-note">{t('mp.otherEngine', { engine: engineName(chatEngine!) })}</p>}
          {g.block === 'not-selectable' && g.reason && <p className="mp-note">{g.reason}</p>}
          {g.rows.map(r => {
            const on = pick.engine === g.engine && pick.id === r.id;
            const meta = r.id === null ? (scope.kind === 'role' || flash ? t('mp.tierDefaultMeta') : t('mp.cliDefaultMeta'))
              : [r.contextWindow ? t('mp.context', { size: kTokens(r.contextWindow) }) : '',
                 r.efforts ? (r.efforts.length ? t('mp.efforts', { list: r.efforts.join(' · ') }) : t('mp.noEffort')) : '',
                 r.missing ? t('mp.missing') : ''].filter(Boolean).join(' · ');
            return <button key={r.id ?? ''} type="button" role="radio" aria-checked={on} tabIndex={stop && stop.engine === g.engine && stop.id === r.id ? 0 : -1}
              className={`mp-row${on ? ' on' : ''}${r.missing ? ' missing' : ''}`} disabled={busy || rowBlocked(g, r)}
              onClick={() => choose(g, r)} data-testid={`${testid}-row-${g.engine}-${r.id ?? 'default'}`}>
              <span className="mp-dot" aria-hidden="true" /><span className="mp-name">{r.name}</span>
              {meta && <small className="mp-meta">{meta}</small>}
            </button>;
          })}
          {g.engine === pick.engine && !g.models.length && g.block === null && <p className="mp-note" data-testid={`${testid}-group-empty-${g.engine}`}>{t('mp.groupEmpty', { engine: g.label })}</p>}
        </section>)}
      </div>}
      {/* the Orchestrator's card ignores an effort (catalog.ts resolve): there it is this chat's only, on its engine */}
      {group?.effort && (!orchestrator || pick.engine === chatEngine) && <div className="mp-effort" role="group" aria-label={t('mp.effort')}>
        <span className="mp-effort-label">{t('mp.effort')}</span>
        {effortDefault && <button type="button" className={`mp-chip${pick.effort === null ? ' on' : ''}`} aria-pressed={pick.effort === null}
          disabled={busy} onClick={() => setPick(p => ({ ...p, effort: null }))} data-testid={`${testid}-effort-default`}>
          {row?.defaultEffort ? t('agentCard.effortDefaultIs', { effort: row.defaultEffort }) : t('agentCard.effortDefault')}</button>}
        {rowEfforts(row, EFFORTS).map(e => <button key={e} type="button" className={`mp-chip${pick.effort === e ? ' on' : ''}`} aria-pressed={pick.effort === e}
          disabled={busy} onClick={() => setPick(p => ({ ...p, effort: e }))} data-testid={`${testid}-effort-${e}`}>{e}</button>)}
        {pick.effort && real !== pick.effort && <small className="mp-note" data-testid={`${testid}-effort-real`}>
          {real ? t('agentCard.effortClamped', { asked: pick.effort, real }) : t('agentCard.effortNone')}</small>}
      </div>}
      {error && <p className="mp-state mp-error" role="alert" data-testid={`${testid}-error`}>{error}</p>}
      <div className="mp-actions">
        {chatApply && <button type="button" className="mp-btn primary" disabled={busy || !catalog || pick.engine !== chatEngine}
          title={pick.engine !== chatEngine ? t('mp.otherEngine', { engine: engineName(chatEngine!) }) : undefined}
          onClick={() => void applyChat()} data-testid={`${testid}-apply-chat`}>{t('mp.apply.chat')}</button>}
        {card && <button type="button" className={`mp-btn${flash ? ' primary' : ''}`} disabled={busy || !catalog || !group || group.block === 'off' || group.block === 'untrusted'}
          title={t(orchestrator ? 'mp.apply.orchestratorTip' : 'mp.apply.flashTip')}
          onClick={() => void saveCard(card, !orchestrator)} data-testid={`${testid}-apply-default`}>
          {t(orchestrator ? 'mp.apply.orchestrator' : 'mp.apply.flash')}</button>}
        {scope.kind === 'role' && <button type="button" className="mp-btn primary" disabled={busy || !catalog || !group || group.block === 'off' || group.block === 'untrusted'}
          onClick={() => void saveCard(scope.profile, true)} data-testid={`${testid}-apply-role`}>{t('mp.apply.role')}</button>}
      </div>
    </div>
  </Popover>;
}
