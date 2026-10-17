// Discovery evidence in the app's GenUI cards/board vocabulary, with existing app icons and explicit actions.
import type { Discovery, Harness, Provider } from './contract';
import { HarnessMark, IconBranch, IconCheck, IconFolder, IconGlobe } from '../../renderer/components/Icons';
import { discoveryView, harnessNames, projectName, serviceNames } from './presentation';
import { setupCopy } from './i18n';
export function DiscoveryBoard({ found, language, project, harnesses, disabled, onProject, onHarness, onConnect }: {
  found: Discovery; language: 'it' | 'en'; project: string; harnesses: Harness[]; disabled: boolean;
  onProject: (project: string) => void; onHarness: (harness: Harness) => void; onConnect: (provider: Provider) => void;
}) {
  const t = setupCopy[language], view = discoveryView(found);
  return <div className="gu-board ob-board">
    <section className="gu-lane ob-lane" aria-label={t.projects}><div className="gu-lane-head"><IconFolder size={19} /><b>{t.projects}</b><span className="gu-count">{view.projects.length}</span></div>
      {view.projects.map(e => <button type="button" className={`gu-card ob-project ${project === e.path ? 'rec' : ''}`} key={e.path} aria-pressed={project === e.path} disabled={disabled} onClick={() => onProject(e.path)}><span className="gu-card-head"><IconBranch size={18}/><b>{projectName(e.path)}</b>{project === e.path && <IconCheck size={18}/>}</span><span className="gu-card-sum ob-path">{e.path}</span><span className="gu-status gu-info">{e.kind === 'repo' ? t.repository : t.workFolder}</span></button>)}
      {!view.projects.length && <p className="gu-empty">{t.noProject}</p>}
    </section>
    <section className="gu-lane ob-lane" aria-label={t.services}><div className="gu-lane-head"><IconGlobe size={19}/><b>{t.services}</b></div>
      {(['github', 'azure', 'jira'] as const).map(p => <article className="gu-card" key={p}><div className="gu-card-head"><span className={`ob-service-mark ob-${p}`} aria-hidden="true">{p === 'github' ? 'GH' : p === 'azure' ? 'Az' : 'J'}</span><b>{serviceNames[p]}</b></div><span className={`gu-status ${view.services.some(s => s === p) ? 'gu-ok' : 'gu-info'}`}><i aria-hidden="true"/>{view.services.some(s => s === p) ? t.detected : t.available}</span><button type="button" className="btn ob-connect" disabled={disabled} aria-label={`${t.connect} ${serviceNames[p]}`} onClick={() => onConnect(p)}>{t.connect}</button></article>)}
    </section>
    <section className="gu-lane ob-lane" aria-label={t.tools}><div className="gu-lane-head"><b>{t.tools}</b><span className="gu-count">{view.installed.length}</span></div>
      {(['claude', 'codex', 'cursor'] as const).map(h => { const installed = view.installed.includes(h); return <button key={h} type="button" className={`gu-card ob-harness ${harnesses.includes(h) ? 'rec' : ''}`} disabled={disabled || !installed} aria-pressed={harnesses.includes(h)} onClick={() => onHarness(h)}><span className="gu-card-head"><HarnessMark harness={h} size={30}/><b>{harnessNames[h]}</b>{harnesses.includes(h) && <IconCheck size={18}/>}</span><span className={`gu-status ${installed ? 'gu-ok' : 'gu-info'}`}><i aria-hidden="true"/>{installed ? t.installed : t.notDetected}</span>{installed && <span className="gu-card-sum">{t.signInUnknown}</span>}</button>; })}
    </section>
  </div>;
}
