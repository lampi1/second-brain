# 0216. OpenCode as a built-in ACP engine

Date: 2026-10-31. Status: accepted.

## Context

The owner (2026-10-31): «procedi con l'integrare il supporto con open code». OpenCode (https://opencode.ai) is an
open-source coding agent that reaches many providers with the user's own keys, OpenRouter included. It speaks the Agent
Client Protocol with `opencode acp` (https://opencode.ai/docs/acp), the protocol the app already speaks with Cursor
(ADR 0010, 0046). Kimi left the engine list earlier (only Claude, Codex and Cursor stayed); the owner now asks for
OpenCode explicitly.

Checked against OpenCode 1.19.5 on a real `opencode acp`:
- initialize: `loadSession`, http and sse MCP, image prompts; auth method "Run `opencode auth login`".
- session/new and session/load answer no `models` and no `modes`, only `configOptions`: `model` (category model, every
  `provider/model` id the user's providers offer), `mode` (category mode: build, plan) and, once a model has one,
  `effort` (category thought_level).
- session/set_config_option on `model` changes the model of that session only (its global config file is not written);
  session/load goes back to the default model.
- usage_update carries the context size and the session cost in USD.

## Decision

- OpenCode is a built-in engine of the registry: `opencode acp`, login `opencode auth login`, off in a fresh install
  (Settings → Motori turns it on). It runs on the same ACP adapter as Cursor, with none of Cursor's extras.
- A new engine flag `modelOption`: the chat's model is set on the session's model option after every open (new or
  load), and the models listed there are the chat's model choices. A model it does not offer, or refuses, is the same
  visible warning as for Cursor. Cursor keeps `--model` at spawn and never gets a session model call (it would write
  its global config).
- An engine that offers its modes only as a config option (OpenCode) gets plan and back to work (build) through that
  option; read-only runs and agents capped at plan use it the same way.
- A model change still reopens the session (ACP engines have `liveModel: false`); the reopen sets the model again.
- The first-run setup still offers only Claude, Codex and Cursor; OpenCode is turned on from Settings.
- All ACP engines remain once-only, including unrestricted OpenCode roles: they still have app hard-deny gates.
  OpenCode 1.19.5's [ACP handler](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/acp/permission.ts)
  does not forward the upstream `always` patterns to the client or offer a per-execution veto after a cached grant.
  Its [shell collector](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/tool/shell.ts) and
  [arity table](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/permission/arity.ts) turn a normal
  push into `git push *`; [permission reply/evaluation](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/permission/index.ts)
  stores that allow in instance state and skips `Asked` for matching later commands, including force push. Session
  scoping alone would not make this safe. Never send `allow_always`, even for a stale client's explicit always answer;
  the warning explains skipped app checks, not an OpenCode global-config write. Cursor also stays once-only.
  This prevents the app from creating bypassing grants; it cannot intercept operations a user's existing upstream
  configuration already allows. No CLI configuration file is written and build/plan remains a working-mode picker.
- Permission requests retain their ACP `locations` even when an earlier tool update supplied no `rawInput`.
  Otherwise its cached empty input hides the paths from the existing local-work permission gate, prompting for
  reads inside the workspace. Locations supplement raw input; role ceilings and outside-workspace checks still apply.
  This does not introduce an OpenCode permission mode or automatically accept arbitrary engine permission requests.
  Repeated approval prompts beyond this locations fix remained unresolved here (now: [ADR 0232](0232-opencode-auto-permissions.md)): disabling unsafe upstream grants is a safety
  boundary, not a complete solution to repeated prompts. Tests simulate the upstream wildcard cache without executing
  shell commands; real-engine end-to-end behavior and low-tier model reliability still need live verification.

## Consequences

- OpenRouter (and any other provider OpenCode knows) is usable as a tool-using agent without a new HTTP adapter.
- The cost comes from OpenCode's own usage_update; the login status is not read (OpenCode has free models without a
  login), so Settings shows it as unknown.
- Not verified here: a full turn on a real model (this container has no provider access). The handshake, the model and
  mode options and session/load were checked on the real CLI; the turn itself is covered by the fake's OpenCode shape
  (test/fixtures/fake-cursor-acp.mjs, FAKE_ACP_OPENCODE=1).
