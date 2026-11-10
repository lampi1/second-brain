# ADR 0262 · A Yes is not a run: user steps resume on evidence, «hai eseguito?» never passes as a run

Date: 2026-11-10 · Status: accepted (owner issues #371 and #372, «risolvi tutte le issue aperte») · Changes: ADR 0253
(the user-action question and its Sì) · Builds on: ADR 0259 §3 (Esegui is the question)

## Context
- #372: three times in two chats in one week an agent asked «Hai eseguito il comando sopra?», got Sì and went on,
  although nothing had run (the file still equal to its backup, a flag still at its old value). The role rule already
  forbade the question; nothing enforced it.
- #371: the app's «[azione dell'utente fatta]» message (ADR 0253) went to the owner of the work at the user's Sì on the
  question «… Fatto?», also before the command it named had run; the coordinator told the user the chat had resumed.

## Decision
- **The question goes back** (`shared/yes-no.ts ranCommandQuestion`): a yes/no question asking whether the user ran,
  launched or executed something, with the user as the subject («hai/avete …», «did you …», a bare «Comando
  eseguito?», a passive only as the whole question on a command), fails the short-question check, so the engines' gates
  send it back with YESNO_REFUSAL, which now says to leave the command in a block: Esegui asks to run it and the result
  reaches the chat by itself (ADR 0259 §3).
- **A Yes no run backs is told as such** (`chats/ran-check.ts backedAnswer`, in `manager-requests.ts answer`): when
  such a question still reaches the user (after the retries) and the answer is Sì while no run of that chat started
  from 15 minutes before the question on, the chat reads NOT_RAN_NOTE («l'utente ha risposto Sì, ma con Esegui non è
  partito nessun comando di questa chat: non darlo per eseguito, ricontrolla»), never a bare Sì. The agent's own status
  before its real question («I test sono stati eseguiti: procedo al merge?», «L'agente ha eseguito i test…») is not
  matched. «Modalità notte» answers with the same note (its recommended Sì is no run either); an ACP engine
  (cursor/ask_question) gets the note as the skip reason itself, never wrapped as the user's own words.
- **A user step with a command resumes on its run** (`chats/user-action.ts`, `manager-delegation.ts`): the question
  reads «… Lo riprendo quando il comando ha girato?»; after Sì the work waits until a run of that same command with
  Esegui ends (one that ended after the question counts; an earlier run that failed is why the step stopped), then the owner gets «[comando dell'utente eseguito …]» with
  the command, exit code and output (`run/results.ts runResultText`). A later report of that chat drops the wait, and so
  does a message to the worker from the user or the owner of its work (not the app's own run results), its close, another run of it or 12 hours; the
  wait lives in memory only (a restart drops it); meanwhile the worker is held, never auto-closed. The user can also write in the chat, as before.
- **A step without a command is the user's word**: the question reads «… L'hai fatto tu?» and the owner gets «[l'utente
  dice di aver fatto il passo …] … è la sua parola, l'app non l'ha verificato … controlla che sia davvero fatto».
- Wiring: `ChatManagerOptions.runs` reads the runner's list, and the runner's end of a run calls `manager.runEnded`.

## Consequences
- A command run outside the app (in the user's own terminal) does not resume a waiting step: the user writes it in the
  chat. A user step's Sì with a command no longer moves the work by itself.
