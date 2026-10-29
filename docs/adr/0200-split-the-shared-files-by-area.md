# 0200 — Split the four shared files by area; ChatManager as a chain of layer classes

Status: accepted. Builds on ADR 0198 (AGENTS.md as a map, the `sb/max-lines` warning).

2026-10-29.

## Context

Almost every change touched `src/main/chats/manager.ts` (4054 lines, one class), `src/shared/contract.ts` (1876),
`src/main/wiring.ts` (1058) and `src/main/index.ts` (684). Parallel agents collided on them, each merge was a conflict
in the middle of a long list, and a reader had to page through thousands of lines to find one concern. All four were on
the `LONG_FILES` list that exempts files from the 800-line warning.

## Decision

Pure refactor, no behaviour change: the same objects are built in the same order, every public name keeps its import
path.

- **Contract**: the shapes and each area's invoke channels move to `src/shared/contract/*.ts` (engines, chats, browser,
  feed, app, settings, brain, ui, agents, media). `src/shared/contract.ts` stays the one entry: it re-exports every
  area, declares `InvokeMap` as an interface extending one `<Area>InvokeMap` per file, and keeps `EventMap`, the
  runtime channel lists and their compile-time completeness checks. `@shared/contract` imports are unchanged.
- **IPC handlers**: `src/main/ipc-handlers/*.ts`, one function per area (`chatsHandlers(ctx)`, …) returning
  `HandlersOf<'chat' | …>`, the handlers of every channel with those prefixes (so a group cannot miss one of its own
  channels). `index.ts` builds one `HandlerContext` (the wired services and the objects it creates at start; the
  window and the late-built Proposte service as getters) and spreads every group into the `Handlers` object, whose type
  still requires every channel.
- **Wiring**: `Ctx` / `Wired` in `wiring-types.ts`; the steps the demo wiring shares in `wiring-shared.ts`; two
  self-contained builders (personal Browser, Impara) in `wiring-builders.ts`, called at the same point of
  `createServices`. `wiring.ts` re-exports them.
- **ChatManager**: a chain of abstract classes, one concern per file, each extending the one before:
  `manager-core.ts` (every field and the constructor) → persistence → sessions → checkpoints → requests → continuity →
  delegation → lifecycle → work → sink → `manager.ts` (`export class ChatManager`). It stays one object: the same
  fields, the same `this`, methods on the prototype chain (tests that reach `chats`, `opts` or `ensureSession` still
  do). A private member used by another layer became `protected`; a method a lower layer calls is declared
  `abstract` (with `override` on its implementation, `noImplicitOverride`). Shapes (`Rec`, the options) are in
  `manager-types.ts`, constants and pure helpers in `manager-helpers.ts`; `manager.ts` re-exports what others import.

Collaborator objects (a `ChatPersistence` holding a reference to the manager) were considered for the manager: every
concern reads and writes the same per-chat records and calls the others' methods, so each collaborator would need most
of the manager's private state through a wide interface, and moving methods off the instance would break the tests that
reach them. The layer chain keeps one instance and one `this` and moves only text.

The split files leave `LONG_FILES`; no new file is over 800 lines. The Guida's anchors that pointed into the moved
methods point to their new files.

## Consequences

- A change to delegation, the cold notes or the IPC of one area touches its own file; merges of parallel work stop
  colliding on the same 4000-line class.
- A new ChatManager method goes in the layer of its concern. If a lower layer must call it, it is declared `abstract`
  there (the compiler says so). Fields are declared only in `manager-core.ts`: a field in a later layer would be
  initialized after the core constructor already ran.
- A new IPC channel goes in its area's `src/shared/contract/<area>.ts` (its `<Area>InvokeMap`) and its handler in the
  group of its prefix; a new prefix is added to one group's `HandlersOf` list.
