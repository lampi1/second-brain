// The Settings page (Impostazioni, Ctrl+, or the gear menu → "Tutte le impostazioni"): every switch the user may want,
// grouped, each with one line that says what it does, applied at once (the user, 2026-10-11: "vorrei più cose
// configurabili ad esempio dove sta l'abilitazione e disabilitazione del confronto tra modelli"). Groups: Aspetto
// (theme, density, view: the same prefs as the gear menu), Motori (each engine on/off and the one switch for chats
// across engines, ADR 0046: engineOn.*, engines.*, messaging.crossHarness), Chat (after how many minutes a finished chat closes by itself,
// autoCloseMin; the compaction window of the Claude chats and «Regie corte», ADR 0051; the load queue), Instradamento modelli (RoutingGroup.tsx: the routing table), Confronto tra modelli (the brain's A/B experiments, through the main
// process's 'compare:*' channels, which run the harness's own switch.mjs: the app never writes switch.json), Chat
// aperte dalla Regia (engine, model, effort of the chats the Regia opens; settings regiaChats.*,
// regiaOpacity, regiaEvents, runResults), Limiti di
// spesa (budget.*: warnings only), Notifiche (osToasts; do-not-disturb stays in the notification center), App (brain
// folder and MCP port, read only: changing them is a setup step, not a switch).
// Claude Code's own settings (~/.claude/settings.json: permissions, hooks) stay out by design (AGENTS.md rule 6).
// Rendered by App.tsx PageFrame for the 'impostazioni' place, inside the brain page frame (.bx classes).
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ANTHROPIC_API, type ApiSpendInfo, type BudgetLimits, type BudgetMode, type CompareExperiment, type CompareState, type CursorReasoning, type Effort, type EngineInfo, type Harness, type RegiaChatDefaults, type LanguageMode, type SecretsStatus, type ToastLevel } from '@shared/contract';
import { PageHead } from '../brain/components/States';
import { getAgent, autoLine, costLine, sideName, sidesLine } from '../lib/compare';
import { EFFORTS, effortLabel, formatCost } from '../lib/format';
import { modelOptions, useModelsSeen } from '../lib/models';
import { useEngines } from '../lib/engines';
import { parseUsd, portOf } from '../lib/settings-page';
import { errText } from '../actions';
import { setSetting, useApp } from '../store/store';
import { setPrefs, setView, toast, ui, type Density, type Theme } from '../store/ui';
import { questionsModalOn } from '../lib/questions';
import { RoutingGroup } from './RoutingGroup';
import { HelpTip } from './HelpTip';
import { t } from '../i18n';
import '../styles/settings.css';

/** An on/off switch (role switch, Space/Enter like a button). */
export function Switch({ on, onChange, label, busy, testid }: { on: boolean; onChange: (on: boolean) => void; label: string; busy?: boolean; testid?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} aria-busy={busy || undefined} className={`st-switch ${on ? 'on' : ''}`}
      onClick={() => { if (!busy) onChange(!on); }} data-testid={testid}>
      <span className="st-knob" aria-hidden="true" />
    </button>
  );
}

/** A choice among 2-4 values, as a segmented control: one tab stop, arrows move the choice (like radio buttons). */
function Choice<T extends string>({ value, options, onChange, label, testid }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; testid: string }) {
  const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    ev.preventDefault();
    const i = (options.findIndex(o => o.value === value) + step + options.length) % options.length;
    onChange(options[i]!.value);
    (ev.currentTarget.children[i] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className="st-seg" role="radiogroup" aria-label={label} data-testid={testid} onKeyDown={onKey}>
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)} data-testid={`${testid}-${o.value}`}>{o.label}</button>
      ))}
    </div>
  );
}

/** One setting: label and its one-line description on the left, the control on the right. */
function Row({ title, desc, control, children, testid, dim, help }: { title: ReactNode; desc?: ReactNode; control: ReactNode; children?: ReactNode; testid?: string; dim?: boolean; help?: ReactNode }) {
  return (
    <div className={`st-row ${dim ? 'dim' : ''}`} data-testid={testid}>
      <div className="st-text"><div className="st-title">{title}{help}</div>{desc && <div className="st-desc">{desc}</div>}{children}</div>
      <div className="st-ctl">{control}</div>
    </div>
  );
}

function Group({ title, desc, children, testid, help }: { title: string; desc?: ReactNode; children: ReactNode; testid: string; help?: ReactNode }) {
  return (
    <section className="st-group" aria-label={title} data-testid={testid}>
      <header><div className="st-group-h"><h2>{title}</h2>{help}</div>{desc && <p>{desc}</p>}</header>
      <div className="st-card">{children}</div>
    </section>
  );
}

// ── Confronto tra modelli ──
function Experiment({ e, busy, onSet }: { e: CompareExperiment; busy: string | null; onSet: (on: boolean, agent?: string) => void }) {
  const cost = costLine(e);
  return (
    <div className="st-exp" data-testid={`st-exp-${e.name}`}>
      <Row title={autoLine(e)} testid={`st-exp-row-${e.name}`}
        desc={<>Ogni volta che lavora un agente acceso qui sotto, <b>{sideName(e.b)}</b> fa lo stesso compito dentro l'app, in sola lettura; <b>{sideName(e.judge)}</b> giudica i due lavori alla cieca. Spento: nessun confronto parte, nessun costo.</>}
        control={<Switch on={e.on} busy={busy === e.name} onChange={on => onSet(on)} label={`${autoLine(e)}: ${e.on ? 'acceso' : 'spento'}`} testid={`st-exp-switch-${e.name}`} />}>
        <div className="st-meta" data-testid={`st-exp-cost-${e.name}`}>{cost ?? 'Nessun confronto ancora: il costo compare dal primo.'}{e.changedAt ? ` · ultimo cambio ${e.changedAt.slice(0, 16)}` : ''}</div>
        <div className="st-meta" data-testid={`st-exp-sides-${e.name}`}>{sidesLine(e)}</div>
        <div className="st-meta">Esperimento: {e.title}</div>
      </Row>
      {e.agents.length > 0 && (
        <div className="st-sub" role="group" aria-label={`Agenti di ${sideName(e.a)} confrontati`}>
          <div className="st-sub-head">Quali agenti di {sideName(e.a)}{!e.on && <span> · valgono solo con l'interruttore sopra acceso</span>}</div>
          {e.agents.map(a => (
            <Row key={a.name} dim={!e.on} title={<span className="mono">{a.name}</span>} desc={getAgent()[a.name] ? `Le esecuzioni di ${getAgent()[a.name]}.` : undefined} testid={`st-agent-${e.name}-${a.name}`}
              control={<Switch on={a.on} busy={busy === `${e.name}/${a.name}`} onChange={on => onSet(on, a.name)} label={`${a.name}: ${a.on ? 'confrontato' : 'non confrontato'}`} testid={`st-agent-switch-${e.name}-${a.name}`} />} />
          ))}
        </div>
      )}
    </div>
  );
}

function CompareGroup() {
  const [st, setSt] = useState<CompareState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    window.sb.invoke('compare:list', undefined).then(s => { if (alive) setSt(s); }, err => { if (alive) setSt({ ok: false, error: String(err) }); });
    return () => { alive = false; };
  }, []);
  const set = async (e: CompareExperiment, on: boolean, agent?: string) => {
    const key = agent ? `${e.name}/${agent}` : e.name;
    setBusy(key);
    // optimistic: the switch moves at once, the harness's answer replaces it (or puts it back on error)
    // (only this switch moves, so a failure puts back only this one, not a sibling switched meanwhile)
    const put = (v: boolean) => setSt(s => (s?.ok ? { ok: true, experiments: s.experiments.map(x => (x.name !== e.name ? x : agent ? { ...x, agents: x.agents.map(a => (a.name === agent ? { ...a, on: v } : a)) } : { ...x, on: v })) } : s));
    put(on);
    try {
      const r = await window.sb.invoke('compare:set', { experiment: e.name, on, ...(agent ? { agent } : {}) });
      if (r.ok) { setSt(r); toast(agent ? `${agent}: ${on ? 'confrontato' : 'non confrontato'}` : `${autoLine(e)}: ${on ? 'acceso' : 'spento'}`, 'ok'); }
      else { put(!on); toast(`Non cambiato: ${r.error}`, 'err'); }
    } catch (err) {
      put(!on);
      toast(`Non cambiato: ${String(err)}`, 'err');
    } finally { setBusy(null); }
  };
  return (
    <Group title="Confronto tra modelli" testid="st-group-compare"
      help={<HelpTip label="Confronto tra modelli" title="Alla cieca" testid="st-help-compare"
        example="il modello A trova 3 problemi, il modello B ne trova 5: il giudice dice quanti sono veri per ciascuno.">
        Un giudice legge i due risultati senza sapere quale modello li ha scritti, così il voto non dipende dal nome. Il lato B gira dentro l'app, nascosto e in sola lettura, su un motore che hai acceso tu. Ogni confronto spende i crediti di entrambi.
      </HelpTip>}
      desc="Lo stesso compito fatto da due modelli e giudicato alla cieca. Un lavoro viene confrontato solo se sono accesi sia l'interruttore principale sia il suo agente.">
      {!st ? <div className="st-row"><div className="st-desc">Leggo gli esperimenti…</div></div>
        : !st.ok ? <div className="st-row" data-testid="st-compare-error"><div className="st-text"><div className="st-title">Confronto non disponibile</div><div className="st-desc">{st.error}</div></div></div>
          : !st.experiments.length ? <div className="st-row"><div className="st-desc">Nessun esperimento nel cervello (harness/compare/experiments).</div></div>
            : st.experiments.map(e => <Experiment key={e.name} e={e} busy={busy} onSet={(on, agent) => void set(e, on, agent)} />)}
    </Group>
  );
}

// ── Chat aperte dalla Regia ──
/** Engine, model per engine and Claude effort the Regia's app_create_chat uses when she does not say, and where
 *  "Nuova chat" starts. Saved as settings (regiaChats.*): main reads them at each new chat, so a change applies at once. */
function RegiaChatsGroup() {
  const d = useApp(s => s.settings?.regiaChats);
  const list = useEngines();
  const off = useApp(s => s.settings?.engines?.[d?.harness ?? ''] !== true);
  const opacity = useApp(s => s.settings?.regiaOpacity ?? 100);
  const events = useApp(s => s.settings?.regiaEvents !== false);
  const results = useApp(s => s.settings?.runResults !== false);
  const qwin = useApp(questionsModalOn);
  const seen = useModelsSeen();
  if (!d) return null;
  const put = (p: Partial<RegiaChatDefaults>) => void setSetting({ regiaChats: p });
  const select = (value: string, options: { id: string; label: string }[], onChange: (v: string) => void, label: string, testid: string) => (
    <select className="st-select" value={value} onChange={e => onChange(e.target.value)} aria-label={label} data-testid={testid}>
      {options.map(o => <option key={o.id || 'default'} value={o.id}>{o.label}</option>)}
    </select>
  );
  const seenAt = seen?.cursor ? new Date(seen.cursor.at).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : null;
  return (
    <Group title="Chat aperte dalla Regia" testid="st-group-regia-chats"
      desc={'Con cosa la Regia apre le chat di lavoro quando non lo dice lei. Anche "Nuova chat" parte da qui. Vale dalla prossima chat.'}>
      <Row title="Motore" desc="Le chat di lavoro partono con questo motore e i suoi crediti." testid="st-rc-harness"
        control={<Choice<Harness> value={d.harness} onChange={h => put({ harness: h })} label="Motore delle chat aperte dalla Regia" testid="st-rc-harness-choice"
          options={list.filter(e => e.caps.tools).map(e => ({ value: e.id, label: e.label }))} />}>
        {off && <div className="st-meta" data-testid="st-rc-engine-off">{`«Le Regie possono usare ${list.find(e => e.id === d.harness)?.label ?? d.harness}» è spento in «Motori»: finché resta spento la Regia apre chat solo se sceglie lei un altro motore.`}</div>}
      </Row>
      <Row title="Modello Claude" desc="Per le chat Claude. Predefinito = quello di Claude Code." testid="st-rc-claude-model"
        control={select(d.claudeModel, modelOptions('claude', seen, d.claudeModel), v => put({ claudeModel: v }), 'Modello delle chat Claude', 'st-rc-claude-model-select')} />
      <Row title="Effort Claude" desc="Quanto ragiona Claude prima di rispondere: di più costa di più." testid="st-rc-claude-effort"
        help={<HelpTip label="Effort Claude" title="Effort = quanto pensa" example="basso per rinominare file o cercare un testo, alto per un bug difficile o un piano.">
          Più alto: Claude ragiona di più prima di rispondere, sbaglia meno sui lavori difficili ma è più lento e spende più token.
        </HelpTip>}
        control={select(d.claudeEffort, [{ id: '', label: 'Predefinito della CLI' }, ...EFFORTS.map(e => ({ id: e, label: effortLabel(e)! }))], v => put({ claudeEffort: v as Effort | '' }), 'Effort delle chat Claude', 'st-rc-claude-effort-select')} />
      <Row title="Modello Cursor" testid="st-rc-cursor-model"
        desc={seenAt ? `L'elenco è quello che la CLI di Cursor ha offerto all'ultima chat Cursor (${seenAt}).` : "Elenco provvisorio: quello vero arriva dalla CLI di Cursor alla prima chat Cursor."}
        control={select(d.cursorModel, modelOptions('cursor', seen, d.cursorModel), v => put({ cursorModel: v }), 'Modello delle chat Cursor', 'st-rc-cursor-model-select')} />
      <Row title="Ragionamento Cursor" desc="Per ogni chat Cursor, se il modello lo offre: di più costa di più. Le info della chat mostrano la variante vera." testid="st-rc-cursor-reasoning"
        control={select(d.cursorReasoning, [{ id: '', label: 'Predefinito del modello' }, { id: 'low', label: 'basso' }, { id: 'medium', label: 'medio' }, { id: 'high', label: 'alto' }, { id: 'xhigh', label: 'molto alto' }], v => put({ cursorReasoning: v as CursorReasoning | '' }), 'Ragionamento delle chat Cursor', 'st-rc-cursor-reasoning-select')} />
      <Row title="Fast Cursor" desc="Acceso: ogni chat Cursor usa la variante fast, se c'è (più veloce, consuma di più)." testid="st-rc-cursor-fast"
        control={<Switch on={d.cursorFast} onChange={on => put({ cursorFast: on })} label={`Fast per le chat Cursor: ${d.cursorFast ? 'acceso' : 'spento'}`} testid="st-rc-cursor-fast-switch" />} />
      <Row title="Opacità della Regia" testid="st-regia-opacity"
        desc="Quanto si vede il riquadro della Regia sopra le chat. Con il mouse sopra o mentre scrivi torna pieno."
        control={<label className="st-range"><input type="range" min={40} max={100} step={5} value={opacity} onChange={e => void setSetting({ regiaOpacity: Number(e.target.value) })} aria-label="Opacità della Regia" data-testid="st-regia-opacity-range" /><b>{opacity}%</b></label>} />
      <Row title="Eventi alla Regia" testid="st-regia-events"
        help={<HelpTip label="Eventi alla Regia" title="Perché accenderlo" example="una chat finisce i test: la Regia lo sa subito e ti propone il passo dopo.">
          La Regia sa cosa succede nelle chat senza che tu glielo dica. Costa token: ogni risveglio è un suo turno.
        </HelpTip>}
        desc="Acceso: quando una chat di lavoro finisce, si ferma su un errore, aspetta una tua risposta o ti lascia un comando, l'app lo scrive alla Regia e la sveglia se è ferma (al massimo una volta ogni 2 minuti per chat). Ogni risveglio è un turno della Regia."
        control={<Switch on={events} onChange={on => void setSetting({ regiaEvents: on })} label={`Eventi alla Regia: ${events ? 'accesi' : 'spenti'}`} testid="st-regia-events-switch" />} />
      <Row title="Esito dei comandi alla chat" testid="st-run-results"
        help={<HelpTip label="Esito dei comandi alla chat" title="«Esegui»">
          È il pulsante sotto i comandi che una chat ti propone: l'app lancia il comando per te. Con questo acceso la chat legge da sola com'è andata e va avanti.
        </HelpTip>}
        desc="Acceso: quando un comando lanciato con Esegui finisce, la chat che l'ha proposto riceve da sola l'exit code e le ultime righe dell'output (anche la Regia): non serve scriverle «fatto» né incollare il risultato. Ogni esito è un turno della chat."
        control={<Switch on={results} onChange={on => void setSetting({ runResults: on })} label={`Esito dei comandi alla chat: ${results ? 'acceso' : 'spento'}`} testid="st-run-results-switch" />} />
      <Row title="Domande in finestra" testid="st-qwin"
        help={<HelpTip label="Domande in finestra" testid="st-help-qwin">
          Per non perdere le domande: invece di cercarle tra i riquadri, arrivano davanti a tutto, una alla volta. Le chat restano ferme finché non rispondi, quindi prima rispondi, prima ripartono.
        </HelpTip>}
        desc="Acceso: ogni domanda e permesso compare in una finestra in primo piano, una alla volta, con il contesto e i link. Mentre scrivi aspetta che ti fermi e non ti prende la tastiera. Anche dal pulsante in alto."
        control={<Switch on={qwin} onChange={on => void setSetting({ questionsModal: on })} label={`Domande in finestra: ${qwin ? 'accese' : 'spente'}`} testid="st-qwin-switch" />} />
    </Group>
  );
}

// ── Motori ──
/** An engine's API key: typed once, then only its mask (main never sends a key back). Saved encrypted on this PC by
 *  main (engines/secrets.ts); the field is cleared as soon as it is sent. */
function KeyRow({ e, st, onStatus }: { e: EngineInfo; st: SecretsStatus; onStatus: (s: SecretsStatus) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const saved = st.keys[e.id];
  const run = async (p: Promise<SecretsStatus>, done: string) => {
    setBusy(true);
    try { onStatus(await p); toast(done, 'ok'); } catch (err) { toast(errText(err), 'err'); } finally { setBusy(false); }
  };
  const save = () => {
    const key = text.trim();
    setText('');
    if (key) void run(window.sb.invoke('secrets:set', { engine: e.id, key }), `Chiave di ${e.label} salvata`);
  };
  return (
    <Row title={`Chiave API di ${e.label}`} testid={`st-key-${e.id}`} dim={!st.available}
      desc={e.key === 'required'
        ? `Serve per usare ${e.label}. Va solo nelle sue richieste; resta cifrata su questo PC e nessuno la rivede, nemmeno tu.`
        : `Facoltativa: senza, ${e.label} usa il suo login. Resta cifrata su questo PC e va solo nel suo processo, dove il suo agente può leggerla come legge i suoi file di login.`}
      control={<span className="st-key">
        <input className="st-input" type="password" autoComplete="off" spellCheck={false} value={text} disabled={!st.available || busy}
          placeholder={saved ? 'sostituisci' : 'incolla la chiave'} aria-label={`Chiave API di ${e.label}`} data-testid={`st-key-${e.id}-input`}
          onChange={ev => setText(ev.target.value)} onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); save(); } }} />
        <button type="button" className="btn btn-ghost btn-s" disabled={!st.available || busy || !text.trim()} onClick={save} data-testid={`st-key-${e.id}-save`}>Salva</button>
        {saved && <button type="button" className="btn btn-ghost btn-s" disabled={busy} data-testid={`st-key-${e.id}-delete`}
          onClick={() => void run(window.sb.invoke('secrets:delete', { engine: e.id }), `Chiave di ${e.label} eliminata`)}>Elimina</button>}
      </span>}>
      {!st.available && <div className="st-meta" data-testid={`st-key-${e.id}-unavailable`}>{`Le chiavi non si possono salvare: ${st.why ?? 'cifratura non disponibile'}.`}</div>}
      {saved && <div className="st-meta" data-testid={`st-key-${e.id}-mask`}>{saved.stale
        ? `Salvata (${saved.mask}) ma non usata: il modo di avviare ${e.label} è cambiato dopo. Incollala di nuovo.`
        : `Salvata: ${saved.mask}`}</div>}
    </Row>
  );
}

/** An API engine's spend this month, as the app computed it at list prices (engines/spend.ts: the API shows spend only to
 *  an Admin key); for the Anthropic API also where the API credits of the user's Max plan come from (ADR 0052). */
function ApiSpendRow({ e, spend, live }: { e: EngineInfo; spend: ApiSpendInfo; live: boolean }) {
  const l = spend.engines[e.id];
  const [y, m] = spend.month.split('-').map(Number);
  const month = new Date(y!, (m ?? 1) - 1, 1).toLocaleString('it-IT', { month: 'long' });
  const figure = l ? `${formatCost(l.usd)} in ${l.calls} ${l.calls === 1 ? 'richiesta' : 'richieste'}${l.unpriced ? ` (${l.unpriced} senza prezzo nel cervello, non ${l.unpriced === 1 ? 'contata' : 'contate'})` : ''}` : 'niente finora';
  return (
    <Row title={`Spesa di ${month} su ${e.label}`} testid={`st-spend-${e.id}`} dim={!live}
      desc={`${figure}. Calcolata dall'app ai prezzi di listino: l'API mostra la spesa solo a una chiave Admin.`}
      control={<span className="st-meta" data-testid={`st-spend-${e.id}-usd`}>{formatCost(l?.usd ?? 0)}</span>}>
      {e.id === ANTHROPIC_API && <div className="st-meta" data-testid={`st-spend-${e.id}-credits`}>
        Crediti del piano Max: 100 $ al mese con Max 5x, 200 $ con Max 20x. Si riscattano nella Console Anthropic; non passano al mese dopo e non pagano Claude Code. {live ? 'Li usano il giudice dei lavori e le righe Scrittura «sui crediti API».' : 'Li useranno il giudice dei lavori e le righe Scrittura «sui crediti API» quando Anthropic API è acceso e ha la chiave.'}
      </div>}
    </Row>
  );
}

/** Each engine on or off (with how it starts), its API key when it takes one, whether the Regie may use it, and the one
 *  switch for chats across engines (ADR 0046). Protected settings: an agent can only propose them. An engine that is
 *  not built in counts as on only while it starts as it did when the user turned it on (main's trust): if its
 *  definition changed, the switch shows it off and turning it on again trusts the new one. */
function EnginesGroup() {
  const list = useEngines();
  const on = useApp(s => s.settings?.engineOn);
  const regie = useApp(s => s.settings?.engines);
  const cross = useApp(s => s.settings?.messaging?.crossHarness);
  const rulesClaude = useApp(s => s.settings?.launchRulesClaude === true);
  const rulesCodex = useApp(s => s.settings?.launchRulesCodex !== false);
  const [keys, setKeys] = useState<SecretsStatus | null>(null);
  const [spend, setSpend] = useState<ApiSpendInfo | null>(null);
  useEffect(() => {
    let alive = true;
    window.sb.invoke('secrets:status', undefined).then(s => { if (alive) setKeys(s); }, err => toast(errText(err), 'err'));
    const read = () => window.sb.invoke('engines:spend', undefined).then(s => { if (alive) setSpend(s); }, err => toast(errText(err), 'err'));
    void read();
    // the judge or a chat may spend while the page is open: read again when the window comes back
    window.addEventListener('focus', read);
    return () => { alive = false; window.removeEventListener('focus', read); };
  }, [list]);
  if (!on || !regie || cross === undefined) return null;
  const turn = (e: EngineInfo, v: boolean) => {
    if (v && !e.trusted) window.sb.invoke('engines:trust', { engine: e.id }).catch(err => toast(errText(err), 'err'));
    else void setSetting({ engineOn: { [e.id]: v } });
  };
  return (
    <Group title="Motori" testid="st-group-engines" desc="Con quali CLI o API girano le chat, le loro chiavi, e cosa possono farne le Regie.">
      {list.map(e => {
        const live = on[e.id] === true && e.trusted;
        return [
          <Row key={e.id} title={`${e.name} acceso`} testid={`st-engine-on-${e.id}`}
            desc={`Spento: nessuna chat parte su ${e.label}, né quelle che apri tu né quelle delle Regie; si spegne anche «Le Regie possono usare ${e.label}».`}
            control={<Switch on={live} onChange={v => turn(e, v)} label={`${e.label}: ${live ? 'acceso' : 'spento'}`} testid={`st-engine-on-${e.id}-switch`} />}>
            <div className="st-meta" data-testid={`st-engine-on-${e.id}-runs`}>{`Avvio: ${e.runs}${e.source === 'brain' ? ' · dal brain (harness/models.json)' : ''}`}</div>
            {on[e.id] === true && !e.trusted && <div className="st-meta" data-testid={`st-engine-on-${e.id}-changed`}>{`Non parte: il modo di avviarlo è cambiato da quando l'hai acceso. Riaccendilo se l'avvio qui sopra va bene.`}</div>}
          </Row>,
          e.key !== 'none' && keys && <KeyRow key={`${e.id}-key`} e={e} st={keys} onStatus={setKeys} />,
          e.kind === 'api' && spend && <ApiSpendRow key={`${e.id}-spend`} e={e} spend={spend} live={live && !!keys?.keys[e.id]} />,
        ];
      })}
      {list.map(e => (
        <Row key={e.id} dim={on[e.id] !== true || !e.trusted} title={`Le Regie possono usare ${e.label}`} testid={`st-engine-${e.id}`}
          desc={`Spento: nessuna Regia apre o riprende chat su ${e.label}; tu sì, da Nuova chat.`}
          control={<Switch on={regie[e.id] === true} onChange={v => void setSetting({ engines: { [e.id]: v } })} label={`Le Regie possono usare ${e.label}: ${regie[e.id] === true ? 'sì' : 'no'}`} testid={`st-engine-${e.id}-switch`} />} />
      ))}
      <Row title="Chat tra motori diversi" testid="st-cross"
        help={<HelpTip label="Chat tra motori diversi" title="Chi spende i crediti">
          Una Regia su un motore può aprire, riprendere o scrivere a chat su un altro, che lavorano con i crediti di quel motore. Spegnilo se vuoi che ogni chat resti sul proprio.
        </HelpTip>}
        desc="Una chat o una Regia può aprire, riprendere o scrivere a chat su un altro motore. Spento: solo sul proprio; le tue chat da Nuova chat restano libere. Vale anche per la posta tra chat fuori dall'app."
        control={<Switch on={cross} onChange={v => void setSetting({ messaging: { crossHarness: v } })} label={`Chat tra motori diversi: ${cross ? 'accese' : 'spente'}`} testid="st-cross-switch" />} />
      <Row title="Regole del cervello alle chat Claude" testid="st-rules-claude"
        desc="A ogni avvio di una chat Claude l’app le passa le regole del cervello (AGENTS.md, skill, agenti, stili e hook) come plugin. Spento: Claude legge solo le sue impostazioni. Vale dal prossimo avvio di ogni chat."
        control={<Switch on={rulesClaude} onChange={v => void setSetting({ launchRulesClaude: v })} label={`Regole del cervello alle chat Claude: ${rulesClaude ? 'sì' : 'no'}`} testid="st-rules-claude-switch" />} />
      <Row title="Regole del cervello alle chat Codex" testid="st-rules-codex"
        desc="A ogni avvio di una chat Codex l’app le passa le regole del cervello (AGENTS.md come istruzioni e le cartelle delle skill). Spento: Codex legge solo le sue impostazioni. Vale dal prossimo avvio di ogni chat."
        control={<Switch on={rulesCodex} onChange={v => void setSetting({ launchRulesCodex: v })} label={`Regole del cervello alle chat Codex: ${rulesCodex ? 'sì' : 'no'}`} testid="st-rules-codex-switch" />} />
    </Group>
  );
}

// ── Limiti di spesa ──
/** A $ amount saved on Enter or when leaving the field; empty = no limit. A wrong value is put back (lib parseUsd). */
function UsdInput({ value, onSave, label, testid }: { value: number | null; onSave: (v: number | null) => void; label: string; testid: string }) {
  const shown = value === null ? '' : String(value).replace('.', ',');
  const [text, setText] = useState(shown);
  useEffect(() => { setText(shown); }, [shown]);
  const commit = () => {
    const v = parseUsd(text);
    if (v === 'bad') { setText(shown); toast(`${label}: un importo in $ da 0,01 a 1000000 (al massimo 2 decimali, senza punti delle migliaia), oppure vuoto`, 'err'); return; }
    if (v !== value) onSave(v);
  };
  return (
    <span className="st-usd">
      <input className="st-input" inputMode="decimal" value={text} placeholder="nessuno" aria-label={label} data-testid={testid}
        onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
      <span aria-hidden="true">$</span>
    </span>
  );
}

// 'ask' ("chiedi se continuare") is not offered: nothing turns its alert into a question yet (it warns like 'warn').
// A saved 'ask' still shows, named for what it does today.
const modes = (now: BudgetMode): { value: BudgetMode; label: string }[] =>
  [{ value: 'warn', label: 'Avvisa' }, ...(now === 'ask' ? [{ value: 'ask' as const, label: 'Chiedi (per ora avvisa)' }] : []), { value: 'off', label: 'Spento' }];

function BudgetGroup() {
  const b = useApp(s => s.settings?.budget);
  if (!b) return null;
  const engine = (h: 'claude' | 'cursor') => {
    const l = b[h], name = h === 'claude' ? 'Claude' : 'Cursor';
    const put = (p: Partial<BudgetLimits>) => void setSetting({ budget: { [h]: p } });
    return (
      <div className="st-sub" role="group" aria-label={`Limiti ${name}`} data-testid={`st-budget-${h}`}>
        <div className="st-sub-head">{name}{!b.enabled && <span> · valgono solo con l'interruttore sopra acceso</span>}</div>
        <Row dim={!b.enabled} title="Avvisi"
          help={h === 'claude' ? <HelpTip label="Avvisi Claude" title="Finestra di 5 ore e limite settimanale">
            Il piano di Claude ha un tetto di uso che si azzera ogni 5 ore e uno settimanale. L'app avvisa quando ti avvicini anche a quelli, non solo ai tuoi limiti in dollari.
          </HelpTip> : undefined}
          desc={h === 'claude'
            ? "Notifica all'80% e al 100% dei limiti qui sotto e anche della finestra di 5 ore e del limite settimanale del piano. Spento: nessun avviso Claude. Non ferma mai niente da solo."
            : "Notifica all'80% e al 100% del limite qui sotto. Spento: nessun avviso Cursor. Non ferma mai niente da solo."}
          control={<Choice<BudgetMode> value={l.mode} onChange={m => put({ mode: m })} label={`Avvisi ${name}`} testid={`st-budget-${h}-mode`} options={modes(l.mode)} />} />
        <Row dim={!b.enabled || l.mode === 'off'} title="Al giorno"
          desc={h === 'claude' ? 'A prezzo di listino API (su abbonamento è un costo equivalente). Vuoto = nessun limite.' : "Costo reale dall'export di Cursor: se l'export non copre oggi, non avvisa. Vuoto = nessun limite."}
          help={h === 'claude' ? <HelpTip label="Prezzo di listino API">
            Con l'abbonamento non paghi a consumo: l'app calcola quanto costerebbero gli stessi token ai prezzi pubblici delle API. Serve a confrontare chat e giorni, non è una fattura.
          </HelpTip> : undefined}
          control={<UsdInput value={l.dailyUsd} onSave={v => put({ dailyUsd: v })} label={`Limite ${name} al giorno`} testid={`st-budget-${h}-daily`} />} />
        {h === 'claude' && (
          <Row dim={!b.enabled || l.mode === 'off'} title="Per chat, al giorno" desc="Quanto una sola chat spende oggi. Vuoto = nessun limite."
            control={<UsdInput value={l.perChatUsd} onSave={v => put({ perChatUsd: v })} label={`Limite ${name} per chat`} testid={`st-budget-${h}-chat`} />} />
        )}
      </div>
    );
  };
  return (
    <Group title="Limiti di spesa" testid="st-group-budget" desc="Avvisi quando la spesa si avvicina a un limite. Non fermano mai una chat da soli.">
      <Row title="Avvisi di spesa" desc="Interruttore generale degli avvisi (all'80% e al 100% di ogni limite)." testid="st-budget-enabled"
        help={<HelpTip label="Avvisi di spesa" title="Soglie 80% e 100%" example="limite di 10 $ al giorno: un avviso a 8 $, un altro a 10 $.">
          Per ogni limite arriva un avviso quando la spesa ne tocca l'80% e un altro al 100%. Sono solo avvisi: nessuna chat viene fermata.
        </HelpTip>}
        control={<Switch on={b.enabled} onChange={on => void setSetting({ budget: { enabled: on } })} label={`Avvisi di spesa: ${b.enabled ? 'accesi' : 'spenti'}`} testid="st-budget-enabled-switch" />} />
      {engine('claude')}
      {engine('cursor')}
    </Group>
  );
}

// ── Notifiche · App ──
function NotifyGroup() {
  const level = useApp(s => s.settings?.osToasts);
  if (!level) return null;
  return (
    <Group title="Notifiche" testid="st-group-notify" desc={'Tutto resta sempre nel centro notifiche. "Non disturbare" è nel centro notifiche (campanella).'}>
      <Row title="Notifiche di sistema" desc="Solo le urgenti (una chat ti aspetta), anche le normali, o nessuna." testid="st-toasts"
        control={<Choice<ToastLevel> value={level} onChange={v => void setSetting({ osToasts: v })} label="Notifiche di sistema" testid="st-toasts-choice"
          options={[{ value: 'urgent', label: 'Solo urgenti' }, { value: 'normal', label: 'Anche normali' }, { value: 'off', label: 'Nessuna' }]} />} />
    </Group>
  );
}

function AppInfoGroup() {
  const s = useApp(x => x.settings);
  const port = useApp(x => portOf(x.info?.mcpUrl));
  if (!s) return null;
  const locked = (k: 'brainRoot' | 'mcpPort') => (s.locked?.includes(k) ? ' Ora la fissa una variabile d’ambiente.' : '');
  return (
    <Group title="App" testid="st-group-app">
      <Row title="Cartella del cervello" testid="st-brain-root" desc={`L'app ne esegue gli strumenti: per questo qui si legge soltanto.${locked('brainRoot')}`}
        control={<span className="st-value mono" title={s.brainRoot ?? ''}>{s.brainRoot ?? 'non collegata'}</span>} />
      <Row title="Porta MCP" testid="st-mcp-port" desc="Solo 127.0.0.1: qui gli agenti guidano il browser interno e l'app. È la porta in uso adesso."
        help={<HelpTip label="Porta MCP" title="MCP">
          Il modo in cui un agente usa strumenti esterni. Su questa porta, raggiungibile solo da questo PC, le chat aprono pagine nel browser interno, leggono lo stato dell'app e fanno screenshot.
        </HelpTip>}
        control={<span className="st-value mono">{port ?? 'non ancora aperta'}</span>} />
    </Group>
  );
}

/** "Migliora l'app" (ADR 0020): its own group, so the "App" group above stays read only */
function ImproveGroup() {
  const repo = useApp(x => x.settings?.appRepo ?? '');
  return (
    <Group title="Migliora l'app" testid="st-group-improve">
      <Row title="Cartella del codice dell'app" testid="st-app-repo"
        desc="Dove «Migliora l'app» lavora e da dove «Aggiorna» prende la versione nuova (una cartella git). Vuota = quella da cui è stata fatta la versione in uso."
        control={<AppRepoInput value={repo} />} />
    </Group>
  );
}

function AppRepoInput({ value }: { value: string }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const save = () => { const v = text.trim(); if (v !== value) void setSetting({ appRepo: v || null }); };
  return (
    <span className="st-inline">
      <input className="st-input st-path mono" value={text} placeholder="quella della versione in uso" aria-label="Cartella del codice dell'app" data-testid="st-app-repo-input"
        onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} />
      <button type="button" className="btn btn-ghost btn-s" onClick={save} disabled={text.trim() === value} data-testid="st-app-repo-save">Salva</button>
    </span>
  );
}

/** The delays offered, plus the stored one when it is another (set in the file or by an agent: still shown, selected). */
const closeDelays = (cur: number) => [...new Set([2, 5, 10, 30, ...(cur > 0 ? [cur] : [])])].sort((a, b) => a - b);
/** The compaction windows offered (tokens), plus the stored one when it is another. */
const compactWindows = (cur: number) => [...new Set([150_000, 200_000, 300_000, 500_000, ...(cur > 0 ? [cur] : [])])].sort((a, b) => a - b);

export function SettingsPage() {
  const theme = ui.use(s => s.prefs.theme);
  const density = ui.use(s => s.prefs.density);
  const view = ui.use(s => s.prefs.view);
  const closeMin = useApp(s => s.settings?.autoCloseMin ?? 2);
  const lq = useApp(s => s.settings?.loadQueue ?? true);
  const lqCpu = useApp(s => s.settings?.loadQueueCpu ?? 75);
  const lqRam = useApp(s => s.settings?.loadQueueRam ?? 15);
  const compactAt = useApp(s => s.settings?.compactWindowTokens ?? 200_000);
  const regiaDay = useApp(s => s.settings?.regiaDayCompact !== false);
  const language = useApp(s => s.settings?.language ?? 'system');
  return (
    <div className="st-page" data-testid="settings-page">
      <PageHead title="Impostazioni" lead="Come lavora l'app. Ogni modifica vale subito e resta salvata." />
      <CompareGroup />
      <EnginesGroup />
      <RegiaChatsGroup />
      <RoutingGroup />
      <Group title="Chat" testid="st-group-chat">
        <Row title="Chiudi le chat finite dopo" testid="st-autoclose"
          desc="Una chat che ha finito bene e che non tocchi si chiude da sola; la ritrovi con Ctrl+K e la riapri con Invio. Mai chiuse: la Regia, le chat con una domanda, un comando o un browser che ti aspetta."
          control={<Choice<string> value={String(closeMin)} onChange={v => void setSetting({ autoCloseMin: Number(v) })} label="Chiudi le chat finite dopo" testid="st-autoclose-choice"
            options={[...closeDelays(closeMin).map(m => ({ value: String(m), label: `${m} min` })), { value: '0', label: 'Mai' }]} />} />
        <Row title="Compatta le chat Claude a" testid="st-compact"
          desc="Sopra questa dimensione del contesto una chat Claude dell’app, Regia compresa, riassume da sola la sua storia e va avanti dal riassunto, nella stessa chat. Ogni passo rilegge tutto il contesto: a 400k costa il doppio che a 200k. Vale dal prossimo avvio del motore di ogni chat."
          control={<Choice<string> value={String(compactAt)} onChange={v => void setSetting({ compactWindowTokens: Number(v) })} label="Compatta le chat Claude a" testid="st-compact-choice"
            options={[...compactWindows(compactAt).map(n => ({ value: String(n), label: `${Math.round(n / 1000)}k` })), { value: '0', label: 'Impostazioni di Claude' }]} />} />
        <Row title="Regie corte" testid="st-regia-day"
          desc="La prima volta che una Regia è ferma in un giorno nuovo, se il suo contesto è di ieri ed è di 50k o più lo riassume. Resta la stessa chat: la coda e le chat che segue non cambiano."
          control={<Switch on={regiaDay} onChange={on => void setSetting({ regiaDayCompact: on })} label={`Regie corte: ${regiaDay ? 'accese' : 'spente'}`} testid="st-regia-day-switch" />} />
        <Row title="Coda per carico" testid="st-load-queue"
          desc="Con il PC sotto sforzo, le chat e i messaggi aperti dalla Regia o da altre chat aspettano in coda e partono uno alla volta quando il carico scende. I tuoi messaggi partono sempre subito; niente viene fermato."
          control={<Switch on={lq} onChange={on => void setSetting({ loadQueue: on })} label={`Coda per carico: ${lq ? 'accesa' : 'spenta'}`} testid="st-load-queue-switch" />} />
        <Row title="Coda: CPU oltre" testid="st-load-queue-cpu" dim={!lq}
          desc="Sopra questa CPU (media degli ultimi secondi) le chat e i messaggi degli agenti aspettano."
          control={<label className="st-range"><input type="range" min={30} max={100} step={5} value={lqCpu} disabled={!lq} onChange={e => void setSetting({ loadQueueCpu: Number(e.target.value) })} aria-label="Coda per carico: CPU oltre" data-testid="st-load-queue-cpu-range" /><b>{lqCpu}%</b></label>} />
        <Row title="Coda: RAM libera sotto" testid="st-load-queue-ram" dim={!lq}
          desc="Sotto questa memoria libera le chat e i messaggi degli agenti aspettano. 0% = non guardare la RAM."
          control={<label className="st-range"><input type="range" min={0} max={90} step={5} value={lqRam} disabled={!lq} onChange={e => void setSetting({ loadQueueRam: Number(e.target.value) })} aria-label="Coda per carico: RAM libera sotto" data-testid="st-load-queue-ram-range" /><b>{lqRam}%</b></label>} />
      </Group>
      <BudgetGroup />
      <NotifyGroup />
      <Group title="Aspetto" testid="st-group-look">
        <Row title="Tema" desc="Scuro, chiaro o come il sistema." testid="st-theme"
          control={<Choice<Theme> value={theme} onChange={t => setPrefs({ theme: t })} label="Tema" testid="st-theme-choice"
            options={[{ value: 'dark', label: 'Scuro' }, { value: 'light', label: 'Chiaro' }, { value: 'system', label: 'Come il sistema' }]} />} />
        <Row title={t('settings.language')} desc={t('settings.languageDesc')} testid="st-language"
          control={<Choice<LanguageMode> value={language} onChange={l => void setSetting({ language: l })} label={t('settings.language')} testid="st-language-choice"
            options={(['system', 'it', 'en'] as const).map(l => ({ value: l, label: t(`settings.language.${l}`) }))} />} />
        <Row title="Densità" desc="Compatta mostra più righe nello stesso spazio." testid="st-density"
          control={<Choice<Density> value={density} onChange={d => setPrefs({ density: d })} label="Densità" testid="st-density-choice"
            options={[{ value: 'comfortable', label: 'Comoda' }, { value: 'compact', label: 'Compatta' }]} />} />
        <Row title="Vista delle chat" desc="Mosaico: le chat come riquadri. Corsie: in colonne per stato." testid="st-view"
          control={<Choice value={view} onChange={setView} label="Vista" testid="st-view-choice"
            options={[{ value: 'mosaico', label: 'Mosaico' }, { value: 'corsie', label: 'Corsie' }]} />} />
      </Group>
      <ImproveGroup />
      <AppInfoGroup />
      <p className="st-foot">I permessi e gli hook di Claude Code restano nelle sue impostazioni: l'app non li cambia.</p>
    </div>
  );
}
