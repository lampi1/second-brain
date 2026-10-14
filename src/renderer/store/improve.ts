// "Migliora l'app" in the renderer (ADR 0020): main's ImproveService pushes its state on 'improve:state' (after each
// read of git, every step of a promotion, the restart notice); this store starts itself on first use (the section or
// the restart banner), loads 'improve:get' and keeps the last value. Actions: refresh, "Aggiorna" (after the user's
// confirm), create the section's Regia, dismiss the restart notice; plus which app chat the section shows open.
// Used by components/ImprovePage.tsx, components/LaunchBanner.tsx and actions.ts.
import type { ChatSummary, Harness, ImproveState } from '@shared/contract';
import { createStore } from './createStore';
import { askConfirm, toast } from './ui';
import { engineLabel } from '../lib/engines';

export const improve = createStore<ImproveState | null>(null);
/** the app chat open next to the section's Regia (null = none) */
export const improveUi = createStore<{ selected: string | null }>({ selected: null });
export const showAppChat = (selected: string | null) => improveUi.set(s => (s.selected === selected ? s : { selected }));

let listening = false;
let loading = false;
function start(): void {
  if (improve.get() || loading) return;
  try {
    if (!listening) { window.sb.on('improve:state', s => improve.set(s)); listening = true; }
    loading = true;
    void window.sb.invoke('improve:get', {}).then(s => { improve.set(x => x ?? s); }, () => {}).finally(() => { loading = false; });
  } catch { /* no bridge (brain test route) */ }
}

export function useImprove<T>(sel: (s: ImproveState | null) => T): T {
  start();
  return improve.use(sel);
}

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

/** Read git and the releases again (the section does it on open and every few seconds while it is open). */
export function refreshImprove(): void {
  void window.sb.invoke('improve:get', { refresh: true }).then(s => improve.set(s), () => {});
}

/** "Aggiorna": the user confirms first (what it does, that the app restarts and chats resume). */
export function askPromote(s: ImproveState): void {
  const what = s.candidate ? `${s.candidate.sha} · ${s.candidate.subject}` : 'l’ultima versione di main';
  askConfirm({
    title: 'Aggiornare alla versione nuova?',
    body: `Prende ${what}, la testa, la copia e riavvia l'app su di lei.`,
    items: [
      s.candidate?.checkAt ? 'È già testata: i test girano di nuovo, per sicurezza.' : 'I test girano adesso: se uno fallisce non cambia niente.',
      'Poi l’app si riavvia subito: le chat al lavoro riprendono da sole.',
      'Se la versione nuova non si apre, torna da sola alla precedente e te lo dice.',
    ],
    confirmLabel: 'Aggiorna e riavvia',
    onConfirm: () => {
      // off at once: the main process reads git before it answers, a second click must not start a second promotion
      const cur = improve.get();
      if (cur) improve.set({ ...cur, canPromote: false, promoteWhy: 'Aggiornamento in partenza…' });
      void window.sb.invoke('improve:promote', undefined).then(st => improve.set(st), e => toast(`Aggiornamento non partito: ${errText(e)}`, 'err'));
    },
  });
}

/** A new app Regia for "Pulisci" in the Regia overlay's "App" tab: main moves the role from the old one; null = failed (told). */
export async function newAppRegia(harness: Harness): Promise<ChatSummary | null> {
  try { return await window.sb.invoke('improve:regia', { harness }); } catch (e) { toast(`Regia dell'app non creata: ${errText(e)}`, 'err'); return null; }
}

export async function createAppRegia(harness: Harness): Promise<void> {
  try {
    const c = await window.sb.invoke('improve:regia', { harness });
    toast(`Regia dell'app creata (${engineLabel(c.harness)})`, 'ok');
  } catch (e) { toast(`Regia dell'app non creata: ${errText(e)}`, 'err'); }
}

export function dismissLaunch(): void {
  improve.set(s => (s ? { ...s, launch: null } : s));
  void window.sb.invoke('improve:dismissLaunch', undefined).then(s => improve.set(s), () => {});
}
