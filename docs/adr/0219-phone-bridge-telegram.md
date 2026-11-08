# 0219. Phone bridge: the Orchestrator through a private Telegram bot

Date: 2026-11-05. Status: accepted (design approved by the owner, 2026-11-05); built in parts, part 1 = the foundation.

## Context

The owner wants to reach the Orchestrator from the phone when he is away from the PC: write or dictate a request, read
a short answer, answer the simple yes/no questions that block his chats. The app had no phone, push or remote channel
and no decision for or against one. What exists already: `ChatManager.send` as the entry of a user message,
`onTurnEnd(info).reply` as the Orchestrator's answer, `pending:added` for questions and permissions, Strategist plans
in `r.s.plan`, safeStorage-encrypted secrets (the engines' `SecretStore`, the Connettori tokens of ADR 0086), local
speech-to-text from a 16 kHz WAV file (ADR 0152) and WebAudio decoding in the page (`lib/recorder.ts`). The main
process did not know which chat is in Focus. Closing the window closes the app: there is no background mode.

## Decision

1. **Channel.** A private Telegram bot the owner creates with BotFather. The main process long-polls
   `api.telegram.org` (`getUpdates`, outbound HTTPS only, `deleteWebhook` at start) with the global `fetch`: no new
   dependency, no inbound port, no tunnel, the renderer's CSP unchanged. Only that host is called.
2. **Stable instance only.** The bridge runs only in the stable copy; the dev instance shows the page with the state
   `dev-disabled` («Solo istanza stable») and never polls: two pollers on one token steal each other's updates.
3. **Token.** Its own encrypted slot (`src/main/phone/token-store.ts`, `userData/phone-token.json`), modelled on the
   Connettori tokens, not the engines' `SecretStore`. Typed by the owner in Impostazioni → Telefono, write-only: it
   travels renderer → main once on `phone:set-token` and is never returned, shown or logged; the shape is checked
   (`<digits>:<30-64 url-safe chars>`); `addRedaction` (src/main/log.ts) runs whenever it is set or loaded, because the
   token is part of every request URL (`/bot<token>/…`): logs carry only the method name. It is never given to an
   engine, chat, agent, tool or file. Rule 2 lists it as an exception.
4. **Authentication.** Pairing: the PC shows a one-use 6-digit code that expires; the owner sends `/start <code>`
   from a private chat; the app keeps that one Telegram user id. Every update from another id, a group or another
   update kind is dropped silently and only counted. Unpair and «Cancella token» are on the PC only; `/stop` from the
   phone switches the bridge off until it is turned on again on the PC; `/pausa` and `/riprendi` hold the outbound
   messages.
5. **Approval boundary.** From the phone the owner answers only simple yes/no questions and Strategist plans, with
   inline buttons bound to that request, that Telegram message and a one-use nonce. Never permissions, commands,
   workflow proposals or anything touching production, deploys, pushes, secrets or messages to people: those arrive as
   «Serve il PC» without buttons. Text typed on the phone never approves anything (a new task source `phone` that
   skips the typed-approval path). Each answer records the actor `phone`.
6. **Outbound filter.** One filter on every outgoing text (answers, questions, options, titles, voice echo,
   `/stato`): secrets masked, code blocks and commands replaced by a placeholder, links reduced to their domain, chat
   and work item titles replaced by role + neutral label, customer-data patterns masked. Answers condensed without
   tokens (about 600 characters, «Continua sul PC»).
7. **Voice notes.** Downloaded in memory (max 5 minutes, 20 MB), decoded in the page (WebAudio `decodeAudioData`,
   OfflineAudioContext, resampled to 16 kHz mono PCM16 WAV: `src/renderer/lib/phone-voice.ts`) on the
   `phone:decode-request` / `phone:decode-result` pair, never through `rec:start` and never as a recording; transcribed
   locally by the existing voice engine from a temporary WAV removed right after.
8. **Focus and quiet hours.** The page tells main which chat is in Focus (`focus:changed`), so the phone gets only what
   Focus lets through on the PC; quiet hours (default 22-7, optional) send non-urgent messages silently. Production
   and urgent items always ring.
9. **Contract and parts.** `src/shared/contract/phone.ts` is the fixed interface between the parts built in parallel
   (foundation; client, guard, pairing, filter, bridge; the chats port and the `phone` task source). The phone IPC
   channels live in their own typed maps (`src/shared/contract/phone-ipc.ts`, `window.sbPhone`), registered by
   `main/ipc.ts` with the same sender check; until the wiring sets the real bridge a disabled controller answers with
   the state `off`.

## Consequences

### Sole-conversation amendment (2026-11-08)

Every worker request, including a descendant and a Strategist interview/plan, is presented as an Orchestrator
request with the original worker attribution. Question context and option consequences are carried to the existing
outbound filter. Existing button nonces still select the original chat/request; the coordination journal records
the paired owner's answer before the correct engine resumes. Unsupported or reserved operations stay pending in
the Orchestrator desktop panel. Agent prose, including quoted owner answers or a later unrelated owner message,
cannot be used with `app_resolve_question` to manufacture consent.
Canonical outcomes have a host callback independent of model turns. Corrections edit the same acknowledged
Telegram message; uncertain sends remain uncertain. Live phone-network behavior still needs an owner-coordinated
check; dev captures and fake transport tests do not claim a real Telegram validation.

- The trade-off, accepted by the owner: Telegram bot chats are not end-to-end encrypted, the texts sit on Telegram's
  servers, and the bridge runs on a work PC. The filter reduces what leaves, it does not make it zero: a customer or
  patient name written in prose can pass, and a lock-screen preview would show it. Mitigations: «no customer data» in
  every phone turn's instruction, production answers only on the PC, notification previews off on the phone (the
  owner's checklist step).
- The Telegram user id proves the account, not the device: two-step verification and Telegram's passcode lock are the
  owner's checklist steps; `/stop`, a rate limit and the last 20 phone actions in Settings are the app's.
- With the PC off or the app closed the bot is silent; Telegram keeps updates for 24 hours, and each one found at
  start is asked with yes/no, never run by itself.
- A new rule-2 exception to keep honest: the token never leaves the main process except in the request URL to
  `api.telegram.org`.

## Da verificare

- A real bot end to end (part 1 never calls Telegram; the tests use fakes).
- That the corporate firewall or proxy lets `api.telegram.org` through; the app has no proxy handling, the page shows
  the error.
- That Electron's Chromium decodes Telegram's OGG/Opus voice notes with `decodeAudioData` (the code path is unit-tested
  with a fake decoder only).
- Whether HS1 IT policy allows Telegram from the work PC (owner's decision).

## Alternatives

- Webhook or a tunnel: needs an inbound endpoint on a work PC; rejected.
- ntfy, push services, e-mail: one-way or another third party with the same privacy cost and no buttons.
- A notification-only v1 (no free text, only «there is a question: Sì/No»): kept as the fallback if the trade-off is
  revisited.
