// A role's Code Mode and Fast switches on its own page (Agenti → a role, AgentStudio.tsx). Code Mode moved from a
// global setting to each role card on 2026-11-23 (the owner: «la code mode si possa attivare anche al singolo ruolo ...
// e deve funzionare per ogni harness», ADR 0331): on, the role's new chats work through run_code. The line under the
// switch says the real level on the card's engine when it is not full (catalog.models[].codeMode: Claude full; Cursor,
// Antigravity, OpenCode and Codex partial, the hint plus the app refusing native tools; an API engine none, no switch).
// Fast is a Cursor-only launch flag, shown only on a Cursor card. Each flip saves the card at once (agents:save); the
// Orchestrator never runs Code Mode, so it gets no switch. Styles: styles/settings.css (.st-switch).
import { useState } from 'react';
import type { AgentProfile } from '@shared/agents';
import { agentDraftOf } from '../lib/agent-drafts';
import { saveAgent, useAgents } from '../store/agents';
import { t } from '../i18n';
import '../styles/settings.css';

export function RoleCodeMode({ profile, engines }: { profile: AgentProfile; engines?: readonly string[] }) {
  const { catalog } = useAgents();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const level = catalog?.models.find(m => m.engine === profile.engine)?.codeMode ?? 'none';
  const codeMode = profile.id !== 'orchestrator' && level !== 'none';
  // Fast is Cursor's: shown when one of the role's levels runs on Cursor (ADR 0347)
  const fast = (engines ?? [profile.engine]).includes('cursor');
  if (!codeMode && !fast) return null;
  const flip = async (change: { codeMode?: boolean; fast?: boolean }) => {
    setBusy(true); setError(null);
    try { await saveAgent({ ...agentDraftOf(profile), ...change }, profile.id); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const row = (on: boolean, title: string, hint: string, testid: string, onFlip: () => void, note?: string) =>
    <div className="st-row" data-testid={`${testid}-row`}>
      <div className="st-text"><span className="st-title">{title}</span><p className="st-desc">{hint}</p>
        {note && <p className="st-desc" data-testid={`${testid}-level`}>{note}</p>}</div>
      <div className="st-ctl"><button type="button" role="switch" aria-checked={on} aria-label={title} disabled={busy}
        className={`st-switch ${on ? 'on' : ''}`} onClick={onFlip} data-testid={testid}><span className="st-knob" aria-hidden="true" /></button></div>
    </div>;
  const on = !!profile.codeMode, quick = !!profile.fast;
  return <section className="ad-presets" aria-label={t('agentDetail.codeMode')} data-testid="agent-code-mode-section">
    {codeMode && row(on, t('agentDetail.codeMode'), t('agentDetail.codeMode.hint'), 'agent-code-mode', () => void flip({ codeMode: !on }),
      level === 'partial' ? t('agentDetail.codeMode.partial') : undefined)}
    {fast && row(quick, t('agentDetail.fast'), t('agentDetail.fast.hint'), 'agent-fast', () => void flip({ fast: !quick }))}
    {error && <p className="st-presets-error" role="alert" data-testid="agent-code-mode-error">{error}</p>}
  </section>;
}
