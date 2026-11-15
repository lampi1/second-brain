// Which OS the app runs on, as the page sees it: the sandboxed renderer has no `process`, Chromium's
// navigator.platform says it ("Win32", "MacIntel", "Linux x86_64"). Only for words on screen that differ per OS (the
// shell "Esegui" runs a block in: PowerShell 5.1 on Windows, the user's login shell elsewhere, main/platform.ts
// userShell); never for behaviour, which main decides. Used by CodeBlock.tsx and CommandRequest.tsx.

/** True on Windows. `platform` is a parameter for the tests. */
export const hostIsWindows = (platform: string = typeof navigator === 'undefined' ? '' : navigator.platform): boolean => /^win/i.test(platform);
