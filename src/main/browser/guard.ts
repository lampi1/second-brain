// Host checks of the browser tools. Agents may type passwords on every host (the owner, 2026-11-09: «voglio togliere
// quel controllo del browser dell'app»; ADR 0235 replaces the 2026-10-11 limit): a password field's value comes back
// only masked (page.ts) and typing tools are masked in the chat feed (chats/typed-text.ts). What stays here: local
// stacks (environment "local", javascript, remote frames holding a password field) and credentials in URLs
// (user:pass@, refused on remote hosts: they would sit in the history, tab lists and logs). Pure, unit-tested; used by
// browser/actions.ts and browser/rules.ts.

/** Local stacks: localhost, 127.0.0.1, [::1], *.localhost, *.test. */
export function isLocalHost(hostOrUrl: string): boolean {
  let host = String(hostOrUrl ?? '').trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) { try { host = new URL(host).hostname; } catch { return false; } }
  host = host.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost') || host.endsWith('.test');
}

/** The host of a frame URL ('' for about:blank and friends). */
export function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

/** javascript on a remote host: code that changes an input's type (password → text) is refused. */
export function changesInputType(code: string): boolean {
  return /\.type\s*=(?!=)|\[\s*['"`]type['"`]\s*\]\s*=(?!=)|(?:set|remove|toggle)Attribute(?:NS)?\s*\(\s*(?:[^,)]*,\s*)?['"`]type['"`]|Object\.defineProperty\s*\([^)]*['"`]type['"`]/i.test(code);
}

/** user:pass@ in a URL ('' when none): refused on remote hosts (it would sit in history and logs), never shown. */
export function urlCredentials(url: string): string {
  try { const u = new URL(url); return u.username || u.password ? `${u.username}${u.password ? ':•••' : ''}` : ''; } catch { return ''; }
}
