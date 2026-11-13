# ADR 0290 · A Claude chat starts in «default»: the app answers its requests, not the engine's own default mode

Date: 2026-11-13 · Status: accepted (owner, thread «Preparare la 1.0 con analisi profonda», card «Scegli chi decide
i permessi nelle chat dei ruoli»: «Decidono le regole dell'app», then «meno blocchi ho meglio è… tutti devono poter
fare tutto se non ci sono regole nel brain tipo le mie di prod») · Amends: ADR 0002 (the mode a Claude chat is
launched with), ADR 0254 (allow by default; how much of a request the rules read), ADR 0085 (a role's ceiling)

## Context

ADR 0254 made the app answer every permission request itself: everything passes unless a rule of the user's brain
holds it. That holds only when the request reaches the app. The app passed `--permission-mode` to Claude Code only
when a chat had a mode of its own, and almost none has one, so the chat ran in the user's own engine default.

Counted on the owner's PC (2026-10-30 to 2026-11-13, counts only):

- 889 of 900 chats were created with no mode; his Claude Code default is «auto».
- About 600 tool calls were refused by the engine's auto-mode classifier before the app was asked (credential
  materialization 65, external system writes 50, modify shared resources 36, self-modification 30, and others).
  128 of the 136 sessions with a refusal were in «auto», 8 had no mode recorded.
- 21 of 66 «blocked» run reports named a permission or the classifier.

His production rules do not come from that classifier: they are his brain's own (its hooks and guards, which run
in every mode, and the policy file the app reads, `permissions.json`, where a brain has one).

## Decision

1. `ChatManager.launchMode`: a Claude chat with no mode of its own starts in «default», for every chat of the app
   (roles, the Orchestrator, plain chats). There each request reaches the app's answer (`chats/auto-permit.ts`),
   which lets it through unless one of these holds it: a rule of the user's policy; a policy file that is there but
   cannot be read; the role's own limit or a tool class the role lacks; the settings-and-hooks guard, which also
   holds an edit that names no file; a plan to approve (ExitPlanMode); a request too long for the policy to read
   whole. ADR 0002 had dropped a forced «default» because every command then asked the user: now the app answers,
   so it does not.
2. A mode the user picks on the chat wins, «auto» and «bypassPermissions» included. The engine's own default stays
   when it is «plan» (it asks for less than «default»), a mode the app does not know («dontAsk») or settings the
   app cannot read (`claudeDefaultSetting`): there the user asked for less, or the app cannot tell.
3. A waiting engine (started before a chat needs it) starts with no mode, as before, and gets the chat's launch mode
   when a chat takes it: started in «default» it would have left a user whose default is «plan» out of plan.
4. This default is not a choice. What bounds a chat's children stays the user's choice or the role's ceiling
   (`modeFor`, exposed as `chosenMode`): `agent_assign_task` now reads it instead of the mode the engine reports, as
   the creation of a child always did. Otherwise a parent started in «default» would have refused to reuse its own
   children. A parent the engine reports in «plan» still bounds the child it reuses. This reading is the same for
   a parent on any engine. A «default» the user picks on a chat bounds no child either (`boundMode`): the app answers
   that chat's requests without asking, so the pick narrows nothing for the chat itself; a role limited to «Chiede
   conferma» still bounds its children, through its policy.
5. For Claude the app decides on the input as the engine sent it (`sink.pending(req, whole)`, through the runtime
   host too); the copy shortened for the screen (`trimInput`, 4000 characters a string) is only what a panel shows.
   Before, a shortened input always went to the user: with every Claude request now reaching the app, each long
   Write or Edit would have become a panel. On a whole input the signs of a cut (a string ending «… (+N)», a list of
   200) are plain content. Codex and the ACP engines still send only the short copy.
6. The rules of `permissions.json` read up to 100 000 characters of each part of a request (ADR 0254 read 20 000
   of the whole). A file's text is in what they read twice, as text and inside the JSON: under a rule on all tools
   (the owner's «mail-teams») every Write of about 10 000 characters counted as «longer than the rules read» and
   asked the user. Now only a part over the limit asks. A pattern still reads the parts as one text, so a rule
   means the same on a short and on a long request (`policyRead`).
   The rules run in the main process and a pattern cannot be stopped, so they have a time budget: 250 ms for one
   request, and on a text over 20 000 characters each pattern is first timed on every 20 000 characters of it; when
   the whole text would take over 250 ms at that pace (a pattern that goes back over the text scans from each match
   to the end, so a slow stretch weighs as much as the text after it is long), the app stops and asks. Measured on
   the owner's example rules with texts made to be slow («psql», «prd», «swap» or «mail» thousands of times, from
   the start or after 20 000 plain characters): the app asks after 40 to 320 ms at 99 000 characters, where reading
   on took up to 5.6 s; the slowest case found is 534 ms, at 20 001. An ordinary file or command of 90 000
   characters is read in 8 to 33 ms. On a machine with every core busy, 3 of 2000 ordinary 98 KB files asked for
   time alone.
   The settings-and-hooks guard reads every place a tool names, however long and on however many lines (it read
   one-line values up to 1000 characters): `./` thousands of times before `.claude/settings.json`, or a line break
   before `/..`, reaches the same file in a tool that tidies the path.
7. Other engines are not touched: their modes mean other things (a Codex «default» is a read-only sandbox).

## Consequences

- What the classifier refused (credentials written to a file, a write to an outside system, a merge without a
  review) now passes when no rule of the brain holds it. This is the owner's choice; a user who wants the classifier
  picks «Automatico» on the chat.
- A user whose Claude Code default was «acceptEdits» or «bypassPermissions» also gets the requests of their chats
  answered by the app, not by that mode: the brain's rules and a role's limit then hold there too.
- Each write and command of a Claude chat costs one round trip to the app, answered at once.
- A chat's tile shows no mode badge («default» has none) where it showed the engine's, «auto» for the owner. The ⋯
  menu marks «Chiedi ogni volta»; picking the mode a chat already runs in changes nothing and stores no choice.
- To read after a week of use: refusals with «auto mode classifier» in the transcripts (was about 600 a month),
  and «blocked» reports that name a permission.
