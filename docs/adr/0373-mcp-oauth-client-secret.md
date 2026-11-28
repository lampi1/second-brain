# ADR 0373 · A remote connector's OAuth client can carry a secret and a pinned scope

Date: 2026-11-28 · Status: accepted (owner, 2026-11-28: build it in the app, no issue) · Amends: ADR 0273 (the MCP OAuth login)

## Context

ADR 0273 lets a connector name a pre-registered `oauth.clientId` and a return port. Google's official remote Gmail MCP
(`https://gmailmcp.googleapis.com/mcp/v1`) cannot be used with that: its login server does not register clients
dynamically, a Google «Desktop app» client must send `client_secret` at the token endpoint, and the server's resource
metadata lists every Gmail scope (send, modify, full access) so the login would ask for all of them. Checked on
2026-11-28 with curl: the server's 401 carries `resource_metadata`; its metadata names `https://accounts.google.com/`
as authorization server and `resource` = the server's URL; the token endpoint is `https://oauth2.googleapis.com/token`.

## Decision

1. **Client secret.** A remote connector may have an OAuth client secret, next to its Client ID. It is a secret slot
   of its own (`oauth:client-secret`, reserved: `OAUTH_SECRET_SLOT`), set and removed with the connectors' existing
   `mcpservers:setSecret` / `mcpservers:deleteSecret` (no new IPC channel): encrypted with safeStorage in
   `mcp-secrets.json` like the tokens, bound to the address' origin (an address on another origin drops it), added to
   the logs' redaction when written and when read. Its mask is only «set»: not the definition, not the card, not an IPC
   answer carries it; the card gets one flag, `oauthSecretSet`. «Esci» keeps it (it belongs to the client, not to the
   session).
2. **Use.** «Accedi» reads it in main (`store.oauthClientSecret`) and passes it to `oauth.login` only when the
   connector has a Client ID; it goes in the form of the code exchange as `client_secret`, is kept in the encrypted
   session, and is sent again at every refresh. No secret = nothing sent (a public client), as before. A secret is never
   put in the authorization URL, and never sent to a dynamic registration.
3. **Scope.** `oauth.scope` (a space-separated list, in the definition: it is not a secret) replaces the server's
   advertised scopes in the login and in the session. Empty = the server's own, as before.
4. **Google refresh tokens.** Google gives a refresh token only to a request with `access_type=offline` (it has no
   `offline_access` scope): when the authorization endpoint is `accounts.google.com` the login adds
   `access_type=offline` and `prompt=consent`. No other server gets them.
5. **The form.** «Modifica» of a remote server has «Client secret OAuth» (a password box: empty = keep, «Salvato» and
   «Rimuovi» when one is saved) and «Scope OAuth».

## Consequences

- Google's Gmail MCP can be set up from Impostazioni → Connettori: URL, Client ID, Client secret, scope
  `https://www.googleapis.com/auth/gmail.readonly`.
- The `resource` parameter (RFC 8707) is still sent to Google; Google's bogus-client answers do not show whether it
  accepts the parameter. Untried against a real Google client: the tests use a fake network. If Google refuses it, the
  fix is to leave `resource` out for `accounts.google.com`.
- A rotated secret reaches a refresh only after a new «Accedi» (the session keeps the one it was made with).
