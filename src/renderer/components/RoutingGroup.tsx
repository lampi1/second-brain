// Impostazioni → «Instradamento modelli» (ADR 0032): the table that decides harness, model and effort of the chats the
// Regia opens, by kind of task and area (the user, 2026-10-13: "la Regia sceglie modello e sforzo per tipo di lavoro,
// configurabile"). Read with 'routing:get', saved with 'routing:save': main checks the hard rules (Claude models only on
// Claude, app chats never on Cursor, max effort only on request, a "perché" per row) and writes a new version of the
// table into the brain, with an audit line; old versions stay. The Esplorazione field (0-50%) is saved the same way:
// the share of chats that try a little-sampled model on their own engine, so the table has data to improve on (the
// user, 2026-10-14). The Regia writes the same table by itself (app_routing_save, with its reason and data): the
// Cronologia lists every change, who made it and why, and «Ripristina» brings an older version back as a new one
// ('routing:restore'). The user has the same powers here as the agent, plus two of their own (2026-10-14): the switch
// «L'AI può cambiarla» per row (off = no agent changes or removes that row, and exploration leaves its chats alone) and
// the «Peso del costo» (0-10, the λ the daily loop weighs cost against quality with). A writing row on an Anthropic model
// also has «Sui crediti API» (ADR 0052, off until the user turns it on): its chats run on the Anthropic API engine, paid
// by the API credits of the user's Max plan. Rendered by SettingsPage.tsx.
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
      toast(`Ripristinata la versione ${version}: ora è la ${r.table?.version ?? '?'}`, 'ok');
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
    <section className="st-group" aria-label="Instradamento modelli" data-testid="st-group-routing">
      <header>
        <div className="st-group-h"><h2>Instradamento modelli</h2>
          <HelpTip label="Instradamento modelli" title="Una tabella di regole" testid="st-help-routing"
            example="«Review» in qualsiasi area → Opus con sforzo alto; «Log e ops» → un modello più economico.">
            Per ogni tipo di lavoro, ed eventualmente area, dice con quale modello e quanto sforzo l’Orchestrator apre la chat. Se più righe valgono, vince la più precisa: tipo e area, poi solo area, poi solo tipo, poi «qualsiasi». Così una riga d'area (per esempio App) vale per tutte le sue chat.
          </HelpTip>
        </div>
        <p>Con quale modello e sforzo l’Orchestrator apre una chat di lavoro, per tipo di lavoro e area. Vince la riga più precisa; nessuna riga = «Chat aperte dall’Orchestrator». L’Orchestrator può cambiare la tabella da solo, con motivo e dati: lo vedi nella Cronologia e puoi ripristinare qualsiasi versione.</p>
      </header>
      <div className="st-card">
        {!info ? <div className="st-row"><div className="st-desc">{error ?? 'Leggo la tabella…'}</div></div> : (
          <>
            <div className="st-row" data-testid="st-routing-version">
              <div className="st-text">
                <div className="st-title">{t ? `Versione ${t.version}` : 'Nessuna tabella ancora'}</div>
                <div className="st-desc">{info.error ?? (t?.appliedAt ? `Salvata il ${when(t.appliedAt)}${t.by ? ` da ${t.by}` : ''}. Ogni salvataggio è una versione nuova: le vecchie restano nel cervello.` : 'Al primo salvataggio nasce la versione 1.')}</div>
              </div>
            </div>
            <div className="st-rt-wrap">
              <table className="st-rt" data-testid="st-routing-table">
                <thead><tr><th>Tipo di lavoro</th><th aria-label="Area">Area<HelpTip label="Area" example="«App, Pers · App»">Le etichette all'inizio del titolo della chat, separate da virgole. Vuota = qualsiasi area.</HelpTip></th><th>Modello</th><th aria-label="Sforzo">Sforzo<HelpTip label="Sforzo">Quanto il modello ragiona prima di rispondere. «predefinito» = quello del modello; più alto costa di più.</HelpTip></th><th>Perché</th><th aria-label="L'AI può cambiarla">AI<HelpTip label="L'AI può cambiarla" testid="st-help-routing-ai">Acceso: l’Orchestrator e il loop giornaliero possono cambiare questa riga da soli, con motivo e dati. Spento: la riga resta come l'hai messa tu, e nemmeno l'esplorazione prova altri modelli per quelle chat.</HelpTip></th><th><span className="sr-only">Togli</span></th></tr></thead>
                <tbody>
                  {rows.map((r, i) => {
                    const m = reg?.models.find(x => x.id === r.model);
                    return (
                      <tr key={i} data-testid={`st-routing-row-${i}`}>
                        <td>
                          <Select className="st-select st-rt-s" value={r.kind} aria-label={`Riga ${i + 1}: tipo di lavoro`} onChange={e => put(i, { kind: e.target.value as TaskKind | '*' })}>
                            {(['*', ...info.kinds] as const).map(k => <option key={k} value={k}>{getKindIt()[k] ?? k}</option>)}
                          </Select>
                        </td>
                        <td>
                          <input className="st-input st-rt-area" value={r.area} placeholder="qualsiasi" aria-label={`Riga ${i + 1}: area`} onChange={e => put(i, { area: e.target.value })} />
                        </td>
                        <td>
                          <Select className="st-select st-rt-s" value={r.model} aria-label={`Riga ${i + 1}: modello`}
                            onChange={e => { const nm = reg?.models.find(x => x.id === e.target.value); put(i, { model: e.target.value, effort: r.effort && tableEfforts(nm, takes).includes(r.effort) ? r.effort : startEffort(nm, takes) }); }}>
                            {models.map(x => <option key={x.id} value={x.id}>{x.id.replace(/^claude-/, '')}</option>)}
                          </Select>
                          {apiCapable(r, m) && (
                            <label className="st-rt-api" data-testid={`st-routing-api-${i}`}>
                              <input type="checkbox" checked={r.onApi} aria-label={`Riga ${i + 1}: sui crediti API`} onChange={e => put(i, { onApi: e.target.checked })} data-testid={`st-routing-api-${i}-check`} />
                              <span>sui crediti API</span>
                              <HelpTip label="Sui crediti API" title="Crediti API del piano Max" testid={`st-help-routing-api-${i}`}>
                                Acceso: queste chat girano su Anthropic API con lo stesso modello e le pagano i crediti API del piano, non i limiti di Claude Code. Solo testo: niente file né strumenti. Servono, in «Motori»: Anthropic API acceso con la chiave e «Le Regie possono usare Anthropic API»; per le chat aperte da un Orchestrator anche «Chat tra motori diversi». Se ne manca uno restano su Claude. Lo cambi solo tu.
                              </HelpTip>
                            </label>
                          )}
                        </td>
                        <td>
                          <Select className="st-select st-rt-e" value={r.effort} aria-label={`Riga ${i + 1}: sforzo`} onChange={e => put(i, { effort: e.target.value as EditRow['effort'] })}>
                            <option value="">predefinito</option>
                            {tableEfforts(m, takes).map(e => <option key={e} value={e}>{effortLabel(e)}</option>)}
                          </Select>
                        </td>
                        <td>
                          <input className="st-input st-rt-why" value={r.why} placeholder="perché (facoltativo: lo scrive l’AI)" aria-label={`Riga ${i + 1}: perché`} onChange={e => put(i, { why: e.target.value })} />
                          {r.evidence && <div className="st-meta" title={r.evidence}>{r.evidence}{r.since ? ` · dal ${r.since}` : ''}</div>}
                        </td>
                        <td className="st-rt-ai">
                          <input type="checkbox" checked={r.ai} aria-label={`Riga ${i + 1}: l'AI può cambiarla`} onChange={e => put(i, { ai: e.target.checked })} data-testid={`st-routing-ai-${i}`} />
                        </td>
                        <td><button type="button" className="btn btn-ghost btn-s" aria-label={`Togli la riga ${i + 1}`} onClick={() => { setRows(rs => rs.filter((_, j) => j !== i)); setDirty(true); }}>✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="st-row" data-testid="st-routing-explore">
              <div className="st-text">
                <div className="st-title">Esplorazione
                  <HelpTip label="Esplorazione" title="Provare anche altri modelli" testid="st-help-explore"
                    example="10% → circa 1 chat su 10 prova un modello che ha ancora pochi dati per quel tipo di lavoro.">
                    La parte delle chat che, invece della riga della tabella, prova un altro modello dello stesso motore (Claude resta Claude, Cursor resta Cursor), quello con meno dati per quel tipo di lavoro. Serve a raccogliere esiti da confrontare. Mai sulle Regie, mai sforzo massimo, mai quando l’Orchestrator sceglie lui il modello. 0% = sempre la tabella.
                  </HelpTip>
                </div>
                <div className="st-desc">Quante chat provano un modello diverso per raccogliere dati: da 0 a 50%.</div>
              </div>
              <label className="st-rt-pct">
                <input type="number" className="st-input" min={0} max={50} step={1} value={pct} aria-label="Esplorazione, in percentuale"
                  onChange={e => { setPct(e.target.value); setDirty(true); }} data-testid="st-routing-explore-input" />
                <span aria-hidden="true">%</span>
              </label>
            </div>
            <div className="st-row" data-testid="st-routing-weight">
              <div className="st-text">
                <div className="st-title">Peso del costo
                  <HelpTip label="Peso del costo" title="Qualità contro costo" testid="st-help-weight"
                    example="7 → un modello che costa la metà vince se sbaglia poco di più; con 0 vince sempre il più bravo.">
                    Quanto conta il costo quando il loop giornaliero confronta i modelli per un tipo di lavoro: 0 = solo la qualità, 10 = solo il costo. Come il «cost_quality_tradeoff» di OpenRouter. Lo cambi solo tu: la Regia non lo tocca.
                  </HelpTip>
                </div>
                <div className="st-desc">Da 0 (solo qualità) a 10 (solo costo).</div>
              </div>
              <label className="st-rt-pct">
                <input type="number" className="st-input" min={0} max={10} step={1} value={weight} aria-label="Peso del costo, da 0 a 10"
                  onChange={e => { setWeight(e.target.value); setDirty(true); }} data-testid="st-routing-weight-input" />
              </label>
            </div>
            <div className="st-row st-rt-foot">
              <button type="button" className="btn btn-ghost btn-s" disabled={!reg} onClick={() => { setRows(rs => [...rs, blankRow(reg, today(), takes)]); setDirty(true); }} data-testid="st-routing-add">+ Riga</button>
              <input className="st-input st-rt-reason" value={reason} placeholder="motivo della modifica (facoltativo)" aria-label="Motivo della modifica" onChange={e => setReason(e.target.value)} data-testid="st-routing-reason" />
              <button type="button" className="btn btn-ghost btn-s" disabled={!dirty || busy} onClick={() => { if (info) load(info); }} data-testid="st-routing-undo">Annulla</button>
              <button type="button" className="btn btn-primary btn-s" disabled={!dirty || busy || !reg} onClick={() => void save()} data-testid="st-routing-save">Salva</button>
            </div>
            {error && <div className="st-row st-rt-err" role="alert" data-testid="st-routing-error"><div className="st-desc">{error}</div></div>}
            {info.history.length > 0 && (
              <div className="st-rt-hist" data-testid="st-routing-history">
                <div className="st-title">Cronologia
                  <HelpTip label="Cronologia" testid="st-help-routing-history">
                    Ogni modifica della tabella, tua o dell’Orchestrator, con il motivo e i dati. «Ripristina» rimette in vigore quella versione come versione nuova: niente si perde.
                  </HelpTip>
                </div>
                <ul>
                  {info.history.map(h => (
                    <li key={`${h.to}-${h.at}`} data-testid={`st-routing-change-${h.to}`}>
                      <div className="st-rt-hist-text">
                        <div><b>Versione {h.to}</b> · {when(h.at)} · {h.by}</div>
                        <div className="st-desc">
                          {h.reason ?? 'senza motivo'}{h.exploration ? ` · esplorazione ${Math.round(h.exploration.from * 100)}% → ${Math.round(h.exploration.to * 100)}%` : ''}{h.costWeight ? ` · peso del costo ${h.costWeight.from} → ${h.costWeight.to}` : ''}
                          {h.evidence && <span className="st-meta"> · dati: {h.evidence}</span>}
                        </div>
                      </div>
                      {h.to === t?.version ? <span className="st-meta">in vigore</span>
                        : h.stored && <button type="button" className="btn btn-ghost btn-s" disabled={busy || dirty} title={dirty ? 'Salva o annulla prima le modifiche' : undefined}
                          onClick={() => void restore(h.to)} data-testid={`st-routing-restore-${h.to}`}>Ripristina</button>}
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
