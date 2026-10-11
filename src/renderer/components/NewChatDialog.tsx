// "Nuova chat" (Ctrl+N): harness (Claude / Cursor, with each CLI's status), folder (recent folders suggested),
// model, effort and permission mode (Claude), title, the first message, "È la Regia", separate worktree. Last choices
// are remembered; Ctrl+Enter creates; the new chat's input gets the focus. Used by App.tsx.
import { useMemo, useState } from 'react';
import type { Effort, Harness, PermissionMode } from '@shared/contract';
import { EFFORTS, effortLabel, PERMISSION_MODES, permissionLabel } from '../lib/format';
import { MODELS } from '../lib/models';
import { createChat, useApp } from '../store/store';
import { closeModal, setPrefs, ui } from '../store/ui';
import { focusChat } from '../actions';
import { HarnessMark } from './Icons';
import { Keys, Modal } from './ui';

export function NewChatDialog() {
  const last = ui.use(s => s.prefs.newChat);
  const info = useApp(s => s.info);
  const hasRegia = useApp(s => Object.values(s.chats).some(c => c.isRegia));
  const recent = useApp(s => [...new Set(s.order.map(id => s.chats[id]?.cwd).filter((x): x is string => !!x))].slice(0, 8), (a, b) => a.join('|') === b.join('|'));
  const [harness, setHarness] = useState<Harness>(last.harness);
  // every chat starts in the brain folder (the user, 2026-10-11: «non voglio sbattermi a scegliere la cartella giusta»):
  // the AI picks the repo or worktree from the task; another folder only under Avanzate
  const [cwd, setCwd] = useState(info?.brainRoot || last.cwd || recent[0] || '');
  const [model, setModel] = useState(last.harness === harness ? last.model : '');
  const [effort, setEffort] = useState<Effort | ''>(last.effort);
  const [perm, setPerm] = useState<PermissionMode | ''>(last.permissionMode);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [regia, setRegia] = useState(!hasRegia);
  const [worktree, setWorktree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const models = useMemo(() => MODELS[harness], [harness]);

  const create = async () => {
    if (!cwd.trim()) { setError('Scegli la cartella in cui lavora la chat.'); return; }
    setBusy(true);
    setPrefs({ newChat: { harness, cwd: cwd.trim(), model, effort, permissionMode: perm } });
    const c = await createChat({
      harness, cwd: cwd.trim(), prompt: prompt.trim() || undefined, title: title.trim() || undefined, model: model || undefined,
      effort: harness === 'claude' && effort ? effort : undefined, permissionMode: harness === 'claude' && perm ? perm : undefined,
      regia: regia || undefined, worktree: harness === 'claude' && worktree ? true : undefined,
    });
    setBusy(false);
    if (c) { closeModal(); requestAnimationFrame(() => focusChat(c.id)); }
    else setError('La chat non è partita: il motivo è nell\'avviso in basso a sinistra.');
  };

  const cli = info?.cli;
  const status = (h: Harness) => {
    const st = cli?.[h];
    if (!st) return 'controllo…';
    if (!st.found) return 'CLI non trovata';
    return st.loggedIn === false ? 'accesso da fare' : (st.version ?? 'pronta');
  };

  return (
    <Modal onClose={closeModal} label="Nuova chat" testid="newchat" className="modal-newchat">
      <form onSubmit={e => { e.preventDefault(); void create(); }} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void create(); } }}>
        <div className="modal-head"><h2>Nuova chat</h2><span className="sp" /><Keys combo="Ctrl+Invio" /><span className="modal-head-hint">crea</span></div>
        <div className="modal-body">
          <label className="field">
            <span>Cosa deve fare?</span>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4} placeholder="Scrivi il lavoro: la chat parte dalla cartella del cervello e sceglie da sola repo e worktree" data-testid="newchat-prompt" autoFocus />
          </label>
          <div className="harness-pick" role="radiogroup" aria-label="Harness">
            {(['claude', 'cursor'] as Harness[]).map(h => (
              <button key={h} type="button" role="radio" aria-checked={harness === h} className={`harness-card ${harness === h ? 'on' : ''}`} data-testid={`newchat-harness-${h}`}
                onClick={() => { setHarness(h); setModel(''); }}>
                <HarnessMark harness={h} size={28} />
                <span><b>{h === 'claude' ? 'Claude Code' : 'Cursor'}</b><small>{status(h)}</small></span>
              </button>
            ))}
          </div>
          <details className="advanced" data-testid="newchat-advanced">
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
            <label className="check"><input type="checkbox" checked={regia} onChange={e => setRegia(e.target.checked)} data-testid="newchat-regia" /><span>È la Regia <small>la chat che coordina le altre</small></span></label>
            {harness === 'claude' && <label className="check"><input type="checkbox" checked={worktree} onChange={e => setWorktree(e.target.checked)} data-testid="newchat-worktree" /><span>Worktree separato <small>non tocca il tuo branch</small></span></label>}
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost btn-m" onClick={closeModal} data-testid="newchat-cancel">Annulla</button>
          <button type="submit" className="btn btn-primary btn-m" disabled={busy} data-testid="newchat-create">{busy ? 'Creo…' : 'Crea chat'}</button>
        </div>
      </form>
    </Modal>
  );
}
