---
name: verify-behavior
description: Verifies a work contract with independent evidence, including intermittent browser failures. Use when checking that a change meets its acceptance criteria before it is reported done, or when a test fails only sometimes. Not for reading a diff for defects (code-review).
---

For each acceptance criterion choose the smallest check that can disprove it. Verify a regression on the old and changed behavior where feasible. Use unit tests for transformations, integration tests at real boundaries and the project's approved Playwright route for UI. Prefer role or label locators, isolated data, condition-based assertions and a trace of the first failure.

For an intermittent failure, record the seed, timing, network or shared-state prerequisite. A successful retry records intermittency; it cannot establish a fix. Check failure and retry paths as well as the happy path. For visible work compare same-size before/after images and keyboard behavior. Report command, outcome and missing evidence. Keep review independent and read-only.
