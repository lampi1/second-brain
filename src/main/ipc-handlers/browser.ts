// IPC handlers, Browsers: the agents' tabs and their sign-in hand-offs, the credentials panel (the personal Browser page
// left with ADR 0212). Registered by src/main/index.ts with every other group (Handlers in ipc.ts keeps the set
// complete); each channel's shape is in src/shared/contract/*.ts.
import type { HandlerContext, HandlersOf } from './context';

export function browserHandlers({ s }: HandlerContext): HandlersOf<'browser' | 'views' | 'credentials'> {
  return {
    'browser:list': () => s.browser.list(),
    'browser:open': a => s.browser.open(a.url, a.ownerChatId ?? null, a.env),
    'browser:navigate': a => s.browser.navigate(a.tabId, a.url),
    'browser:go': a => s.browser.go(a.tabId, a.dir),
    'browser:close': a => s.browser.close(a.tabId),
    'views:layout': a => s.browser.layout(a),
    'browser:handoffs': () => s.browser.handoffs(),
    'browser:handoffResolve': a => s.browser.resolveHandoff(a.id, a.outcome, a.note),
    'browser:handoffCopy': a => s.browser.copyFromHandoff(a.id, a.field),
    'browser:envList': () => s.browser.envs(),
    'credentials:list': () => s.browser.credentials(),
    'credentials:copy': a => s.browser.copyCredential(a.id, a.field),
  };
}
