<!-- Product overview and source setup for users and contributors. Detailed operating rules live in AGENTS.md. -->
<p align="center"><img src="build/icon.png" width="88" alt="second-brain"></p>
<h1 align="center">second-brain</h1>
<p align="center"><b>One conversation. A visible team. Work that keeps moving.</b><br>
A desktop workspace for Claude Code, Codex and Cursor — built around decisions, evidence and reusable routines.</p>
<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Windows first; macOS and Linux supported" src="https://img.shields.io/badge/Windows%20first-macOS%20%C2%B7%20Linux-0078D6.svg">
</p>

![Agents working in visible threads, with the Orchestrator alongside](docs/screenshots/grindhouse.webp)

## Less coordination. More finished work.

Tell the **Orchestrator** what you need. It plans with you, opens the right agents and brings back the decisions that need your attention. Questions and permissions arrive as compact panels; reports and screenshots stay attached to the work.

| Idea | What it gives you |
| --- | --- |
| **One entrance, five specialist roles** | Strategist plans, Scout investigates, Artisan builds, Sentinel reviews and Herald communicates. Their work stays visible in a shared workspace. |
| **Routines that run themselves** | Versioned steps, model choices, evidence, retries and review loops. The host advances from recorded agent reports; an Orchestrator turn is not needed at every handoff. |
| **Your workstation as a job runner** | Scheduled and DevOps triggers detect work without model calls. Agent steps spend tokens when they run. Pause, cancel or restart a run, including from a selected step. |
| **Memory with provenance** | Plain-text notes, rules and skills you own; reviewable proposals with sources and undo. Task-relevant memory is selected for launch instead of loading the whole brain. |
| **Side questions without derailing the job** | Flash handles quick read-only questions alongside the Orchestrator. Turn an answer into a task when it needs action. |
| **Evidence you can inspect** | Independent reviews, run history, screenshots, file previews and live logs expose what happened, what failed and what is waiting. |
| **Reusable knowledge, deliberate adoption** | Browse opt-in component sources, inspect pinned files and licenses, then adapt selected content into an approved routine version. No template installer or hidden permission changes. |
| **Understand what the agents changed** | Ask for a concise explanation linked to code, tests and evidence, or explore it through optional guided questions. Inspect the memory and skills selected at launch. |

## Speak, listen, keep your hands free

Dictate into a chat, listen to replies, and record or import audio for transcription. Speech recognition and synthesis run locally with downloaded models; text sent to an assistant uses that assistant's configured provider. Continuous conversation handles interruptions, joins short speech fragments and keeps replies tied to the question you actually heard. Stale transcriptions cannot answer a newer panel. Ambiguous speech stays editable instead of becoming an accidental yes.

The opening has a slower six-second reveal and an original, quiet musical cue. It respects sound settings, Do Not Disturb and reduced motion, and stops immediately when skipped.

On-demand voice diagnostics show observed recognition/synthesis timings, failures and sample counts without saving audio or transcripts. Missing measurements stay unknown; they are not an accuracy score.

## Automation with explicit boundaries

Design a routine with the Orchestrator, inspect its steps in fullscreen, then approve the exact version and its automatic configuration. Package prompts, scripts and checklists with the version you approve. Export the complete definition; imports start as drafts. Workers and their browsers stay inside the current routine step, keeping the Grindhouse clear. Inspect the run dossier or ask the Orchestrator to propose improvements.

**Verify and compare** checks prerequisites, compares recorded outcomes and evaluates explicit cases against host receipts. Repeated failures without new evidence stop for a decision. Export an offline report to inspect the observations outside the app; counts never become automatic quality claims or approvals.

External capabilities are checked by the host: DevOps comments, screenshots, related links, run-owned PRs, pinned test deployments and read-only test databases require explicit grants. Downgrades to human review retain evidence and clean up owned resources. Production steps wait for the user's **Esegui** action on the exact displayed command. Routine-only production permissions can be designed as versioned intents; they do not enable execution. A chat message or another agent's approval cannot silently grant access.

The app uses your CLI logins and keeps its own configuration separate. Agent commands run with the permissions you grant on your machine. The interface supports Italian, English and German.

## Start from source

Requires **Git, Node.js 22+**, and a supported agent CLI with your own login.

```bash
git clone https://github.com/lampi1/second-brain.git
cd second-brain
npm run setup
npm run build
npm start
```

Complete the first-run setup, select your brain folder and connect your engines. `npm run doctor` checks local readiness. Linux also needs Electron's system libraries; see [CONTRIBUTING.md](CONTRIBUTING.md).

Update through **Settings → Updates → Update**. For development: use a branch, read [AGENTS.md](AGENTS.md), and run `npm run check:branch` before submitting changes.

[Architecture](docs/architecture.md) · [Design decisions](docs/adr/) · [Contributing](CONTRIBUTING.md) · [Issues](https://github.com/lampi1/second-brain/issues) · [MIT license](LICENSE)
