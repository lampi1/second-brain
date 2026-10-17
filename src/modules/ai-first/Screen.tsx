// IA first: installation is not login, and login is not proof. Only a real completed reply opens the guided chat.
import { useEffect, useRef, useState } from 'react';
import type { SetupGuide } from '../../shared/agents';
import { HarnessMark, IconCheck, IconShield } from '../../renderer/components/Icons';
import type { AiSetupPort, EngineOption } from './contract';
import { aiCopy } from './i18n';
import { engineNames } from './model';
import type { SetupEngine } from './model';
import '../../renderer/styles/genui.css';
import './styles.css';
export function AiSetupScreen({ port, language, guide, onFallback }: { port: AiSetupPort; language: 'it' | 'en'; guide?: SetupGuide; onFallback: () => void }) {
  const t = aiCopy[language];
  const [choices, setChoices] = useState<EngineOption[]>([]), [root, setRoot] = useState<string | null>(null), [busy, setBusy] = useState(true), [trying, setTrying] = useState<SetupEngine | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const working = useRef(false), active = useRef<AbortController | null>(null), live = useRef(true), bootstrap = useRef<Promise<{ root: string | null; engines: EngineOption[] }> | null>(null);
  const refresh = async () => {
    if (working.current) return;
    setBusy(true); setError('');
    try {
      const value = await (bootstrap.current ??= port.bootstrap());
      if (live.current) { setChoices(value.engines); setRoot(value.root); if (!value.root) setError(t.memoryError); }
    } catch { if (live.current) setError(t.error); }
    finally { bootstrap.current = null; if (live.current) setBusy(false); }
  };
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false; active.current?.abort(); }; }, [port]);
  const login = async (engine: SetupEngine) => {
    if (working.current || busy) return;
    working.current = true; setBusy(true); setError('');
    try { await port.login(engine); if (live.current) setNotice(t.loginOpened); }
    catch { if (live.current) setError(t.error); }
    finally { working.current = false; if (live.current) setBusy(false); }
  };
  const connect = async (engine: SetupEngine, existingChat?: string) => {
    if (working.current || busy || (!root && !existingChat)) return;
    const abort = new AbortController(); active.current = abort; working.current = true; setBusy(true); setTrying(engine); setError(''); setNotice('');
    let chatId: string | null = null;
    try {
      chatId = existingChat ?? await port.start(engine, root!);
      await port.persist({ stage: 'connecting', engine, chatId });
      await port.prove(chatId, abort.signal);
      if (abort.signal.aborted || !live.current) return;
      await port.persist({ stage: 'guided', engine, chatId });
      if (!live.current || abort.signal.aborted) return;
      setNotice(t.verified); port.open(chatId);
    } catch (e) {
      if (chatId) await port.cancel(chatId).catch(() => {});
      if (live.current) setError(e instanceof Error && e.message === 'AI_SETUP_TIMEOUT' ? t.timeout : abort.signal.aborted ? t.cancelled : t.error);
    } finally { working.current = false; active.current = null; if (live.current) { setBusy(false); setTrying(null); } }
  };
  const fallback = async () => {
    if (working.current || busy) return;
    working.current = true; setBusy(true);
    try { await port.persist({ stage: 'fallback' }); onFallback(); }
    catch { setError(t.error); }
    finally { working.current = false; if (live.current) setBusy(false); }
  };
  return <section className="ai-first" aria-labelledby="ai-first-title" aria-busy={busy} data-testid="ai-first-setup">
    <header><span className="ai-first-eyebrow">SECOND-BRAIN</span><h2 id="ai-first-title">{t.title}</h2><p>{t.intro}</p></header>
    {choices.length ? <div className="gu-cards ai-engine-cards">{choices.map(choice => {
      const found = choice.status?.found === true;
      return <article className={`gu-card ${trying === choice.id ? 'rec' : ''}`} key={choice.id}><div className="gu-card-head"><HarnessMark harness={choice.id} size={36}/><b>{engineNames[choice.id]}</b></div><span className={`gu-status ${found ? 'gu-ok' : 'gu-info'}`}><i aria-hidden="true"/>{choice.status === null ? t.unknown : found ? t.found : t.missing}</span><p className="gu-card-sum">{found ? choice.status?.loggedIn === false ? t.needsLogin : choice.status?.loggedIn === true ? t.known : t.ready : t.unknown}</p><div className="ai-engine-actions"><button type="button" className="btn btn-primary" aria-label={`${t.connect} ${choice.label}`} data-testid={`ai-connect-${choice.id}`} disabled={busy || !found || !root || !choice.runs} onClick={() => void connect(choice.id)}>{t.connect}</button><button type="button" className="btn btn-ghost" aria-label={`${t.login} ${choice.label}`} data-testid={`ai-login-${choice.id}`} disabled={busy || !found || !choice.runs} onClick={() => void login(choice.id)}>{t.login}</button></div><details><summary>{t.details}</summary><code>{choice.runs}</code></details></article>;
    })}</div> : <p className="ai-first-loading" role="status">{t.checking}</p>}
    <p className="ai-first-note"><IconShield size={18}/>{t.trial}</p><p className="ai-first-memory">{t.memory}</p>
    {trying && <div className="ai-first-wait" role="status"><span>{engineNames[trying]} · {t.waiting}</span><button className="btn" type="button" onClick={() => active.current?.abort()}>{t.cancel}</button></div>}
    {guide && guide.stage === 'guided' && <button className="btn" type="button" disabled={busy} onClick={() => port.open(guide.chatId)}><IconCheck size={18}/>{t.resume}</button>}
    {guide && guide.stage === 'connecting' && <button className="btn" type="button" disabled={busy} onClick={() => void connect(guide.engine, guide.chatId)}>{t.retryTrial}</button>}
    {error && <p role="alert" className="ai-first-error">{error}</p>}{notice && <p role="status" className="ai-first-notice">{notice}</p>}
    <footer><div><button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void fallback()} data-testid="ai-setup-fallback">{t.fallback}</button><p>{t.fallbackHint}</p></div><button className="btn" type="button" disabled={busy} onClick={() => void refresh()}>{t.refresh}</button></footer>
  </section>;
}
