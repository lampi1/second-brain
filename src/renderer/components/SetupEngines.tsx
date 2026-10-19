// The "La tua IA" step of the first-run setup wizard (FirstInterview.tsx): one card per built-in engine (Claude Code,
// Codex, Cursor) with what this computer says about it, a "Collega" that opens the engine's official sign-in in its own
// window (typed IPC engines:trust + cli:login) and then WAITS on this same step, checking by itself every few seconds
// and on coming back to the window (cli:status, no tokens), with a "Verifica" and a reopen; a connected card says when
// and how it was checked. Why: the owner clicked the old "Collega la tua
// IA" and the setup closed (2026-10-18); here nothing navigates away or closes the modal. Credentials never pass here.
import { useEffect, useRef, useState } from 'react';
import { sb } from '../sb';
import { locale, t } from '../i18n';
import { useApp } from '../store/store';
import { HarnessMark, IconAlert, IconCheck, IconRefresh, IconShield, IconSpinner } from './Icons';
import { ENGINE_POLL_MS, ENGINE_POLL_TRIES, SETUP_ENGINES, canSignIn, linkFromStatus, openSignIn, verifySignIn } from '../lib/setup-wizard';
import type { EngineLink, EngineLinkPort, SetupEngineId } from '../lib/setup-wizard';

const NAMES: Record<SetupEngineId, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' };
const port: EngineLinkPort = {
  status: engine => sb.invoke('cli:status', { harness: engine, checkLogin: true }),
  trust: engine => sb.invoke('engines:trust', { engine }),
  login: engine => sb.invoke('cli:login', { harness: engine }),
};
const TONE: Record<EngineLink['phase'], 'ok' | 'wait' | 'off' | 'warn'> = { checking: 'wait', missing: 'off', signedOut: 'warn', unknown: 'warn', opening: 'wait', waiting: 'wait', verifying: 'wait', connected: 'ok', error: 'warn' };

export function SetupEngines({ engines, onUse }: { engines: string[]; onUse: (engine: SetupEngineId, on: boolean) => void }) {
  const defined = useApp(s => s.info?.engines);
  const [links, setLinks] = useState<Partial<Record<SetupEngineId, EngineLink>>>({});
  const live = useRef(true);
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
  const connected = (engine: SetupEngineId, link: EngineLink) => { set(engine, link); if (link.phase === 'connected' && !engines.includes(engine)) onUse(engine, true); };
  const connect = async (engine: SetupEngineId) => {
    tries.current[engine] = 0;
    set(engine, { phase: 'opening' });
    set(engine, await openSignIn(port, engine));
  };
  const verify = async (engine: SetupEngineId) => {
    set(engine, { ...links[engine], phase: 'verifying' });
    connected(engine, await verifySignIn(port, engine));
  };
  // while a sign-in window is open: checked by itself every few seconds and when the owner comes back to this window,
  // so "Collegata" appears without a click (Verifica stays for an explicit check); applied only while it still waits
  const waiting = SETUP_ENGINES.filter(e => links[e]?.phase === 'waiting');
  const tries = useRef<Partial<Record<SetupEngineId, number>>>({});
  const poll = useRef((_e: SetupEngineId) => {});
  poll.current = (engine: SetupEngineId) => {
    const n = (tries.current[engine] ?? 0) + 1; tries.current[engine] = n;
    if (n > ENGINE_POLL_TRIES) return;
    void verifySignIn(port, engine).then(link => {
      if (!live.current) return;
      setLinks(l => l[engine]?.phase === 'waiting' ? { ...l, [engine]: link } : l);
      if (link.phase === 'connected' && !engines.includes(engine)) onUse(engine, true);
    });
  };
  useEffect(() => {
    if (!waiting.length) return;
    const tick = () => { for (const e of waiting) poll.current(e); };
    const timer = setInterval(tick, ENGINE_POLL_MS);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, [waiting.join(',')]);
  const busy = SETUP_ENGINES.some(e => ['checking', 'opening', 'verifying'].includes(links[e]?.phase ?? 'checking'));
  return <div className="sw-engines" data-testid="setup-engines">
    <div className="sw-engine-list">{SETUP_ENGINES.map(engine => {
      const link = links[engine] ?? { phase: 'checking' as const }, name = NAMES[engine], on = engines.includes(engine);
      const pending = link.phase === 'opening' || link.phase === 'verifying' || link.phase === 'checking';
      return <article key={engine} className={`sw-engine ${link.phase === 'connected' ? 'is-ok' : ''} ${link.phase === 'waiting' ? 'is-waiting' : ''}`} aria-label={name} data-testid={`setup-engine-${engine}`} data-phase={link.phase}>
        <header className="sw-engine-head">
          <HarnessMark harness={engine} size={30}/>
          <div className="sw-engine-name"><b>{name}</b><span className={`sw-pill sw-pill-${TONE[link.phase]}`} role="status">{pending ? <IconSpinner size={12}/> : link.phase === 'connected' ? <IconCheck size={12}/> : <i aria-hidden="true"/>}{t(`setup.ai.status.${link.phase}`)}</span></div>
        </header>
        {link.account && <p className="sw-engine-account">{t('setup.ai.account', { account: link.account })}</p>}
        {link.phase === 'connected' && link.checkedAt && <p className="sw-engine-account" data-testid={`setup-engine-${engine}-checked`}>{t('setup.ai.checked', { at: new Date(link.checkedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }), name })}</p>}
        {link.phase === 'missing' && <p className="sw-engine-note">{t('setup.ai.missingHint')}</p>}
        {(link.phase === 'waiting' || link.phase === 'verifying') && <div className="sw-callout" data-testid={`setup-engine-${engine}-waiting`}>
          <p>{t('setup.ai.waiting', { name })}</p>
          {link.note === 'notYet' && <p className="sw-callout-warn"><IconAlert size={14}/>{t('setup.ai.notYet')}</p>}
          {link.error && <p className="sw-callout-warn" role="alert"><IconAlert size={14}/>{link.error}</p>}
        </div>}
        {link.phase === 'unknown' && link.note === 'unverifiable' && <p className="sw-engine-note">{t('setup.ai.unverifiable')}</p>}
        {link.phase === 'error' && link.error && <p className="sw-engine-note sw-callout-warn" role="alert"><IconAlert size={14}/>{link.error}</p>}
        <div className="sw-engine-actions">
          {canSignIn(link) && <button type="button" className="btn btn-m btn-primary" aria-label={t('setup.ai.connectAria', { name })} data-testid={`setup-connect-${engine}`} onClick={() => void connect(engine)}>{t('setup.ai.connect')}</button>}
          {(link.phase === 'waiting' || link.phase === 'verifying') && <>
            <button type="button" className="btn btn-m btn-primary" aria-label={t('setup.ai.verifyAria', { name })} data-testid={`setup-verify-${engine}`} disabled={link.phase === 'verifying'} onClick={() => void verify(engine)}>{t('setup.ai.verify')}</button>
            <button type="button" className="btn btn-m btn-ghost" disabled={link.phase === 'verifying'} onClick={() => void connect(engine)}>{t('setup.ai.reopen')}</button>
          </>}
          {link.phase !== 'missing' && link.phase !== 'checking' && <label className="sw-check"><input type="checkbox" checked={on} onChange={e => onUse(engine, e.target.checked)} data-testid={`setup-use-${engine}`}/>{t('setup.ai.use')}</label>}
        </div>
      </article>;
    })}</div>
    <div className="sw-engines-foot">
      <p className="sw-note"><IconShield size={15}/>{t('setup.ai.trust')}</p>
      <button type="button" className="btn btn-m btn-subtle" disabled={busy} onClick={scan}><IconRefresh size={14}/>{t('setup.ai.rescan')}</button>
    </div>
    <p className="sw-hint">{t('setup.ai.optional')}</p>
  </div>;
}
