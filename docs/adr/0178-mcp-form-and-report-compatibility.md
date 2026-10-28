# 0178 — Accept supported MCP forms and recover harmless report shape errors

Date: 2026-10-28. Status: accepted. Issues: #253, #257, #258, #259.

## Decision

Claude MCP elicitation maps flat schemas with up to eight string, enum, numeric or boolean fields to the
existing question panel. Answers are validated and returned with their declared primitive types. Optional
fields can be omitted; defaults never answer a request. Empty schemas retain the existing explicit confirmation.
Unsupported schemas, URL mode and recognized credential fields remain cancelled with an explanation.
No persistent permission is created. The live app guide documents the input route and approval boundary.
Every form step shows its server, request message and field constraints. The user can decline while editing,
typed booleans do not use narrative decision shortcuts, and text values retain explicit empty strings and spaces.
Credential detection includes field descriptions and the server message. A rejected submission can restart
from the first field rather than retaining an invalid earlier answer.
The Orchestrator's question relay cannot answer these forms: its narrative prefix would corrupt typed values
and it must not replace an explicit external confirmation in the user's panel.

`agent_report` advertises its existing summary limit. Overflows of at most ten percent are shortened only
at a word boundary with a warning; top-level `evidence` is ignored with a warning directing the caller to
`output` or individual `doneWhen` entries. Other unknown keys, missing completion criteria and independent
review authority remain strict. Canonical output and criterion evidence are preserved.

`show_ui` advertises title, summary and brief field limits in its input schema. Brief errors contain every
detected problem and a complete minimal example. Existing single-string `done` normalization remains supported.

The automatic recurring-error writer was already disconnected on main. Keep it disconnected. Its legacy
helper now accepts only full explicit reusable prevention rules and counts distinct date/chat occurrences,
never turns truncated observations into instructions. The active approved-lessons job applies the same
memory-worth gate as report memory. Research context distinguishes configured consumers from actual use;
`loaded none` cannot be presented as an improvement in behavior. Existing user rule files are not rewritten.

## Validation

Unit tests exercise the fake Claude protocol, typed form constraints, report completion guards, brief errors,
reusable lesson filtering and the live guide. A question-panel e2e with screenshot is added to `chats.spec.ts`;
per repository policy it first runs on main after merge. A hidden Electron visual launch was attempted here
but the execution environment denied Chromium's Unix socket creation before the window opened; this is not
a completed visual check. No runtime dependencies were added.
