# 0202 — «Andamento»: the four statistics pages in one, and a local usage counter

Status: accepted. Builds on ADR 0101, ADR 0109, ADR 0122, ADR 0149, ADR 0197 and ADR 0199; block 2 of the report
«Cosa tenere, cosa togliere, e Impara v3» (2026-10-30, «Da accorpare» and A0), approved by the owner («Procedi con
tutte le modifiche»).

2026-10-30.

## Context

The app had four statistics surfaces in three places: Costi and Qualità (pages of the rail's ANDAMENTO group),
Classificatori (a page of the BRAIN group) and Apprendimento (a tab of Memoria). Each had its own head: Costi and
Qualità a title plus a lead sentence that repeated the numbers of the KPIs and cards right below it; Classificatori a
dashboard header with its own refresh button; Apprendimento a counter of verdicts and, above its list, chips with the
same counts again. The classifiers have never been calibrated on a real model (#40) and do not need a rail entry.

The report also found no real usage data to decide what to keep: every verdict came from the code (lines, settings,
background costs). It proposed A0: a local, zero-token counter of page opens and actions, shown for 14 days.

## Decision

### One page, five tabs

- **`andamento`** (rail → ANDAMENTO, G C; en «Trends», de «Verlauf»), `components/andamento/AndamentoPage.tsx`:
  Costi · Qualità · Apprendimento · Classificatori · Uso. It opens on Costi. The page arg picks the tab
  (`andamento/<tab>[/<more>]`, `andamento/costi/30`), pure helpers in `lib/andamento.ts`.
- **Title always visible**: a sticky head (title, one-line lead, the pill tab bar with a sliding ink, ←/→/Home/End) stays
  on screen while a tab scrolls; a tab change is a place of its own (back / forward) and starts from the tab's top.
- **One toolbar per tab, the same everywhere**: `PageHead` without a title (`brain/components/States.tsx`) shows the
  explain line on the left and period, last update, refresh and the Guida link on the right. Costi and Qualità take
  `embedded` (no title, no lead); Classificatori and Apprendimento always use it now.
- **Each number once**: the Costi and Qualità leads (total, per day, the four cards' values) are gone in the tab; the
  Classificatori summary loses «Esiti verificati» (the «Tipo di lavoro» card shows the same k/n and the unverified
  line); Apprendimento's chips with the verdict counts are gone (the counter tiles are the list's filter; a filtered
  list shows the verdict and «Mostra tutti»).
- **Aliases**: the ids `costi`, `qualita`, `apprendimento`, `classificatori` and the Memoria tab `memoria/apprendimento`
  are redirected by `go()` / `placeOf()` / `parseTarget()` to their tab, keeping their arg (`costi/30` →
  `andamento/costi/30`); G Q, G J and G K stay as go-to aliases (`GO_ALIASES`), G C is Andamento. The feed badges of
  errors, wins, proposals and budget count on `andamento`. Work profiles QA and CTO list `andamento`.
- Data and IPC are unchanged: every tab reads what its page read (`/api/cost`, `/api/tables`, `/api/quality`,
  `classifiers:state`, the brain model's learning).

### The usage counter (A0)

- **What**: page and tab opens (`go()`: one count per place change, Memoria / Andamento / Impostazioni counted per
  tab) and main actions — new request, Orchestrator, Ferma tutto, focus mode, Ctrl+J, new browser, Discuti, file opens,
  the palette, Manutenzione, dictation, voice conversation, call recording, a proposal decided. An action is counted by
  `track(name)` (renderer `lib/use-counter.ts`) or by any element with `data-track="<name>"` (one capturing click
  listener). Keys are `page:<id>[/<tab>]` or `action:<name>`: never content.
- **Where**: the renderer batches counts and sends them every 20 s, at 50 uses or when the page hides
  (`usecount:add`); main (`main/use-counter.ts`) adds them to `userData/app.db`, area `use_counts`
  (`use_counts(day, key, n)`, primary key day + key, one transaction per batch; the local calendar day). Rows older
  than 90 days are deleted at the first write of a day. app.db is opened lazily, after the agent runs' store has opened
  and checked it (ADR 0199); if it cannot be opened the counts stay in memory for the session (one `log.error`). The
  batch is checked in main (key shape, whole counts 1–1000, at most 200 keys). The demo counts in memory from two fake
  weeks, never written.
- **Shown**: Andamento → Uso: a line saying it is for deciding what to keep, three KPIs (uses, days with the app,
  features used and how many never opened), uses per day (today highlighted), every page, tab and action from the most
  used with a bar, its days and its last day (a page opens on click), and the places never opened in 14 days.
  `usecount:report` (default 14 days, at most 90).
- **Orchestrator**: `app_guide` has an entry «Uso dell'app: funzioni e pagine usate di più» with the 14-day summary
  (most and least used), only on the Orchestrator's authenticated mount (`showValues`), so it answers «quali funzioni
  uso di più?»; its index names it. No new tool.
- **Never sent anywhere**: no network, no telemetry; the counts are not written to the log; nothing reads them but the
  Uso tab and app_guide.

## Consequences

- The rail loses two entries (Costi, Qualità → Andamento) and one in BRAIN (Classificatori); Memoria loses its
  Apprendimento tab (its «Modifiche in 24 ore» counter and the role changes in its activity open Andamento →
  Apprendimento).
- Old links, saved places and the Orchestrator's habits keep working through the aliases.
- After a few weeks the Uso tab gives the numbers to cut or keep features (voice conversation, Impara, Routine…).
  Counts start at the first run of this release; there is no history before.
- A damaged app.db moved aside (ADR 0199) loses the counts: acceptable for a convenience counter, no way back.
- Guida: a new card «Andamento e uso dell'app» (`trends`); the classifiers, memory-hub, runs, lessons and quality cards
  say where those parts live now.
