<!-- Where routines went: out of the app (ADR 0325), retained here so old documentation links remain useful. -->
# Routines are no longer part of the app

The app has no Routine page, no routine tools for the Orchestrator and no scheduled requests
(ADR [0325](../adr/0325-routines-leave-the-app.md)). It never prepares, starts, advances or reads a routine run.

The terminal engine is still in `packages/routine-runtime` (`routine run | watch | resume`), with its
[package authoring guide](../routines/authoring.md). It is leaving this repository too: the owner's brain becomes its
home, and the package is removed here once that copy is confirmed to work. Folders of past runs are never touched.
