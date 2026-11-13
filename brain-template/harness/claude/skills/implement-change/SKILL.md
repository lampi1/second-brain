---
name: implement-change
description: Implements and refactors a scoped change, including tests, UI and project documentation. Use when a step asks to fix a bug, add or change a feature, refactor code or update a repo's docs. Not for root-cause hunts (code-investigation) or reviewing a diff (code-review).
---

Start from one externally observable example and trace the normal entry point. For a bug, reproduce the failure first. Capture a failing behavioral test when feasible, make it pass, then simplify. Choose unit tests for a rule, integration tests for a boundary and a browser test for a user interaction. Preserve existing callers, data, retry behavior and the repository's test policy.

For a refactor, characterize the behavior before moving code. For UI, follow the product's existing components and test focus, keyboard, narrow layouts and empty/error states. Capture the same view before and after. For docs, write for a named reader and verify the instructions. Use a sequence diagram for event order or a flowchart for a decision. Label edges with actions, keep one claim per diagram and check the rendered output against the code.

Review the diff, run the scoped checks and report the result. Keep commits focused. A PR draft describes the change, evidence and remaining gaps; publishing follows the user's authorization and the repository's rules.
