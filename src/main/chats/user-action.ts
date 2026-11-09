// A run stopped on a step only the user can do (#358): its agent_report's userAction becomes one yes/no question in the
// Orchestrator, asked by the app itself (no Orchestrator turn needed), and Sì tells whoever owns the work to resume.
// Pure builders, used by manager-delegation.ts (askUserAction, answerUserAction). Tests: test/unit/chats/user-action.test.ts.
import type { Answer, PendingRequest } from '../../shared/contract';
import type { UserAction } from '../../shared/delegation';
import { yesNoOf } from '../../shared/yes-no';

/** the tool name of the app's own question (never an engine's: its answer never reaches an engine) */
export const USER_ACTION_TOOL = 'app_user_action';
export const isUserActionRequest = (req: Pick<PendingRequest, 'type' | 'tool'>): boolean => req.type === 'question' && req.tool === USER_ACTION_TOOL;

export interface UserActionInput { userAction: true; chatId: string; runId: string | null; title: string; text: string; command?: string }

/** The question on the Orchestrator: names the chat, says what to do, shows the command when there is one. */
export function userActionRequest(at: number, chat: { id: string; title: string; runId: string | null }, ua: UserAction): Omit<PendingRequest, 'chatId'> {
  const input: UserActionInput = { userAction: true, chatId: chat.id, runId: chat.runId, title: chat.title, text: ua.text, ...(ua.command ? { command: ua.command } : {}) };
  const question = `«${chat.title}» è fermo: ${ua.text.replace(/[.\s]+$/, '')}. Fatto?${ua.command ? `\n\n\`\`\`\n${ua.command}\n\`\`\`` : ''}`;
  return { id: `user-action-${chat.runId ?? chat.id}-${at}`, type: 'question', tool: USER_ACTION_TOOL, at, input,
    title: `${chat.title}: ${ua.text}`, detail: ua.command ?? '',
    questions: [{ question, header: 'Serve a te', multiSelect: false, options: [
      { label: 'Sì', description: 'L’ho fatto: il lavoro riprende' },
      { label: 'No', description: 'Resta fermo: lo trovi nella sua chat' },
    ] }] };
}

/** 'yes' / 'no' / the user's own words for the app's question; null for an answer of another shape. */
export function userActionAnswer(req: Pick<PendingRequest, 'questions'>, answer: Answer): { yes: boolean; words?: string } | null {
  const q = req.questions?.[0]?.question;
  if (answer.kind !== 'question' || !q) return null;
  const raw = answer.answers[q], value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !value.trim()) return null;
  const yn = yesNoOf(value);
  return yn === 'yes' ? { yes: true } : yn === 'no' ? { yes: false } : { yes: false, words: value.trim() };
}

/** What the owner of the work reads when the user did the step (Sì) or answered in words. */
export function userActionMessage(input: Pick<UserActionInput, 'title' | 'text' | 'command'>, reply: { yes: boolean; words?: string }, how: 'parent' | 'orchestrator'): string {
  const resume = how === 'parent' ? 'riassegnala con agent_assign_task' : 'riassegnala con app_assign_task';
  return reply.yes
    ? `[azione dell’utente fatta · chat «${input.title}»]\nL’utente ha fatto quello che serviva: ${input.text}. Riprendi il lavoro di quella chat: ${resume} con il passo successivo.`
    : `[risposta dell’utente · chat «${input.title}»]\nAlla richiesta «${input.text}» l’utente ha risposto: «${reply.words}». Decidi tu come proseguire con quella chat.`;
}
