# ADR 0347 · The PC's CPU and free RAM, and the connectors with the MCP servers, on the top bar

Date: 2026-11-24 · Status: accepted (owner: «vorrei che si vedesse sempre la cpu del pc e la ram libera … i connettori
nella barra in alto espandibili come l'utilizzo dei vari motori per vedere lo stato e connetterli, idem mcp») · Amends:
ADR 0287 (what the top bar holds)

## Context

- The PC's load already decides when chats wait (the load queue, ADR 0222) but the user saw it only on a queued chat.
- The connectors and the MCP servers lived only in Impostazioni › Connettori: to see if one broke, or to sign in, the
  user had to open Settings.

## Decision

- **PC load, always on the bar** (`SystemLoad.tsx`): «CPU 40% · RAM 14,4 GB libera». The renderer asks `app:load`
  every 3 s (not while the window is hidden); main answers from `system-load.ts`: CPU busy share of every core since
  the previous read (`os.cpus()` deltas) and `os.freemem()`/`os.totalmem()`. Amber from CPU 70% or free RAM 20%, red
  from 90% / 10%. The tooltip adds the total RAM and the free %. In narrow windows the word «libera» goes first, then
  the labels.
- **Connectors chip** (`ConnectorsChip.tsx`): a link icon, «Connettori», «n/m» working of what is in use, and a red
  count of what needs a fix. Counted: accounts touched (not a pending one never signed in, so a clean install shows no
  red) and MCP servers on. Its click opens a panel like the usage one: the app's accounts (GitHub, Jira Cloud, Azure
  DevOps) with state, «Accedi» (the same sign-in as the cards, `connectors:login`) and «Prova»; the MCP servers with
  state, «Accedi» for a remote server's OAuth login (`mcpservers:login`, ADR 0273), «Prova» (`mcpservers:test`),
  «Token» (opens Settings › Connettori, where the secret is typed); «Gestisci connettori e MCP» at the bottom.
- The full cards, the add form and the roles stay in Settings › Connettori; the chip adds no new IPC for connectors.
- The engines' sign-in stays where it was (gear menu, and the bar only when one is signed out).

## Consequences

- One IPC read every 3 s (`os.cpus()` + memory): cheap; nothing is logged or stored.
- The bar has two more items; the fit steps (`useFit`) shrink them like the others.
- Untried on the owner's Windows PC: `os.freemem()` there is the available memory, which is what «libera» means.
