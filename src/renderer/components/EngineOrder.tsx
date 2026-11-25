// The one order of the engines (ADR 0360): Impostazioni → Motori «Ordine dei motori» (EngineOrderSettings: the order for
// every role, a threshold per engine, the roles with an exception, the changes still to apply) and the exception of one
// role on its page (RoleEngineOrder, AgentStudio.tsx). Up and down buttons, so the keyboard does what the mouse does; each
// change saves at once (settings:set engineOrder / engineThresholds, agents:save engineOrder). The order changes no
// model, effort or permission: it says which engine of a level is tried first. Styles: styles/settings.css (.eo-*).
import { useState } from 'react';
import type { Harness } from '@shared/contract';
import type { AgentProfile } from '@shared/agents';
import { THRESHOLD } from '@shared/engine-order';
import { go } from '../actions';
import { agentDraftOf } from '../lib/agent-drafts';
import { errText } from '../lib/ipc-error';
import { saveAgent, useAgents } from '../store/agents';
import { setSetting, useApp } from '../store/store';
import { toast } from '../store/ui';
import { HarnessMark } from './Icons';
import { Select } from './Select';
import { t } from '../i18n';

/** main/appctl/pending-config.ts CONFIG_TOOL: a change held for the user's answer */
const CONFIG_TOOL = 'app_config_change';
const STEPS = [50, 60, 70, 75, 80, 85, 90, 95].filter(n => n >= THRESHOLD.min && n <= THRESHOLD.max);

function OrderList({ order, labels, busy, onChange, extra }: { order: readonly Harness[]; labels: (id: Harness) => string; busy: boolean; onChange: (next: Harness[]) => void; extra?: (id: Harness) => React.ReactNode }) {
  const move = (i: number, by: -1 | 1) => { const next = [...order]; [next[i], next[i + by]] = [next[i + by]!, next[i]!]; onChange(next); };
  return <ol className="eo-list" data-testid="engine-order">
    {order.map((id, i) => <li key={id} className="eo-row" data-testid={`engine-order-${id}`}>
      <span className="eo-n">{i + 1}</span><HarnessMark harness={id} size={18} /><b className="eo-name">{labels(id)}</b>
      {extra?.(id)}
      <span className="eo-move">
        <button type="button" className="btn btn-ghost btn-s" disabled={busy || i === 0} aria-label={t('engineOrder.up', { engine: labels(id) })} onClick={() => move(i, -1)} data-testid={`engine-order-${id}-up`}>↑</button>
        <button type="button" className="btn btn-ghost btn-s" disabled={busy || i === order.length - 1} aria-label={t('engineOrder.down', { engine: labels(id) })} onClick={() => move(i, 1)} data-testid={`engine-order-${id}-down`}>↓</button>
      </span>
    </li>)}
  </ol>;
}

/** The engines a role can use, in the saved order first, then the others as the app lists them. */
const complete = (order: readonly Harness[], all: readonly Harness[]): Harness[] => [...order.filter(id => all.includes(id)), ...all.filter(id => !order.includes(id))];

export function EngineOrderSettings() {
  const { catalog } = useAgents();
  const order = useApp(s => s.settings?.engineOrder), thresholds = useApp(s => s.settings?.engineThresholds);
  const held = useApp(s => s.pending.filter(p => p.tool === CONFIG_TOOL).length);
  const engines = (catalog?.models ?? []).filter(e => e.enabled || order?.includes(e.engine));
  const label = (id: Harness) => catalog?.models.find(e => e.engine === id)?.label ?? id;
  const on = !!order?.length, rows = complete(order ?? [], engines.map(e => e.engine));
  const exceptions = (catalog?.profiles ?? []).filter(p => p.engineOrder?.length);
  return <article className="st-tool eo" data-testid="st-engine-order">
    <div className="st-row"><div className="st-text"><b className="st-title">{t('engineOrder.title')}</b><p className="st-desc">{t(on ? 'engineOrder.hint' : 'engineOrder.off')}</p></div>
      <button type="button" className="btn btn-ghost btn-m" disabled={!rows.length} onClick={() => void setSetting({ engineOrder: on ? [] : rows })} data-testid="st-engine-order-toggle">{t(on ? 'engineOrder.clear' : 'engineOrder.use')}</button></div>
    {held > 0 && <p className="st-desc st-warn" role="status" data-testid="st-engine-order-held">{t('engineOrder.held', { n: held })}</p>}
    {on && <OrderList order={rows} labels={label} busy={false} onChange={next => void setSetting({ engineOrder: next })} extra={id => <label className="eo-threshold">
      <span>{t('engineOrder.threshold')}</span>
      <Select value={thresholds?.[id] ?? ''} aria-label={t('engineOrder.thresholdOf', { engine: label(id) })} data-testid={`engine-threshold-${id}`}
        onChange={e => { const n = Number(e.target.value), { [id]: _was, ...rest } = thresholds ?? {}; void setSetting({ engineThresholds: n ? { ...rest, [id]: n } : rest }); }}>
        <option value="">{t('engineOrder.noThreshold')}</option>
        {[...new Set([...STEPS, ...(thresholds?.[id] ? [thresholds[id]!] : [])])].sort((a, b) => a - b).map(n => <option key={n} value={n}>{n}%</option>)}
      </Select></label>} />}
    {on && <p className="st-desc eo-foot">{t('engineOrder.orchestrator')}</p>}
    {exceptions.map(p => <p key={p.id} className="st-desc eo-foot" data-testid={`engine-exception-${p.id}`}>
      <button type="button" className="link-btn" onClick={() => go({ page: 'agenti', arg: p.id })}>{t('engineOrder.exception', { role: p.name, order: p.engineOrder!.map(label).join(', ') })}</button></p>)}
  </article>;
}

/** A role's own order on its page: none = it follows everybody's. */
export function RoleEngineOrder({ profile }: { profile: AgentProfile }) {
  const { catalog } = useAgents();
  const all = useApp(s => s.settings?.engineOrder) ?? [];
  const [busy, setBusy] = useState(false);
  const label = (id: Harness) => catalog?.models.find(e => e.engine === id)?.label ?? id;
  const own = profile.engineOrder ?? [], engines = (catalog?.models ?? []).filter(e => e.enabled).map(e => e.engine);
  const save = async (engineOrder: Harness[]) => {
    setBusy(true);
    try { await saveAgent({ ...agentDraftOf(profile), engineOrder }, profile.id); } catch (e) { toast(errText(e), 'err'); } finally { setBusy(false); }
  };
  if (!all.length && !own.length) return null;
  return <section className="ad-card" data-testid="role-engine-order">
    <header className="ad-card-head"><h3>{t('engineOrder.role')}</h3>
      <button type="button" className="btn btn-ghost btn-s" disabled={busy} onClick={() => void save(own.length ? [] : complete(all, engines))} data-testid="role-engine-order-toggle">{t(own.length ? 'engineOrder.roleClear' : 'engineOrder.roleOwn')}</button></header>
    <p className="ad-hint">{own.length ? t('engineOrder.roleOwnHint') : t('engineOrder.roleAll', { order: all.map(label).join(', ') })}</p>
    {own.length > 0 && <OrderList order={own} labels={label} busy={busy} onChange={next => void save(next)} />}
  </section>;
}
