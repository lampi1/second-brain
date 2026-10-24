<!-- Voice mode in the Orchestrator and Flash: local, free speech in and out; owner 2026-10-24. -->
# 0152 — Voice mode: talk to the Orchestrator and Flash, hear the answers

Date: 2026-10-24

## Context

The owner (2026-10-24): «voglio … parlare al posto di scrivere il prompt solo nell'Orchestrator e su Flash», «togli la
label invio … per fare spazio al microfono», «il classico pallino rosso», then «o microfono muto oppure modalità full»:
the app listens all the time, answers aloud in proper Italian, reads its questions and takes a spoken answer «tanto
quanto un click». Not now: the app speaking on its own initiative (recaps). The tools must be the best free ones.

## Decision

- **Two states only**: muted, or voice mode. Ctrl+M (or the mic button that replaced the «Invio» hint in the
  Orchestrator's and Flash's inputs) toggles. On: a red frame, a steady red dot «In ascolto», volume bars while the user
  talks, «Trascrivo…», «Ti sto rispondendo» (Esc silences). Each utterance is sent to that chat as the user's message;
  the chat's reply to it is read aloud (`replyToSpeak`: only turns that follow the user's own message since voice went
  on, never one the app or another chat started). While the app speaks the microphone is ignored (no echo loop).
- **Questions by voice**: a question card on screen registers with `useVoiceQuestion` (renderer `lib/voice.ts`). In
  voice mode the app reads it, the bar says «In ascolto della tua risposta», and the next utterance goes to the card,
  never to the chat: a short yes / no / «non voglio rispondere» is the click, a longer sentence is the written answer.
  Several open: the newest first, the next is read when it closes. A card is the app's question, so it takes the words
  whichever input the mic belongs to (Orchestrator or Flash); while one is open nothing said reaches the chat. A reply that ends while a question waits stays in
  the chat, unread.
- **Engine: sherpa-onnx** (`sherpa-onnx-node` 1.13.8, Apache-2.0, prebuilt for win-x64): Silero VAD cuts the 16 kHz
  stream into utterances, **Whisper** transcribes in Italian (Veloce = small int8, 374 MB; Precisa = turbo int8, ~1 GB),
  **Piper** speaks (Italian voices Paola, Miro, Dii; Paola default: the owner wants a female voice, Paola is one Italian speaker, dataset paolapersico1/Voice-Dataset-Italian; «Prova» lets him check). All local and offline: audio never leaves
  the PC and is never written to disk. Kokoro was set aside (its own VOICES.md grades its Italian voices C); voices
  with clearly better quality (VoxCPM2, Chatterbox) need an ~8 GB GPU and a Python stack, a possible later option.
- **Own process**: the engine runs in an Electron utility process (`main/voice/worker.ts` → `out/main/voice-worker.js`).
  sherpa-onnx ships its own onnxruntime, which must not share a process with the hybrid search's onnxruntime-node
  (same DLL name on Windows), and its CPU work stays out of main's event loop.
- **Models downloaded once, pinned**: `main/voice/catalog.ts` lists every file with its source and hash — Hugging Face
  files by commit and sha256 (or the git blob id for the small vocabulary file), the k2-fsa GitHub release archives by
  the sha256 GitHub publishes. A mismatch deletes the file; a part gets its `.ok` marker only when all its files pass.
  `.ok` holds the hashes it vouches for, so a catalog change makes the part missing again and it is fetched clean.
  Downloads run beside the transcribe/speak queue (voice keeps working meanwhile); a speech request times out at 30 s.
  The first Ctrl+M downloads what is missing (Settings → Voce shows progress and has «Scarica» and «Prova»).
- **Permission**: the app window grants `media` only when it asks for audio alone, from the app's own page
  (`window.ts micAllowed`); camera, screen capture and everything else stay refused. The request layer's view (overlay.ts)
  has its own in-memory session (`partition: 'overlay'`) with its deny-all handler: on the shared default session that
  handler replaced the window's and the microphone was refused everywhere (fixed 2026-10-24, e2e `mic-permission.spec.ts`).
- Settings `voiceAsr` (fast | accurate) and `voiceName` (paola | miro | dii), not protected: local and free.
- `SB_VOICE_FAKE=1` (and the demo) swaps the engine for a fake that "hears" one sentence per session: e2e
  `test/e2e/voice.spec.ts` (runs on main, per ADR 0027).

## Dependencies

- `sherpa-onnx-node` 1.13.8 (+ its per-platform optional package, copied to `out/node_modules` by `scripts/build.mjs`):
  speech recognition, VAD and TTS in one well-known package, no install scripts.
- `seek-bzip` 2.0.0 (pure JS, MIT): unpacks the Piper voices' `.tar.bz2`; bundled into the voice worker.

## Consequences

- First use costs a one-time download (about 440 MB with Veloce + one voice) and some CPU while transcribing.
- Speed on the owner's PC is not measured yet: the Linux container cannot download the models. Veloce is the default.
- The decision card (ADR 0150) registers with `useVoiceQuestion` itself (since ADR 0154's change): every question,
  plan and approval it draws is read and answered by voice; a request shown twice (its strip and the questions window)
  shares an id and is read once.
- Which microphone (owner, 2026-10-24: «vorrei anche che rilevasse il mio microfono usb»): Settings → Voce lists the
  PC's inputs and follows plug / unplug (`devicechange`, `src/renderer/lib/mic.ts`). A microphone plugged in while the
  app runs is used at once (toast with «Annulla»), voice mode reopens on it; an unplugged choice falls back to the
  system default and comes back by itself (matched by id, else by name). Call recording uses the same choice; a call
  keeps its microphone until it stops. The choice is per PC (device ids are), so it is kept in localStorage, not in the
  brain's settings. Pinned by `test/unit/mic.test.ts` and `test/e2e/mic-permission.spec.ts`.
