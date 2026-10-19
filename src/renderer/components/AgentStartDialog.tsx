// Starts a conversation owned by an explicit catalog agent. Engine/model come from that profile in main, with
// technical permissions kept progressive and no per-task routing matrix in the ordinary work flow. "Dove: Locale /
// Cloud" (CloudWhere.tsx, ADR 0080): Cloud starts the task as an agent in a vendor's cloud (Cursor, Codex, Claude Code).
import { useEffect, useRef, useState } from 'react';
import { createChat, useApp } from '../store/store';
import { useAgents } from '../store/agents';
import { BRAIN_PAGES, closeModal, openModal, setPrefs, ui } from '../store/ui';
import { focusChat, go } from '../actions';
import { workBrief } from '@shared/work-brief';
import { ORCHESTRATOR_AGENT_ID } from '@shared/agents';
import { engineCan } from '../lib/engines';
import { PERMISSION_MODES, permissionLabel } from '../lib/format';
import type { PermissionMode } from '@shared/contract';
import { AgentAvatar } from './AgentAvatar';
import { AgentReadiness } from './AgentReadiness';
import { Keys, Modal } from './ui';
import {roleAgents,profileCanStart} from '../lib/role-consumers';
import {t} from '../i18n';
import { Select } from './Select';
import type { AgentClassification } from '@shared/agent-classifier';
import type { CloudEngine } from '@shared/contract';
import { CloudWhere, type Where } from './CloudWhere';
import { startCloud } from '../store/cloud';
import { toast } from '../store/ui';
import { engineLabel } from '../lib/engines';

export function AgentStartDialog() {
  const { catalog, setup, error: catalogError } = useAgents();
  const info = useApp(s => s.info);
  const hasOrchestrator = useApp(s => s.order.some(x => { const c = s.chats[x]; return !!c?.isOrchestrator && !c.closedAt; }));
  const prefs = ui.use(s => s.prefs.newChat);
  const role=ui.use(s=>s.prefs.role);
  // The coordinator preset only shapes the Orchestrator chat: main refuses it as a work chat's agent.
  const startable=(p:{id:string})=>p.id!==ORCHESTRATOR_AGENT_ID;
  const suggested=(role===undefined?[]:roleAgents(role,catalog,BRAIN_PAGES.map(page=>page.id))).filter(startable);
  const [chosen, choose] = useState<string|null>(null), [prompt, setPrompt] = useState(''), [context, setContext] = useState(''), [outcome, setOutcome] = useState('');
  const [title, setTitle] = useState('');
  const [orchestrator, setOrchestrator] = useState(!hasOrchestrator), [worktree, setWorktree] = useState(false);
  const [cwd, setCwd] = useState(info?.brainRoot || prefs.cwd || '');
  const [permissionMode, setPermissionMode] = useState<PermissionMode | ''>(prefs.permissionMode);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null);
  const [where, setWhere] = useState<Where>('local'), [cloudEngine, setCloudEngine] = useState<CloudEngine | null>(null), [cloudEnv, setCloudEnv] = useState('');
  const cloud = where === 'cloud' && !orchestrator;
  const [matching, setMatching] = useState<{ request: string; result: AgentClassification } | null>(null);
  // the task field alone: context and expected result describe the case, not which agent fits it, and dilute the match
  const request = prompt.trim().slice(0, 2000);
  const ranking = matching?.request === request ? matching.result : null;
  useEffect(() => {
    let stale = false;
    if (!request || orchestrator) return;
    const timer = setTimeout(() => {
      void window.sb.invoke('agents:classify', { request }).then(result => {
        if (!stale) setMatching({ request, result });
      }).catch(() => { if (!stale) setMatching(null); });
    }, 400);
    return () => { stale = true; clearTimeout(timer); };
  }, [request, orchestrator, catalog]);
  const creating = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const preferred = setup?.preferences.agentIds ?? [];
  const profiles = (catalog?.profiles ?? []).filter(startable);
  const profile = chosen===null?(suggested[0]??profiles.find(p => preferred.includes(p.id))??profiles[0]):profiles.find(p=>p.id===chosen);
  const choice = catalog?.models.find(e => e.engine === profile?.engine);
  const unavailable = !profileCanStart(profile,choice) || !!catalog?.problem;
  const createCloud = async () => {
    const folder = cwd.trim() || info?.brainRoot || '';
    if (creating.current) return;
    if (!prompt.trim()) { setProblem(t('start.needTask')); return; }
    if (!cloudEngine) { setProblem(t('cloud.notReady')); return; }
    creating.current = true; setBusy(true); setProblem(null);
    try {
      const r = await startCloud({ engine: cloudEngine, cwd: folder, prompt: workBrief({ path: 'general', request: prompt, context, outcome }) || prompt.trim(),
        ...(title.trim() ? { title: title.trim() } : {}), ...(cloudEnv.trim() ? { env: cloudEnv.trim() } : {}) });
      if (!live.current) return;
      if (typeof r === 'string') setProblem(t('cloud.failed', { why: r }));
      else { closeModal(); toast(t('cloud.started', { engine: engineLabel(cloudEngine) }), 'ok'); }
    } finally { creating.current = false; if (live.current) setBusy(false); }
  };
  const create = async () => {
    if (cloud) { await createCloud(); return; }
    if (creating.current || unavailable || !profile) return;
    const folder = cwd.trim() || info?.brainRoot || '';
    if (!folder) { setProblem(t('start.needMemory')); return; }
    if (!orchestrator && !prompt.trim()) { setProblem(t('start.needTask')); return; }
    creating.current = true; setBusy(true); setProblem(null);
    try {
      const chat = await createChat({ agentId: profile.id, harness: profile.engine, cwd: folder,
        title: title.trim() || undefined, prompt: workBrief({ path: 'general', request: prompt, context, outcome }) || undefined,
        ...(orchestrator && !hasOrchestrator ? { orchestrator: true } : {}),
        ...(engineCan(profile.engine, 'permissionMode') && permissionMode ? { permissionMode } : {}),
        ...(engineCan(profile.engine, 'worktree') && worktree ? { worktree: true } : {}),
      });
      if (chat) { setPrefs({ newChat: { ...prefs, harness: profile.engine, cwd: folder } }); if (live.current) { closeModal(); requestAnimationFrame(() => focusChat(chat.id)); } }
      else if(live.current) setProblem(t('start.failed'));
    } finally { creating.current = false; if(live.current) setBusy(false); }
  };
  return <Modal onClose={closeModal} label={t('start.agentTitle')} testid="newchat" className="modal-newchat">
    <form onSubmit={e => { e.preventDefault(); void create(); }} onKeyDown={e => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!e.repeat) void create(); } }}>
      <div className="modal-head"><h2>{t('start.agentTitle')}</h2><span className="sp" /><Keys combo={t('start.shortcut')} /></div>
      <div className="modal-body">
        <label className="field"><span>{t('roleFlow.agent')}</span><Select value={chosen??profile?.id??''} onChange={e => choose(e.target.value)} disabled={busy} data-testid="newchat-agent">
          {chosen&&!profile&&<option value={chosen}>{t('roleFlow.unavailable')}</option>}
          {suggested.length>0&&<optgroup label={t('roleFlow.suggested')}>{suggested.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
          <optgroup label={t('roleFlow.catalog')}>{profiles.filter(p=>!suggested.some(item=>item.id===p.id)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
        </Select></label>
        {!orchestrator && ranking && <p role="status" data-testid="agent-classification">
          {ranking.noneCloseEnough ? t('start.matchNone') : t('start.matchSuggestion', { name: profiles.find(p => p.id === ranking.candidates[0]?.id)?.name ?? '', score: ranking.candidates[0]?.score ?? 0, high: (ranking.candidates[0]?.score ?? 0) >= 80 })}
          {' '}{t(ranking.mode === 'words' ? 'start.matchWords' : 'start.matchLocal')}
          {!ranking.noneCloseEnough && <button type="button" className="link-btn" disabled={busy} onClick={() => choose(ranking.candidates[0]!.id)}>{t('start.matchChoose')}</button>}
        </p>}
        {unavailable&&<p role="status">{t('roleFlow.unavailable')}</p>}
        {profile && <div className="agent-start-owner"><AgentAvatar avatar={profile.avatar} name={profile.name} /><p>{profile.purpose}</p></div>}
        <button type="button" className="link-btn" onClick={() => { closeModal(); go({ page: 'agenti' }); }}>{t('start.editAgent')}</button>
        <label className="field"><span>{t(orchestrator?'start.firstMessage':'start.task')}</span><textarea rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} autoFocus data-testid="newchat-prompt" placeholder={t('start.promptHint')} /></label>
        <details className="advanced" data-testid="newchat-work-context"><summary>{t('start.contextTitle')}</summary><label className="field"><span>{t('start.context')}</span><textarea rows={2} value={context} onChange={e => setContext(e.target.value)} data-testid="newchat-context" /></label><label className="field"><span>{t('start.outcome')}</span><input value={outcome} onChange={e => setOutcome(e.target.value)} data-testid="newchat-outcome" /></label></details>
        {!orchestrator && <CloudWhere cwd={cwd.trim() || info?.brainRoot || ''} where={where} onWhere={w => { setWhere(w); setProblem(null); }} engine={cloudEngine} onEngine={setCloudEngine} env={cloudEnv} onEnv={setCloudEnv} />}
        {!cloud && <AgentReadiness choice={choice} />}
        {!cloud && profile && <small>{t('start.configuration',{engine:choice?.label??profile.engine,model:profile.model||t('start.defaultModel')})}</small>}
        {!hasOrchestrator && <label className="check"><input type="checkbox" checked={orchestrator} onChange={e => setOrchestrator(e.target.checked)} data-testid="newchat-orchestrator" /><span>{t('start.coordinate')}</span></label>}
        <details className="advanced" data-testid="newchat-advanced"><summary>{t('start.details')}</summary>
          <label className="field"><span>{t('start.conversationName')}</span><input value={title} onChange={e => setTitle(e.target.value)} data-testid="newchat-title" /></label>
          <label className="field"><span>{t('start.folder')}</span><input value={cwd} onChange={e => setCwd(e.target.value)} data-testid="newchat-cwd" /></label>
          {profile && engineCan(profile.engine, 'permissionMode') && <label className="field"><span>{t('start.permissions')}</span><Select value={permissionMode} onChange={e => setPermissionMode(e.target.value as PermissionMode | '')} data-testid="newchat-perm"><option value="">{t('start.defaultPermissions')}</option>{PERMISSION_MODES.map(p => <option key={p} value={p}>{permissionLabel(p)}</option>)}</Select></label>}
          {profile && engineCan(profile.engine, 'worktree') && <label className="check"><input type="checkbox" checked={worktree} onChange={e => setWorktree(e.target.checked)} data-testid="newchat-worktree" />{t('start.worktree')}</label>}
        </details>
        {!info?.brainRoot && !cwd && <button type="button" className="btn btn-ghost" onClick={() => { closeModal(); openModal('setup'); }}>{t('start.connectMemory')}</button>}
        {(problem || catalogError || catalog?.problem) && <p role="alert" className="field-error">{problem || catalogError || catalog?.problem}</p>}
      </div>
      <div className="modal-foot"><button type="button" className="btn btn-ghost" onClick={closeModal} data-testid="newchat-cancel">{t('start.cancel')}</button><button type="submit" className="btn btn-primary" disabled={busy || (cloud ? !cloudEngine : unavailable)} data-testid="newchat-create">{t(busy?'start.starting':cloud?'cloud.create':orchestrator?'start.startOrchestrator':'start.startAgent')}</button></div>
    </form>
  </Modal>;
}
