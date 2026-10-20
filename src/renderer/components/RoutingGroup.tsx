// Impostazioni → «Instradamento modelli» (ADR 0032): the table that decides harness, model and effort of the chats the
// Orchestrator opens, by kind of task and area (the user, 2026-10-13: "l'Orchestrator sceglie modello e sforzo per tipo di lavoro,
// configurabile"). Read with 'routing:get', saved with 'routing:save': main checks the hard rules (Claude models only on
// Claude, app chats never on Cursor, max effort only on request, a "perché" per row) and writes a new version of the
// table into the brain, with an audit line; old versions stay. The Esplorazione field (0-50%) is saved the same way:
// the share of chats that try a little-sampled model on their own engine, so the table has data to improve on (the
// user, 2026-10-14). The Orchestrator writes the same table by itself (app_routing_save, with its reason and data): the
// Cronologia lists every change, who made it and why, and «Ripristina» brings an older version back as a new one
// ('routing:restore'). The user has the same powers here as the agent, plus two of their own (2026-10-14): the switch
// «L'AI può cambiarla» per row (off = no agent changes or removes that row, and exploration leaves its chats alone) and
// the «Peso del costo» (0-10, the λ the daily loop weighs cost against quality with). A writing row on an Anthropic model
// also has «Sui crediti API» (ADR 0052, off until the user turns it on): its chats run on the Anthropic API engine, paid
// by the API credits of the user's Max plan. Rendered by SettingsPage.tsx.
import { t as auditText } from '../i18n';
import { Select } from './Select';
import { useEffect, useState } from 'react';
import type { RoutingInfo, TaskKind } from '@shared/contract';
import { effortLabel } from '../lib/format';
import { engineCan } from '../lib/engines';
import { apiCapable, blankRow, fromEdit, getKindIt, pickable, startEffort, tableEfforts, toEdit, type EditRow } from '../lib/routing';
import { toast } from '../store/ui';
import { HelpTip } from './HelpTip';

const today = (): string => new Date().toISOString().slice(0, 10);
/** The typed percent as the table's rate (0 to 0.5); a value out of range goes to main as is, which refuses it. An empty
 *  field (cleared to retype, or a value the number input rejects) is omitted: the rate in force stays, never a silent 0. */
const explorationOf = (pct: string): number | undefined => (pct.trim() === '' ? undefined : Number(pct) / 100);
/** The typed cost weight (0-10, as is: main refuses one out of range); empty = the one in force stays. */
const weightOf = (w: string): number | undefined => (w.trim() === '' ? undefined : Number(w));
const when = (iso: string): string => new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export function RoutingGroup() {
  const [info, setInfo] = useState<RoutingInfo | null>(null);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [reason, setReason] = useState('');
  // exploration as a whole percent, as typed ('' while the field is being cleared)
  const [pct, setPct] = useState('0');
  const [weight, setWeight] = useState('7');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = (i: RoutingInfo) => { setInfo(i); setRows((i.table?.routes ?? []).map(toEdit)); setPct(String(Math.round((i.table?.exploration ?? 0) * 100))); setWeight(String(i.table?.costWeight ?? 7)); setDirty(false); setError(null); setReason(''); };
  useEffect(() => {
    let alive = true;
    window.sb.invoke('routing:get', undefined).then(i => { if (alive) load(i); }, err => { if (alive) setError(String(err)); });
    return () => { alive = false; };
  }, []);
  const reg = info?.registry ?? null;
  const takes = (h: string) => engineCan(h, 'effort');
  const models = pickable(reg, rows.map(r => r.model));
  const put = (i: number, p: Partial<EditRow>) => { setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...p } : r))); setDirty(true); };
  const mainError = (err: unknown): string => String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const restore = async (version: number) => {
    setBusy(true);
    try {
      const r = await window.sb.invoke('routing:restore', { version });
      load(r);
      toast(auditText('cmp.routing.restored', { version, now: r.table?.version ?? '?' }), 'ok');
    } catch (err) { setError(mainError(err)); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await window.sb.invoke('routing:save', { routes: rows.map(e => fromEdit(e, reg, today())), ...(explorationOf(pct) !== undefined ? { exploration: explorationOf(pct) } : {}), ...(weightOf(weight) !== undefined ? { costWeight: weightOf(weight) } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}), ...(info?.table ? { baseVersion: info.table.version } : {}) });
      load(r);
      toast(`Instradamento salvato: versione ${r.table?.version ?? '?'}`, 'ok');
    } catch (err) {
      // main's message, without Electron's "Error invoking remote method" prefix
      setError(mainError(err));
    } finally { setBusy(false); }
  };
  const t = info?.table;
  return (
    <section className="st-group" aria-label={auditText('audit.RoutingGroup.modelRouting')} data-testid="st-group-routing">
      <header>
        <div className="st-group-h"><h2>{auditText('audit.RoutingGroup.modelRouting')}</h2>
          <HelpTip label={auditText('audit.RoutingGroup.modelRouting')} title={auditText('audit.RoutingGroup.aTableOfRules')} guide="routing" testid="st-help-routing"
            example={auditText('cmp.routing.exampleRules')}>{auditText('audit.RoutingGroup.forEachKindOfWorkOptionally')}</HelpTip>
        </div>
        <p>{auditText('audit.RoutingGroup.theModelAndEffortTheOrchestrator')}</p>
      </header>
      <div className="st-card">
        {!info ? <div className="st-row"><div className="st-desc">{error ?? auditText('auditExpression.RoutingGroup.text139')}</div></div> : (
          <>
            <div className="st-row" data-testid="st-routing-version">
              <div className="st-text">
                <div className="st-title">{t ? auditText('auditExpression.RoutingGroup.text140', { v0: t.version }) : auditText('auditExpression.RoutingGroup.text141')}</div>
                <div className="st-desc">{info.error ?? (t?.appliedAt ? auditText('auditExpression.RoutingGroup.text142', { v0: when(t.appliedAt), v1: t.by ? auditText('auditExpression.RoutingGroup.text143', { v0: t.by }) : '' }) : auditText('auditExpression.RoutingGroup.text144'))}</div>
              </div>
            </div>
            <div className="st-rt-wrap">
              <table className="st-rt" data-testid="st-routing-table">
                <thead><tr><th>{auditText('audit.RoutingGroup.workKind')}</th><th aria-label={auditText('audit.RoutingGroup.area')}>{auditText('audit.RoutingGroup.area')}<HelpTip label={auditText('audit.RoutingGroup.area')} example="«App, Pers · App»">{auditText('audit.RoutingGroup.labelsAtTheBeginningOfThe')}</HelpTip></th><th>{auditText('audit.RoutingGroup.model')}</th><th aria-label={auditText('audit.RoutingGroup.effort')}>{auditText('audit.RoutingGroup.effort')}<HelpTip label={auditText('audit.RoutingGroup.effort')}>{auditText('audit.RoutingGroup.howMuchTheModelReasonsBefore')}</HelpTip></th><th>{auditText('audit.RoutingGroup.why')}</th><th aria-label={auditText('audit.RoutingGroup.aiCanChangeIt')}>AI<HelpTip label={auditText('audit.RoutingGroup.aiCanChangeIt')} testid="st-help-routing-ai">{auditText('audit.RoutingGroup.onTheOrchestratorAndDailyLoop')}</HelpTip></th><th><span className="sr-only">{auditText('audit.RoutingGroup.remove')}</span></th></tr></thead>
                <tbody>
                  {rows.map((r, i) => {
                    const m = reg?.models.find(x => x.id === r.model);
                    return (
                      <tr key={i} data-testid={`st-routing-row-${i}`}>
                        <td>
                          <Select className="st-select st-rt-s" value={r.kind} aria-label={auditText('auditExpression.RoutingGroup.text145', { v0: i + 1 })} onChange={e => put(i, { kind: e.target.value as TaskKind | '*' })}>
                            {(['*', ...info.kinds] as const).map(k => <option key={k} value={k}>{getKindIt()[k] ?? k}</option>)}
                          </Select>
                        </td>
                        <td>
                          <input className="st-input st-rt-area" value={r.area} placeholder={auditText('audit.RoutingGroup.any')} aria-label={auditText('auditExpression.RoutingGroup.text146', { v0: i + 1 })} onChange={e => put(i, { area: e.target.value })} />
                        </td>
                        <td>
                          <Select className="st-select st-rt-s" value={r.model} aria-label={auditText('auditExpression.RoutingGroup.text147', { v0: i + 1 })}
                            onChange={e => { const nm = reg?.models.find(x => x.id === e.target.value); put(i, { model: e.target.value, effort: r.effort && tableEfforts(nm, takes).includes(r.effort) ? r.effort : startEffort(nm, takes) }); }}>
                            {models.map(x => <option key={x.id} value={x.id}>{x.id.replace(/^claude-/, '')}</option>)}
                          </Select>
                          {apiCapable(r, m) && (
                            <label className="st-rt-api" data-testid={`st-routing-api-${i}`}>
                              <input type="checkbox" checked={r.onApi} aria-label={auditText('auditExpression.RoutingGroup.text148', { v0: i + 1 })} onChange={e => put(i, { onApi: e.target.checked })} data-testid={`st-routing-api-${i}-check`} />
                              <span>{auditText('audit.RoutingGroup.usingApiCredits')}</span>
                              <HelpTip label={auditText('audit.RoutingGroup.usingApiCredits194')} title={auditText('audit.RoutingGroup.maxPlanApiCredits')} testid={`st-help-routing-api-${i}`}>{auditText('audit.RoutingGroup.onTheseChatsRunOnAnthropic')}</HelpTip>
                            </label>
                          )}
                        </td>
                        <td>
                          <Select className="st-select st-rt-e" value={r.effort} aria-label={auditText('auditExpression.RoutingGroup.text149', { v0: i + 1 })} onChange={e => put(i, { effort: e.target.value as EditRow['effort'] })}>
                            <option value="">{auditText('audit.RoutingGroup.default')}</option>
                            {tableEfforts(m, takes).map(e => <option key={e} value={e}>{effortLabel(e)}</option>)}
                          </Select>
                        </td>
                        <td>
                          <input className="st-input st-rt-why" value={r.why} placeholder={auditText('audit.RoutingGroup.reasonOptionalSuppliedByAi')} aria-label={auditText('auditExpression.RoutingGroup.text150', { v0: i + 1 })} onChange={e => put(i, { why: e.target.value })} />
                          {r.evidence && <div className="st-meta" title={r.evidence}>{r.evidence}{r.since ? auditText('auditExpression.RoutingGroup.text151', { v0: r.since }) : ''}</div>}
                        </td>
                        <td className="st-rt-ai">
                          <input type="checkbox" checked={r.ai} aria-label={auditText('auditExpression.RoutingGroup.text152', { v0: i + 1 })} onChange={e => put(i, { ai: e.target.checked })} data-testid={`st-routing-ai-${i}`} />
                        </td>
                        <td><button type="button" className="btn btn-ghost btn-s" aria-label={auditText('auditExpression.RoutingGroup.text153', { v0: i + 1 })} onClick={() => { setRows(rs => rs.filter((_, j) => j !== i)); setDirty(true); }}>✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="st-row" data-testid="st-routing-explore">
              <div className="st-text">
                <div className="st-title">{auditText('audit.RoutingGroup.exploration')}<HelpTip label={auditText('audit.RoutingGroup.exploration')} title={auditText('audit.RoutingGroup.tryOtherModelsToo')} testid="st-help-explore"
                    example={auditText('cmp.routing.exampleExplore')}>{auditText('audit.RoutingGroup.theShareOfChatsThatTry')}</HelpTip>
                </div>
                <div className="st-desc">{auditText('audit.RoutingGroup.howManyChatsTryAnotherModel')}</div>
              </div>
              <label className="st-rt-pct">
                <input type="number" className="st-input" min={0} max={50} step={1} value={pct} aria-label={auditText('audit.RoutingGroup.explorationPercentage')}
                  onChange={e => { setPct(e.target.value); setDirty(true); }} data-testid="st-routing-explore-input" />
                <span aria-hidden="true">%</span>
              </label>
            </div>
            <div className="st-row" data-testid="st-routing-weight">
              <div className="st-text">
                <div className="st-title">{auditText('audit.RoutingGroup.costWeight')}<HelpTip label={auditText('audit.RoutingGroup.costWeight')} title={auditText('audit.RoutingGroup.qualityVersusCost')} testid="st-help-weight"
                    example={auditText('cmp.routing.exampleWeight')}>{auditText('audit.RoutingGroup.howMuchCostMattersWhenThe')}</HelpTip>
                </div>
                <div className="st-desc">{auditText('audit.RoutingGroup.from0QualityOnlyTo10')}</div>
              </div>
              <label className="st-rt-pct">
                <input type="number" className="st-input" min={0} max={10} step={1} value={weight} aria-label={auditText('audit.RoutingGroup.costWeight0To10')}
                  onChange={e => { setWeight(e.target.value); setDirty(true); }} data-testid="st-routing-weight-input" />
              </label>
            </div>
            <div className="st-row st-rt-foot">
              <button type="button" className="btn btn-ghost btn-s" disabled={!reg} onClick={() => { setRows(rs => [...rs, blankRow(reg, today(), takes)]); setDirty(true); }} data-testid="st-routing-add">{auditText('audit.RoutingGroup.row')}</button>
              <input className="st-input st-rt-reason" value={reason} placeholder={auditText('audit.RoutingGroup.reasonForTheChangeOptional')} aria-label={auditText('audit.RoutingGroup.reasonForTheChange')} onChange={e => setReason(e.target.value)} data-testid="st-routing-reason" />
              <button type="button" className="btn btn-ghost btn-s" disabled={!dirty || busy} onClick={() => { if (info) load(info); }} data-testid="st-routing-undo">{auditText('audit.RoutingGroup.cancel')}</button>
              <button type="button" className="btn btn-primary btn-s" disabled={!dirty || busy || !reg} onClick={() => void save()} data-testid="st-routing-save">{auditText('audit.RoutingGroup.save')}</button>
            </div>
            {error && <div className="st-row st-rt-err" role="alert" data-testid="st-routing-error"><div className="st-desc">{error}</div></div>}
            {info.history.length > 0 && (
              <div className="st-rt-hist" data-testid="st-routing-history">
                <div className="st-title">{auditText('audit.RoutingGroup.history')}<HelpTip label={auditText('audit.RoutingGroup.history')} testid="st-help-routing-history">{auditText('audit.RoutingGroup.everyTableChangeYoursOrThe')}</HelpTip>
                </div>
                <ul>
                  {info.history.map(h => (
                    <li key={`${h.to}-${h.at}`} data-testid={`st-routing-change-${h.to}`}>
                      <div className="st-rt-hist-text">
                        <div><b>{auditText('audit.RoutingGroup.version')}{' '}{h.to}</b> · {when(h.at)} · {h.by}</div>
                        <div className="st-desc">
                          {h.reason ?? auditText('auditExpression.RoutingGroup.text154')}{h.exploration ? auditText('auditExpression.RoutingGroup.text155', { v0: Math.round(h.exploration.from * 100), v1: Math.round(h.exploration.to * 100) }) : ''}{h.costWeight ? auditText('auditExpression.RoutingGroup.text156', { v0: h.costWeight.from, v1: h.costWeight.to }) : ''}
                          {h.evidence && <span className="st-meta">{' '}{auditText('audit.RoutingGroup.evidence')}{' '}{h.evidence}</span>}
                        </div>
                      </div>
                      {h.to === t?.version ? <span className="st-meta">{auditText('audit.RoutingGroup.active')}</span>
                        : h.stored && <button type="button" className="btn btn-ghost btn-s" disabled={busy || dirty} title={dirty ? auditText('auditExpression.RoutingGroup.text157') : undefined}
                          onClick={() => void restore(h.to)} data-testid={`st-routing-restore-${h.to}`}>{auditText('audit.RoutingGroup.restore')}</button>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
