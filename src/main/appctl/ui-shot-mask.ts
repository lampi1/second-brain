// app_screenshot never shows a credential card's values (ADR 0367, security review 2026-11-27): a live card in the
// Orchestrator column draws the URL and the user in plain text, and the password after «Mostra», so before the app
// window is captured the renderer hides every value (`:root[data-shot-mask] .oc-cred-val`, styles/orch-chat.css),
// waits for the next painted frame and confirms that each value is hidden; the capture follows, and the values come
// back right after. A renderer that does not confirm refuses the capture: a picture that might show a credential is
// never taken (as browser/shot-mask.ts does for passwords in agent tabs). Used by appctl/tools.ts (app_screenshot).

/** The attribute on the app's <html> that hides the card's values while it is set. */
export const SHOT_MASK_ATTR = 'data-shot-mask';
/** The class of every element that draws a credential value (CredentialCard.tsx). */
export const CRED_VALUE_CLASS = 'oc-cred-val';

/** The renderer script: on = hide the values, wait for a painted frame (or 250 ms, for a window that is not painting)
 *  and answer true only when every value is hidden; off = show them again. */
export function credMaskScript(on: boolean): string {
  if (!on) return `(() => { document.documentElement.removeAttribute('${SHOT_MASK_ATTR}'); return true; })()`;
  return `(async () => {
    document.documentElement.setAttribute('${SHOT_MASK_ATTR}', '1');
    await new Promise(done => { let over = false; const end = () => { if (!over) { over = true; done(); } };
      requestAnimationFrame(() => requestAnimationFrame(end)); setTimeout(end, 250); });
    return Array.from(document.querySelectorAll('.${CRED_VALUE_CLASS}')).every(e => getComputedStyle(e).visibility === 'hidden');
  })()`;
}

/** Runs capture() with the card's values hidden in the app window; refused (nothing captured) when the renderer does
 *  not confirm. `run` evaluates a script in the app's renderer, with its own deadline. */
export async function withCredentialsHidden<T>(run: (script: string) => Promise<unknown>, capture: () => Promise<T>): Promise<T> {
  try {
    let ok: unknown;
    try { ok = await run(credMaskScript(true)); } catch { ok = false; }
    if (ok !== true) throw new Error('Refused: the app could not hide the credential card\'s values for the screenshot. Try again in a moment, or use app_state / app_chat_items instead.');
    return await capture();
  } finally {
    await run(credMaskScript(false)).catch(() => { /* the window is gone */ });
  }
}
