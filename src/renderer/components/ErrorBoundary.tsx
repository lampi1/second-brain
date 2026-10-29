// A page that throws while rendering takes only itself down (ADR 0192). Before, the only boundary was GenUi.tsx's, around
// an agent's visual: any other page's render error blanked the whole window (React unmounts the tree). Each page
// (App.tsx PageFrame: every brain page, Memoria, Settings, Log…), the focus view, the 3D map and the Orchestrator column
// sit in one: the failed part shows a card «Questa pagina ha avuto un errore» with «Ricarica la pagina» (a remount:
// the component starts over, the app and the agents are untouched) and the error's details folded; the rest of the app
// keeps working. The error goes to the `renderer` log once (lib/ui-errors.ts → main/renderer-errors.ts). `where` names
// the page in the log. Pure class component, tested without a DOM: test/unit/error-boundary.test.ts.
import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n';
import { reportUiError } from '../lib/ui-errors';
import { IconAlert, IconRefresh } from './Icons';

interface Props { where: string; children: ReactNode; compact?: boolean }
interface State { error: Error | null; reloads: number }

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, reloads: 0 };
  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportUiError('render', error, { where: this.props.where, ...(info.componentStack ? { componentStack: info.componentStack } : {}) });
  }
  /** «Ricarica la pagina»: the children mount again from scratch (a new key). */
  reload = (): void => { this.setState(s => ({ error: null, reloads: s.reloads + 1 })); };
  override render(): ReactNode {
    const { error, reloads } = this.state;
    if (!error) return <Fragment key={reloads}>{this.props.children}</Fragment>;
    const detail = `${error.name && error.name !== 'Error' ? `${error.name}: ` : ''}${error.message}`.slice(0, 500);
    return (
      <div className={`err-page${this.props.compact ? ' compact' : ''}`} role="alert" data-testid={`error-boundary-${this.props.where}`}>
        <div className="err-page-card">
          <div className="err-page-title"><IconAlert size={15} /> {t('cmp.errorBoundary.title')}</div>
          <p className="err-page-text">{t('cmp.errorBoundary.text')}</p>
          <button type="button" className="btn btn-primary btn-s" onClick={this.reload} data-testid="error-boundary-reload"><IconRefresh size={13} /> {t('cmp.errorBoundary.reload')}</button>
          <details className="err-page-details">
            <summary>{t('cmp.errorBoundary.details')}</summary>
            <pre>{detail}</pre>
          </details>
        </div>
      </div>
    );
  }
}
