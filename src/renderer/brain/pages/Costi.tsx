// Costi: what the chats cost (list-price estimate: with a subscription it is not a bill) for a period, where the
// biggest savings are, charts by day (today highlighted), kind of work, model and area, every chat with its longest
// context and what restarting it would have saved; then the app's own estimates against the real cost of its chats
// ('chat:list') and a calculator for a new job ('estimate:get': the brain's 80% range when its table is calibrated, else p25-p75 of similar past jobs, or "stima senza dati").
// The period's total is read against the period before (ADR 0037: /api/cost?days=2N, the brain caps at 90 days, so
// "90 giorni" says it has no comparison), and the total, the advice and every chart end with the discussion bar.
// Data: /api/cost?days=N (the brain's cost tool).
import { useEffect, useState } from 'react';
import type { Effort, EstimateResult, Harness, Usage } from '@shared/contract';
import { chatName } from '@shared/regia';
import { normCost, type CostChat } from '../types';
import { useBrain } from '../api';
import { fmt } from '../lib/format';
import { moneyEntries, topN } from '../lib/chart';
import { previousSpend, trend } from '../lib/stats';
import type { Quote } from '../lib/discuss';
import { baseName, short, sum } from '../lib/text';
import { Async, PageHead } from '../components/States';
import { BarChart, HBarChart } from '../components/Charts';
import { DataTable, type Col } from '../components/DataTable';
import { Kpi, Pill, Section, Seg } from '../components/ui';
import { HelpTip } from '../../components/HelpTip';
import { DiscussBar } from '../components/Discuss';
import { Reading } from '../components/Stats';
import { useAppChats, useEngineLabels } from '../components/Composer';

const PERIODS = [1, 7, 30, 90] as const;
/** the brain's cost API reads at most 90 days: the period before is known up to 45 */
const MAX_DAYS = 90;
const SOURCE = 'costi del cervello (ops/tools/cost.mjs sulle chat vere, prezzi di listino API)';
const HELP = {
  usd: "Stima a prezzi API (con l'abbonamento non viene addebitata): serve a confrontare, non è una fattura.",
  ctx: 'Quanti token la chat rileggeva a ogni messaggio, al massimo. Sopra 400k ogni messaggio costa molto: meglio ripartire.',
  save: 'Quanto avresti risparmiato ripartendo la chat a ~200k di contesto invece di continuarla.',
  saveKpi: 'Ogni messaggio rilegge tutta la chat, quindi una chat lunga costa sempre di più. È quanto avresti risparmiato riprendendo in una chat nuova quando il contesto arrivava a ~200k token.',
  fixed: 'I file del cervello che ogni chat carica sempre (istruzioni e memoria): vengono riletti a ogni messaggio, quindi ogni carattere in più costa in tutte le chat.',
  estimate: "All'avvio di un lavoro l'app guarda quanto sono costati i lavori simili passati. Quando il cervello ha misurato i suoi errori, l'intervallo contiene il costo vero 8 volte su 10; altrimenti è la metà centrale dei lavori simili (dal 25° al 75° percentile). Con meno di 5 lavori simili scrive «stima senza dati».",
};

/** The app's usage snapshot ('app:usage', then 'usage' events): today's Cursor from the ledger, estimated or exact. */
function useAppUsage(): Usage | null {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => {
    let alive = true;
    window.sb.invoke('app:usage', undefined).then(x => { if (alive) setU(x); }, () => {});
    const off = window.sb.on('usage', x => setU(x));
    return () => { alive = false; off(); };
  }, []);
  return u;
}

/** Cursor today: "≈ $" with its margin until a usage export confirms it. */
function CursorToday({ u }: { u: Usage | null }) {
  if (u?.cursorTodayUsd == null) return <Kpi k="Cursor oggi" v="n/d" s={u?.cursorNote || 'nessun turno registrato'} testId="bx-cursor-today" />;
  const est = u.cursorExact === false;
  return <Kpi k="Cursor oggi" help={est ? `Cursor non dice quanto costa ogni turno: l'app lo stima dai token della chat (±${u.cursorMarginPct ?? 20}%). Quando scarichi il file d'uso di Cursor (CSV) il numero diventa esatto.` : undefined} v={`${est ? '≈ ' : ''}${fmt.usd(u.cursorTodayUsd)}`} s={est ? `stima ±${u.cursorMarginPct ?? 20}% finché un CSV non conferma` : 'dal CSV di Cursor: esatto'} testId="bx-cursor-today" />;
}

export function Costi({ arg, nav }: { arg?: string; nav: (t: string) => void }) {
  const days = (PERIODS as readonly number[]).includes(Number(arg)) ? Number(arg) : 7;
  const r = useBrain(`/api/cost?days=${days}`, normCost);
  const appUsage = useAppUsage();
  const c = r.data;
  // today is never finished: "Oggi" has no comparison (half a day against a whole one would always read "in calo"), the
  // longer periods say that today is in, half done
  const compare = days > 1 && days * 2 <= MAX_DAYS;
  const r2 = useBrain(compare ? `/api/cost?days=${days * 2}` : null, normCost);
  const prev = c && r2.data ? previousSpend(r2.data.byDay, c.to, days, r2.data.from) : null;
  const reading = !c ? null
    : days === 1 ? { dir: null, good: null, text: `${fmt.usd(c.total)} oggi finora; la giornata non è finita: nessun confronto con ieri` }
      : !compare ? { dir: null, good: null, text: `${fmt.usd(c.total)} negli ultimi ${days} giorni; il cervello legge al massimo ${MAX_DAYS} giorni: nessun confronto con i ${days} prima` }
        : prev?.since ? { dir: null, good: null, text: `${fmt.usd(c.total)} negli ultimi ${days} giorni; nei ${days} prima i dati partono solo dal ${fmt.day(prev.since)} (${fmt.usd(prev.usd)}): nessun confronto onesto` }
        : r2.data ? trend(c.total, prev ? prev.usd : null, { what: '', now: `negli ultimi ${days} giorni (oggi compreso, non finito)`, before: `nei ${days} prima`, fmtN: fmt.usd })
          : null;
  const range = c ? (c.from === c.to ? `il ${fmt.day(c.to)}` : `dal ${fmt.day(c.from)} al ${fmt.day(c.to)}`) : '';
  const q = (id: string, title: string, facts: string[], question?: string): Quote => ({ id: `costi|${id}`, what: 'numero', title, source: `${SOURCE}, ${range}`, facts, question, inBrain: false });
  const byDay = c ? Object.entries(c.byDay).sort(([a], [b]) => a.localeCompare(b)) : [];
  const nDays = Math.max(1, byDay.length);
  const kinds = c ? topN(moneyEntries(c.byKind), 7) : [];
  const models = c ? moneyEntries(c.byModel) : [];
  const areas = c ? moneyEntries(c.byArea) : [];
  const top3 = c?.chats.slice(0, 3) ?? [];
  const advice = c ? [...c.advice].sort((a, b) => b.usd - a.usd) : [];
  const todayI = byDay.findIndex(([d]) => d === c?.to);
  const cols: Col<CostChat>[] = [
    { key: 'title', label: 'Chat', clip: true, render: x => <b>{x.title || '(senza titolo)'}</b>, value: x => x.title },
    { key: 'usd', label: 'Spesa', type: 'usd', width: '96px', help: HELP.usd },
    { key: 'ctxMax', label: 'Contesto max', type: 'num', width: '110px', help: HELP.ctx, render: x => (x.ctxMax > 400e3 ? <Pill tone="warn">{fmt.k(x.ctxMax)}</Pill> : fmt.k(x.ctxMax)) },
    { key: 'longSave', label: 'Risparmiabile', type: 'usd', width: '112px', help: HELP.save, render: x => (x.longSave > 0 ? fmt.usd(x.longSave) : '') },
    { key: 'calls', label: 'Chiamate', type: 'num', width: '90px', hidden: true },
    { key: 'folder', label: 'Cartella', width: '130px', value: x => baseName(x.folder) },
    { key: 'to', label: 'Ultima attività', type: 'date', width: '130px', value: x => x.to, render: x => fmt.when(x.to) },
  ];

  return (
    <>
      <PageHead title="Costi" at={r.at} refreshing={r.refreshing} onRefresh={() => r.reload(true)}
        lead={c ? <><b>{fmt.usd(c.total)} in {days === 1 ? 'un giorno' : `${days} giorni`}</b>, {fmt.usd(c.total / nDays)} al giorno.{advice[0] ? <> Il risparmio più grande: <b>{advice[0].text.split(':')[0]?.toLowerCase()}, {fmt.usd(advice[0].usd)}</b>.</> : null}</> : undefined}
        what="Prezzi di listino delle API: con l'abbonamento non è una fattura, serve a vedere dove va il lavoro. Calcolato dal cervello sulle chat vere, zero token."
        actions={<Seg label="Periodo" value={days} onChange={d => nav(d === 7 ? 'costi' : `costi/${d}`)} items={PERIODS.map(d => ({ id: d, label: d === 1 ? 'Oggi' : `${d} giorni` }))} />} />
      <Async loading={r.loading && !c} error={c ? null : r.error} onRetry={() => r.reload()} label="Calcolo i costi (fino a 20 secondi la prima volta)…" lines={5} block>
        {() => c && (
          <>
            <div className="bx-kpis" data-testid="bx-cost-kpis">
              <Kpi k="Nel periodo" help={HELP.usd} v={fmt.usd(c.total)} s={`${fmt.int(c.calls)} chiamate · ${c.from === c.to ? fmt.day(c.to) : `${fmt.day(c.from)} – ${fmt.day(c.to)}`}`} />
              <Kpi k="Al giorno" v={fmt.usd(c.total / nDays)} s={todayI >= 0 ? `oggi ${fmt.usd(byDay[todayI]?.[1].usd)}` : undefined} />
              <Kpi k="Risparmiabile" help={HELP.saveKpi} v={fmt.usd(c.longSave)} s="ripartendo le chat lunghe a ~200k" tone={c.longSave > c.total * 0.15 ? 'warn' : undefined} />
              <CursorToday u={appUsage} />
              {c.cursor ? <Kpi k="Cursor" v={fmt.usd(c.cursor.total)} s={c.cursor.downloaded ? `dal file d'uso del ${fmt.when(c.cursor.downloaded)}` : 'spesa vera'} /> : <Kpi k="Contesto fisso" help={HELP.fixed} v={c.fixed ? `${fmt.k(c.fixed.chars)} car.` : '—'} s={c.fixed ? `~${fmt.usd(c.fixed.usd)} nel periodo` : undefined} />}
            </div>
            <div className="bx-card tight bx-stat-discuss" data-testid="bx-cost-period">
              {reading ? <Reading t={reading} testId="bx-cost-reading" />
                : r2.error ? <p className="bx-warnline" role="note" data-testid="bx-cost-reading-error">Confronto con il periodo prima non riuscito: {r2.error} <button type="button" className="bx-btn s" onClick={() => r2.reload(true)}>Riprova</button></p>
                  : <p className="small muted">Confronto con il periodo prima: lo calcolo…</p>}
              <DiscussBar testId="bx-cost-discuss" topic={{ kind: 'quote', quote: q('totale', `spesa ${days === 1 ? 'di oggi' : `di ${days} giorni`}`, [
                `${fmt.usd(c.total)} ${range}, ${fmt.usd(c.total / nDays)} al giorno, ${fmt.int(c.calls)} chiamate`,
                reading ? reading.text : '',
                c.longSave > 0 ? `risparmiabile ripartendo le chat lunghe a ~200k: ${fmt.usd(c.longSave)}` : '',
                top3.length ? `le chat più care: ${top3.map(x => `${short(x.title, 40)} ${fmt.usd(x.usd)}`).join(', ')}` : '',
                'stima a prezzi di listino: con l\'abbonamento non è una fattura',
              ]) }} />
            </div>

            {advice.length > 0 && (
              <Section title="Dove risparmiare" note="calcolato dal cervello, in ordine di dollari" testId="bx-advice">
                <div className="bx-card tight">
                  <ul className="bx-list">{advice.slice(0, 3).map((a, i) => <li key={i}><Pill tone="warn">{fmt.usd(a.usd)}</Pill><span className="t">{a.text}</span></li>)}</ul>
                  {advice.length > 3 && <details style={{ marginTop: 6 }}><summary className="small muted" style={{ cursor: 'pointer' }}>Altri {advice.length - 3}</summary><ul className="bx-list">{advice.slice(3).map((a, i) => <li key={i}><Pill>{fmt.usd(a.usd)}</Pill><span className="t">{a.text}</span></li>)}</ul></details>}
                  <DiscussBar testId="bx-advice-discuss" topic={{ kind: 'quote', quote: q('risparmio', 'dove risparmiare', advice.slice(0, 5).map(a => `${fmt.usd(a.usd)}: ${a.text}`),
                    'Quale di questi risparmi vale la pena, e qual è il primo passo piccolo per ottenerlo?') }} />
                </div>
              </Section>
            )}

            <div className="bx-grid-2">
              <BarChart title="Spesa per giorno" note={todayI >= 0 ? 'oggi in arancione' : undefined} name={`spesa-giorni-${days}`} money
                labels={byDay.map(([d]) => fmt.day(d))} values={byDay.map(([, v]) => v.usd)} highlight={todayI >= 0 ? todayI : undefined}
                discuss={byDay.length > 1 ? q('giorni', 'spesa per giorno', byDay.map(([d, v]) => `${fmt.day(d)}: ${fmt.usd(v.usd)}`).slice(-14)) : undefined}
                explain={(() => { const m = [...byDay].sort((a, b) => b[1].usd - a[1].usd)[0]; return m && byDay.length > 2 ? { find: <>Il giorno più caro: <b>{fmt.day(m[0])}, {fmt.usd(m[1].usd)}</b> ({fmt.pct(m[1].usd, c.total)}% del periodo).</> } : undefined; })()} />
              <HBarChart title="Per tipo di lavoro" name={`spesa-tipo-${days}`} money labels={kinds.map(([k]) => k)} series={[{ label: 'spesa', values: kinds.map(([, v]) => v) }]}
                note={kinds[0] ? `«${kinds[0][0]}» è il ${fmt.pct(kinds[0][1], c.total)}%` : undefined}
                discuss={kinds.length ? q('tipo', 'spesa per tipo di lavoro', kinds.map(([k, v]) => `${k}: ${fmt.usd(v)} (${fmt.pct(v, c.total)}%)`)) : undefined}
                explain={{ says: 'in cosa se ne vanno i token: leggere, scrivere, comandi, browser…', why: 'il tipo più grande è la prima leva per spendere meno.' }} />
            </div>
            <div className="bx-grid-2">
              <HBarChart title="Per modello" name={`spesa-modello-${days}`} money labels={models.map(([k]) => k)} series={[{ label: 'spesa', values: models.map(([, v]) => v) }]}
                note={models[0] ? `${models[0][0]}: ${fmt.pct(models[0][1], c.total)}%` : undefined}
                discuss={models.length ? q('modello', 'spesa per modello', models.map(([k, v]) => `${k}: ${fmt.usd(v)} (${fmt.pct(v, c.total)}%)`)) : undefined} />
              <HBarChart title="Per area" name={`spesa-area-${days}`} money labels={areas.map(([k]) => k)} series={[{ label: 'spesa', values: areas.map(([, v]) => v) }]}
                discuss={areas.length ? q('area', 'spesa per area', areas.map(([k, v]) => `${k}: ${fmt.usd(v)} (${fmt.pct(v, c.total)}%)`)) : undefined} />
            </div>

            <Section title="Chat per chat" count={c.chats.length} testId="bx-cost-chats">
              {c.chats.length > 1 && <HBarChart title="Le chat più care" name={`spesa-chat-${days}`} money categorical={false}
                labels={c.chats.slice(0, 8).map(x => short(x.title || '(senza titolo)', 60))} series={[{ label: 'spesa', values: c.chats.slice(0, 8).map(x => x.usd), color: 'var(--bx-cat-1)' }, { label: 'risparmiabile', values: c.chats.slice(0, 8).map(x => x.longSave), color: 'var(--bx-cat-2)' }]}
                note="in blu la spesa, in arancione quanto si poteva risparmiare ripartendo la chat"
                discuss={q('chat', 'le chat più care', c.chats.slice(0, 8).map(x => `${short(x.title || '(senza titolo)', 60)}: ${fmt.usd(x.usd)}, contesto max ${fmt.k(x.ctxMax)}${x.longSave > 0 ? `, risparmiabili ${fmt.usd(x.longSave)}` : ''}`))} />}
              <DataTable name={`chat-costi-${days}`} label="Costo di ogni chat" rows={c.chats} cols={cols} sort={{ key: 'usd', dir: -1 }}
                explain={top3.length ? { find: <>Le 3 chat più care valgono <b>{fmt.pct(sum(top3.map(x => x.usd)), c.total)}%</b> del periodo: {top3.map(x => short(x.title, 40)).join(', ')}.</>, next: c.longSave > 0 ? 'una chat oltre 400k di contesto si riparte: chat nuova o /clear' : undefined, says: 'ogni chat con la sua spesa e il contesto più lungo che ha riletto.', why: 'il contesto lungo è il costo nascosto: ogni messaggio lo rilegge tutto.' } : undefined} />
            </Section>
            <p className="small muted">
              {c.uncalibrated.length ? `Stima non ancora calibrata per ${c.uncalibrated.length} ${c.uncalibrated.length === 1 ? 'giorno' : 'giorni'} del periodo. ` : ''}
              {c.fixed ? `Contesto fisso del cervello: ${fmt.k(c.fixed.chars)} caratteri, ~${fmt.usd(c.fixed.usd)} nel periodo. ` : ''}
              {c.cursor?.downloaded ? `Cursor: ${fmt.usd(c.cursor.total)} nel periodo (file d'uso scaricato ${fmt.when(c.cursor.downloaded)}${c.cursor.lastRow ? `, ultima riga ${fmt.when(c.cursor.lastRow)}` : ''}).` : ''}
            </p>
          </>
        )}
      </Async>
      <Estimates />
    </>
  );
}

// ── estimates: the app's chats (estimate vs actual) and a calculator ─────────────────────────────────────────────
interface EstRow { title: string; harness: string; model: string; stima: string; reale: number; esito: string; low: number; high: number }
function Estimates() {
  const chats = useAppChats();
  const engineLabel = useEngineLabels();
  const rows: EstRow[] = (chats ?? []).filter(c => c.estimate !== undefined).map(c => {
    const e = c.estimate;
    const esito = !e ? 'stima senza dati' : c.costUsd > e.usdHigh ? 'sopra la stima' : c.costUsd < e.usdLow ? 'sotto la stima' : 'dentro la stima';
    return { title: chatName(c), harness: engineLabel(c.harness), model: c.model ?? 'predefinito', stima: e ? `${fmt.usd(e.usdLow)} – ${fmt.usd(e.usdHigh)}` : 'stima senza dati', reale: c.costUsd, esito, low: e?.usdLow ?? 0, high: e?.usdHigh ?? 0 };
  });
  const over = rows.filter(r => r.esito === 'sopra la stima').length;
  const cols: Col<EstRow>[] = [
    { key: 'title', label: 'Chat', render: r => <b>{r.title}</b>, value: r => r.title },
    { key: 'harness', label: 'Motore', width: '90px' },
    { key: 'model', label: 'Modello', width: '150px' },
    { key: 'stima', label: 'Stima', width: '150px', help: "L'intervallo dato all'avvio: 8 volte su 10 quando il cervello è calibrato, altrimenti la metà centrale dei lavori simili (dal 25° al 75° percentile)." },
    { key: 'reale', label: 'Reale', type: 'usd', width: '90px' },
    { key: 'esito', label: 'Esito', width: '140px', render: r => <Pill tone={r.esito === 'sopra la stima' ? 'bad' : r.esito === 'dentro la stima' ? 'good' : r.esito === 'sotto la stima' ? 'blue' : 'outline'}>{r.esito}</Pill> },
  ];
  return (
    <div className="bx-grid-2" style={{ alignItems: 'start' }}>
      <Section title="Stime e costi reali" note="le chat dell'app in questa sessione" testId="bx-estimates"
      help={<HelpTip label="Come nasce la stima" title="Come nasce la stima" testid="bx-estimates-help">{HELP.estimate}</HelpTip>}>
        {rows.length ? <DataTable name="stime" label="Stime e costi reali" rows={rows} cols={cols} search={false}
          explain={{ find: <><b>{rows.length - over} su {rows.length}</b> sono dentro o sotto la stima{over ? <>, <b>{over} sopra</b></> : ''}.</>, says: 'per ogni chat dell\'app, quanto era stimato all\'inizio e quanto è costata.', why: 'una stima onesta si misura: se sbaglia spesso, va rivista.' }} />
          : <div className="bx-empty"><b>Ancora nessuna stima</b><span>Quando avvii un lavoro dall'app, la sua stima (o «stima senza dati») e il costo vero compaiono qui.</span></div>}
      </Section>
      <Calculator />
    </div>
  );
}

function Calculator() {
  const [harness, setHarness] = useState<Harness>('claude');
  const [effort, setEffort] = useState<Effort | ''>('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [res, setRes] = useState<EstimateResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ask = () => {
    setErr(null);
    window.sb.invoke('estimate:get', { harness, model: model.trim() || null, effort: effort || null, prompt }).then(setRes, e => setErr(String(e?.message ?? e)));
  };
  const e = res?.estimate;
  return (
    <Section title="Quanto costerà?" note="stima di un lavoro nuovo, dai lavori simili" testId="bx-calc">
      <div className="bx-card" style={{ display: 'grid', gap: 10 }}>
        <div className="bx-row">
          <Seg label="Motore" value={harness} onChange={setHarness} items={[{ id: 'claude', label: 'Claude' }, { id: 'cursor', label: 'Cursor' }]} />
          <input className="bx-input" style={{ width: 170 }} placeholder="modello (facoltativo)" aria-label="Modello" value={model} onChange={x => setModel(x.target.value)} />
          <select className="bx-select" aria-label="Impegno" value={effort} onChange={x => setEffort(x.target.value as Effort | '')}>
            <option value="">impegno: qualsiasi</option>{(['low', 'medium', 'high', 'xhigh', 'max'] as Effort[]).map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <textarea className="bx-textarea" placeholder="Il primo messaggio del lavoro, per capire che tipo di lavoro è (non viene salvato)…" aria-label="Il lavoro da stimare" value={prompt} onChange={x => setPrompt(x.target.value)} />
        <div className="bx-row"><button type="button" className="bx-btn primary" disabled={!prompt.trim()} onClick={ask}>Stima</button>{err && <span className="small" style={{ color: 'var(--bx-red)' }}>{err}</span>}</div>
        {res && (
          <div className="bx-confirm" data-testid="bx-calc-result" style={{ background: 'var(--bx-surface-2)', borderColor: 'var(--bx-border-2)' }}>
            {e ? <p><b style={{ fontSize: 16 }}>{fmt.usd(e.usdLow)} – {fmt.usd(e.usdHigh)}</b>{e.minLow != null && e.minHigh != null ? <span className="muted"> · {Math.round(e.minLow)}–{Math.round(e.minHigh)} minuti</span> : null}</p>
              : <p><b>Stima senza dati</b> <span className="muted">· meno di 5 lavori simili: niente numeri inventati.</span></p>}
            <p className="small muted">Tipo di lavoro: {res.kind} · {res.basis.label}</p>
          </div>
        )}
      </div>
    </Section>
  );
}
