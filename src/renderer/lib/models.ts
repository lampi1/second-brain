// The model choices offered per harness (new-chat dialog, the tile's header menu). "" = the CLI default. A list,
// not a discovery: the CLIs have no stable "list models" call yet; unknown ids set elsewhere still display fine.
// Used by ChatTile.tsx and NewChatDialog.tsx.
import type { Harness } from '@shared/contract';

export const MODELS: Record<Harness, { id: string; label: string }[]> = {
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
