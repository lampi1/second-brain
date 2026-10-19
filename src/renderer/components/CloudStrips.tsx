// The cloud agents' strips in the Grindhouse (ADR 0080, issue #79): one strip per agent that runs in a vendor's cloud
// (Cursor, Codex, Claude Code), under the local strips, grouped by area like them (area = the repo's name) with a
// "cloud" badge and the engine. The same reading as a chat's strip: what it is doing (status, last summary or streamed
// message) and what it needs (a follow-up box where the engine takes one, Stop where it stops, "Porta in locale" into a
// new worktree). "Apri" opens the vendor's page in an internal browser tab: the fallback for every capability an engine
// lacks. Collapsed by default; expanding one streams its messages (Cursor). Used by AgentStrips.tsx (Home.tsx).
import { useState, type CSSProperties } from 'react';
import type { CloudAgent, CloudCaps, CloudStatus } from '@shared/contract';
import { CLOUD_ACTIVE } from '@shared/cloud';
import { t, type Key } from '../i18n';
import { ago, formatCost } from '../lib/format';
import { useNow } from '../lib/clock';
import { engineLabel } from '../lib/engines';
import { cloudApply, cloudDismiss, cloudFollowUp, cloudStop, openCloudPage, setCloudExpanded, useCloudAgent, useCloudExpanded, useCloudIds, useCloudState } from '../store/cloud';
import { HarnessMark, IconChevronDown, IconGlobe, IconStop, IconX, IconBranch } from './Icons';
import { ui } from '../store/ui';
import '../styles/cloud-strips.css';

const TONE: Record<CloudStatus, 'run' | 'wait' | 'done' | 'err' | 'off'> = { queued: 'run', running: 'run', waiting: 'wait', done: 'done', failed: 'err', stopped: 'off', unknown: 'off' };

/** The area of a cloud agent: its repo's name ("alfa/alfa-shop" → "alfa-shop"). */
export const cloudArea = (a: Pick<CloudAgent, 'repo'>): string => a.repo.split('/').at(-1) ?? '';

export function CloudBadge() {
  return <span className="cloud-badge" data-tip={t('cloud.badgeTip')}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.2 4.5 4.5 0 0 0 7 18Z" /></svg>
    {t('cloud.badge')}
  </span>;
}

/** The cloud strips, grouped by area; nothing at all when there is no cloud agent. */
export function CloudStrips() {
  const ids = useCloudIds();
  const state = useCloudState();
  const maximized = ui.use(s => s.maximized);
  if (!state || !ids.length || (maximized && maximized !== 'orchestrator')) return null;
  const groups = new Map<string, CloudAgent[]>();
  for (const a of state.agents) groups.set(cloudArea(a), [...(groups.get(cloudArea(a)) ?? []), a]);
  let row = 0;
  return <div className="cloud-strips" data-testid="cloud-strips">
    {[...groups].map(([area, list]) => <div className="cloud-group" key={area || '-'}>
      <h3 className="workspace-area">{t('cloud.area', { area: area || t('product.noArea') })}</h3>
      {list.map(a => <div className="agent-pane-wrap" key={`${a.engine}:${a.id}`} style={{ '--row-index': Math.min(row++, 8) } as CSSProperties}><CloudStrip id={a.id} caps={state.caps[a.engine]} /></div>)}
    </div>)}
  </div>;
}

function CloudStrip({ id, caps }: { id: string; caps: CloudCaps }) {
  const a = useCloudAgent(id);
  const expanded = useCloudExpanded(id);
  const now = useNow(30_000);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!a) return null;
  const tone = TONE[a.status], running = CLOUD_ACTIVE.includes(a.status);
  const engine = engineLabel(a.engine);
  const last = a.messages?.filter(m => m.kind === 'assistant').at(-1)?.text;
  const line = a.error ?? last ?? a.summary ?? (a.engine === 'claude' ? t('cloud.noOutput') : '');
  const cost = a.engine === 'cursor' ? (a.costUsd !== undefined ? formatCost(a.costUsd) : null) : t('cloud.fromPlan');
  const canApply = caps.apply && (a.engine === 'codex' ? a.status === 'done' : !!a.branch) && !!a.cwd;
  const toggle = () => setCloudExpanded(id, !expanded);
  const onStripClick = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.target as Element;
    if (el.closest('button, a, input, textarea, select, label')) return;
    if (window.getSelection()?.toString()) return;
    if (!expanded) setCloudExpanded(id, true);
    else if (el.closest('.tile-head')) setCloudExpanded(id, false);
  };
  const send = async () => {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    if (await cloudFollowUp(id, v)) setText('');
    setBusy(false);
  };
  return <section className={`tile cloud-strip tone-${tone} ${expanded ? 'is-expanded' : 'is-strip'}`} role="region" aria-label={`${a.title} · ${t(`cloud.status.${a.status}` as Key)}`}
    data-testid={`cloud-strip-${id}`} data-engine={a.engine} data-state={a.status} onClick={onStripClick}>
    <header className="tile-head">
      <div className="th-row">
        <HarnessMark harness={a.engine} size={22} />
        <h3 className="th-title" title={a.title}>{a.title}</h3>
        <CloudBadge />
        <span className={`pill pill-${tone}`} data-testid={`cloud-state-${id}`}>{(tone === 'run' || tone === 'wait') && <span className="pill-dot" aria-hidden="true" />}{t(`cloud.status.${a.status}` as Key)}</span>
        <div className="chat-header-actions">
          {a.url && <button type="button" className="btn btn-subtle btn-s" data-tip={t('cloud.openTip')} onClick={() => void openCloudPage(a)} data-testid={`cloud-open-${id}`}><IconGlobe size={13} />{t('cloud.open')}</button>}
          {caps.stop && running && <button type="button" className="icon-btn" aria-label={t('cloud.stop')} data-tip={t('cloud.stop')} onClick={() => void cloudStop(id)} data-testid={`cloud-stop-${id}`}><IconStop size={14} /></button>}
          <button type="button" className="icon-btn chat-expand" aria-expanded={expanded} aria-label={t(expanded ? 'cloud.collapse' : 'cloud.expand')} data-tip={t(expanded ? 'cloud.collapse' : 'cloud.expand')} onClick={toggle} data-testid={`cloud-expand-${id}`}><IconChevronDown size={14} /></button>
        </div>
      </div>
      <div className="th-sub strip-facts" data-testid={`cloud-sub-${id}`}>
        <span className="th-sub-text">{engine}{a.branch ? <> · <IconBranch size={11} /> {a.branch}</> : null}{cost ? ` · ${cost}` : ''} · {ago(a.updatedAt, now)} · {t(`cloud.by.${a.by}` as Key)}</span>
      </div>
    </header>
    {!expanded && line && <div className="chat-strip-line" data-testid={`cloud-line-${id}`}>{line.slice(0, 160)}</div>}
    {expanded && <div className="cloud-work" data-testid={`cloud-work-${id}`}>
      {caps.stream && <ol className="cloud-messages" aria-live="polite">
        {a.messages?.length ? a.messages.map(m => <li key={m.id} className={`cloud-msg cloud-msg-${m.kind}`}>{m.kind === 'tool' ? <code>{m.text}</code> : m.text}</li>) : <li className="cloud-msg cloud-msg-status">{t('cloud.noMessages')}</li>}
      </ol>}
      {!caps.stream && <p className="cloud-note">{a.summary ?? t('cloud.noOutput')}</p>}
      {a.error && <p className="field-error" role="alert">{a.error}</p>}
      {caps.followUp
        ? <form className="cloud-follow" onSubmit={e => { e.preventDefault(); void send(); }}>
            <input className="cloud-input" value={text} onChange={e => setText(e.target.value)} placeholder={t('cloud.followUp')} aria-label={t('cloud.followUp')} maxLength={8000} data-testid={`cloud-input-${id}`} />
            <button type="submit" className="btn btn-primary btn-s" disabled={busy || !text.trim()} data-testid={`cloud-send-${id}`}>{t('cloud.send')}</button>
          </form>
        : <p className="cloud-note">{t('cloud.webOnly', { engine })}</p>}
      <div className="cloud-actions">
        {canApply && <button type="button" className="btn btn-ghost btn-s" data-tip={t('cloud.applyTip')} onClick={() => void cloudApply(id)} data-testid={`cloud-apply-${id}`}>{t('cloud.apply')}</button>}
        {(!running || a.engine === 'claude') && <button type="button" className="btn btn-subtle btn-s" onClick={() => void cloudDismiss(id)} data-testid={`cloud-dismiss-${id}`}><IconX size={12} />{t('cloud.dismiss')}</button>}
      </div>
    </div>}
  </section>;
}
