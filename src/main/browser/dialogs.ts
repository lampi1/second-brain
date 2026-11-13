// JavaScript dialogs (alert / confirm / prompt) of agent tabs: the native answer callback Electron hands to the
// '-run-dialog' hook (tabs.ts suppressNativeDialogs) and the dialog state the agent sees (Tab.dialog / lastDialog).
// Why a module of its own (issue #102): a dialog must never be left blocking the page nor be answered twice. When the
// CDP session detaches, the page navigates or the tab is torn down while a dialog is pending, the native callback is
// answered once (Cancel) and the dialog cleared; when Chromium refuses Page.handleJavaScriptDialog ("Not attached to an
// active page": the session's frame is no longer the active one), handle_dialog answers through the same callback.
// Pure (no Electron import) so it is unit tested. Used by browser/tabs.ts and browser/actions.ts.

export type DialogCallback = (ok: boolean, text: string) => void;

/** The dialog fields of a tab (tabs.ts Tab) this module reads and writes. */
export interface DialogState {
  dialog: { type: string; message: string; defaultPrompt: string; url: string; at: number } | null;
  lastDialog: ({ type: string; message: string; defaultPrompt: string; url: string; at: number } & { result: string }) | null;
  pendingDialogCb: DialogCallback | null;
}

/** Wraps a native dialog callback so it runs at most once; a throw (webContents gone) is swallowed and reported. */
export function onceDialogCallback(cb: DialogCallback, onError: (e: unknown) => void = () => {}): DialogCallback {
  let used = false;
  return (ok, text) => {
    if (used) return;
    used = true;
    try { cb(ok, text); } catch (e) { onError(e); }
  };
}

/** Answers the pending native callback (when `alive`) and clears the open dialog, recording `result` as its outcome.
 *  The callback is dropped in every case, so it is never answered twice nor kept after this. Returns whether the
 *  callback was called and whether a dialog was cleared. */
export function settleDialog(tab: DialogState, result: string, opts: { accept?: boolean; text?: string; alive?: boolean } = {}): { answered: boolean; cleared: boolean } {
  const cb = tab.pendingDialogCb;
  tab.pendingDialogCb = null;
  let answered = false;
  if (cb && opts.alive !== false) { cb(opts.accept ?? false, opts.text ?? ''); answered = true; }
  const d = tab.dialog;
  if (d) { tab.lastDialog = { ...d, result }; tab.dialog = null; }
  return { answered, cleared: !!d };
}
