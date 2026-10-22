// What the chat composer's model suggestions spent today ('suggest:state', ADR 0118), as a hook with no store: read
// when the caller mounts and again when `refresh` changes (Settings passes the suggest settings). Used by the brain's
// Costi page (which never imports the app's store) and components/SuggestSettings.tsx.
import { useEffect, useState } from 'react';
import type { SuggestState } from '@shared/composer-suggest';

export function useSuggestState(refresh: unknown = null): SuggestState | null {
  const [st, setSt] = useState<SuggestState | null>(null);
  useEffect(() => {
    // the bridge read here, not at import: pages also render in node tests (no window there)
    const sb = typeof window !== 'undefined' ? window.sb : undefined;
    if (!sb) return;
    let live = true;
    void sb.invoke('suggest:state', undefined).then(v => { if (live) setSt(v); }, () => {});
    return () => { live = false; };
  }, [refresh]);
  return st;
}
