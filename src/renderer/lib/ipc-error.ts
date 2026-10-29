// The words of a failed IPC call for the user: Electron wraps a main-process error as "Error invoking remote method
// '<channel>': Error: <message>"; only <message> is shown. Used by the stores, actions and pages that toast or show an
// invoke's failure.
export const errText = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
