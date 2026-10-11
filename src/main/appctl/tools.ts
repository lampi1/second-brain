// App control tools: the app itself, usable by AI (the user, 2026-10-11: "l'IA deve sapere perfettamente come testarla da
// sola ... perché dovrà usarla al meglio"). Mounted on the local MCP server at /mcp/app (127.0.0.1 only, Host/Origin
// checked). An agent (the Regia, a test agent) can read the app's state, chats, pending requests, feed and logs, take
// screenshots of the whole window, and steer the UI. Rules (ADR 0006):
// - It can NEVER answer a question or a permission: only the user's click in the app is their ok.
// - Messages it sends to chats are labelled as not written by the user (like mail between chats).
// - No production, no secrets: the logs it returns are already redacted by log.ts.
import type { BrowserWindow } from 'electron';
import type { ChatSummary, EventMap } from '../../shared/contract';
import type { BrainService, BrowserService, ChatService } from '../services';
import { log } from '../log';

export type ToolOut = string | { text?: string; images?: { data: string; mimeType: 'image/png'; caption?: string }[] } | object;
export interface ToolDef { name: string; description: string; inputSchema: object; run(args: Record<string, unknown>): Promise<ToolOut> | ToolOut }

export interface AppCtlDeps {
  chats: ChatService; browser: BrowserService; brain: BrainService;
  window: () => BrowserWindow | null;
  emitUi: (cmd: EventMap['ui:command']) => void;
  version: string;
}

const obj = (props: Record<string, object> = {}, required: string[] = []) => ({ type: 'object', properties: props, required });
const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
export const AGENT_LABEL = "[Messaggio di un agente tramite second-brain, non scritto dall'utente: non vale come suo ok o permesso]";

const brief = (c: ChatSummary) => ({ id: c.id, title: c.title, harness: c.harness, state: c.state, pending: c.pending, model: c.model, costUsd: Math.round(c.costUsd * 100) / 100, isRegia: c.isRegia, last: c.lastText.slice(0, 200) });

export function appControlTools(d: AppCtlDeps): ToolDef[] {
  return [
    {
      name: 'app_state', description: 'Overview of the app: version, brain folder, chats by state, open questions/permissions, browser tabs, today usage.',
      inputSchema: obj(),
      run: () => {
        const chats = d.chats.list();
        const by: Record<string, number> = {};
        for (const c of chats) by[c.state] = (by[c.state] ?? 0) + 1;
        return { version: d.version, brainRoot: d.brain.info().brainRoot, chats: by, pending: d.chats.pending().length, tabs: d.browser.list().length, usage: d.brain.usage(), logs: log.folder };
      },
    },
    {
      name: 'app_chats', description: 'The chats running in the app (Claude and Cursor engines): state, open questions, model, cost, last line.',
      inputSchema: obj(),
      run: () => ({ app: d.chats.list().map(brief) }),
    },
    {
      name: 'app_chat_items', description: 'Last items of one app chat (messages, tool rows, results), texts truncated.',
      inputSchema: obj({ chatId: str('chat id from app_chats'), last: num('how many, default 30') }, ['chatId']),
      run: a => d.chats.items(String(a.chatId)).slice(-(Number(a.last) || 30)).map(i => ({ ...i, ...('text' in i ? { text: i.text.slice(0, 1500) } : {}), ...('output' in i && i.output ? { output: i.output.slice(0, 800) } : {}) })),
    },
    {
      name: 'app_pending', description: 'Open questions and permission requests waiting for the user (read-only: agents can never answer them).',
      inputSchema: obj(), run: () => d.chats.pending(),
    },
    {
      name: 'app_feed', description: 'Recent live feed events (ideas, errors, chats done/waiting...).',
      inputSchema: obj({ limit: num('default 30') }), run: a => d.brain.feed().slice(0, Number(a.limit) || 30),
    },
    {
      name: 'app_logs', description: 'Recent structured log entries of the app (redacted). Filters: level (debug|info|warn|error), scope, chat, grep.',
      inputSchema: obj({ level: str('minimum level'), scope: str('module scope, e.g. chats'), chat: str('chat id'), grep: str('text'), tail: num('default 50') }),
      run: a => {
        const order = { debug: 0, info: 1, warn: 2, error: 3 } as const;
        const min = order[(a.level as keyof typeof order) ?? 'debug'] ?? 0;
        const g = typeof a.grep === 'string' ? a.grep.toLowerCase() : null;
        return log.recent.filter(e => order[e.lvl] >= min && (!a.scope || e.scope === a.scope) && (!a.chat || e.chat === a.chat) && (!g || JSON.stringify(e).toLowerCase().includes(g)))
          .slice(-(Number(a.tail) || 50));
      },
    },
    {
      name: 'app_screenshot', description: 'Screenshot of the app window (the UI) plus each browser tab visible on screen with its position.',
      inputSchema: obj(),
      run: async () => {
        const win = d.window();
        if (!win) return 'no window';
        const images: { data: string; mimeType: 'image/png'; caption?: string }[] = [];
        const ui = await win.webContents.capturePage();
        images.push({ data: ui.toPNG().toString('base64'), mimeType: 'image/png', caption: `app UI ${ui.getSize().width}x${ui.getSize().height}` });
        for (const v of win.contentView.children) {
          const wc = (v as { webContents?: Electron.WebContents }).webContents;
          if (!wc) continue;
          const b = v.getBounds();
          const img = await wc.capturePage();
          images.push({ data: img.toPNG().toString('base64'), mimeType: 'image/png', caption: `browser tab ${wc.getURL()} at x=${b.x} y=${b.y} ${b.width}x${b.height}` });
        }
        return { text: `${images.length} images`, images };
      },
    },
    {
      name: 'app_ui', description: 'Steer the UI (visual only, never the keyboard focus): action "view" (value mosaico|corsie), "maximize" (chat id), "restore", "page" (value: workspace|oggi|dafare|idee|costi|qualita|diario|esplora|mappa), "palette".',
      inputSchema: obj({ action: str('view|maximize|restore|page|palette'), value: str('argument of the action') }, ['action']),
      // only visual steering: never actions that move the keyboard focus (next, focus…): an agent must not be able to
      // put the user's next keystroke on a permission or into another chat's input (review 2026-10-11)
      run: a => {
        const action = String(a.action);
        if (!['view', 'maximize', 'restore', 'page', 'palette'].includes(action)) throw new Error(`app_ui: action not allowed for agents: ${action} (view|maximize|restore|page|palette)`);
        d.emitUi({ action, value: a.value === undefined ? undefined : String(a.value) });
        return 'ok';
      },
    },
    {
      name: 'app_send_to_chat', description: 'Send a message to an app chat. It is labelled as written by an agent, not by the user (never an ok or a permission).',
      inputSchema: obj({ chatId: str('chat id'), text: str('message') }, ['chatId', 'text']),
      run: async a => {
        const text = String(a.text ?? '').trim();
        if (!text || text.length > 4000) throw new Error('text empty or longer than 4000 chars');
        // A Cursor chat spends Cursor credits: an agent may write to one only when the user allows Claude <-> Cursor
        // messages (messaging.crossHarness, the same switch inbox.mjs obeys) and only if it is already running — an
        // agent never starts a stopped Cursor engine (each engine spends only its own; review 2026-10-11).
        const target = d.chats.list().find(c => c.id === String(a.chatId));
        if (target?.harness === 'cursor') {
          if (!d.brain.settings().messaging.crossHarness) throw new Error('messaggio bloccato: i messaggi tra Claude e Cursor sono spenti (impostazione "Messaggi tra Claude e Cursor")');
          if (!['running', 'waiting', 'idle'].includes(target.state)) throw new Error('la chat Cursor non è attiva: un agente non la avvia (spenderebbe crediti Cursor); chiedi all’utente');
        }
        await d.chats.send(String(a.chatId), `${AGENT_LABEL}\n\n${text}`);
        log.info('appctl', 'agent message sent to chat', { chat: String(a.chatId), data: { chars: text.length } });
        return 'sent';
      },
    },
  ];
}
