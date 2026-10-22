// The folders step of the first-run setup wizard (FirstInterview.tsx): where the brain lives and where the owner's
// projects are. Nothing to choose (issue #165, ADR 0119): a clean install always gets a NEW brain in the default place
// (created empty on confirm, in the app's data folder); the wizard never offers an existing brain (Settings → Il mio
// spazio still changes the brain folder or points at an existing one); a brain already connected is only shown. Below,
// the projects folder: found by the app by itself when it can ('app:projectsFolder', read only:
// folder names and .git, main/brain/projects-folder.ts), asked with a native picker only when it cannot
// ('app:pickProjects' saves the setting projectsRoot). A found folder is saved on confirm by the wizard.
import { t } from '../i18n';
import type { AppInfo, ProjectsFolderInfo } from '@shared/contract';
import { IconAlert, IconBranch, IconCheck, IconFolder, IconSparkle, IconSpinner } from './Icons';

export function SetupFolders({ info, projects, onPickProjects }: { info: AppInfo | null; projects: ProjectsFolderInfo | null | undefined; onPickProjects: () => void }) {
  const brainReady = !!info?.brainRoot && !info.brainProblem, broken = !!info?.brainRoot && !!info.brainProblem;
  const chosen = projects?.saved ?? null, found = projects?.detected ?? null;
  return <div className="sw-stack" data-testid="setup-folders">
    <section className="sw-folder" data-testid="setup-memory-card" data-state={brainReady ? 'connected' : broken ? 'problem' : 'new'}>
      <span className={`sw-folder-icon ${brainReady ? 'is-ok' : ''}`} aria-hidden="true">{brainReady ? <IconCheck size={18}/> : <IconSparkle size={18}/>}</span>
      <div className="sw-folder-text">
        <span className="sw-folder-kicker">{t('setup.memory.kicker')}</span>
        {brainReady
          ? <><b>{t('setup.memory.connected')}</b><code>{info!.brainRoot}</code><p>{t('setup.memory.connectedHint')}</p></>
          : broken ? <><b>{t('setup.memory.brokenTitle')}</b><code>{info!.brainRoot}</code><p className="sw-folder-warn" role="alert"><IconAlert size={14}/>{t('setup.memory.problem', { problem: info!.brainProblem ?? '' })}</p></>
          : <><b>{t('setup.memory.new')}</b>
            {projects?.newMemoryIn && <code>{projects.newMemoryIn}</code>}
            <p>{t('setup.memory.newHint')}</p></>}
      </div>
    </section>

    <section className="sw-folder" data-testid="setup-projects" data-state={projects === undefined ? 'loading' : chosen ? 'chosen' : found ? 'found' : 'ask'}>
      <span className={`sw-folder-icon ${chosen || found ? 'is-ok' : 'is-ask'}`} aria-hidden="true">{projects === undefined ? <IconSpinner size={18}/> : chosen || found ? <IconBranch size={18}/> : <IconFolder size={18}/>}</span>
      <div className="sw-folder-text">
        <span className="sw-folder-kicker">{t('setup.projects.kicker')}</span>
        {projects === undefined ? <><b>{t('setup.projects.looking')}</b><p>{t('setup.projects.lookingHint')}</p></>
          : chosen ? <><b>{t('setup.projects.chosen')}</b><code>{chosen}</code><p>{t('setup.projects.chosenHint')}</p></>
          : found ? <><b>{t('setup.projects.found')}</b><code>{found.path}</code><p>{t(found.source === 'cli' ? 'setup.projects.foundCli' : 'setup.projects.foundCommon', { n: found.repos })}</p></>
          : <><b>{t('setup.projects.ask')}</b><p>{t('setup.projects.askHint')}</p></>}
      </div>
      {projects !== undefined && <button type="button" className={`btn btn-m ${chosen || found ? 'btn-ghost' : 'btn-primary'}`} onClick={onPickProjects} data-testid="setup-pick-projects">{chosen || found ? t('setup.projects.change') : t('setup.projects.pick')}</button>}
    </section>
    <p className="sw-hint">{t('setup.folders.note')}</p>
  </div>;
}
