// HARD LIMIT (the user, 2026-10-11): an agent never types a password on a remote host. type / fill_form / key into a
// password field (input[type=password], autocomplete current-password / new-password) is refused unless the frame's
// host is a local stack (localhost, 127.0.0.1, [::1], *.localhost, *.test), where agents may sign in with the
// project's test accounts. On remote hosts the user signs in themselves (handoff_to_user kind "login") and the environment's
// persistent session keeps them signed in. Reading counts too: no javascript runs while the user works in a tab or in a
// tab where a remote frame holds a password field; typing is re-checked after every focus-moving key; credentials in
// URLs (user:pass@) are refused on remote hosts. Pure, unit-tested; used by browser/actions.ts.

/** Hosts where agents may type passwords (local stacks with test accounts). */
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

export function passwordRefusal(what: string, host: string, env: string): Error {
  return new Error(
    `Refused: ${what} is a password field on ${host || 'a remote page'}. Agents never type passwords on remote hosts (only on local stacks: ` +
    `localhost, 127.0.0.1, *.localhost, *.test). Call handoff_to_user with kind "login": the user signs in themselves and environment ` +
    `"${env}" keeps the session for your next runs.`,
  );
}

/** javascript on a remote host: code that changes an input's type (password → text) is refused. */
export function changesInputType(code: string): boolean {
  return /\.type\s*=(?!=)|\[\s*['"`]type['"`]\s*\]\s*=(?!=)|(?:set|remove|toggle)Attribute(?:NS)?\s*\(\s*(?:[^,)]*,\s*)?['"`]type['"`]|Object\.defineProperty\s*\([^)]*['"`]type['"`]/i.test(code);
}

/** user:pass@ in a URL ('' when none): never sent to a remote host by an agent, never shown. */
export function urlCredentials(url: string): string {
  try { const u = new URL(url); return u.username || u.password ? `${u.username}${u.password ? ':•••' : ''}` : ''; } catch { return ''; }
}
