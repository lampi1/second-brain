# ADR 0333 · Role chats with the web class may run Claude's built-in web-fetch agent

Date: 2026-11-22 · Status: accepted (owner, via the Orchestrator 2026-11-22: «è fondamentale che l'app possa fare
ricerche in internet senza dover aprire un browser») · Amends: ADR 0083/0090 (which engine sub-agents a role may run)

## Context

A Scout chat (Claude, Code Mode on) had the `web` class, so its launch listed `WebFetch` and `WebSearch` in `--tools`
(`agents/tool-policy.ts` CLAUDE_TOOLS). It still had no WebFetch tool: Claude Code (checked on 2.1.322) drops its own
WebFetch from a session's tool list when the session has the Agent tool and the built-in `web-fetch` agent is usable,
and reads pages only through that agent (`subagent_type: "web-fetch"`, its one tool WebFetch). A role with every tool
class gets the Agent tool (claudeTools), and with it the app's PreToolUse hook `SubagentGate` (`agents/role-gate.ts`),
which refused every sub-agent but Explore: so «Sub-agent web-fetch refused», and the chat fell back to the app browser.
WebSearch stays a native tool (deferred behind ToolSearch); Code Mode hides neither it nor Agent (`CODE_MODE_HIDDEN`).

## Decision

1. `subagentRefusal` lets `web-fetch` through when the chat may use the web: in the PreToolUse hook, its policy
   (already narrowed by its parent's, `belowParent`) has `web`; in the permission gate, its policy and its parent's both
   allow `web`. A role without `web` stays refused. The WebFetch calls inside the agent still pass the app's gates.
2. Not when a custom agent takes the name: Claude Code names an agent by its frontmatter `name`, compared after NFKC,
   lower case and without spaces, dashes or underscores, whatever its file is called. Every `*.md` under the user's
   Claude `agents` folder and under `.claude/agents` of the chat's folder and each folder above it is read; one with
   that name, an unreadable one or a scan past its bounds (500 files, 4 levels) refuses the exemption: that agent
   would replace the built-in one with whatever tools, prompt and settings it declares. A loose spelling of the
   built-in name (`WebFetch`, `web_fetch`) passes like `web-fetch`, as Claude reads it the same way.
3. Code Mode needs nothing more: the Agent tool and WebSearch stay native there.

## Consequences

Every Claude work chat with the `web` class reads pages without the app browser, Code Mode on or off; one without the
Agent tool keeps Claude's direct WebFetch as before. Pinned by `test/unit/agents/role-gate-web-fetch.test.ts`.
