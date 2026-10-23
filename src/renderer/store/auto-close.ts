// Typed callback adapter for the main-owned deadline service. No backend connection means no automatic closure.
// Integration registers the shared contract channels, then connects this adapter once at renderer startup.
import { AUTO_CLOSE_WAITING, type AutoClosePresence, type AutoCloseStatus } from '@shared/auto-close';
import { createStore } from './createStore';
import { t } from '../i18n';
export interface AutoCloseBridge {
  get: () => Promise<AutoCloseStatus[]>;
  presence: (holds: AutoClosePresence[]) => Promise<void>;
  keep: (chatId: string, keep: boolean) => Promise<void>;
  listen: (accept: (states: AutoCloseStatus[]) => void) => () => void;
}
export const autoCloseState = createStore<AutoCloseStatus[]>([]);
export const autoCloseProblem = createStore<string|null>(null);
let healthy=false;
let lastHolds:AutoClosePresence[]=[];
let bridge: AutoCloseBridge | null = null;
let detach: (() => void) | null = null;
const received = new WeakMap<AutoCloseStatus, number>();
function unavailable():void{
  healthy=false;autoCloseProblem.set(t('appText.autoClose.unavailable'));
  reportAutoClosePresence(lastHolds);
}
function accept(states: AutoCloseStatus[]): void {
  if(!Array.isArray(states)||states.some(row=>!row||typeof row.chatId!=='string'||typeof row.keptOpen!=='boolean'||!Number.isFinite(row.clockAt)||!Number.isFinite(row.generation)||row.deadline!==null&&!Number.isFinite(row.deadline)||row.warningStartedAt!==null&&!Number.isFinite(row.warningStartedAt)||row.waitingFor!==undefined&&!AUTO_CLOSE_WAITING.includes(row.waitingFor))){unavailable();return;}
  healthy=true;autoCloseProblem.set(null);
  const at = performance.now(); for (const state of states) received.set(state, at); autoCloseState.set(states);
}
export function autoCloseRemaining(row: AutoCloseStatus): number {
  return row.deadline === null ? Infinity : row.deadline - row.clockAt - (performance.now() - (received.get(row) ?? performance.now()));
}
export function connectAutoClose(next: AutoCloseBridge): () => void {
  detach?.(); bridge = next;healthy=false;
  let eventReceived = false;
  const stop = next.listen(states => { if (bridge === next) { eventReceived = true; accept(states); } }); detach = stop;
  void next.get().then(states => { if (bridge === next && !eventReceived) accept(states); }).catch(() => {if(bridge===next&&!eventReceived)unavailable();});
  return () => { stop(); if (bridge === next) { bridge = null; detach = null; autoCloseState.set([]); } };
}
export function reportAutoClosePresence(holds: AutoClosePresence[]): void {
  lastHolds=holds;
  const presence=healthy?holds:holds.map(hold=>({...hold,shown:true}));
  void bridge?.presence(presence).catch(() => {});
}
export async function keepAgentOpen(chatId: string, keep: boolean): Promise<boolean> {
  if (!bridge) return false;
  try { await bridge.keep(chatId, keep); return true; } catch { return false; }
}
