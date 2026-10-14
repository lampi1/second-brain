// The model choices offered per harness (new-chat dialog, the tile's header menu, the Settings page). "" = the CLI
// default. Claude: a list (its CLI has no "list models" call). Cursor: the list its own CLI offered at the last Cursor
// chat ('models:seen', main/brain/models-seen.ts) when there is one, else this list; an id set elsewhere (a setting,
// a chat) is always kept as a choice so it still displays. Used by ChatTile.tsx, NewChatDialog.tsx, SettingsPage.tsx.
import { useEffect, useState } from 'react';
import type { Harness, ModelsSeen } from '@shared/contract';

type Option = { id: string; label: string };

export const MODELS: Record<Harness, Option[]> = {
  claude: [
    { id: '', label: 'Predefinito della CLI' },
    { id: 'claude-opus-5-5', label: 'Opus 5.5' },
    { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  ],
  cursor: [
    { id: '', label: 'Predefinito della CLI' },
    { id: 'auto', label: 'Auto' },
    { id: 'gpt-5', label: 'GPT-5' },
    { id: 'sonnet-4.5', label: 'Sonnet 4.5' },
    { id: 'grok-4.7', label: 'Grok 4.7' },
  ],
};

/** The choices for a harness: Cursor's own list when seen, plus `keep` (an id already chosen) if it is not in it. */
export function modelOptions(harness: Harness, seen: ModelsSeen | null, keep = ''): Option[] {
  const cur = harness === 'cursor' ? seen?.cursor : null;
  const list = cur?.ids.length ? [MODELS.cursor[0]!, ...cur.ids.map(m => ({ id: m.id, label: m.name || m.id }))] : MODELS[harness];
  return keep && !list.some(m => m.id === keep) ? [...list, { id: keep, label: keep }] : list;
}

/** The models the CLIs offered, read once per mount (null until read, or when the main process has none). */
export function useModelsSeen(): ModelsSeen | null {
  const [seen, setSeen] = useState<ModelsSeen | null>(null);
  useEffect(() => {
    let alive = true;
    window.sb.invoke('models:seen', undefined).then(s => { if (alive) setSeen(s); }, () => { /* keep the built-in list */ });
    return () => { alive = false; };
  }, []);
  return seen;
}
