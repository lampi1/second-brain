// Presentation only: the built-in guide brief stays in provider history, never as the person's speech.
import type { ChatItem } from '../../shared/contract';
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
  if (item?.kind !== 'user' || item.from || item.images || item.thumbs?.length || (item.text !== guidePrompt('it') && item.text !== guidePrompt('en'))) return items;
  return items.filter((_, i) => i !== index);
}
export function guideHasCenter(setup: SetupState | null, hasRegia: boolean): boolean {
  return !hasRegia && setup?.status === 'draft' && !!guideChatId(setup);
}
