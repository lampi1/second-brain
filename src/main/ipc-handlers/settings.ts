// IPC handlers, Settings and engines: settings and proposals, API keys, engine trust and spend, the job ledger, the
// routing table, models seen, brain sync. Registered by src/main/index.ts with every other group (Handlers in ipc.ts
// keeps the set complete); each channel's shape is in src/shared/contract/*.ts.
import { errText, log } from '../log';
import { uiLang } from '../locale';
import { withApiModels } from '../engines/sessions';
import type { HandlerContext, HandlersOf } from './context';

export function settingsHandlers({ s, profile }: HandlerContext): HandlersOf<'settings' | 'secrets' | 'engines' | 'estimate' | 'routing' | 'models' | 'sync'> {
  return {
    'settings:get': () => s.brain.settings(),
    // API keys: write-only from the page, never returned (engines/secrets.ts); no MCP tool reaches these
    'secrets:status': () => s.engines.secretsStatus(),
    'secrets:set': a => s.engines.setSecret(a.engine, a.key),
    'secrets:delete': a => s.engines.deleteSecret(a.engine),
    'engines:trust': a => s.engines.trust(a.engine),
    'engines:spend': () => s.engines.apiSpend(),
    'settings:set': async a => {
      const saved = await s.brain.setSettings(a);
      // one language for the UI and the AI (ADR 0120): me.md's `Language:` follows the setting (Windows' on «sistema»)
      if (a && typeof a === 'object' && 'language' in a) void profile.syncLanguage(uiLang()).catch(e => log.warn('brain', 'profile language not updated', { cause: errText(e), hint: 'me.md keeps its Language line; edit it in Settings → Il mio profilo' }));
      return saved;
    },
    'settings:schema': () => s.brain.settingsSchema(),
    'settings:history': a => s.brain.settingsHistory(a?.limit),
    'settings:undo': a => s.brain.undoSetting(a?.changeId, 'user'),
    // the page relays an agent's request (e.g. from a chat tile): an agent's, never counted as the user's ok
    'settings:propose': a => s.brain.requestSetting(a?.key, a?.value, { by: 'agent', ...(a?.chatId ? { chatId: String(a.chatId) } : {}), ...(a?.reason ? { reason: String(a.reason) } : {}) }),
    'settings:pending': () => s.brain.pendingSettings(),
    'settings:confirm': a => s.brain.confirmSetting(a?.proposalId, a?.accept),
    'estimate:record': a => s.brain.recordJob(a),
    'models:seen': () => withApiModels(s.brain.modelsSeen()),
    'routing:get': () => s.brain.routingInfo(),
    // the renderer is the user's (sender check in ipc.ts): agents never reach this write, they only propose in chat
    'routing:save': a => s.brain.saveRouting(Array.isArray(a?.routes) ? a.routes : [], typeof a?.reason === 'string' && a.reason.trim() ? a.reason.trim().slice(0, 300) : null,
      { ...(a?.costWeight !== undefined ? { costWeight: Number(a.costWeight) } : {}),
        ...(Number.isInteger(a?.baseVersion) ? { base: a.baseVersion } : {}) }),
    'sync:get': () => s.brain.syncState(),
    'sync:now': a => s.brain.syncNow(a?.domain),
    'sync:resolve': a => s.brain.syncResolve(a?.domain, a?.choice),
  };
}
