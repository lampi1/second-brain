// "Nuova chat" (Ctrl+N): engine (every engine of the registry, lib/engines.ts, with its CLI's status), folder (recent
// folders suggested), model, effort, permission mode and separate worktree (each only on an engine that has it), title,
// the first message, "È la Regia" (several Regie, ADR 0021: with a Regia already there the new one needs a tab name and
// sits next to the others; the overlay's + opens this dialog as "Nuova Regia"). A work chat answers to the Regia of the
// tab open now (regiaOf). Engine, model and effort come from the routing table (chat:createRouted, ADR 0032: the
// user, 2026-10-14, the app spent twice what it did before, «Nuova chat passa dalla tabella dei modelli»): the kind
// read from title and prompt, shown in one line under the engines (routing:preview) and in the fields; what the user
// picks by hand there beats the row (an override); no row = the settings' "Chat aperte dalla Regia". Folder and
// permissions from the last choices; Ctrl+Enter creates; the new chat's input gets the focus. The CLI status comes from
// app:info, or is asked on open while the check at start has not reported ("non verificato" when nothing answers).
// Used by App.tsx.
import { useEffect, useMemo, useState } from 'react';
import type { CliStatus, Effort, Harness, PermissionMode, RoutedNewChat, RoutePreview } from '@shared/contract';
import { EFFORTS, effortLabel, PERMISSION_MODES, permissionLabel } from '../lib/format';
import { engineCan, engineLabel, useEngines } from '../lib/engines';
import { routeLine } from '../lib/routing';
import { modelOptions, useModelsSeen } from '../lib/models';
import { cliFetch, createRoutedChat, useApp } from '../store/store';
import { sb } from '../sb';
import { closeModal, setPrefs, setRegiaTab, ui } from '../store/ui';
import { focusChat, regiaId } from '../actions';
import { cleanRegiaName } from '@shared/regia';
import { HarnessMark } from './Icons';
import { Keys, Modal } from './ui';

export function NewChatDialog() {
  const last = ui.use(s => s.prefs.newChat);
  const info = useApp(s => s.info);
  const current = useApp(s => { const id = s.order.find(x => s.chats[x]?.isRegia); return id ? s.chats[id] ?? null : null; });
  const hasRegia = !!current;
  const asRegia = ui.use(s => s.newChatRegia);
  const recent = useApp(s => [...new Set(s.order.map(id => s.chats[id]?.cwd).filter((x): x is string => !!x))].slice(0, 8), (a, b) => a.join('|') === b.join('|'));
  // engine, model and effort start from "Chat aperte dalla Regia" (Settings page), the same defaults app_create_chat uses
  const def = useApp(s => s.settings?.regiaChats);
  const modelOf = (h: Harness) => (def && (h === 'claude' || h === 'cursor') ? (h === 'cursor' ? def.cursorModel : def.claudeModel) : last.harness === h ? last.model : '');
  const harness0: Harness = def?.harness ?? last.harness;
  const effort0: Effort | '' = def ? def.claudeEffort : last.effort;
  // every chat starts in the brain folder (the user, 2026-10-11: «non voglio sbattermi a scegliere la cartella giusta»):
  // the AI picks the repo or worktree from the task; another folder only under Avanzate
  const [cwd, setCwd] = useState(info?.brainRoot || last.cwd || recent[0] || '');
  // what the user picked by hand (undefined = the table decides): it beats the row
  const [pick, setPick] = useState<{ harness?: Harness; model?: string; effort?: Effort }>({});
  const [preview, setPreview] = useState<RoutePreview | null>(null);
  const [perm, setPerm] = useState<PermissionMode | ''>(last.permissionMode);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [regia, setRegia] = useState(asRegia || !hasRegia);
  const [regiaName, setRegiaName] = useState('');
  const [worktree, setWorktree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const engines = useEngines();
  const ok = preview && !('error' in preview) ? preview : null;
  // the fields show what will start: the user's pick, else the table's (preview), else the defaults
  const harness: Harness = pick.harness ?? ok?.harness ?? harness0;
  const model = pick.model ?? (ok && ok.harness === harness ? ok.model ?? '' : modelOf(harness));
  const effort: Effort | '' = pick.effort ?? (ok && ok.harness === harness ? ok.effort ?? '' : effort0);
  const can = { effort: engineCan(harness, 'effort'), perm: engineCan(harness, 'permissionMode'), worktree: engineCan(harness, 'worktree') };
  const seen = useModelsSeen();
  // the empty option is "automatico" here: picking it gives the choice back to the table
  const models = useMemo(() => modelOptions(harness, seen, model).map(m => m.id ? m : { ...m, label: 'automatico' }), [harness, seen, model]);

  const name = cleanRegiaName(regiaName);
  const request = (): RoutedNewChat => {
    const h = pick.harness ?? harness0;
    const asked = { ...(pick.harness ? { harness: pick.harness } : {}), ...(pick.model ? { model: pick.model } : {}), ...(pick.effort && engineCan(harness, 'effort') ? { effort: pick.effort } : {}) };
    return {
      title: title.trim(), cwd: cwd.trim(), prompt: prompt.trim() || undefined,
      ...(Object.keys(asked).length ? { ask: { ...asked, reason: 'scelta dell’utente (Nuova chat)' } } : {}),
      defaults: { harness: h, ...(modelOf(h) ? { model: modelOf(h) } : {}), ...(effort0 && engineCan(h, 'effort') ? { effort: effort0 } : {}) },
      ...(regia ? { regia: true, ...(name ? { regiaName: name } : {}) } : regiaId() ? { regiaOf: regiaId()! } : {}),
    };
  };
  // the table’s choice while the user types (no tokens, in main): one line and the fields follow it; `key` holds what
  // the route depends on (the tab name does not change it)
  const key = JSON.stringify([title.trim(), prompt.trim().slice(0, 2000), pick, regia, harness0, effort0, def?.claudeModel, def?.cursorModel]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => { void sb.invoke('routing:preview', request()).then(p => { if (live) setPreview(p); }, () => { if (live) setPreview(null); }); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [key]);
  const line = routeLine(preview, engineLabel);

  const create = async () => {
    if (!cwd.trim()) { setError('Scegli la cartella in cui lavora la chat.'); return; }
    if (!regia && !prompt.trim()) { setError('Scrivi cosa deve fare la chat.'); return; }
    if (line?.error) { setError(`La chat non parte: ${line.why}. Scegli un altro motore o modello.`); return; }
    if (regia && hasRegia && !name) { setError('Dai un nome alla nuova Regia (es. App): è il nome della sua tab.'); return; }
    setBusy(true);
    setPrefs({ newChat: { harness, cwd: cwd.trim(), model, effort, permissionMode: perm } });
    const c = await createRoutedChat({
      ...request(), permissionMode: can.perm && perm ? perm : undefined, worktree: can.worktree && worktree ? true : undefined,
    });
    setBusy(false);
    if (c) { closeModal(); if (c.isRegia) setRegiaTab(c.id); requestAnimationFrame(() => focusChat(c.id)); }
    else setError('La chat non è partita: il motivo è nell\'avviso in basso a sinistra.');
  };

  // each CLI shows as soon as it answers; missing = still asking, null = no answer in time
  const [asked, setAsked] = useState<Partial<Record<Harness, CliStatus | null>>>({});
  const known = !!info?.cli;
  useEffect(() => {
    if (known) return;
    let live = true;
    for (const { id: h } of engines) void cliFetch(h).then(st => { if (live) setAsked(a => ({ ...a, [h]: st })); });
    return () => { live = false; };
  }, [known, engines]);
  const on = useApp(s => s.settings?.engineOn);
  const status = (h: Harness) => {
    if (on && on[h] !== true) return 'spento nelle impostazioni';
    const st = info?.cli?.[h] ?? asked[h];
    if (st === undefined) return 'controllo…';
    if (st === null) return 'non verificato';
    if (!st.found) return 'CLI non trovata';
    return st.loggedIn === false ? 'accesso da fare' : (st.version ?? 'pronta');
  };

  return (
    <Modal onClose={closeModal} label={asRegia ? 'Nuova Regia' : 'Nuova chat'} testid="newchat" className="modal-newchat">
      <form onSubmit={e => { e.preventDefault(); void create(); }} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void create(); } }}>
        <div className="modal-head"><h2>{asRegia ? 'Nuova Regia' : 'Nuova chat'}</h2><span className="sp" /><Keys combo="Ctrl+Invio" /><span className="modal-head-hint">crea</span></div>
        <div className="modal-body">
          <label className="field">
            <span>{regia ? <>Primo messaggio <small>facoltativo</small></> : 'Cosa deve fare?'}</span>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={regia ? 2 : 4} placeholder={regia ? 'Es. «che si fa adesso?»' : 'Scrivi il lavoro: la chat parte dalla cartella del cervello e sceglie da sola repo e worktree'} data-testid="newchat-prompt" autoFocus={!(regia && hasRegia)} />
          </label>
          {regia && hasRegia && (
            <label className="field">
              <span>Nome della Regia <small>il nome della sua tab, es. App</small></span>
              <input value={regiaName} onChange={e => { setRegiaName(e.target.value); setError(null); }} maxLength={30} placeholder="App" data-testid="newchat-regia-name" autoFocus aria-invalid={!!error && !cleanRegiaName(regiaName)} />
            </label>
          )}
          <div className="harness-pick" role="radiogroup" aria-label="Harness">
            {engines.map(({ id: h, name }) => (
              <button key={h} type="button" role="radio" aria-checked={harness === h} className={`harness-card ${harness === h ? 'on' : ''}`} data-testid={`newchat-harness-${h}`}
                onClick={() => { if (h !== harness) setPick({ harness: h }); }}>
                <HarnessMark harness={h} size={28} />
                <span><b>{name}</b><small>{status(h)}</small></span>
              </button>
            ))}
          </div>
          {/* one row always (empty until the first preview): typing never moves the fields below; the whole why in its title */}
          <p className={`route-line${line?.error ? ' err' : ''}`} data-testid="newchat-route" aria-live={line?.error ? 'polite' : undefined}>
            {line && <span className="route-text" title={`${line.what} — ${line.why}`}><b>{line.what}</b> — {line.why}</span>}
            {line && (pick.harness || pick.model || pick.effort) && <button type="button" className="link-btn" onClick={() => setPick({})} data-testid="newchat-route-reset">torna automatico</button>}
          </p>
          <details className="advanced" data-testid="newchat-advanced" open={asRegia || undefined}>
          <summary>Avanzate <small>cartella, modello, permessi, titolo</small></summary>
          <label className="field">
            <span>Cartella <small>di base la cartella del cervello</small></span>
            <input value={cwd} onChange={e => { setCwd(e.target.value); setError(null); }} list="sb-recent-cwd" placeholder="C:\percorso\del\progetto" data-testid="newchat-cwd" aria-invalid={!!error && !cwd.trim()} />
            <datalist id="sb-recent-cwd">{recent.map(r => <option key={r} value={r} />)}</datalist>
          </label>
          <div className="field-row">
            <label className="field">
              <span>Modello</span>
              <select value={model} onChange={e => setPick(p => ({ ...p, model: e.target.value || undefined }))} data-testid="newchat-model">
                {models.map(m => <option key={m.id || 'default'} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            {can.perm && (
              <label className="field">
                <span>Permessi</span>
                <select value={perm} onChange={e => setPerm(e.target.value as PermissionMode | '')} data-testid="newchat-perm">
                  <option value="">Come da impostazioni</option>
                  {PERMISSION_MODES.map(p => <option key={p} value={p}>{permissionLabel(p)}</option>)}
                </select>
              </label>
            )}
          </div>
          {can.effort && (
            <div className="field">
              <span>Ragionamento</span>
              <div className="segmented wide" role="radiogroup" aria-label="Ragionamento">
                <button type="button" role="radio" aria-checked={!pick.effort} className={!pick.effort ? 'on' : ''} title={`Automatico: ora ${effort ? effortLabel(effort as Effort) : 'quello del modello'}`} onClick={() => setPick(p => ({ ...p, effort: undefined }))} data-testid="newchat-effort-default">automatico</button>
                {EFFORTS.map(e => <button key={e} type="button" role="radio" aria-checked={pick.effort === e} className={pick.effort === e ? 'on' : ''} onClick={() => setPick(p => ({ ...p, effort: e }))} data-testid={`newchat-effort-${e}`}>{effortLabel(e)}</button>)}
              </div>
            </div>
          )}
          <label className="field">
            <span>Titolo <small>facoltativo</small></span>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Es. QA · Rimborsi" data-testid="newchat-title" />
          </label>
          </details>
          <div className="checks">
            <label className="check"><input type="checkbox" checked={regia} onChange={e => setRegia(e.target.checked)} aria-describedby={regia && current ? 'newchat-regia-note' : undefined} data-testid="newchat-regia" /><span>È la Regia <small>la chat che coordina le altre</small></span></label>
            {can.worktree && <label className="check"><input type="checkbox" checked={worktree} onChange={e => setWorktree(e.target.checked)} data-testid="newchat-worktree" /><span>Worktree separato <small>non tocca il tuo branch</small></span></label>}
          </div>
          {regia && current && (
            <p className="regia-note" id="newchat-regia-note" data-testid="newchat-regia-note">
              <HarnessMark harness={current.harness} regia size={16} />
              <span>Si aggiunge come nuova tab accanto alle altre Regie: <b>«{current.title}»</b> resta com'è. Le chat che apre rispondono a lei.</span>
            </p>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost btn-m" onClick={closeModal} data-testid="newchat-cancel">Annulla</button>
          <button type="submit" className="btn btn-primary btn-m" disabled={busy || !!line?.error} data-testid="newchat-create">{busy ? 'Creo…' : regia ? 'Crea la Regia' : 'Crea chat'}</button>
        </div>
      </form>
    </Modal>
  );
}
