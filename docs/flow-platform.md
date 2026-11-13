<!-- Current routine architecture: terminal-only execution, retained here so old documentation links remain useful. -->
# Terminal-only routines

The in-app flows executor, automation rules, triggers, approval panels and `app_flow_*` tools are retired
(ADR [0179](adr/0179-terminal-only-routines.md)). The app never starts, advances, settles or reconciles routine runs.

Use the [package authoring guide](routines/authoring.md) and `packages/routine-runtime` (`routine run | watch | resume`).
The app prepares packages on request and observes runs only while their view is open or when the user explicitly
asks the Orchestrator. Historical app runs remain read-only evidence; unknown DevOps outcomes are never retried.
