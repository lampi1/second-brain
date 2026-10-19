// Settings → Il mio spazio: the owner's projects folder (setting projectsRoot), so the first setup's "you can change it
// later in Settings" holds. Shows the folder, "Cambia…" (native picker, 'app:pickProjects' saves it) and "Rileva di
// nuovo" ('app:projectsFolder': the read-only look of main/brain/projects-folder.ts), whose find is used only on a
// click of "Usa questa". A "?" explains how the app looks for it. Mounted by SettingsPage.tsx in the 'space' group.
import { useState } from 'react';
import { t } from '../i18n';
import { setSetting, useApp } from '../store/store';
import { toast } from '../store/ui';
import { HelpTip } from './HelpTip';

type Look = { state: 'idle' } | { state: 'looking' } | { state: 'found'; path: string; repos: number } | { state: 'none' };

export function ProjectsFolderSetting() {
  const root = useApp(s => s.settings?.projectsRoot ?? null);
  const [look, setLook] = useState<Look>({ state: 'idle' });
  const pick = async () => {
    try { if (await window.sb.invoke('app:pickProjects', undefined)) setLook({ state: 'idle' }); } // main announces the change (settings:changed)
    catch { toast(t('essential.error'), 'err'); }
  };
  const detect = async () => {
    setLook({ state: 'looking' });
    try { const r = await window.sb.invoke('app:projectsFolder', undefined); setLook(r.detected && r.detected.path !== root ? { state: 'found', path: r.detected.path, repos: r.detected.repos } : { state: 'none' }); }
    catch { setLook({ state: 'idle' }); toast(t('essential.error'), 'err'); }
  };
  const use = async (path: string) => { await setSetting({ projectsRoot: path }); setLook({ state: 'idle' }); };
  return <div className="st-row" data-testid="st-projects">
    <div className="st-text">
      <label className="st-title">{t('setup.settings.projects')}<HelpTip label={t('setup.settings.projects')} testid="st-help-projects">{t('setup.settings.projectsHelp')}</HelpTip></label>
      {look.state === 'found' && <p className="st-desc" data-testid="st-projects-found">{t('setup.settings.found', { path: look.path, n: look.repos })}{' '}<button type="button" className="link-btn" onClick={() => void use(look.path)}>{t('setup.settings.use')}</button></p>}
      {look.state === 'none' && <p className="st-desc" role="status">{t(root ? 'setup.settings.noneOther' : 'setup.settings.none')}</p>}
    </div>
    <div className="st-ctl">
      <span className="st-value" title={root ?? undefined} data-testid="st-projects-value">{root || t('setup.done.projectsNone')}</span>
      <button type="button" className="btn btn-ghost btn-m" onClick={() => void pick()} data-testid="st-projects-pick">{t('setup.projects.change')}</button>
      <button type="button" className="btn btn-ghost btn-m" disabled={look.state === 'looking'} onClick={() => void detect()} data-testid="st-projects-detect">{t('setup.ai.rescan')}</button>
    </div>
  </div>;
}
