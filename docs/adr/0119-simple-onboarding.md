# ADR 0119 · Simple onboarding: the language first, six steps, tool tiles

Date: 2026-10-22 · Status: accepted (owner, issues #164 and #165) · Builds on: ADR 0086 (MCP servers managed by the
app), issue #96 (the roles start on the engine chosen in setup)

## Context
The first-run interview asked too much and in the wrong order. The language was a free-text field on the fourth step,
guessed with `/^en/i`, so the wizard stayed in Italian until the end. Tools were set up through a technical MCP form
(command, arguments, environment, headers), apart from the app accounts. The folders step offered an existing brain,
and goals, areas and team were asked before the user had seen anything. The legacy onboarding screen
(`modules/onboarding/Screen.tsx`, `Board.tsx`, `i18n.ts`, `styles.css`) was no longer mounted.

## Decision
- **Six steps in one modal**: Language → Your AI → Tools → About you → Folders → Ready (`SETUP_STEPS`). Nothing in it
  closes the modal: sign-ins and token pages open in their own windows, and the step waits in place.
- **The language is the first step.** It shows three large choices (Italiano, English, Deutsch), with the system
  language preselected. A choice saves the draft with `saveSetup` first, then `settings:set {language}`. LangRoot
  remounts the tree in the new language, and the wizard resumes on the same step with its answers, because the setup
  store lives outside the tree. The same value is the profile's chat language (`LANG_PROFILE`, written to me.md) and
  the new brain's language. The free-text field and the guess are removed.
- **Your AI**: one recommended engine (`recommendedEngine`: signed in, then installed, then missing; Claude Code first
  on ties). It is fixed once every engine has been checked, so the cards do not jump. The others sit under «Altre IA»,
  which opens by itself when one of them is in use or signing in. The first engine chosen is
  `orchestratorChats.harness`, which the roles start on (#96).
- **Tools are a tile catalog** (`lib/tool-presets.ts`, `ToolCatalog.tsx`): GitHub, Jira Cloud and Azure DevOps. A tile
  asks only human data (a token, a site and email, an organization). It creates the app account and the managed MCP
  server together, and stores the token in the server's secret slot. It then tests at once and says «Funziona: vedo N
  progetti» or what to do next. A token tile links straight to the page where the token is made, with one line on
  how. The tiles are not a nested `<form>`, so Enter in a tile never moves the wizard on. The same catalog leads
  Settings → Connettori.
- **A token for the account**: a new IPC `connectors:useToken` (`ConnectorToken`). GitHub tokens go to a new
  safeStorage vault (`GithubVault`, ciphertext only, redacted from logs), and the probe uses them on
  api.github.com. Jira uses the existing credential vault. A bad token is answered with what to check, never with the
  token.
- **The technical MCP form moves to Settings → Avanzate** (`McpAdvanced`): add, import and edit a server. The
  Connettori section keeps the cards, the tests and the write-only tokens.
- **About you is optional**: name, role and kind of work.
- **Folders always create a new brain** in the default place. An existing brain is never offered. The projects folder
  is asked only when it is not found.
- **Ready** sums up the answers. Goals, work areas and team are asked later, one question at a time, by the first guide
  chat on the chosen engine (`guidePrompt`). Its brief stays hidden (`SetupDraft.guide`).
- The legacy onboarding screen and its strings are removed. `modules/onboarding` keeps the discovery contract and the
  app accounts.

## Consequences
- No new permission prompt: the GitHub token, Jira credentials and server secrets live in safeStorage vaults, and the
  test only reads.
- The Jira tile assumes that Atlassian's remote MCP (`mcp.atlassian.com/v1/mcp`) accepts Basic email:token. If it
  does not, the tile's test says so, and the server can be fixed in Settings → Avanzate.
- e2e `setup-simple.spec.ts` covers the language switch, keeping the answers, and a full run with the GitHub tile. It
  touches no technical field, and its connection test is faked with zero network. `connectors-hub.spec.ts` finds the
  form in Avanzate.
