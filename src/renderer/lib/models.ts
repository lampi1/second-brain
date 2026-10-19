// The model choices offered per engine (new-chat dialog, the tile's header menu, the Settings page). "" = the CLI
// default. An engine whose CLI lists its models (ACP: Cursor…): the list it offered at its last chat ('models:seen',
// main/brain/models-seen.ts) when there is one, else the list below (Claude: its CLI has no "list models" call); an id set elsewhere (a setting,
// a chat) is always kept as a choice so it still displays. Used by ChatTile.tsx, SettingsPage.tsx.
import { useEffect, useState } from 'react';
import type { Harness, ModelsSeen } from '@shared/contract';

type Option = { id: string; label: string };

const CLI_DEFAULT: Option = { id: '', label: 'Predefinito della CLI' };

export const MODELS: Partial<Record<Harness, Option[]>> = {
  claude: [
    CLI_DEFAULT,
    { id: 'claude-opus-5-5', label: 'Opus 5.5' },
    { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  ],
  cursor: [
    CLI_DEFAULT,
    { id: 'auto', label: 'Auto' },
    { id: 'gpt-5', label: 'GPT-5' },
    { id: 'sonnet-4.5', label: 'Sonnet 4.5' },
    { id: 'grok-4.7', label: 'Grok 4.7' },
  ],
};

/** The choices for an engine: its CLI's own list when seen, plus `keep` (an id already chosen) if it is not in it. */
export function modelOptions(harness: Harness, seen: ModelsSeen | null, keep = ''): Option[] {
  const cur = seen?.[harness];
  const list = cur?.ids.length ? [CLI_DEFAULT, ...cur.ids.map(m => ({ id: m.id, label: m.name || m.id }))] : MODELS[harness] ?? [CLI_DEFAULT];
  return keep && !list.some(m => m.id === keep) ? [...list, { id: keep, label: keep }] : list;
}

/** The models the CLIs offered, read once per mount, or when `when` turns true (a menu as it opens); null until read, or
 *  when the main process has none. */
export function useModelsSeen(when = true): ModelsSeen | null {
  const [seen, setSeen] = useState<ModelsSeen | null>(null);
  useEffect(() => {
    if (!when) return;
    let alive = true;
    window.sb.invoke('models:seen', undefined).then(s => { if (alive) setSeen(s); }, () => { /* keep the built-in list */ });
    return () => { alive = false; };
  }, [when]);
  return seen;
}
