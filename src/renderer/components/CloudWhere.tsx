// "Dove: Locale / Cloud" in Nuovo agente (ADR 0080): Cloud starts the task as an agent in a vendor's cloud instead of a
// chat on this PC. Each engine (Cursor, Codex, Claude Code) is offered only when its readiness passes for the chosen
// folder (cloud:readiness: key or sign-in, a GitHub remote, a pushed branch), with what it costs (Cursor at API
// prices in the budget, the others from the plan) and, for Codex, its cloud environment id. Used by AgentStartDialog.tsx ("Nuovo agente", Ctrl+N).
import { useEffect, useState } from 'react';
import type { CloudEngine } from '@shared/contract';
import { CLOUD_ENGINES } from '@shared/cloud';
import { t } from '../i18n';
import { engineName } from '../lib/engines';
import { HarnessMark } from './Icons';
import '../styles/cloud-strips.css';

export type Where = 'local' | 'cloud';
type Ready = Partial<Record<CloudEngine, { ok: boolean; why?: string }>>;

export function CloudWhere({ cwd, where, onWhere, engine, onEngine, env, onEnv }: {
  cwd: string; where: Where; onWhere: (w: Where) => void; engine: CloudEngine | null; onEngine: (e: CloudEngine | null) => void; env: string; onEnv: (v: string) => void;
}) {
  const [ready, setReady] = useState<Ready | null>(null);
  useEffect(() => {
    if (where !== 'cloud') return;
    let live = true;
    setReady(null);
    const timer = setTimeout(() => {
      void window.sb.invoke('cloud:readiness', { cwd: cwd.trim() }).then(r => {
        if (!live) return;
        setReady(r as Ready);
        const first = CLOUD_ENGINES.find(e => r[e]?.ok);
        if (!engine || !r[engine]?.ok) onEngine(first ?? null);
      }, () => { if (live) setReady({}); });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [where, cwd]);
  return <div className="cloud-where" data-testid="newchat-where">
    <div className="field">
      <span>{t('cloud.where')}</span>
      {/* the app's segmented control (ui.tsx Segmented's markup and classes) */}
      <div className="segmented" role="radiogroup" aria-label={t('cloud.where')} data-testid="newchat-where-pick">
        {(['local', 'cloud'] as const).map(w => <button key={w} type="button" role="radio" aria-checked={where === w} className={where === w ? 'on' : ''} onClick={() => onWhere(w)} data-testid={`newchat-where-pick-${w}`}>
          <span>{t(w === 'local' ? 'cloud.whereLocal' : 'cloud.whereCloud')}</span></button>)}
      </div>
      {where === 'cloud' && <small>{t('cloud.whereHint')}</small>}
    </div>
    {where === 'cloud' && <>
      <div className="harness-pick" role="radiogroup" aria-label={t('cloud.engine')}>
        {CLOUD_ENGINES.map(e => {
          const r = ready?.[e], ok = r?.ok === true;
          return <button key={e} type="button" role="radio" aria-checked={engine === e} aria-disabled={!ok} className={`harness-card ${engine === e ? 'on' : ''}`} data-testid={`newchat-cloud-${e}`}
            onClick={() => { if (ok) onEngine(e); }} title={r?.why}>
            <HarnessMark harness={e} size={28} />
            <span><b>{engineName(e)}</b><small>{!ready ? t('cloud.checking') : ok ? `${t('cloud.ready')} · ${t(e === 'cursor' ? 'cloud.cost.cursor' : 'cloud.cost.plan')}` : r?.why ?? '—'}</small></span>
          </button>;
        })}
      </div>
      {ready && !CLOUD_ENGINES.some(e => ready[e]?.ok) && <p className="field-error" role="status" data-testid="newchat-cloud-none">{t('cloud.notReady')}</p>}
      {engine === 'codex' && <label className="field"><span>{t('cloud.env')} <small>{t('cloud.envHint')}</small></span>
        <input value={env} onChange={e => onEnv(e.target.value)} data-testid="newchat-cloud-env" spellCheck={false} /></label>}
    </>}
  </div>;
}
