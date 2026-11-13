<!-- Decision and evaluation contract for continuous voice; used by voice maintainers and reviewers. -->
# 0157 — Continuous voice needs identity, cancellation and measured turn taking

Date: 2026-10-25. Status: accepted for lifecycle hardening; model/latency experiments remain proposals.

## Problem

A short qualified answer such as “yes, but wait” could press Yes. A late transcript could reach a new chat after voice restarted. Playback cancellation left native synthesis queued. Fixed silence thresholds also cannot establish whether a person has finished a thought.

## Shipped decisions

- Every capture has a unique session; every VAD segment has an utterance id. Main and renderer discard stale, duplicate and unpaired results. The worker retains the original model/session through asynchronous inference.
- Routing captures chat, mode and question version at speech start. Question changes preserve words in the original draft. A thought settles across segments before any answer is interpreted; a resumed utterance waits for its transcript, even when decoding is slow.
- Only exact unambiguous phrases activate yes/no/skip. Qualifications remain the existing free-text answer. A binary answer before the question finishes playing preserves its text and replays the same question. Prompt edits invalidate delivery. Existing host approval/version checks and the separate production click remain authoritative.
- Barge-in cancels playback and queued synthesis. Native TTS cooperatively cancels at its next progress callback; a watchdog kills an unresponsive worker and fails affected jobs explicitly. Capture and synthesis queues have host bounds. Switching microphones preserves already recognized held words as a draft.
- Capture, recognition and synthesis remain local. Text forwarded to an agent still uses that agent's provider. This change adds no cloud-audio subscription or new model download.

## What “best” means for this app

Vendor documentation describes different implementation strategies, not a single certified conversational standard. Adopt the observable properties, then compare candidates on the same Italian developer speech corpus.

| Property | Current implementation | Next evaluation |
| --- | --- | --- |
| Natural pauses | Silero segmentation plus a 700 ms thought hold | Compare a pinned local semantic turn detector against this baseline; measure premature endings and added delay, including hesitation and corrections. |
| Interruption | Echo heuristic, immediate playback stop, native cancellation | Separate backchannels from intentional interruption; measure missed and false interruptions with speakers and headsets. Silence playback does not mean stopping agent work. |
| Recognition | Local whole-utterance Whisper | Compare streaming recognition for Italian technical terms, paths, numbers and mixed Italian/English. Evaluate word error and task completion, not model size alone. |
| Capture | Chromium echo/noise/gain constraints | Replace the legacy ScriptProcessor capture with AudioWorklet after device, resampling and backpressure validation. Verify applied track settings; requesting a constraint is not proof it is active. |
| Observability | Deterministic lifecycle tests | Record durations/counters without raw audio or transcript: speech end → transcript, transcript → dispatch, first text → first played audio, interruption → silence, stale drops, retries. Report median/p95 with sample counts and device/model configuration. |
| Speech quality | Local Piper; sentence-level prefetch | Compare intelligibility and naturalness in blind listening tests. Keep technical terms recognizable rather than translating every developer word mechanically. |

Initial product targets, **not measured results**: interruption-to-silence p95 under 200 ms; first audible response p95 under 1.5 s on the declared reference machine; zero stale-session dispatches or ambiguous binary approvals in the regression corpus. End-to-end agent/provider latency must be reported separately from local speech latency. Relax neither permissions nor approval semantics to improve these numbers.

Acceptance corpus: bare yes/no; “yes… wait”; self-correction across pauses; new question during transcription; headset unplug; worker crash; delayed native rejection; loudspeaker echo; background conversation; technical names and numbered identifiers. Fake IPC tests establish lifecycle properties, **not** real microphone accuracy or naturalness. Hardware trials and model selection are still required before claiming those qualities.

## Primary references checked 2026-10-25

- [Pipecat turn strategies](https://docs.pipecat.ai/api-reference/server/utilities/turn-management/user-turn-strategies): separate turn start/end strategies; combine VAD and turn analysis.
- [Pipecat Smart Turn](https://github.com/pipecat-ai/smart-turn): candidate open-source audio turn detector; evaluate its language, model and deployment requirements before adopting.
- [LiveKit turn handling](https://docs.livekit.io/agents/logic/turns/): endpointing, interruption and recovery are separate controls.
- [LiveKit June 2026 configuration guide](https://livekit.com/blog/turn-detection-and-interruption-handling): architecture-dependent tuning; defaults are starting points.
- [W3C Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/): capture constraints and applied settings. The consulted publication is a Candidate Recommendation Draft, not a final certification.

Validation uses mocked native inference and fake audio/IPC. No E2E or live provider/model test is run on this branch. Existing voice E2E coverage is maintained for the permitted main pipeline.
