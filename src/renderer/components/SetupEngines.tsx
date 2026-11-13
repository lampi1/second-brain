// The second moment of the first-run setup (FirstInterview.tsx, ADR 0279): «Collega la tua AI». The app looks by itself
// for the engines installed on this computer (Claude Code, Codex, Cursor, OpenCode: cli:status, no tokens) and lists
// them as one row each: what this computer says («installato · già connesso»), and one action. An engine already
// signed in is put in use with no click, the proposed one first (lib/setup-wizard.ts autoEngines); a row's radio makes
// it the one the Orchestrator starts on. «Accedi» opens the engine's official sign-in in its own window (typed IPC
// engines:trust + cli:login) and the row WAITS in place, checking by itself every few seconds and on coming back to
// the window, with a «Verifica». Engines not found share one quiet line. Why: the owner clicked the old "Collega la
// tua IA" and the setup closed (2026-10-18); here nothing navigates away or closes the modal. Credentials never pass here.
import { useEffect, useRef, useState } from 'react';
import { sb } from '../sb';
import { t } from '../i18n';
import { useApp } from '../store/store';
import { HarnessMark, IconAlert, IconCheck, IconRefresh, IconSpinner } from './Icons';
import { ENGINE_NAMES, ENGINE_POLL_MS, ENGINE_POLL_TRIES, SETUP_ENGINES, autoEngines, canSignIn, linkFromStatus, openSignIn, usable, verifySignIn, withEngine, withPrimary } from '../lib/setup-wizard';
import type { EngineLink, EngineLinkPort, SetupEngineId } from '../lib/setup-wizard';

const port: EngineLinkPort = {
  status: engine => sb.invoke('cli:status', { harness: engine, checkLogin: true }),
  trust: engine => sb.invoke('engines:trust', { engine }),
  login: engine => sb.invoke('cli:login', { harness: engine }),
};
const PENDING: readonly EngineLink['phase'][] = ['checking', 'opening', 'verifying'];

export function SetupEngines({ engines, onChange, onSettled }: { engines: string[]; onChange: (next: string[]) => void; onSettled?: (settled: boolean) => void }) {
  const defined = useApp(s => s.info?.engines);
  const [links, setLinks] = useState<Partial<Record<SetupEngineId, EngineLink>>>({});
  const live = useRef(true);
  // the latest choice, read where a check lands later than the render that started it
  const chosen = useRef(engines); chosen.current = engines;
  const set = (engine: SetupEngineId, link: EngineLink) => { if (live.current) setLinks(l => ({ ...l, [engine]: link })); };
  const available = (engine: SetupEngineId) => !!defined?.some(e => e.id === engine && e.source === 'app');
  const scan = () => {
    for (const engine of SETUP_ENGINES) {
      if (!available(engine)) { set(engine, { phase: 'missing' }); continue; }
      set(engine, { phase: 'checking' });
      void port.status(engine).then(s => set(engine, linkFromStatus(s)), () => set(engine, linkFromStatus(null)));
    }
  };
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { if (defined) scan(); }, [!!defined]);
  const use = (engine: SetupEngineId) => { if (!chosen.current.includes(engine)) onChange(withEngine(chosen.current, engine, true)); };
  const connect = async (engine: SetupEngineId) => {
    tries.current[engine] = 0;
    set(engine, { phase: 'opening' });
    set(engine, await openSignIn(port, engine));
  };
  const verify = async (engine: SetupEngineId) => {
    set(engine, { ...links[engine], phase: 'verifying' });
    const link = await verifySignIn(port, engine);
    set(engine, link);
    if (link.phase === 'connected') use(engine);
  };
  // while a sign-in window is open: checked by itself every few seconds and when the owner comes back to this window,
  // so «già connesso» appears without a click (Verifica stays for an explicit check); applied only while it still waits
  const waiting = SETUP_ENGINES.filter(e => links[e]?.phase === 'waiting');
  const tries = useRef<Partial<Record<SetupEngineId, number>>>({});
  const poll = useRef((_e: SetupEngineId) => {});
  poll.current = (engine: SetupEngineId) => {
    const n = (tries.current[engine] ?? 0) + 1; tries.current[engine] = n;
    if (n > ENGINE_POLL_TRIES) return;
    void verifySignIn(port, engine).then(link => {
      if (!live.current) return;
      setLinks(l => l[engine]?.phase === 'waiting' ? { ...l, [engine]: link } : l);
      if (link.phase === 'connected') use(engine);
    });
  };
  useEffect(() => {
    if (!waiting.length) return;
    const tick = () => { for (const e of waiting) poll.current(e); };
    const timer = setInterval(tick, ENGINE_POLL_MS);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, [waiting.join(',')]);
  const busy = SETUP_ENGINES.some(e => PENDING.includes(links[e]?.phase ?? 'checking'));
  // once every engine has been checked: the ones already signed in are put in use by themselves, and a choice this
  // computer no longer backs (uninstalled, signed out) leaves, so «Continua con …» never names an engine that cannot start
  const settled = SETUP_ENGINES.every(e => links[e] && links[e]!.phase !== 'checking');
  // «out» = a phase no first request can start on and no sign-in is running for: a choice in it leaves at once (a
  // failed «Accedi» on the chosen engine included)
  const out = SETUP_ENGINES.filter(e => ['missing', 'signedOut', 'error'].includes(links[e]?.phase ?? '')).join();
  useEffect(() => {
    onSettled?.(settled);
    if (!settled) return;
    const kept = chosen.current.filter(e => !(SETUP_ENGINES as readonly string[]).includes(e) || !out.split(',').includes(e));
    const next = autoEngines(links, kept) ?? kept;
    if (next.join() !== chosen.current.join()) onChange(next);
  }, [settled, out]);
  const found = SETUP_ENGINES.filter(e => (links[e]?.phase ?? 'checking') !== 'missing'), absent = SETUP_ENGINES.filter(e => links[e]?.phase === 'missing');
  const primary = engines[0];
  const row = (engine: SetupEngineId) => {
    const link = links[engine] ?? { phase: 'checking' as const }, name = ENGINE_NAMES[engine], first = primary === engine;
    const pending = PENDING.includes(link.phase), wait = link.phase === 'waiting' || link.phase === 'verifying';
    return <li key={engine} className={`sw-ai${first ? ' is-primary' : ''}${wait ? ' is-waiting' : ''}`} data-testid={`setup-engine-${engine}`} data-phase={link.phase} data-primary={first || undefined}>
      <label className="sw-ai-pick">
        <input type="radio" name="sw-ai" checked={first} disabled={!usable(link)} onChange={() => onChange(withPrimary(engines, engine))} aria-label={t('setup.ai.pickAria', { name })} data-testid={`setup-use-${engine}`}/>
        <HarnessMark harness={engine} size={34}/>
        <span className="sw-ai-text">
          <b>{name}</b>
          <small role="status">{pending && <IconSpinner size={11}/>}{t(`setup.ai.status.${link.phase}`)}{link.phase === 'connected' && link.account ? ` · ${link.account}` : ''}</small>
        </span>
      </label>
      <span className="sw-ai-actions">
        {link.phase === 'connected' && <span className="sw-ready" data-testid={`setup-engine-${engine}-ready`}><IconCheck size={12}/>{t('setup.ai.ready')}</span>}
        {canSignIn(link) && <button type="button" className={`btn btn-m ${primary ? 'btn-ghost' : 'btn-primary'}`} aria-label={t('setup.ai.connectAria', { name })} data-testid={`setup-connect-${engine}`} onClick={() => void connect(engine)}>{t('setup.ai.connect')}</button>}
        {wait && <>
          <button type="button" className="btn btn-m btn-ghost" disabled={link.phase === 'verifying'} onClick={() => void connect(engine)}>{t('setup.ai.reopen')}</button>
          <button type="button" className="btn btn-m btn-primary" aria-label={t('setup.ai.verifyAria', { name })} data-testid={`setup-verify-${engine}`} disabled={link.phase === 'verifying'} onClick={() => void verify(engine)}>{t('setup.ai.verify')}</button>
        </>}
      </span>
      {wait && <p className="sw-ai-note" data-testid={`setup-engine-${engine}-waiting`}>{t('setup.ai.waiting', { name })}{link.note === 'notYet' && <span className="sw-warn"><IconAlert size={13}/>{t('setup.ai.notYet')}</span>}{link.error && <span className="sw-warn" role="alert"><IconAlert size={13}/>{link.error}</span>}</p>}
      {link.phase === 'unknown' && <p className="sw-ai-note">{t('setup.ai.unverifiable')}</p>}
      {link.phase === 'error' && link.error && <p className="sw-ai-note"><span className="sw-warn" role="alert"><IconAlert size={13}/>{link.error}</span></p>}
    </li>;
  };
  return <div className="sw-ais" data-testid="setup-engines" data-settled={settled || undefined}>
    {found.length > 0 && <ul className="sw-ai-list" role="radiogroup" aria-label={t('setup.ai.group')}>{found.map(row)}</ul>}
    {settled && !found.length && <div className="sw-ai-none" data-testid="setup-engines-none"><b>{t('setup.ai.noneTitle')}</b><p>{t('setup.ai.noneHint')}</p></div>}
    <div className="sw-ai-foot">
      <p data-testid="setup-engines-absent">{absent.length > 0 && found.length > 0 ? t('setup.ai.absent', { names: absent.map(e => ENGINE_NAMES[e]).join(', ') }) : ''}</p>
      <button type="button" className="btn btn-m btn-subtle" disabled={busy} onClick={scan} data-testid="setup-rescan"><IconRefresh size={14}/>{t('setup.ai.rescan')}</button>
    </div>
  </div>;
}
