// The way out of a strip the app closed by itself (auto-close, ADR 0084; owner, 2026-10-22: «la pulizia delle chat
// automatica non la vedo fluida»): a strip or a thread card used to vanish in one frame and everything under it jumped
// up. Here a still copy of the row stays where it was, fades and folds its height to nothing, so the rows under it slide
// up. The copy is inert and anonymous: no test id, no chat or tab hook, no countdown that could count as a seen warning
// (components/AutoCloser.tsx), no workspace pane for the native browser views (lib/viewports.ts). Off under reduced
// motion and for a chat the user closed (the ✕ and Ctrl+W close at once, close-fast.spec.ts). A folded strip's work area
// (its whole transcript and input, invisible: max-height 0) is copied empty, so the copy costs a header, not a day of
// chat. Used by AgentStrips.tsx.
export const LEAVE_MS = 320;

/** a collapsed strip's work area: zero height and hidden, so its copy needs none of its content */
const FOLDED = '.chat-work:not(.expanded)';

/** A deep copy of what shows: everything but the content of folded work areas (the same box, the same look). */
export function visibleClone(el: Element): Element {
  if (!el.matches(FOLDED) && !el.querySelector(FOLDED)) return el.cloneNode(true) as Element;
  const copy = el.cloneNode(false) as Element;
  if (!el.matches(FOLDED)) for (const child of el.childNodes) copy.appendChild(child instanceof Element ? visibleClone(child) : child.cloneNode(true));
  return copy;
}

const HOOKS = ['id', 'data-testid', 'data-chat-id', 'data-tab-id', 'data-autoclose-id', 'data-workspace-pane', 'data-transcript-visible', 'data-chat-index', 'data-sb-id'];

/** Leave a fading, folding copy of `el` in its place; `el` itself is about to be removed by React. */
export function leaveGhost(el: HTMLElement): void {
  const parent = el.parentElement;
  if (!parent || !el.isConnected || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const height = el.getBoundingClientRect().height;
  if (!(height > 0)) return;
  const ghost = visibleClone(el) as HTMLElement;
  for (const node of [ghost, ...ghost.querySelectorAll<HTMLElement>('*')]) for (const name of HOOKS) node.removeAttribute(name);
  ghost.classList.add('leave-ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.style.height = `${height}px`;
  parent.insertBefore(ghost, el.nextSibling);
  // read its box once so the fold below starts from the full height (agent-strips.css .leave-ghost.is-leaving)
  void ghost.offsetHeight;
  ghost.classList.add('is-leaving');
  setTimeout(() => ghost.remove(), LEAVE_MS + 80);
}
