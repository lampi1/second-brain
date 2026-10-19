// "Posta all'Orchestrator": THE one rule for when something reaches an Orchestrator, for both of its sources: the app's news
// (orchestrator-wake.ts: a work chat finished, failed, waits for the user) and the mail between chats (mail.ts: send_to_chat,
// inbox.mjs). Why one rule: two hold systems with their own windows (20 s / 2 min and 60 s / 30 min) and their own idea
// of "the Orchestrator is free" could cost two turns for the same "ha finito" and let mail reach an Orchestrator waiting for the user
// (audit 2026-10-15 #6; the owner chose the rule below on 15/10). Each delivery to an idle Orchestrator is a new turn
// re-reading its whole context (measured 07-13/10: median ~0.18 $), so news arriving together goes in one turn.
//
// The rule:
// - three classes: 'now' (urgent mail, a work chat stopped on an error), 'group' (a turn finished, a request: within
//   ORCHESTRATOR_GROUP_MS, all together), 'quiet' (a question/permission/command left to the user, a progress note: they ride
//   along with the next delivery; progress mail at the latest after ORCHESTRATOR_HOLD_MS, the quiet news never wake alone);
// - the Orchestrator's state decides (orchestratorGate): it works → everything goes into its running turn (no new turn); it waits
//   for the user, is in a hand-off or failed → only 'now'; it is idle or closed → by class. An engine that cannot take
//   a message mid-turn (Cursor over ACP: Stop drops its queue) gets nothing until its turn ends.
// A mail's class: its sender's `kind` (send_to_chat), else the words of the user's brain (<brain>/brain-settings.json
// `orchestratorMail`, defaults below). Pure: used by orchestrator-wake.ts and mail.ts, pinned by test/unit/chats/orchestrator-delivery.test.ts.
import type { ChatSummary, HeldNewsWhy } from '../../shared/contract';

export const ORCHESTRATOR_GROUP_MS = 30_000;
export const ORCHESTRATOR_HOLD_MS = 30 * 60_000;
/** the news of one chat at most once in this time (a chat flapping between states is told once) */
export const ORCHESTRATOR_PER_CHAT_MS = 120_000;

export type DeliveryClass = 'now' | 'group' | 'quiet';
/** what the sender of a mail says it is (send_to_chat's `kind`) */
export type MailKind = 'urgent' | 'request' | 'info';
export const MAIL_KINDS: readonly MailKind[] = ['urgent', 'request', 'info'];

/** queue: idle or closed (a message resumes it), by class; inject: it works, all goes into its turn; hold: only 'now';
 *  busy: it works on an engine that takes no message mid-turn, nothing goes */
export type OrchestratorGate = 'queue' | 'inject' | 'hold' | 'busy';

/** midTurn = its engine takes a message within a running turn (Claude's stream-json; not Cursor's ACP) */
export function orchestratorGate(r: Pick<ChatSummary, 'state' | 'pending' | 'handoffBusy'>, midTurn = true): OrchestratorGate {
  if (r.pending || r.handoffBusy) return 'hold';
  if (r.state === 'idle' || r.state === 'closed') return 'queue';
  if (r.state === 'running' || r.state === 'starting') return midTurn ? 'inject' : 'busy';
  return 'hold'; // waiting (a question or permission open), error
}

/** May something of this class go now through this gate (timing aside)? */
export const passes = (gate: OrchestratorGate, cls: DeliveryClass): boolean => gate === 'inject' || gate === 'queue' || (gate === 'hold' && cls === 'now');

/** Why something of this class still waits at this gate, as the Orchestrator's tile says it (#88: "N novità in
 *  attesa"): the gate holds it (the Orchestrator waits for the user, or is busy), or it waits its turn by class. */
export function heldWhy(gate: OrchestratorGate, cls: DeliveryClass, r: Pick<ChatSummary, 'state' | 'pending'>): HeldNewsWhy {
  if (!passes(gate, cls)) return gate === 'hold' && (r.pending > 0 || r.state === 'waiting') ? 'user' : 'busy';
  return gate === 'queue' && cls === 'quiet' ? 'quiet' : 'group';
}

/** How long after it arrived a 'queue' delivery of this class is due (quiet mail; quiet news: never by itself). */
export const waitOf = (cls: DeliveryClass, group = ORCHESTRATOR_GROUP_MS, hold = ORCHESTRATOR_HOLD_MS): number =>
  cls === 'now' ? 0 : cls === 'group' ? group : hold;

/** The words that classify a mail without a `kind`. An entry is a whole word or phrase; "stem*" matches any word that
 *  starts with it. Case and ’/' do not matter. */
export interface OrchestratorWords { urgent: string[]; progress: string[]; action: string[] }

/** Used when the brain says nothing. A progress note held by mistake costs a wait, a request held by mistake the
 *  Orchestrator's reaction: holding needs a progress word and no action word (a "?" or a commit sha count as action too). */
export const DEFAULT_WORDS: OrchestratorWords = {
  urgent: ['urgente', 'urgenti', 'urgent', 'subito', 'asap'],
  progress: ['rilasciat*', 'released', 'in corso', 'sto lavorando', 'sto ancora lavorando', 'sto facendo', 'sto ancora facendo',
    'sto aspettando', 'sto ancora aspettando', 'sto misurando', 'sto ancora misurando', 'sto provando', 'sto ancora provando',
    'working on', 'still running', 'holding', 'tengo', 'per info', 'fyi', 'nota', 'note:', 'ricevuto', 'noted', 'niente da fare',
    'nothing to do', 'confermat*', 'confirmed', 'scritto in', 'scritta in', 'written to'],
  action: ['sha', 'commit*', 'push*', 'pr', 'pull request', 'pullrequest', 'branch*', 'ramo', 'rami', 'merg*', 'unisc*', 'unire',
    'promuov*', 'promot*', 'pronto', 'pronta', 'ready', 'verde', 'verdi', 'green', 'ko', 'finit*', 'fatto', 'fatta', 'done',
    'complet*', 'fallit*', 'fallisc*', 'fail*', 'errore*', 'error*', 'rosso', 'rossi', 'red', 'bloccat*', 'blocked', 'bug*',
    'conflitt*', 'decid*', 'serve', 'servo', 'servono', 'please', 'puoi', 'potete', 'can you', 'tocca a te', 'attend*', 'waiting',
    'apri', 'open a', "l'utente", 'the user', 'chied*', 'ask', 'asks', 'domand*', 'question*', 'permess*', 'permission*',
    'correzion*', 'correction*', 'sbagliat*', 'wrong', 'ok', 'via', 'aspett*', 'bisogn*', 'conferma', 'manca*', 'devi',
    'dubbi*', 'dimmi*', 'dici', 'broke*', 'rotto', 'rotta', 'rotti', 'crash*', 'non passa*'],
};

const MAX_ENTRIES = 300, MAX_LEN = 60;
const norm = (s: string): string => s.replace(/[’‘`]/g, "'");
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One regex per list, from escaped literals only (an agent writes the brain: no pattern of theirs ever runs). */
function compile(list: readonly string[]): RegExp | null {
  const alts = list.filter(w => typeof w === 'string').slice(0, MAX_ENTRIES).map(w => norm(w.trim()).slice(0, MAX_LEN)).filter(w => w.replace(/\*$/, '') !== '')
    .map(w => (w.endsWith('*') ? `${esc(w.slice(0, -1))}` : `${esc(w)}(?![\\p{L}\\p{N}_])`));
  return alts.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alts.join('|')})`, 'iu') : null;
}

/** A commit sha: 7-40 hex characters with at least one digit and one letter. */
const SHA = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/i;

export interface MailClassifier { (text: string, kind?: string | null): DeliveryClass }

/** The class of a mail: its sender's kind first, else the words (urgent → now; progress and no action → quiet). */
export function mailClassifier(words: OrchestratorWords = DEFAULT_WORDS): MailClassifier {
  const urgent = compile(words.urgent), progress = compile(words.progress), action = compile(words.action);
  return (text, kind) => {
    if (kind === 'urgent') return 'now';
    if (kind === 'info') return 'quiet';
    if (kind === 'request') return 'group';
    const t = norm(text);
    if (urgent?.test(t)) return 'now';
    const acts = t.includes('?') || SHA.test(t) || !!action?.test(t);
    return progress?.test(t) && !acts ? 'quiet' : 'group';
  };
}

/** The brain's `orchestratorMail` (brain-settings.json), each list falling back to the default when absent or not a list. */
export function wordsFrom(raw: unknown): OrchestratorWords {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = (k: keyof OrchestratorWords): string[] => (Array.isArray(o[k]) && (o[k] as unknown[]).every(w => typeof w === 'string') ? (o[k] as string[]) : DEFAULT_WORDS[k]);
  return { urgent: list('urgent'), progress: list('progress'), action: list('action') };
}

/** The class of an app news (orchestrator-wake.ts): a failure at once, a turn end grouped, what waits for the user quiet. */
export const newsClass = (kind: 'done' | 'error' | 'question' | 'permission' | 'command' | 'started', endsTurn?: boolean): DeliveryClass =>
  kind === 'error' ? 'now' : kind === 'done' || endsTurn ? 'group' : 'quiet';

/** A classifier that follows the brain's `orchestratorMail` as it changes (rebuilt only when the lists change). */
export function brainClassifier(read: () => unknown): () => MailClassifier {
  let key = '', cls = mailClassifier();
  return () => {
    let raw: unknown;
    try { raw = read(); } catch { raw = undefined; }
    const k = JSON.stringify(raw ?? null);
    if (k !== key) { key = k; cls = mailClassifier(wordsFrom(raw)); }
    return cls;
  };
}
