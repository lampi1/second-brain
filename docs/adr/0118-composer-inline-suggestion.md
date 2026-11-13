# ADR 0118 · The chat composer's inline suggestion: local first, a small model after a pause

Date: 2026-10-22 · Status: accepted (issue #167: «Tab autosuggest like Claude Code, low token cost») · Builds on:
ADR 0018 (the "/" list of a chat input), ADR 0052 (text-only calls on the user's API key and their spend)

## Context
Typing a prompt is slow and repetitive. Claude Code shows grey text after the cursor that Tab accepts; the app's chat
input (`ChatInput.tsx`, the input of every chat, of the Orchestrator's column and of Lampo) had nothing like it, and Tab only
moved the focus or completed the "/" list. A suggestion that asks a model at every key would cost more than it saves
and would send half-typed prompts out while the user is still writing.

## Decision
- **Ghost text.** A mirror of the text under the textarea shows the suggestion in grey right after the caret, only
  with the caret at the end of the text, the input focused and the "/" list closed. Tab (no modifiers) accepts it;
  Esc hides it for that text; any other key goes on as usual (typing along the suggestion keeps the rest of it). With
  no suggestion Tab keeps its role and moves the focus (accessibility); the suggestion is read to screen readers
  through `aria-describedby`.
- **Local sources first, zero tokens** (`renderer/lib/composer-suggest.ts`): the user's past prompts (the whole
  message as a prefix of one sent before: this viewer's last 200 sends in localStorage plus the user's messages of the
  chats loaded in the app), then the last word or words of the current line as the start of a "/" command (anywhere on
  the line), a role, a skill, a chat title (several words) or a file the chat's tools touched.
- **The model only when nothing local fits**, and only after 600 ms without keys (`SUGGEST_DEBOUNCE_MS`): every key
  resets the pause, so nothing is sent while the user types fast, and cancels the request in flight
  (`suggest:cancel`, plus a newer request for the same chat aborts the older one in main); a late answer is ignored.
  The request carries only the current line up to the caret (≤ 300 characters) and the chat's last message (≤ 600),
  both scrubbed of anything that looks like a credential (`headline.ts scrub`); it runs on the smallest model (the
  brain's light tier on the Anthropic API engine, else `claude-haiku-4-5`) with at most 120 output tokens and no
  effort setting, through `engines/text.ts` (so it needs the API engine on with a key, and its spend joins the month's
  API spend). Lines under 8 characters and "/" lines are never sent.
- **Cache per prefix** (`main/suggest/service.ts`, 300 entries, per last message + line): the same prefix again, or a
  prefix that typed along a cached answer, is served from it with no call; an empty answer is cached too.
- **Budget and settings**: `suggestOn` (the whole feature, default on), `suggestModel` (its model part, default on)
  and `suggestDailyUsd` (default 0.05 $, 0.01–1 $). The model part and its budget are protected like the other
  spending settings (an agent may only propose them); no new permission prompt for the user. At the budget the model
  stops until the next local day; local suggestions stay. Under `SB_TEST`, `VITEST` and `SB_DEMO` the model part never
  calls (zero network in tests and the demo).
- **Cost in sight**: today's calls, cost (list price; an unpriced answer is counted at Haiku's list price so the budget
  still holds) and cache hits are kept in `<userData>/suggest.json` and served by `suggest:state`: a "Suggerimenti
  oggi" figure on Costi, and the same line beside the budget in Impostazioni → Scrittura.

## Why 0.05 $ a day
One call is about 250 input tokens and at most 120 output tokens: on a Haiku-class model (1 $/M in, 5 $/M out) that is
≤ 0.001 $, usually ~0.0004 $. 0.05 $ is therefore at least 50 and typically 100+ model suggestions a day, on top of the
local ones and the cache hits, which cost nothing: enough for a working day of prompts that the local sources cannot
complete, and at most ~1.5 $ a month even if it is reached every day. The user can raise it to 1 $ or turn the model
part off.

## Consequences
- Most suggestions cost nothing; the model is a fallback whose cost is bounded per day and visible.
- A suggestion from the model is a guess on two short pieces of text; it never sees the rest of the chat. Whole
  replies and other fields (the brain pages' composer, dialogs) are out of scope.
- The local history lives in this viewer's browser storage only; an empty or blocked store just means fewer
  suggestions.
