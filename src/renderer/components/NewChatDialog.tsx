// "Nuova chat" (Ctrl+N): engine (every engine of the registry, lib/engines.ts, with its CLI's status), folder (recent
// folders suggested), model, effort, permission mode and separate worktree (each only on an engine that has it), title,
// the first message, "È l’Orchestrator" (several Orchestrators, ADR 0021: with an Orchestrator already there the new one needs a tab name and
// sits next to the others; the overlay's + opens this dialog as "Nuovo Orchestrator"). A work chat answers to the Orchestrator of the
// tab open now (regiaOf). Engine, model and effort come from the routing table (chat:createRouted, ADR 0032: the
// user, 2026-10-14, the app spent twice what it did before, «Nuova chat passa dalla tabella dei modelli»): the kind
// read from title and prompt, shown in one line under the engines (routing:preview) and in the fields; what the user
// picks by hand there beats the row (an override); no row = the settings' "Chat aperte dall’Orchestrator". Folder and
// permissions from the last choices; Ctrl+Enter creates; the new chat's input gets the focus. The CLI status comes from
// app:info, or is asked on open while the check at start has not reported ("non verificato" when nothing answers).
// Used by App.tsx.
import { Select } from './Select';
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
import { t } from '../i18n';
import { HarnessMark } from './Icons';
import { Keys, Modal } from './ui';
import { WORK_PATHS, workBrief, type WorkPath } from '@shared/work-brief';
import { workLabels } from '../lib/work-labels';
import { availableEngine } from '@shared/engine-readiness';

export function NewChatDialog() {
  const last = ui.use(s => s.prefs.newChat);
  const info = useApp(s => s.info);
  const current = useApp(s => { const id = s.order.find(x => s.chats[x]?.isRegia); return id ? s.chats[id] ?? null : null; });
  const hasRegia = !!current;
  const asRegia = ui.use(s => s.newChatRegia);
  const recent = useApp(s => [...new Set(s.order.map(id => s.chats[id]?.cwd).filter((x): x is string => !!x))].slice(0, 8), (a, b) => a.join('|') === b.join('|'));
  // engine, model and effort start from "Chat aperte dall’Orchestrator" (Settings page), the same defaults app_create_chat uses
  const def = useApp(s => s.settings?.regiaChats);
  const enabled = useApp(s => s.settings?.engineOn);
  const engines = useEngines();
  const modelOf = (h: Harness) => (def && (h === 'claude' || h === 'cursor') ? (h === 'cursor' ? def.cursorModel : def.claudeModel) : last.harness === h ? last.model : '');
  const harness0: Harness = availableEngine(engines.filter(e => e.trusted && enabled?.[e.id]).map(e => e.id), def?.harness ?? last.harness, info?.cli) ?? def?.harness ?? last.harness;
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
  const [path, setPath] = useState<WorkPath>('general');
  const [context, setContext] = useState('');
  const [outcome, setOutcome] = useState('');
  const labels = workLabels();
  const brief = workBrief({ path, request: prompt, context, outcome });
  const [regia, setRegia] = useState(asRegia || !hasRegia);
  const [regiaName, setRegiaName] = useState('');
  const [worktree, setWorktree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = preview && !('error' in preview) ? preview : null;
  // the fields show what will start: the user's pick, else the table's (preview), else the defaults
  const harness: Harness = pick.harness ?? ok?.harness ?? harness0;
  const model = pick.model ?? (ok && ok.harness === harness ? ok.model ?? '' : modelOf(harness));
  const effort: Effort | '' = pick.effort ?? (ok && ok.harness === harness ? ok.effort ?? '' : effort0);
  const can = { effort: engineCan(harness, 'effort'), perm: engineCan(harness, 'permissionMode'), worktree: engineCan(harness, 'worktree') };
  const seen = useModelsSeen();
  // the empty option is "automatico" here: picking it gives the choice back to the table
  const models = useMemo(() => modelOptions(harness, seen, model).map(m => m.id ? m : { ...m, label: t('dialogs.newChat.reasoningAutomatic') }), [harness, seen, model]);

  const name = cleanRegiaName(regiaName);
  const request = (): RoutedNewChat => {
    const h = pick.harness ?? harness0;
    const asked = { ...(pick.harness ? { harness: pick.harness } : {}), ...(pick.model ? { model: pick.model } : {}), ...(pick.effort && engineCan(harness, 'effort') ? { effort: pick.effort } : {}) };
    return {
      title: title.trim(), cwd: cwd.trim(), prompt: brief || undefined,
      routeText: prompt.trim(),
      ...(path !== 'general' && path !== 'develop' ? { area: labels.paths[path] } : {}),
      ...(Object.keys(asked).length ? { ask: { ...asked, reason: askReason } } : {}),
      defaults: { harness: h, ...(modelOf(h) ? { model: modelOf(h) } : {}), ...(effort0 && engineCan(h, 'effort') ? { effort: effort0 } : {}) },
      ...(regia ? { regia: true, ...(name ? { regiaName: name } : {}) } : regiaId() ? { regiaOf: regiaId()! } : {}),
    };
  };
  const askReason = 'user choice (New chat)'; // sent to agent, in English
  // the table’s choice while the user types (no tokens, in main): one line and the fields follow it; `key` holds what
  // the route depends on (the tab name does not change it)
  const key = JSON.stringify([title.trim(), prompt.trim().slice(0, 2000), path, context, outcome, pick, regia, harness0, effort0, def?.claudeModel, def?.cursorModel]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => { void sb.invoke('routing:preview', request()).then(p => { if (live) setPreview(p); }, () => { if (live) setPreview(null); }); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [key]);
  const line = routeLine(preview, engineLabel);

  const create = async () => {
    if (!cwd.trim()) { setError(t('dialogs.newChat.chooseFolder')); return; }
    if (!regia && !prompt.trim()) { setError(t('dialogs.newChat.writeTask')); return; }
    if (line?.error) { setError(t('dialogs.newChat.chatFailedPrefix', { why: line.why })); return; }
    if (regia && hasRegia && !name) { setError(t('dialogs.newChat.nameRegiaRequired')); return; }
    setBusy(true);
    setPrefs({ newChat: { harness, cwd: cwd.trim(), model, effort, permissionMode: perm } });
    const c = await createRoutedChat({
      ...request(), permissionMode: can.perm && perm ? perm : undefined, worktree: can.worktree && worktree ? true : undefined,
    });
    setBusy(false);
    if (c) { closeModal(); if (c.isRegia) setRegiaTab(c.id); requestAnimationFrame(() => focusChat(c.id)); }
    else setError(t('dialogs.newChat.chatDidNotStart'));
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
    if (on && on[h] !== true) return t('dialogs.newChat.cliOffInSettings');
    const st = info?.cli?.[h] ?? asked[h];
    if (st === undefined) return t('dialogs.newChat.cliChecking');
    if (st === null) return t('dialogs.newChat.cliNotVerified');
    if (!st.found) return t('dialogs.newChat.cliNotFound');
    return st.loggedIn === false ? t('dialogs.newChat.cliNeedsLogin') : (st.version ?? t('dialogs.newChat.cliReady'));
  };

  return (
    <Modal onClose={closeModal} label={asRegia ? t('dialogs.newChat.titleNewRegia') : t('dialogs.newChat.titleNewChat')} testid="newchat" className="modal-newchat">
      <form onSubmit={e => { e.preventDefault(); void create(); }} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void create(); } }}>
        <div className="modal-head"><h2>{asRegia ? t('dialogs.newChat.titleNewRegia') : t('dialogs.newChat.titleNewChat')}</h2><span className="sp" /><Keys combo={t('dialogs.newChat.shortcutCombo')} /><span className="modal-head-hint">{t('dialogs.newChat.createHint')}</span></div>
        <div className="modal-body">
          <label className="field">
            <span>{labels.path}</span>
            <Select value={path} onChange={e => setPath(e.target.value as WorkPath)} data-testid="newchat-work-path">
              {WORK_PATHS.map(p => <option key={p} value={p}>{labels.paths[p]}</option>)}
            </Select>
            <small>{labels.hint}</small>
          </label>
          <label className="field">
            <span>{regia ? <>{t('dialogs.newChat.firstMessage')} <small>{t('dialogs.newChat.optional')}</small></> : t('dialogs.newChat.whatShouldDo')}</span>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={regia ? 2 : 4} placeholder={labels.requestHint} data-testid="newchat-prompt" autoFocus={!(regia && hasRegia)} />
          </label>
          <details className="advanced" data-testid="newchat-work-context">
            <summary>{labels.contextSummary}</summary>
            <label className="field"><span>{labels.context}</span><textarea value={context} onChange={e => setContext(e.target.value)} rows={2} placeholder={labels.contextHint} data-testid="newchat-context" /></label>
            <label className="field"><span>{labels.outcome}</span><input value={outcome} onChange={e => setOutcome(e.target.value)} placeholder={labels.outcomeHint} data-testid="newchat-outcome" /></label>
          </details>
          {regia && hasRegia && (
            <label className="field">
              <span>{t('dialogs.newChat.regiaNameLabel')} <small>{t('dialogs.newChat.regiaNameHint')}</small></span>
              <input value={regiaName} onChange={e => { setRegiaName(e.target.value); setError(null); }} maxLength={30} placeholder={t('dialogs.newChat.regiaNamePlaceholder')} data-testid="newchat-regia-name" autoFocus aria-invalid={!!error && !cleanRegiaName(regiaName)} />
            </label>
          )}
          <details className="advanced" data-testid="newchat-engine-options">
          <summary>{labels.engineOptions}</summary>
          <div className="harness-pick" role="radiogroup" aria-label={t('dialogs.newChat.harnessLabel')}>
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
            {line && (pick.harness || pick.model || pick.effort) && <button type="button" className="link-btn" onClick={() => setPick({})} data-testid="newchat-route-reset">{t('dialogs.newChat.returnToAutomatic')}</button>}
          </p>
          </details>
          {line?.error && <p className="field-error" role="alert">{line.why}</p>}
          <details className="advanced" data-testid="newchat-advanced" open={asRegia || undefined}>
          <summary>{t('dialogs.newChat.advancedLabel')} <small>{t('dialogs.newChat.advancedHint')}</small></summary>
          <label className="field">
            <span>{t('dialogs.newChat.folderLabel')} <small>{t('dialogs.newChat.folderHint')}</small></span>
            <input value={cwd} onChange={e => { setCwd(e.target.value); setError(null); }} list="sb-recent-cwd" placeholder={t('dialogs.newChat.folderPlaceholder')} data-testid="newchat-cwd" aria-invalid={!!error && !cwd.trim()} />
            <datalist id="sb-recent-cwd">{recent.map(r => <option key={r} value={r} />)}</datalist>
          </label>
          <div className="field-row">
            <label className="field">
              <span>{t('dialogs.newChat.modelLabel')}</span>
              <Select value={model} onChange={e => setPick(p => ({ ...p, model: e.target.value || undefined }))} data-testid="newchat-model">
                {models.map(m => <option key={m.id || 'default'} value={m.id}>{m.label}</option>)}
              </Select>
            </label>
            {can.perm && (
              <label className="field">
                <span>{t('dialogs.newChat.permissionsLabel')}</span>
                <Select value={perm} onChange={e => setPerm(e.target.value as PermissionMode | '')} data-testid="newchat-perm">
                  <option value="">{t('dialogs.newChat.permissionsDefault')}</option>
                  {PERMISSION_MODES.map(p => <option key={p} value={p}>{permissionLabel(p)}</option>)}
                </Select>
              </label>
            )}
          </div>
          {can.effort && (
            <div className="field">
              <span>{t('dialogs.newChat.reasoningLabel')}</span>
              <div className="segmented wide" role="radiogroup" aria-label={t('dialogs.newChat.reasoningLabel')}>
                <button type="button" role="radio" aria-checked={!pick.effort} className={!pick.effort ? 'on' : ''} title={t('dialogs.newChat.reasoningAutoTip', { value: (effort ? effortLabel(effort as Effort) : null) ?? t('dialogs.newChat.reasoningModelDefault') })} onClick={() => setPick(p => ({ ...p, effort: undefined }))} data-testid="newchat-effort-default">{t('dialogs.newChat.reasoningAutomatic')}</button>
                {EFFORTS.map(e => <button key={e} type="button" role="radio" aria-checked={pick.effort === e} className={pick.effort === e ? 'on' : ''} onClick={() => setPick(p => ({ ...p, effort: e }))} data-testid={`newchat-effort-${e}`}>{effortLabel(e)}</button>)}
              </div>
            </div>
          )}
          <label className="field">
            <span>{t('dialogs.newChat.titleLabel')} <small>{t('dialogs.newChat.titleHint')}</small></span>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('dialogs.newChat.titlePlaceholder')} data-testid="newchat-title" />
          </label>
          {can.worktree && <label className="check"><input type="checkbox" checked={worktree} onChange={e => setWorktree(e.target.checked)} data-testid="newchat-worktree" /><span>{t('dialogs.newChat.separateWorktree')} <small>{t('dialogs.newChat.separateWorktreeHint')}</small></span></label>}
          </details>
          <div className="checks">
            <label className="check"><input type="checkbox" checked={regia} onChange={e => setRegia(e.target.checked)} aria-describedby={regia && current ? 'newchat-regia-note' : undefined} data-testid="newchat-regia" /><span>{t('dialogs.newChat.isRegia')} <small>{t('dialogs.newChat.isRegiaHint')}</small></span></label>
          </div>
          {regia && current && (
            <p className="regia-note" id="newchat-regia-note" data-testid="newchat-regia-note">
              <HarnessMark harness={current.harness} regia size={16} />
              <span>{t('dialogs.newChat.regiaNote')}<b>{current.title}</b>{t('dialogs.newChat.regiaNoteSuffix')}</span>
            </p>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost btn-m" onClick={closeModal} data-testid="newchat-cancel">{t('dialogs.newChat.cancelButton')}</button>
          <button type="submit" className="btn btn-primary btn-m" disabled={busy || !!line?.error} data-testid="newchat-create">{busy ? t('dialogs.newChat.creating') : regia ? t('dialogs.newChat.createRegiaButton') : t('dialogs.newChat.createChatButton')}</button>
        </div>
      </form>
    </Modal>
  );
}
