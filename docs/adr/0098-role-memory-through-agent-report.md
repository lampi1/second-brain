# ADR 0098 · Role memory reaches Claude chats and is written through agent_report

Date: 2026-10-20 · Status: accepted (owner, project thread "memorie degli agenti") · Amends: ADR 0077 (one memory per
agent, written by the product memory CLI)

## Context
The owner saw a role chat work a whole day and write nothing to its memory. Cause, in the code: `wiring.ts`
`resolveAgent` gave Claude role launches only the role text and the qualified skill names; the pack runtime text
(`agents/pack/flows.ts runtime().instructions`), which carried the memory, the role's id and the "add a line" hint,
reached only Cursor. A Claude role never saw its memory nor the id the CLI needs, so it could not write. On Cursor the
write needed a shell call with a path the role had to assemble, at no defined moment.

## Decision
- `runtime()` returns the memory block (`memory`: shared memory, the role's own memory, the hint) and `wiring.ts` adds
  it to Claude launches too.
- `agent_report` takes an optional `remember` (up to 3 single lines, 300 characters each): facts about this user's
  setup a future run of the role would otherwise rediscover. The app writes them to `agents/<id>/memory.md`
  (`rules/memory.ts writeAgentMemory`) only after the report is accepted; the role id is the chat's own, never an
  argument. No shell call, no permission prompt. The CLI `agent` command stays for scripts.
- A stored chat keeps up to 16384 characters of role text (was 8000 off Cursor), so the memory block does not drop the
  role text after a restart.

## Consequences
- Cost: the block is in the cached system prompt; at most ~6k characters (4000 own + 2000 shared), about 1.5k tokens
  when full, near zero when empty.
- Lines a role writes come back in its later launches: a lasting input like any brain file; control characters are
  refused, each line is dated and prefixed, and the maintenance (`merge-memory`) and the Memoria page show them.
