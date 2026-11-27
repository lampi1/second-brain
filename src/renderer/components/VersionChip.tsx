// The version chip of the top bar (ADR 0366, issue #491): a small neutral chip in place of the full-width green banner
// after an update. «● Versione nuova · Aggiorna» when GitHub has a newer version (a click asks to update, as the button
// in Settings → Aggiornamenti does; without a clean code folder it opens that card); «Aggiornata a <sha> · Novità»
// after a restart on a new version (Novità opens the card, ✕ dismisses it for good, as the banner's ✕ did). What it
// says is lib/version-chip.ts; VersionChipView takes plain props so test/unit/version-chip.test.ts renders it. Used by
// TopBar.tsx.
import { go } from '../actions';
import { t } from '../i18n';
import { versionChipOf, type VersionChip as Chip } from '../lib/version-chip';
import { askUpdateNow, dismissLaunch, useSource } from '../store/source';
import { IconX } from './Icons';
import '../styles/update.css';

export function VersionChipView({ chip, onUpdate, onNews, onDismiss }: { chip: Chip | null; onUpdate: () => void; onNews: () => void; onDismiss: () => void }) {
  if (!chip) return null;
  if (chip.kind === 'available') return <button type="button" className="version-chip is-new" onClick={onUpdate} data-testid="version-chip" data-kind="available"
    data-tip={chip.subject ? t('version.newTip', { subject: chip.subject }) : undefined}>
    <span className="version-dot" aria-hidden="true" /><span>{t('version.new')}</span><span className="version-sep" aria-hidden="true">·</span><b>{t('version.update')}</b>
  </button>;
  return <span className="version-chip" role="status" data-testid="version-chip" data-kind="updated">
    <span>{t('version.updated')} <b className="version-sha">{chip.sha}</b></span><span className="version-sep" aria-hidden="true">·</span>
    <button type="button" className="version-link" onClick={onNews} data-tip={t('version.newsTip')} data-testid="version-news">{t('version.news')}</button>
    <button type="button" className="version-x" onClick={onDismiss} aria-label={t('version.dismiss')} data-testid="version-dismiss"><IconX size={11} /></button>
  </span>;
}

export function VersionChip() {
  const state = useSource(s => s);
  const chip = versionChipOf(state);
  const settings = () => go({ page: 'impostazioni', arg: 'update' });
  return <VersionChipView chip={chip} onNews={settings} onDismiss={dismissLaunch}
    onUpdate={() => (chip?.kind === 'available' && chip.canUpdate ? askUpdateNow(!!state?.stable) : settings())} />;
}
