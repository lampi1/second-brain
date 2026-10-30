// IPC handlers, Chats: the chat list and items, create and send, answers, stop, archive, hand-offs, «Esegui» runs, the
// the Orchestrator's held news, the clipboard image. Registered by src/main/index.ts with every
// other group (Handlers in ipc.ts keeps the set complete); each channel's shape is in src/shared/contract/*.ts.
import { agentsMayOpen, engineOn } from '../engines/policy';
import { chatItemsReply } from '../../shared/chat-window';
import { createRoutedChat } from '../chats/routed';
import { gitBranches } from '../chats/branch';
import { markRunOutcome } from '../run/outcome';
import { noteUserTyped } from '../appctl/user-words';
import { readClipboardImage } from '../clipboard-image';
import type { HandlerContext, HandlersOf } from './context';

export function chatsHandlers({ s, activity, orchestrator, clip }: HandlerContext): HandlersOf<'chat' | 'orchestrator' | 'later' | 'run' | 'clipboard'> {
  return {
    'chat:autoCloseGet': () => { s.autoClose.refresh(); return s.autoClose.state(); },
    'chat:autoClosePresence': a => s.autoClose.setPresence(Array.isArray(a?.holds) ? a.holds : []),
    'chat:autoCloseKeep': a => { if (typeof a?.chatId !== 'string' || typeof a.keep !== 'boolean') throw new Error('Richiesta non valida.'); s.autoClose.keepOpen(a.chatId, a.keep); },
    'run:outcome': a => markRunOutcome(s.chats, a),
    'chat:list': () => s.chats.list(),
    'chat:items': a => chatItemsReply(s.chats.items(a.chatId), a),
    'chat:pending': () => [...s.chats.pending(), ...s.asks.pending()].sort((a, b) => a.at - b.at),
    'chat:create': a => s.chats.create(a),
    // "Nuova chat" and a new Orchestrator: the routing table picks the engine, model and effort (ADR 0032)
    'chat:createRouted': a => createRoutedChat({ route: r => s.brain.route(r), engineOn: h => engineOn(s.brain.settings(), h), agentsMayOpen: h => agentsMayOpen(s.brain.settings(), h), create: r => s.chats.create(r) }, a, { byUser: true }),
    'chat:send': async a => {
      noteUserTyped(a.chatId);
      const spoken = a.voice === true && typeof a.text === 'string';
      if (spoken) s.chats.spokenNext?.(a.chatId, a.text);
      const said = s.userCorrections && typeof a.text === 'string' ? s.chats.correctionContext?.(a.chatId) ?? null : null; // ADR 0197
      try { await s.chats.send(a.chatId, a.text, a.images); } finally { if (spoken) s.chats.spokenNext?.(a.chatId, null); }
      s.chats.resumedByUser?.(a.chatId, a.text);
      if (said) void s.userCorrections!.note(a.text, said, runId => s.chats.correctedAfterReport?.(runId));
    },
    'chat:synthesize': a => { if (!s.chats.synthesizeResult) throw new Error('Result synthesis unavailable.'); return s.chats.synthesizeResult(a.runId, { kind: 'user' }); },
    'chat:answer': async a => { activity.answered(a.chatId, a.requestId); try { await s.chats.answer(a.chatId, a.requestId, a.answer); } catch (e) { activity.notAnswered(a.chatId, a.requestId); throw e; } },
    'chat:plan': a => s.chats.planDecide(a.chatId, a.decision, a.at, a.text),
    'chat:stop': a => { activity.stopped(a.chatId); return s.chats.stop(a.chatId, a.keepQueued === true); },
    'chat:stopAll': () => { activity.stopped(); return s.chats.stopAll(); },
    'chat:close': a => { activity.stopped(a.chatId); return s.chats.close(a.chatId); },
    'chat:archive': a => { if (a.auto !== true) activity.stopped(a.chatId); return s.chats.archive(a.chatId, { auto: a.auto === true, undoable: a.undoable === true }); },
    'chat:reopen': async a => { const c = await s.chats.reopen(a.chatId); s.chats.resumedByUser?.(a.chatId); return s.chats.list().find(x => x.id === a.chatId) ?? c; },
    'chat:admitNow': a => s.chats.admitNow(a.chatId),
    'chat:prewarm': a => s.chats.prewarm?.(a.chatId) ?? false,
    'chat:set': ({ chatId, ...patch }) => s.chats.set(chatId, patch),
    'chat:handoff': a => s.chats.handoff(a.chatId, { reason: 'manual' }),
    'chat:handoffRead': a => s.chats.readHandoff(a.chatId, typeof a.session === 'string' ? a.session : undefined),
    'chat:continue': a => s.chats.continueChat(a.chatId),
    'chat:undoTurn': a => s.chats.undoTurn(a.chatId),
    // only the folders of the app's own chats, never a network path (a stat on \\host\share would reach out)
    'chat:branches': a => {
      const known = new Set(s.chats.list().map(c => c.cwd));
      const cwds = Array.isArray(a?.cwds) ? a.cwds.filter(c => typeof c === 'string' && known.has(c) && !/^[\\/]{2}/.test(c)) : [];
      return (s.branches ?? gitBranches)(cwds);
    },
    // a run answers the "Comando da eseguire" request of that block (Esegui on the card or under the block)
    'run:start': a => { if (s.chats.list().some(c => c.id === a.chatId && c.routineArchived)) throw new Error('Archived routine chats are read-only.'); const run = s.runner.start(a); s.asks.ran(run.chatId, run.itemId, run.code); return run; },
    'run:dismiss': a => s.asks.dismiss(a.chatId, a.requestId),
    'run:stop': a => s.runner.stop(a.runId),
    'run:list': a => s.runner.list(a?.chatId),
    // the engine's own list when it reported one, else its skills on disk for the chat's folder
    'chat:commands': a => {
      const c = s.chats.list().find(x => x.id === a?.chatId);
      return c ? s.chats.commands(c.id) ?? s.skills.commandsFor(c.harness, c.cwd) : [];
    },
    'orchestrator:ensure': a => orchestrator.ensure(a),
    'clipboard:image': a => readClipboardImage(clip, Array.isArray(a?.seen) ? a.seen.filter((t): t is string => typeof t === 'string').slice(0, 20) : []),
    'later:set': a => s.later.set(a?.on === true),
    'orchestrator:held': () => s.heldNews?.get() ?? { items: [] },
    'orchestrator:heldSeen': a => { if (typeof a?.chatId !== 'string' || !a.chatId || a.chatId.length > 100) throw new Error('chatId required'); return s.heldNews?.seen(a.chatId) ?? { items: [] }; },
  };
}
