# ADR 0273 · Remote MCP connectors log in with the MCP OAuth flow

Date: 2026-11-12 · Status: accepted (owner, issue #389: «Remote MCP connectors: support the MCP OAuth authorization
flow») · Amends: ADR 0086 (the connectors' tokens)

## Context

A remote connector to an OAuth-protected MCP server (a Keycloak in front of it, say) failed its «Prova» with «Accesso
rifiutato (HTTP 401)», and its card offered only a Token field. The server's access tokens last minutes, so a pasted one
was useless soon after.

## Decision

1. `src/main/mcp-servers/oauth.ts` runs the MCP authorization flow (spec 2025-06-18):
   - discovery: the 401's `WWW-Authenticate` `resource_metadata` (else `/.well-known/oauth-protected-resource` with and
     without the path) → Protected Resource Metadata → its first authorization server → its metadata (RFC 8414 and
     OpenID discovery, every well-known form, so a Keycloak realm path works); an old server without resource metadata
     uses its own origin;
   - the client: the connector's own `oauth.clientId` (for servers that refuse dynamic registration), else dynamic
     client registration (RFC 7591) as a public client;
   - authorization code + PKCE S256 in the system browser (`shell.openExternal`), back on a one-shot listener on
     127.0.0.1 (a fixed `oauth.port` when the registered client needs one, else any free port), state checked,
     `resource` sent (RFC 8707), 5 minutes at most;
   - every URL https (http only on this computer).
2. The session (access, refresh, expiry, client, token endpoint, resource) is kept like a connector's token: encrypted
   with safeStorage in `mcp-secrets.json`, bound to the server's URL origin (an address that moves elsewhere drops it),
   never shown or returned to the renderer, every token added to the logs' redaction. «Connesso come …» is read from
   the token's claims (preferred_username, email, name) as a label only.
3. The gateway sends `Authorization: Bearer <access>` to that server only. Main refreshes it when it is within 60 s of
   its end, and once more when the server answers 401 (single flight per connector). A refused refresh (400/401) drops
   the session: the card asks «Accedi» again; a login server that is down keeps the old token while it is valid.
4. The card (Settings → Connettori): an «Accesso» row on a remote server that is logged in, set up for OAuth, or whose
   test got a 401 with a Bearer challenge: «Accedi» (then a «Prova»), «Connesso come …», «Esci». «Modifica» has
   «Client ID OAuth» and «Porta di ritorno» for remote servers. A logged-in server needs no pasted Authorization token.
5. Rule 2's exception for the connectors' tokens covers this login (docs/agents/rules.md).

## Consequences

- An OAuth-protected MCP server lists its tools after the user's login and keeps working after the access token ends,
  as long as the refresh token lasts.
- The browser login is the user's click only; agents and the Orchestrator never start it and never see a token.
- Untried against a real Keycloak: the tests use a fake network.
