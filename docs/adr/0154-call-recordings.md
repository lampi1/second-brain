<!-- Call recordings with local transcripts, read by the Orchestrator; owner 2026-10-24. -->
# 0154 — Call recordings: PC audio + microphone, transcribed on the PC, known to the Orchestrator

Date: 2026-10-24

## Context

The owner (2026-10-24): «avviare una registrazione sia dell'audio del computer che del microfono per le call su Teams …
in modo che si salvi già un file dentro l'app … e così poi basta che chieda all'orchestrator voglio fare questo bug»,
«l'app in generale sa che deve andare a vedersi la registrazione», «a zero token». Where the transcripts live: his
choice on the decision card, «Solo sul PC (dati app)», not the brain.

## Decision

- **Recording** (renderer `lib/recorder.ts`): «Registra call» (Registrazioni page, the palette, the REC pill in the
  top bar that stays on every page with the timer and ■) opens the microphone and asks `getDisplayMedia` for the PC's
  audio. Main hands it out (`window.ts` `setDisplayMediaRequestHandler`) only within 5 s of `rec:arm` (the click; main cannot see the click itself, the renderer is the app's own trusted page),
  only to the app's own page, with Windows' `loopback`; the screen video it must carry is stopped at once and never
  stored. The two go into one stereo stream, left = microphone («Tu»), right = PC («Altri»), downsampled to 16 kHz and
  sent as 16-bit chunks once a second (`rec:chunk`). Without the PC's audio (refused, not Windows) the call is the
  microphone alone (mono, speakers not told apart) and a toast says so. Voice mode is turned off while recording and cannot be turned on until it stops. If the page reloads or its process dies mid-call, main closes the recording (a call is saved and transcribed, an import cut short is dropped); the downsampler keeps its fractional position so hours keep their exact length.
- **Storage** (`main/recordings/store.ts`): `userData/recordings/<id>/` holds `meta.json`, `audio.wav` (written as it
  arrives: a crash loses at most a second; the next start fixes the header and transcribes it, an unfinished import is dropped). Deleting renames the folder first, so a file still held on Windows never leaves half a recording, `transcript.json` and
  `trascrizione.md`. About 230 MB per hour of call; a call stops by itself at 8 hours.
- **Transcription** (`voice/transcribe.ts` in the voice process, ADR 0152): one recording at a time, queued at the
  stop. Each channel gets its own Silero VAD, which keeps only where speech starts and how long it lasts; each segment
  is read back from the file and given to Whisper (the model chosen in Settings → Voce) through the same queue as voice
  mode, so both work at once. Memory stays at one 10 s block plus one segment. On speakers the microphone also hears
  the call: a «Tu» line that says what an «Altri» line says at the same time is dropped (`dropEchoes`). Zero tokens.
- **Import**: «Importa un file audio/video» or «Trovate sul PC» (audio and video of the last 30 days in Downloads,
  Documents, Videos, Music, Desktop, Windows' Sound Recorder folder and OneDrive's Recordings/Registrazioni, where Teams
  usually saves meetings). The renderer decodes the file (WebAudio, 16 kHz mono, up to 500 MB: the bytes cross IPC once and the decode is in memory) and stores it like a
  call. Main reads back only a path the search just listed (`rec:readFound`).
- **The Orchestrator** (`appctl/recordings.ts`, only on its own endpoint: a call is private): `app_recordings` lists
  them and reads a transcript (whole, in parts, or only the lines with some words), with `pc=true` the files not
  imported yet; `app_recording_import` imports one of those (ui:command `recImport`). Its description says to look there
  when the user mentions a call (the role text has no room: its size is capped). «Chiedi all'Orchestrator» on the page drafts a message that names the recording.
- **Voice answers on the decision card** (ADR 0150): `DecisionCard` registers with `useVoiceQuestion` itself.

## Consequences

- Speed of the transcription on the owner's PC is not measured: the container cannot download the models. A long
  call may take minutes; the page shows the progress.
- Telling apart the other participants among themselves (speaker diarization, also in sherpa-onnx) is left for later.
