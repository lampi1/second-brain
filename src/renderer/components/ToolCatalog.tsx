// The tool catalog (issue #165, ADR 0119): one tile per tool (GitHub, Jira Cloud, Azure DevOps) that creates the app's
// account connector and the MCP server the agents use, together, without ever showing a command, an argument, a
// variable or a header. "Collega" opens the tile in place: only human data (organization, site, email), then a token
// field with a direct link to the page where the token is made and one line on how, or the tool's official sign-in in
// its own window (checked by itself every few seconds). On connect the app tests at once: "Funziona: vedo N progetti"
// or what failed and what to do. Shown in the setup wizard's tools step (FirstInterview.tsx, `onConnected` reports the
// tools that work) and in Settings → Connettori (ConnectorsHub.tsx). Flow: lib/tool-presets.ts; one call at a time
// (main refuses two connector actions at once); a typed token lives only in this component's state until it is sent.
import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../i18n';
import { holdUpdate } from '../lib/update-barrier';
import { POLL_MS } from '../lib/setup-connectors';
import { PRESETS, connectPreset, inputProblems, pollPreset, tileFrom } from '../lib/tool-presets';
import type { PresetField, PresetId, PresetInput, TileState, ToolPort, ToolPreset } from '../lib/tool-presets';
import { IconAlert, IconCheck, IconExternal, IconShield, IconSpinner } from './Icons';
import '../styles/tool-catalog.css';

const port: ToolPort = {
  servers: () => window.sb.invoke('mcpservers:state', undefined),
  saveServer: (def, previousId) => window.sb.invoke('mcpservers:save', { def, ...(previousId ? { previousId } : {}) }),
  setSecret: (id, slot, value) => window.sb.invoke('mcpservers:setSecret', { id, slot, value }),
  testServer: id => window.sb.invoke('mcpservers:test', { id }),
  useToken: value => window.sb.invoke('connectors:useToken', value),
  login: provider => window.sb.invoke('connectors:login', { provider }),
  probe: provider => window.sb.invoke('connectors:probe', { provider }),
};
const TONE: Record<TileState['phase'], 'ok' | 'wait' | 'off' | 'bad'> = { idle: 'off', connecting: 'wait', waiting: 'wait', testing: 'wait', ok: 'ok', failed: 'bad' };
const busyPhase = (s: TileState) => s.phase === 'connecting' || s.phase === 'testing';

function Field({ preset, field, value, problem, onChange }: { preset: ToolPreset; field: PresetField | 'token'; value: string; problem?: 'missing' | 'invalid'; onChange: (v: string) => void }) {
  const id = useId();
  const secret = field === 'token';
  return <div className="tc-field">
    <label htmlFor={id}>{t(`setup.tool.field.${field}`)}</label>
    <input id={id} className="st-input" type={secret ? 'password' : field === 'email' ? 'email' : 'text'} autoComplete={secret ? 'off' : field === 'email' ? 'email' : 'off'} spellCheck={false}
      value={value} placeholder={t(`setup.tool.placeholder.${field}`)} onChange={e => onChange(e.target.value)} aria-invalid={problem === 'invalid' || undefined} data-testid={`tool-${preset.id}-${field}`}/>
    {problem === 'invalid' ? <small className="tc-field-bad" role="alert">{t(`setup.tool.invalid.${field}`)}</small> : !secret && <small>{t(`setup.tool.hint.${field as PresetField}`)}</small>}
  </div>;
}

export function ToolCatalog({ onConnected, toolPort = port }: { onConnected?: (names: string[]) => void; toolPort?: ToolPort }) {
  const [tiles, setTiles] = useState<Partial<Record<PresetId, TileState>>>({});
  const [open, setOpen] = useState<PresetId | null>(null);
  const [input, setInput] = useState<PresetInput>({});
  const [tried, setTried] = useState(false);
  const live = useRef(true), chain = useRef<Promise<unknown>>(Promise.resolve()), tries = useRef<Partial<Record<PresetId, number>>>({});
  const serial = <T,>(task: () => Promise<T>): Promise<T> => { const next = chain.current.then(task, task); chain.current = next.catch(() => {}); return next; };
  const set = (id: PresetId, state: TileState) => { if (live.current) setTiles(x => ({ ...x, [id]: state })); };
  useEffect(() => {
    live.current = true;
    void Promise.all([window.sb.invoke('connectors:list', undefined).catch(() => []), toolPort.servers().catch(() => null)]).then(([accounts, servers]) => {
      if (live.current) setTiles(x => Object.fromEntries(PRESETS.map(p => [p.id, x[p.id] && x[p.id]!.phase !== 'idle' ? x[p.id]! : tileFrom(p, accounts, servers)])));
    });
    return () => { live.current = false; };
  }, [toolPort]);
  // the tools that work, for the wizard's summary
  const okNames = PRESETS.filter(p => tiles[p.id]?.phase === 'ok').map(p => p.name).join(',');
  useEffect(() => { onConnected?.(okNames ? okNames.split(',') : []); }, [okNames]);
  // a typed token keeps an app update from restarting the window under it
  useEffect(() => (input.token ? holdUpdate(t('setup.tool.field.token')) : undefined), [!!input.token]);

  const start = (preset: ToolPreset) => { setOpen(preset.id); setInput({}); setTried(false); };
  const connect = (preset: ToolPreset) => {
    setTried(true);
    if (Object.keys(inputProblems(preset, input)).length) return;
    const typed = { ...input };
    set(preset.id, { phase: 'connecting' }); tries.current[preset.id] = 0;
    void serial(() => connectPreset(toolPort, preset, typed, t(`setup.tool.purpose.${preset.id}`))).then(state => {
      set(preset.id, state);
      // done: the token leaves this component's state; a failure keeps the form (and what was typed) to correct it
      if (state.phase === 'ok' || state.phase === 'waiting') { setOpen(o => o === preset.id ? null : o); setInput({}); }
    });
  };
  // a sign-in in its own window: checked again by itself, and as soon as the owner comes back to this window
  const waiting = PRESETS.filter(p => tiles[p.id]?.phase === 'waiting');
  const poll = useRef((_p: ToolPreset) => {});
  poll.current = (preset: ToolPreset) => {
    const attempt = tries.current[preset.id] ?? 0; tries.current[preset.id] = attempt + 1;
    void serial(() => pollPreset(toolPort, preset, attempt)).then(state => {
      if (!live.current) return;
      setTiles(x => x[preset.id]?.phase === 'waiting' ? { ...x, [preset.id]: state } : x);
    });
  };
  useEffect(() => {
    if (!waiting.length) return;
    const tick = () => { for (const p of waiting) poll.current(p); };
    const timer = setInterval(tick, POLL_MS);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, [waiting.map(p => p.id).join(',')]);

  return <div className="tc" data-testid="tool-catalog">
    <ul className="tc-grid">{PRESETS.map(preset => {
      const state = tiles[preset.id] ?? { phase: 'idle' as const }, isOpen = open === preset.id, busy = busyPhase(state);
      const problems = tried && isOpen ? inputProblems(preset, input) : {};
      return <li key={preset.id} className={`tc-tile is-${TONE[state.phase]}${isOpen ? ' is-open' : ''}`} data-testid={`tool-tile-${preset.id}`} data-phase={state.phase} aria-label={preset.name}>
        <div className="tc-head">
          <span className={`tc-mark tc-mark-${preset.id}`} aria-hidden="true">{preset.mark}</span>
          <b className="tc-name">{preset.name}</b>
          <span className={`sw-pill sw-pill-${TONE[state.phase]}`} role="status" data-testid={`tool-${preset.id}-status`}>{busy || state.phase === 'waiting' ? <IconSpinner size={12}/> : state.phase === 'ok' ? <IconCheck size={12}/> : state.phase === 'failed' ? <IconAlert size={12}/> : <i aria-hidden="true"/>}{t(`setup.tool.status.${state.phase}`)}</span>
          <small className="tc-desc">{t(`setup.tool.desc.${preset.id}`)}</small>
        </div>

        {state.phase === 'ok' && !isOpen && <div className="tc-ok" data-testid={`tool-${preset.id}-ok`}>
          <p><IconCheck size={14}/><span>{t('setup.tool.works', { n: state.projects ?? 0 })}</span></p>
          <small>{t('setup.tool.worksDetail', { account: state.account ?? '', tools: state.tools ?? 0 })}</small>
        </div>}
        {state.phase === 'waiting' && <div className="sw-callout" data-testid={`tool-${preset.id}-waiting`}><p>{t('setup.tool.waiting', { name: preset.name })}</p></div>}
        {state.phase === 'failed' && <div className="tc-bad" role="alert" data-testid={`tool-${preset.id}-bad`}>
          <p><IconAlert size={14}/><span>{state.failed === 'server' ? t('setup.tool.bad.server', { name: preset.name, n: state.projects ?? 0 }) : state.failed === 'keyring' ? t('setup.tool.bad.keyring') : state.failed === 'app' ? t('setup.tool.bad.app', { name: preset.name }) : t('setup.tool.bad.account', { name: preset.name })}</span></p>
          {state.message && <small>{state.failed === 'server' ? state.message : t('setup.tool.reason', { reason: state.message })}</small>}
          <small className="tc-fix">{state.failed === 'server' && state.fix ? state.fix : t(state.failed === 'keyring' ? 'setup.tool.fix.keyring' : state.failed === 'app' ? 'setup.tool.fix.app' : `setup.tool.fix.${preset.id}`)}</small>
        </div>}

        {/* not a <form>: the tile sits inside the wizard's form; Enter in a field connects this tile and never moves the wizard on */}
        {isOpen && <div className="tc-form" role="group" aria-label={preset.name} onKeyDown={e => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement) { e.preventDefault(); e.stopPropagation(); connect(preset); } }} data-testid={`tool-${preset.id}-form`}>
          {preset.fields.length > 0 && <div className="tc-fields">{preset.fields.map(f => <Field key={f} preset={preset} field={f} value={input[f] ?? ''} problem={problems[f]} onChange={v => setInput(x => ({ ...x, [f]: v }))}/>)}</div>}
          {preset.auth === 'token' ? <div className="tc-token">
            <Field preset={preset} field="token" value={input.token ?? ''} problem={problems.token} onChange={v => setInput(x => ({ ...x, token: v }))}/>
            <p className="tc-how"><a href={preset.tokenUrl} target="_blank" rel="noopener noreferrer" data-testid={`tool-${preset.id}-token-link`}>{t(`setup.tool.tokenLink.${preset.id as 'github' | 'jira'}`)}<IconExternal size={12}/></a><span>{t(`setup.tool.tokenHow.${preset.id as 'github' | 'jira'}`)}</span></p>
          </div> : <p className="tc-how tc-how-browser"><span>{t('setup.tool.browser.azure')}</span></p>}
          {(problems.token === 'missing' || preset.fields.some(f => problems[f] === 'missing')) && <small className="tc-field-bad" role="alert">{t('setup.tool.missing')}</small>}
          <div className="tc-actions">
            <button type="button" className="btn btn-m btn-primary" disabled={busy} onClick={() => connect(preset)} data-testid={`tool-${preset.id}-submit`}>{busy ? <><IconSpinner size={13}/>{t(`setup.tool.status.${state.phase}`)}</> : t('setup.tool.submit')}</button>
            <button type="button" className="btn btn-m btn-ghost" disabled={busy} onClick={() => { setOpen(null); setInput({}); }}>{t('setup.tool.cancel')}</button>
          </div>
        </div>}

        {!isOpen && <div className="tc-actions">
          {state.phase === 'idle' && <button type="button" className="btn btn-m btn-primary" onClick={() => start(preset)} aria-label={t('setup.tool.connectAria', { name: preset.name })} data-testid={`tool-${preset.id}-connect`}>{t('setup.tool.connect')}</button>}
          {state.phase === 'failed' && <button type="button" className="btn btn-m btn-primary" onClick={() => start(preset)} data-testid={`tool-${preset.id}-retry`}>{t('setup.tool.retry')}</button>}
          {state.phase === 'waiting' && <button type="button" className="btn btn-m btn-ghost" onClick={() => poll.current(preset)} data-testid={`tool-${preset.id}-check`}>{t('setup.tool.checkNow')}</button>}
          {state.phase === 'ok' && <button type="button" className="btn btn-m btn-ghost" onClick={() => start(preset)} data-testid={`tool-${preset.id}-again`}>{t('setup.tool.again')}</button>}
        </div>}
      </li>;
    })}</ul>
    <p className="sw-note tc-trust"><IconShield size={15}/><span>{t('setup.tool.trust')}</span></p>
  </div>;
}
