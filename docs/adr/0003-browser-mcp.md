# ADR 0003 · Internal browsers exposed to agents as a hand-written local MCP server

Date: 2026-10-11 · Status: accepted

## Context
Claude in Chrome is blocked by corporate policy; agents need a browser for QA (Angular SPA with iframes and logins).
Research (docs/research/research-browser-memory.md): accessibility-style trees with short refs beat raw HTML
(EconWebArena: 46.9% → 36.7% with HTML); dialogs, iframes, network capture and human hand-off are the gaps.

## Decision
- Tabs are Electron `WebContentsView`s in one persistent partition; input via `sendInputEvent` (trusted), reading via
  an injected DOM walker with `ref_N`, screenshots via `capturePage` (image pixels = CSS pixels = click coordinates).
- MCP over Streamable HTTP (JSON responses), written by hand (~100 lines) instead of `@modelcontextprotocol/sdk`
  (~20 transitive packages). Bound to 127.0.0.1; Host and Origin validated (DNS rebinding).
- One endpoint per app chat (`/mcp/chat/<id>/<random token>`, the token only lives in the chat's in-memory
  `--mcp-config`): a chat sees and drives only its own tabs. A generic `/mcp` endpoint for external clients (Claude
  desktop, Cursor IDE) gets its own tab group per MCP session.
- Tool names and shapes follow the Claude desktop browser pane, so agents and QA skills transfer as they are;
  fewer than 30 tools (Cursor warns above 40).

## Consequences
- No bearer token on the generic endpoint (any local process could read a token from the client's config anyway);
  the per-chat endpoints are unguessable. Revisit if the app is shared on multi-user machines.

## Implementation notes (feat/browser, 2026-10-11)
- **Input goes through CDP `Input.*`** (`webContents.debugger`), not `sendInputEvent`: also trusted, and it is the only
  one that hit-tests into cross-origin iframes of a tab that is not on screen (verified in Electron 44.4.5).
- **Hidden tabs are parked** in a shown, offscreen, transparent, non-focusable window, so they keep a compositor
  (screenshots, rAF, OOPIF hit-testing; a detached view cannot be captured). Windows' native occlusion tracking would
  still mark that window hidden, so `CalculateNativeWinOcclusion` is disabled for the app (cost: the main window keeps
  rendering while covered by other windows). When the main window is minimized every tab is parked.
- **Frames**: each frame (same- or cross-origin) is walked with `WebFrameMain.executeJavaScript`, which runs in the
  frame's own renderer process; refs `e12` / `f3e12`; points are translated through each parent iframe. Cross-origin
  iframe network uses CDP child sessions (`Target.setAutoAttach`, flatten). Closed shadow roots are not traversed.
- **Dialogs**: detected and answered over CDP (`Page.javascriptDialogOpening` / `handleJavaScriptDialog`). On agent
  tabs Electron's internal `-run-dialog` listener (its native message box) is replaced; if Electron renames it, native
  boxes come back and `handle_dialog` still works. `window.prompt()` is unsupported by Electron (it throws in pages).
- **MCP hardening**: any `Origin` header is refused unless allow-listed (MCP clients send none; this also blocks our own
  tabs and localhost pages), POST bodies must be `application/json` (no CORS-simple requests), Host must carry our port.
- Playwright `_electron` attaches its own CDP session to every page and auto-dismisses dialogs unless a `dialog`
  listener exists: the e2e test registers a no-op one.
- **Iframe placement uses the browser's frame tree** (`WebFrameMain.parent.frames` order), never an index reported by
  the frame itself (a hostile frame could redirect a click into a sibling). URL globs are matched without regex
  (no ReDoS from page-controlled URLs). Request/response bodies shown to agents or saved as evidence have password,
  token and secret fields masked (form and JSON, any position).

## Environments, sign-in and the password limit (2026-10-11)
- **Environment = its own persistent partition** `persist:env-<id>` (cookies, storage, cache apart). Default derived
  generically from the host (`test-3.example.com` → `example-test-3`, `www.example.com` → `example`,
  localhost/127.0.0.1/*.localhost → `local`, IPv4 → `ip-a-b-c-d`); any other naming comes from the caller or the user's
  configuration, never from code. A caller can
  name one (`env` on `tabs_create` / `navigate` / `browser:open`), so sharing a session, or two users on one host, is
  explicit and visible (`BrowserTab.env` + a stable color). Popups stay in the opener's environment (Chromium needs it
  for `window.opener`). A tab that has not loaded a real page moves to the right environment on its first navigation.
  The known environments (ids, hosts, last use, last sign-in; never cookies) are in `<userData>/browser-envs.json`.
- **Session status** per environment: valid / expiring (an auth-like cookie expires within 24 h) / expired (its last
  page is a sign-in page, or the auth cookie that was there is gone) / unknown. Heuristics: cookie names (ASP.NET,
  Entra, OIDC, JWT, session ids), login URLs and visible password fields; "last sign-in" = a sign-in page left, a new
  auth cookie, or a login hand-off done. Apps that keep tokens only in localStorage get valid/expired from pages only.
- **HARD LIMIT: an agent never types a password on a remote host.** `type`, `fill_form`, `key` (characters, paste)
  into `input[type=password]` or `autocomplete=current-password|new-password` are refused unless the frame's host is
  localhost, 127.0.0.1, [::1], *.localhost or *.test (local stacks: test accounts allowed). It fails closed when a
  remote frame cannot be checked. A field counts as a password field if it is one now (type, autocomplete, id/name/
  label hints) or was ever seen as one in that document (a "show password" toggle does not make it typeable); fill_form
  re-checks after focusing; `type` and `key` re-check after every focus-moving key (Tab, Enter, arrows), so
  "user\tsecret" cannot slip a password into the next field. Reading counts too: `javascript` is refused while the user
  works in the tab (an open hand-off) and in any tab where a remote frame holds a password field (hidden fields and
  open shadow roots included), and on remote hosts any script that changes an input's type. URLs with credentials
  (user:pass@) are refused on remote hosts and redacted in logs and results. The checks run in the page's main world:
  a page written to defeat them could; the target sites are the user's own environments. The agent calls
  `handoff_to_user kind:"login"`: the user gets a banner + an urgent feed item "Rifai l'accesso a <env>", signs in once,
  and the partition keeps the session for later runs. No password is ever stored by the app. The `environments` tool
  shows an agent only its own tab ids, and no hosts of environments used only by the user's own tabs.
- **Cookies at rest (verified 2026-10-11 on Electron 44.4.5):** Electron ships with its `EnableCookieEncryption` fuse
  **off**, and then cookie values are stored in **plaintext** in `Partitions/env-<id>/Network/Cookies`. With the fuse on
  (verified on a copy) values are AES-GCM encrypted (`v10`) with a key in `Local State` (`os_crypt.encrypted_key`)
  protected by **Windows DPAPI** for the user. `scripts/fuses.mjs` turns it on (keeps RunAsNode); `release.mjs` does it
  for the stable runtime copy; the dev binary in node_modules stays as installed (shared by every worktree, locked
  while running): `node scripts/fuses.mjs --enable-cookie-encryption` with all dev apps closed. The app logs a warning
  and `BrowserEnv.encryptedAtRest` says which case applies. Chromium never encrypts localStorage, IndexedDB or the
  cache: tokens an app keeps there are protected only by the Windows profile's file permissions.
