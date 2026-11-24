// An agent's own page and the browser marker of a strip: English labels; parity checked against agent-detail.it.ts.
import type { agentDetailIt } from './agent-detail.it';
export const agentDetailEn: typeof agentDetailIt = {
  'agentDetail.prompt': 'Role instructions',
  'agentDetail.promptEmpty': 'No instructions written for this role.',
  'agentDetail.promptSize': ({ n }) => n === 1 ? '1 character' : `${n} characters`,
  'agentDetail.codeMode': 'Code Mode',
  'agentDetail.codeMode.hint': 'This role\'s new chats work through a script: many reads, searches and tools in one call (run_code), in a sandbox. Every call meets the same permission rules; an Esegui action stops the script and leaves you the usual button.',
  'agentDetail.codeMode.partial': 'Partial on this engine: the role is told to use run_code and the app refuses the native tools it approves itself; tools the engine approves on its own stay.',
  'agentDetail.fast': 'Fast',
  'agentDetail.fast.hint': 'This role\'s new Cursor chats start in the model\'s fast mode.',
  'agentDetail.presets.saved': ({ preset }: { preset: string }) => `${preset} saved.`,
  'agentDetail.presets.undo': 'Undo',
  
};
