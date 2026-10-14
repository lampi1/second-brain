// Impostazioni → «Instradamento modelli» (ADR 0032): the table that decides harness, model and effort of the chats the
// Regia opens, by kind of task and area (the user, 2026-10-13: "la Regia sceglie modello e sforzo per tipo di lavoro,
// configurabile"). Read with 'routing:get', saved with 'routing:save': main checks the hard rules (Claude models only on
// Claude, app chats never on Cursor, max effort only on request, a "perché" per row) and writes a new version of the
// table into the brain, with an audit line; old versions stay. Only the user writes it from here: agents propose in
// chat. Rendered by SettingsPage.tsx.
import { useEffect, useState } from 'react';
import type { RoutingInfo, TaskKind } from '@shared/contract';
import { effortLabel } from '../lib/format';
import { blankRow, fromEdit, KIND_IT, pickable, startEffort, tableEfforts, toEdit, type EditRow } from '../lib/routing';
import { toast } from '../store/ui';
import { HelpTip } from './HelpTip';

const today = (): string => new Date().toISOString().slice(0, 10);
const when = (iso: string): string => new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export function RoutingGroup() {
  const [info, setInfo] = useState<RoutingInfo | null>(null);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = (i: RoutingInfo) => { setInfo(i); setRows((i.table?.routes ?? []).map(toEdit)); setDirty(false); setError(null); setReason(''); };
  useEffect(() => {
    let alive = true;
    window.sb.invoke('routing:get', undefined).then(i => { if (alive) load(i); }, err => { if (alive) setError(String(err)); });
    return () => { alive = false; };
  }, []);
  const reg = info?.registry ?? null;
  const models = pickable(reg, rows.map(r => r.model));
  const put = (i: number, p: Partial<EditRow>) => { setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...p } : r))); setDirty(true); };
  const save = async () => {
    setBusy(true);
    try {
      const r = await window.sb.invoke('routing:save', { routes: rows.map(e => fromEdit(e, reg, today())), ...(reason.trim() ? { reason: reason.trim() } : {}) });
      load(r);
      toast(`Instradamento salvato: versione ${r.table?.version ?? '?'}`, 'ok');
    } catch (err) {
      // main's message, without Electron's "Error invoking remote method" prefix
      setError(String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally { setBusy(false); }
  };
  const t = info?.table;
  return (
    <section className="st-group" aria-label="Instradamento modelli" data-testid="st-group-routing">
      <header>
        <div className="st-group-h"><h2>Instradamento modelli</h2>
          <HelpTip label="Instradamento modelli" title="Una tabella di regole" testid="st-help-routing"
            example="«Review» in qualsiasi area → Opus con sforzo alto; «Log e ops» → un modello più economico.">
            Per ogni tipo di lavoro, ed eventualmente area, dice con quale modello e quanto sforzo la Regia apre la chat. Se più righe valgono, vince quella più precisa (tipo e area battono «qualsiasi»).
          </HelpTip>
        </div>
        <p>Con quale modello e sforzo la Regia apre una chat di lavoro, per tipo di lavoro e area. Vince la riga più precisa; nessuna riga = «Chat aperte dalla Regia». La Regia sceglie diverso solo con un motivo, che resta nel registro.</p>
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
                <thead><tr><th>Tipo di lavoro</th><th aria-label="Area">Area<HelpTip label="Area" example="«App, Pers · App»">Le etichette all'inizio del titolo della chat, separate da virgole. Vuota = qualsiasi area.</HelpTip></th><th>Modello</th><th aria-label="Sforzo">Sforzo<HelpTip label="Sforzo">Quanto il modello ragiona prima di rispondere. «predefinito» = quello del modello; più alto costa di più.</HelpTip></th><th>Perché</th><th><span className="sr-only">Togli</span></th></tr></thead>
                <tbody>
                  {rows.map((r, i) => {
                    const m = reg?.models.find(x => x.id === r.model);
                    return (
                      <tr key={i} data-testid={`st-routing-row-${i}`}>
                        <td>
                          <select className="st-select st-rt-s" value={r.kind} aria-label={`Riga ${i + 1}: tipo di lavoro`} onChange={e => put(i, { kind: e.target.value as TaskKind | '*' })}>
                            {(['*', ...info.kinds] as const).map(k => <option key={k} value={k}>{KIND_IT[k] ?? k}</option>)}
                          </select>
                        </td>
                        <td>
                          <input className="st-input st-rt-area" value={r.area} placeholder="qualsiasi" aria-label={`Riga ${i + 1}: area`} onChange={e => put(i, { area: e.target.value })} />
                        </td>
                        <td>
                          <select className="st-select st-rt-s" value={r.model} aria-label={`Riga ${i + 1}: modello`}
                            onChange={e => { const nm = reg?.models.find(x => x.id === e.target.value); put(i, { model: e.target.value, effort: r.effort && tableEfforts(nm).includes(r.effort) ? r.effort : startEffort(nm) }); }}>
                            {models.map(x => <option key={x.id} value={x.id}>{x.id.replace(/^claude-/, '')}</option>)}
                          </select>
                        </td>
                        <td>
                          <select className="st-select st-rt-e" value={r.effort} aria-label={`Riga ${i + 1}: sforzo`} onChange={e => put(i, { effort: e.target.value as EditRow['effort'] })}>
                            <option value="">predefinito</option>
                            {tableEfforts(m).map(e => <option key={e} value={e}>{effortLabel(e)}</option>)}
                          </select>
                        </td>
                        <td>
                          <input className="st-input st-rt-why" value={r.why} placeholder="perché questa scelta" aria-label={`Riga ${i + 1}: perché`} onChange={e => put(i, { why: e.target.value })} />
                          {r.evidence && <div className="st-meta" title={r.evidence}>{r.evidence}{r.since ? ` · dal ${r.since}` : ''}</div>}
                        </td>
                        <td><button type="button" className="btn btn-ghost btn-s" aria-label={`Togli la riga ${i + 1}`} onClick={() => { setRows(rs => rs.filter((_, j) => j !== i)); setDirty(true); }}>✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="st-row st-rt-foot">
              <button type="button" className="btn btn-ghost btn-s" disabled={!reg} onClick={() => { setRows(rs => [...rs, blankRow(reg, today())]); setDirty(true); }} data-testid="st-routing-add">+ Riga</button>
              <input className="st-input st-rt-reason" value={reason} placeholder="motivo della modifica (facoltativo)" aria-label="Motivo della modifica" onChange={e => setReason(e.target.value)} data-testid="st-routing-reason" />
              <button type="button" className="btn btn-ghost btn-s" disabled={!dirty || busy} onClick={() => { if (info) load(info); }} data-testid="st-routing-undo">Annulla</button>
              <button type="button" className="btn btn-primary btn-s" disabled={!dirty || busy || !reg} onClick={() => void save()} data-testid="st-routing-save">Salva</button>
            </div>
            {error && <div className="st-row st-rt-err" role="alert" data-testid="st-routing-error"><div className="st-desc">{error}</div></div>}
          </>
        )}
      </div>
    </section>
  );
}
