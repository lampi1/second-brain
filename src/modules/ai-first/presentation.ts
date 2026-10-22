// Presentation only: the built-in guide brief stays in provider history, never as the person's speech.
import type { ChatItem } from '../../shared/contract';
import { LANGS } from '../../shared/contract';
import type { SetupState } from '../../shared/agents';
import { guidePrompt } from './model';

export function guideChatId(setup: SetupState | null): string | null {
  const guide = setup?.preferences.guide;
  return guide && (guide.stage === 'connecting' || guide.stage === 'guided') ? guide.chatId : null;
}
export function visibleGuideItems(items: readonly ChatItem[], chatId: string | null, guideId: string | null): readonly ChatItem[] {
  if (!chatId || chatId !== guideId) return items;
  const index = items.findIndex(item => item.kind === 'user');
  const item = items[index];
  if (item?.kind !== 'user' || item.from || item.images || item.thumbs?.length || !LANGS.some(l => item.text === guidePrompt(l))) return items;
  return items.filter((_, i) => i !== index);
}
export function guideHasCenter(setup: SetupState | null, hasOrchestrator: boolean): boolean {
  return !hasOrchestrator && setup?.status === 'draft' && !!guideChatId(setup);
}
