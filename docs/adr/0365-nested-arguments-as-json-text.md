# ADR 0365 · A nested argument may come as its JSON text; a null where a value was wanted is named in the error

Date: 2026-11-25 · Status: accepted (issue #487: Cursor + Gemini send nested objects and lists as null) · Amends: the app's
MCP server `tools/call` (`src/main/mcp/server.ts`)

## Context

- A Strategist chat on the Cursor engine with Gemini calls the app's tools through `CallDynamicTool`, which sends nested
  objects and arrays inside the arguments as `null`: `agent_delegate`'s `tasks[i].contract` and `show_ui`'s `props.done`.
  `agent_delegate` failed every time with `contract: object required.`, so such a chat could delegate nothing. Flat tools
  (`plan_propose`, `ask_user`, `agent_report`) worked.
- The data is lost before it reaches the app: nothing on the app's side can rebuild it. Text does pass.

## Decision

1. **A nested object or list may come as its JSON text** (`src/main/mcp/json-args.ts` `schemaArgs`): where the tool's
   schema wants an object or an array (not a string), a string holding JSON of that kind is read back before the tool runs,
   at any depth (properties, items, anyOf / oneOf). A string where the schema wants text, or text that is not JSON of the
   wanted kind, is left as it came.
2. **A null where the schema wanted a value is named in the tool's error**: if the tool then fails, its error ends with the
   paths that arrived as null (`tasks[0].contract`) and how to send them as JSON text. The engine's next call carries the
   value and works. Null elements of a list the schema does not describe are named too.
3. Nothing changes for an engine that sends nested arguments as they are: the same objects reach the tool.

## Consequences

- Strategist chats on Cursor/Gemini delegate again after one failed call, with no change to the tools or their texts.
- Pinned by `test/unit/mcp/json-args.test.ts`. Untried on a real Cursor + Gemini chat.
