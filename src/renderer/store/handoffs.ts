// Open hand-offs (an agent waits for the user in one of its tabs: login, MFA, CAPTCHA), kept live from main's
// 'browser:handoff' events after one initial 'browser:handoffs' load, and the user's answers (Fatto / Non riesco /
// Copia). Starts itself on first use, so it needs no wiring in store.ts. Used by HandoffBanner.tsx and by the agents'
// strips (AgentStrips: a tab waiting for the user stays visible under a collapsed strip).
import type { BrowserHandoff } from '@shared/contract';
import { sb } from '../sb';
import { createStore } from './createStore';
import { toast } from './ui';
import { t } from '../i18n';
import { errText } from '../lib/ipc-error';

const store = createStore<Record<string, BrowserHandoff>>({});   // open hand-offs by tab id
let started = false;

function put(h: BrowserHandoff): void {
  store.set(s => {
    const cur = s[h.tabId];
    if (h.state === 'open') return cur?.id === h.id && cur === h ? s : { ...s, [h.tabId]: h };
    if (cur?.id !== h.id) return s;
    const { [h.tabId]: _gone, ...rest } = s;
    return rest;
  });
}

function start(): void {
  if (started) return;
  started = true;
  sb.on('browser:handoff', put);
  void sb.invoke('browser:handoffs', undefined).then(list => { for (const h of list) put(h); }).catch(() => {});
}

/** The open hand-off on a tab, if any. */
export function useHandoff(tabId: string): BrowserHandoff | undefined {
  start();
  return store.use(s => s[tabId]);
}

/** Tabs with an open hand-off (sorted): they stay on screen even when their strip's browsers are folded, the user must act there. */
export function useHandoffTabs(): string[] {
  start();
  return store.use(s => Object.keys(s).sort(), (a, b) => a.length === b.length && a.every((x, i) => x === b[i]));
}

export async function resolveHandoff(h: BrowserHandoff, outcome: 'done' | 'failed'): Promise<void> {
  put({ ...h, state: outcome });                                  // optimistic: the banner closes at once
  try { await sb.invoke('browser:handoffResolve', { id: h.id, outcome }); } catch (e) {
    put(h);
    toast(t('appText.handoffs.answerNotSent', { error: errText(e) }), 'err');
  }
}

/** main copies the value (the password is read from the credentials file there and never reaches this page). */
export async function copyFromHandoff(id: string, field: 'user' | 'password'): Promise<boolean> {
  try { return await sb.invoke('browser:handoffCopy', { id, field }); } catch (e) {
    toast(t('appText.handoffs.copyFailed', { error: errText(e) }), 'err');
    return false;
  }
}
