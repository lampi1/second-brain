# ADR 0001 · Stack: Electron + TypeScript + React + Vite, tests with Vitest and Playwright

Date: 2026-10-11 · Status: accepted

## Context
The app must embed browsers that agents drive (a web page cannot drive its own browser), run CLIs as child
processes, watch files, show native notifications, and run on a corporate Windows PC without admin rights. Rust is
not installed (Tauri would need it), and Tauri's WebView2 has no per-view CDP/input story as mature as Electron's.

## Decision
- Electron 44.4.5 (WebContentsView per browser tab, `sendInputEvent` trusted input, `capturePage`, `debugger`).
- TypeScript 6.0.3 strict; main/preload bundled by esbuild 0.28.2, renderer by Vite 8.3.1 + React 19.3.0.
- Vitest 5.0.2 (unit), Playwright 1.63.0 `_electron` (end-to-end on the real app), ESLint 10 + typescript-eslint 8.70.
- Markdown in chats: marked 18.0.14 + DOMPurify 3.4.16.
- Every version exact and published ≥ 14 days before install (`--before=2026-09-27`); npm `ignore-scripts` stays on,
  Electron's binary is fetched by its own checksummed `install.js`.

## Consequences
- One language end to end; the contract (`src/shared/contract.ts`) is checked by the compiler on both sides.
- Known advisory: `source-map-js` 1.2.1 (through Vite → PostCSS; DoS on hostile source maps, build time only). The fix
  (1.2.2, 2026-09-30) is younger than 14 days: update after 2026-10-14.
