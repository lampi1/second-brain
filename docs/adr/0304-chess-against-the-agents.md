# ADR 0304 · Scacchi: chess against the agents, Stockfish as a separate program

Date: 2026-11-13 · Status: accepted (owner, 2026-11-13: «una sezione scacchi dove io posso giocare contro i miei
agenti, ogni agente ha una difficoltà diversa stile bot chess.com … la difficoltà alta deve essere davvero alta, 2200
dovrebbe essere l'Orchestrator secondo me MINIMO … vorrei tenere lo storico di vittorie in meno tempo»)

## Context

The owner asked for a place to play chess against the six roles, each with its own strength, the Orchestrator the
strongest, with a history of wins and of the fastest ones. He also asked that the opponent be seen thinking and say
funny lines in its own character, tied to what really happens on the board, at zero tokens; that the board use existing
art, clean and in the app's style; and that en passant, castling and the promotion all work. He asked whether it would
weigh on the app.

A language model cannot play at 2200: a real engine is needed. Stockfish is the strongest open one and limits its own
strength on a known scale, but it is GPLv3 and this app is MIT.

## Decision

1. **A page «Scacchi»** (`renderer/components/chess/`, G K, the App group of the rail, its own lazy chunk): a lobby with
   the six agents as opponents (little person, rating, a line on how it plays, the user's record against it), the
   colour, then the game: the board, the opponent with its bubble, the taken pieces, the moves, the time, «Annulla
   mossa», «Abbandona», and the end card with «Rivincita». The game lives in `store/chess.ts`, not in the page: leaving
   the page keeps it.
2. **The engine is Stockfish 19 (lite, single-threaded WebAssembly), as its own process.** The two unmodified files of
   the npm package `stockfish@19.0.1` are vendored in `vendor/stockfish/` (1.9 MB; the package is 161 MB) with their
   licence, hashes and source link; the build copies the folder to `out/chess-engine/`. `main/chess/engine.ts` starts
   it with Electron's own binary as plain Node (`ELECTRON_RUN_AS_NODE`) and speaks to it only in UCI text over its
   pipes. Nothing of it is imported, linked or bundled by the app.
3. **It costs nothing until a game asks for a move.** The process starts at the first request, runs below normal
   priority on one core, keeps no game of its own (each request carries the whole move list), and ends when the page
   closes, after 3 minutes without a request, and when the app quits. One request at a time: a newer one supersedes
   the one in flight. A move not answered 15 s past its thinking time kills the process and the page offers «Riprova».
4. **Six bots, weakest first** (`shared/chess.ts CHESS_BOTS`): Scout ~600, Herald ~900, Artisan 1400, Sentinel 1700,
   Strategist 2000, Orchestrator 2200+. From 1400 to 2000 the rating is Stockfish's own `UCI_Elo`. Stockfish's limit
   starts at 1320, so the two weakest play its lowest skill at depth 1 and 2 and play a random legal move 30% and 12%
   of the times: their ratings are our estimate, shown with «~». The Orchestrator has no limit at all (full strength,
   1.2 s a move): 2200 is a floor, shown as «2200+».
5. **The rules are chess.js's, in the renderer** (`lib/chess-game.ts`): legal moves, check, mate, castling, en passant,
   promotion (the user picks the piece), stalemate, insufficient material, threefold repetition, fifty moves. A game
   is its list of UCI moves; every piece keeps one id from the first move, so a move slides and a capture leaves.
   Moves by click, drag or keyboard. **Premove** (owner, 2026-11-13: «mi piace bullet, amo il premove e gioco veloce»):
   while the bot thinks the user may already make a move (a piece and any square; by drag also onto a piece of their own, a
   recapture made in advance); `lib/chess-play.ts` plays it the moment the bot has moved if it is legal there (a pawn reaching the
   last rank becomes a queen), else drops it. Esc, a right click or a click elsewhere cancels it. The game's time keeps running while the page is closed, and
   is stored up to 24 hours. A piece held in a
   drag stays in hand when the bot moves.
   **Quick and smooth** (owner: «le animazioni fluide e veloci»): a move slides in 0.15 s, a taken piece fades in
   0.18 s, and the bot's move comes as soon as its engine answers (never sooner than 0.15 s, `MIN_THINK_MS`): the
   Scout answers in about 0.2 s, the Strategist in 0.9 s.
   **Light** (owner, 2026-11-14: «va un po' a scatti … rendi più fluida e leggera»): the piece in hand follows the
   pointer by its element's transform alone (`ChessBoard.tsx` does not draw the board again at every movement of the
   mouse) and has no shadow; the marks of a square appear at once; a game that grows by a move is walked on, not
   replayed (`position` in `lib/chess-game.ts`); the clock draws only itself. The board's state classes are named
   `is-…` / `in-…`: a plain `held` is another thing in `app.css` and drew a line over the piece in hand.
6. **The history** (`main/chess/store.ts`, table `chess_games` of `userData/app.db`, ADR 0199): one row per finished
   game (bot, colour, result, how it ended, the user's moves, the time, moves taken back), at most 5000. The page shows
   wins, losses and draws per bot, the fastest win against each, the eight fastest wins and the last twelve games. A
   game with a move taken back is kept but is never a speed record. Each bot also shows the wins in a row against it,
   the current row and the longest (owner, 2026-11-13: «voglio anche che ci sia il record di streak contro il singolo
   agente»): a loss or a draw ends a row, a move taken back does not; from two wins the end card says the row, and
   «Serie record» when it is the longest. Local only.
7. **The opponent's lines are fixed text chosen by the board, zero tokens** (`lib/chess-lines.ts` and its three
   language files): what just happened (`chess-game.ts eventOf`: which piece was taken, a check, a castling, a
   promotion, an en passant, a queen lost, who is well ahead, how it ended, a move taken back, a long wait) picks the
   moment, the role's character picks the line. The characters and the short lines muttered while thinking are the
   Grindhouse's (`shared/agent-quips.ts`); a pat or a whack on the little person answers as there (ADR 0297).
8. **The pieces are «Chessnut» by Alexis Luengas** (Apache 2.0), twelve SVGs in `renderer/assets/chess/chessnut/` with
   their licence; the board's two colours are the app's accent hue.

## Dependencies (rule 3)

- `chess.js` 1.4.0 (BSD-2-Clause, published 2025-06-14): the rules of chess in the renderer. Well known, no
  dependencies of its own, exact version. Writing legality, the draws and SAN by hand is far more than 100 lines and
  easy to get wrong.
- Stockfish.js 19 (`stockfish@19.0.1`, GPLv3, published 2026-10-10): not an npm dependency. Two files vendored and run
  as a separate program.

## Licence

The app stays MIT. Stockfish is distributed beside it as an unmodified, separate program under its own licence
(`vendor/stockfish/COPYING.txt`, the source at the tag named in `vendor/stockfish/README.md`, the entry in `NOTICE`):
the app starts it and exchanges UCI text with it, as any chess interface does with any engine. This is our reading of
the GPL's «aggregate», not legal advice; if it is ever questioned, the engine can be replaced or made a download
without touching the page.

## Consequences

- The repository and every release grow by 1.9 MB (engine) and about 60 KB (pieces); the renderer's first screen does
  not grow (chess.js and the pieces load when the page first opens).
- While a bot thinks, one core works at low priority for at most 1.2 s a move; between games there is no process.
- The ratings of the two weakest bots are estimates, not measured.
- Tests: `test/unit/chess*.test.ts` (bots and UCI lines, the engine against a fake process with fake timers, the
  store, the rules, the lines in three languages, whole games with fake dependencies, the vendored files' hashes) and
  `test/e2e/chess.spec.ts` (a written game through `SB_CHESS_SCRIPT`: en passant, promotion, castling, undo,
  resignation, a mate with a record; one move from the real engine).
