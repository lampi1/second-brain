// "Rispondi dopo" and the "Da rispondere" queue on the app page (ADR 0035; the user, 2026-10-13). One flag, kept by
// main (main/later.ts) so it survives a restart and holds back the Windows notifications: on = no request popup
// anywhere (questions window, Regia card, global layer card), the tiles show "Da rispondere" ("In coda" is only the CPU queue, ADR 0036), new requests join the queue
// without a popup (the top bar's "Da rispondere" counter grows, a chime rings: lib/layer.ts); off again when the user opens the queue (Ctrl+J, the counter,
// "Rispondi" on a tile), which is the questions window called with every open request, one at a time. The asking
// chats are never answered: they stay blocked. Started by main.tsx; used by actions.ts, layer.ts and the request hosts.
import { sb } from '../sb';
import { callQuestions, parkQuestions, setLater, setLayerHeld, ui } from '../store/ui';

// this page's own sets still on their way: main's echo of an older one ("off" from Ctrl+J arriving after a quick
// "Rispondi dopo") would undo the newer local value, so echoes wait until the last set has settled
let inflight = 0;
const send = (on: boolean): void => {
  setLater(on);
  inflight++;
  void sb.invoke('later:set', { on }).then(s => { if (--inflight === 0) setLater(s.on); }, () => { inflight--; });
};

/** Follow main's flag: the value at start and every change (another window, a restart). */
export function startLater(): void {
  void sb.invoke('later:get', undefined).then(s => { if (!inflight) setLater(s.on); }).catch(() => {});
  sb.on('later:changed', s => { if (!inflight) setLater(s.on); });
}

/** "Rispondi dopo" (the button on any card, Esc on a popup): every open request waits in "Da rispondere". */
export function answerLater(): void {
  parkQuestions();
  setLayerHeld(null);
  if (ui.get().later) return;
  send(true);
}

/** Open "Da rispondere": quiet mode ends, the questions window shows the queue, `key` first (else the oldest). */
export function openQueue(key: string | null): void {
  if (ui.get().later) send(false);
  // the keyboard may be in the global layer: the queue is on the app page
  void sb.invoke('overlay:focus', { target: 'app' }).catch(() => {});
  callQuestions(key);
}
