// Impostazioni → Avanzate, its own block (anchor #st-worktree-pool): the reused worktree pool of the delegated chats (main/agents/worktree-pool.ts, ADR 0227).
// Shows the limits (worktrees per repository, in total, disk cap in GB; settings keys worktreePoolPerRepo, worktreePoolTotal,
// worktreeDiskCapGb, saved through settings:set, protected from agents), the space the app's worktrees take in each known
// repository ('worktrees:usage'), the ones never removed because they hold work (changes, unpushed commits) and a
// «Pulisci ora» button ('worktrees:cleanup'). The automatic cleanup (every 6 h) only measures until the user's first
// «Pulisci ora» (usage.auto, the user's decision in ADR 0227). Mounted by SettingsPage.tsx in the advanced section,
// a separate component from its sibling blocks there.
import { useEffect, useState } from 'react';
import type { WorktreeUsage } from '@shared/contract';
import { setSetting, useApp } from '../store/store';
import { toast } from '../store/ui';
import { t } from '../i18n';
import { fmtSize } from '../lib/settings-page';

const LIMITS = [
  { key: 'worktreePoolPerRepo', label: 'worktrees.perRepo', min: 1, max: 50 },
  { key: 'worktreePoolTotal', label: 'worktrees.total', min: 1, max: 200 },
  { key: 'worktreeDiskCapGb', label: 'worktrees.diskGb', min: 1, max: 2000 },
] as const;
type LimitKey = typeof LIMITS[number]['key'];
const LIMIT_FIELD = { worktreePoolPerRepo: 'perRepo', worktreePoolTotal: 'total', worktreeDiskCapGb: 'diskGb' } as const satisfies Record<LimitKey, keyof WorktreeUsage['limits']>;

export function WorktreeSettings() {
  const settings = useApp(s => s.settings);
  const [usage, setUsage] = useState<WorktreeUsage | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async (refresh: boolean) => {
    setBusy(true);
    try { setUsage(await window.sb.invoke('worktrees:usage', { refresh })); }
    catch { toast(t('essential.error'), 'err'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(false); }, []);
  const clean = async () => {
    setBusy(true);
    try { const u = await window.sb.invoke('worktrees:cleanup', undefined); setUsage(u); toast(t('worktrees.cleaned', { n: u.lastCleanup?.removed ?? 0 }), 'ok'); }
    catch { toast(t('essential.error'), 'err'); }
    finally { setBusy(false); }
  };
  if (!settings) return null;
  const reported = usage?.repos.flatMap(r => r.reported) ?? [];
  return <>
    <div className="st-row st-row-block" id="st-worktree-pool" data-testid="st-worktrees">
      <div className="st-text">
        <b className="st-title">{t('worktrees.title')}</b>
        <p className="st-desc">{t('worktrees.hint')}</p>
        {usage && <p className="st-desc" data-testid="st-worktrees-total">{t('worktrees.totalUsed', { size: fmtSize(usage.totalBytes), cap: usage.limits.diskGb })}
          {usage.lastCleanup && <>{' · '}{t('worktrees.last', { n: usage.lastCleanup.removed, at: new Date(usage.lastCleanup.at).toLocaleString() })}</>}</p>}
        {usage && <p className="st-desc" data-testid="st-worktrees-auto">{t(usage.auto ? 'worktrees.autoOn' : 'worktrees.autoOff')}</p>}
      </div>
      <div className="st-ctl">
        <button type="button" className="btn btn-ghost btn-m" disabled={busy} onClick={() => void load(true)} data-testid="st-worktrees-measure">{busy ? t('worktrees.measuring') : t('worktrees.measure')}</button>
        <button type="button" className="btn btn-ghost btn-m" disabled={busy || usage?.running} onClick={() => void clean()} data-testid="st-worktrees-clean">{t('worktrees.clean')}</button>
      </div>
      {usage && (usage.repos.length === 0 ? <p className="st-desc">{t('worktrees.none')}</p>
        : <div className="st-tiers" role="table" aria-label={t('worktrees.title')} data-testid="st-worktrees-repos">
          <div className="st-tiers-row st-tiers-head" role="row"><span role="columnheader">{t('worktrees.col.repo')}</span><span role="columnheader">{t('worktrees.col.app')}</span><span role="columnheader">{t('worktrees.col.pool')}</span><span role="columnheader">{t('worktrees.col.size')}</span></div>
          {usage.repos.map(r => <div className="st-tiers-row" role="row" key={r.repo} title={r.repo}>
            <span role="rowheader" className="st-tiers-engine">{r.name}</span>
            <span role="cell">{r.app} / {r.worktrees}</span>
            <span role="cell">{r.pool}{r.inUse ? ` · ${t('worktrees.inUse', { n: r.inUse })}` : ''}</span>
            <span role="cell">{fmtSize(r.bytes)}</span>
          </div>)}
        </div>)}
      {reported.length > 0 && <div className="st-text" data-testid="st-worktrees-reported">
        <p className="st-desc">{t('worktrees.reported', { n: reported.length })}</p>
        <ul className="st-desc">{reported.map(r => <li key={r.path}><code>{r.path}</code> · {t(`worktrees.why.${r.why}`)}</li>)}</ul>
      </div>}
    </div>
    {LIMITS.map(l => <LimitRow key={l.key} id={l.key} label={t(l.label)} hint={t(`${l.label}.hint`)} min={l.min} max={l.max} value={settings[l.key] ?? usage?.limits[LIMIT_FIELD[l.key]] ?? l.min} />)}
  </>;
}

/** One limit: a number saved when the field loses focus or on Enter (main clamps it to the key's range). */
function LimitRow({ id, label, hint, min, max, value }: { id: LimitKey; label: string; hint: string; min: number; max: number; value: number }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const save = () => {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || n === value) { setDraft(String(value)); return; }
    void setSetting({ [id]: Math.min(max, Math.max(min, n)) });
  };
  return <div className="st-row">
    <div className="st-text"><label className="st-title" htmlFor={`st-${id}`}>{label}</label><p className="st-desc">{hint}</p></div>
    <div className="st-ctl"><input id={`st-${id}`} data-testid={`st-${id}`} className="st-input" type="number" inputMode="numeric" min={min} max={max} value={draft}
      onChange={e => setDraft(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></div>
  </div>;
}
