// Oggi (home of the brain): the few things that matter now, the rest one click away. One line with the key fact,
// four tiles (who waits for you, who is working, today's spend with the last two weeks, the AI's open ideas), what was
// done today by topic, the stand-up sentences, and the way into the 3D map. Data: /api/tables, /api/now (every 20 s),
// /api/day (report + brief), /api/cost (1 and 14 days).
import { normBrief, normCost, normNow, normReport, normTables } from '../types';
import { useBrain } from '../api';
import { fmt } from '../lib/format';
import { groupChats, chatName, chatState } from '../lib/chats';
import { isDecision, ownerOf, short, sum } from '../lib/text';
import { Async, Empty, PageHead } from '../components/States';
import { Sparkline } from '../components/Charts';
import { Harness, IconMap, Pill, type Navigate } from '../components/ui';
import { DoneView, Standup } from './day';

export function Home({ nav }: { nav: Navigate }) {
  const t = useBrain('/api/tables', normTables);
  const now = useBrain('/api/now', normNow, { pollMs: 20e3 });
  const br = useBrain('/api/day?kind=brief', normBrief);
  const rep = useBrain('/api/day?kind=report', normReport);
  const c1 = useBrain('/api/cost?days=1', normCost);
  const c14 = useBrain('/api/cost?days=14', normCost);

  const owner = t.data ? ownerOf(t.data.ideas) : '';
  const g = now.data ? groupChats(now.data.chats) : null;
  const decide = br.data ? br.data.threads.filter(x => isDecision(x, owner)) : [];
  const days = c14.data ? Object.entries(c14.data.byDay).sort(([a], [b]) => a.localeCompare(b)) : [];
  const avg = days.length ? sum(days.map(([, v]) => v.usd)) / days.length : 0;
  const today = c1.data?.total ?? null;
  const ai = (t.data?.ideas.filter(i => i.chi === 'IA' && i.stato === 'aperta') ?? []).sort((a, b) => b.data.localeCompare(a.data));
  const waiting = (g?.wait.length ?? 0) + decide.length;

  const lead = g ? (
    <>
      {waiting ? <b>{g.wait.length ? `${g.wait.length} chat ti aspettano` : ''}{g.wait.length && decide.length ? ' e ' : ''}{decide.length ? `${decide.length} ${decide.length === 1 ? 'decisione' : 'decisioni'}` : ''}</b> : <b>Nessuno ti aspetta.</b>}
      {` · ${g.live.length} al lavoro`}
      {today != null && <> · oggi {fmt.usd(today)}{avg ? ` (media ${fmt.usd(avg)})` : ''}</>}
    </>
  ) : undefined;

  return (
    <>
      <PageHead title="Oggi" lead={lead} at={now.at} onRefresh={() => { now.reload(true); t.reload(); br.reload(true); rep.reload(true); c1.reload(); }}
        what="Il cervello in una pagina: chi ti aspetta, cosa è stato fatto, quanto costa e cosa propone l'IA. Tutto letto dai file, zero token." />

      <div className="bx-grid-4" data-testid="bx-home-tiles">
        <div className={`bx-tile ${waiting ? 'warn' : ''}`} data-testid="bx-tile-wait">
          <span className="bx-eyebrow">Ti aspettano</span>
          <Async loading={now.loading && !now.data} error={now.data ? null : now.error} onRetry={() => now.reload()} lines={2}>
            {() => (
              <>
                <span className="bx-big">{waiting}</span>
                {waiting ? (
                  <ul className="bx-list compact">
                    {g?.wait.slice(0, 3).map(c => <li key={c.id}><Pill tone="warn">{chatState(c).label}</Pill><span className="t bx-clip1">{chatName(c)}</span></li>)}
                    {decide.slice(0, Math.max(1, 4 - (g?.wait.length ?? 0))).map((d, i) => <li key={`d${i}`}><Pill tone="violet">decidi</Pill><span className="t bx-clip1">{d.label}</span></li>)}
                  </ul>
                ) : <p className="sub">Bel momento per partire con qualcosa di nuovo.</p>}
                <button type="button" className="bx-go" onClick={() => nav(decide.length && !g?.wait.length ? 'dafare' : 'adesso')}>{g?.wait.length ? 'Rispondi alle chat →' : 'Guarda il da fare →'}</button>
              </>
            )}
          </Async>
        </div>
        <div className="bx-tile" data-testid="bx-tile-live">
          <span className="bx-eyebrow">Al lavoro</span>
          <Async loading={now.loading && !now.data} error={now.data ? null : now.error} lines={2}>
            {() => (
              <>
                <span className="bx-big">{g?.live.length ?? 0}</span>
                {g?.live.length ? <ul className="bx-list compact">{g.live.slice(0, 4).map(c => <li key={c.id}><Harness name={c.harness} /><span className="t bx-clip1" title={c.last}>{chatName(c)}</span></li>)}</ul> : <p className="sub">Nessuna chat al lavoro adesso.</p>}
                <button type="button" className="bx-go" onClick={() => nav('adesso')}>Cosa stanno facendo →</button>
              </>
            )}
          </Async>
        </div>
        <div className="bx-tile" data-testid="bx-tile-cost">
          <span className="bx-eyebrow">Spesa di oggi</span>
          <Async loading={c1.loading && !c1.data} error={c1.data ? null : c1.error} onRetry={() => c1.reload()} lines={2} label="Calcolo i costi (fino a 20 s)…">
            {() => (
              <>
                <span className="bx-big">{fmt.usd(today)}</span>
                <p className="sub small">{avg ? `media ${fmt.usd(avg)} al giorno nelle ultime 2 settimane` : 'prezzi di listino, non una fattura'}</p>
                {days.length > 1 && <Sparkline values={days.map(([, v]) => v.usd)} labels={days.map(([d]) => fmt.day(d))} label={`Spesa degli ultimi ${days.length} giorni, oggi ${fmt.usd(today)}`} money />}
                <button type="button" className="bx-go" onClick={() => nav('costi')}>Dove va la spesa →</button>
              </>
            )}
          </Async>
        </div>
        <div className="bx-tile" data-testid="bx-tile-ai">
          <span className="bx-eyebrow">Spunti dell'IA</span>
          <Async loading={t.loading && !t.data} error={t.data ? null : t.error} onRetry={() => t.reload()} lines={2}>
            {() => (
              <>
                <span className="bx-big">{ai.length}</span>
                {ai[0] ? <p className="sub"><b>{short(ai[0].titolo, 90)}</b></p> : <p className="sub">Nessuno spunto aperto.</p>}
                {(t.data?.reflections.length ?? 0) > 0 && <p className="small muted">e {t.data?.reflections.length} {t.data?.reflections.length === 1 ? 'riflessione' : 'riflessioni'} dell'IA su di sé</p>}
                <button type="button" className="bx-go" onClick={() => nav('spunti')}>Leggili →</button>
              </>
            )}
          </Async>
        </div>
      </div>

      <div className="bx-grid-2" style={{ alignItems: 'start' }}>
        <section className="bx-card bx-section" aria-labelledby="bx-done-h" data-testid="bx-home-done">
          <div className="bx-section-head"><h2 id="bx-done-h">Fatto oggi</h2><span className="sp" /><button type="button" className="bx-go" onClick={() => nav('fatto')}>Tutto il fatto e il diario →</button></div>
          <Async loading={rep.loading && !rep.data} error={rep.data ? null : rep.error} onRetry={() => rep.reload()} label="Leggo DevOps e le chat (pochi secondi)…">
            {() => rep.data && (rep.data.rows.length ? <DoneView rep={rep.data} max={4} compact /> : <Empty title="Ancora niente di fatto oggi">Gli esiti (PR, bug, diario, chat) compaiono qui man mano.</Empty>)}
          </Async>
        </section>
        <div style={{ display: 'grid', gap: 14 }}>
          {t.data ? <Standup tables={t.data} owner={owner} /> : <Async loading={t.loading} error={t.error} onRetry={() => t.reload()}>{() => null}</Async>}
          <div className="bx-card bx-row" data-testid="bx-home-map">
            <IconMap />
            <div style={{ flex: 1, minWidth: 0 }}><b>Come funziona il cervello</b><p className="small muted">Le chat, gli agenti, la memoria e le regole in 3D, con i percorsi passo per passo.</p></div>
            <button type="button" className="bx-btn primary" onClick={() => nav('mappa')} data-testid="bx-open-map">Apri la mappa 3D</button>
          </div>
        </div>
      </div>
    </>
  );
}
