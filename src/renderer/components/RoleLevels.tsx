// «Modelli per livello» on a role's page (AgentStudio.tsx; owner, 2026-11-24, ADR 0347): for each level (Minimo, Base,
// Massimo) an ordered list of models, from any engine, as chips: number, engine mark, model, effort, ×. Drag a chip to
// change the order, «+ Aggiungi» picks an engine, a model and an effort. Under each level, what the app would start on
// now and why (agents:levelRoute: the first model whose engine is on and whose plan has room). Each change saves the card
// at once (agents:save with `levels`; main checks the models and keeps the card's own model as the head of Base).
// Styles: styles/agent-studio.css (.rl-*).
import { useEffect, useState, type DragEvent } from 'react';
import type { AgentProfile, AgentModelChoice } from '@shared/agents';
import type { Effort } from '@shared/contract';
import { PRESET_IDS, cardPresets, type PresetId } from '@shared/model-presets';
import { levelsOf, type FullLevels, type LevelModel } from '@shared/model-levels';
import { agentDraftOf } from '../lib/agent-drafts';
import { EFFORTS, effortLabel } from '../lib/format';
import { saveAgent, useAgents } from '../store/agents';
import { sb } from '../sb';
import { HarnessMark } from './Icons';
import { Select } from './Select';
import { t } from '../i18n';

type Route = Record<PresetId, { engine: string; model: string | null; index: number; reason: string; state: 'ok' | 'pace' | 'out' | 'probation' | 'unknown' } | null>;

const modelName = (e: AgentModelChoice | undefined, id: string | null) => id === null ? t('rolePage.add.default') : e?.models.find(m => m.id === id)?.name || id;

/** Whether a level is the card's own: Base always; Minimo or Massimo when the card has a list or a preset model for it
 *  (a level never set follows Base). */
const ownLevel = (p: AgentProfile, id: PresetId) => id === 'base' || !!p.levels?.[id]?.length || !!p.presets?.[id]?.model;

/** The lists as the card stores them: a level that follows Base is left out, so it keeps following Base. */
function stored(levels: FullLevels, p: AgentProfile): Partial<FullLevels> {
  return Object.fromEntries(PRESET_IDS.filter(id => ownLevel(p, id)).map(id => [id, levels[id]])) as Partial<FullLevels>;
}

/** `ids`: the levels shown (the Orchestrator has Base only, #468: it runs on its chat's engine, never at a level, and its
 *  chat starts on the first model of the list on that engine, so no «ora userebbe» line either). */
export function RoleLevels({ profile, ids = PRESET_IDS, hint = t('rolePage.levels.hint'), route: showRoute = true }: { profile: AgentProfile; ids?: readonly PresetId[]; hint?: string; route?: boolean }) {
  const { catalog } = useAgents();
  const [route, setRoute] = useState<Route | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<PresetId | null>(null);
  const [drag, setDrag] = useState<{ id: PresetId; i: number } | null>(null);
  const levels = levelsOf(profile, cardPresets(profile, null));
  const engines = catalog?.models ?? [];
  const engineOf = (h: string) => engines.find(e => e.engine === h);
  useEffect(() => {
    let alive = true;
    const read = () => void sb.invoke('agents:levelRoute', { id: profile.id }).then(r => { if (alive) setRoute(r); }, () => { if (alive) setRoute(null); });
    if (!showRoute) return () => { alive = false; };
    read();
    const timer = setInterval(read, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, [profile.id, profile.updatedAt, showRoute]);
  const save = async (id: PresetId, list: LevelModel[]) => {
    setBusy(true); setError(null);
    // an emptied Minimo or Massimo goes back to following Base; Base keeps at least one model
    const next = { ...stored(levels, profile), [id]: list };
    if (id !== 'base' && !list.length) delete next[id];
    try { await saveAgent({ ...agentDraftOf(profile), levels: next }, profile.id); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const own = (id: PresetId) => ownLevel(profile, id);
  const drop = (id: PresetId, to: number) => (e: DragEvent) => {
    e.preventDefault();
    if (!drag || drag.id !== id || drag.i === to) { setDrag(null); return; }
    const list = [...levels[id]], [moved] = list.splice(drag.i, 1);
    list.splice(to, 0, moved!);
    setDrag(null);
    void save(id, list);
  };
  return <section className="ad-card rl-card" aria-labelledby={`rl-${profile.id}`} data-testid="role-levels">
    <header className="ad-card-head"><h3 id={`rl-${profile.id}`}>{t('rolePage.levels')}</h3></header>
    <p className="ad-hint">{hint}</p>
    {ids.map(id => {
      const list = levels[id], now = route?.[id];
      return <div className="rl-level" key={id} data-testid={`role-level-${id}`}>
        <div className="rl-name"><b>{t(`rolePage.level.${id}`)}</b><small>{t(`rolePage.level.${id}.hint`)}</small></div>
        <div className="rl-body">
          <div className="rl-chips" data-own={own(id)}>
            {/* a level that follows Base shows no chip of its own: only «+ Aggiungi» and the note */}
            {own(id) && list.map((x, i) => {
              const e = engineOf(x.engine), chosen = !!now && now.index === i;
              const efforts = e?.models.find(m => m.id === x.model)?.efforts;
              return <span key={`${x.engine}:${x.model}`} className="rl-chip" data-on={chosen} data-off={!e?.enabled || undefined} draggable={!busy && own(id)}
                onDragStart={() => setDrag({ id, i })} onDragOver={ev => { if (drag?.id === id) ev.preventDefault(); }} onDrop={drop(id, i)} onDragEnd={() => setDrag(null)}
                data-testid={`role-level-${id}-${i}`}>
                <span className="rl-n">{i + 1}</span>
                <HarnessMark harness={x.engine} size={18} />
                <span className="rl-model" title={`${e?.label ?? x.engine} · ${x.model ?? t('rolePage.add.default')}`}>{modelName(e, x.model)}</span>
                {e?.effort && own(id) && <Select className="rl-effort" value={x.effort ?? ''} disabled={busy} aria-label={`${modelName(e, x.model)} · ${t('rolePage.add.effort')}`}
                  onChange={ev => { const eff = EFFORTS.find(v => v === ev.target.value); void save(id, list.map((y, j) => j === i ? { engine: y.engine, model: y.model, ...(eff ? { effort: eff } : {}) } : y)); }}>
                  <option value="">{t('rolePage.effortDefault')}</option>
                  {EFFORTS.filter(v => !efforts || efforts.includes(v)).map(v => <option key={v} value={v}>{effortLabel(v) ?? v}</option>)}
                </Select>}
                {own(id) && (id !== 'base' || list.length > 1) && <button type="button" className="rl-x" disabled={busy} aria-label={t('rolePage.remove', { model: modelName(e, x.model) })}
                  onClick={() => void save(id, list.filter((_, j) => j !== i))} data-testid={`role-level-${id}-${i}-remove`}>×</button>}
              </span>;
            })}
            {adding !== id && <button type="button" className="rl-add" disabled={busy} onClick={() => setAdding(id)} data-testid={`role-level-${id}-add`}>{t('rolePage.add')}</button>}
          </div>
          {!own(id) && <small className="rl-note">{t('rolePage.level.asBase')}</small>}
          {adding === id && <AddModel engines={engines} taken={own(id) ? list : []} busy={busy} onCancel={() => setAdding(null)}
            onAdd={x => { setAdding(null); void save(id, [...(own(id) ? list : []), x]); }} />}
          {showRoute && <p className="rl-now" data-testid={`role-level-${id}-now`}>
            {now ? <><i className="rl-dot" data-state={now.state === 'out' ? 'out' : now.state === 'pace' || now.reason.includes(' · ') ? 'pace' : 'ok'} aria-hidden="true" />
              <span>{t('rolePage.now', { model: modelName(engineOf(now.engine), now.model), engine: engineOf(now.engine)?.label ?? now.engine })}</span>
              {now.reason.includes(' · ') && <small> · {now.reason.split(' · ').slice(1).join(' · ')}</small>}</>
              : route ? <span>{t('rolePage.nowNone')}</span> : null}
          </p>}
        </div>
      </div>;
    })}
    {error && <p className="st-presets-error" role="alert" data-testid="role-levels-error">{error}</p>}
  </section>;
}

/** The small form under a level: engine, model, effort, Aggiungi. Only engines that are on are offered first. */
function AddModel({ engines, taken, busy, onAdd, onCancel }: { engines: AgentModelChoice[]; taken: LevelModel[]; busy: boolean; onAdd: (x: LevelModel) => void; onCancel: () => void }) {
  const usable = [...engines.filter(e => e.enabled && e.trusted), ...engines.filter(e => !(e.enabled && e.trusted))];
  const [engine, setEngine] = useState(usable[0]?.engine ?? '');
  const e = engines.find(x => x.engine === engine);
  const models = e?.modelSelectable ? e.models : [];
  const [model, setModel] = useState<string>('');
  const [effort, setEffort] = useState<Effort | ''>('');
  const efforts = e?.models.find(m => m.id === model)?.efforts;
  const dup = taken.some(x => x.engine === engine && (x.model ?? '') === model);
  return <div className="rl-addform" data-testid="role-level-addform">
    <Select value={engine} aria-label={t('rolePage.add.engine')} onChange={ev => { setEngine(ev.target.value); setModel(''); setEffort(''); }} data-testid="role-level-add-engine">
      {usable.map(x => <option key={x.engine} value={x.engine}>{x.label}{x.enabled && x.trusted ? '' : ' · spento'}</option>)}
    </Select>
    <Select value={model} aria-label={t('rolePage.add.model')} onChange={ev => setModel(ev.target.value)} data-testid="role-level-add-model">
      <option value="">{t('rolePage.add.default')}</option>
      {models.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
    </Select>
    {e?.effort && <Select value={effort} aria-label={t('rolePage.add.effort')} onChange={ev => setEffort(EFFORTS.find(v => v === ev.target.value) ?? '')}>
      <option value="">{t('rolePage.effortDefault')}</option>
      {EFFORTS.filter(v => !efforts || efforts.includes(v)).map(v => <option key={v} value={v}>{effortLabel(v) ?? v}</option>)}
    </Select>}
    <button type="button" className="btn btn-primary btn-s" disabled={busy || !engine || dup} onClick={() => onAdd({ engine, model: model || null, ...(effort ? { effort } : {}) })} data-testid="role-level-add-do">{t('rolePage.add.do')}</button>
    <button type="button" className="btn btn-subtle btn-s" onClick={onCancel}>{t('rolePage.add.cancel')}</button>
  </div>;
}
