// Settings → Il mio spazio → "Condividi il brain" (ADR 0088): one button that asks main ('brain:share') for the
// shareable brain zip (rules, skills, roles, scripts, never memory), which main guard-scans and saves where the user
// picks. Shows what went in, or the secrets check's findings (file:line and rule, never the value). Mounted by
// SettingsPage.tsx in the 'space' group.
import { useState } from 'react';
import type { BrainShareResult } from '@shared/contract';
import { t } from '../i18n';
import { toast } from '../store/ui';
import { HelpTip } from './HelpTip';

export function BrainShareSetting() {
  const [busy, setBusy] = useState(false), [result, setResult] = useState<BrainShareResult | null>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true); setResult(null);
    try { setResult(await window.sb.invoke('brain:share', undefined)); }
    catch { toast(t('essential.error'), 'err'); }
    finally { setBusy(false); }
  };
  return <div className="st-row" data-testid="st-brain-share">
    <div className="st-text">
      <span className="st-title-line"><label className="st-title">{t('share.title')}</label><HelpTip title={t('share.helpTitle')} testid="st-brain-share-help"><p>{t('share.help1')}</p><p>{t('share.help2')}</p></HelpTip></span>
      <p className="st-desc">{t('share.hint')}</p>
      {busy && <p className="st-desc" role="status">{t('share.busy')}</p>}
      {result?.ok && <p className="st-desc" role="status" data-testid="st-brain-share-done" title={result.path}>{t('share.done', result)}{result.skipped ? ` ${t('share.skipped', { count: result.skipped })}` : ''}</p>}
      {result && !result.ok && 'error' in result && <p className="st-desc" role="alert">{result.error}</p>}
      {result && !result.ok && 'findings' in result && <div role="alert" className="st-desc" data-testid="st-brain-share-findings"><p>{t('share.findings')}</p><ul>{result.findings.slice(0, 12).map(f => <li key={`${f.file}:${f.line ?? 0}:${f.rule}`}><code>{f.file}{f.line ? `:${f.line}` : ''}</code> {f.rule}</li>)}</ul></div>}
    </div>
    <div className="st-ctl"><button type="button" className="btn btn-ghost btn-m" disabled={busy} onClick={() => void run()}>{t('share.button')}</button></div>
  </div>;
}
