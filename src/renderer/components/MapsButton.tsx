// The project maps button (ADR 0275: in «Stato»'s place; ADR 0276: the maps are a page beside the Orchestrator; ADR 0307: they open full screen).
// It sits on the top bar and on the Orchestrator's head (ADR 0301: ADR 0287 had left it on the top bar only, the user
// looks for it on the Orchestrator). Used by TopBar.tsx and OrchestratorTile.tsx.
import { openMaps } from '../actions';
import { IconMap } from './Icons';
import { IconButton } from './ui';
import { t } from '../i18n';

export function MapsButton({ testid = 'maps-btn', size = 16 }: { testid?: string; size?: number }) {
  return <IconButton label={t('pm.mapsButton')} shortcut="Ctrl+Shift+S" onClick={() => openMaps()} testid={testid}><IconMap size={size} /></IconButton>;
}
