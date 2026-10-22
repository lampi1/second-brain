// What a command or a tool call does, in two words, as a pill on top of its card in the questions window (the owner,
// 2026-10-22: «quando c'è un comando mi deve dire in 2 parole cosa fa»). The gist comes from shared/gist.ts, the words
// from the UI texts (genui.gist.<id>); a destructive one (delete, undo, kill) is drawn in the warning tone. Used by
// RequestPanel.tsx (permissions) and CommandRequest.tsx (commands), size `window`.
import { gistOf, type Gist as GistId } from '@shared/gist';
import { t, type TextKey } from '../i18n';
import { IconBolt } from './Icons';

const RISKY = new Set<GistId>(['delete', 'deleteData', 'gitUndo', 'kill', 'push', 'publish', 'rebase']);

export function Gist({ tool, input, command, testid }: { tool: string; input: unknown; command?: string; testid?: string }) {
  const id = gistOf(tool, input, command);
  return (
    <span className={`wq-gist ${RISKY.has(id) ? 'risky' : ''}`} data-testid={testid} data-gist={id}>
      <IconBolt size={12} />{t(`genui.gist.${id}` as TextKey)}
    </span>
  );
}
