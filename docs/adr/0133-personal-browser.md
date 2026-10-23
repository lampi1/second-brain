# ADR 0133 · A personal browser for the user, apart from the agents' browsers

Date: 2026-10-23 · Status: accepted (owner, 2026-10-23: «una sezione per far usare all'utente il browser proprio per
tutti i giorni … con la possibilità di salvare sessioni e preferiti, avere le google password manager ecc, ma slegato
dai browser che aprono gli agenti»; he chose the browser inside the app over a Chrome profile launched by it) ·
Builds on: ADR 0003 (tabs as WebContentsViews), 0012 (credentials never in an agent's context), 0046 (safeStorage)

## Context
The app's browsers belong to the agents: each tab sits in an environment partition an agent drives over MCP. The owner
wants his own everyday browser in the app too, with bookmarks, saved sessions and his passwords, which no agent sees.
Two limits come from Electron and Google, not from us: Google blocks sign-in from "embedded" browser frameworks since
2021 (it may or may not detect Electron), and Google Password Manager is a Chrome feature that Electron does not have.

## Decision
- A **Browser** page (left rail, App group; Ctrl+K; G W) with tabs, address bar (Google search for anything that is
  not an address; `javascript:`, `file:` and other schemes are never opened from it), back/forward/reload, a bookmarks
  bar, a start page, and a side panel: Preferiti, Sessioni (a named set of tabs, reopened with one click), Cronologia,
  Password. The tabs open at the last close are offered once («Riapri le schede di prima»).
- Its tabs live in **one partition of their own**, `persist:personal` (`src/main/personal/`), never an agent
  environment. Agents get **nothing** of it: no MCP tool, not in `browser:list` or `app_state`, `app_logs` carries no
  address, and `app_screenshot` withholds the whole window while a personal tab is on screen (the address bar would
  show it). No CDP, no device emulation. Only fullscreen and the clipboard's sanitized write are granted to pages.
- Sites see Chrome's user agent (the "Electron/x" and app tokens removed) so Google sign-in has its best chance; when
  Google still refuses, the start page says to open that site in Chrome.
- **Passwords**: the app keeps its own, each encrypted with safeStorage (the SecretCipher of ADR 0046) in
  `<userData>/personal-passwords.json`; refused without OS encryption (Linux without a keyring). The renderer sees
  only site and user name. A password is decrypted only to fill a form of its own site (scheme + host, `www.` ignored;
  https, http only for local hosts), in an isolated world of the top frame, at the user's «Compila»; or for «Copia
  password» (cleared from the clipboard after 30 s). «Salva» reads what the user typed in the page's form. An import
  takes the CSV that Google Password Manager (passwords.google.com → Esporta), Chrome, Edge and Firefox export. This is
  a third exception to AGENTS.md rule 2, for the user's own browsing only.
- Bookmarks, sessions, history (2000 entries) and the last tabs: `<userData>/personal-browser.json`, never in the brain.
- **«Affida a un agente»** (owner, 2026-10-23: «posso volendo comunque dare il controllo ad un agente di quella sezione
  browser?», he chose it in this same change): the user gives **one** tab to a chat of their choice, with an optional
  note. The same page (alive, with the user's sign-ins) moves into that chat's browser group as a tab of env
  `personal`; the chat is told with an app message and drives it with its usual browser tools, until the user clicks
  «Riprendi» or closes it from the agent's strip, which gives the page back to the Browser page instead of destroying
  it. Only the user's click lends: no agent tool asks for a tab. Only open chats with browser access «all» can take
  one. While lent the tab writes no history and offers no passwords; the other personal tabs, bookmarks, history and
  passwords stay out of every agent tool, and `app_screenshot` never shows a page of the personal session (the lent
  tab included). The tab's back history is cleared when lent, so the agent cannot step back to what the user saw. A
  popup or its opener is not lent (they reach each other's pages): the user opens the address in a new tab. When the
  tab comes back, the tabs the agent opened from it are closed.

## Consequences
- The user browses without leaving the app, and nothing of it reaches an agent or a brain file.
- Google sign-in may fail on some accounts: not fixable from the app. Chrome sync, Google Password Manager itself and
  Chrome extensions are not available; the CSV import is the bridge.
- No camera, microphone, location or notification prompts yet (denied): a video call needs Chrome for now.
- A lent tab carries the user's cookies for every site, not only the one it shows: what the agent does there, it does
  as the user, wherever it navigates. The page says so before «Affida», and «Riprendi» is one click away.
