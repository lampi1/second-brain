// Designed states of every brain block: loading skeleton (with a line of text after 300 ms, never a bare spinner),
// empty state that says what will appear and what to do, error state with the cause and one action, and the page
// head (title, the explain line, last update, refresh). Used by every page.
import { useEffect, useState, type ReactNode } from 'react';
import { fmt } from '../lib/format';
import { shortError } from '../lib/error-text';
import { IconRefresh } from './ui';
import { HelpTip } from '../../components/HelpTip';
import { GuideLink } from '../../components/GuideLink';
import { t } from '../../i18n';

export function Loading({ label = 'Leggo il cervello…', lines = 3, block = false }: { label?: string; lines?: number; block?: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 300); return () => clearTimeout(t); }, []);
  return (
    <div className="bx-skel" role="status" aria-live="polite" aria-label={label} data-testid="bx-loading">
      {block && <i className="block" />}
      {Array.from({ length: lines }, (_, i) => <i key={i} style={{ width: `${92 - i * 17}%` }} />)}
      {slow && <span className="label">{label}</span>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="bx-empty" data-testid="bx-empty"><b>{title}</b>{children && <span>{children}</span>}</div>;
}

/** What failed, why (one short line in the server's own words), one thing to do; a long or multi-line error (a
 *  stack trace, a child's stderr) stays folded under "Dettagli", never raw on the page (lib/error-text.ts). */
export function ErrorState({ what = t('costs.readError'), error, onRetry }: { what?: string; error: string; onRetry?: () => void }) {
  const { short, details } = shortError(error);
  const hint = /server dati|brain-site|non è partito|uscito/.test(error) ? t('costs.serverHint')
    : /Cannot find module|MODULE_NOT_FOUND|ENOENT/.test(error) ? t('costs.toolHint')
      : /tempo|timeout/.test(error) ? t('costs.slowHint')
        : /DevOps|az login/.test(error) ? t('costs.devopsHint') : '';
  return (
    <div className="bx-error" role="alert" data-testid="bx-error">
      <div className="t">
        <b>{what}</b>
        <span className="cause" data-testid="bx-error-cause">{short}</span>
        {hint && <span className="cause">{hint}</span>}
        {details && <details className="bx-error-details" data-testid="bx-error-details"><summary>{t('costs.errorDetails')}</summary><pre>{details}</pre></details>}
      </div>
      {onRetry && <button type="button" className="bx-btn" onClick={onRetry}><IconRefresh /> {t('costs.retry')}</button>}
    </div>
  );
}

/** The block for one async read: skeleton while nothing is there, the error when nothing could be read, else children. */
export function Async({ loading, error, onRetry, label, children, lines, block }: { loading: boolean; error: string | null; onRetry?: () => void; label?: string; children: () => ReactNode; lines?: number; block?: boolean }) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading) return <Loading label={label} lines={lines} block={block} />;
  return <>{children()}</>;
}

/** Page head: title, the key fact in one line (bold), what the page is in small (with «Come funziona →» to its Guida
 *  card when `guide` names one, ADR 0101), last update and refresh. */
export function PageHead({ title, lead, what, at, refreshing, onRefresh, actions, live, guide }: {
  title: string; lead?: ReactNode; what?: ReactNode; at?: number | null; refreshing?: boolean; onRefresh?: () => void; actions?: ReactNode; live?: boolean; guide?: string;
}) {
  return (
    <header className="bx-head">
      <div className="bx-head-row">
        <h1>{title}</h1>
        <span className="sp" />
        <div className="bx-meta">
          {live && <span className="bx-live" aria-hidden="true" />}
          {at ? <span title={fmt.when(at)}>{refreshing ? `${t('costs.recalculating')} · ` : ''}{t('costs.updated')} {fmt.ago(at)}</span> : refreshing ? <span>{t('costs.recalculating')}</span> : null}
          {actions}
          {onRefresh && <button type="button" className="bx-btn s" onClick={onRefresh} title={t('costs.refreshHint')} data-testid="bx-refresh"><IconRefresh /> {t('costs.refresh')}</button>}
        </div>
      </div>
      {lead && <p className="bx-lead" data-testid="bx-lead">{lead}</p>}
      {(what || guide) && <p className="bx-what">{what}{guide && <> <GuideLink concept={guide} /></>}</p>}
    </header>
  );
}

/** The discovery from the real data (bold), the next step it suggests, and in a "Cosa significa?" HelpTip what it says and why it matters. */
export interface ExplainProps { find?: ReactNode; next?: ReactNode; says?: ReactNode; why?: ReactNode }
export function Explain({ find, next, says, why }: ExplainProps) {
  if (!find && !next && !says) return null;
  return (
    <div className="bx-explain">
      {find && <p className="find">{find}</p>}
      {next && <p className="next">→ {next}</p>}
      {(says || why) && (
        <span className="more">
          <HelpTip text={t('costs.meaning')}>
            {says && <p><b>{t('costs.says')}</b> {says}</p>}
            {why && <p><b>{t('costs.why')}</b> {why}</p>}
          </HelpTip>
        </span>
      )}
    </div>
  );
}

/** "DevOps non letto": said on screen, never hidden in the details. */
export function NoDevops() {
  return <p className="bx-warnline" role="note">DevOps non letto (login scaduto?): qui mancano PR e work item. Rifai «az login» nel terminale e premi Aggiorna.</p>;
}
