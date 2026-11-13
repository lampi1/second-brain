// When a chat's context counts as "long" (the amber meter, `long` in app_chats). Why: since ADR 0031 every Claude chat
// compacts by itself near its window (compactWindowTokens, reported back as contextMaxTokens), so a fixed 200k warning
// cried wolf on chats that cost no more than a fresh one; the amber now means "compaction is near". Cursor reports no
// window: the user's contextWarnTokens stays its threshold. Pure, shared by main (appctl) and the renderer (ContextBar).
import type { ChatSummary } from './contract';

/** share of the window where the meter turns amber (the CLI compacts at ~89% of it) */
export const NEAR_COMPACTION = 0.8;

/** Tokens above which this chat is "long". */
export function longAt(c: Pick<ChatSummary, 'harness' | 'contextMaxTokens' | 'contextEstimated'>, warnTokens: number): number {
  return c.harness === 'claude' && !c.contextEstimated && c.contextMaxTokens ? Math.round(c.contextMaxTokens * NEAR_COMPACTION) : warnTokens;
}

export const isLongChat = (c: Pick<ChatSummary, 'harness' | 'contextTokens' | 'contextMaxTokens' | 'contextEstimated'>, warnTokens: number): boolean =>
  (c.contextTokens ?? 0) >= longAt(c, warnTokens);
