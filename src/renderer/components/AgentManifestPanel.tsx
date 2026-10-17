// Editable and read-only routing declarations for Agent Studio; plain React text never becomes executable markup.
import type { AgentManifest } from '@shared/agents';
import { MANIFEST_LIST_FIELDS, MANIFEST_TEXT_LIMITS } from '@shared/agent-manifest';
import { t } from '../i18n';

export function AgentManifestPanel({ manifest, onChange }: { manifest?: AgentManifest; onChange?: (manifest: AgentManifest) => void }) {
  const fields = [...Object.keys(MANIFEST_TEXT_LIMITS) as (keyof typeof MANIFEST_TEXT_LIMITS)[], ...MANIFEST_LIST_FIELDS];
  return <details className="agent-manifest" data-testid={onChange ? 'agent-manifest-editor' : 'agent-manifest-view'}>
    <summary>{t('studio.manifest')}</summary><p>{t('studio.manifestHint')}</p>
    {fields.map(key => {
      const list = (MANIFEST_LIST_FIELDS as readonly string[]).includes(key);
      const value = manifest?.[key], rendered = Array.isArray(value) ? value.join('\n') : value ?? '';
      return onChange ? <label className="field" key={key}><span>{t(`studio.manifest.${key}`)}</span>
        <textarea data-testid={`agent-manifest-${key}`} rows={2} value={rendered} maxLength={list ? 2411 : MANIFEST_TEXT_LIMITS[key as keyof typeof MANIFEST_TEXT_LIMITS]}
          onChange={event => onChange({ ...manifest, [key]: list ? event.target.value.split('\n') : event.target.value })} />
        {list && <small>{t('studio.manifestLines')}</small>}
      </label> : <div key={key}><strong>{t(`studio.manifest.${key}`)}</strong><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{rendered || t('studio.manifestUnknown')}</p></div>;
    })}
  </details>;
}
