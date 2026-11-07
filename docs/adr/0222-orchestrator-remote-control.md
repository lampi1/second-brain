# 0222. «Controllo remoto»: Claude Code Remote Control of the Orchestrator

Date: 2026-11-07. Status: proposed (built by an Artisan on `feat/orchestrator-remote-control`; the owner decides the
merge).

## Context

The phone bridge of ADR 0219 calls `api.telegram.org` from the main process, and the work PC's endpoint protection
kills the app when it does. The owner still wants to continue the Orchestrator from the phone. Claude Code has its own
channel for this, Remote Control: the running engine registers the session with claude.ai and the phone (Claude app or
browser) continues it at a `claude.ai/code` link. The app's Orchestrator already runs Claude Code as an embedded
`claude.exe` in stream-json mode, so the bridge can be asked of that same process.

The request is not in the Agent SDK's `sdk.d.ts`. It was read from the embedded engine (2.1.283) and checked live with
a probe outside the app (a real session link came back):

- stdin `control_request {subtype:'remote_control', enabled, name?, reattach_session_id?}`;
- the success reply when on: `{session_url, connect_url, environment_id, bridge_epoch, bridge_session_id}`; off: an
  empty success; refusals are error replies with the engine's words ("Remote Control initialization failed", "cannot be
  enabled from inside a remote session", a policy refusal);
- `system/bridge_state {state: ready | connected | failed | policy_disabled, detail?}` while it lives;
- with `--replay-user-messages` every user message the engine queues is echoed with `isReplay: true` and the `uuid`
  the host sent; a message typed on the phone comes back with no uuid of the host's. Without the flag the phone's
  messages never reach the host's stdout.

## Decision

1. **Same process, on demand.** The request goes to the Orchestrator's own engine (`ClaudeSession.setRemoteControl`,
   a control request like `rename_session`, 60 s timeout because the engine registers with claude.ai first). No
   second `claude` process on the session and no `remoteControlAtStartup`: it is on only after the owner's click.
2. **Only the Orchestrator, only Claude.** The button «Controllo remoto» (a phone icon) sits on the Orchestrator's head
   and shows only for a Claude Orchestrator; `chat:remoteControl` refuses any other chat. There is no agent tool: the
   bridge exposes the session outside the PC, so only the owner's click turns it on. `app_guide` says where the
   button is.
3. **State in the contract.** `ChatSummary.remoteControl {on, url, bridgeSessionId, status, error?}` with status
   `starting | ready | connected | paused | failed | off`. Only a `https://claude.ai/code…` link is accepted and shown;
   anything else is drift (`drift.ts`) and an error, never a link. Unknown `bridge_state` values go to drift too.
4. **Survives a restart.** The wish and the bridge id are saved with the chat (`chats.json`, always as `paused`). The
   next engine of the Orchestrator (app restart, crash, the 20 s prewarm) sends `reattach_session_id` with the saved
   bridge, so the phone's link keeps working; if the engine refuses the reattach or does not answer in 60 s, the
   bridge is asked once more without the id (logged as a warning): a gone bridge gives a new link, a slow engine may
   hand back the same one (seen live on a PC at 100% CPU). A `bridge_state failed` turns it off with the reason; the
   owner turns it on again.
5. **The phone's messages in the app.** The Orchestrator's engine runs with `--replay-user-messages`; every message the
   app sends carries a uuid it remembers. A replayed message that is not the app's, not meta or synthetic, not a tool
   result and not a system reminder shows as a user message marked «dal telefono» (`via: 'phone'`, the same marker as
   ADR 0219). Permission questions reach the phone through the engine itself and are withdrawn on the PC with the
   existing `control_cancel_request` handling.
6. **No QR code.** No QR library is in the dependencies and rule 3 asks for an ADR line per new runtime dependency:
   the line under the head shows the link, «Copia link» and «Spegni», and says there is no QR code.

## Consequences

- The Telegram bridge (ADR 0219) is untouched; this channel needs no new host from the main process (the engine talks
  to claude.ai as it already does).
- The protocol is undocumented: a change in a later engine shows as drift in the logs and as an error on the button,
  not as a wrong link.
- Messages typed on the phone are not approvals of anything in the app: they are turns of the Orchestrator, like the
  owner typing at the PC; the engine's own permission prompts stay the engine's.
- What only the owner can check: opening the link on the phone and typing a message (`claude.ai` login on the phone).
