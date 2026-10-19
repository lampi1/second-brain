// Does a chat's last answer say it is still waiting for work it started (a background agent, a QA run, a reviewer, a
// build)? Why: the engine's own count of background tasks can miss one (2026-10-16: an agent resumed with SendMessage
// after it had ended was not counted, and two chats closed by themselves while it worked, losing its report). The
// owner: "assolutamente che non accada mai più". So the words of the last answer are a second, engine-independent
// signal, for every harness: a chat that says "Aspetto la QA…" is never closed, released or moved to a fresh session.
// Used by the manager (turnEnded sets ChatSummary.waitsOnWork) and read by the auto-close (renderer/lib/autoclose.ts),
// the archive's re-check, the idle engine release and the continuity rules (chats/continuity.ts).
// waitsForPeople (below): the same reading for a wait on the user or on colleagues (#86, ADR 0084).
// Tests: test/unit/waiting.test.ts.

// "aspetto / attendo / in attesa di / waiting for" whose object (the clause right after it) is something that runs on its own.
// No \b next to accented letters: JS word boundaries are ASCII.
const WAIT = /(?:^|[^\p{L}])(?:aspetto|attendo|sto aspettando|stiamo aspettando|resto in attesa|in attesa d[ie'’]\w*|waiting (?:for|on)|i'?ll wait for|wait(?:ing)? until)(?![\p{L}])/iu;
const WORK = /(?:^|[^\p{L}])(?:report|risultat\w*|esit\w*|agent\w*|sub-?agent\w*|sotto-?agent\w*|qa|review\w*|analisi|build|test|tests|pipeline|monitor|background|job|rerun|run|controll\w*|verific\w*|deploy|task|prova|prove|ricerca|indagine|investigazione|results?|checks?|subagents?)(?![\p{L}])/iu;
// the object of the wait ends at the first comma, colon, bracket or "poi / then": "Aspetto il tuo ok, poi lancio il deploy"
// waits for the user, not for the deploy
const CLAUSE_END = /[,;:(—–]|(?:^|[^\p{L}])(?:poi|then|dopo|after|before|prima di)(?![\p{L}])/iu;
// "aspetto il tuo ok", "attendo che tu…", "waiting for your ok": the user, not work
const USER = /^\s*(?:che\s+)?(?:(?:il|la|i|le|un|una|da|for|on)\s+|l['’])?(?:tu|tuo|tua|tuoi|tue|te|your|you)(?![\p{L}])/iu;
// "… sono in corso", "still running", "in background": the work runs now
const RUNNING = /(?:^|[^\p{L}])(?:in background|in the background|still running|stanno girando|sta girando|(?:è|sono) (?:ancora )?in corso|(?:is|are) (?:still )?in progress)(?![\p{L}])/iu;

/** True when the text says it waits for work still running (looked at sentence by sentence). */
export function waitsForWork(text: string | null | undefined): boolean {
  if (!text) return false;
  for (const sentence of text.split(/(?<=[.!?…])\s+|\n+/)) {
    if (RUNNING.test(sentence)) return true;
    const w = WAIT.exec(sentence);
    if (!w) continue;
    const rest = sentence.slice(w.index + w[0].length);
    const end = CLAUSE_END.exec(rest);
    const object = end ? rest.slice(0, end.index) : rest;
    if (!USER.test(object) && WORK.test(object)) return true;
  }
  return false;
}

// Waits for people (#86, ADR 0084): a report or final answer that says it waits for the user (or the Orchestrator's
// decision) or for a colleague (another chat, a named agent) keeps the chat open with an "In attesa di…" label, while
// a worker that just delivered its report closes by itself. Same sentence/clause reading as waitsForWork.
const AWAIT = /(?:^|[^\p{L}])(?:aspetto|attendo|sto aspettando|stiamo aspettando|resto in attesa|rimango in attesa|in attesa d[ie'’]\w*|waiting (?:for|on)|awaiting|i'?ll wait for|wait(?:ing)? until|blocked on|bloccat[oa] (?:su|in attesa d\w*))(?![\p{L}])/iu;
const NOT_WAITING = /(?:^|[^\p{L}])(?:non (?:aspetto|attendo|resto in attesa)|niente da aspettare|nulla da aspettare|nessuna attesa|nothing to wait|not waiting|no longer waiting)(?![\p{L}])/iu;
const COLLEAGUE = /«|"|“|(?:^|[^\p{L}])(?:collega|colleghi|altra chat|altre chat|other chats?|teammates?|colleagues?|orchestrator|regia|worker|chat\s+\S+)(?![\p{L}])/iu;
const PERSON = /(?:^|[^\p{L}])(?:utente|user|owner|proprietario|tu|tuo|tua|tuoi|tue|te|your|you)(?![\p{L}])/iu;
const DECISION = /(?:^|[^\p{L}])(?:ok|okay|conferma|confirmation|approvazione|approval|via libera|go-ahead|istruzioni|instructions|decisione|decision|risposta|reply|answer|feedback|indicazioni)(?![\p{L}])/iu;
// asks the reader to decide before it goes on: "Procedo?", "Vuoi che proceda?", "Shall I go ahead?", "Mi serve il tuo ok"
const ASKS = /(?:^|[^\p{L}])(?:procedo\s*\?|posso procedere\s*\?|vado avanti\s*\?|vuoi che\b[^.?!]*\?|dimmi (?:tu )?se (?:procedo|vado avanti)|(?:mi )?serve (?:il |la |un |una )?tu[oa]|ho bisogno (?:del |della |di un |di una )?tu[oa]|need your (?:ok|approval|input|decision|confirmation)|shall i\b[^.?!]*\?|should i (?:proceed|go ahead|continue)\s*\?)/iu;

/** Who the text says it waits for: 'user' (the user, or a decision from above), 'colleagues' (another chat or agent),
 *  null = nobody (waiting for running work is waitsForWork's). Looked at sentence by sentence. */
export function waitsForPeople(text: string | null | undefined): 'user' | 'colleagues' | null {
  if (!text) return null;
  let found: 'user' | 'colleagues' | null = null;
  for (const sentence of text.split(/(?<=[.!?…])\s+|\n+/)) {
    if (NOT_WAITING.test(sentence)) continue;
    if (ASKS.test(sentence)) return 'user';
    const w = AWAIT.exec(sentence);
    if (!w) continue;
    const rest = sentence.slice(w.index + w[0].length);
    const end = CLAUSE_END.exec(rest);
    const object = end ? rest.slice(0, end.index) : rest;
    if (PERSON.test(object) && !COLLEAGUE.test(object)) return 'user';
    if (COLLEAGUE.test(object)) { found = 'colleagues'; continue; }
    if (WORK.test(object)) continue; // running work: waitsForWork
    if (DECISION.test(object)) return 'user';
  }
  return found;
}
