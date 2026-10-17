// Starts a conversation owned by an explicit catalog agent. Engine/model come from that profile in main, with
// technical permissions kept progressive and no per-task routing matrix in the ordinary work flow.
import { useEffect, useRef, useState } from 'react';
import { createChat, useApp } from '../store/store';
import { useAgents } from '../store/agents';
import { closeModal, openModal, setPrefs, setRegiaTab, ui } from '../store/ui';
import { focusChat, go, regiaId } from '../actions';
import { cleanRegiaName } from '@shared/regia';
import { workBrief } from '@shared/work-brief';
import { engineCan } from '../lib/engines';
import { PERMISSION_MODES, permissionLabel } from '../lib/format';
import type { PermissionMode } from '@shared/contract';
import { AgentAvatar } from './AgentAvatar';
import { AgentReadiness } from './AgentReadiness';
import { Keys, Modal } from './ui';

export function AgentStartDialog() {
  const { catalog, setup, error: catalogError } = useAgents();
  const info = useApp(s => s.info), hasRegia = useApp(s => s.order.some(id => s.chats[id]?.isRegia));
  const prefs = ui.use(s => s.prefs.newChat), asRegia = ui.use(s => s.newChatRegia);
  const [chosen, choose] = useState(''), [prompt, setPrompt] = useState(''), [context, setContext] = useState(''), [outcome, setOutcome] = useState('');
  const [title, setTitle] = useState(''), [regiaName, setRegiaName] = useState('');
  const [regia, setRegia] = useState(asRegia || !hasRegia), [worktree, setWorktree] = useState(false);
  const [cwd, setCwd] = useState(info?.brainRoot || prefs.cwd || '');
  const [permissionMode, setPermissionMode] = useState<PermissionMode | ''>(prefs.permissionMode);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null);
  const creating = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const preferred = setup?.preferences.agentIds ?? [];
  const profiles = catalog?.profiles ?? [];
  const profile = profiles.find(p => p.id === chosen) ?? profiles.find(p => preferred.includes(p.id)) ?? profiles[0];
  const choice = catalog?.models.find(e => e.engine === profile?.engine);
  const unavailable = !profile || !choice || !choice.enabled || !choice.trusted || choice.installed === false || choice.authenticated === false || !!catalog?.problem;
  const create = async () => {
    if (creating.current || unavailable || !profile) return;
    const folder = cwd.trim() || info?.brainRoot || '';
    if (!folder) { setProblem('Collega una cartella della memoria prima di avviare l’agente.'); return; }
    if (!regia && !prompt.trim()) { setProblem('Descrivi il primo compito da affidare all’agente.'); return; }
    const name = cleanRegiaName(regiaName);
    if (regia && hasRegia && !name) { setProblem('Dai un nome a questa Regia.'); return; }
    creating.current = true; setBusy(true); setProblem(null);
    try {
      const chat = await createChat({ agentId: profile.id, harness: profile.engine, cwd: folder,
        title: title.trim() || undefined, prompt: workBrief({ path: 'general', request: prompt, context, outcome }) || undefined,
        ...(regia ? { regia: true, ...(name ? { regiaName: name } : {}) } : regiaId() ? { regiaOf: regiaId()! } : {}),
        ...(engineCan(profile.engine, 'permissionMode') && permissionMode ? { permissionMode } : {}),
        ...(engineCan(profile.engine, 'worktree') && worktree ? { worktree: true } : {}),
      });
      if (chat) { setPrefs({ newChat: { ...prefs, harness: profile.engine, cwd: folder } }); if (live.current) { closeModal(); if (chat.isRegia) setRegiaTab(chat.id); requestAnimationFrame(() => focusChat(chat.id)); } }
      else if(live.current) setProblem('L’agente non è partito. La richiesta rimane qui: controlla la disponibilità del motore.');
    } finally { creating.current = false; if(live.current) setBusy(false); }
  };
  return <Modal onClose={closeModal} label={asRegia ? 'Avvia una Regia' : 'Avvia un agente'} testid="newchat" className="modal-newchat">
    <form onSubmit={e => { e.preventDefault(); void create(); }} onKeyDown={e => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!e.repeat) void create(); } }}>
      <div className="modal-head"><h2>{asRegia ? 'Avvia una Regia' : 'Avvia un agente'}</h2><span className="sp" /><Keys combo="Ctrl+Invio" /></div>
      <div className="modal-body">
        <label className="field"><span>Chi ti aiuta?</span><select value={profile?.id ?? ''} onChange={e => choose(e.target.value)} disabled={busy} data-testid="newchat-agent">{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {profile && <div className="agent-start-owner"><AgentAvatar avatar={profile.avatar} name={profile.name} /><p>{profile.purpose}</p></div>}
        <button type="button" className="link-btn" onClick={() => { closeModal(); go({ page: 'agenti' }); }}>Crea o modifica un agente</button>
        <label className="field"><span>{regia ? 'Primo messaggio · facoltativo' : 'Che cosa vuoi ottenere?'}</span><textarea rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} autoFocus data-testid="newchat-prompt" placeholder="Prepara una riunione, confronta due offerte o scrivi una bozza per un cliente" /></label>
        <details className="advanced"><summary>Contesto e risultato atteso</summary><label className="field"><span>Informazioni utili</span><textarea rows={2} value={context} onChange={e => setContext(e.target.value)} data-testid="newchat-context" /></label><label className="field"><span>Che cosa vuoi ricevere?</span><input value={outcome} onChange={e => setOutcome(e.target.value)} data-testid="newchat-outcome" /></label></details>
        <AgentReadiness choice={choice} />
        {profile && <small>Motore: {choice?.label ?? profile.engine} · modello {profile.model || 'default del motore; nome effettivo all’avvio'}</small>}
        {regia && hasRegia && <label className="field"><span>Nome della Regia</span><input value={regiaName} onChange={e => setRegiaName(e.target.value)} maxLength={30} data-testid="newchat-regia-name" /></label>}
        <label className="check"><input type="checkbox" checked={regia} onChange={e => setRegia(e.target.checked)} data-testid="newchat-regia" /><span>Coordina gli altri agenti come Regia</span></label>
        <details className="advanced" data-testid="newchat-advanced"><summary>Dettagli e permessi</summary>
          <label className="field"><span>Nome di questa conversazione · facoltativo</span><input value={title} onChange={e => setTitle(e.target.value)} data-testid="newchat-title" /></label>
          <label className="field"><span>Cartella di lavoro · la memoria è la scelta iniziale</span><input value={cwd} onChange={e => setCwd(e.target.value)} data-testid="newchat-cwd" /></label>
          {profile && engineCan(profile.engine, 'permissionMode') && <label className="field"><span>Permessi</span><select value={permissionMode} onChange={e => setPermissionMode(e.target.value as PermissionMode | '')} data-testid="newchat-perm"><option value="">Default configurato</option>{PERMISSION_MODES.map(p => <option key={p} value={p}>{permissionLabel(p)}</option>)}</select></label>}
          {profile && engineCan(profile.engine, 'worktree') && <label className="check"><input type="checkbox" checked={worktree} onChange={e => setWorktree(e.target.checked)} data-testid="newchat-worktree" />Ambiente di sviluppo separato</label>}
        </details>
        {!info?.brainRoot && !cwd && <button type="button" className="btn btn-ghost" onClick={() => { closeModal(); openModal('setup'); }}>Completa il collegamento della memoria nel setup</button>}
        {(problem || catalogError || catalog?.problem) && <p role="alert" className="field-error">{problem || catalogError || catalog?.problem}</p>}
      </div>
      <div className="modal-foot"><button type="button" className="btn btn-ghost" onClick={closeModal} data-testid="newchat-cancel">Annulla</button><button type="submit" className="btn btn-primary" disabled={busy || unavailable} data-testid="newchat-create">{busy ? 'Avvio…' : regia ? 'Avvia Regia' : 'Avvia agente'}</button></div>
    </form>
  </Modal>;
}
