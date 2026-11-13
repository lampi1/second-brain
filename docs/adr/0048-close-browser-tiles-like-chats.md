# ADR 0048 · Browser tiles close like chats; the agent is told the user closed its tab

Date: 2026-10-14 · Status: accepted

## Context
The user, 14/10: "voglio poter chiudere anche le finestre del browser come per le chat". A chat tile has a ✕ at the
right end of its header and Ctrl+W, both with a 6-second "Annulla" toast; a browser tile had neither (only an agent's
`tabs_close` or the chat's own close removed it). Closing a tab under an agent had a hidden trap: when the closed tab
was the agent's active one, its group silently moved to another tab, so the agent's next call without `tabId` acted on
a page it had not chosen; a call with the closed `tabId` only said "No tab … among your tabs". Ctrl+W typed inside a
page (a native view) was swallowed (keyguard.ts) and did nothing.

## Decision
- **Same gesture as a chat.** The browser tile's header ends with ✕ "Chiudi scheda" (Ctrl+W), after ⤢. ✕, Ctrl+W on
  the selected tile, and Ctrl+W typed inside the page close it with the chat's flow (`closeTab` beside `closeChat`,
  renderer store.ts): the tile goes at once (`ui.hiddenTabs`), "Chiusa la scheda «…» · Annulla" for 6 seconds, then
  `browser:close`. A maximized or Corsie-paired tab leaves that view, Annulla puts it back. The ✕ shares the chat's
  500 ms double-click guard. Ctrl+W on a tile not on screen does nothing but the usual hint.
- **Ctrl+W inside a page** is forwarded by main as `ui:command closeTab` only when the window and that page have the
  keyboard (a user typing there); an agent's synthetic keys never close a tab. No new IPC channel.
- **The agent learns it at its next call.** `browser:close` closes as `'user'` (tabs.ts): such a tab is remembered per
  group (closed.ts, at most 20). A call on it by id, or without `tabId` while it was the active tab, fails with "The
  user closed tab t3 (<url>) in the app. Your open tabs: … Call tabs_select …" (or "You have no open tab now …"). The
  group keeps no active tab until the agent picks one (tabs_select, tabs_create, a navigate that opens a tab), so it
  never lands on another page by itself. A call running when the tab closes ends with "The user closed tab … while
  this call ran". Agents' own `tabs_close`, a page closing itself and a chat's close are unchanged.

## Consequences
- Testid `browser-x-<tabId>` is new; the shortcut list says Ctrl+W closes "la chat o la scheda del browser selezionata".
- The user's own tabs ("la tua scheda") close the same way; no agent to tell.
- Tests: unit `browser-closed.test.ts`; e2e `browser-close.spec.ts` (✕ + Annulla, the agent's error by id and without
  id, tabs_select recovers, Ctrl+W on the tile and inside the page), screenshots `browser-close-*`.
