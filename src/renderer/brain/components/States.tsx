// Designed states of every brain block: loading skeleton (with a line of text after 300 ms, never a bare spinner),
// empty state that says what will appear and what to do, error state with the cause and one action, and the page
// head (title, the explain line, last update, refresh). Used by every page.
import { useEffect, useState, type ReactNode } from 'react';
import { fmt } from '../lib/format';
import { IconRefresh } from './ui';

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

/** What failed, why (the server's own words) and one thing to do. */
export function ErrorState({ what = 'Non riesco a leggere questi dati', error, onRetry }: { what?: string; error: string; onRetry?: () => void }) {
  const hint = /server dati|brain-site|non è partito|uscito/.test(error) ? 'Il cervello scelto non ha il suo server dati, o non parte: guarda in Impostazioni la cartella del cervello.'
    : /tempo|timeout/.test(error) ? 'Il calcolo è lento (fino a un minuto la prima volta): riprova tra poco.'
      : /DevOps|az login/.test(error) ? 'DevOps non risponde: rifai "az login" nel terminale, poi riprova.' : '';
  return (
    <div className="bx-error" role="alert" data-testid="bx-error">
      <div className="t"><b>{what}</b><span className="cause">{error}</span>{hint && <span className="cause">{hint}</span>}</div>
      {onRetry && <button type="button" className="bx-btn" onClick={onRetry}><IconRefresh /> Riprova</button>}
    </div>
  );
}

/** The block for one async read: skeleton while nothing is there, the error when nothing could be read, else children. */
export function Async({ loading, error, onRetry, label, children, lines, block }: { loading: boolean; error: string | null; onRetry?: () => void; label?: string; children: () => ReactNode; lines?: number; block?: boolean }) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading) return <Loading label={label} lines={lines} block={block} />;
  return <>{children()}</>;
}

/** Page head: title, the key fact in one line (bold), what the page is in small, last update and refresh. */
export function PageHead({ title, lead, what, at, refreshing, onRefresh, actions, live }: {
  title: string; lead?: ReactNode; what?: ReactNode; at?: number | null; refreshing?: boolean; onRefresh?: () => void; actions?: ReactNode; live?: boolean;
}) {
  return (
    <header className="bx-head">
      <div className="bx-head-row">
        <h1>{title}</h1>
        <span className="sp" />
        <div className="bx-meta">
          {live && <span className="bx-live" aria-hidden="true" />}
          {at ? <span title={fmt.when(at)}>{refreshing ? 'ricalcolo in corso · ' : ''}aggiornato {fmt.ago(at)}</span> : refreshing ? <span>ricalcolo in corso</span> : null}
          {actions}
          {onRefresh && <button type="button" className="bx-btn s" onClick={onRefresh} title="Rilegge i file adesso (zero token)" data-testid="bx-refresh"><IconRefresh /> Aggiorna</button>}
        </div>
      </div>
      {lead && <p className="bx-lead" data-testid="bx-lead">{lead}</p>}
      {what && <p className="bx-what">{what}</p>}
    </header>
  );
}

/** The discovery from the real data (bold), the next step it suggests, and on request what it says and why it matters. */
export interface ExplainProps { find?: ReactNode; next?: ReactNode; says?: ReactNode; why?: ReactNode }
export function Explain({ find, next, says, why }: ExplainProps) {
  if (!find && !next && !says) return null;
  return (
    <div className="bx-explain">
      {find && <p className="find">{find}</p>}
      {next && <p className="next">→ {next}</p>}
      {(says || why) && (
        <details>
          <summary>Cosa significa?</summary>
          <p>{says && <><b>Cosa ti dice:</b> {says} </>}{why && <><b>Perché ti interessa:</b> {why}</>}</p>
        </details>
      )}
    </div>
  );
}

/** "DevOps non letto": said on screen, never hidden in the details. */
export function NoDevops() {
  return <p className="bx-warnline" role="note">DevOps non letto (login scaduto?): qui mancano PR e work item. Rifai «az login» nel terminale e premi Aggiorna.</p>;
}
