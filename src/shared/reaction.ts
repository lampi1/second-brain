// Emoji reactions (owner, 2026-10-20: «rispondere con faccine o pollici in su … senza che rispondano un papiro», for
// every engine the app drives, not a Claude-only feature): every chat's role frame carries REACTION_RULE, so a message
// that needs no answer gets a reply of one emoji only; the chat view shows such a reply as a small reaction under the
// user's message instead of a bubble (isReaction). Engine-agnostic: it is plain reply text, so Claude, Cursor and any
// other harness do it the same way and it survives in the transcript. Pure. Used by main/agents/orchestrator-role.ts
// (roleFrame) and renderer/components/ChatItems.tsx.

/** what the role frame tells every chat */
export const REACTION_RULE = 'When the user\'s message needs no written answer (thanks, ok, a plain acknowledgement or confirmation), reply with ONE emoji only and nothing else (👍, also when you start on it; ✅ 🙏 👌 🎉; never 👀): the app shows it as a reaction on their message. Never use it to skip an answer, a result, a question or a report that is due.';

/** one or two emoji with optional skin tones, joiners and variation selectors, and no other text */
const ONLY_EMOJI = /^(?:\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️|‍\p{Extended_Pictographic})*\s*){1,2}$/u;

/** Whether a whole reply is a reaction (1–2 emoji, nothing else). */
export const isReaction = (text: string): boolean => {
  const t = text.trim();
  return t.length > 0 && t.length <= 24 && ONLY_EMOJI.test(t);
};
