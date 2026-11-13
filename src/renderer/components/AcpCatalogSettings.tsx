// Impostazioni → Account e strumenti → «Altri agenti ACP» (ADR 0221): the ACP catalog's proposals (main/engines/acp-catalog),
// each off and untrusted until the user turns it on here. A row shows how the CLI starts, its install page and its sign-in;
// the app installs nothing and signs in nowhere by itself. «Attiva» is the user's click: it records the start definition
// (engines:trust, engines/trust.ts) and lets agents use it; from then on the entry is an engine like the others (its row
// moves to the list above, SettingsPage.tsx ToolConnection). Used by SettingsPage.tsx.
import { useState } from 'react';
import type { EngineInfo } from '@shared/contract';
import { useAllEngines } from '../lib/engines';
import { setSetting } from '../store/store';
import { toast } from '../store/ui';
import { ExtLink } from '../brain/components/ui';
import { t } from '../i18n';

function CatalogRow({ engine }: { engine: EngineInfo }) {
  const [busy, setBusy] = useState(false);
  const c = engine.catalog!;
  const turnOn = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await window.sb.invoke('engines:trust', { engine: engine.id });
      await setSetting({ engines: { [engine.id]: true } });
    } catch { toast(t('essential.error'), 'err'); } finally { setBusy(false); }
  };
  return <article className="st-catalog-row" data-testid={`st-catalog-${engine.id}`}>
    <div className="st-row">
      <div className="st-text">
        <span className="st-title-line"><b className="st-title">{engine.name}</b></span>
        <span className="st-state">{t('acpCatalog.proposed')}</span>
        <p className="st-desc"><code>{engine.runs}</code></p>
        <p className="st-desc">
          <ExtLink href={c.installUrl}>{t('acpCatalog.install')}</ExtLink>
          {c.signIn ? null : <>{' · '}{t('acpCatalog.noSignIn')}</>}
        </p>
      </div>
      <button type="button" className="btn btn-ghost btn-m" disabled={busy} onClick={() => void turnOn()}>{t('acpCatalog.turnOn')}</button>
    </div>
  </article>;
}

export function AcpCatalogSettings() {
  const proposals = useAllEngines().filter(e => e.catalog && !e.trusted);
  if (!proposals.length) return null;
  return <section className="st-catalog" data-testid="st-acp-catalog" aria-label={t('acpCatalog.title')}>
    <p className="st-title">{t('acpCatalog.title')}</p>
    <p className="st-desc">{t('acpCatalog.lead')}</p>
    {proposals.map(engine => <CatalogRow key={engine.id} engine={engine} />)}
  </section>;
}
