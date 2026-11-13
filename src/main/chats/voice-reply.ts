// A reply made to be heard (ADR 0152; owner, 2026-10-25: «vorrei che la risposta dell'IA si adattasse a quella modalità
// cioè che parlasse in modo che capisco»). A message said in the voice conversation reaches the engine with an
// engine-only line asking for speech, never for text: the rules once per context (with the role text, or on the first
// spoken turn), then a short reminder on each spoken turn. The rules follow OpenAI's voice prompting guide (1-3 short
// sentences per turn, natural speech instead of formatting, reference pronunciations, numbers read plainly, actions not
// reasoning: https://developers.openai.com/api/docs/guides/voice-prompting) and ElevenLabs' advice to have the LLM write
// text ready to be read aloud (https://elevenlabs.io/docs/best-practices/prompting/normalization). The voice is Italian
// (Piper), so English words are the main thing it says badly. Used by chats/manager.ts deliverNow; pinned by
// test/unit/chats/voice-reply.test.ts.

const RULES = [
  'Spoken turn: the user said this message aloud and will HEAR your reply, read by an Italian text-to-speech voice that mispronounces English. Write it for the ear:',
  '- 1 to 3 short sentences, plain spoken Italian, each ending with a full stop or a question mark. One idea per sentence.',
  '- No lists, headings, tables, code, links, file paths, ids, emoji, symbols or parentheses.',
  '- No English words, acronyms or abbreviations: use the Italian word (merge: unire; pull request: richiesta di modifica; bug: errore; commit: salvataggio; branch: ramo; deploy: rilascio; test: prova; task: attività; feature: funzione). A name with no Italian form, say it once, simply.',
  '- Numbers, dates and times as they are said; a code digit by digit.',
  '- Say what you did or found and what comes next, not how you think. Ask one question at a time.',
  '- If the full answer is long, give the essentials and offer to go on. Tools and work run as usual; only the words you write change.',
].join('\n');

/** the engine-only line for a spoken turn: the rules when this context has not had them yet, else a reminder */
export function voiceReplyHint(told: boolean): string {
  return told ? '\n\n[Spoken turn: reply for the ear, short Italian sentences, no English words or formatting (rules above).]' : `\n\n[${RULES}]`;
}
