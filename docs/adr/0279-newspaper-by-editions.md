# ADR 0279 · The newspaper goes by editions: any subject, a few stories, the Orchestrator edits it

Date: 2026-11-13 · Status: accepted (owner, thread «Preparare la 1.0 con analisi profonda»: «la sezione apprendimento
generalizzata, ognuno si può mettere le fonti che vuole anche di macchine volendo o altri topic, deve essere proprio un
giornale figo anche lato UI, navigabilissimo e con notizie poche ma le migliori. L'orchestrator deve poter aggiungere e
rimuovere fonti») · Amends: ADR 0265 (the AI newspaper)

## Context

ADR 0265 made one newspaper about one subject: 28 built-in sources on AI for people who build agents, five fixed
sections and key words written in the code. A user with another interest could add a link, but the ranking and the
sections still spoke about agents. The front page listed up to 30 summarized stories, and only the user could edit the
sources, by hand.

## Decision

1. The paper is made of **editions** (`NewsEdition`, `src/shared/news.ts`). An edition is a subject: a name, one
   sentence on what the user wants from it (`interest`), its sections (name + the words that send a story there), its
   key words (`core`, `near`), the size of its front page (`cap`) and its own sources. At most 12 editions, 8 sections
   each.
2. A clean install has **no edition** (clean install = point zero). The old paper is a ready-made edition, «AI per chi
   costruisce agenti» (`NEWS_TEMPLATES`, `src/main/news/sources.ts`): chosen from «Nuova edizione», never seeded. A
   state file of ADR 0265 is read as that edition, with every story, mark and lesson kept (`idOf` keeps the old ids).
3. The ranking stays at zero tokens and reads the edition's words instead of fixed ones (`src/main/news/rank.ts`): a
   word matches as a whole word plus up to three trailing letters, in any language (`wordPattern`), so «batteri»
   matches «batteria» and «batterie» but «prova» does not match «approvato». When the user gives no key words they
   come from the name and the sentence (`wordsFromInterest`). A source may pin its section (`pin`), otherwise the
   words decide.
4. **A few stories.** The front page holds the best `cap` stories (7 by default) of the last 7 days, never one the AI
   pass judged off topic (`fit` 0) or the user refused (`frontPage`). The rest wait under «Altre». The AI pass runs once
   per edition on at least 14 stories and gets the edition's name and sentence inside the fence, as data.
5. **«Meno così»** on a story hides it and lowers its source's weight by 0.05 (floor 0.2); the undo gives it back. No
   AI call, no profile of the user: the only thing that learns is the weight of a source.
6. A source is a **public https link** only (`publicHttps`: no loopback, no LAN, no credentials in the link).
   `testSource` reads a link once at zero tokens and says how it will be read and how many stories it holds, before it
   is added («Prova» in the panel). A link added as a feed that turns out to be a page is read as a page.
7. **The Orchestrator edits the paper** (`src/main/appctl/news.ts`): `app_news` (read), `app_news_edition` (create,
   update, delete), `app_news_source` (try, add, remove, pause, resume), `app_news_refresh`. No approval and no
   «user turn» gate: the Orchestrator counts as the user (ADR 0275), the paper holds public links, and a deleted
   edition or source is rebuilt in a minute. «Nuova edizione» can hand the Orchestrator the name and the sentence and
   let it find and try the sources.
8. The page keeps the three columns of ADR 0265 and adds the editions as mastheads on top, a large lead story, the
   «Altre» row, and keys for everything (1-9 section, [ ] edition, J/K, S, U, X, E, O, R, «,»).

## Consequences

- A refresh of all editions costs one AI pass per edition; the cost is shown per refresh as before, and the daily
  refresh stays off by default.
- What a source returns is public web text: it reaches the model only inside the fenced summary prompt, and the
  Orchestrator's tools return titles and the app's own summaries.
- The fixed section ids of ADR 0265 are gone from the types (`NewsSection`, `NEWS_SECTIONS`); a section is a string
  of its edition.

## Not tried

A new subject's real feeds were read only through the tests' fake network and the demo; the ready-made AI edition's
live reading is the one measured in ADR 0265.
