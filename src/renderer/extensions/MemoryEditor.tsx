// Human-authored shared memory editor. Main shows the exact values in a native confirmation before saving provenance.
import { useEffect, useState } from 'react';
import type { ContextArchive, ContextFactInput } from '@shared/data-sections';
import { sb } from '../sb';
import { t } from '../i18n';
import { useSectionDraft } from './drafts';
const keys = ['work', 'goals', 'style', 'constraints'] as const;
export function MemoryEditor({ changed }: { changed: () => void }) {
  const [archive, setArchive] = useState<ContextArchive | null>(null), [values, setValues] = useSectionDraft<Record<string, string>>('memory', {});
  const [dirty, setDirty] = useSectionDraft('memory-dirty', false);
  const [revision, setRevision] = useSectionDraft('memory-revision', 0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), [saved, setSaved] = useState(false);
  useEffect(() => { let alive = true; void sb.invoke('sections:memory', undefined).then(next => {
    if (!alive) return; setArchive(next); if (!dirty) { setValues(Object.fromEntries(next.facts.map(f => [f.key, f.value]))); setRevision(next.revision); }
  }, () => { if (alive) setError(true); }); return () => { alive = false; }; }, []);
  const save = async (clear = false) => {
    if (!archive || busy) return;
    const other = archive.facts.filter(f => !(keys as readonly string[]).includes(f.key)).map(({ id, key, value, category }) => ({ id, key, value, category }));
    const facts: ContextFactInput[] = clear ? [] : [...other, ...keys.filter(key => values[key]?.trim()).map(key => ({ id: key, key, value: values[key]!.trim(), category: key === 'constraints' ? 'constraint' as const : 'profile' as const }))];
    setBusy(true); setError(false); setSaved(false);
    try {
      const next = await sb.invoke('sections:saveMemory', { facts, expectedRevision: revision });
      if (next) { setArchive(next); setValues(Object.fromEntries(next.facts.map(f => [f.key, f.value]))); setRevision(next.revision); setDirty(false); setSaved(true); changed(); }
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  return <details data-testid="shared-memory"><summary>{t('sections.memory')}</summary><p>{t('sections.memoryHint')}</p>
    {error && <div role="alert">{t('sections.failure')}<button className="btn" type="button" disabled={busy} onClick={() => {
      setBusy(true); void sb.invoke('sections:memory', undefined).then(next => { setArchive(next); setRevision(next.revision); if (!dirty) setValues(Object.fromEntries(next.facts.map(f => [f.key, f.value]))); setError(false); }, () => setError(true)).finally(() => setBusy(false));
    }}>{t('sections.reload')}</button></div>}
    {!archive ? <p role="status">{t('sections.loading')}</p> : <>
      <fieldset disabled={busy}>{keys.map(key => <label key={key}>{t(`sections.memory.${key}`)}<textarea rows={2} maxLength={2000} value={values[key] ?? ''} onChange={e => { setValues(previous => ({ ...previous, [key]: e.target.value })); setDirty(true); setSaved(false); }} data-testid={`memory-${key}`}/></label>)}</fieldset>
      <div className="sections-toolbar"><button className="btn btn-primary" type="button" disabled={busy} onClick={() => void save()}>{t('sections.memorySave')}</button><button className="btn" type="button" disabled={busy || !archive.facts.length} onClick={() => void save(true)}>{t('sections.memoryClear')}</button></div>
      {saved && <p role="status">{t('sections.memorySaved')}</p>}
      <details><summary>{t('sections.details')}</summary><ul>{archive.facts.map(fact => <li key={fact.id}><strong>{fact.key}</strong>: {fact.value} <time dateTime={fact.confirmedAt}>{new Date(fact.confirmedAt).toLocaleString()}</time></li>)}</ul></details>
    </>}
  </details>;
}
