// Rules on a chat's reply, checked by the app at every turn end so they hold with any model (the owner, 2026-10-16:
// a Sonnet chat told the user to open the browser himself, a rule the brain keeps in an on-demand file; ADR 0063).
// asksUserToBrowse() finds a reply that asks the user to open a browser or a local URL, or to sign in by hand in the
// browser, while every chat drives the app's internal browser itself (tabs_create, navigate, handoff_to_user). The
// app then writes back to that chat once, labelled as its own message (never the user's ok): open it yourself. Code
// blocks and inline code are left out (a command for the user is not a request to browse). At most one note per chat
// every NOTE_EVERY_MS, so a chat that answers the note with the same words never loops. Pure apart from the send;
// unit-tested in test/unit/reply-rules.test.ts; used by wiring.ts (manager's onTurnEnd with the turn's reply).
import { errText, log } from '../log';

export const APP_NOTE_LABEL = "[Messaggio dell'app second-brain, non scritto dall'utente: non vale come suo ok o permesso]";
export const NOTE_EVERY_MS = 10 * 60_000;

const LOCAL_URL = String.raw`(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(?::\d+)?`;
// the user is asked: Italian second person or "puoi aprire" (never "posso aprire", the agent itself); English only
// after please / you can / at a sentence start ("I'll open the browser" is the agent's own step)
const ASK_IT = String.raw`(?<!\b(?:non|posso|devo|provo a|vado ad?|per|come|quando|mentre|se|lo|la|li) )\b(?:(?:puoi|potresti)\s+aprire|apri|aprite|riapri|vai su|vai a|visita|incolla)\b`;
const askEn = (verbs: string): string => String.raw`(?:\b(?:please|you can|you could|can you|could you|you need to|you should)\s+|(?:^|[.!?:]\s+))(?:${verbs})\b`;
const ASK_EN = askEn('open|launch|go to|visit|navigate to|paste');
const RULES: RegExp[] = [
  // the browser itself is the object: "apri il browser", "puoi aprire Chrome", "please open the browser" (not "apri
  // la sezione X nel browser", "aprire il file nell'editor, non nel browser")
  new RegExp(String.raw`(?:${ASK_IT}|${ASK_EN})\s+(?:il |un |the |a |your |tuo )?(?:browser|chrome|firefox)\b`, 'im'),
  // "apri https://localhost:44319", "vai su localhost:4200", "Open http://127.0.0.1:5000"
  new RegExp(String.raw`(?:${ASK_IT}|${ASK_EN})[^\n]{0,40}${LOCAL_URL}`, 'im'),
  // "fai l'accesso nel pannello", "accedi dal browser", "log in in your browser" (not "... non nel browser")
  new RegExp(String.raw`(?:(?<!\b(?:non|se|quando|come) )\b(?:accedi|entra|fai (?:il |l')?(?:login|accesso)|loggati)|${askEn('sign in|log in')})[^.\n]{0,40}(?<!\b(?:non|not) )\b(?:nel|sul|dal|in|on) (?:tuo |your |the )?(?:browser|pannello)\b`, 'im'),
  // "aprilo nel tuo browser", "open it in your browser": in this app the user's browser for agent work is the app's
  new RegExp(String.raw`(?:${ASK_IT}|${ASK_EN}|(?<!\bnon )\b(?:aprilo|aprila|aprili|aprile|riaprilo))[^.\n]{0,80}(?<!\b(?:non|not) )\b(?:nel tuo browser|in your browser)\b`, 'im'),
];

/** The phrase of the reply that asks the user to browse, or null. */
export function asksUserToBrowse(text: string): string | null {
  const prose = text.replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
  for (const re of RULES) {
    const m = re.exec(prose);
    if (m) return m[0].replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  return null;
}

/** The app's note back to the chat (Italian, like every app message to chats). */
export function browseNote(phrase: string): string {
  return [
    APP_NOTE_LABEL,
    `Nella tua risposta hai chiesto all'utente di aprire il browser o fare l'accesso a mano («${phrase}»). Regola dell'app: il browser lo apri e lo guidi tu.`,
    '- Apri la pagina tu: tabs_create o navigate (gli host locali localhost, 127.0.0.1, *.localhost vanno sempre nell\'ambiente "local").',
    '- Login su un host remoto: handoff_to_user kind "login" con account (il banner mostra URL, account e Copia password); su uno stack locale entri tu con l\'account di test.',
    'Fallo ora, poi di\' all\'utente in una riga cosa hai aperto.',
  ].join('\n');
}

export interface ReplyRulesDeps {
  send(chatId: string, text: string): Promise<void>;
  now?(): number;
}

/** Turn ends of every chat: a reply that breaks a rule gets the app's note (one per chat per NOTE_EVERY_MS). */
export class ReplyRules {
  private last = new Map<string, number>();
  constructor(private readonly deps: ReplyRulesDeps) {}

  /** Returns the note it sent (for tests), or null. */
  turnEnded(chatId: string, reply: string | undefined, isError: boolean): string | null {
    if (isError || !reply) return null;
    const phrase = asksUserToBrowse(reply);
    if (!phrase) return null;
    const now = this.deps.now?.() ?? Date.now();
    if (now - (this.last.get(chatId) ?? -Infinity) < NOTE_EVERY_MS) return null;
    this.last.set(chatId, now);
    const note = browseNote(phrase);
    log.info('chats', 'reply rule: asked the user to browse', { chat: chatId });
    this.deps.send(chatId, note).catch(e => log.warn('chats', 'reply rule note not delivered', { chat: chatId, data: errText(e) }));
    return note;
  }
}
