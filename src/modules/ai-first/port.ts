// Existing typed bridge adapter. A real first greeting in the actual setup chat is the connection proof.
import type { SetupState, SetupGuide } from '../../shared/agents';
import { sb } from '../../renderer/sb';
import { app, createChat, refreshInfo } from '../../renderer/store/store';
import { saveSetup } from '../../renderer/store/agents';
import { focusChat } from '../../renderer/actions';
import { closeModal } from '../../renderer/store/ui';
import { engines, guidePrompt, replyProof } from './model';
import type { SetupEngine } from './model';
import type { AiSetupPort, EngineOption } from './contract';
import type { ChatItem, CliStatus } from '../../shared/contract';
export function createAiSetupPort(initial: SetupState, language: 'it' | 'en', onConnected?: () => void): AiSetupPort {
  let preferences = initial.preferences;
  const persist = async (guide?: SetupGuide) => { const value = await saveSetup({ ...preferences, ...(guide ? { guide } : {}) }, guide?.stage === 'guided' ? 'completed' : 'draft'); preferences = value.preferences; };
  const trust = async (engine: SetupEngine) => {
    const info = await sb.invoke('app:info', undefined), definition = info.engines.find(e => e.id === engine && e.source === 'app');
    if (!definition) throw new Error('AI_SETUP_ENGINE_POLICY');
    // A click explicitly chooses this built-in engine, including re-enabling one previously switched off.
    await sb.invoke('engines:trust', { engine });
  };
  return {
    async bootstrap() {
      // Persist first: creating memory must not make a restarted new install appear already configured.
      await persist(initial.status === 'new' && !preferences.guide ? { stage: 'choosing' } : undefined);
      await sb.invoke('app:createBrain', { language, harness: 'none' }).catch(() => null);
      await refreshInfo();
      const info = await sb.invoke('app:info', undefined);
      const choices = await Promise.all(engines.map(async id => {
        const definition = info.engines.find(e => e.id === id && e.source === 'app');
        let status: CliStatus | null = null; try { if (definition) status = await sb.invoke('cli:status', { harness: id, checkLogin: true }); } catch { /* unknown is not absent */ }
        return { id, label: ({ claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' })[id], status, trusted: !!definition?.trusted, runs: definition?.runs ?? '' } satisfies EngineOption;
      }));
      const rank = (c: EngineOption) => c.status?.found ? c.status.loggedIn === true ? 0 : c.status.loggedIn === false ? 2 : 1 : 3;
      return { root: !info.brainProblem ? info.brainRoot : null, engines: choices.sort((a, b) => rank(a) - rank(b)) };
    },
    async login(engine) { await trust(engine); await sb.invoke('cli:login', { harness: engine }); },
    async start(engine, root) {
      await trust(engine);
      const current = await sb.invoke('app:info', undefined);
      if (current.brainProblem || current.brainRoot !== root) throw new Error('AI_SETUP_MEMORY_CHANGED');
      await sb.invoke('cli:status', { harness: engine, checkLogin: true });
      const chat = await createChat({ harness: engine, cwd: root, title: language === 'it' ? 'Il tuo spazio, insieme' : 'Your workspace, together', prompt: guidePrompt(language), permissionMode: 'default' });
      if (!chat) throw new Error('AI_SETUP_START');
      await sb.invoke('settings:set', { orchestratorChats: { harness: engine } });
      return chat.id;
    },
    prove(chatId, signal) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const stop = () => { void sb.invoke('chat:stop', { chatId }).catch(() => {}); };
        const cleanup = () => { clearTimeout(timer); off(); signal.removeEventListener('abort', abort); };
        const finish = (error?: string, reply?: string) => {
          if (settled) return;
          settled = true; cleanup();
          if (error) reject(new Error(error));
          else resolve(reply ?? '');
        };
        const check = (items: ChatItem[]) => {
          const proof = replyProof(items);
          if (proof === 'failed') finish('AI_SETUP_REPLY');
          else if (proof === 'verified') finish(undefined, items.find(i => i.kind === 'assistant' && i.text.trim())?.kind === 'assistant' ? (items.find(i => i.kind === 'assistant' && i.text.trim()) as Extract<ChatItem, { kind: 'assistant' }>).text : '');
        };
        const abort = () => { stop(); finish('AI_SETUP_CANCELLED'); };
        const off = sb.on('chat:item', event => { if (event.chatId === chatId && event.item.kind === 'result') void sb.invoke('chat:items', { chatId }).then(check, () => finish('AI_SETUP_REPLY')); });
        const timer = setTimeout(() => { stop(); finish('AI_SETUP_TIMEOUT'); }, 90000);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) { abort(); return; }
        void sb.invoke('chat:items', { chatId }).then(check, () => finish('AI_SETUP_REPLY'));
      });
    },
    async cancel(chatId) { await sb.invoke('chat:stop', { chatId }); },
    persist,
    open(chatId) { if (onConnected) onConnected(); else closeModal(); if (!app.get().chats[chatId]) return; focusChat(chatId); },
  };
}
