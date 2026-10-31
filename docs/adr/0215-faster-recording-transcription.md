# 0215. Faster recording transcription: fewer, longer pieces for Whisper

Date: 2026-10-31. Status: accepted.

## Context

The owner (2026-10-31): recordings are «troppo lento nella trascrizione». A recording is cut by Silero VAD into speech
pieces, and each piece went to Whisper alone. sherpa-onnx adds 1000 frames (10 s) of silence after each piece and caps
the input at 3000 frames (30 s), so the end-of-text token can be found:
https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/offline-recognizer-whisper-impl.h
(`tail_padding_frames = 1000`, `max_num_frames = 3000`). A 2 s sentence therefore costs the encoder 12 s of audio,
and a call made of short sentences costs several times its length.

## Decision

- `mergeSpans` (main/voice/transcribe.ts): consecutive pieces of the same channel with at most 1.5 s of silence between
  them are read as one piece of at most 19 s (19 s + 10 s of padding stays under the 30 s cap). A piece of the other
  channel in between ends the group, so «Tu» and «Altri» keep their order.
- The same applies with Parakeet (ADR 0214), which has no 30 s window but also gains from fewer runs.
- Voice mode (one sentence at a time, answered at once) is unchanged.

## Consequences

Fewer and longer transcript lines (a line can hold a few sentences of one speaker); timestamps are per line. The
speed-up depends on how short the sentences are; it was not measured on a real PC (no models in the container).
Parakeet (Settings → Voce) is the other lever.
