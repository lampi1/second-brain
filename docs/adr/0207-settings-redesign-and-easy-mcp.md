# 0207 — Settings redesign, MCP servers in one paste, the Orchestrator configures everything

Status: accepted. Builds on ADR 0086 (app-managed MCP servers), ADR 0149 (app_config), ADR 0200 (contract split).

2026-10-30.

## Context

The owner (2026-10-30): «sistemami le impostazioni anche lì, UI figa, copia dai migliori. MCP deve essere facilissimo
configurarlo anche per l'Orchestrator, l'Orchestrator può fare tutto a richiesta.»

Settings was one long column of cards with a thin section list, and every change raised a toast. To add an MCP server,
the user had to translate a README's `mcpServers` JSON into separate command, argument and token fields. Flash, the
quick chat, had no MCP access at all. The Orchestrator could switch a connector on or off and change its access, but
it could not add, edit, test or remove one, and it could not change the owner's profile.

## Decision

### Settings page (macOS System Settings / VS Code / Linear)

- **Shell**: a sticky left column holds a search field and a category nav grouped as *Tu* (profile, appearance,
  notifications, voice, writing), *Lavoro* (space, roles), *Strumenti* (connectors, accounts, advanced) and *App*
  (update). Each item has a toned icon. Scroll-spy marks the current section (the last one whose top is above 20% of
  the scroller, and a click pins its item for 900 ms). `navGroups()` in `renderer/lib/settings-sections.ts` puts an id
  it does not know into the last group, so a section another block adds still shows.
- **Search** filters by section metadata and also by each row's own text. A row that does not match gets
  `data-st-miss` and is hidden; a section with no match is hidden. Matches are painted with the CSS Custom Highlight
  API (`::highlight(st-hit)`, `hitRanges()` folds accents and case), so the DOM is never rewritten. While searching,
  each nav item shows its match count. The command palette has one «Impostazioni › <sezione>» entry per section.
- **Rows**: the label and a one-line description on the left, the control on the right, grouped in cards under section
  headers. The controls are the same everywhere: `Switch`, `Segmented` (a radiogroup with arrow keys, used for theme,
  density and toasts) and the existing selects. A protected setting shows a shield (`ProtectedMark`) with a tooltip
  saying that another agent can only propose it.
- **Instant save**: every change already saved at once. The toast is now a quiet «Salvato» pill in the page header
  (`SettingsSaved.tsx`). It listens to `settings:changed`, shows «Annulla» (`settings:undo`), says «Modificato
  dall'Orchestrator» when the change was the agent's, and hides after 6 s. Changes that only touch local view prefs
  use `savedLocally()`. The store skips the toast while the page is open.
- Both themes use tokens only; container queries handle widths of 720, 640 and 420 px.

### MCP servers

- **Paste anything** (`shared/mcp-paste.ts`, used by the form and the Orchestrator): a README JSON (with or without
  the `mcpServers` wrapper, one or more servers), a command line (`npx …`, `uvx …`, `docker run …`, `KEY=v cmd`) or an
  https URL becomes a draft. `entryToDraft` is the one converter, shared with the Claude/Cursor import. Env and header
  values that look like secrets become token slots. In the form, their pasted value moves to the masked field. On the
  Orchestrator's path the value is dropped and only redacted.
- **Catalog**: eight popular servers (filesystem, fetch, memory, sequential-thinking, git, playwright, context7,
  brave-search). One click fills the form, and asks for a folder or a key when the server needs one.
- **«Salva e prova»** saves the server, stores each typed token in the encrypted secret store (then clears the field),
  applies the chosen roles and runs the existing test. The result is either «Funziona: N strumenti» or the error with
  its hint. When a token is still missing, the test is skipped and the result says why.
- **Roles on the card**: each server card and the add form have role chips (`ServerRoles` / `RoleAccessChips`) that
  save at once, including the Orchestrator and **Flash**. Flash is the MCP role `flash` (`FLASH_MCP_ROLE`). With no
  entry it gets `none`, and `all` is capped to `read` (`effectiveAccess`). The gateway also refuses a non-read-only
  tool to a Flash chat (`access.ts`), and `manager-sessions.ts` gives quick chats that role.
- **Secrets** follow security baseline rule 2: they stay in the app's existing secret store, never in files or logs.
  The renderer sends a value once, through `mcpservers:setSecret`. Nothing returns it.

### The Orchestrator (app_config)

- `area connector` adds the actions `add` (a `snippet` or a `def`), `set` on more keys (access including flash,
  enabled, label, purpose, command, args, env, url, headers, tokens), `remove`, `test`, `undo` and `form`.
  - Each change goes through the MCP service's undo journal (`agentSave` / `agentRemove` / `agentAccess`). The journal
    takes a snapshot of the server with its secrets still encrypted, so an undo restores a removed server along with
    its token.
  - Each change also posts a feed card (`connector-changed`) whose «Annulla» calls `mcpservers:undo`.
  - The gate is unchanged: the user's own recent words, and a log line without values.
- **No secret values**: the tool never reads, asks for or echoes one. `form` opens Settings › Connettori with the add
  form filled through `ui:command mcpDraft`. The draft carries no secret, and the user types the token there.
- New `area profile`: get, or set name / role / language / mainWork / replyStyle through the page's own `ProfileService`
  (revision checked; a field the app marks locked is refused).
- app_guide has new entries for the connector flow and the settings page. The concept cards `mcp-servers` and
  `orchestrator-app` describe the changes in it, en and de.

### Audit: what the user can do and the Orchestrator cannot

Now closed: adding, editing, testing and removing MCP servers, per-role access including Flash, and the owner profile.

Still the user's own, by design:
- secrets: API keys, connector tokens, sign-ins;
- engine trust (a security consent);
- production actions.

Still open, and not cheap:
- MCP import from Claude/Cursor (the user's button; it could become an `import` action, but it needs a many-server
  undo);
- the brain share zip (a save dialog);
- voice model download;
- the guided setup modal (app_ui can only open the page);
- folder pickers (the setting keys themselves are reachable through `area setting`).

## Consequences

- `Switch`, `Segmented` and `ProtectedMark` are exported from `SettingsPage.tsx`, for sections other blocks add.
- `settings.spec.ts` (e2e) chooses the theme through the radiogroup. `helpers.choose()` accepts a radiogroup.
- `mcp-servers.json` may now hold a `flash` access entry. An older app ignores it, and Flash had no MCP before.
- The MCP undo journal is in memory, so an «Annulla» card does not survive a restart (it then says the change is
  gone).
