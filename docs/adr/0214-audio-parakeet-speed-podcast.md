# 0214. Audio: Parakeet transcription, voice speed, a two-voice podcast, English words

Date: 2026-10-31. Status: accepted.

## Context

The owner (2026-10-31): top quality, free, open-source audio; transcription faster and lighter on the CPU without
losing quality; the podcast always uses one voice, needs speed and continuous listening; the Italian voice reads
English terms badly.

What was checked, with sources:

- NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0, 25 European languages, Italian included) runs in sherpa-onnx, the engine the
  app already uses, as a NeMo transducer (`modelType: 'nemo_transducer'`, encoder/decoder/joiner int8):
  https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html (RTF 0.325 on
  the sample file; 0.028 with VAD on a 334 s file). The installed sherpa-onnx native library contains the
  `nemo_transducer` model type (checked with `strings`).
- Italian WER about 3% for the int8 model and about 13.7x realtime on a Ryzen 4750U CPU:
  https://models.handy.computer/models/parakeet-tdt-0.6b-v3 (a third party's measurement, not ours).
- English average WER 6.34% for Parakeet against about 7.4% for Whisper large-v3:
  https://openwhispr.com/it/blog/parakeet-vs-whisper-vs-nemotron (a vendor blog).
- Files pinned from https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8 at revision
  2bda32ec70b097a55adaa07d9a7173915b43cc78, sha256 of each LFS file and the git blob id of tokens.txt from the Hub API.
- Not tried on a real PC: this container cannot download from Hugging Face. A wrong hash only means the download is
  refused and deleted, never a model loaded unchecked.

## Decision

- Transcription gets a third choice, «Parakeet · 670 MB», first in Settings → Voce, beside Whisper veloce and preciso
  (`VoiceAsr` 'parakeet', main/voice/catalog.ts, worker.ts). Not the default until the owner has tried it on a real PC.
  It serves voice mode, dictation and recordings alike.
- «Velocità della voce» (Lenta 0.85, Normale 1, Svelta 1.15, Più svelta 1.3: Piper's speed), a setting read at each
  sentence; the podcast has a chip that cycles it.
- The podcast: two different voices whenever two are on disk; with only one, a button downloads a second one (64 MB,
  just that voice: `voice:prepare` with `{ voice }`). It keeps playing when its view closes (its tile shows a stop),
  and stops when the lesson is left.
- English words: the pronunciation dictionary of `forEar` (shared/voice.ts) grows from about 60 to about 140 words
  (machine learning, computer, software, cloud, download, feedback, podcast…), Italian homographs left out (file,
  code). Piper's Italian phonemizer has no per-word language switch, so a dictionary is the available fix; a word not
  in it is still read the Italian way.

## Consequences

Parakeet is 670 MB more on disk when chosen. Recordings were not changed beyond the new model: the owner's «non
funzionano benissimo» needs a concrete case.
