// Stop on a stuck engine (manager-lifecycle.ts stop). Stop sends the engine an interrupt and waits for its answer
// (15 s for Claude's control request, the engines' own timeouts elsewhere); an engine that does not answer is stuck
// (a hung tool, a frozen CLI) and used to stay alive with all its tools, burning CPU, while the user only saw
// «Stop non riuscito» (owner, 2026-11-23). Now its whole process tree is killed instead (killNow: the job, else
// taskkill /T), logged with the reason; the chat stays, and its next message starts a fresh engine on the same
// session. Pinned by test/unit/chats/stop-kill.test.ts.
import { errText, log } from '../log';
import type { HarnessSession } from './session';

/** Interrupts `sess`; when the interrupt fails while the engine still runs, kills its tree. 'interrupted' | 'killed'. */
export async function stopOrKill(sess: Pick<HarnessSession, 'interrupt' | 'killNow' | 'alive' | 'pid'>, chatId: string, keepQueued = false): Promise<'interrupted' | 'killed'> {
  try {
    await sess.interrupt({ keepQueued, byUser: true });
    return 'interrupted';
  } catch (e) {
    if (!sess.alive) throw new Error(`Stop non riuscito: ${errText(e)}`);
    log.warn('chats', 'stuck engine killed on Stop', { chat: chatId, data: { pid: sess.pid ?? null, reason: 'the interrupt got no answer' }, cause: errText(e), hint: 'its next message starts a new engine on the same session' });
    sess.killNow();
    return 'killed';
  }
}
