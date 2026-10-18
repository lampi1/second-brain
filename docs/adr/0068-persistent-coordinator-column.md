# 0068 — The Grindhouse beside one persistent Orchestrator column

Date: 2026-10-17. Status: accepted for the UI redesign. Supersedes the two workspace views of ADR 0005 (Mosaico,
Corsie) and their toggle, and ADR 0021's floating Regia as the default place of the coordinator.

The home view duplicated a coordinator composer beneath a large graph, the coordinator panel could occupy the top of
the window or collapse, and the agents lived in two places: the home rows and a separate Chat page with two layouts
(Mosaico, Corsie) and a view setting.

## Decision

- **One Orchestrator column.** The coordinator (the Orchestrator, formerly Regia) occupies the full height below the
  top bar and banners, wider on the Grindhouse, narrower on other pages, resizable with a pointer or the separator's
  arrow keys. The shell and native request overlays use the same geometry. Ctrl+R focuses it. The primary work
  Orchestrator is chosen in stable `regiaSince` order, also after renewal; its permissions and ownership are unchanged.
  App-development Orchestrators keep their separate backend scope.
- **The Grindhouse is the one place for the agents** (page id `home`, Ctrl+1; SPEC 19). Under the pending requests,
  each agent is a strip, one under the other, in the Orchestrator's order (by area, start order inside an area; never
  dragged or saved by the user). A strip starts collapsed (model, context, state) and expands inline into the
  conversation and its composer; it can be maximized or opened in focus mode. Each browser tab sits right under the
  chat that drives it. Requests keep the existing review flow: selecting one never approves or runs it.
- **The Chat page, Mosaico, Corsie and the view setting are retired.** Old links (`sb://workspace/...`, `grid`,
  `chat`, `chats`) still open the Grindhouse; chat links are `sb://home/chat-<id>`. The `agenti` page (agent profiles)
  stays.
- **The top bar** (SPEC 21): no "Nuova chat" button (agents start from the Grindhouse's "Nuovo agente", from the
  Orchestrator, with Ctrl+N or from the palette). Two controls in one click instead of a Settings dive: the
  full-screen popups switch (the existing `questionsModal` setting, with its state on the button) and the connectors
  button (GitHub, Jira) with one status dot each, green connected, amber to verify, red failed, opening the same panel
  as Settings → Strumenti e progetti (ADR 0067).
- **Motion.** Strips enter in turn, pages fade/slide in on every change (a fade only on the Grindhouse, whose native
  browser views are placed from the layout), progress bars move instead of jumping. Everything honors
  `prefers-reduced-motion`.
- Shared selects use one custom listbox (`components/Select.tsx`) matching the dark surfaces and menus, with
  keyboard support and labels. Visible windows maximize at startup; hidden QA windows stay offscreen.

## Consequences

One place to look for every agent and one way back (Esc, Ctrl+1, the page's back button). The browsers lose their
own zone: hiding them (Ctrl+Shift+B) still keeps the tabs working off screen. Global naming (Regia → Orchestrator on
the main side), the Dashboard and settings content are separate workstreams.
