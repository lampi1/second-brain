// Shared modal keyboard boundary: inner controls keep native editing, while workspace commands never escape a dialog.
import { resolveShortcut, type KeyLike } from './keys';
export function isolateModalKey(event: KeyLike & { stopPropagation(): void; preventDefault(): void }): void {
  event.stopPropagation();
  if (resolveShortcut(event)) event.preventDefault();
}
/** Disclosure summaries are native tab stops, including the final evidence disclosure in a fullscreen flow. */
export function modalTabStops(root: Pick<HTMLElement, 'querySelectorAll'>): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')]
    .filter(element => !element.hasAttribute('disabled') && element.getAttribute('tabindex') !== '-1' && element.offsetParent !== null);
}
