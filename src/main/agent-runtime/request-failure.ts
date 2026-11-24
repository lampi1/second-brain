// What an engine adapter does when its async handler of an engine request (Claude's control_request, an ACP agent
// request) throws. A failure of the runtime broker (RuntimeOperationError) leaves the session's state uncertain, so the
// engine stops; an engine that is gone meanwhile (it exited, or was closed, between its request and the answer) is
// expected and only noted (#459: the answer has nowhere to go and nothing is wrong); any other error (a manager
// handler, SQLite, a write) is logged as before the handlers became async and the engine keeps running (review of the
// app-owned runtime, finding 2). Used by chats/claude.ts and chats/acp.ts; tests:
// test/unit/agent-runtime-request-failure.test.ts.
import { errText, log } from '../log';
import { RuntimeOperationError } from './channel';

export function requestFailed(e: unknown, o: { chatId: string; what: string; kill: () => void; /** the engine exited or its input is closed */ gone?: () => boolean }): void {
  if (e instanceof RuntimeOperationError) {
    log.warn('chats', `${o.what}: runtime broker failed, engine stopped`, { chat: o.chatId, data: { outcome: e.outcome } });
    o.kill();
    return;
  }
  if (o.gone?.()) {
    log.info('chats', `${o.what}: the engine was gone before its answer`, { chat: o.chatId, data: { cause: errText(e) } });
    return;
  }
  log.error('chats', `${o.what} failed`, { chat: o.chatId, cause: errText(e), hint: 'the engine keeps running; see the handler in chats/' });
}
