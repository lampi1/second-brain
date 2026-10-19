// "Migliora l'app" in the renderer (ADR 0020): main's ImproveService pushes its state on 'improve:state' (after each
// read of git, every step of a promotion, the restart notice); this store starts itself on first use (the section or
// the restart banner), loads 'improve:get' and keeps the last value. Actions: refresh, "Aggiorna" (after the user's
// confirm), dismiss the restart notice (the Orchestrator handles app improvements: orchestrator:ensure, store.ts); plus which app chat the section shows open.
// Settings → Aggiornamenti: the GitHub check and the one-click update (checkSource, askUpdateNow; ADR 0075).
// Used by components/ImprovePage.tsx, components/LaunchBanner.tsx, components/AppUpdateSettings.tsx and actions.ts.
import type { ImproveState } from '@shared/contract';
import { createStore } from './createStore';
import { askConfirm, toast } from './ui';
import { t } from '../i18n';

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

export function dismissLaunch(): void {
  improve.set(s => (s ? { ...s, launch: null } : s));
  void window.sb.invoke('improve:dismissLaunch', undefined).then(s => improve.set(s), () => {});
}

/** Settings → Aggiornamenti (ADR 0075): what GitHub has that this copy does not (git fetch only). */
export function checkSource(): void {
  void window.sb.invoke('improve:sourceCheck', undefined).then(s => improve.set(s), () => {});
}

/** "Aggiorna" in Settings: one confirm, then pull, build and restart on the new version, no tests (ADR 0075). */
export function askUpdateNow(stable: boolean): void {
  askConfirm({
    title: t('update.confirmTitle'),
    body: t('update.confirmBody'),
    items: [t('update.confirmChats'), t('update.confirmLocal'), stable ? t('update.confirmFallback') : t('update.confirmDevFail')],
    confirmLabel: t('update.confirmOk'),
    onConfirm: () => {
      const cur = improve.get();
      if (cur) improve.set({ ...cur, source: { ...cur.source, state: 'updating', canUpdate: false } });
      void window.sb.invoke('improve:updateNow', undefined).then(st => improve.set(st), e => { toast(`${t('update.failed')}: ${errText(e)}`, 'err'); checkSource(); });
    },
  });
}
