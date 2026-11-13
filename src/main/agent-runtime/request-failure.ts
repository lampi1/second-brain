// What an engine adapter does when its async handler of an engine request (Claude's control_request, an ACP agent
// request) throws. A failure of the runtime broker (RuntimeOperationError) leaves the session's state uncertain, so the
// engine stops; any other error (a manager handler, SQLite, a write) is logged as before the handlers became async and
// the engine keeps running (review of the app-owned runtime, finding 2). Used by chats/claude.ts and chats/acp.ts;
// tests: test/unit/agent-runtime-request-failure.test.ts.
import { errText, log } from '../log';
import { RuntimeOperationError } from './channel';

export function requestFailed(e: unknown, o: { chatId: string; what: string; kill: () => void }): void {
  if (e instanceof RuntimeOperationError) {
    log.warn('chats', `${o.what}: runtime broker failed, engine stopped`, { chat: o.chatId, data: { outcome: e.outcome } });
    o.kill();
    return;
  }
  log.error('chats', `${o.what} failed`, { chat: o.chatId, cause: errText(e), hint: 'the engine keeps running; see the handler in chats/' });
}
