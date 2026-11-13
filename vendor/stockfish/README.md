# Stockfish (chess engine of the Scacchi page)

Third-party program, **not** part of second-brain's MIT-licensed code. Licence: GNU GPL v3 (`COPYING.txt`).

| File | What | SHA-256 |
|------|------|---------|
| `stockfish-19-lite-single.js` | Stockfish.js 19, lite single-threaded build (loader) | `ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a` |
| `stockfish-19-lite-single.wasm` | the engine and its small network | `ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de` |

- Taken unmodified from the npm package `stockfish@19.0.1` (`bin/`), published 2026-10-10 by Nathan Rugg
  (Stockfish.js, (c) 2026 Chess.com, LLC), based on Stockfish by T. Romstad, M. Costalba, J. Kiiski, G. Linscott and
  other contributors; network by Chris Bao (sscg13).
- Corresponding source: <https://github.com/nmrugg/stockfish.js> at tag `v19.0.1` (the Stockfish C++ source and the
  build script that produce these two files); upstream engine: <https://github.com/official-stockfish/Stockfish>.
- How the app uses it: `scripts/build.mjs` copies this folder to `out/chess-engine/`; `src/main/chess/engine.ts`
  starts the script as a separate process and talks to it only in UCI text over its pipes. No file of the app links,
  imports or bundles it, and the app's own code stays under the MIT licence (ADR 0302).
- `package.json` here is ours (two fields, no code): it tells Node that the engine's script is CommonJS, because the
  repository's own `package.json` says `"type": "module"`.
- Only these two of the package's nine engine files are kept (the full builds are about 100 MB each).
  `test/unit/chess-vendor.test.ts` checks the hashes above.
- To update: replace both files from a newer `stockfish` package (published at least 14 days before, rule 3), update
  the hashes here and in `.guardallow`, the names in `src/main/chess/engine.ts`, and the NOTICE entry.
