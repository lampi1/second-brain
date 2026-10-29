// IPC handlers, Browsers: the agents' tabs and their sign-in hand-offs, the credentials panel, the user's personal
// Browser page (ADR 0133). Registered by src/main/index.ts with every other group (Handlers in ipc.ts keeps the set
// complete); each channel's shape is in src/shared/contract/*.ts.
import type { HandlerContext, HandlersOf } from './context';

export function browserHandlers({ s }: HandlerContext): HandlersOf<'browser' | 'views' | 'personal' | 'credentials'> {
  return {
    'browser:list': () => s.browser.list(),
    'browser:open': a => s.browser.open(a.url, a.ownerChatId ?? null, a.env),
    'browser:navigate': a => s.browser.navigate(a.tabId, a.url),
    'browser:go': a => s.browser.go(a.tabId, a.dir),
    'browser:close': a => s.browser.close(a.tabId),
    // one reporter for every native view: the agent tiles and the personal Browser page (each takes its own ids)
    'views:layout': a => { s.browser.layout(a); s.personal.layout(a); },
    // the user's own browser (personal/browser.ts, ADR 0133): no MCP tool reaches any of these
    'personal:state': () => s.personal.state(),
    'personal:open': a => s.personal.open(typeof a?.url === 'string' ? a.url : undefined),
    'personal:navigate': a => s.personal.navigate(a.tabId, String(a.input ?? '')),
    'personal:go': a => s.personal.go(a.tabId, a.dir),
    'personal:select': a => s.personal.select(a.tabId),
    'personal:close': a => s.personal.close(a.tabId),
    'personal:restore': () => s.personal.restore(),
    'personal:bookmarkAdd': a => s.personal.addBookmark(String(a.url ?? ''), String(a.title ?? '')),
    'personal:bookmarkRemove': a => s.personal.removeBookmark(String(a.id)),
    'personal:sessionSave': a => s.personal.saveSession(String(a.name ?? '')),
    'personal:sessionOpen': a => s.personal.openSession(String(a.id)),
    'personal:sessionRemove': a => s.personal.removeSession(String(a.id)),
    'personal:historyClear': () => s.personal.clearHistory(),
    'personal:loginFill': a => s.personal.fillLogin(a.tabId, String(a.id)),
    'personal:loginSave': a => s.personal.saveLogin(a.tabId),
    'personal:loginRemove': a => s.personal.removeLogin(String(a.id)),
    'personal:loginCopy': a => s.personal.copyLogin(String(a.id), a.field === 'password' ? 'password' : 'user'),
    'personal:loginImport': () => s.personal.importLogins(),
    'personal:lend': a => s.personal.lendTab(a.tabId, String(a.chatId ?? ''), typeof a.note === 'string' ? a.note : ''),
    'personal:reclaim': a => s.personal.reclaimTab(a.tabId),
    'personal:onScreen': a => s.personal.setOnScreen(a?.on === true),
    'browser:handoffs': () => s.browser.handoffs(),
    'browser:handoffResolve': a => s.browser.resolveHandoff(a.id, a.outcome, a.note),
    'browser:handoffCopy': a => s.browser.copyFromHandoff(a.id, a.field),
    'browser:envList': () => s.browser.envs(),
    'credentials:list': () => s.browser.credentials(),
    'credentials:copy': a => s.browser.copyCredential(a.id, a.field),
  };
}
