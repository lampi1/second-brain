// The chat composer's inline suggestion (issue #167, ADR 0118): the grey text after the caret that Tab accepts. Local
// sources first (zero tokens: slash commands, skill and role names, chat titles, file names, the user's past prompts);
// a small model only when they give nothing, after a typing pause, with a short context (the chat's last message and
// the line being typed). These are the shapes main and the renderer share, the limits both sides apply, and the pure
// "continue a cached answer" rule. Used by main/suggest/service.ts, renderer/lib/composer-suggest.ts, contract.ts.

/** renderer → main ('suggest:get'): what the model may see. Both fields are cut again by main. */
export interface SuggestRequest {
  /** the input's chat: one request in flight per chat, a newer one aborts the older */
  chatId: string;
  /** the current line up to the caret */
  line: string;
  /** the chat's last message (its last assistant line), may be empty */
  lastMessage: string;
}

/** text = the suffix to show after the caret (null = none); cached = served from the cache (zero tokens);
 *  reason = why there is none: off (setting or tests/demo), budget (the day's budget is spent), unavailable (no API
 *  engine or key), cancelled (a newer key came), error, empty (the model had nothing useful) */
export interface SuggestAnswer {
  text: string | null;
  cached: boolean;
  reason?: 'off' | 'budget' | 'unavailable' | 'cancelled' | 'error' | 'empty' | 'short';
}

/** 'suggest:state': today's model suggestions (local day) for Costi and Settings. */
export interface SuggestState {
  day: string;
  /** model calls today and what they cost (list price; unpriced ones counted at a conservative estimate) */
  calls: number;
  usd: number;
  /** answers served from the cache today (no call) */
  cacheHits: number;
  /** the daily budget (settings suggestDailyUsd) and whether the model part is on */
  budgetUsd: number;
  modelOn: boolean;
  /** the model used for the calls */
  model: string;
}

/** Limits shared by both sides. */
export const SUGGEST_DEBOUNCE_MS = 600;
export const SUGGEST_LINE_MAX = 300;
export const SUGGEST_LAST_MAX = 600;
/** fewer typed characters than this on the line: no model call (nothing to go on) */
export const SUGGEST_MODEL_MIN_LINE = 8;
export const SUGGEST_MAX_OUT = 120;
export const SUGGEST_DEFAULT_DAILY_USD = 0.05;

/** A cached answer for `line0` (the line it was asked for) still fits `line` when the user typed along it: the rest
 *  of it, or null. Exact same line → the whole answer; typed past it or off it → null. */
export function continueCached(line0: string, answer: string, line: string): string | null {
  if (!line.startsWith(line0)) return null;
  const typed = line.slice(line0.length);
  if (!answer.startsWith(typed)) return null;
  const rest = answer.slice(typed.length);
  return rest ? rest : null;
}
