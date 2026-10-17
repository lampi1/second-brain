// Discovery-first setup and Regia action. One typed port owns preview, confirmation, verification and undo.
import { useEffect, useId, useRef, useState } from 'react';
import type { Applied, Discovery, Harness, OnboardingPort, Plan, Provider } from './contract';
import { HarnessMark, IconCheck, IconSearch, IconSend, IconShield } from '../../renderer/components/Icons';
import { copy, message, setupCopy } from './i18n';
import { connectionIntent, discoveryView, harnessNames, projectName, serviceNames } from './presentation';
import { DiscoveryBoard } from './Board';
import '../../renderer/styles/genui.css';
import './styles.css';
export interface ScreenProps { port: OnboardingPort; language?: 'it' | 'en'; onClose?: () => void; visible?: boolean }
export function OnboardingScreen({ port, language = 'it', onClose, visible = true }: ScreenProps) {
  const t = copy[language], s = setupCopy[language], id = useId();
  const [project, setProject] = useState(''), [organization, setOrganization] = useState('');
  const [harnesses, setHarnesses] = useState<Harness[]>([]), [command, setCommand] = useState(''), [manualFolder, setManualFolder] = useState('');
  const [found, setFound] = useState<Discovery | null>(null), [plan, setPlan] = useState<Plan | null>(null), [applied, setApplied] = useState<Applied | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [askOrganization, setAskOrganization] = useState(false);
  const working = useRef(false), revision = useRef(0), discoveredPort = useRef<OnboardingPort | null>(null);
  const planHeading = useRef<HTMLHeadingElement>(null), resultScope = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (plan) planHeading.current?.focus(); }, [plan?.id]);
  useEffect(() => { if (applied) resultScope.current?.focus(); }, [applied?.id]);
  const view = discoveryView(found);
  const acceptDiscovery = (value: Discovery) => {
    const next = discoveryView(value); setFound(value); setPlan(null);
    setProject(previous => next.projects.some(e => e.path === previous) ? previous : next.projects[0]?.path ?? '');
    setHarnesses(next.installed);
  };
  useEffect(() => {
    if (!visible || working.current) return;
    let live = true; const version = ++revision.current; setBusy(true);
    const scan = discoveredPort.current !== port;
    // Discovery failure must never hide an existing operation or its undo handle.
    void Promise.allSettled([port.current(), scan ? port.discover() : Promise.resolve(null)]).then(([current, discovered]) => {
      if (!live || version !== revision.current) return;
      if (current.status === 'fulfilled') setApplied(current.value);
      else setError(language === 'it' ? 'Impossibile riprendere il collegamento. Riprova.' : 'Unable to resume your connection. Retry.');
      if (discovered.status === 'fulfilled' && discovered.value) { discoveredPort.current = port; acceptDiscovery(discovered.value); }
      else if (discovered.status === 'rejected') setError(message(discovered.reason instanceof Error ? discovered.reason.message : '', language));
      if (current.status === 'fulfilled' && current.value) setProject(current.value.project);
    }).finally(() => { if (live && version === revision.current) setBusy(false); });
    return () => { live = false; };
  }, [port, language, visible]);
  const run = async (job: () => Promise<void>) => {
    if (busy || working.current) return;
    working.current = true; revision.current++; setBusy(true); setError(''); setNotice('');
    try { await job(); } catch (e) { setError(message(e instanceof Error ? e.message : '', language)); } finally { working.current = false; setBusy(false); }
  };
  const changed = () => { setPlan(null); setNotice(''); setError(''); setAskOrganization(false); };
  const connect = (choice: Provider) => {
    if (busy || working.current || applied) return;
    setPlan(null); setError('');
    if (!project) { setError(s.chooseProject); return; }
    if (!harnesses.length) { setError(s.chooseTools); return; }
    if (choice === 'azure' && !organization.trim()) { setAskOrganization(true); return; }
    setAskOrganization(false);
    void run(async () => setPlan(await port.prepare({ project, provider: choice, harnesses, organization: organization.trim() })));
  };
  const submitCommand = () => {
    const choice = connectionIntent(command);
    if (!choice) { setError(s.unknownCommand); return; }
    connect(choice);
  };
  const summary = found ? `${s.found} ${view.repos.length} ${s.repos}${view.services.length ? ` · ${view.services.map(p => serviceNames[p]).join(', ')}` : ''}${view.installed.length ? ` · ${view.installed.map(h => harnessNames[h]).join(', ')}` : ''}` : s.discovering;
  return <section className="ob-setup" aria-labelledby={id} aria-busy={busy} data-testid="onboarding-connectors">
    <header className="ob-header"><span className="ob-eyebrow">{s.eyebrow}</span><h2 id={id}>{s.title}</h2><p>{s.intro}</p></header>
    <div className="ob-summary" role="status"><IconSearch size={23}/><strong>{summary}</strong></div>
    {found ? <DiscoveryBoard found={found} language={language} project={project} harnesses={harnesses} disabled={busy || !!applied} onProject={value => { changed(); setProject(value); }} onHarness={h => { changed(); setHarnesses(current => current.includes(h) ? current.filter(v => v !== h) : [...current, h]); }} onConnect={connect}/> : <div className="ob-skeleton">{busy ? s.discovering : s.noResults}</div>}
    {!applied && <form className="ob-composer" onSubmit={e => { e.preventDefault(); submitCommand(); }}>
      <label htmlFor={`${id}-command`}>{s.command}</label><div className="ob-command-row"><input id={`${id}-command`} value={command} placeholder={s.placeholder} disabled={busy} onChange={e => setCommand(e.target.value)} autoComplete="off"/><button type="submit" className="btn btn-primary" disabled={busy || !command.trim()}><IconSend size={18}/>{s.send}</button></div>
      {project && <div className="ob-chips"><span>{s.projectScope}: <b>{projectName(project)}</b></span>{harnesses.map(h => <span key={h}>{harnessNames[h]}</span>)}</div>}
      <p className="ob-privacy"><IconShield size={16}/>{s.localOnly}</p>
    </form>}
    {askOrganization && !applied && <form className="ob-composer" onSubmit={e => { e.preventDefault(); connect('azure'); }}><label htmlFor={`${id}-organization`}>{s.organizationHelp}</label><div className="ob-command-row"><input id={`${id}-organization`} value={organization} disabled={busy} autoComplete="organization" onChange={e => setOrganization(e.target.value)}/><button type="submit" className="btn" disabled={busy || !organization.trim()}>{s.organizationGo}</button></div></form>}
    {plan && !applied && <section className="ob-plan" aria-labelledby={`${id}-plan`} data-testid="connector-plan"><h3 ref={planHeading} tabIndex={-1} id={`${id}-plan`}>{s.planTitle}</h3><p><strong>{serviceNames[plan.provider]}</strong> · {s.projectScope} <strong>{projectName(plan.project)}</strong></p><p className="ob-muted">{t.plan}</p>
      <p className="ob-privacy"><IconShield size={17}/>{s.backup}</p>
      <div className="gu-diff"><div className="gu-diff-area"><b>{s.diff}</b><span className="gu-count">{plan.changes.length}</span></div>{plan.changes.map(c => <div key={c.harness}><div className="ob-file"><b>{harnessNames[c.harness]}</b><span className="ob-path">{c.path}</span></div><pre aria-label={`${s.diff}: ${harnessNames[c.harness]}`}>{c.diff}</pre></div>)}</div>
      {plan.pending.map((p, i) => <p className="ob-alert" key={i}>{message(p, language)}</p>)}
      <div className="ob-actions"><button type="button" className="btn btn-primary" disabled={busy || !plan.changes.length} onClick={() => void run(async () => setApplied(await port.apply(plan.id)))}><IconCheck size={18}/>{t.confirm}</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setPlan(null)}>{s.change}</button></div>
    </section>}
    {applied && <p ref={resultScope} tabIndex={-1} className="ob-path"><strong>{serviceNames[applied.provider]}</strong> · {s.projectScope}: <strong>{applied.project}</strong></p>}
    {applied && <section className="ob-plan" aria-labelledby={`${id}-result`}><h3 id={`${id}-result`}>{s.resultTitle}</h3><div className="gu-cards ob-result" aria-live="polite">{applied.connections.map(c => <article className="gu-card" key={c.harness}><div className="gu-card-head"><HarnessMark harness={c.harness} size={28}/><b>{harnessNames[c.harness]}</b></div><span className={`gu-status ${c.status === 'verified' ? 'gu-ok' : c.status === 'failed' ? 'gu-fail' : 'gu-warn'}`}><i aria-hidden="true"/>{t[c.status]}</span><p className="gu-card-sum">{c.status === 'verified' ? t.verified : message(c.detail, language)}</p><small className="ob-muted">{c.checkedAt}</small></article>)}</div><div className="ob-actions"><button className="btn" type="button" disabled={busy} onClick={() => void run(async () => setApplied({ ...applied, connections: await port.test(applied.id) }))}>{t.retry}</button><button className="btn" type="button" disabled={busy} onClick={() => void run(async () => { await port.undo(applied.id); setApplied(null); setPlan(null); setNotice(t.undone); })}>{t.undo}</button></div></section>}
    {error && <p className="ob-alert" role="alert">{error}</p>}{notice && <p className="ob-summary" role="status">{notice}</p>}{busy && found && <p className="ob-muted" role="status">{t.busy}</p>}
    {found?.limited && <p className="ob-muted">{t.limits}</p>}
    {!applied && <details className="ob-advanced"><summary>{s.more}</summary><label htmlFor={`${id}-folder`}>{s.folder}<input id={`${id}-folder`} value={manualFolder} disabled={busy} onChange={e => setManualFolder(e.target.value)}/></label><div className="ob-actions"><button className="btn" type="button" disabled={busy || !manualFolder.trim()} onClick={() => { changed(); setProject(manualFolder.trim()); }}>{s.useFolder}</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void run(async () => acceptDiscovery(await port.discover()))}>{s.refresh}</button></div>{found && <p className="ob-muted">{found.skipped} {language === 'it' ? 'percorsi saltati; i file cloud restano esclusi.' : 'paths skipped; cloud-only files stay excluded.'}</p>}</details>}
    {onClose && <div className="ob-actions"><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{t.skip}</button></div>}
  </section>;
}
export function RegiaConnectAction(props: ScreenProps) {
  const [open, setOpen] = useState(false);
  return <><button className="btn" type="button" aria-expanded={open} onClick={() => setOpen(v => !v)}>{copy[props.language ?? 'it'].title}</button><div hidden={!open}><OnboardingScreen {...props} visible={open} onClose={() => setOpen(false)}/></div></>;
}
