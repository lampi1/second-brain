// Impara's on/off switches («Voce dell'app», «Rispondo a voce»): a labelled role=switch button. Used by
// ImparaStart.tsx, ImparaPlayer.tsx and news/NewsSources.tsx (a source on or paused, named by `name`); styles impara.css.
export function ImparaSwitch({ on, onChange, label, testid, disabled, name }: { on: boolean; onChange: (on: boolean) => void; label: string; testid: string; disabled?: boolean; /** the accessible name when there is no visible label */ name?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} {...(name ? { 'aria-label': name } : {})} className={`ip-switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} disabled={disabled} data-testid={testid}>
      <b aria-hidden="true" />{label}
    </button>
  );
}
