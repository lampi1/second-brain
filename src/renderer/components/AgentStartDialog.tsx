// "Nuovo agente" (Ctrl+N): starts a chat as one of the eight work roles, or the Orchestrator. The role decides engine and
// model in main (its tier's model on its engine); the dialog shows the brain skills that fit the task (skills_suggest,
// advisory) and the ones ticked go to the launch, so the role may use them besides its own. "Dove: Locale / Cloud"
// (CloudWhere.tsx, ADR 0080): Cloud starts the task as an agent in a vendor's cloud (Cursor, Codex, Claude Code).
import { useEffect, useRef, useState } from 'react';
import { createChat, useApp } from '../store/store';
import { useAgents } from '../store/agents';
import { closeModal, openModal, setPrefs, ui } from '../store/ui';
import { focusChat, go } from '../actions';
import { workBrief } from '@shared/work-brief';
import { ORCHESTRATOR_ROLE_ID, type WorkRoleId } from '@shared/roles';
import type { SkillSuggestions } from '@shared/skill-suggest';
import { engineCan } from '../lib/engines';
import { PERMISSION_MODES, permissionLabel } from '../lib/format';
import type { PermissionMode } from '@shared/contract';
import { AgentAvatar } from './AgentAvatar';
import { AgentReadiness } from './AgentReadiness';
import { Keys, Modal } from './ui';
import { workRoles, profileCanStart } from '../lib/role-consumers';
import { t } from '../i18n';
import { Select } from './Select';
import type { CloudEngine } from '@shared/contract';
import { CloudWhere, type Where } from './CloudWhere';
import { startCloud } from '../store/cloud';
import { toast } from '../store/ui';
import { engineLabel } from '../lib/engines';

/** The skills a fresh suggestion ticks: the ones that fit well (the user can untick them). */
const PRESELECT = 60;

export function AgentStartDialog() {
  const { catalog, error: catalogError } = useAgents();
  const info = useApp(s => s.info);
  const hasOrchestrator = useApp(s => s.order.some(x => { const c = s.chats[x]; return !!c?.isOrchestrator && !c.closedAt; }));
  const prefs = ui.use(s => s.prefs.newChat);
  const [chosen, choose] = useState<WorkRoleId | null>(null), [prompt, setPrompt] = useState(''), [context, setContext] = useState(''), [outcome, setOutcome] = useState('');
  const [title, setTitle] = useState('');
  const [orchestrator, setOrchestrator] = useState(!hasOrchestrator), [worktree, setWorktree] = useState(false);
  const [cwd, setCwd] = useState(info?.brainRoot || prefs.cwd || '');
  const [permissionMode, setPermissionMode] = useState<PermissionMode | ''>(prefs.permissionMode);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null);
  const [where, setWhere] = useState<Where>('local'), [cloudEngine, setCloudEngine] = useState<CloudEngine | null>(null), [cloudEnv, setCloudEnv] = useState('');
  const cloud = where === 'cloud' && !orchestrator;
  const [suggested, setSuggested] = useState<{ request: string; result: SkillSuggestions } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // the task field alone: context and expected result describe the case, and dilute the match
  const request = prompt.trim().slice(0, 2000);
  const ranking = suggested?.request === request ? suggested.result : null;
  useEffect(() => {
    let stale = false;
    if (!request || orchestrator) return;
    const timer = setTimeout(() => {
      void window.sb.invoke('skills:suggest', { request }).then(result => {
        if (stale) return;
        setSuggested({ request, result });
        setPicked(new Set(result.candidates.filter(c => c.score >= PRESELECT).map(c => c.name)));
      }).catch(() => { if (!stale) setSuggested(null); });
    }, 400);
    return () => { stale = true; clearTimeout(timer); };
  }, [request, orchestrator]);
  const creating = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const roles = workRoles(catalog);
  const lead = catalog?.profiles.find(p => p.id === ORCHESTRATOR_ROLE_ID);
  const role = roles.find(p => p.id === (chosen ?? 'artisan')) ?? roles[0];
  const profile = orchestrator ? lead : role;
  const choice = catalog?.models.find(e => e.engine === profile?.engine);
  const unavailable = !profileCanStart(profile, choice) || !!catalog?.problem;
  const skills = (ranking?.candidates ?? []).filter(c => !role?.skills.includes(c.name));
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
      const given = [...picked].filter(name => skills.some(c => c.name === name)).slice(0, 16);
      const chat = await createChat({ ...(orchestrator ? { orchestrator: true } : { roleId: profile.id, ...(given.length ? { skills: given } : {}) }), harness: profile.engine, cwd: folder,
        title: title.trim() || undefined, prompt: workBrief({ path: 'general', request: prompt, context, outcome }) || undefined,
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
        {!orchestrator && <fieldset className="role-pick" data-testid="newchat-role"><legend>{t('roleFlow.agent')}</legend>
          <div className="role-pick-grid">{roles.map(p => <button key={p.id} type="button" className="role-pick-item" aria-pressed={p.id === role?.id} disabled={busy} onClick={() => choose(p.id as WorkRoleId)} data-testid={`newchat-role-${p.id}`}>
            <AgentAvatar avatar={p.avatar} name={p.name} size={28} /><span>{p.name}</span></button>)}</div></fieldset>}
        {unavailable && <p role="status">{t('roleFlow.unavailable')}</p>}
        {profile && <div className="agent-start-owner"><AgentAvatar avatar={profile.avatar} name={profile.name} size={40} /><p><strong>{profile.name}</strong> · {profile.purpose}</p></div>}
        <button type="button" className="link-btn" onClick={() => { closeModal(); go({ page: 'agenti' }); }}>{t('start.editAgent')}</button>
        <label className="field"><span>{t(orchestrator?'start.firstMessage':'start.task')}</span><textarea rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} autoFocus data-testid="newchat-prompt" placeholder={t('start.promptHint')} /></label>
        {!orchestrator && !cloud && ranking && <fieldset className="role-skills" data-testid="newchat-skills"><legend>{t('start.skillsSuggested')}</legend>
          {skills.length ? skills.map(c => <label key={c.name} className="check"><input type="checkbox" checked={picked.has(c.name)} disabled={busy}
            onChange={e => setPicked(prev => { const next = new Set(prev); if (e.target.checked) next.add(c.name); else next.delete(c.name); return next; })} data-testid={`newchat-skill-${c.name}`} /><span>{c.name} <small>{c.score}/100</small></span></label>)
            : <p>{t('start.skillsNone')}</p>}
          {role && role.skills.length > 0 && <small>{t('start.roleSkills', { list: role.skills.join(', ') })}</small>}
          <small>{t('start.skillsHint')}{ranking.mode === 'words' ? ` ${t('start.skillsWords')}` : ''}</small></fieldset>}
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
