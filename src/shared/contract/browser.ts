// Browsers: the agents' internal browser tabs, environments and sign-in hand-offs (the user's personal browser left with ADR 0212).
// One area of the IPC contract: src/shared/contract.ts re-exports it and assembles the channel maps (change a shape
// here first, then both sides).

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  ownerChatId: string | null; // the chat that drives it (null = the user's own tab)
  lastAction?: string;        // "click ref_12", for the tile header
  /** A recent snapshot as a data: URL (JPEG), for thumbnails and the frozen frame shown while the view is hidden under an overlay. */
  thumb?: string;
  /** Tab group: 'user' (the user's own), 'chat:<chatId>' (an app chat), 'mcp:<session>' (an external MCP client). */
  group?: string;
  active?: boolean;           // the group's current tab (the one its agent acts on when no tabId is given)
  dialog?: string;            // a JavaScript dialog waiting for the agent ("confirm: Sei sicuro?")
  handoffId?: string;         // an open hand-off to the user on this tab (BrowserHandoff.id)
  /** The tab's environment: its own persistent session (cookies, storage), shared only by tabs of the same env. */
  env?: string;
  envColor?: string;          // stable color of the env (the same in every tile, every run)
  session?: BrowserSessionStatus; // sign-in state of the env
}

/** An agent asks the user to act in a tab (login, MFA, CAPTCHA): a banner until they click Fatto (done) or Non riesco (failed). */
/** Sign-in state of an environment: valid · expiring (auth cookie expires within 24 h) · expired (a login page, or the
 *  auth cookie that was there is gone) · unknown (nothing seen yet). */
export type BrowserSessionStatus = 'valid' | 'expiring' | 'expired' | 'unknown';

/** A browser environment = one persistent session partition (persist:env-<id>). Never carries cookies or secrets. */
export interface BrowserEnv {
  id: string;                 // "example-test-3", "local"
  color: string;
  hosts: string[];            // hosts seen in it (host:port), newest first
  tabIds: string[];           // open tabs in it
  createdAt: number;
  lastUsedAt: number;
  lastLoginAt: number | null; // last sign-in seen (login page left, auth cookie set, or a login hand-off done)
  lastUrl?: string;           // origin + path of its last page (no query: no tokens), to reopen it with one click
  session: BrowserSessionStatus;
  sessionDetail: string;      // Italian, one line ("l'accesso scade il 12/10, 18:30")
  authExpiresAt: number | null;
  /** cookies encrypted at rest (Electron fuse EnableCookieEncryption, DPAPI-protected key); null = unknown */
  encryptedAtRest: boolean | null;
}

export interface BrowserHandoff {
  id: string;
  tabId: string;
  chatId: string | null;      // the app chat that asked (null = an external MCP client)
  reason: string;             // one line: "Login richiesto"
  instructions: string;       // what the user should do
  url: string;
  state: 'open' | 'done' | 'failed' | 'cancelled';
  note?: string;              // the user's note when resolving
  at: number;
  resolvedAt?: number;
  env?: string;               // the environment of the tab
  kind?: 'login' | 'other';   // login = "rifai l'accesso a <env>": the user signs in, the env keeps the session
  account?: HandoffAccount;   // kind login: the account the agent named, looked up in the user's credentials file
}

/** The account a login hand-off shows. Never the password: main copies it from the file on the user's click
 *  ('browser:handoffCopy'), so it never reaches the agent, a tool argument, the renderer or a log. */
export interface HandoffAccount {
  user: string;               // as found in the file (or as the agent wrote it, when not found)
  found: boolean;             // an entry with this user name and a password exists in the credentials file
  url?: string;               // the entry's sign-in URL, if it has one
  note?: string;              // the entry's note ("holding with module X enabled"), one line
}

/** One entry of the "Credenziali" panel (the user's credentials file). Never the password: main copies it from the
 *  file on the user's click ('credentials:copy'), as for login hand-offs (ADR 0012). */
export interface CredentialEntry {
  id: string;                 // stable while the file does not change (a Copia after a change finds nothing)
  group: string;              // the keys that lead to it in the file: "ExampleApp · test"
  user: string;
  url?: string;               // sign-in URL, if the entry has one
  note?: string;              // one line: "holding with module X enabled"
}

export interface Rect { x: number; y: number; width: number; height: number }
/** Where each visible browser tab is drawn (tiles report their rects; hidden = not on screen or under an overlay).
 *  `views:layout` carries the COMPLETE set of visible tabs: a tab missing from the list (or with rect null) is hidden. */
export interface ViewLayout { tabId: string; rect: Rect | null }

/** renderer → main, browser: each entry [argument, result]. Part of InvokeMap (src/shared/contract.ts). */
export interface BrowserInvokeMap {
  'browser:list': [void, BrowserTab[]];
  'browser:open': [{ url?: string; ownerChatId?: string | null; env?: string }, BrowserTab];
  'browser:navigate': [{ tabId: string; url: string }, void];
  'browser:go': [{ tabId: string; dir: 'back' | 'forward' | 'reload' }, void];
  'browser:close': [{ tabId: string }, void];
  'views:layout': [ViewLayout[], void];
  'browser:handoffs': [void, BrowserHandoff[]];
  'browser:handoffResolve': [{ id: string; outcome: 'done' | 'failed'; note?: string }, void];
  /** main copies the hand-off's user name or password (read from the credentials file now) to the clipboard; a copied
   *  password is cleared from the clipboard after 30 s if still there. Returns false when it could not (no entry). */
  'browser:handoffCopy': [{ id: string; field: 'user' | 'password' }, boolean];
  'browser:envList': [void, BrowserEnv[]];
  /** the "Credenziali" panel: the entries of the user's credentials file, without passwords */
  'credentials:list': [void, CredentialEntry[]];
  /** main copies an entry's user name or password (read from the file now); a password is cleared from the clipboard
   *  after 30 s if still there. Returns false when it could not (no such entry, e.g. the file changed). */
  'credentials:copy': [{ id: string; field: 'user' | 'password' }, boolean];
}
