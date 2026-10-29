// Impara's on/off switches («Voce dell'app», «Rispondo a voce»): a labelled role=switch button. Used by
// ImparaStart.tsx and ImparaPlayer.tsx; styles impara.css.
export function ImparaSwitch({ on, onChange, label, testid, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; testid: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`ip-switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} disabled={disabled} data-testid={testid}>
      <b aria-hidden="true" />{label}
    </button>
  );
}
