<!-- Routine page redesign: three static mockups and their comparison, for the owner's choice before any UI code.
     Open the .html files in a browser (they load the app's real tokens from src/renderer/styles/tokens.css);
     png/ holds every frame in dark, plus the current page (prima-app-reale.png). -->
# Routine page: three proposals

Each file shows the same data in four frames: the main page, starting a routine on one work item with an
attachment, the dry-run preview, and the export for a cloud agent. All three share:

- the next thing to do on top, as the unified question card (style A from the yes/no thread): question, what was
  done with proof, what Sì / No do, two big buttons, «Scrivi una risposta…», «Ci penso dopo»;
- prod steps never run by themselves: the exact command with parameters filled and an «Esegui» button;
- per step: role, engine, model and effort pinned (shown on each step), scripts and queries pinned by hash,
  receipts (command, parameters, hash, times, exit code, who ran it);
- rules with on/paused toggle, trigger filters (include/exclude tags, area, max per hour), queue size and «Svuota coda»;
- export of a routine as a portable bundle (definition, pinned models, skills, scripts and queries with hashes,
  MCP tool names, no secrets) for this app or a cloud agent, with a warning when a target lacks a pinned model.

| | A · Quadro di controllo | B · Una cosa alla volta | C · Tabella a binari |
|---|---|---|---|
| File | `a-quadro.html` | `b-una-cosa.html` | `c-binari.html` |
| Shape | 3 columns: routines, run timeline, step detail; decision band on top | one big decision card (deck, 1 di N), running work as cards with an inline timeline, slim routine list on the side | one dense table of all runs with a metro line of steps, actions pinned as first rows, run timeline in a drawer |
| Next action | visible, but shares the screen with 3 columns | the biggest thing on the page | compact rows on top, small buttons |
| Many runs (90+ queued) | one routine at a time, runs as tabs | long card list, needs a filter | best: scans like a spreadsheet |
| Fits next to the Orchestrator column (~770 px left for the page) | no: the 3 columns get cramped | yes: one column + side list folds under | partly: the drawer covers the table |
| Calm / ADHD | medium: lots on screen at once | high: one thing, then the rest | medium: dense, needs scanning |
| Cost to build | medium | low–medium (reuses the Memoria deck) | medium–high (table + drawer + metro) |

## Recommendation

**B**, with one piece of C: the metro line of steps on each run card (B already has the segment bar). B is the
only layout where the next action is always the most visible thing, it works at the width the page really has next
to the Orchestrator, and it reuses the Memoria proposal deck pattern you already use every day. C is the better
choice only if you expect to watch many runs at once more than you answer them.

## Before

`png/prima-app-reale.png`: the current Routine page with a run blocked on «Execution adapter unavailable».
