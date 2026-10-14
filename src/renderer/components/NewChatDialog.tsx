// "Nuova chat" (Ctrl+N): harness (Claude / Cursor, with each CLI's status), folder (recent folders suggested),
// model, effort and permission mode (Claude), title, the first message, "È la Regia" (several Regie, ADR 0021: with a
// Regia already there the new one needs a tab name and sits next to the others; the overlay's + opens this dialog as
// "Nuova Regia"), separate worktree. A work chat answers to the Regia of the tab open now (regiaOf). Engine, model and effort
// start from the settings' "Chat aperte dalla Regia"; folder and permissions from the last choices; Ctrl+Enter creates;
// the new chat's input gets the focus. The CLI status comes from app:info, or is asked on open while the check at start
// has not reported ("non verificato" when nothing answers). Used by App.tsx.
import { useEffect, useMemo, useState } from 'react';
import type { CliStatus, Effort, Harness, PermissionMode } from '@shared/contract';
import { EFFORTS, effortLabel, PERMISSION_MODES, permissionLabel } from '../lib/format';
import { modelOptions, useModelsSeen } from '../lib/models';
import { cliFetch, createChat, useApp } from '../store/store';
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
  const modelOf = (h: Harness) => (def ? (h === 'cursor' ? def.cursorModel : def.claudeModel) : last.harness === h ? last.model : '');
  const [harness, setHarness] = useState<Harness>(def?.harness ?? last.harness);
  // every chat starts in the brain folder (the user, 2026-10-11: «non voglio sbattermi a scegliere la cartella giusta»):
  // the AI picks the repo or worktree from the task; another folder only under Avanzate
  const [cwd, setCwd] = useState(info?.brainRoot || last.cwd || recent[0] || '');
  const [model, setModel] = useState(() => modelOf(harness));
  const [effort, setEffort] = useState<Effort | ''>(def ? def.claudeEffort : last.effort);
  const [perm, setPerm] = useState<PermissionMode | ''>(last.permissionMode);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [regia, setRegia] = useState(asRegia || !hasRegia);
  const [regiaName, setRegiaName] = useState('');
  const [worktree, setWorktree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seen = useModelsSeen();
  const models = useMemo(() => modelOptions(harness, seen, model), [harness, seen, model]);

  const create = async () => {
    if (!cwd.trim()) { setError('Scegli la cartella in cui lavora la chat.'); return; }
    const name = cleanRegiaName(regiaName);
    if (regia && hasRegia && !name) { setError('Dai un nome alla nuova Regia (es. App): è il nome della sua tab.'); return; }
    setBusy(true);
    setPrefs({ newChat: { harness, cwd: cwd.trim(), model, effort, permissionMode: perm } });
    const c = await createChat({
      harness, cwd: cwd.trim(), prompt: prompt.trim() || undefined, title: title.trim() || undefined, model: model || undefined,
      effort: harness === 'claude' && effort ? effort : undefined, permissionMode: harness === 'claude' && perm ? perm : undefined,
      regia: regia || undefined, ...(regia && name ? { regiaName: name } : {}),
      ...(!regia && regiaId() ? { regiaOf: regiaId()! } : {}),
      worktree: harness === 'claude' && worktree ? true : undefined,
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
    for (const h of ['claude', 'cursor'] as Harness[]) void cliFetch(h).then(st => { if (live) setAsked(a => ({ ...a, [h]: st })); });
    return () => { live = false; };
  }, [known]);
  const status = (h: Harness) => {
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
            {(['claude', 'cursor'] as Harness[]).map(h => (
              <button key={h} type="button" role="radio" aria-checked={harness === h} className={`harness-card ${harness === h ? 'on' : ''}`} data-testid={`newchat-harness-${h}`}
                onClick={() => { setHarness(h); setModel(modelOf(h)); }}>
                <HarnessMark harness={h} size={28} />
                <span><b>{h === 'claude' ? 'Claude Code' : 'Cursor'}</b><small>{status(h)}</small></span>
              </button>
            ))}
          </div>
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
              <select value={model} onChange={e => setModel(e.target.value)} data-testid="newchat-model">
                {models.map(m => <option key={m.id || 'default'} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            {harness === 'claude' && (
              <label className="field">
                <span>Permessi</span>
                <select value={perm} onChange={e => setPerm(e.target.value as PermissionMode | '')} data-testid="newchat-perm">
                  <option value="">Come da impostazioni</option>
                  {PERMISSION_MODES.map(p => <option key={p} value={p}>{permissionLabel(p)}</option>)}
                </select>
              </label>
            )}
          </div>
          {harness === 'claude' && (
            <div className="field">
              <span>Ragionamento</span>
              <div className="segmented wide" role="radiogroup" aria-label="Ragionamento">
                <button type="button" role="radio" aria-checked={effort === ''} className={effort === '' ? 'on' : ''} onClick={() => setEffort('')} data-testid="newchat-effort-default">predefinito</button>
                {EFFORTS.map(e => <button key={e} type="button" role="radio" aria-checked={effort === e} className={effort === e ? 'on' : ''} onClick={() => setEffort(e)} data-testid={`newchat-effort-${e}`}>{effortLabel(e)}</button>)}
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
            {harness === 'claude' && <label className="check"><input type="checkbox" checked={worktree} onChange={e => setWorktree(e.target.checked)} data-testid="newchat-worktree" /><span>Worktree separato <small>non tocca il tuo branch</small></span></label>}
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
          <button type="submit" className="btn btn-primary btn-m" disabled={busy} data-testid="newchat-create">{busy ? 'Creo…' : regia ? 'Crea la Regia' : 'Crea chat'}</button>
        </div>
      </form>
    </Modal>
  );
}
